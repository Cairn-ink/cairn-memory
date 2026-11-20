import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { completed, fixture, localPlainPort, ns, ok, request, splitRaw, usage }
  from '../testing/raw-capture-fixtures.mjs';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const boundary = { namespace: ns, client: 'claude-code' };
const source = request(splitRaw('Synthetic copper telescope.')[0], boundary);
const next = request(splitRaw('Synthetic follow-up.', { id: 'next', ordinal: 2 })[0], boundary);
const unseenKey = `s1:${'a'.repeat(64)}`;
const storedKey = (db, id) => db.prepare('SELECT session_key FROM raw_conversations WHERE id=?').get(id).session_key;
const fenceRows = db => db.prepare('SELECT * FROM raw_session_fences ORDER BY owner_id,scope,project_id,client,session_key').all();
const refused = code => ({ ok: false, error: { code, retryable: false } });

function hostFixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'raw-search-host-' });
  const path = join(workspace.path, 'store.sqlite'), port = localPlainPort();
  const core = openMemoryCore({ path, rawSearch: false, rawConversations: {
    mode: 'raw-v1', capBytes: 200000000, interpretation: 'host', port,
    readPolicy: () => ({ generation: 'synthetic', reason: null }),
  } });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  return { workspace, path, port, core, db };
}

test('stored-key fence blocks further host capture and removes the conversation from Raw search', async t => {
  installRawSearchTestClock(t);
  const f = hostFixture(t), byId = hostFixture(t);
  const { raw } = ok(await f.core.captureRaw(source));
  ok(await byId.core.captureRaw(source));
  const sessionKey = storedKey(f.db, raw.conversationId);
  const search = await searchFixture(f);
  await search.maintain();
  assert.equal((await search.search({ query: 'copper' })).candidates.length, 1);

  ok(f.core.fenceSession({ ...boundary, sessionKey }));
  ok(byId.core.fenceSession({ ...boundary, sessionId: source.sessionId }));
  const idRefusal = await byId.core.captureRaw(next);
  assert.deepEqual(idRefusal, refused('conversation_deleted'));
  assert.deepEqual(await f.core.captureRaw(next), idRefusal);
  assert.deepEqual((await search.search({ query: 'copper' })).candidates, []);
});

test('negative control: passing the stored key as sessionId leaves the original session open', async t => {
  const f = hostFixture(t);
  const { raw } = ok(await f.core.captureRaw(source));
  const sessionKey = storedKey(f.db, raw.conversationId);
  ok(f.core.fenceSession({ ...boundary, sessionId: sessionKey }));
  const [fence] = fenceRows(f.db);
  assert.notEqual(fence.session_key, sessionKey);
  const later = ok(await f.core.captureRaw(next));
  assert.equal(later.raw.conversationId, raw.conversationId);
  assert.equal(later.raw.parts[0].saved, true);
});

test('stored-key and session-ID fences write the same boundary and release the same pending reservation', async t => {
  const part = splitRaw('Synthetic pending reservation.', { size: 16 })[0];
  const effects = async byStoredKey => {
    const f = hostFixture(t);
    const { raw } = ok(await f.core.captureRaw(request(part, boundary)));
    const sessionKey = storedKey(f.db, raw.conversationId);
    const pendingMessage = f.db.prepare('SELECT assembly_state,reason,reserved_bytes FROM raw_messages WHERE conversation_id=?');
    const before = pendingMessage.get(raw.conversationId);
    assert.equal(before.assembly_state, 'pending');
    assert.ok(before.reserved_bytes > 0);
    const input = byStoredKey ? { sessionKey } : { sessionId: source.sessionId };
    const result = ok(f.core.fenceSession({ ...boundary, ...input }));
    assert.deepEqual(result, { closedMessages: 1, releasedBytes: before.reserved_bytes });
    const rows = fenceRows(f.db);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].session_key, sessionKey);
    const after = { ...pendingMessage.get(raw.conversationId) };
    assert.deepEqual(after, { assembly_state: 'closed', reason: 'capture_barrier', reserved_bytes: 0 });
    const currentUsage = usage(f.core);
    assert.equal(currentUsage.reservedBytes, 0);
    // Each store hashes the session with its own identity.
    return { row: { ...rows[0], session_key: source.sessionId }, result, after, usage: currentUsage };
  };
  const byId = await effects(false);
  assert.deepEqual(await effects(true), byId);
});

test('fence validation requires exactly one session field and an exact stored-key format', t => {
  const { core, db } = hostFixture(t);
  for (const [name, fields] of [
    ['both keys', { sessionId: source.sessionId, sessionKey: unseenKey }],
    ['neither key', {}],
    ['non-string key', { sessionKey: 1 }],
    ['wrong prefix', { sessionKey: `s2:${'a'.repeat(64)}` }],
    ['wrong length', { sessionKey: unseenKey.slice(0, -1) }],
    ['uppercase hex', { sessionKey: `s1:A${'a'.repeat(63)}` }],
    ['trailing space', { sessionKey: `${unseenKey} ` }],
    ['trailing newline', { sessionKey: `${unseenKey}\n` }],
    ['raw session id', { sessionKey: source.sessionId }],
    ['extra field', { sessionKey: unseenKey, extra: true }],
  ]) assert.deepEqual(core.fenceSession({ ...boundary, ...fields }), refused('invalid_input'), name);
  assert.deepEqual(fenceRows(db), []);
});

test('stored-key and session-ID fences validate and isolate namespace and client in the same way', async t => {
  const f = hostFixture(t);
  const { raw } = ok(await f.core.captureRaw(source));
  const sessionKey = storedKey(f.db, raw.conversationId), sessionId = source.sessionId;
  for (const [change, code] of [
    [{ namespace: { ...ns, scope: 'other' } }, 'invalid_namespace'],
    [{ client: 'other' }, 'invalid_input'],
  ]) {
    assert.deepEqual(f.core.fenceSession({ ...boundary, ...change, sessionId }), refused(code));
    assert.deepEqual(f.core.fenceSession({ ...boundary, ...change, sessionKey }), refused(code));
  }
  for (const change of [{ namespace: { ...ns, ownerId: 'other-owner' } }, { client: 'codex' }]) {
    const byId = ok(f.core.fenceSession({ ...boundary, ...change, sessionId }));
    assert.deepEqual(ok(f.core.fenceSession({ ...boundary, ...change, sessionKey })), byId);
  }
  assert.equal(ok(await f.core.captureRaw(next)).raw.conversationId, raw.conversationId);
});

test('a fresh, unseen stored key gets a tombstone just like an unseen session ID', t => {
  const f = hostFixture(t);
  const byId = ok(f.core.fenceSession({ ...boundary, sessionId: 'unseen-session' }));
  assert.deepEqual(ok(f.core.fenceSession({ ...boundary, sessionKey: unseenKey })), byId);
  assert.deepEqual(byId, { closedMessages: 0, releasedBytes: 0 });
  const rows = fenceRows(f.db);
  assert.equal(rows.length, 2);
  assert.deepEqual({ ...rows.find(row => row.session_key === unseenKey) }, {
    owner_id: ns.ownerId, scope: ns.scope, project_id: '', client: boundary.client, session_key: unseenKey,
  });
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_conversations').get().n, 0);
});

test('the stored key in an Episode-derived Memory receipt fences its Raw conversation', async t => {
  const f = fixture(t, { kind: 'episode', deletion: true });
  const input = request(splitRaw('Synthetic Episode evidence.', { occurredAt: new Date().toISOString() })[0], boundary, 'episode');
  const output = await f.core.captureRaw(input);
  const [memory] = completed(output).admission.memories;
  assert.ok(memory);
  const receipt = f.db.prepare('SELECT session_id FROM receipts WHERE memory_id=?').get(memory.id);
  assert.equal(receipt.session_id, storedKey(f.db, output.value.raw.conversationId));

  ok(f.core.fenceSession({ ...boundary, sessionKey: receipt.session_id }));
  const later = request(splitRaw('Synthetic late Episode evidence.', {
    id: 'next', ordinal: 2, occurredAt: new Date().toISOString(),
  })[0], boundary, 'episode');
  assert.deepEqual(await f.core.captureRaw(later), refused('conversation_deleted'));
});
