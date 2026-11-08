import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { openMemoryCore } from '../contract.mjs';
import { openDatabase, transaction } from '../database.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { ns, ok, request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { searchFixture } from '../testing/raw-search-fixtures.mjs';
import { installRawSearchTestClock } from '../testing/raw-search-clock.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { createRawSearchAuthority } from '../raw-search-authority.mjs';

test.beforeEach(installRawSearchTestClock);

function fixture(t, { safety = false, interpretation = 'host', model = {} } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'raw-search-host-' }), path = join(workspace.path, 'store.sqlite');
  if (safety) openDatabase(path, { currentDependencies: true, contentSafety: 's2h-v1' }).close();
  const port = localPlainPort();
  const options = { path, rawSearch: false, model: { ...rationaleModel(), ...model },
    rawConversations: { mode: 'raw-v1', capBytes: 200000000, interpretation, port,
      readPolicy: () => ({ generation: 'synthetic', reason: null }) } };
  let core = openMemoryCore(options);
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path); db.exec('PRAGMA foreign_keys=ON'); workspace.defer(() => db.close());
  return { workspace, path, db, port, get core() { return core; },
    reopen(mode = interpretation) { core.close(); core = openMemoryCore({ ...options,
      rawConversations: { ...options.rawConversations, interpretation: mode } }); } };
}
const maps = db => db.prepare('SELECT * FROM raw_source_maps').all();
const hostClassification = { kind: 'current-eligible-bare', reason: 'host-session-ancestry' };
function canonical(f, s) {
  const reader = openReadDatabase(f.path, { contextRead: true }); f.workspace.defer(() => reader.db.close());
  return createRawSearchAuthority(reader, s.options);
}
async function searchable(f, text = 'Synthetic copper telescope.') {
  const source = request(splitRaw(text)[0]);
  const { raw } = ok(await f.core.captureRaw(source));
  const s = await searchFixture(f); await s.maintain();
  assert.ok(canonical(f, s).inventory().rows.every(row => row.source?.classification.reason === 'host-session-ancestry'));
  const hit = (await s.search({ query: 'copper' })).candidates[0]; assert.ok(hit);
  assert.deepEqual(hit.classification, hostClassification);
  return { source, raw, s, hit };
}

test('persisted host ancestry admits multipart Raw through final validation without maps or backfill', async t => {
  const f = fixture(t, { model: { extract() { assert.fail('host registration must not interpret'); } } });
  const text = 'Synthetic copper 😀 '.repeat(260), parts = splitRaw(text);
  const source = request(parts[0]), first = ok(await f.core.captureRaw(source));
  for (const part of parts.slice(1)) ok(await f.core.captureRaw(request(part)));
  assert.deepEqual(maps(f.db), []);
  const binding = f.db.prepare('SELECT * FROM raw_capture_events ORDER BY event_id').all();
  f.reopen('engine');
  const s = await searchFixture(f); await s.maintain();
  for (const intent of ['current', 'history']) {
    const hit = (await s.search({ query: 'copper', intent })).candidates[0]; assert.ok(hit);
    assert.deepEqual(hit.classification, hostClassification);
    assert.equal(hit.currentness, 'unknown');
    const prepared = await s.prepare(hit, intent);
    assert.ok(prepared.value.ranges.every(row => row.classification.reason === 'host-session-ancestry'));
    assert.equal(prepared.validate().ranges.map(row => row.text).join(''), text);
    assert.equal(s.service.revalidate([prepared.ticket])[0].messageId, parts[0].id);
  }
  assert.deepEqual(maps(f.db), []);
  assert.deepEqual(f.db.prepare('SELECT * FROM raw_capture_events ORDER BY event_id').all(), binding);
  assert.equal(first.raw.parts[0].saved, true);
});

test('host ingest receipt forget plus source session fence denies search and outstanding tickets', async t => {
  const f = fixture(t), { source, s, hit } = await searchable(f);
  const ingestId = 'synthetic-ingest';
  ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic derived fact.', kind: 'fact' },
    receipts: [{ client: source.client, sessionId: source.sessionId, eventId: ingestId,
      role: source.messages[0].role, excerpt: source.messages[0].content }] }));
  const receipt = f.db.prepare('SELECT event_id FROM receipts').get();
  assert.equal(receipt.event_id, ingestId); assert.notEqual(receipt.event_id, source.messages[0].id);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_receipt_lineage').get().n, 0);
  assert.deepEqual((await s.search({ query: 'copper' })).candidates[0].classification, hostClassification);
  const prepared = await s.prepare(hit); assert.equal(prepared.validate().messageId, source.messages[0].id);
  const memory = f.db.prepare('SELECT id,revision FROM memories WHERE deleted=0').get();
  ok(f.core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_source_exclusions').get().n, 0);
  ok(f.core.fenceSession({ namespace: ns, client: source.client, sessionId: source.sessionId }));
  assert.throws(() => s.service.revalidate([prepared.ticket]), { code: 'raw_search_unavailable' });
  for (const intent of ['current', 'history']) assert.equal((await s.search({ query: 'copper', intent })).candidates.length, 0);
});

for (const denial of ['fence', 'exclude', 'suppress', 'delete']) test(`host final validation retains ${denial} authority`, async t => {
  const f = fixture(t, { safety: denial === 'suppress' }), { source, raw, s, hit } = await searchable(f);
  const prepared = await s.prepare(hit); assert.equal(prepared.validate().messageId, source.messages[0].id);
  if (denial === 'fence') ok(f.core.fenceSession({ namespace: ns, client: source.client, sessionId: source.sessionId }));
  if (denial === 'exclude') transaction(f.db, () => f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,?)')
    .run(raw.conversationId, source.messages[0].id, 1, 3, 1));
  if (denial === 'suppress') transaction(f.db, () => writeContentSuppressionInside(f.db, { namespace: ns,
    kind: 'raw', key: raw.conversationId, matchMode: 'span', messageId: source.messages[0].id,
    start: 1, end: 3, reason: 'privacy_erase', actionId: 'synthetic-suppress' }));
  if (denial === 'delete') ok(f.core.deleteConversation({ namespace: ns, conversationId: raw.conversationId,
    expectedRevision: raw.revision, actionId: 'synthetic-delete' }));
  assert.throws(() => prepared.validate(), { code: 'raw_search_unavailable' });
  assert.throws(() => s.service.revalidate([prepared.ticket]), { code: 'raw_search_unavailable' });
  for (const intent of ['current', 'history']) assert.equal((await s.search({ query: 'copper', intent })).candidates.length, 0);
  await s.tick(); assert.equal(s.indexCount(), 0);
});

test('host fence committed by the final access callback drops the search result', async t => {
  const f = fixture(t), { source, s, hit } = await searchable(f), authority = canonical(f, s);
  const inspected = authority.inspect(hit.ranges[0]);
  assert.deepEqual(authority.validate([{ sources: [inspected], intent: 'current', value: hit,
    access() { ok(f.core.fenceSession({ namespace: ns, client: source.client, sessionId: source.sessionId })); }
  }], Infinity, { dropDenied: true }), []);
});

test('ordinary capture after host registration retains whole-message receipt lineage', async t => {
  const f = fixture(t), text = 'Synthetic copper telescope.', source = request(splitRaw(text)[0]);
  const { raw } = ok(await f.core.captureRaw(source));
  const captured = ok(await f.core.capture({ namespace: ns, client: source.client, sessionId: source.sessionId,
    eventId: 'synthetic-memory-capture', messages: source.messages.map(({ id, role, content }) => ({ id, role, content })) }));
  assert.equal(captured.admission.memories.length, 1);
  assert.deepEqual(maps(f.db), []);
  assert.deepEqual(f.db.prepare('SELECT conversation_id,message_id,start,end,precision FROM raw_receipt_lineage').all()
    .map(row => ({ ...row })), [{ conversation_id: raw.conversationId, message_id: source.messages[0].id,
      start: 0, end: text.length, precision: 'whole-message' }]);
  const s = await searchFixture(f); await s.maintain();
  const hit = (await s.search({ query: 'copper' })).candidates[0]; assert.ok(hit);
  assert.equal(hit.classification.reason, 'host-session-ancestry');
  assert.equal((await s.prepare(hit)).validate().ranges[0].text, text);
});

test('ordinary capture refuses an event id already archived by host registration', async t => {
  const f = fixture(t), source = request(splitRaw('Synthetic copper telescope.')[0]);
  ok(await f.core.captureRaw(source));
  const captured = await f.core.capture({ namespace: ns, client: source.client, sessionId: source.sessionId,
    eventId: source.eventId, messages: source.messages.map(({ id, role, content }) => ({ id, role, content })) });
  assert.equal(captured.ok, false);
  assert.equal(captured.error.code, 'event_payload_conflict');
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
});

for (const mutation of ['digest', 'first-message-membership', 'eligible-projection'])
test(`host marker ${mutation} is rechecked at final validation`, async t => {
  const f = fixture(t), { s, hit } = await searchable(f), prepared = await s.prepare(hit);
  const column = { digest: 'projection_digest', 'first-message-membership': 'first_message_ids',
    'eligible-projection': 'eligible_message_ids' }[mutation];
  f.db.prepare(`UPDATE raw_capture_events SET ${column}=?`).run(mutation === 'digest' ? 'invalid' : '["other"]');
  assert.throws(() => prepared.validate(), { code: 'raw_search_unavailable' });
  assert.equal((await s.search({ query: 'copper' })).candidates.length, 0);
});

for (const empty of [false, true]) test(`engine messages without maps remain denied: empty projection ${empty}`, async t => {
  const f = fixture(t, { interpretation: 'engine', model: { extract: () => ({ items: [] }) } });
  const source = request(splitRaw(empty ? '   ' : 'Synthetic copper telescope.')[0]);
  ok(await f.core.captureRaw(source));
  f.db.exec('DELETE FROM raw_source_maps');
  const s = await searchFixture(f), authority = canonical(f, s);
  assert.equal(authority.inventory().rows[0].source, undefined);
  await s.maintain(); assert.equal((await s.search({ query: 'copper' })).candidates.length, 0);
});

test('a later overlapping host registration cannot repair missing engine ancestry', async t => {
  const f = fixture(t, { interpretation: 'engine', model: { extract: () => ({ items: [] }) } });
  const source = request(splitRaw('Synthetic copper telescope.')[0]);
  ok(await f.core.captureRaw(source)); f.db.exec('DELETE FROM raw_source_maps');
  f.reopen('host');
  ok(await f.core.captureRaw({ ...source, eventId: 'synthetic-overlap' }));
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_capture_events').get().n, 2);
  const s = await searchFixture(f), authority = canonical(f, s);
  assert.equal(authority.inventory().rows[0].source, undefined);
  await s.maintain(); assert.equal((await s.search({ query: 'copper' })).candidates.length, 0);
});
