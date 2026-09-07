import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { openMemoryStore } from '../index.mjs';

const ns = { ownerId: 'reader', scope: 'project', projectId: 'atlas' };
const personal = { ownerId: 'reader', scope: 'personal', projectId: null };
const foreign = { ...ns, ownerId: 'visitor' };
const receipt = (eventId = 'message-1', excerpt = 'Prefer diagrams when explaining protocols.') => ({
  client: 'contract-test', sessionId: 'session-1', eventId, role: 'user', excerpt,
});
const admission = (content = 'Prefer diagrams when explaining protocols.', event = 'message-1') => ({
  namespace: ns, memory: { content, kind: 'preference' }, receipts: [receipt(event, content)],
});
function ok(result) { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; }
function error(result, code) {
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, code);
  assert.equal(typeof result.error.retryable, 'boolean');
  assert.deepEqual(Object.keys(result).sort(), ['error', 'ok']);
  assert.deepEqual(Object.keys(result.error).sort(), ['code', 'retryable']);
}
function fixture(t) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-contract-')), 'memory.sqlite');
  const core = openMemoryCore({ path });
  t.after(() => core.close());
  return { core, path };
}
const metadataKeys = ['id', 'namespace', 'kind', 'origin', 'confidence', 'revision',
  'state', 'filing', 'receiptCount', 'createdAt', 'updatedAt'].sort();

test('explicit admission and inspection have closed content-safe projections', (t) => {
  const { core } = fixture(t);
  const saved = ok(core.admit(admission()));
  assert.equal(saved.indexRevision, 2);
  assert.equal(saved.memory.revision, 1);
  assert.equal(saved.deduplicated, false);
  const page = ok(core.list({ namespace: ns }));
  assert.equal(page.exhausted, true);
  assert.equal(page.nextCursor, null);
  assert.equal(page.memories.length, 1);
  assert.deepEqual(Object.keys(page.memories[0]).sort(), metadataKeys);
  assert.deepEqual(page.memories[0].namespace, ns);
  assert.deepEqual(page.memories[0].filing, { status: 'unfiled' });
  assert.equal(page.memories[0].state, 'active');
  assert.equal(page.memories[0].receiptCount, 1);
  assert.equal(JSON.stringify(page).includes(admission().memory.content), false);
  const detail = ok(core.get({ namespace: ns, memoryId: saved.memory.id }));
  assert.deepEqual(Object.keys(detail.memory).sort(), [...metadataKeys, 'content'].sort());
  assert.equal(detail.memory.content, admission().memory.content);
  assert.equal(detail.memory.origin, 'explicit');
  assert.equal(detail.memory.confidence, 1);
  assert.deepEqual(detail.placements, []);
  assert.deepEqual(detail.conflicts, []);
  assert.equal(detail.receipts[0].excerpt, receipt().excerpt);
  assert.deepEqual(Object.keys(detail.receipts[0]).sort(),
    ['id', 'client', 'sessionId', 'eventId', 'role', 'excerpt', 'createdAt'].sort());
  assert.ok(detail.receipts[0].id);
});

test('receipt batch is atomic, exact retry is a no-op, and new sources invalidate revisions', (t) => {
  const { core, path } = fixture(t);
  const input = { ...admission(), receipts: [receipt('one'), receipt('two')] };
  const first = ok(core.admit(input));
  assert.deepEqual(ok(core.admit(input)), { ...first, deduplicated: true });
  const next = ok(core.admit({ ...input, receipts: [receipt('three'), receipt('four')] }));
  assert.equal(next.memory.id, first.memory.id);
  assert.equal(next.memory.revision, first.memory.revision + 1);
  assert.equal(next.indexRevision, first.indexRevision + 1);
  assert.equal(ok(core.get({ namespace: ns, memoryId: first.memory.id })).receipts.length, 4);
  const bad = { ...admission('A separate claim'), receipts: [receipt('valid'), { ...receipt(), role: 'tool' }] };
  assert.equal(core.admit(bad).ok, false);
  assert.equal(ok(core.list({ namespace: ns })).memories.length, 1);
  const db = new DatabaseSync(path);
  t.after(() => db.close());
  db.exec(`CREATE TRIGGER reject_last_source BEFORE INSERT ON receipts
    WHEN NEW.event_id = 'reject' BEGIN SELECT RAISE(ABORT, 'private fault text'); END;`);
  const failed = core.admit({ ...admission('Another claim'), receipts: [receipt('accepted'), receipt('reject')] });
  assert.equal(failed.ok, false);
  assert.equal(JSON.stringify(failed).includes('private fault text'), false);
  assert.equal(ok(core.list({ namespace: ns })).memories.length, 1);
  assert.equal(ok(core.admit(input)).indexRevision, next.indexRevision);
});

test('namespace identity and unknown inputs fail before mutation', (t) => {
  const { core } = fixture(t);
  for (const value of [{ ...ns, scope: 'personal' }, { ...personal, projectId: 'atlas' },
    { ownerId: 'reader', projectId: 'atlas' }, { ...ns, projectId: '' },
    { ...ns, ownerId: ' reader ' }, { ...ns, extra: true }]) {
    assert.equal(core.admit({ ...admission(), namespace: value }).ok, false);
  }
  for (const extra of [{ surprise: true }, { conflictHints: [] }, { origin: 'agent-inferred' }]) {
    error(core.admit({ ...admission(), ...extra }), 'invalid_input');
  }
  error(core.admit({ ...admission(), memory: { ...admission().memory, origin: 'agent-inferred' } }), 'invalid_input');
  assert.equal(core.admit({ ...admission(), receipts: [] }).ok, false);
  assert.equal(core.admit({ ...admission(), receipts: Array.from({ length: 5 }, (_, i) => receipt(String(i))) }).ok, false);
  assert.equal(ok(core.list({ namespace: ns })).memories.length, 0);
  const saved = ok(core.admit(admission()));
  for (const namespace of [foreign, personal, { ...ns, projectId: 'other' }]) {
    error(core.get({ namespace, memoryId: saved.memory.id }), 'memory_not_found');
    assert.deepEqual(ok(core.list({ namespace })).memories, []);
    const absent = ok(core.forget({ namespace, memoryId: saved.memory.id, expectedRevision: 1 }));
    assert.deepEqual(absent, { forgotten: false, indexRevision: 1 });
    error(core.correct({ namespace, memoryId: saved.memory.id, expectedRevision: 1,
      content: 'Try pictures', kind: 'preference', receipt: receipt() }), 'memory_not_found');
  }
});

test('list traverses beyond forty records with deterministic equal-time keysets', (t) => {
  const { core, path } = fixture(t);
  const ids = Array.from({ length: 47 }, (_, i) => ok(core.admit(admission(`Independent note ${i}`, `e${i}`))).memory.id);
  // Synthetic setup pins a timestamp tie before issuing any cursor.
  const db = new DatabaseSync(path);
  db.prepare('UPDATE memories SET updated_at = ?').run('2025-01-01T00:00:00.000Z');
  db.close();
  const seen = [];
  let cursor;
  do {
    const page = ok(core.list({ namespace: ns, limit: 7, ...(cursor ? { cursor } : {}) }));
    assert.ok(page.memories.length <= 7);
    seen.push(...page.memories.map((m) => m.id));
    assert.equal(page.exhausted, page.nextCursor === null);
    cursor = page.nextCursor;
  } while (cursor);
  assert.deepEqual(seen, ids.sort());
  assert.deepEqual(ok(core.list({ namespace: ns, statuses: ['filed'] })).memories, []);
  assert.equal(core.list({ namespace: ns, statuses: [] }).ok, false);
  assert.equal(core.list({ namespace: ns, statuses: ['unfiled', 'unfiled'] }).ok, false);
});

test('receipt paging returns distinct stable IDs and rejects scope/operation/limit/tamper reuse', (t) => {
  const { core } = fixture(t);
  const saved = ok(core.admit({ ...admission(), receipts: [receipt('one'), receipt('two'), receipt('three')] }));
  const memoryId = saved.memory.id;
  const first = ok(core.get({ namespace: ns, memoryId, receiptLimit: 1 }));
  assert.equal(first.exhausted, false);
  const all = [...first.receipts];
  let receiptCursor = first.nextReceiptCursor;
  while (receiptCursor) {
    const next = ok(core.get({ namespace: ns, memoryId, receiptLimit: 1, receiptCursor }));
    all.push(...next.receipts);
    receiptCursor = next.nextReceiptCursor;
  }
  assert.equal(new Set(all.map((r) => r.id)).size, 3);
  assert.deepEqual(all.map((r) => r.eventId).sort(), ['one', 'three', 'two']);
  assert.deepEqual(all, ok(core.get({ namespace: ns, memoryId })).receipts);
  error(core.get({ namespace: ns, memoryId, receiptLimit: 2, receiptCursor: first.nextReceiptCursor }), 'invalid_cursor');
  error(core.list({ namespace: ns, limit: 1, cursor: first.nextReceiptCursor }), 'invalid_cursor');
  ok(core.admit(admission('A second memory')));
  error(core.get({ namespace: ns, memoryId, receiptLimit: 1,
    receiptCursor: first.nextReceiptCursor }), 'cursor_stale');
  const page = ok(core.list({ namespace: ns, limit: 1 }));
  error(core.list({ namespace: foreign, limit: 1, cursor: page.nextCursor }), 'invalid_cursor');
  error(core.list({ namespace: ns, limit: 1, statuses: ['filed'], cursor: page.nextCursor }), 'invalid_cursor');
  const other = openMemoryCore({ path: ':memory:' });
  t.after(() => other.close());
  error(other.list({ namespace: ns, limit: 1, cursor: page.nextCursor }), 'invalid_cursor');
  for (const cursor of ['garbage', page.nextCursor + 'x', 'x'.repeat(20_000)]) {
    error(core.list({ namespace: ns, limit: 1, cursor }), 'invalid_cursor');
  }
});

test('every legacy mutation invalidates only its namespace cursors; no-ops preserve them', (t) => {
  const { core, path } = fixture(t);
  const legacy = openMemoryStore({ path });
  t.after(() => legacy.close());
  const scope = legacy.scope({ ownerId: ns.ownerId, projectId: ns.projectId });
  const first = ok(core.admit(admission()));
  ok(core.admit(admission('Keep tests local')));
  const page = () => ok(core.list({ namespace: ns, limit: 1 }));
  const use = (cursor) => core.list({ namespace: ns, limit: 1, cursor });
  const c1 = page().nextCursor;
  ok(core.admit({ ...admission('A private visitor preference'), namespace: foreign }));
  ok(use(c1));
  scope.remember({ ...admission().memory, receipt: receipt() });
  ok(use(c1));
  scope.remember({ ...admission().memory, receipt: receipt('another') });
  error(use(c1), 'cursor_stale');
  const c2 = page().nextCursor;
  const current = scope.get(first.memory.id);
  assert.throws(() => scope.correct(current.id, { content: 'Use arrows', receipt: receipt() }, 1));
  ok(use(c2));
  const corrected = scope.correct(current.id, { content: 'Use arrows', receipt: receipt() }, current.revision);
  error(use(c2), 'cursor_stale');
  const c3 = page().nextCursor;
  scope.forget(corrected.id, corrected.revision);
  error(use(c3), 'cursor_stale');
});

test('identical source payloads have different stable receipt IDs for different memories', (t) => {
  const { core } = fixture(t);
  const left = ok(core.admit(admission())).memory.id;
  const right = ok(core.admit({ ...admission('Prefer state diagrams.'), receipts: [receipt()] })).memory.id;
  const sourceId = (memoryId) => ok(core.get({ namespace: ns, memoryId })).receipts[0].id;
  assert.notEqual(sourceId(left), sourceId(right));
  assert.equal(sourceId(left), sourceId(left));
});

test('correction/forget preserve identity and suppression, stale CAS leaves no partial state', (t) => {
  const { core, path } = fixture(t);
  const saved = ok(core.admit(admission()));
  const original = ok(core.get({ namespace: ns, memoryId: saved.memory.id }));
  const replacement = { namespace: ns, memoryId: saved.memory.id, expectedRevision: 1,
    content: 'Use numbered steps for protocol explanations.', kind: 'instruction',
    receipt: receipt('correction', 'Use numbered steps for protocol explanations.') };
  const corrected = ok(core.correct(replacement));
  assert.equal(corrected.memory.id, saved.memory.id);
  assert.equal(corrected.memory.revision, 2);
  assert.deepEqual(Object.keys(corrected.memory).sort(), [...metadataKeys, 'content'].sort());
  assert.equal(corrected.memory.content, replacement.content);
  assert.equal(corrected.indexRevision, 3);
  const detail = ok(core.get({ namespace: ns, memoryId: saved.memory.id }));
  assert.equal(detail.receipts.length, 1);
  assert.notEqual(detail.receipts[0].id, original.receipts[0].id);
  error(core.correct(replacement), 'revision_conflict');
  error(core.forget({ namespace: ns, memoryId: saved.memory.id, expectedRevision: 1 }), 'revision_conflict');
  error(core.admit(admission()), 'memory_suppressed');
  const forgotten = ok(core.forget({ namespace: ns, memoryId: saved.memory.id, expectedRevision: 2 }));
  assert.deepEqual(forgotten, { forgotten: true, indexRevision: 4 });
  assert.deepEqual(ok(core.forget({ namespace: ns, memoryId: saved.memory.id, expectedRevision: 2 })),
    { forgotten: false, indexRevision: 4 });
  core.close();
  const reopened = openMemoryCore({ path });
  t.after(() => reopened.close());
  error(reopened.get({ namespace: ns, memoryId: saved.memory.id }), 'memory_not_found');
  error(reopened.admit(admission()), 'memory_suppressed');
  error(reopened.admit(admission(replacement.content)), 'memory_suppressed');
});

test('receipt cursor and stable IDs survive separate-process restart without credentials', (t) => {
  const { core, path } = fixture(t);
  const memoryId = ok(core.admit({ ...admission(), receipts: [receipt('a'), receipt('b')] })).memory.id;
  const first = ok(core.get({ namespace: ns, memoryId, receiptLimit: 1 }));
  const second = ok(core.get({ namespace: ns, memoryId, receiptLimit: 1, receiptCursor: first.nextReceiptCursor }));
  core.close();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import {openMemoryCore} from ${JSON.stringify(new URL('../contract.mjs', import.meta.url).href)};
    const core = openMemoryCore({path:process.argv[1]});
    console.log(JSON.stringify(core.get(JSON.parse(process.argv[2])))); core.close();
  `, path, JSON.stringify({ namespace: ns, memoryId, receiptLimit: 1, receiptCursor: first.nextReceiptCursor })],
  { env: {}, encoding: 'utf8' });
  assert.equal(child.status, 0, child.stderr);
  assert.deepEqual(ok(JSON.parse(child.stdout)), second);
});

test('two connections cannot overwrite one memory revision and failures do not stale cursors', (t) => {
  const { core, path } = fixture(t);
  const other = openMemoryCore({ path });
  t.after(() => other.close());
  const memoryId = ok(core.admit(admission())).memory.id;
  ok(core.admit(admission('Another topic')));
  const before = ok(core.list({ namespace: ns, limit: 1 }));
  ok(other.correct({ namespace: ns, memoryId, expectedRevision: 1, content: 'Use sequence charts',
    kind: 'preference', receipt: receipt('new') }));
  error(core.forget({ namespace: ns, memoryId, expectedRevision: 1 }), 'revision_conflict');
  error(core.list({ namespace: ns, limit: 1, cursor: before.nextCursor }), 'cursor_stale');
  const after = ok(core.list({ namespace: ns, limit: 1 }));
  const db = new DatabaseSync(path);
  db.exec(`CREATE TRIGGER abort_source BEFORE INSERT ON receipts
    BEGIN SELECT RAISE(ABORT, 'synthetic failure'); END;`);
  assert.equal(core.correct({ namespace: ns, memoryId, expectedRevision: 2, content: 'Changed but rolled back',
    kind: 'preference', receipt: receipt('failed') }).ok, false);
  db.close();
  ok(core.list({ namespace: ns, limit: 1, cursor: after.nextCursor }));
  assert.equal(ok(core.get({ namespace: ns, memoryId })).memory.content, 'Use sequence charts');
});

test('closed core methods fail with stable error envelopes', (t) => {
  const { core } = fixture(t);
  core.close();
  core.close();
  error(core.list({ namespace: ns }), 'store_closed');
  error(core.admit(admission()), 'store_closed');
});

test('a temporary database lock is retryable and never leaks raw storage details', (t) => {
  const { core, path } = fixture(t);
  const db = new DatabaseSync(path);
  db.exec('BEGIN EXCLUSIVE');
  try {
    const result = core.admit(admission());
    error(result, 'storage_busy');
    assert.equal(result.error.retryable, true);
  } finally { db.exec('ROLLBACK'); db.close(); }
  assert.equal(ok(core.list({ namespace: ns })).memories.length, 0);
  assert.equal(ok(core.admit(admission())).indexRevision, 2);
});
