import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { reviewRationaleDispositions } from '../rationale-dispositions.mjs';

const namespace = { ownerId: 'disposition-synthetic', scope: 'personal', projectId: null };
const other = { ...namespace, ownerId: 'disposition-other' };
const edge = (from, to, relation = 'supports-decision', fromReceipt = 0, toReceipt = 0) =>
  ({ from, to, relation, fromReceipt, toReceipt });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const error = (result, code) => {
  assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code);
};
const oldKey = value => JSON.stringify([value.from, value.to, value.relation, value.fromReceipt, value.toReceipt]);
const all = (input, action = 'keep') => ({ dispositions: input.oldEdges.map(item =>
  ({ edge: item.index, action, evidence: action === 'withdraw' ? [{ memory: 0, receipt: 0 }] : [] })),
additions: [] });
const prompt = name => readFileSync(new URL(`../prompts/${name}`, import.meta.url), 'utf8');
const sha256 = value => createHash('sha256').update(value).digest('hex');

function fixture(t, withPort = true) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-disposition-')), 'store.sqlite');
  let calls = 0, counts = 0, proposal = input => all(input), relation = { edges: [] };
  const model = { contextWindow: 8192, countTokens: () => { counts++; return 1; },
    relate: () => relation,
    ...(withPort ? { reviewRationaleDispositions: ({ input }) => { calls++; return proposal(input); } } : {}) };
  let core = openMemoryCore({ path, model });
  const db = new DatabaseSync(path);
  t.after(() => { if (core) core.close(); db.close(); rmSync(dirname(path), { recursive: true, force: true }); });
  let sequence = 0;
  const admit = (text, ns = namespace) => {
    const memory = ok(core.admit({ namespace: ns, memory: { content: text, kind: 'context' },
      receipts: [{ client: 'synthetic-private', sessionId: 'synthetic-private',
        eventId: `event-${sequence++}`, role: 'user', excerpt: text }] })).memory;
    return { memoryId: memory.id, revision: memory.revision };
  };
  const refs = [
    admit('Team chose A because price and quality were good.'),
    admit('A cost less at the time.'),
    admit('A quality test passed at the time.'),
    admit('An unverified old report said A became costly.'),
    admit('The old costly report was mistaken.'),
    admit('A new price change made A more costly; quality still works.'),
  ];
  const rows = () => db.prepare(`SELECT from_id, to_id, relation, from_receipt, to_receipt,
    from_revision, to_revision, from_digest, to_digest FROM rationale_edges
    ORDER BY from_id, to_id, relation, from_receipt, to_receipt`).all();
  const epoch = () => ok(core.map({ namespace })).indexRevision;
  const seed = async (edges, selected = refs) => {
    relation = { edges };
    return ok(await core.reviewRationale({ namespace, refs: selected }));
  };
  return { path, model, refs, admit, rows, epoch, seed,
    review: (selected = refs, ns = namespace) => core.reviewRationaleDispositions({ namespace: ns, refs: selected }),
    setProposal(value) { proposal = value; },
    get core() { return core; }, close() { core.close(); core = null; },
    get calls() { return calls; }, get counts() { return counts; } };
}

test('DS1–3 explicit disposition uses pinned v2 semantics while ordinary relate request stays unchanged', async t => {
  const original = prompt('review-rationale-dispositions.md');
  const v2 = prompt('review-rationale-dispositions-v2.md');
  const relate = prompt('relate-rationale.md');
  assert.equal(sha256(original), 'f413ad401dccc7a7e109d0fedd8df74cfcaa6cb5887821adaae204dfe7ef8c7e');
  assert.equal(sha256(v2), '676b4a2181c32b6fdff0cc528f6720349afc34cd8198f759201ce7f72d674241');
  assert.equal(sha256(relate), 'b00cc2511e7e01d6507f9d13abf6115b315cca8208866a5e15721b6bee212615');
  const trustWarning = relate.split('\n').slice(1, 4).join('\n');
  const definitions = relate.slice(relate.indexOf('supports-decision:'), relate.indexOf('\n\nSelect'));
  assert.ok(v2.includes(trustWarning));
  assert.ok(v2.includes(definitions));
  assert.match(v2, /kept plus unknown old edges plus additions cannot exceed ten/);
  const f = fixture(t);
  let relateRequest, dispositionRequest;
  f.model.relate = request => {
    relateRequest = request;
    return { edges: [edge(1, 0)] };
  };
  f.model.reviewRationaleDispositions = request => {
    dispositionRequest = request;
    return all(request.input);
  };
  ok(await f.core.reviewRationale({ namespace, refs: f.refs }));
  const before = f.rows();
  const reviewed = ok(await f.review());
  assert.equal(relateRequest.system, relate);
  assert.equal(dispositionRequest.system, v2);
  assert.equal(relateRequest.maxOutputTokens, 1024);
  assert.equal(dispositionRequest.maxOutputTokens, 1024);
  assert.deepEqual(dispositionRequest.input.memories, relateRequest.input.memories);
  assert.equal(dispositionRequest.input.oldEdges.length, 1);
  assert.equal(reviewed.projectedEdges[0].disposition, 'keep');
  assert.deepEqual(f.rows(), before);
});

test('DR1–5 complete dispositions project keep/withdraw/add without changing stored evidence or epoch', async t => {
  const f = fixture(t);
  await f.seed([edge(1, 0), edge(2, 0), edge(3, 1, 'challenges-premise')]);
  const beforeRows = f.rows(), beforeEpoch = f.epoch();
  const beforeRecords = f.refs.map(ref => ok(f.core.get({ namespace, memoryId: ref.memoryId })));
  let seen;
  f.setProposal(input => {
    seen = input;
    const dispositions = input.oldEdges.map(item => ({ edge: item.index,
      action: item.from === 3 ? 'withdraw' : 'keep',
      evidence: item.from === 3 ? [{ memory: 4, receipt: 0 }] : [] }));
    return { dispositions, additions: [edge(5, 1, 'challenges-premise')] };
  });
  const result = ok(await f.review());
  assert.deepEqual(Object.keys(seen).sort(), ['memories', 'oldEdges']);
  assert.ok(seen.oldEdges.every(item => item.interpretationStatus === 'unverified'));
  assert.equal(JSON.stringify(seen).includes(f.refs[0].memoryId), false);
  for (const secret of ['synthetic-private', namespace.ownerId, 'event-']) {
    assert.equal(JSON.stringify(seen).includes(secret), false);
  }
  assert.equal(seen.memories.length, 6); assert.equal(seen.oldEdges.length, 3);
  assert.deepEqual(result.dispositions.map(item => item.action).sort(), ['keep', 'keep', 'withdraw']);
  assert.deepEqual(result.projectedEdges.map(oldKey).sort(), [oldKey(edge(1, 0)),
    oldKey(edge(2, 0)), oldKey(edge(5, 1, 'challenges-premise'))].sort());
  assert.equal(result.projectedEdges.length, 3);
  assert.equal(result.unresolvedCount, 0);
  assert.equal(result.persistence, 'not-stored'); assert.equal(result.status, 'unassessed');
  assert.equal(result.scope, 'supplied-refs-only'); assert.equal(result.indexRevision, beforeEpoch);
  assert.deepEqual(f.rows(), beforeRows); assert.equal(f.epoch(), beforeEpoch);
  assert.deepEqual(f.refs.map(ref => ok(f.core.get({ namespace, memoryId: ref.memoryId }))), beforeRecords);
  const warm = ok(f.core.getRationale({ namespace, ...f.refs[0] }));
  f.close();
  const cold = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { openMemoryCore } from ${JSON.stringify(new URL('../index.mjs', import.meta.url).href)};
    const core = openMemoryCore({ path: process.argv[1] });
    const value = core.getRationale({ namespace: JSON.parse(process.argv[2]), ...JSON.parse(process.argv[3]) });
    core.close(); process.stdout.write(JSON.stringify(value));
  `, f.path, JSON.stringify(namespace), JSON.stringify(f.refs[0])],
  { encoding: 'utf8', timeout: 10000, env: { NODE_NO_WARNINGS: '1' } });
  assert.equal(cold.status, 0, cold.stderr);
  assert.deepEqual(JSON.parse(cold.stdout).value, warm);
  assert.equal(warm.edges.length, 3);
});

test('DR1/DR3 unknown is retained unresolved; missing disposition and unsafe shapes reject atomically', async t => {
  const f = fixture(t);
  await f.seed([edge(1, 0), edge(3, 1, 'challenges-premise')]);
  const before = f.rows(), epoch = f.epoch();
  f.setProposal(input => all(input, 'unknown'));
  const unresolved = ok(await f.review());
  assert.equal(unresolved.unresolvedCount, 2);
  assert.ok(unresolved.projectedEdges.every(item => item.disposition === 'unknown'));
  assert.deepEqual(f.rows(), before);
  const mutations = [
    input => ({ ...all(input), dispositions: [] }),
    input => ({ ...all(input), dispositions: [all(input).dispositions[0], all(input).dispositions[0]] }),
    input => ({ ...all(input), dispositions: all(input).dispositions.map(item => ({ ...item, edge: 99 })) }),
    input => ({ ...all(input), dispositions: all(input).dispositions.map(item => ({ ...item, action: 'withdraw' })) }),
    input => ({ ...all(input), dispositions: all(input).dispositions.map(item =>
      ({ ...item, evidence: [{ memory: 99, receipt: 0 }] })) }),
    input => ({ ...all(input), dispositions: all(input).dispositions.map(item =>
      ({ ...item, evidence: [{ memory: 0, receipt: 0 }, { memory: 0, receipt: 0 }] })) }),
    input => ({ ...all(input), dispositions: all(input).dispositions.map(item =>
      ({ ...item, evidence: [{ memory: 0, receipt: 99 }] })) }),
    input => ({ ...all(input), dispositions: all(input).dispositions.map(item =>
      ({ ...item, evidence: [{ memory: 0, receipt: 0, private: true }] })) }),
    input => ({ ...all(input), dispositions: all(input).dispositions.map(item => ({ ...item, extra: true })) }),
    input => ({ ...all(input), surprise: 'extra' }),
    input => ({ ...all(input), additions: [edge(1, 0)] }),
    input => ({ ...all(input), additions: [edge(1, 1, 'challenges-premise')] }),
    input => ({ ...all(input), additions: [edge(1, 0, 'supports-decision', 99)] }),
    input => ({ ...all(input), additions: [edge(2, 0), edge(2, 0)] }),
  ];
  for (const mutate of mutations) {
    f.setProposal(mutate);
    error(await f.review(), 'invalid_model_output');
    assert.deepEqual(f.rows(), before); assert.equal(f.epoch(), epoch);
  }
});

test('DR1/DR3 empty old graph accepts additions; crossing and foreign edges are excluded', async t => {
  const f = fixture(t);
  const selected = f.refs.slice(0, 2);
  f.setProposal(input => { assert.deepEqual(input.oldEdges, []);
    return { dispositions: [], additions: [edge(1, 0)] }; });
  const empty = ok(await f.review(selected));
  assert.equal(empty.projectedEdges.length, 1); assert.equal(f.rows().length, 0);
  await f.seed([edge(2, 0)]);
  const otherDecision = f.admit('Other owner chose a different option.', other);
  const otherPremise = f.admit('Other owner tested that option.', other);
  f.model.relate = () => ({ edges: [edge(1, 0)] });
  const foreign = f.core.reviewRationale({ namespace: other, refs: [otherDecision, otherPremise] });
  ok(await foreign);
  f.setProposal(input => { assert.deepEqual(input.oldEdges, []);
    return { dispositions: [], additions: [] }; });
  const scoped = ok(await f.review(selected));
  assert.deepEqual(scoped.oldEdges, []); assert.equal(scoped.sources.length, 2);
  assert.equal(f.rows().length, 2);
});

test('DR1/DR2 absent port and over-ten old edges reject before a disposition callback or counter', async t => {
  const absent = fixture(t, false); const counted = absent.counts;
  error(await absent.review(), 'model_not_configured');
  assert.equal(absent.counts, counted);
  const f = fixture(t);
  await f.seed([edge(0, 0), edge(1, 1), edge(2, 2), edge(3, 3), edge(4, 4),
    edge(5, 5), edge(1, 0), edge(2, 0), edge(3, 0), edge(4, 0)]);
  await f.seed([edge(5, 0)]);
  const count = f.counts;
  error(await f.review(), 'rationale_limit');
  assert.equal(f.calls, 0); assert.equal(f.counts, count);
});

test('DR5 same-namespace edge-only and source mutations fence asynchronous review', async t => {
  const f = fixture(t);
  await f.seed([edge(1, 0)]);
  const original = f.rows();
  f.setProposal(async input => {
    await f.seed([edge(2, 0)]);
    return all(input);
  });
  error(await f.review(), 'revision_conflict');
  assert.equal(f.rows().length, original.length + 1);
  f.setProposal(input => {
    ok(f.core.correct({ namespace, memoryId: f.refs[0].memoryId, expectedRevision: f.refs[0].revision,
      content: 'Corrected decision content.', kind: 'context', receipt: { client: 'synthetic',
        sessionId: 'synthetic', eventId: 'corrected', role: 'user', excerpt: 'Corrected decision content.' } }));
    return all(input);
  });
  error(await f.review(), 'revision_conflict');
});

test('DR5 output getter and token callback mutations are fenced; errors and output limits leave graph unchanged', async t => {
  const f = fixture(t);
  await f.seed([edge(1, 0)]);
  const before = f.rows();
  f.setProposal(input => ({ get dispositions() {
    ok(f.core.admit({ namespace, memory: { content: 'Concurrent source.', kind: 'context' },
      receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: 'getter', role: 'user',
        excerpt: 'Concurrent source.' }] }));
    return all(input).dispositions;
  }, additions: [] }));
  error(await f.review(), 'revision_conflict');
  assert.deepEqual(f.rows(), before);
  let counterCalls = 0;
  f.model.countTokens = () => { counterCalls++; if (counterCalls === 2) {
    ok(f.core.admit({ namespace, memory: { content: 'Another source.', kind: 'context' },
      receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: 'counter', role: 'user',
        excerpt: 'Another source.' }] }));
  } return 1; };
  f.setProposal(input => all(input));
  error(await f.review(), 'revision_conflict');
  assert.deepEqual(f.rows(), before);
  f.model.countTokens = () => 6001;
  const calls = f.calls;
  error(await f.review(), 'context_budget_exceeded'); assert.equal(f.calls, calls);
  let n = 0;
  f.model.countTokens = () => ++n === 1 ? 1 : 1025;
  error(await f.review(), 'invalid_model_output');
  f.model.countTokens = () => 1;
  let detachedCount = 0;
  f.model.countTokens = () => { detachedCount++; if (detachedCount === 3) {
    ok(f.core.admit({ namespace, memory: { content: 'Changed during detached recount.', kind: 'context' },
      receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: 'third-counter', role: 'user',
        excerpt: 'Changed during detached recount.' }] }));
  } return 1; };
  error(await f.review(), 'revision_conflict');
  f.model.countTokens = () => 1;
  f.setProposal(() => { throw new Error('synthetic provider failure'); });
  error(await f.review(), 'rationale_failed');
  f.setProposal(() => { throw new DOMException('cancelled', 'AbortError'); });
  error(await f.review(), 'model_cancelled');
  assert.deepEqual(f.rows(), before);
});

test('DR4 projected edge limit rejects without altering ten stored proposals', async t => {
  const f = fixture(t);
  await f.seed([edge(0, 0), edge(1, 1), edge(2, 2), edge(3, 3), edge(4, 4),
    edge(5, 5), edge(1, 0), edge(2, 0), edge(3, 0), edge(4, 0)]);
  const before = f.rows(), epoch = f.epoch();
  f.setProposal(input => ({ ...all(input), additions: [edge(5, 0)] }));
  error(await f.review(), 'rationale_limit');
  assert.deepEqual(f.rows(), before); assert.equal(f.epoch(), epoch);
});

test('DR5 filing and forgetting fence pending review; unrelated namespace mutation does not', async t => {
  const filed = fixture(t);
  await filed.seed([edge(1, 0)]);
  filed.setProposal(input => {
    ok(filed.core.applyPlacement({ namespace,
      proposal: { items: [{ memoryId: filed.refs[0].memoryId, parentIds: [],
        newL1: { title: 'Filed synthetic decision', parentL2Ids: [] } }] },
      expectedMemoryRevisions: [filed.refs[0]],
      expectedIndexRevision: ok(filed.core.map({ namespace, purpose: 'classification' })).indexRevision }));
    return all(input);
  });
  error(await filed.review(), 'revision_conflict');
  const forgotten = fixture(t);
  forgotten.setProposal(input => {
    ok(forgotten.core.forget({ namespace, memoryId: forgotten.refs[0].memoryId,
      expectedRevision: forgotten.refs[0].revision }));
    return all(input);
  });
  const forgottenResult = await forgotten.review();
  assert.equal(forgottenResult.ok, false);
  assert.ok(['memory_not_found', 'revision_conflict'].includes(forgottenResult.error.code));
  const independent = fixture(t);
  independent.setProposal(input => { independent.admit('Other namespace changed.', other); return all(input); });
  ok(await independent.review());
  const foreign = independent.admit('Foreign source.', other);
  error(await independent.review([independent.refs[0], foreign]), 'memory_not_found');
});

test('DR4 entire result limit rejects large ephemeral projection', async () => {
  const sources = Array.from({ length: 6 }, (_, index) => ({
    memory: { id: `source-${index}`, revision: 1, content: 'x'.repeat(3500) },
    receipts: [{ id: `receipt-${index}`, role: 'user', excerpt: `Short source ${index}.` }],
  }));
  const edges = [
    ...Array.from({ length: 6 }, (_, index) => edge(index, index)),
    ...Array.from({ length: 4 }, (_, index) => edge(index + 1, 0)),
  ].map(item => ({ ...item, interpretationStatus: 'model-proposed' }));
  const snapshot = { sources, edges, indexRevision: 1 };
  assert.equal(new Set(edges.map(oldKey)).size, 10);
  assert.ok(JSON.stringify(snapshot).length <= 24000);
  const model = { contextWindow: 8192, countTokens: () => 1,
    reviewRationaleDispositions: ({ input }) => all(input) };
  await assert.rejects(reviewRationaleDispositions(model, snapshot, () => {}),
    { code: 'context_item_too_large' });
});

test('DR2 synthetic-clock timeout aborts new port without writes or diagnostic content', async t => {
  const f = fixture(t);
  await f.seed([edge(1, 0)]);
  const before = f.rows(), epoch = f.epoch(), diagnostics = [];
  f.model.onDiagnostic = item => diagnostics.push(item);
  let started, signal;
  const reached = new Promise(resolve => { started = resolve; });
  f.model.reviewRationaleDispositions = request => {
    signal = request.signal; started(); return new Promise(() => {});
  };
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = f.review(); await reached;
  t.mock.timers.tick(29999); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  error(await pending, 'model_timeout'); assert.equal(signal.aborted, true);
  assert.deepEqual(diagnostics, [{ version: 1, stage: 'reviewRationaleDispositions',
    layer: 'core_call', reason: 'model_timeout' }]);
  assert.deepEqual(f.rows(), before); assert.equal(f.epoch(), epoch);
});
