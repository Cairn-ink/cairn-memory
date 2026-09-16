import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';

const namespace = { ownerId: 'synthetic-neighborhood', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const fails = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });
function fixture(t, overrides = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-neighborhood-')), 'memory.sqlite');
  const calls = []; let tuples = [], selected;
  const model = { contextWindow: 8192, countTokens: () => 1,
    relate: () => ({ edges: tuples.map(([from, to, relation]) => ({ from, to, relation, fromReceipt: 0, toReceipt: 0 })) }),
    select: ({ input }) => ({ refs: input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')
      .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref })).filter(item => !selected || item.memoryId === selected)) }),
    rank: ({ input }) => { calls.push({ input: structuredClone(input) }); return { refs: input.candidates.map(item =>
      ({ namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) }; }, ...overrides };
  const core = openMemoryCore({ path, model }); t.after(() => core.close());
  const admit = (excerpt, eventId) => ok(core.admit({ namespace, memory: { content: excerpt, kind: 'decision' },
    receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId, role: 'user', excerpt }] })).memory;
  const link = async (refs, proposed) => { tuples = proposed;
    model.relate = () => ({ edges: tuples.map(([from, to, relation]) => ({ from, to, relation,
      fromReceipt: 0, toReceipt: 0 })) });
    return ok(await core.reviewRationale({ namespace, refs })); };
  const fetch = (refs, mode = 'rationale-neighborhood-evidence', patch = {}) => core.fetch({ namespace, refs, contextMode: mode, ...patch });
  const recall = (mode = 'rationale-neighborhood-evidence', patch = {}) => core.recall({ readSet: [namespace],
    query: 'Why choose the vendor?', contextMode: mode, ...patch });
  return { core, path, model, calls, admit, link, fetch, recall, select: memory => { selected = memory.id; } };
}

test('RN1–4 one selected old root carries decision context plus outgoing later decision through rank and final reread', async t => {
  const f = fixture(t);
  const old = f.admit('We chose A because its price was lower.', 'old');
  const reason = f.admit('A also met our support requirement.', 'reason');
  const challenge = f.admit('A no longer meets the support requirement.', 'challenge');
  const later = f.admit('We chose B using the old A price comparison as an explicit reason.', 'later');
  await f.link([ref(reason), ref(old)], [[0, 1, 'supports-decision']]);
  await f.link([ref(challenge), ref(reason)], [[0, 1, 'challenges-premise']]);
  await f.link([ref(old), ref(later)], [[0, 1, 'supports-decision']]);
  f.select(old);
  const prior = ok(f.fetch([ref(old)], 'rationale-evidence')).items[0];
  assert.equal(prior.rationale.edges.length, 2);
  assert.equal(prior.rationale.sources.length, 3);
  const expanded = ok(f.fetch([ref(old)])).items[0];
  assert.equal(expanded.rationale.coverage, 'bounded-root-neighborhood');
  assert.equal(expanded.rationale.status, 'unassessed');
  assert.equal(expanded.rationale.edges.length, 3);
  assert.deepEqual(new Set(expanded.rationale.sources.map(source => source.memory.id)),
    new Set([old.id, reason.id, challenge.id, later.id]));
  assert.ok(expanded.rationale.edges.some(edge => edge.from === old.id && edge.to === later.id));
  assert.ok(expanded.rationale.edges.some(edge => edge.from === challenge.id && edge.to === reason.id));
  assert.ok(expanded.rationale.edges.every(edge => edge.interpretationStatus === 'model-proposed'));
  assert.ok(expanded.rationale.sources.every(source => source.memory.revision === 1 && source.receipts.length === 1));
  const recalled = ok(await f.recall());
  assert.equal(recalled.memories.length, 1);
  assert.deepEqual(recalled.memories[0], expanded);
  assert.deepEqual(f.calls.at(-1).input.candidates[0].rationale, expanded.rationale);
  assert.equal(ok(f.core.getRationale({ namespace, ...ref(old) })).edges.length, 2);
  fails(f.core.getRationale({ namespace, ...ref(old), view: 'root-neighborhood' }), 'invalid_input');
});

test('RN2 shared self-support is deduplicated and empty root returns bounded unassessed evidence', async t => {
  const f = fixture(t); const root = f.admit('The team chose A.', 'root');
  assert.deepEqual(ok(f.fetch([ref(root)])).items[0].rationale.edges, []);
  await f.link([ref(root)], [[0, 0, 'supports-decision']]);
  const view = ok(f.fetch([ref(root)])).items[0].rationale;
  assert.equal(view.edges.length, 1); assert.equal(view.sources.length, 1);
  assert.equal(view.coverage, 'bounded-root-neighborhood');
});

test('RN3 outgoing-only challenge does not label the selected root as needing reconfirmation', async t => {
  const f = fixture(t), root = f.admit('A price report was recorded.', 'root'),
    later = f.admit('The team later chose B.', 'later');
  await f.link([ref(root), ref(later)], [[0, 1, 'challenges-premise']]);
  const selected = ok(f.fetch([ref(root)])).items[0].rationale;
  assert.equal(selected.edges.length, 1);
  assert.equal(selected.edges[0].from, root.id);
  assert.equal(selected.edges[0].to, later.id);
  assert.equal(selected.status, 'unassessed');
  assert.equal(ok(f.fetch([ref(root)], 'rationale-evidence')).items[0].rationale.edges.length, 0);
});

test('RN1/6 current-only, qualification, cursor and namespace boundaries reject', async t => {
  const f = fixture(t), first = f.admit('One.', 'one'), second = f.admit('Two.', 'two');
  const refs = [ref(first), ref(second)];
  fails(f.fetch([ref(first)], undefined, { view: 'historical' }), 'invalid_input');
  fails(f.fetch([ref(first)], undefined, { includeQualification: true }), 'invalid_input');
  fails(await f.recall(undefined, { includeQualification: true }), 'invalid_input');
  assert.deepEqual(ok(f.fetch([ref(first)], undefined, { namespace: { ...namespace, ownerId: 'foreign' } })).invalidRefs,
    [{ memoryId: first.id, reason: 'not_found' }]);
  const page = ok(f.fetch(refs)); assert.ok(page.nextCursor);
  fails(f.fetch(refs, 'rationale-evidence', { cursor: page.nextCursor }), 'invalid_cursor');
  fails(f.fetch(refs, 'source-evidence', { cursor: page.nextCursor }), 'invalid_cursor');
  fails(f.fetch([ref(first)], undefined, { cursor: page.nextCursor }), 'invalid_cursor');
  assert.deepEqual(ok(f.fetch([{ memoryId: first.id, revision: first.revision + 1 }])).invalidRefs,
    [{ memoryId: first.id, reason: 'stale' }]);
  assert.equal(ok(f.fetch([ref(first)], 'source-evidence')).items[0].rationale, undefined);
});

test('RN6 neighborhood union fails whole six-source and ten-edge overflow', async t => {
  const f = fixture(t); const root = f.admit('Root.', 'root');
  const neighbors = Array.from({ length: 6 }, (_, i) => f.admit(`Neighbor ${i}.`, `n${i}`));
  for (const neighbor of neighbors.slice(0, 5)) await f.link([ref(root), ref(neighbor)], [[0, 1, 'supports-decision']]);
  assert.equal(ok(f.fetch([ref(root)])).items[0].rationale.sources.length, 6);
  await f.link([ref(root), ref(neighbors[5])], [[0, 1, 'supports-decision']]);
  fails(f.fetch([ref(root)]), 'rationale_limit');

  const g = fixture(t), base = g.admit('Root with many cited links.', 'base');
  const many = Array.from({ length: 4 }, (_, i) => ({ client: 'synthetic', sessionId: 'synthetic', eventId: `many${i}`,
    role: 'user', excerpt: `Distinct receipt ${i}.` }));
  const multi = ok(g.core.admit({ namespace, memory: { content: 'Multi.', kind: 'context' }, receipts: many })).memory;
  // Distinct receipt tuples permit eight incident proposals without changing endpoints.
  g.model.relate = () => ({ edges: Array.from({ length: 4 }, (_, i) => [
    { from: 0, to: 1, relation: 'supports-decision', fromReceipt: i, toReceipt: 0 },
    { from: 1, to: 0, relation: 'supports-decision', fromReceipt: 0, toReceipt: i },
  ]).flat() });
  ok(await g.core.reviewRationale({ namespace, refs: [ref(multi), ref(base)] }));
  // Per-root store cap prevents >10 incident edges, but a union can exceed it
  // when separate challenge-to-support edges enter decision context.
  const support = g.admit('Separate reason.', 'support');
  await g.link([ref(support), ref(base)], [[0, 1, 'supports-decision']]);
  const updateA = g.admit('Separate update A.', 'update-a');
  const updateB = g.admit('Separate update B.', 'update-b');
  await g.link([ref(updateA), ref(support)], [[0, 1, 'challenges-premise']]);
  await g.link([ref(updateB), ref(support)], [[0, 1, 'challenges-premise']]);
  fails(g.fetch([ref(base)]), 'rationale_limit');
});

test('RN6 byte/token bounds and mutable receipt/graph/count callback invalidate complete item', async t => {
  const f = fixture(t), root = f.admit('Root.', 'root'), linked = f.admit('Linked.', 'linked');
  await f.link([ref(linked), ref(root)], [[0, 1, 'supports-decision']]);
  const actual = ok(f.fetch([ref(root)]));
  f.model.countTokens = text => text.length;
  fails(f.fetch([ref(root)], undefined, { tokenBudget: JSON.stringify(actual).length - 1 }), 'context_item_too_large');
  const db = new DatabaseSync(f.path); t.after(() => db.close());
  let changed = false;
  f.model.countTokens = text => {
    if (!changed && text.includes('bounded-root-neighborhood')) {
      changed = true; db.prepare('UPDATE receipts SET excerpt = ? WHERE memory_id = ?').run('Tampered.', linked.id);
    }
    return 1;
  };
  fails(f.fetch([ref(root)]), 'revision_conflict');
});

test('RN6 serialized neighborhood ceiling rejects the entire item', async t => {
  const f = fixture(t), heavy = '\\'.repeat(780);
  const admitHeavy = i => ok(f.core.admit({ namespace, memory: { content: `Large source ${i}.`, kind: 'context' },
    receipts: Array.from({ length: 4 }, (_, receiptIndex) => ({ client: 'synthetic', sessionId: 'synthetic',
      eventId: `large-${i}-${receiptIndex}`, role: 'user', excerpt: heavy })) })).memory;
  const root = admitHeavy(0), neighbors = Array.from({ length: 5 }, (_, i) => admitHeavy(i + 1));
  for (const neighbor of neighbors) await f.link([ref(root), ref(neighbor)], [[0, 1, 'supports-decision']]);
  fails(f.fetch([ref(root)]), 'context_item_too_large');
  assert.equal(ok(f.fetch([ref(root)], 'source-evidence')).items[0].receipts.length, 4);
});

test('RN6 changed selected source or graph during model callbacks rejects rather than returning stale evidence', async t => {
  for (const stage of ['select', 'rank']) {
    const f = fixture(t), root = f.admit(`Old decision ${stage}.`, 'old'),
      linked = f.admit(`Separate reason ${stage}.`, 'reason');
    await f.link([ref(linked), ref(root)], [[0, 1, 'supports-decision']]);
    f.select(root);
    if (stage === 'select') f.model.select = ({ input }) => {
      ok(f.core.forget({ namespace, memoryId: linked.id, expectedRevision: linked.revision }));
      return { refs: input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')
        .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))
        .filter(item => item.memoryId === root.id)) };
    };
    else f.model.rank = async ({ input }) => {
      await f.link([ref(linked), ref(root)], [[0, 1, 'challenges-premise']]);
      return { refs: input.candidates.map(item => ({ namespaceIndex: item.namespaceIndex,
        memoryId: item.memory.id, revision: item.memory.revision })) };
    };
    const result = await f.recall();
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.ok(['index_revision_conflict', 'revision_conflict'].includes(result.error.code), result.error.code);
  }
});

test('RN6 counter-triggered graph mutation invalidates the full neighborhood after counting', async t => {
  const f = fixture(t), root = f.admit('Old root.', 'old'), later = f.admit('Later choice.', 'later');
  await f.link([ref(root), ref(later)], [[0, 1, 'supports-decision']]);
  let changed = false;
  f.model.countTokens = text => {
    if (!changed && text.includes('bounded-root-neighborhood')) {
      changed = true;
      ok(f.core.forget({ namespace, memoryId: later.id, expectedRevision: later.revision }));
    }
    return 1;
  };
  const result = f.fetch([ref(root)]);
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.ok(['cursor_stale', 'revision_conflict'].includes(result.error.code), result.error.code);
});
