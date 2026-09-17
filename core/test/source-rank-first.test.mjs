import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { recallMemories } from '../recall.mjs';

const namespace = { ownerId: 'synthetic-source-first', scope: 'personal', projectId: null };
const mode = { contextMode: 'rationale-neighborhood-evidence',
  sourceProjection: 'neighborhood-sources-v1', rankingMode: 'source-evidence-first-v1' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const fails = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });

function fixture(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-source-first-')), 'memory.sqlite');
  let eligible = [], ranked = [], onRank = () => {};
  const seen = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    relate: () => ({ edges: [{ from: 0, to: 1, relation: 'supports-decision', fromReceipt: 0, toReceipt: 0 }] }),
    select: ({ input }) => ({ refs: input.maps.flatMap(map => map.items
      .filter(item => item.type === 'unfiled' && eligible.includes(item.ref.memoryId))
      .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }),
    rank: async ({ input, system }) => { seen.push({ input: structuredClone(input), system }); await onRank();
      return { refs: input.candidates.filter(item => ranked.includes(item.memory.id))
        .map(item => ({ namespaceIndex: item.namespaceIndex,
          memoryId: item.memory.id, revision: item.memory.revision })) }; } };
  const core = openMemoryCore({ path, model }); t.after(() => core.close());
  const admit = (name, extra = {}) => ok(core.admit({ namespace,
    memory: { content: `Interpretation ${name}.`, kind: 'decision' },
    receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: name,
      role: 'user', excerpt: `Original ${name}.` }], ...extra })).memory;
  const link = async (from, to) => ok(await core.reviewRationale({ namespace, refs: [ref(from), ref(to)] }));
  const recall = patch => core.recall({ readSet: [namespace], query: 'Original good?', ...mode, ...patch });
  return { path, core, model, seen, admit, link, recall,
    choose: (candidates, selected) => { eligible = candidates.map(item => item.id); ranked = selected.map(item => item.id); },
    onRank: callback => { onRank = callback; } };
}

test('SRF1 invalid opt-in combinations fail before model callbacks', async t => {
  const f = fixture(t); f.admit('one'); let callbacks = 0;
  f.model.select = () => { callbacks++; return { refs: [] }; };
  f.model.rank = () => { callbacks++; return { refs: [] }; };
  for (const patch of [
    { rankingMode: 'unknown' }, { rankingMode: null }, { sourceProjection: undefined },
    { contextMode: 'source-evidence' }, { contextMode: undefined },
    { selectionMode: 'bounded-source-scan' }, { includeQualification: true },
    { readSet: [namespace, { ...namespace, scope: 'project', projectId: 'another' }] },
  ]) fails(await f.recall(patch), 'invalid_input');
  assert.equal(callbacks, 0);
  assert.deepEqual(ok(await f.recall({ includeQualification: false })).memories, []);
  assert.ok(callbacks > 0);
});

test('SRF2/4/5 unselected oversized neighborhood cannot prevent source-only rank and good-root projection', async t => {
  const f = fixture(t), good = f.admit('good'), bad = f.admit('bad');
  const neighbors = Array.from({ length: 6 }, (_, i) => f.admit(`bad-neighbor-${i}`));
  for (const neighbor of neighbors) await f.link(neighbor, bad);
  assert.equal(ok(f.core.fetch({ namespace, refs: [ref(good)], contextMode: mode.contextMode })).items.length, 1);
  fails(f.core.fetch({ namespace, refs: [ref(bad)], contextMode: mode.contextMode }), 'rationale_limit');
  f.choose([good, bad], [good]);
  fails(await f.recall({ contextMode: mode.contextMode, sourceProjection: mode.sourceProjection,
    rankingMode: undefined }), 'invalid_input');
  fails(await f.core.recall({ readSet: [namespace], query: 'Original good?',
    contextMode: mode.contextMode, sourceProjection: mode.sourceProjection }), 'rationale_limit');
  assert.equal(f.seen.length, 0, 'the ordinary route fails before rank');
  const result = ok(await f.recall());
  assert.equal(f.seen.length, 1);
  assert.equal(f.seen[0].system,
    readFileSync(new URL('../prompts/recall-rank-source-evidence.md', import.meta.url), 'utf8'));
  assert.deepEqual(new Set(f.seen[0].input.candidates.map(item => item.memory.id)), new Set([good.id, bad.id]));
  assert.ok(f.seen[0].input.candidates.every(item => !Object.hasOwn(item, 'rationale')));
  assert.equal(result.rankingMode, mode.rankingMode);
  assert.equal(result.sourceProjection, mode.sourceProjection);
  assert.deepEqual(result.memories.map(item => item.memory.id), [good.id]);
  assert.equal(JSON.stringify(result).includes('Interpretation'), false);
  assert.equal(JSON.stringify(result).includes('supports-decision'), false);
  f.choose([good, bad], [bad]);
  fails(await f.recall(), 'rationale_limit');
  assert.equal(f.seen.length, 2, 'bad root reached rank before explicit failure');
});

test('SRF3 unselected candidate source and revision changes fail at final read', async t => {
  for (const mutation of ['source', 'revision']) {
    const f = fixture(t), good = f.admit(`good-${mutation}`), bad = f.admit(`bad-${mutation}`);
    f.choose([good, bad], [good]);
    f.onRank(() => {
      if (mutation === 'revision') ok(f.core.forget({ namespace, memoryId: bad.id, expectedRevision: bad.revision }));
      else { const db = new DatabaseSync(f.path);
        try { assert.equal(db.prepare('UPDATE receipts SET excerpt = ? WHERE memory_id = ?')
          .run('Tampered.', bad.id).changes, 1); }
        finally { db.close(); } }
    });
    const result = await f.recall();
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.ok(['revision_conflict', 'index_revision_conflict', 'storage_error'].includes(result.error.code), JSON.stringify(result));
    assert.equal(f.seen.length, 1);
  }
});

test('SRF3 namespace epoch and selected-link/source drift fail closed', async t => {
  for (const mutation of ['epoch', 'link', 'selected-source']) {
    const f = fixture(t), good = f.admit(`good-${mutation}`), other = f.admit(`other-${mutation}`);
    f.choose([good], [good]);
    f.onRank(async () => {
      if (mutation === 'epoch') f.admit('new-unselected');
      else if (mutation === 'link') { await f.link(other, good);
        assert.ok(ok(f.core.getRationale({ namespace, ...ref(good) })).edges.some(edge => edge.from === other.id)); }
      else { const db = new DatabaseSync(f.path);
        try { assert.equal(db.prepare('UPDATE receipts SET excerpt = ? WHERE memory_id = ?')
          .run('Tampered.', good.id).changes, 1); }
        finally { db.close(); } }
    });
    const result = await f.recall();
    assert.equal(result.ok, false, JSON.stringify(result));
    assert.ok(['revision_conflict', 'index_revision_conflict', 'storage_error'].includes(result.error.code), JSON.stringify(result));
    assert.equal(f.seen.length, 1);
    assert.ok(other.id);
  }
});

test('SRF4/5 selected-root union overflow and empty rank preserve strict projection', async t => {
  const f = fixture(t), roots = [f.admit('root-a'), f.admit('root-b')];
  const neighbors = Array.from({ length: 5 }, (_, i) => f.admit(`union-${i}`));
  for (const [index, neighbor] of neighbors.entries()) await f.link(neighbor, roots[index < 3 ? 0 : 1]);
  const sourceSets = roots.map(root => ok(f.core.fetch({ namespace, refs: [ref(root)],
    contextMode: mode.contextMode })).items[0].rationale.sources.map(source => source.memory.id));
  assert.deepEqual(sourceSets.map(sources => sources.length), [4, 3]);
  assert.equal(new Set(sourceSets.flat()).size, 7);
  f.choose(roots, roots);
  fails(await f.recall(), 'context_item_too_large');
  assert.equal(f.seen.length, 1);
  f.choose(roots, []);
  const empty = ok(await f.recall());
  assert.deepEqual(empty.memories, []);
  assert.equal(empty.rankingMode, mode.rankingMode);
  assert.equal(empty.coverage, 'complete');
});

test('SRF3 orchestration makes no model or token-counter callback after authoritative finalize', async () => {
  let finalized = false, callbacksAfter = 0;
  const item = { memory: { id: 'selected', revision: 1 }, receipts: [{ id: 'receipt' }] };
  const model = { contextWindow: 8192,
    countTokens: () => { if (finalized) callbacksAfter++; return 1; },
    select: () => { if (finalized) callbacksAfter++; return { refs: [
      { namespaceIndex: 0, memoryId: 'selected', revision: 1 }] }; },
    rank: ({ input }) => { if (finalized) callbacksAfter++;
      assert.ok(input.candidates.every(candidate => !Object.hasOwn(candidate, 'rationale')));
      return { refs: [{ namespaceIndex: 0, memoryId: 'selected', revision: 1 }] }; } };
  const result = await recallMemories({ model, readSet: [namespace], query: 'Original selected?', limit: 1,
    rankingMode: 'source-evidence-first-v1', contextMode: 'rationale-neighborhood-evidence',
    map: () => ({ ok: true, value: { items: [{ type: 'unfiled', ref: { memoryId: 'selected', revision: 1 } }],
      exhausted: true, nextCursor: null } }),
    fetch: () => ({ ok: true, value: { items: [item], invalidRefs: [], exhausted: true } }),
    finalize: (candidates, selected) => { assert.deepEqual(selected, [0]); finalized = true;
      return [candidates[0].item]; } });
  assert.deepEqual(result.memories, [item]);
  assert.equal(finalized, true);
  assert.equal(callbacksAfter, 0);
});
