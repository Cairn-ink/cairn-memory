import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';

const namespace = { ownerId: 'reviewed-replacement', scope: 'personal', projectId: null };
const other = { ...namespace, ownerId: 'another-owner' };
const edge = (from, to, relation = 'supports-decision', fromReceipt = 0, toReceipt = 0) =>
  ({ from, to, relation, fromReceipt, toReceipt });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const fails = (result, code) => {
  assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code);
};

function fixture(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-replace-')), 'store.sqlite');
  let output = { edges: [] }; let calls = 0;
  const model = { contextWindow: 8192, countTokens: () => 1,
    relate() { calls++; return output; } };
  const core = openMemoryCore({ path, model });
  const db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); rmSync(dirname(path), { recursive: true, force: true }); });
  const admit = (text, ns = namespace, excerpts = [text]) => ok(core.admit({ namespace: ns,
    memory: { content: `Interpretation: ${text}`, kind: 'context' },
    receipts: excerpts.map((excerpt, index) => ({ client: 'private', sessionId: 'private',
      eventId: `private-${index}`, role: 'user', excerpt })) })).memory;
  const memories = [admit('I chose A for offline support'), admit('A supports offline use'),
    admit('A fails offline')];
  const refs = memories.map(memory => ({ memoryId: memory.id, revision: memory.revision }));
  const review = (refsToReview = refs, patch = {}) => core.reviewRationale({ namespace, refs: refsToReview, ...patch });
  const rows = () => db.prepare(`SELECT from_id, to_id, relation, from_receipt, to_receipt,
    from_revision, to_revision, from_digest, to_digest FROM rationale_edges
    ORDER BY from_id, to_id, relation, from_receipt, to_receipt`).all();
  const epoch = () => ok(core.map({ namespace })).indexRevision;
  return { path, model, core, db, memories, refs, review, rows, epoch, admit,
    setOutput(value) { output = value; }, get calls() { return calls; } };
}

test('RR1/RR5 absent mode stays append-only and response shape unchanged; replacement removes only reviewed wrong challenge', async t => {
  const f = fixture(t); const [decision, premise, challenge] = f.refs;
  f.setOutput({ edges: [edge(1, 0), edge(2, 1, 'challenges-premise')] });
  assert.deepEqual(ok(await f.review()), { proposed: 2, inserted: 2,
    interpretationStatus: 'model-proposed', indexRevision: f.epoch() });
  const original = f.memories.map(memory => ok(f.core.get({ namespace, memoryId: memory.id })));
  const crossing = f.admit('Other premise');
  const crossingRef = { memoryId: crossing.id, revision: crossing.revision };
  f.setOutput({ edges: [edge(1, 0)] });
  ok(await f.review([decision, crossingRef]));
  const foreignFrom = f.admit('Foreign premise', other);
  const foreignTo = f.admit('Foreign decision', other);
  ok(await f.core.reviewRationale({ namespace: other, refs: [
    { memoryId: foreignTo.id, revision: foreignTo.revision },
    { memoryId: foreignFrom.id, revision: foreignFrom.revision },
  ] }));
  f.setOutput({ edges: [] });
  assert.equal(ok(await f.review()).inserted, 0);
  assert.equal(f.rows().length, 4);
  const before = f.epoch();
  f.setOutput({ edges: [edge(1, 0)] });
  const result = ok(await f.review([decision, premise, challenge], { writeMode: 'replace-reviewed' }));
  assert.deepEqual(result, { writeMode: 'replace-reviewed', proposed: 1, inserted: 0, removed: 1,
    interpretationStatus: 'model-proposed', indexRevision: before + 1 });
  assert.equal(f.rows().length, 3);
  assert.ok(f.rows().some(row => row.from_id === crossing.id && row.to_id === decision.memoryId));
  assert.ok(f.rows().some(row => row.from_id === foreignFrom.id && row.to_id === foreignTo.id));
  assert.deepEqual(f.memories.map(memory => ok(f.core.get({ namespace, memoryId: memory.id }))), original);
  assert.equal(ok(f.core.getRationale({ namespace, ...decision })).status, 'unassessed');
  const cold = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { openMemoryCore } from ${JSON.stringify(new URL('../index.mjs', import.meta.url).href)};
    const core = openMemoryCore({ path: process.argv[1] });
    const value = core.getRationale({ namespace: JSON.parse(process.argv[2]), ...JSON.parse(process.argv[3]) });
    core.close(); process.stdout.write(JSON.stringify(value));
  `, f.path, JSON.stringify(namespace), JSON.stringify(decision)], { encoding: 'utf8', timeout: 10000 });
  assert.equal(cold.status, 0, cold.stderr);
  assert.equal(JSON.parse(cold.stdout).value.status, 'unassessed');
  assert.equal(JSON.parse(cold.stdout).value.edges.length, 2);
});

test('RR2/RR3 empty replacement, identical repeat, self-support and receipt-distinct edges', async t => {
  const f = fixture(t); const [decision, premise] = f.refs;
  f.setOutput({ edges: [edge(0, 0), edge(1, 0)] });
  ok(await f.review([decision, premise], { writeMode: 'replace-reviewed' }));
  const first = f.rows(); const epoch = f.epoch();
  assert.deepEqual(ok(await f.review([decision, premise], { writeMode: 'replace-reviewed' })),
    { writeMode: 'replace-reviewed', proposed: 2, inserted: 0, removed: 0,
      interpretationStatus: 'model-proposed', indexRevision: epoch });
  assert.deepEqual(f.rows(), first);
  const multiple = f.admit('Separate citations', namespace, ['First', 'Second']);
  const multipleRef = { memoryId: multiple.id, revision: multiple.revision };
  f.setOutput({ edges: [edge(0, 0, 'supports-decision', 0, 1), edge(0, 0, 'supports-decision', 1, 0)] });
  ok(await f.review([multipleRef], { writeMode: 'replace-reviewed' }));
  assert.equal(f.rows().filter(row => row.from_id === multiple.id).length, 2);
  f.setOutput({ edges: [] });
  const cleared = ok(await f.review([multipleRef], { writeMode: 'replace-reviewed' }));
  assert.equal(cleared.removed, 2); assert.equal(cleared.inserted, 0);
  assert.equal(f.rows().filter(row => row.from_id === multiple.id).length, 0);
  assert.equal(f.rows().length, 2);
});

test('RR1/RR2 invalid mode, stale and cross-namespace refs reject before model or mutation', async t => {
  const f = fixture(t); const foreign = f.admit('Other namespace', other);
  const before = f.epoch();
  for (const writeMode of [undefined, null, 'append', 'replace-all']) {
    fails(await f.review(f.refs, { writeMode }), 'invalid_input');
  }
  assert.equal(f.calls, 0);
  fails(await f.review([f.refs[0], { memoryId: foreign.id, revision: foreign.revision }],
    { writeMode: 'replace-reviewed' }), 'memory_not_found');
  fails(await f.review([{ ...f.refs[0], revision: 999 }], { writeMode: 'replace-reviewed' }), 'revision_conflict');
  assert.equal(f.calls, 0); assert.equal(f.epoch(), before); assert.deepEqual(f.rows(), []);
});

test('RR1 inherited replacement flag or getter cannot opt in', async t => {
  const f = fixture(t); f.setOutput({ edges: [edge(1, 0)] }); ok(await f.review());
  const before = f.rows(); const epoch = f.epoch();
  f.setOutput({ edges: [] });
  const inherited = Object.assign(Object.create({ writeMode: 'replace-reviewed' }),
    { namespace, refs: f.refs });
  const first = ok(await f.core.reviewRationale(inherited));
  assert.equal(Object.hasOwn(first, 'writeMode'), false);
  let getterCalls = 0;
  const inheritedGetter = Object.assign(Object.create({ get writeMode() { getterCalls++; return 'replace-reviewed'; } }),
    { namespace, refs: f.refs });
  const second = ok(await f.core.reviewRationale(inheritedGetter));
  assert.equal(Object.hasOwn(second, 'writeMode'), false);
  assert.equal(getterCalls, 0); assert.deepEqual(f.rows(), before); assert.equal(f.epoch(), epoch);
});

test('RR4 concurrent graph edit fences pending replacement despite unchanged source revisions', async t => {
  const f = fixture(t); const [decision, premise, challenge] = f.refs;
  f.setOutput({ edges: [edge(1, 0)] }); ok(await f.review([decision, premise]));
  const old = f.rows(); let resolve;
  f.model.relate = () => new Promise(done => { resolve = done; });
  const pending = f.review([decision, premise], { writeMode: 'replace-reviewed' });
  await new Promise(done => setImmediate(done));
  f.model.relate = () => ({ edges: [edge(1, 0), edge(2, 1, 'challenges-premise')] });
  ok(await f.review()); const committed = f.rows(); const epoch = f.epoch();
  assert.equal(committed.length, old.length + 1);
  resolve({ edges: [] });
  fails(await pending, 'revision_conflict');
  assert.deepEqual(f.rows(), committed); assert.equal(f.epoch(), epoch);
});

test('RR4 failed/malformed callbacks and invalid retained edge leave graph and epoch unchanged', async t => {
  const f = fixture(t); f.setOutput({ edges: [edge(1, 0), edge(2, 1, 'challenges-premise')] });
  ok(await f.review()); const before = f.rows(); const epoch = f.epoch();
  f.model.relate = () => { throw new Error('provider content'); };
  fails(await f.review(f.refs, { writeMode: 'replace-reviewed' }), 'rationale_failed');
  f.model.relate = () => ({ edges: [edge(1, 0), edge(1, 0)] });
  fails(await f.review(f.refs, { writeMode: 'replace-reviewed' }), 'invalid_model_output');
  assert.deepEqual(f.rows(), before); assert.equal(f.epoch(), epoch);
  f.db.prepare('UPDATE rationale_edges SET from_digest = ? WHERE from_id = ?').run('corrupt', f.refs[2].memoryId);
  const corrupt = f.rows();
  f.model.relate = () => ({ edges: [] });
  fails(await f.review(f.refs, { writeMode: 'replace-reviewed' }), 'revision_conflict');
  assert.deepEqual(f.rows(), corrupt); assert.equal(f.epoch(), epoch);
});

test('RR4 output-token callback epoch mutation fences replacement without removing prior links', async t => {
  const f = fixture(t); f.setOutput({ edges: [edge(1, 0)] }); ok(await f.review());
  const before = f.rows(); let mutated = false;
  f.setOutput({ edges: [] });
  f.model.countTokens = text => {
    if (!mutated && text.includes('"edges"')) {
      mutated = true;
      f.admit('Concurrent unrelated source');
    }
    return 1;
  };
  fails(await f.review(f.refs, { writeMode: 'replace-reviewed' }), 'revision_conflict');
  assert.equal(mutated, true); assert.deepEqual(f.rows(), before);
});

test('RR4 replacement timeout leaves prior links and epoch unchanged', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const f = fixture(t); f.setOutput({ edges: [edge(1, 0)] }); ok(await f.review());
  const before = f.rows(); const epoch = f.epoch(); let started; let signal;
  const reached = new Promise(resolve => { started = resolve; });
  f.model.relate = request => { signal = request.signal; started(); return new Promise(() => {}); };
  const pending = f.review(f.refs, { writeMode: 'replace-reviewed' }); await reached;
  t.mock.timers.tick(30000);
  fails(await pending, 'model_timeout'); assert.equal(signal.aborted, true);
  assert.deepEqual(f.rows(), before); assert.equal(f.epoch(), epoch);
});

test('RR3 qualified filed memory and placement survive link-only replacement', async t => {
  const f = fixture(t); const text = 'Project Alpha deadline is Monday.';
  const memory = ok(f.core.admit({ namespace, memory: { content: text, kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'session', eventId: 'qualified', role: 'user', excerpt: text }],
    qualification: { version: 1,
      slot: { subject: 'Project Alpha', property: 'deadline', scope: 'work', applies: 'current release' },
      value: 'Monday', attribution: 'direct', commitment: 'adopted',
      anchors: [{ receiptIndex: 0, start: 0, end: text.length, text,
        fields: ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'] }] },
  })).memory;
  const placed = ok(f.core.applyPlacement({ namespace,
    proposal: { items: [{ memoryId: memory.id, parentIds: [],
      newL1: { title: 'Project deadlines', parentL2Ids: [], newL2Title: 'Projects' } }] },
    expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
    expectedIndexRevision: f.epoch() }));
  const filed = placed.memories[0];
  const qualifiedRef = { memoryId: filed.id, revision: filed.revision };
  const detail = () => ok(f.core.get({ namespace, memoryId: filed.id, includeQualification: true }));
  const before = detail();
  assert.equal(before.memory.filing.status, 'filed'); assert.ok(before.qualification);
  assert.equal(before.placements.length, 1);
  const mapBefore = ok(f.core.map({ namespace })).items;
  f.setOutput({ edges: [edge(1, 0)] });
  ok(await f.review([qualifiedRef, f.refs[1]], { writeMode: 'replace-reviewed' }));
  f.setOutput({ edges: [] });
  ok(await f.review([qualifiedRef, f.refs[1]], { writeMode: 'replace-reviewed' }));
  assert.deepEqual(detail(), before);
  assert.deepEqual(ok(f.core.map({ namespace })).items, mapBefore);
});

test('RR4 late degree failure rolls back removals and inserts together', async t => {
  const f = fixture(t); const root = f.refs[0]; const premise = f.refs[1];
  f.setOutput({ edges: [edge(1, 0)] }); ok(await f.review([root, premise]));
  const refs = [];
  for (let index = 0; index < 9; index++) {
    const memory = f.admit(`External premise ${index}`);
    const ref = { memoryId: memory.id, revision: memory.revision }; refs.push(ref);
    ok(await f.review([root, ref]));
  }
  const replacement = f.admit('Different premise');
  const replacementRef = { memoryId: replacement.id, revision: replacement.revision };
  const secondReplacement = f.admit('Another different premise');
  const secondReplacementRef = { memoryId: secondReplacement.id, revision: secondReplacement.revision };
  const before = f.rows(); const epoch = f.epoch();
  f.setOutput({ edges: [edge(2, 0), edge(3, 0)] });
  fails(await f.review([root, premise, replacementRef, secondReplacementRef],
    { writeMode: 'replace-reviewed' }), 'rationale_limit');
  assert.deepEqual(f.rows(), before); assert.equal(f.epoch(), epoch);
});

test('RR1 claim-focus stays independent of replacement and preserves conditional response', async t => {
  const f = fixture(t); let request;
  f.model.relate = input => { request = input; return { edges: [edge(1, 0)] }; };
  const result = ok(await f.review(f.refs, { inputMode: 'claim-focus-v1', writeMode: 'replace-reviewed' }));
  assert.equal(result.inputMode, 'claim-focus-v1'); assert.equal(result.writeMode, 'replace-reviewed');
  assert.equal(request.input.memories[0].focus.interpretationStatus, 'unverified');
  assert.equal(f.rows().length, 1);
});
