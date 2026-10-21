import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { rawNamespace as namespace, localPlainPort, rawRequest, splitRaw } from '../testing/raw-fixtures.mjs';
import { legacyFixture, opposite, episodeInput } from '../testing/raw-deletion-review-fixtures.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const policy = 'append-matching-evidence-v1', content = 'Synthetic shared assertion.';
const fields = ['subject','property','scope','applies','value','attribution','commitment'];
const labels = { subject: 'Synthetic', property: 'Synthetic', scope: 'Synthetic', applies: 'Synthetic',
  value: 'old', attribution: 'direct', commitment: 'adopted' };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const denied = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
// A newly registered Raw source independently advances the shared epoch once,
// even if subsequent Memory admission refuses. Account only for that commit.
const material = (db, rawRegistrations = 0) => ['memories','receipts','memory_qualifications','qualification_anchors','raw_receipt_lineage','raw_receipt_origins','namespace_epochs']
  .map(name => [name, db.prepare(`SELECT * FROM ${name} ORDER BY rowid`).all()
    .map(row => name === 'namespace_epochs' ? { ...row, epoch: row.epoch - rawRegistrations } : row)]);
const q = text => ({ version: 1, slot: Object.fromEntries(fields.slice(0,4).map(field => [field, labels[field]])),
  value: labels.value, attribution: labels.attribution, commitment: labels.commitment,
  anchors: [{ receiptIndex: 0, start: 0, end: text.length, text, fields }] });
const model = (assertion = content) => ({ ...rationaleModel(), extract: () => ({ items: [{ content: assertion, kind: 'fact', confidence: .8, sourceIndices: [0] }] }),
  qualifyCandidates: ({ input }) => ({ qualifications: input.items.map(item => ({ itemIndex: item.itemIndex,
    ...Object.fromEntries(fields.map(field => [field, { value: labels[field], evidenceIndices: [item.candidates[0].candidateIndex] }])) })) }) });
const options = mode => ({ mode, ...(mode === 'raw-v1' ? { capBytes: 1000000 } : {}), port: localPlainPort(),
  readPolicy: () => ({ generation: 'synthetic', reason: null }) });
function fixture(t, mode = 'raw-v1', selected = true) {
  const workspace = createTestWorkspace(t, { prefix: 'qualified-duplicate-sources-' }), path = join(workspace.path, 'store.sqlite');
  let core; workspace.defer(() => core?.close());
  const calls = [], scripted = model();
  const port = { ...scripted, ...Object.fromEntries(['extract','qualifyCandidates','classify'].map(method => [method, request => {
    calls.push(method); return scripted[method](request);
  }])) };
  const reopen = () => { core?.close(); core = openMemoryCore({ path, model: port, captureQualification: 'source-bound-v2',
    ...(selected ? { captureQualifiedDuplicates: policy } : {}), rawConversations: options(mode) }); return core; };
  reopen(); const db = new DatabaseSync(path); workspace.defer(() => db.close());
  return { workspace, path, db, calls, reopen, get core() { return core; } };
}
const raw = (id, client = 'codex', text = 'Synthetic source ' + id + '.') => rawRequest(splitRaw(text, { id: 'message-' + id })[0],
  { namespace, client, sessionId: 'session-' + id, eventId: 'event-' + id });
async function saved(core, id, client, text) {
  const response = ok(await core.captureRaw(raw(id, client, text))), interpreted = ok(response.interpretation);
  return { ...response.raw, memoryId: interpreted.admission.memories[0].id };
}
const detail = (core, memoryId) => ok(core.get({ namespace, memoryId, includeQualification: true }));
async function remove(core, conversationId, actionId) {
  const expectedRevision = ok(await core.getConversation({ namespace, conversationId })).conversation.revision;
  return ok(core.deleteConversation({ namespace, conversationId, expectedRevision, actionId }));
}

for (const client of ['codex','claude-code']) {
  test(`QD-02/06 ${client}: new Raw sources append, cold replay is model-free, either deletion order preserves only live support`, async t => {
    for (const order of [[0,1],[1,0]]) {
      const f = fixture(t), a = await saved(f.core, 'A', client), original = detail(f.core, a.memoryId).qualification;
      const b = await saved(f.core, 'B', client); assert.equal(a.memoryId, b.memoryId);
      assert.deepEqual(detail(f.core, a.memoryId).qualification, original); assert.equal(detail(f.core, a.memoryId).receipts.length, 2);
      f.reopen(); const before = material(f.db), calls = f.calls.length;
      const replay = ok(await f.core.captureRaw(raw('B', client))); assert.equal(ok(replay.interpretation).duplicate, true);
      assert.deepEqual(material(f.db), before); assert.equal(f.calls.length, calls);
      const ids = [a.conversationId,b.conversationId];
      const first = await remove(f.core, ids[order[0]], 'delete-first'); assert.equal(first.retainedMemories, 1);
      const remaining = detail(f.core, a.memoryId); assert.equal(remaining.receipts.length, 1); assert.equal(remaining.qualification, null);
      const second = await remove(f.core, ids[order[1]], 'delete-last'); assert.equal(second.forgottenMemories, 1);
      denied(f.core.get({ namespace, memoryId: a.memoryId }), 'memory_not_found');
      assert.equal(f.db.prepare('SELECT count(*) n FROM suppressed').get().n, 1);
    }
  });

  for (const overlap of [false,true]) test(`QD-04 ${client}: stored Raw offsets, not normalized anchor offsets, decide ${overlap ? 'overlapping' : 'disjoint'} exclusion`, async t => {
    const f = fixture(t), a = await saved(f.core, 'A', client, ' '.repeat(40) + 'Synthetic original source.  ');
    const span = f.db.prepare('SELECT * FROM raw_receipt_lineage').get(); assert.equal(span.start, 40);
    assert.equal(detail(f.core, a.memoryId).qualification.anchors[0].start, 0);
    f.db.prepare('INSERT INTO raw_source_exclusions VALUES(?,?,?,?,1)').run(span.conversation_id, span.message_id,
      overlap ? span.start : 0, overlap ? span.start + 1 : 20);
    const before = material(f.db), response = ok(await f.core.captureRaw(raw('B', client)));
    if (overlap) { denied(response.interpretation, 'source_excluded'); assert.deepEqual(material(f.db, 1), before); }
    else assert.equal(ok(response.interpretation).admission.memories[0].id, a.memoryId);
  });

  test(`QD-04 ${client}: original session fence is checked independently of incoming source`, async t => {
    const f = fixture(t), a = await saved(f.core, 'A', client);
    f.db.prepare('INSERT INTO raw_session_fences SELECT owner_id,scope,project_id,client,session_key FROM raw_conversations WHERE id=?').run(a.conversationId);
    const before = material(f.db); denied(ok(await f.core.captureRaw(raw('B', client))).interpretation, 'conversation_deleted');
    assert.deepEqual(material(f.db, 1), before);
  });

  for (const action of ['correct','forget']) test(`QD-06 ${client}: ${action} excludes every attached origin and blocks reintroduction`, async t => {
    const f = fixture(t), a = await saved(f.core, 'A', client); await saved(f.core, 'B', client);
    const memory = detail(f.core, a.memoryId).memory;
    if (action === 'forget') ok(f.core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));
    else ok(f.core.correct({ namespace, memoryId: memory.id, expectedRevision: memory.revision,
      content: 'Synthetic corrected assertion.', kind: 'fact',
      receipt: { client: 'manual', sessionId: 'correction', eventId: 'correction', role: 'user', excerpt: 'Synthetic explicit correction.' } }));
    assert.equal(f.db.prepare('SELECT count(DISTINCT conversation_id) n FROM raw_source_exclusions').get().n, 2);
    const calls = f.calls.length;
    for (const id of ['A','B']) {
      const replay = ok(await f.core.captureRaw({ ...raw(id, client), eventId: 'new-event-' + id }));
      assert.equal(ok(replay.interpretation).duplicate, true); assert.equal(ok(replay.interpretation).overlap, true);
    }
    assert.equal(f.calls.length, calls);
    for (const id of ['A','B']) {
      const fresh = rawRequest(splitRaw('Synthetic fresh support after ' + action + '.', { id: 'fresh-message-' + id, ordinal: 2 })[0],
        { namespace, client, sessionId: 'session-' + id, eventId: 'fresh-event-' + id });
      const captured = ok(ok(await f.core.captureRaw(fresh)).interpretation);
      assert.equal(captured.admission.suppressedCount, 1); assert.deepEqual(captured.admission.memories, []);
    }
    assert.equal(f.db.prepare('SELECT count(*) n FROM memories WHERE deleted=0 AND content=?').get(content).n, 0);
  });
}

for (const variant of ['foreign','orphan-message','invalid-role','invalid-span']) test(`QD-04 stored ${variant} lineage refuses atomically`, async t => {
  const f = fixture(t); await saved(f.core, 'A');
  if (variant === 'foreign') f.db.exec("UPDATE raw_conversations SET owner_id='synthetic-other-owner'");
  if (variant === 'orphan-message') f.db.exec("UPDATE raw_receipt_lineage SET message_id='missing-message'");
  if (variant === 'invalid-role') f.db.exec("UPDATE raw_messages SET role='assistant'");
  if (variant === 'invalid-span') f.db.exec('UPDATE raw_receipt_lineage SET end=end+100');
  const before = material(f.db); denied(ok(await f.core.captureRaw(raw('B'))).interpretation, 'raw_lineage_unavailable');
  assert.deepEqual(material(f.db, 1), before);
});

for (const origin of ['independent','unknown','job']) test(`QD-04 ${origin} original provenance has explicit eligibility`, async t => {
  const f = fixture(t), receipt = { client: 'manual', sessionId: 'manual', eventId: 'manual', role: 'user', excerpt: 'Synthetic manual source.' };
  let memoryId;
  if (origin === 'job') memoryId = ok(await f.core.capture({ namespace, client: 'manual', sessionId: 'manual', eventId: 'manual-job',
    messages: [{ id: 'manual', role: 'user', content: receipt.excerpt }] })).admission.memories[0].id;
  else memoryId = ok(f.core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: [receipt], qualification: q(receipt.excerpt) })).memory.id;
  if (origin === 'unknown') f.db.exec("UPDATE raw_receipt_origins SET kind='unknown'");
  const before = material(f.db), response = ok(await f.core.captureRaw(raw('B')));
  if (origin === 'unknown') { denied(response.interpretation, 'raw_lineage_unavailable'); assert.deepEqual(material(f.db, 1), before); }
  else assert.equal(ok(response.interpretation).admission.memories[0].id, memoryId);
});

test('QD-04 known independent original session still obeys its fence', async t => {
  const f = fixture(t), receipt = { client: 'manual', sessionId: 'manual', eventId: 'manual', role: 'user', excerpt: 'Synthetic manual source.' };
  ok(f.core.admit({ namespace, memory: { content, kind: 'fact' }, receipts: [receipt], qualification: q(receipt.excerpt) }));
  f.db.prepare('INSERT INTO raw_session_fences VALUES(?,?,?,?,?)').run(namespace.ownerId, namespace.scope, '', receipt.client, receipt.sessionId);
  denied(ok(await f.core.captureRaw(raw('B'))).interpretation, 'conversation_deleted');
});

test('QD-04 policy-skipped Raw is eligible without saved/decrypted parts', async t => {
  const f = fixture(t, 'off'), a = await saved(f.core, 'A');
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts WHERE saved=1 OR sealed IS NOT NULL').get().n, 0);
  const b = await saved(f.core, 'B'); assert.equal(a.memoryId, b.memoryId);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_parts WHERE saved=1 OR sealed IS NOT NULL').get().n, 0);
});

test('QD-04 partial lineage without deletion authority refuses without querying or repairing it', async t => {
  const f = fixture(t); await saved(f.core, 'A'); f.db.exec('DROP TABLE raw_deletion_actions');
  denied(ok(await f.core.captureRaw(raw('B'))).interpretation, 'raw_lineage_unavailable');
  assert.equal(f.db.prepare("SELECT count(*) n FROM sqlite_master WHERE name='raw_deletion_actions'").get().n, 0);
});

for (const variant of ['live','consumer-fenced','origin-fenced','deleted-origin','missing-source-ids','ambiguous-source-ids']) {
  test(`QD-04 actual legacy cross-client episode keep uses original source for ${variant}`, async t => {
    const f = await legacyFixture(t, 'codex', opposite('codex'), true);
    const original = detail(f.core, f.memoryId), assertion = original.memory.content;
    assert.equal(original.receipts[0].client, 'claude-code');
    if (variant === 'ambiguous-source-ids') {
      const other = ok(await f.core.capture(episodeInput('codex', 'C'))).episode.id;
      const sourceId = f.db.prepare('SELECT id FROM episode_sources WHERE episode_id=?').get(other).id;
      const previous = JSON.parse(f.db.prepare('SELECT keep_source_ids FROM episode_keep_actions').get().keep_source_ids);
      f.db.prepare('UPDATE episode_keep_actions SET keep_source_ids=?').run(JSON.stringify([...previous, sourceId]));
    }
    const core = openMemoryCore({ path: f.path, model: model(assertion), captureQualification: 'source-bound-v2',
      captureQualifiedDuplicates: policy, rawConversations: options('raw-v1') }); f.workspace.defer(() => core.close());
    if (variant === 'consumer-fenced' || variant === 'origin-fenced') f.db.prepare(`INSERT INTO raw_session_fences
      SELECT owner_id,scope,project_id,client,session_key FROM session_episodes WHERE id=?`).run(variant === 'consumer-fenced' ? f.consumer : f.origin);
    if (variant === 'deleted-origin') f.db.prepare('UPDATE session_episodes SET deleted=1 WHERE id=?').run(f.origin);
    if (variant === 'missing-source-ids') f.db.exec("UPDATE episode_keep_actions SET keep_source_ids='[\"missing-recorded-source-id\"]'");
    const before = material(f.db), response = ok(await core.captureRaw(raw('new-source')));
    if (variant === 'live' || variant === 'consumer-fenced') {
      assert.equal(ok(response.interpretation).admission.memories[0].id, f.memoryId);
      assert.deepEqual(detail(core, f.memoryId).qualification, original.qualification);
    } else {
      denied(response.interpretation, ['origin-fenced','deleted-origin'].includes(variant) ? 'conversation_deleted' : 'raw_lineage_unavailable');
      assert.deepEqual(material(f.db, 1), before);
    }
  });
}

test('QD-07 omission preserves exact pre-policy Raw frozen profile bytes', async t => {
  const f = fixture(t, 'raw-v1', false); await saved(f.core, 'A');
  const expected = createHash('sha256').update(JSON.stringify(['raw-capture-v1', { captureQualification: 'source-bound-v2' }, {}])).digest('hex');
  assert.equal(f.db.prepare('SELECT binding_digest FROM raw_capture_events').get().binding_digest, expected);
});
