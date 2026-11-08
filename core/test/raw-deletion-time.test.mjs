import assert from 'node:assert/strict';
import test from 'node:test';
import { readdirSync, readFileSync } from 'node:fs';
import { openMemoryCore } from '../index.mjs';
import { upgradeLayoutBase } from '../layout-base-upgrade.mjs';
import { migrateReceiptEventTime } from '../content-safety-migration.mjs';
import { createRawSourceRoots } from '../raw-source-roots.mjs';
import { RAW_CLIENTS } from '../raw-input.mjs';
import { safetyFixture, copySqliteFixture, quiescence, ok, ns } from '../testing/content-safety-s2h-fixture.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { batch } from '../testing/episode-helpers.mjs';

const start = Date.parse('2020-01-01T00:00:00.000Z');
const content = 'Synthetic saved preference.';
const savedReceipt = (client, sessionId) => ({ client, sessionId, eventId: 'saved-message', role: 'user', excerpt: content });

async function fixture(t, { client = RAW_CLIENTS[0], sameSession = false, episodes = false, correctBody = false } = {}) {
  t.mock.timers.enable({ apis: ['Date'], now: start });
  const f = safetyFixture(t), receipt = savedReceipt(client, sameSession ? 'target' : 'earlier');
  const old = openMemoryCore({ path: f.path });
  let memory;
  try { memory = ok(old.admit({ namespace: ns, memory: { content, kind: 'context' }, receipts: [receipt] })).memory; }
  finally { old.close(); }
  copySqliteFixture(f.path, f.backupPath);
  await upgradeLayoutBase({ path: f.path, backupPath: f.backupPath,
    expected: { storeId: f.storeId, fromBase: 18, toBase: 33 }, quiescence });
  copySqliteFixture(f.path, f.backupPath);
  await migrateReceiptEventTime({ path: f.path, backupPath: f.backupPath,
    expected: { storeId: f.storeId, base: 33 }, quiescence });
  const core = openMemoryCore({ path: f.path, raw: true, model: rationaleModel() });
  f.workspace.defer(() => core.close());
  const db = f.connect(); f.workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 53);
  const original = db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id);
  assert.equal(db.prepare('SELECT count(*) n FROM raw_receipt_origins WHERE receipt_id=?').get(original.id).n, 0);
  assert.equal(original.created_at, new Date(start).toISOString());
  let body = content;
  if (correctBody) {
    t.mock.timers.setTime(start + 90_000);
    body = 'Synthetic corrected preference.';
    ok(core.correct({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision,
      content: body, kind: 'context', receipt: { client, sessionId: 'target', eventId: 'target-message', role: 'user', excerpt: body } }));
    assert.equal(db.prepare('SELECT count(*) n FROM receipts WHERE id=?').get(original.id).n, 0);
  }
  t.mock.timers.setTime(start + 120_000);
  const capture = ok(await core.capture({ namespace: ns, client, sessionId: 'target', eventId: 'target-event',
    messages: [{ id: 'target-message', role: 'user', content: body }] }));
  if (episodes) {
    // Exercise the existing unqualified episode admission seam after ordinary capture.
    const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
    f.workspace.defer(() => runtime.close());
    const source = { ...batch('episode-event', content, 'target'), client };
    source.messages[0].id = source.view.messages[0].id = 'target-message';
    const registered = runtime.reserveEpisodeBatch(ns, source);
    const key = { namespace: ns, client, eventId: source.eventId, payloadDigest: source.payloadDigest };
    const claim = ok(core.claimAdmission({ ...key, leaseMs: 125_000 }));
    const admitted = ok(await core.finishAdmission({ ...key, token: claim.token, items: [{
      content, kind: 'context', confidence: .5,
      receipts: [{ client, sessionId: 'target', eventId: 'target-message', role: 'user', excerpt: content }] }] }));
    assert.equal(admitted.memories[0].id, memory.id);
    capture.episode = { id: registered.episodeId };
  }
  const receipts = db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(memory.id);
  assert.equal(receipts.length, correctBody ? 1 : 2);
  const rooted = receipts.find(row => row.id !== original.id);
  const roots = createRawSourceRoots(db);
  if (!correctBody) assert.equal(roots.receipt(ns, original).unknown, true);
  const authority = roots.receipt(ns, rooted);
  assert.equal(authority.roots.length, 1);
  const conversation = db.prepare('SELECT * FROM raw_conversations WHERE id=?').get(authority.roots[0].conversationId);
  assert.ok(conversation, 'default capture must record the source conversation');
  assert.equal(Date.parse(conversation.first_received_at), start + 120_000);
  const key = () => ({ namespace: ns, conversationId: conversation.id,
    expectedRevision: db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversation.id).revision });
  return { ...f, core, db, client, memory, original, rooted, capture, conversation, key };
}

function remove(f, retained) {
  const input = f.key(), preview = ok(f.core.previewDeleteConversation(input));
  assert.deepEqual([preview.forgottenMemories, preview.retainedMemories, preview.removedReceipts], retained ? [0, 1, 1] : [1, 0, 2]);
  const result = ok(f.core.deleteConversation({ ...input, actionId: 'delete-target' }));
  for (const field of ['forgottenMemories', 'retainedMemories', 'removedReceipts', 'invalidatedEpisodes'])
    assert.equal(result[field], preview[field]);
  assertState(f, retained);
}
function assertState(f, retained) {
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE id=?').get(f.rooted.id).n, 0);
  if (retained) {
    assert.equal(ok(f.core.get({ namespace: ns, memoryId: f.memory.id })).memory.content, content);
    assert.deepEqual(f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(f.memory.id), [f.original]);
    assert.equal(f.db.prepare('SELECT count(*) n FROM raw_receipt_origins WHERE receipt_id=?').get(f.original.id).n, 0);
  } else {
    assert.equal(f.core.get({ namespace: ns, memoryId: f.memory.id }).error?.code, 'memory_not_found');
    assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(f.memory.id).n, 0);
    assert.equal(f.db.prepare('SELECT deleted FROM memories WHERE id=?').get(f.memory.id).deleted, 1);
    assert.ok(f.db.prepare('SELECT 1 FROM suppressed WHERE fingerprint=?').get(f.db.prepare('SELECT fingerprint FROM memories WHERE id=?').get(f.memory.id).fingerprint));
  }
}

for (const client of RAW_CLIENTS) test(`upgraded saved support predating default capture survives deletion for client ${RAW_CLIENTS.indexOf(client)}`, async t => {
  remove(await fixture(t, { client }), true);
});

test('correction replaces old receipts before deletion of the changed body', async t => {
  const f = await fixture(t, { correctBody: true });
  assert.equal(f.rooted.created_at, new Date(start + 90_000).toISOString());
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: f.memory.id })).memory.content, 'Synthetic corrected preference.');
  const input = f.key(), preview = ok(f.core.previewDeleteConversation(input));
  assert.deepEqual([preview.forgottenMemories, preview.retainedMemories, preview.removedReceipts], [1, 0, 1]);
  ok(f.core.deleteConversation({ ...input, actionId: 'delete-corrected' }));
  assertState(f, false);
});

test('unanchored support from the same session stays dependent despite predating capture', async t => {
  remove(await fixture(t, { sameSession: true }), false);
});

for (const [label, offset] of [['after capture', 1], ['inside the clock margin', -30_000], ['at the clock margin', -60_000],
  ['just before the clock margin', -60_001]]) test(`other-session unknown support ${label}`, async t => {
  const f = await fixture(t);
  f.db.prepare('UPDATE receipts SET created_at=? WHERE id=?').run(new Date(start + 120_000 + offset).toISOString(), f.original.id);
  f.original = f.db.prepare('SELECT * FROM receipts WHERE id=?').get(f.original.id);
  remove(f, offset < -60_000);
});

for (const path of ['conversation', 'episode']) test(`dedupe links the saved id to the episode and retains old support through ${path} deletion`, async t => {
  const f = await fixture(t, { episodes: true });
  const link = f.db.prepare('SELECT * FROM episode_memory_links WHERE memory_id=?').get(f.memory.id);
  assert.ok(link, 'deduplicated Memory must link to the capturing episode');
  assert.equal(link.episode_id, f.capture.episode.id);
  assert.ok(JSON.parse(link.receipt_ids).includes(f.rooted.id));
  if (path === 'conversation') remove(f, true);
  else {
    const episode = ok(f.core.getEpisode({ namespace: ns, episodeId: link.episode_id })).episode;
    assert.deepEqual(ok(f.core.forgetEpisode({ namespace: ns, episodeId: link.episode_id, expectedRevision: episode.revision })), { forgotten: true });
    assertState(f, true);
  }
});

for (const deleted of [false, true]) test(`earlier episode receipt clock stays authoritative with deleted=${deleted}`, async t => {
  const f = await fixture(t, { episodes: true });
  f.db.prepare('UPDATE session_episodes SET first_received_at=?,deleted=? WHERE id=?')
    .run(new Date(start + 30_000).toISOString(), Number(deleted), f.capture.episode.id);
  remove(f, false);
});

for (const clock of ['receipt', 'conversation', 'episode']) test(`invalid ${clock} clock keeps unknown support dependent`, async t => {
  const f = await fixture(t, { episodes: true });
  if (clock === 'receipt') f.db.prepare('UPDATE receipts SET created_at=? WHERE id=?').run('invalid', f.original.id);
  if (clock === 'conversation') f.db.prepare('UPDATE raw_conversations SET first_received_at=? WHERE id=?').run('invalid', f.conversation.id);
  if (clock === 'episode') f.db.prepare('UPDATE session_episodes SET first_received_at=? WHERE id=?').run('invalid', f.capture.episode.id);
  remove(f, false);
});

// Pins the body invariant that makes an old surviving receipt deletion evidence.
test('only correction writes non-null Memory content and replaces all receipts before attachment', () => {
  const core = new URL('../', import.meta.url), runtime = readFileSync(new URL('runtime.mjs', core), 'utf8');
  const begin = runtime.indexOf('  function correct('), end = runtime.indexOf('  function forgetMutation(', begin);
  assert.ok(begin >= 0 && end > begin);
  const writes = [];
  for (const file of readdirSync(core).filter(name => name.endsWith('.mjs'))) {
    const source = readFileSync(new URL(file, core), 'utf8');
    for (const update of source.matchAll(/\bUPDATE\s+(?:OR\s+\w+\s+)?(?:[\w"`\[\]]+\s*\.\s*)?(?:memories|"memories"|`memories`|\[memories\])(?:\s+(?:AS\s+)?[\w"`\[\]]+)?\s+SET\s+([\s\S]*?)(?=\bWHERE\b|;)/gi)) {
      for (const assignment of update[1].matchAll(/\bcontent["`\]]?\s*=\s*([^,\n]+)/gi)) {
        if (/^NULL\s*$/i.test(assignment[1])) continue;
        assert.equal(file, 'runtime.mjs');
        assert.ok(update.index > begin && update.index < end, 'content updates must stay inside correction');
        writes.push(update[0]);
      }
    }
  }
  assert.equal(writes.length, 1, 'recognize the existing content update');
  const correction = runtime.slice(begin, end);
  const deletion = correction.match(/db\.prepare\(["']DELETE FROM receipts WHERE memory_id = \?["']\)\.run\(id\);/);
  assert.ok(deletion, 'correction must delete every old receipt');
  const attachments = [...correction.matchAll(/\battach\(/g)];
  assert.equal(attachments.length, 1);
  assert.ok(attachments[0].index > deletion.index + deletion[0].length);
  assert.match(correction.slice(deletion.index + deletion[0].length), /for \(const \[index, receipt\] of value\.receipts\.entries\(\)\) attach\(id, receipt, now,/);
});
