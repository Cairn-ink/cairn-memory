import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Client, InMemoryTransport } from '@modelcontextprotocol/client';
import { openMemoryCore } from '../../../core/index.mjs';
import { defaultRawOptions } from '../../../core/local-defaults.mjs';
import { safetyFixture, ns, ok, receipt, readSqliteFixture, copySqliteFixture, quiescence } from '../../../core/testing/content-safety-s2h-fixture.mjs';
import { migrateReceiptEventTime } from '../../../core/content-safety-migration.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { cardHost } from '../../../core/testing/raw-source-fixtures.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createCairnServer } from '../server.mjs';
import { contextCall } from './context-support.mjs';

async function connect(t, server) {
  t.after(() => server.close());
  assert.equal(await server.contextCounterReady, true);
  const client = new Client({ name:'synthetic-default-store', version:'1' });
  t.after(() => client.close());
  const [a,b] = InMemoryTransport.createLinkedPair();
  await server.connect(a); await client.connect(b);
  return client;
}

test('MCP defaults retain submitted Raw while --no-raw leaves capture Memory-only', async t => {
  const workspace = createTestWorkspace(t);
  for (const enabled of [true, false]) {
    const path = join(workspace.path, String(enabled)+'.sqlite');
    const server = createCairnServer({ path, namespace:ns, client:'codex', model:rationaleModel(),
      captureQualification:'source-bound-v2', ...(enabled ? {} : { raw:false }) });
    const client = await connect(t, server);
    ok(await contextCall(client, 'capture_memory', { batchId:'event', messages:[{ role:'user', content:'Synthetic cobalt telescope' }] }));
    const db = new DatabaseSync(path);
    try {
      assert.equal(db.prepare("SELECT count(*) n FROM sqlite_schema WHERE name='raw_parts'").get().n, enabled ? 1 : 0);
      if (enabled) assert.equal(db.prepare('SELECT count(*) n FROM raw_parts WHERE saved=1').get().n, 1);
    } finally { db.close(); }
    await client.close(); await server.close();
  }
});

for (const base of [18,23]) for (const attested of [false,true]) test(`Raw-incapable ${attested ? 'attested' : 'safety'} base ${base} opens Memory-only, preserves bytes, serves reads and closes`, async t => {
  const f = safetyFixture(t, base);
  if (attested) {
    copySqliteFixture(f.path, f.backupPath);
    await migrateReceiptEventTime({ path:f.path, backupPath:f.backupPath, expected:{ storeId:f.storeId, base }, quiescence });
  } else await f.migrate();
  const writer = openMemoryCore({ path:f.path });
  const memory = ok(writer.admit({ namespace:ns, memory:{ content:'Synthetic cobalt telescope', kind:'fact' }, receipts:[receipt('synthetic')] })).memory;
  await writer.close();
  const before = readSqliteFixture(f.path);
  const closed = [], nativeClose = DatabaseSync.prototype.close;
  const closeMock = t.mock.method(DatabaseSync.prototype, 'close', function() { closed.push(this); return nativeClose.call(this); });
  const core = openMemoryCore({ path:f.path, raw:true });
  t.after(() => core.close());
  assert.equal(closed.length, 1, 'the refused Raw attempt must close before retry');
  assert.equal(closed[0].isOpen, false);
  assert.equal(core.captureRaw, undefined);
  assert.equal(ok(await core.getRawSearchStatus({ namespace:ns })).raw, 'unsupported_store');
  assert.equal(ok(core.get({ namespace:ns, memoryId:memory.id })).memory.content, 'Synthetic cobalt telescope');
  await core.close();
  assert.ok(closed.every(db => !db.isOpen));
  closeMock.mock.restore();
  assert.equal((await core.getRawSearchStatus({ namespace:ns })).error.code, 'store_closed');
  assert.deepEqual(readSqliteFixture(f.path), before, 'failed Raw attempt and fallback must leave store unchanged');
  assert.throws(() => openMemoryCore({ path:f.path, rawConversations:defaultRawOptions() }), { code:'unsupported_database' });
  assert.deepEqual(readSqliteFixture(f.path), before);
  const searchOff = openMemoryCore({ path:f.path, raw:true, rawSearch:false });
  try {
    assert.equal(searchOff.searchRaw, undefined);
    assert.equal(searchOff.maintainRawSearch, undefined);
    assert.equal(ok(await searchOff.getRawSearchStatus({ namespace:ns })).raw, 'unsupported_store');
  } finally { await searchOff.close(); }
  if (base === 18) assert.throws(() => openMemoryCore({ path:f.path, raw:true, privateCards:cardHost().options }), { code:'unsupported_database' });
  assert.deepEqual(readSqliteFixture(f.path), before);
  const server = createCairnServer({ path:f.path, namespace:ns });
  const client = await connect(t, server);
  assert.deepEqual(readSqliteFixture(f.path), before, 'MCP startup must not partially migrate the store');
  const inspected = ok(await contextCall(client, 'inspect_memory', { memoryId:memory.id }));
  assert.match(JSON.stringify(inspected), /Synthetic cobalt telescope/);
  const response = await client.callTool({ name:'read_memory_context', arguments:{ query:'cobalt telescope', types:['memory'], intent:'current' } });
  const envelope = JSON.parse(response.content[0].text);
  assert.equal(envelope.ok, true, JSON.stringify(response));
  assert.equal(response._meta['ink.cairn/context-read-diagnostics'].coverage.raw, 'unsupported_store');
  assert.equal(existsSync(f.path+'.raw-search'), false, 'unsupported Raw must never start index maintenance');
  await client.close(); await server.close();
  const db = f.connect();
  try { db.exec('BEGIN EXCLUSIVE; ROLLBACK'); assert.equal(db.prepare('PRAGMA foreign_key_check').get(), undefined); }
  finally { db.close(); }
});

for (const fault of ['foreign','corrupt']) test(`MCP keeps ${fault} unsupported_database refusals`, async t => {
  const f = safetyFixture(t); await f.migrate();
  const db = f.connect();
  if (fault === 'foreign') db.exec('PRAGMA application_id=123');
  else db.exec('DROP TABLE content_safety_control');
  db.close();
  const before = readSqliteFixture(f.path);
  assert.throws(() => createCairnServer({ path:f.path, namespace:ns }), { code:'unsupported_database' });
  assert.deepEqual(readSqliteFixture(f.path), before);
  assert.equal(existsSync(f.path+'.raw-search'), false);
});
