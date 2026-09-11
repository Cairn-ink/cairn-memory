import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openMemoryStore } from '../index.mjs';
import { createMockRecallModel } from '../testing/mock-recall-model.mjs';

const namespace = { ownerId: 'supersession', scope: 'personal', projectId: null };
const receipt = (eventId) => ({ client: 'synthetic', sessionId: 'session', eventId, role: 'user', excerpt: `Evidence ${eventId}` });
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const error = (r, code) => assert.deepEqual(r, { ok: false, error: { code, retryable: false } });
const detail = (c, m) => ok(c.get({ namespace, memoryId: m.id }));
const epoch = (c) => ok(c.map({ namespace })).indexRevision;
const admit = (c, content, ns = namespace) => ok(c.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [receipt(content)] })).memory;
const input = (m, content = 'Monday') => ({ namespace, memoryId: m.id, expectedRevision: m.revision,
  replacement: { content, kind: 'fact' }, receipts: [receipt(content)] });
const snapshot = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
  .map(({ name }) => [name, db.prepare(`SELECT * FROM "${name}" ORDER BY rowid`).all()]);
function fixture(t, model = { countTokens: () => 1 }) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-supersession-')), 'memory.sqlite');
  const core = openMemoryCore({ path, model }); const db = new DatabaseSync(path);
  t.after(() => { core.close(); db.close(); });
  return { core, db, path };
}

test('B01/B02 explicit supersession preserves historical evidence and immutable directional receipt bindings across reopen', (t) => {
  const { core, db, path } = fixture(t);
  const old = admit(core, 'Friday'); const before = detail(core, old);
  assert.equal(Object.hasOwn(before, 'supersession'), false);
  const result = ok(core.supersede({ ...input(old), receipts: [receipt('Monday'), receipt('Monday-confirmation')] }));
  assert.deepEqual(Object.keys(result).sort(), ['deduplicated', 'indexRevision', 'memory', 'previous']);
  assert.equal(result.deduplicated, false);
  assert.deepEqual(result.previous, { id: old.id, revision: old.revision + 1 });
  assert.notEqual(result.memory.id, old.id);
  const successor = detail(core, result.memory); const history = detail(core, old);
  assert.deepEqual(history.receipts, before.receipts);
  assert.equal(history.memory.content, 'Friday'); assert.equal(history.memory.state, 'historical');
  assert.equal(successor.memory.state, 'active'); assert.equal(successor.memory.origin, 'explicit');
  assert.equal(successor.memory.confidence, 1); assert.equal(Object.hasOwn(successor, 'supersession'), false);
  assert.deepEqual({ ...history.supersession, receiptIds: [...history.supersession.receiptIds].sort() }, {
    previousRevision: old.revision,
    replacement: { memoryId: result.memory.id, revision: result.memory.revision, currentRevision: result.memory.revision, state: 'active' },
    receiptIds: successor.receipts.map((r) => r.id).sort(), evidenceAvailable: true,
  });
  const row = db.prepare('SELECT * FROM memory_supersessions').get();
  assert.ok(!JSON.stringify(row).includes('Friday')); assert.ok(!JSON.stringify(row).includes('Evidence'));
  const state = snapshot(db); error(core.supersede(input(old)), 'revision_conflict');
  error(core.supersede(input(result.previous)), 'memory_historical');
  assert.deepEqual(snapshot(db), state);
  core.close(); const reopened = openMemoryCore({ path }); t.after(() => reopened.close());
  assert.deepEqual(detail(reopened, old), history);
  assert.deepEqual(detail(reopened, result.memory), successor);
});

test('B01 failures reject unknown authority, stale, self, absent, foreign and suppressed replacements without writes', (t) => {
  const { core, db } = fixture(t); const old = admit(core, 'Friday');
  const suppressed = admit(core, 'Suppressed'); ok(core.forget({ namespace, memoryId: suppressed.id, expectedRevision: suppressed.revision }));
  const before = snapshot(db);
  const sparse = Array(1);
  for (const patch of [{ extra: true }, { replacement: { content: 'Monday', kind: 'fact', origin: 'explicit' } },
    { replacement: { content: 'x'.repeat(4001), kind: 'fact' } }, { receipts: sparse }, { receipts: [] },
    { receipts: Array(5).fill(receipt('x')) }, { receipts: [{ ...receipt('x'), forged: true }] }, { expectedRevision: 0 }]) {
    error(core.supersede({ ...input(old), ...patch }), 'invalid_input'); assert.deepEqual(snapshot(db), before);
  }
  for (const [patch, code] of [[{ expectedRevision: 99 }, 'revision_conflict'],
    [{ replacement: { content: ' ＦＲＩＤＡＹ ', kind: 'fact' } }, 'invalid_ref'],
    [{ replacement: { content: 'Suppressed', kind: 'fact' } }, 'memory_suppressed'],
    [{ memoryId: 'missing' }, 'memory_not_found'],
    [{ namespace: { ...namespace, ownerId: 'foreign' } }, 'memory_not_found'],
    [{ namespace: { ...namespace, scope: 'project', projectId: 'foreign' } }, 'memory_not_found']]) {
    error(core.supersede({ ...input(old), ...patch }), code); assert.deepEqual(snapshot(db), before);
  }
});

test('B01 incoming bound and late retirement failure roll back dedup receipts, links and epochs', (t) => {
  const { core, db } = fixture(t);
  const successor = admit(core, 'Monday');
  for (let i = 0; i < 5; i++) {
    const old = admit(core, `Old ${i}`);
    const result = ok(core.supersede({ ...input(old), receipts: [receipt(`source-${i}`)] }));
    assert.equal(result.deduplicated, true); assert.equal(result.memory.id, successor.id);
  }
  const sixth = admit(core, 'Old sixth'); const before = snapshot(db);
  error(core.supersede({ ...input(sixth), receipts: [receipt('sixth-source')] }), 'supersession_limit');
  assert.deepEqual(snapshot(db), before);
  db.exec(`CREATE TRIGGER synthetic_retirement_failure BEFORE UPDATE OF currentness ON memories
    WHEN NEW.currentness='historical' BEGIN SELECT RAISE(ABORT,'synthetic late failure'); END`);
  error(core.supersede(input(sixth, 'Novel successor')), 'storage_error');
  assert.deepEqual(snapshot(db), before);
  db.exec('DROP TRIGGER synthetic_retirement_failure');
  ok(core.supersede(input(sixth, 'Novel successor')));
});

test('B02/B04 successor changes never reactivate predecessors and unavailable evidence is explicit', (t) => {
  for (const action of ['correct', 'forget', 'supersede', 'receipt']) {
    const { core } = fixture(t); const old = admit(core, `Friday ${action}`);
    const replacement = ok(core.supersede(input(old))).memory;
    const original = detail(core, old).supersession;
    if (action === 'correct') ok(core.correct({ namespace, memoryId: replacement.id, expectedRevision: replacement.revision,
      content: 'Tuesday', kind: 'fact', receipt: receipt('Tuesday') }));
    if (action === 'forget') ok(core.forget({ namespace, memoryId: replacement.id, expectedRevision: replacement.revision }));
    if (action === 'supersede') ok(core.supersede(input(replacement, 'Tuesday')));
    if (action === 'receipt') ok(core.admit({ namespace, memory: { content: 'Monday', kind: 'fact' }, receipts: [receipt('extra')] }));
    const history = detail(core, old);
    assert.equal(history.memory.state, 'historical'); assert.equal(history.supersession.previousRevision, old.revision);
    if (action === 'forget') assert.deepEqual(history.supersession, { previousRevision: old.revision,
      replacement: null, receiptIds: [], evidenceAvailable: false });
    else {
      assert.equal(history.supersession.replacement.revision, original.replacement.revision);
      assert.equal(history.supersession.replacement.state, action === 'supersede' ? 'historical' : 'active');
      assert.ok(history.supersession.replacement.currentRevision > original.replacement.currentRevision);
      assert.equal(history.supersession.evidenceAvailable, action !== 'correct');
      assert.deepEqual(history.supersession.receiptIds, action === 'correct' ? [] : original.receiptIds);
    }
    error(core.admit({ namespace, memory: { content: `Friday ${action}`, kind: 'fact' }, receipts: [receipt('replay')] }), 'memory_suppressed');
    error(core.correct({ namespace, memoryId: old.id, expectedRevision: old.revision, content: 'Edit', kind: 'fact', receipt: receipt('edit') }), 'revision_conflict');
    error(core.correct({ namespace, memoryId: old.id, expectedRevision: history.memory.revision, content: 'Edit', kind: 'fact', receipt: receipt('edit') }), 'memory_historical');
    ok(core.forget({ namespace, memoryId: old.id, expectedRevision: history.memory.revision }));
    error(core.get({ namespace, memoryId: old.id }), 'memory_not_found');
  }
});

test('B03 corrupt foreign successor inspection cannot disclose identifiers or claim available evidence', (t) => {
  const { core, db } = fixture(t); const old = admit(core, 'Friday');
  ok(core.supersede(input(old)));
  const foreign = admit(core, 'Foreign body', { ...namespace, ownerId: 'foreign' });
  db.prepare('UPDATE memory_supersessions SET replacement_memory_id=?').run(foreign.id);
  const inspected = detail(core, old);
  assert.deepEqual(inspected.supersession, { previousRevision: old.revision, replacement: null, receiptIds: [], evidenceAvailable: false });
  assert.ok(!JSON.stringify(inspected).includes(foreign.id));
});

test('B03 historical records stay inspectable but leave fetch, map, legacy reads, conflict and rebuilt projections', (t) => {
  const { core, db, path } = fixture(t); const old = admit(core, 'Friday');
  const opposed = ok(core.admit({ namespace, memory: { content: 'Uncertain deadline', kind: 'fact' }, receipts: [receipt('uncertain')],
    conflictHints: [{ memoryId: old.id, expectedRevision: old.revision, relation: 'contradicts' }] })).memory;
  const placed = ok(core.applyPlacement({ namespace, expectedIndexRevision: epoch(core),
    expectedMemoryRevisions: [{ memoryId: old.id, revision: old.revision }],
    proposal: { items: [{ memoryId: old.id, parentIds: [], newL1: { title: 'Friday-derived', parentL2Ids: [] } }] } }));
  const currentOld = detail(core, old).memory;
  const replacement = ok(core.supersede(input(currentOld))).memory;
  const listed = ok(core.list({ namespace })).memories.find((m) => m.id === old.id);
  assert.equal(listed.state, 'historical');
  for (const forbidden of ['content', 'receipts', 'supersession']) assert.equal(Object.hasOwn(listed, forbidden), false);
  for (const foreign of [{ ...namespace, ownerId: 'foreign' }, { ...namespace, scope: 'project', projectId: 'foreign' }]) {
    error(core.get({ namespace: foreign, memoryId: old.id }), 'memory_not_found');
    assert.deepEqual(ok(core.list({ namespace: foreign })).memories, []);
  }
  assert.deepEqual(detail(core, old).placements, []); assert.deepEqual(detail(core, opposed).conflicts, []);
  const fetched = ok(core.fetch({ namespace, refs: [{ memoryId: old.id, revision: currentOld.revision + 1 }] }));
  assert.deepEqual(fetched.items, []); assert.equal(fetched.invalidRefs[0].reason, 'not_found');
  for (const purpose of ['recall', 'classification']) {
    const mapped = ok(core.map({ namespace, purpose }));
    assert.ok(!JSON.stringify(mapped).includes(old.id)); assert.ok(!JSON.stringify(mapped).includes('Friday-derived'));
  }
  error(core.applyPlacement({ namespace, expectedIndexRevision: epoch(core),
    expectedMemoryRevisions: [{ memoryId: old.id, revision: currentOld.revision + 1 }],
    proposal: { items: [{ memoryId: old.id, parentIds: [placed.createdMocs[0].id] }] } }), 'memory_not_found');
  const beforeConflict = snapshot(db);
  error(core.admit({ namespace, memory: { content: 'New conflict', kind: 'fact' }, receipts: [receipt('new-conflict')],
    conflictHints: [{ memoryId: old.id, expectedRevision: currentOld.revision + 1, relation: 'contradicts' }] }), 'memory_not_found');
  assert.deepEqual(snapshot(db), beforeConflict);
  const legacy = openMemoryStore({ path }); t.after(() => legacy.close());
  const scope = legacy.scope({ ownerId: namespace.ownerId });
  assert.equal(scope.get(old.id), null);
  assert.ok(!scope.list().some((m) => m.id === old.id)); assert.deepEqual(scope.search('Friday'), []);
  let cursor; const revision = epoch(core);
  do { const page = ok(core.rebuildIndex({ namespace, expectedIndexRevision: revision, limit: 1, ...(cursor ? { cursor } : {}) })); cursor = page.nextCursor; } while (cursor);
  assert.equal(db.prepare('SELECT count(*) n FROM index_memories WHERE id=?').get(old.id).n, 0);
  assert.equal(detail(core, replacement).memory.state, 'active');
});

test('B02/B04 dedup binds only selected receipts, survives filing and reports partial evidence truthfully', (t) => {
  const { core, db } = fixture(t);
  const successor = admit(core, 'Monday');
  ok(core.admit({ namespace, memory: { content: 'Monday', kind: 'fact' }, receipts: [receipt('unselected')] }));
  const old = admit(core, 'Friday');
  const result = ok(core.supersede({ ...input(old), receipts: [receipt('Monday'), receipt('selected-new')] }));
  assert.equal(result.memory.id, successor.id); assert.equal(result.deduplicated, true);
  const bound = detail(core, old).supersession;
  const selected = detail(core, successor).receipts.filter((r) => ['Monday', 'selected-new'].includes(r.eventId));
  assert.deepEqual([...bound.receiptIds].sort(), selected.map((r) => r.id).sort());
  assert.equal(bound.replacement.revision, result.memory.revision);
  ok(core.applyPlacement({ namespace, expectedIndexRevision: epoch(core),
    expectedMemoryRevisions: [{ memoryId: successor.id, revision: result.memory.revision }],
    proposal: { items: [{ memoryId: successor.id, parentIds: [], newL1: { title: 'New deadline', parentL2Ids: [] } }] } }));
  const filed = detail(core, old).supersession;
  assert.deepEqual(filed.receiptIds, bound.receiptIds); assert.equal(filed.evidenceAvailable, true);
  assert.equal(filed.replacement.revision, bound.replacement.revision);
  assert.equal(filed.replacement.currentRevision, detail(core, successor).memory.revision);
  db.prepare('DELETE FROM receipts WHERE id=?').run(selected[0].id);
  const partial = detail(core, old).supersession;
  assert.deepEqual(partial.receiptIds, [selected[1].id]); assert.equal(partial.evidenceAvailable, false);
  assert.equal(partial.replacement.revision, bound.replacement.revision);
});

test('B03 historical inspection remains available during an unpublished index rebuild', (t) => {
  const { core, path } = fixture(t); const old = admit(core, 'Friday');
  ok(core.supersede(input(old))); admit(core, 'Another current memory');
  const before = detail(core, old);
  const staged = ok(core.rebuildIndex({ namespace, expectedIndexRevision: epoch(core), limit: 1 }));
  assert.equal(staged.state, 'staged'); error(core.map({ namespace }), 'index_unavailable');
  assert.deepEqual(detail(core, old), before);
  const reopened = openMemoryCore({ path }); t.after(() => reopened.close());
  assert.deepEqual(detail(reopened, old), before);
});

test('B03 retirement during actual recall ranking rejects stale final content', async (t) => {
  let start; let release;
  const ready = new Promise((resolve) => { start = resolve; });
  const model = createMockRecallModel({ select: [({ input }) => ({ refs: input.maps.flatMap((m) => m.items.filter((i) => i.type === 'unfiled')
    .map((i) => ({ namespaceIndex: m.namespaceIndex, ...i.ref }))) })], rank: [() => new Promise((resolve) => { release = resolve; start(); })] });
  const { core, path } = fixture(t, model); const old = admit(core, 'Friday');
  const pending = core.recall({ readSet: [namespace], query: 'Deadline' }); await ready;
  const other = openMemoryCore({ path }); t.after(() => other.close()); ok(other.supersede(input(old)));
  release({ refs: [{ namespaceIndex: 0, memoryId: old.id, revision: old.revision }] });
  error(await pending, 'revision_conflict');
});

test('B04 completed capture replay and new inferred extraction cannot restore retired content', async (t) => {
  let calls = 0;
  const { core } = fixture(t, { contextWindow: 8192, countTokens: () => 1,
    extract: async () => { calls++; return { items: [{ content: 'Friday', kind: 'fact', confidence: 1, sourceIndices: [0] }] }; } });
  const captured = { namespace, client: 'synthetic', sessionId: 'session', eventId: 'capture', messages: [{ id: 'message', role: 'user', content: 'Friday' }] };
  const old = ok(await core.capture(captured)).admission.memories[0];
  ok(core.supersede(input(old))); const before = detail(core, old);
  assert.deepEqual(ok(await core.capture(captured)), { duplicate: true, memoryIds: [old.id], suppressedCount: 0 });
  assert.equal(calls, 1);
  const next = ok(await core.capture({ ...captured, eventId: 'new-event' }));
  assert.deepEqual(next.admission.memories, []); assert.equal(next.admission.suppressedCount, 1);
  assert.deepEqual(detail(core, old), before);
});

test('B06 two real processes compete for one predecessor and only one transition commits', { timeout: 15000 }, async (t) => {
  const { core, db, path } = fixture(t); const old = admit(core, 'Friday');
  const program = `import {openMemoryCore} from ${JSON.stringify(new URL('../contract.mjs', import.meta.url).href)};
    const core=openMemoryCore({path:process.argv[1]}); process.send('ready');
    process.once('message',()=>{process.send(core.supersede(JSON.parse(process.argv[2]))); core.close(); process.disconnect();});`;
  const workers = ['Monday', 'Tuesday'].map((content) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', program, path, JSON.stringify(input(old, content))],
      { env: { NODE_NO_WARNINGS: '1' }, stdio: ['ignore', 'ignore', 'pipe', 'ipc'] });
    t.after(() => child.kill());
    let isReady = false; let hasResult = false;
    const ready = new Promise((resolve, reject) => {
      child.on('message', (m) => { if (m === 'ready') { isReady = true; resolve(); } });
      child.once('error', reject);
      child.once('exit', (code) => { if (!isReady) reject(new Error(`worker exited before ready: ${code}`)); });
    });
    const result = new Promise((resolve, reject) => {
      child.on('message', (m) => { if (m !== 'ready') { hasResult = true; resolve(m); } });
      child.once('error', reject);
      child.once('exit', (code) => { if (!hasResult) reject(new Error(`worker exited before result: ${code}`)); });
    });
    // The result can fail during startup before the barrier awaits it.
    result.catch(() => {});
    return { child, ready, result };
  });
  await Promise.all(workers.map((w) => w.ready)); workers.forEach((w) => w.child.send('go'));
  const results = await Promise.all(workers.map((w) => w.result));
  assert.equal(results.filter((r) => r.ok).length, 1);
  error(results.find((r) => !r.ok), 'revision_conflict');
  assert.equal(db.prepare('SELECT count(*) n FROM memory_supersessions').get().n, 1);
  assert.equal(ok(core.list({ namespace })).memories.length, 2);
});
