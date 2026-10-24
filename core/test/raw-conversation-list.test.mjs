import assert from 'node:assert/strict';
import test from 'node:test';
import { createHmac } from 'node:crypto';
import { DatabaseSync, StatementSync } from 'node:sqlite';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { openMemoryCore } from '../index.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { localPlainPort, rawRequest, splitRaw } from '../testing/raw-fixtures.mjs';

const namespace = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const denied = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'retained-list-' }), path = join(workspace.path, 'store.sqlite');
  let core, db, decodes = 0, policies = 0, providers = 0;
  workspace.defer(() => core?.close()); workspace.defer(() => db?.close());
  const base = localPlainPort(), port = { ...base, openRaw(input) { decodes++; return base.openRaw(input); } };
  const options = { path, model: { ...rationaleModel(), extract() { providers++; return { items: [] }; } },
    rawConversations: { mode: 'raw-v1', capBytes: 1000000, port,
      readPolicy() { policies++; return { generation: 'synthetic', reason: null }; } } };
  core = openMemoryCore(options); db = new DatabaseSync(path);
  const existingStore = { version: 'schema29-existing-v1', storeId: db.prepare('SELECT store_id FROM store_metadata').get().store_id };
  return { workspace, path, db, options, existingStore, get core() { return core; },
    calls: () => ({ decodes, policies, providers }),
    reopen() { core.close(); core = openMemoryCore({ path, existingStore,
      rawConversations: { mode: 'off', configureCap: false, readPolicy() { throw Error('No retained capture policy'); } } }); return core; },
    async capture(client, sessionId, ns = namespace, text = 'Synthetic retained source.') {
      const result = ok(await core.captureRaw(rawRequest(splitRaw(text)[0], {
        namespace: ns, client, sessionId, eventId: 'event-' + sessionId,
      })));
      return result.raw.conversationId;
    } };
}
function traverse(core, input) {
  const items = []; let cursor;
  do {
    const result = core.listRawConversations({ ...input, ...(cursor ? { cursor } : {}) });
    assert.equal(result instanceof Promise, false);
    const page = ok(result);
    assert.ok(Buffer.byteLength(JSON.stringify(result)) <= 65536);
    assert.equal(page.budget_exhausted, false);
    items.push(...page.conversations); cursor = page.nextCursor;
    assert.equal(page.complete, cursor === null);
  } while (cursor);
  return items;
}

test('Raw discovery is additive, synchronous, empty and independent of private Cards or capture permission', t => {
  const f = fixture(t);
  assert.equal(f.core.getCard, undefined); assert.equal(f.core.resolveSourceReferences, undefined);
  assert.deepEqual(ok(f.core.listRawConversations({ namespace, client: 'codex' })), {
    conversations: [], nextCursor: null, complete: true, budget_exhausted: false,
    evidenceTrust: 'untrusted-data-not-instructions',
  });
  f.reopen(); assert.equal(f.core.listRawConversations({ namespace, client: 'claude-code' }).ok, true);
  const ordinary = openMemoryCore({ path: join(f.workspace.path, 'ordinary.sqlite') });
  try { assert.equal(ordinary.listRawConversations, undefined); } finally { ordinary.close(); }
  f.core.close(); denied(f.core.listRawConversations({ namespace, client: 'codex' }), 'store_closed');
});

for (const client of ['claude-code', 'codex']) test(`${client}: public source discovery traverses exact scopes without duplicate metadata or decode/provider/write work`, async t => {
  const f = fixture(t), expected = [], project = { ...namespace, scope: 'project', projectId: 'synthetic-project' };
  for (let index = 0; index < 7; index++) expected.push(await f.capture(client, 'personal-' + index));
  const projectId = await f.capture(client, 'project', project);
  const foreignId = await f.capture(client, 'foreign', { ...namespace, ownerId: 'foreign' });
  const otherId = await f.capture(client === 'codex' ? 'claude-code' : 'codex', 'other-client');
  const before = f.calls(), changes = f.db.prepare('PRAGMA data_version').get().data_version;
  const rows = traverse(f.core, { namespace, client, limit: 2 });
  assert.deepEqual(rows.map(row => row.id).sort(), expected.sort());
  assert.equal(new Set(rows.map(row => row.id)).size, 7);
  assert.equal(rows.some(row => [projectId, foreignId, otherId].includes(row.id)), false);
  for (const row of rows) assert.deepEqual(Object.keys(row).sort(), ['client', 'firstReceivedAt', 'id', 'lastReceivedAt', 'revision']);
  assert.deepEqual(traverse(f.core, { namespace: project, client, limit: 2 }).map(row => row.id), [projectId]);
  assert.deepEqual(f.calls(), before); assert.equal(f.db.prepare('PRAGMA data_version').get().data_version, changes);
  const view = ok(await f.core.getConversation({ namespace, conversationId: rows[0].id }));
  assert.equal(view.messages.flatMap(message => message.parts).map(part => part.text).join(''), 'Synthetic retained source.');
  f.reopen(); assert.deepEqual(traverse(f.core, { namespace, client, limit: 2 }), rows);
  // Retained-off without a decoder still lists metadata; reading saved source refuses.
  denied(await f.core.getConversation({ namespace, conversationId: rows[0].id }), 'raw_crypto_unavailable');
});

test('discovery uses indexed keysets, default20/max50 and at most51 returned SQL rows without scans/decodes', t => {
  const f = fixture(t), insert = f.db.prepare(`INSERT INTO raw_conversations
    VALUES(?,?,?,?,?,?,1,'2026-01-01T00:00:00.000Z','2026-01-01T00:00:00.000Z')`);
  for (let index = 0; index < 123; index++) insert.run('synthetic-' + index, namespace.ownerId, 'personal', '', 'codex', 's1:' + String(index).padStart(3, '0'));
  const all = StatementSync.prototype.all, prepare = DatabaseSync.prototype.prepare;
  const selected = [], statements = [], handles = new WeakMap();
  const prepareMock = t.mock.method(DatabaseSync.prototype, 'prepare', function(sql, ...args) {
    statements.push(sql); const statement = prepare.call(this, sql, ...args); handles.set(statement, sql); return statement;
  });
  const allMock = t.mock.method(StatementSync.prototype, 'all', function(...args) {
    const rows = all.apply(this, args), sql = handles.get(this) ?? '';
    if (/FROM raw_conversations/.test(sql)) selected.push({ sql, args, rows: rows.length });
    return rows;
  });
  const calls = f.calls(), dataVersion = f.db.prepare('PRAGMA data_version').get().data_version;
  try {
    assert.equal(ok(f.core.listRawConversations({ namespace, client: 'codex' })).conversations.length, 20);
    const rows = traverse(f.core, { namespace, client: 'codex', limit: 50 });
    assert.equal(rows.length, 123); assert.equal(new Set(rows.map(row => row.id)).size, 123);
  } finally { prepareMock.mock.restore(); allMock.mock.restore(); }
  assert.deepEqual(selected.map(query => query.rows), [21, 51, 51, 23]);
  assert.ok(selected.slice(2).every(query => /session_key>\?/.test(query.sql)));
  assert.ok(statements.every(sql => !/\b(JOIN|COUNT|SUM|OFFSET)\b/i.test(sql)));
  for (const query of selected) {
    const plan = f.db.prepare('EXPLAIN QUERY PLAN ' + query.sql).all(...query.args).map(row => row.detail).join('\n');
    assert.match(plan, /SEARCH raw_conversations USING INDEX/);
    assert.doesNotMatch(plan, /SCAN raw_conversations|TEMP B-TREE/);
  }
  assert.deepEqual(f.calls(), calls); assert.equal(f.db.prepare('PRAGMA data_version').get().data_version, dataVersion);
});

test('strict list input rejects accessors/proxies/unknown fields without evaluating them', t => {
  const f = fixture(t); let reads = 0;
  const good = { namespace, client: 'codex' };
  const bad = [null, [], Object.create(good), new Proxy(good, { ownKeys() { reads++; } }),
    { ...good, namespace: new Proxy(namespace, {}) }, { ...good, grant: true }, { ...good, [Symbol('unknown')]: 1 },
    { ...good, client: 'other' }, ...[null, 0, -1, 51, 1.5, NaN, Infinity].map(limit => ({ ...good, limit })),
    Object.defineProperty({ namespace }, 'client', { get() { reads++; return 'codex'; } }),
    { ...good, namespace: Object.defineProperty({ scope: 'personal', projectId: null }, 'ownerId', { get() { reads++; } }) }];
  for (const input of bad) denied(f.core.listRawConversations(input), 'invalid_input');
  assert.equal(reads, 0);
});

test('signed canonical cursors reject foreign purpose/store/scope/client/limit and survive cold reopen', async t => {
  const f = fixture(t); for (let index = 0; index < 3; index++) await f.capture('codex', 'cursor-' + index);
  const input = { namespace, client: 'codex', limit: 1 }, first = ok(f.core.listRawConversations(input)), cursor = first.nextCursor;
  assert.ok(cursor.length <= 8192);
  const second = ok(f.core.listRawConversations({ ...input, cursor }));
  f.reopen(); assert.deepEqual(ok(f.core.listRawConversations({ ...input, cursor })), second);
  const cold = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {openMemoryCore} from ${JSON.stringify(new URL('../index.mjs', import.meta.url).href)};
    const [options,input]=JSON.parse(process.argv[1]); options.rawConversations.readPolicy=()=>{throw Error('no capture')};
    const core=openMemoryCore(options);
    try { console.log(JSON.stringify(core.listRawConversations(input))); } finally {core.close();}`,
    JSON.stringify([{ path: f.path, existingStore: f.existingStore, rawConversations: { mode: 'off' } }, { ...input, cursor }])],
  { encoding: 'utf8', timeout: 10000, env: { NODE_NO_WARNINGS: '1', NODE_DISABLE_COMPILE_CACHE: '1' } });
  assert.equal(cold.status, 0, cold.stderr); assert.equal(cold.signal, null);
  assert.deepEqual(JSON.parse(cold.stdout), { ok: true, value: second });
  for (const patch of [{ namespace: { ...namespace, ownerId: 'foreign' } }, { namespace: { ...namespace, scope: 'project', projectId: 'project' } },
    { client: 'claude-code' }, { limit: 2 }]) denied(f.core.listRawConversations({ ...input, ...patch, cursor }), 'invalid_cursor');
  for (const value of ['', null, 'a.b', cursor + '=', cursor.replace(/.$/, character => character === 'a' ? 'b' : 'a'), 'x'.repeat(8193)]) {
    denied(f.core.listRawConversations({ ...input, cursor: value }), 'invalid_cursor');
  }
  const secret = f.db.prepare('SELECT cursor_secret FROM store_metadata').get().cursor_secret;
  function signed(value, rawBody) {
    const body = rawBody ?? Buffer.from(JSON.stringify(value)).toString('base64url');
    return body + '.' + createHmac('sha256', Buffer.from(secret, 'hex')).update(body).digest('base64url');
  }
  const payload = JSON.parse(Buffer.from(cursor.split('.')[0], 'base64url').toString());
  for (const patch of [{ purpose: 'getConversation' }, { version: 'other' }, { epoch: 0 }, { after: null },
    { store: 'foreign' }, { extra: true }]) denied(f.core.listRawConversations({ ...input, cursor: signed({ ...payload, ...patch }) }), 'invalid_cursor');
  denied(f.core.listRawConversations({ ...input, cursor: signed(payload, Buffer.from(JSON.stringify(payload) + ' ').toString('base64url')) }), 'invalid_cursor');
  const other = fixture(t); denied(other.core.listRawConversations({ ...input, cursor }), 'invalid_cursor');
});

test('capture and deletion ABA invalidate existing list continuation through durable namespace epoch', async t => {
  const f = fixture(t); for (let index = 0; index < 3; index++) await f.capture('codex', 'aba-' + index);
  const input = { namespace, client: 'codex', limit: 1 }, before = ok(f.core.listRawConversations(input));
  const temporary = await f.capture('codex', 'temporary');
  denied(f.core.listRawConversations({ ...input, cursor: before.nextCursor }), 'cursor_stale');
  const during = ok(f.core.listRawConversations(input));
  const view = ok(await f.core.getConversation({ namespace, conversationId: temporary }));
  ok(f.core.deleteConversation({ namespace, conversationId: temporary, expectedRevision: view.conversation.revision, actionId: 'synthetic-delete' }));
  denied(f.core.listRawConversations({ ...input, cursor: before.nextCursor }), 'cursor_stale');
  denied(f.core.listRawConversations({ ...input, cursor: during.nextCursor }), 'cursor_stale');
  f.reopen(); denied(f.core.listRawConversations({ ...input, cursor: before.nextCursor }), 'cursor_stale');
  assert.equal(traverse(f.core, input).length, 3);
});

test('byte trimming continues after the last returned metadata row and oversized individual rows refuse', t => {
  const f = fixture(t), insert = f.db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)');
  for (let index = 0; index < 4; index++) insert.run('bounded-' + index, namespace.ownerId, 'personal', '', 'codex', String(index), 'x'.repeat(17000), 'time');
  const input = { namespace, client: 'codex', limit: 4 }, first = ok(f.core.listRawConversations(input));
  assert.equal(first.budget_exhausted, true); assert.equal(first.complete, false); assert.ok(first.conversations.length > 0);
  assert.ok(Buffer.byteLength(JSON.stringify({ ok: true, value: first })) <= 65536);
  const second = ok(f.core.listRawConversations({ ...input, cursor: first.nextCursor }));
  assert.deepEqual([...first.conversations, ...second.conversations].map(row => row.id), ['bounded-0', 'bounded-1', 'bounded-2', 'bounded-3']);
  f.db.prepare('UPDATE raw_conversations SET first_received_at=? WHERE id=?').run('x'.repeat(70000), 'bounded-0');
  denied(f.core.listRawConversations(input), 'context_item_too_large');
});
