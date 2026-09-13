import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../index.mjs';
import { recallMemories } from '../recall.mjs';

const namespace = { ownerId: 'synthetic-source-scan', scope: 'personal', projectId: null };
const ok = r => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const refs = candidates => candidates.map(({ namespaceIndex, memory }) => ({ namespaceIndex, memoryId: memory.id, revision: memory.revision }));
function fixture(t) {
  const calls = [];
  const model = { contextWindow: 8192, countTokens: () => 1,
    select: request => { calls.push(request); return { refs: [] }; },
    rank: request => { calls.push(request); return { refs: refs(request.input.candidates).slice(0, request.input.limit) }; } };
  const core = openMemoryCore({ path: join(mkdtempSync(join(tmpdir(), 'cairn-source-scan-')), 'memory.sqlite'), model });
  t.after(() => core.close());
  const admit = (content, ns = namespace) => ok(core.admit({ namespace: ns, memory: { content, kind: 'context' },
    receipts: [{ client: 'synthetic', sessionId: 'synthetic', eventId: content, role: 'user', excerpt: content }] })).memory;
  const recall = extra => core.recall({ readSet: [namespace], query: '我選了哪個工具？理由有什麼需要重新確認？',
    contextMode: 'source-evidence', selectionMode: 'bounded-source-scan', ...extra });
  return { core, model, calls, admit, recall };
}

test('BS1 complete small MOC sends both contradictory Chinese sources to rank, not summary select', async t => {
  const f = fixture(t);
  const sources = ['我決定用青石筆記寫日記，因為不用註冊。', '後來確認青石筆記必須註冊登入才能寫日記，尚未改選。'];
  sources.forEach(source => f.admit(source));
  const result = ok(await f.recall());
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].input.candidates.length, 2);
  assert.deepEqual(f.calls[0].input.candidates.flatMap(c => c.receipts.map(r => r.excerpt)).sort(), sources.map(s => s.normalize('NFKC')).sort());
  assert.equal(result.memories.length, 2);
  assert.deepEqual(result.selection, { mode: 'bounded-source-scan', strategy: 'complete-map', semanticCoverage: 'unassessed' });
});

test('BS2 omitted mode preserves model selection and exact legacy result shape', async t => {
  const f = fixture(t); f.admit('A current note.');
  const result = ok(await f.core.recall({ readSet: [namespace], query: 'note', contextMode: 'source-evidence' }));
  assert.equal(f.calls.length, 1); assert.ok(f.calls[0].input.maps);
  assert.deepEqual(result.memories, []); assert.equal(Object.hasOwn(result, 'selection'), false);
});

test('BS3 null, unknown and non-source modes reject without model work', async t => {
  const f = fixture(t);
  for (const selectionMode of [null, undefined, '', 'all', true]) {
    assert.equal((await f.recall({ selectionMode })).error.code, 'invalid_input');
  }
  assert.equal((await f.core.recall({ readSet: [namespace], query: 'note', selectionMode: 'bounded-source-scan' })).error.code, 'invalid_input');
  assert.equal(f.calls.length, 0);
});

test('BS4 empty complete map makes no model calls and preserves empty evidence', async t => {
  const f = fixture(t); const result = ok(await f.recall());
  assert.deepEqual(result.memories, []); assert.equal(f.calls.length, 0);
  assert.equal(result.selection.strategy, 'complete-map');
});

test('BS5 thirteen references fall back instead of silently truncating to twelve', async t => {
  const f = fixture(t); for (let i = 0; i < 13; i++) f.admit(`Synthetic item ${i}.`);
  const result = ok(await f.recall());
  assert.equal(result.selection.strategy, 'model-selected'); assert.equal(f.calls.length, 1);
  assert.equal(f.calls[0].input.maps[0].items.length, 13); assert.deepEqual(result.memories, []);
});

test('BS6 two namespaces preserve original indices and reject stale unranked source after model callback', async t => {
  const f = fixture(t); const project = { ...namespace, scope: 'project', projectId: 'synthetic' };
  const personal = f.admit('Personal source.'); f.admit('Project source.', project);
  f.admit('Foreign owner source must not reach rank.', { ...namespace, ownerId: 'another-synthetic-owner' });
  const result = ok(await f.recall({ readSet: [project, namespace] }));
  assert.deepEqual(f.calls[0].input.candidates.map(c => c.namespaceIndex), [0, 1]);
  assert.equal(result.memories.length, 2);
  f.model.rank = ({ input }) => {
    ok(f.core.forget({ namespace, memoryId: personal.id, expectedRevision: personal.revision }));
    return { refs: refs(input.candidates.slice(0, 1)) };
  };
  assert.equal((await f.recall({ readSet: [project, namespace] })).error.code, 'revision_conflict');
});

test('BS7 exactly twelve references reach rank without silently narrowing to output limit', async t => {
  const f = fixture(t); for (let i = 0; i < 12; i++) f.admit(`Bounded item ${i}.`);
  const result = ok(await f.recall({ limit: 1 }));
  assert.equal(result.selection.strategy, 'complete-map'); assert.equal(result.memories.length, 1);
  assert.equal(f.calls.length, 1); assert.equal(f.calls[0].input.candidates.length, 12);
});

test('BS8 a partial first page falls back even with only one visible reference', async () => {
  let maps = 0, selects = 0;
  const result = await recallMemories({ selectionMode: 'bounded-source-scan', contextMode: 'source-evidence',
    readSet: [namespace], query: 'Synthetic note', limit: 6,
    model: { contextWindow: 8192, countTokens: () => 1,
      select: () => { selects++; return { refs: [] }; }, rank: () => assert.fail('no selected refs') },
    map: () => ({ ok: true, value: { items: [{ type: 'unfiled', ref: { memoryId: 'synthetic-note', revision: 1 } }],
      exhausted: ++maps === 2, nextCursor: maps === 2 ? null : 'synthetic-cursor' } }),
    fetch: () => assert.fail('no selected refs'), finalize: () => [],
  });
  assert.equal(selects, 2); assert.equal(maps, 2); assert.equal(result.selection.strategy, 'model-selected');
});

test('BS9 rank input overflow fails without dropping sources or calling rank', async t => {
  const f = fixture(t); f.admit('First source.'); f.admit('Second source.');
  f.model.countTokens = text => {
    try { return JSON.parse(text).input?.candidates ? 6001 : 1; }
    catch { return 1; }
  };
  assert.equal((await f.recall()).error.code, 'context_budget_exceeded');
  assert.equal(f.calls.length, 0);
});

test('BS10 source correction during rank invalidates the complete-map result', async t => {
  const f = fixture(t); const memory = f.admit('The original source.');
  f.model.rank = ({ input }) => {
    ok(f.core.correct({ namespace, memoryId: memory.id, expectedRevision: memory.revision,
      content: 'The corrected source.', kind: 'context', receipt: {
        client: 'synthetic', sessionId: 'synthetic', eventId: 'correction', role: 'user', excerpt: 'The corrected source.' } }));
    return { refs: refs(input.candidates) };
  };
  assert.equal((await f.recall({ contextMode: 'rationale-evidence' })).error.code, 'revision_conflict');
});
