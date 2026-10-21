import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { join } from 'node:path';
import { readFileSync } from 'node:fs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openDatabase } from '../database.mjs';
import { openDatabase as openV26 } from '../testing/raw-v26-database.mjs';
import { openMemoryCore } from '../contract.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { fixture, ns, request, splitRaw, ok, usage, count } from '../testing/raw-capture-fixtures.mjs';

const extract = () => ({ items: [{ content: 'Synthetic shared assertion.', kind: 'fact', confidence: .8, sourceIndices: [0] }] });
const failCode = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
async function capture(f, client, sessionId = 'A') {
  const input = request(splitRaw('Synthetic source ' + sessionId)[0], { client, sessionId, eventId: 'event-' + sessionId });
  const result = ok(await f.core.captureRaw(input));
  return { input, conversationId: result.raw.conversationId, memoryId: ok(result.interpretation).admission.memories[0].id };
}
async function key(f, conversationId, actionId = 'delete-A') {
  const view = ok(await f.core.getConversation({ namespace: ns, conversationId }));
  return { namespace: ns, conversationId, expectedRevision: view.conversation.revision, actionId };
}

test('P3b-01 schema 27 is additive, opt-in, atomic and refused by the actual v26 opener', t => {
  const ws = createTestWorkspace(t, { prefix: 'raw-delete-schema-' }), path = join(ws.path, 'store.sqlite');
  let db = openDatabase(path, { rawLineage: true }); db.close();
  const exec = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(sql) {
    const result = exec.call(this, sql);
    if (sql.includes('CREATE TABLE raw_deletion_actions')) throw Error('Synthetic migration failure');
    return result;
  };
  try { assert.throws(() => openDatabase(path, { rawDeletion: true }), /Synthetic migration failure/); }
  finally { DatabaseSync.prototype.exec = exec; }
  db = openDatabase(path); ws.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, 26);
  assert.equal(count(db, 'raw_conversations'), 0);
  const selected = openDatabase(path, { rawDeletion: true }); ws.defer(() => selected.close());
  assert.equal(selected.prepare('PRAGMA user_version').get().user_version, 27);
  assert.equal(count(selected, 'raw_conversations'), 0); assert.equal(count(selected, 'raw_job_sources'), 0);
  assert.throws(() => openV26(path), error => error.code === 'unsupported_database');
  assert.throws(() => openMemoryCore({ path, rawDeletion: true }), error => error.code === 'invalid_input');
});

test('P3b-01 internal selection stays strict/default-off; artifact gains only option-off import closure', t => {
  const f = fixture(t);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 25);
  assert.equal(f.core.deleteConversation, undefined);
  for (const value of ['true', 1, null]) assert.throws(() => openRawCaptureCore({ path: f.path }, {
    mode: 'off', deletion: value, readPolicy: () => ({ generation: 'synthetic', reason: null }) }), { code: 'invalid_input' });
  let reads = 0;
  assert.throws(() => openRawCaptureCore({ path: f.path }, { mode: 'off', get deletion() { reads++; return true; } }), { code: 'invalid_input' });
  assert.equal(reads, 0);
  const inherited = Object.assign(Object.create({ deletion: true }), { mode: 'off', readPolicy: () => ({ generation: 'synthetic', reason: null }) });
  const unselected = openRawCaptureCore({ path: f.path }, inherited); f.workspace.defer(() => unselected.close());
  assert.equal(unselected.deleteConversation, undefined);
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 25);
  const files = JSON.parse(readFileSync(new URL('../../packaging/artifact-files.json', import.meta.url)));
  for (const file of ['raw-deletion-schema','raw-deletion-storage','raw-source-roots','raw-control-storage','raw-input']) {
    assert.ok(files.includes(`core/${file}.mjs`));
  }
  for (const file of ['raw-capture','raw-capture-storage','raw-journal','raw-reads']) assert.equal(files.includes(`core/${file}.mjs`), false);
});

for (const client of ['claude-code', 'codex']) {
  test(`P3b-02/05/06 ${client}: source-only cascade, counts, cold action replay and tombstone`, async t => {
    const f = fixture(t, { deletion: true, model: { extract } }), source = await capture(f, client);
    const deletion = await key(f, source.conversationId), { actionId, ...previewInput } = deletion;
    const before = usage(f.core), changes = f.db.prepare('PRAGMA data_version').get().data_version;
    const preview = ok(f.core.previewDeleteConversation(previewInput));
    assert.equal(f.db.prepare('PRAGMA data_version').get().data_version, changes);
    assert.deepEqual([preview.forgottenMemories, preview.retainedMemories, preview.removedReceipts, preview.invalidatedEpisodes], [1,0,1,0]);
    const result = ok(f.core.deleteConversation(deletion));
    assert.equal(result.forgottenMemories, 1); assert.equal(result.effectCount, 2);
    failCode(f.core.get({ namespace: ns, memoryId: source.memoryId }), 'memory_not_found');
    assert.equal(usage(f.core).savedBytes, 0); assert.ok(before.savedBytes > 0);
    assert.equal(count(f.db, 'raw_parts'), 0); assert.equal(count(f.db, 'raw_session_fences'), 1);
    f.reopen(); assert.deepEqual(ok(f.core.deleteConversation(deletion)), result);
    assert.equal(count(f.db, 'raw_deletion_effects'), 2); assert.equal(usage(f.core).savedBytes, 0);
    failCode(f.core.deleteConversation({ ...deletion, expectedRevision: deletion.expectedRevision + 1 }), 'event_payload_conflict');
  });

  test(`P3b-02/03/04 ${client}: actual second conversation and explicit support survive with scoped CAS`, async t => {
    const f = fixture(t, { deletion: true, model: { extract } });
    const a = await capture(f, client), b = await capture(f, client, 'B');
    assert.equal(a.memoryId, b.memoryId);
    const stale = await key(f, a.conversationId), bBefore = await key(f, b.conversationId);
    ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic shared assertion.', kind: 'fact' },
      receipts: [{ client: 'manual', sessionId: 'explicit', eventId: 'explicit-proof', role: 'user', excerpt: 'Independent explicit support.' }] }));
    const { actionId, ...oldPreview } = stale;
    failCode(f.core.previewDeleteConversation(oldPreview), 'revision_conflict');
    const current = await key(f, a.conversationId);
    const result = ok(f.core.deleteConversation(current));
    assert.deepEqual([result.forgottenMemories, result.retainedMemories, result.removedReceipts], [0,1,1]);
    const retained = ok(f.core.get({ namespace: ns, memoryId: a.memoryId }));
    assert.equal(retained.memory.content, 'Synthetic shared assertion.'); assert.equal(retained.receipts.length, 2);
    assert.ok((await key(f, b.conversationId)).expectedRevision > bBefore.expectedRevision);
    assert.equal(count(f.db, 'raw_conversations'), 1);
  });

  test(`P3b-05 ${client}: a receipt mutation failure rolls back Raw, Memory, usage, effects and tombstone`, async t => {
    const f = fixture(t, { deletion: true, model: { extract } }), a = await capture(f, client), before = usage(f.core);
    const deletion = await key(f, a.conversationId);
    f.db.exec("CREATE TRIGGER fail_delete_receipt BEFORE DELETE ON receipts BEGIN SELECT RAISE(ABORT,'synthetic'); END;");
    failCode(f.core.deleteConversation(deletion), 'storage_error');
    assert.deepEqual(usage(f.core), before); assert.equal(count(f.db, 'raw_session_fences'), 0);
    assert.equal(count(f.db, 'raw_deletion_effects'), 0); assert.equal(count(f.db, 'raw_deletion_actions'), 0);
    assert.equal(ok(f.core.get({ namespace: ns, memoryId: a.memoryId })).receipts.length, 1);
    assert.equal(count(f.db, 'raw_parts'), 1);
  });

  test(`P3b-02/04 ${client}: historical source-only receipt is deleted, unrelated current replacement survives`, async t => {
    const f = fixture(t, { deletion: true, model: { extract } }), a = await capture(f, client);
    const old = ok(f.core.get({ namespace: ns, memoryId: a.memoryId })).memory;
    const successor = ok(f.core.supersede({ namespace: ns, memoryId: old.id, expectedRevision: old.revision,
      replacement: { content: 'Synthetic unrelated explicit successor.', kind: 'fact' },
      receipts: [{ client: 'manual', sessionId: 'unrelated', eventId: 'successor', role: 'user', excerpt: 'Synthetic independent support.' }] })).memory;
    assert.equal(ok(f.core.get({ namespace: ns, memoryId: old.id })).memory.state, 'historical');
    const result = ok(f.core.deleteConversation(await key(f, a.conversationId)));
    assert.equal(result.forgottenMemories, 1); assert.equal(result.removedReceipts, 1);
    failCode(f.core.get({ namespace: ns, memoryId: old.id }), 'memory_not_found');
    assert.equal(ok(f.core.get({ namespace: ns, memoryId: successor.id })).memory.state, 'active');
  });

  for (const point of ['microtask', 'response']) test(`P3b-08 ${client}: deletion at legacy ${point} fences the actual source job`, async t => {
    const f = fixture(t, { deletion: true, model: { extract } }), a = await capture(f, client);
    const deletion = await key(f, a.conversationId);
    let armed = true, calls = 0;
    const remove = () => { armed = false; ok(f.core.deleteConversation(deletion)); };
    const writer = openMemoryCore({ path: f.path, model: { contextWindow: 8192,
      countTokens: () => { if (armed && point === 'microtask') { armed = false; queueMicrotask(remove); } return 1; },
      extract: () => { calls++; if (point === 'response') remove(); return extract(); } } });
    f.workspace.defer(() => writer.close());
    const result = await writer.capture({ namespace: ns, client, sessionId: 'A', eventId: 'new-legacy-job',
      messages: [{ id: 'message', role: 'user', content: 'Synthetic source A' }] });
    failCode(result, 'conversation_deleted');
    assert.equal(calls, point === 'response' ? 1 : 0);
    assert.equal(count(f.db, 'raw_closed_jobs'), 1); assert.equal(count(f.db, 'raw_job_sources'), 0);
    const closed = f.db.prepare("SELECT state,token,lease_expires_at FROM admission_claims WHERE event_id='new-legacy-job'").get();
    assert.equal(closed.state, 'pending'); assert.equal(typeof closed.token, 'string'); assert.equal(closed.lease_expires_at, 0);
    assert.equal(f.db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n, 0);
    failCode(await writer.capture({ namespace: ns, client, sessionId: 'A', eventId: 'late-new-event',
      messages: [{ id: 'new-message', role: 'assistant', content: 'Synthetic late source.' }] }), 'conversation_deleted');
  });

  for (const empty of [false, true]) test(`P3b-07 ${client}: pre-Raw episode deletion, empty=${empty}, uses no backfill`, async t => {
    const ws = createTestWorkspace(t, { prefix: 'raw-delete-legacy-' }), path = join(ws.path, 'store.sqlite');
    const model = { ...rationaleModel(), extract: empty ? () => ({ items: [] }) : extract,
      interpretEpisode: ({ input }) => {
        const field = value => ({ value, anchors: [{ sourceIndex: 0, start: 0, end: input.sources[0].text.length }] });
        return { type: field('work'), language: 'mixed', gist: field('Synthetic legacy episode.'), outcome: null, nextStep: null, disposition: null };
      } };
    const old = openMemoryCore({ path, model, captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1',
      sessionEpisodes: { mode: 'episode-v1', draftEveryBatches: 2 } }); ws.defer(() => old.close());
    const input = { namespace: ns, client, sessionId: 'old-session', eventId: 'old-event',
      episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
      messages: [{ id: 'old-message', role: 'user', content: 'Synthetic legacy source.', occurredAt: null }] };
    const first = ok(await old.capture(input));
    const selected = openRawCaptureCore({ path }, { mode: 'off', deletion: true,
      readPolicy: () => { throw Error('Delete must not call capture policy'); } }); ws.defer(() => selected.close());
    const db = new DatabaseSync(path); ws.defer(() => db.close());
    assert.equal(count(db, 'raw_parts'), 0); assert.equal(count(db, 'raw_conversations'), 0);
    const episode = ok(old.getEpisode({ namespace: ns, episodeId: first.episode.id })).episode;
    assert.deepEqual(ok(old.forgetEpisode({ namespace: ns, episodeId: episode.id, expectedRevision: episode.revision })), { forgotten: true });
    assert.equal(count(db, 'raw_conversations'), 0); assert.equal(count(db, 'episode_sources'), 0);
    assert.equal(count(db, 'raw_session_fences'), 1);
    assert.equal(db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n, 0);
    failCode(await old.capture({ ...input, eventId: 'late-legacy' }), 'conversation_deleted');
  });

  test(`P3b-09 ${client}: a writer opened before opt-in closes only its paused namespace reservations`, async t => {
    const f = fixture(t, { model: { extract: () => ({ items: [] }) } });
    const old = openMemoryCore({ path: f.path }); f.workspace.defer(() => old.close());
    const selected = openRawCaptureCore({ path: f.path, model: f.model }, { mode: 'raw-v1', deletion: true,
      port: { version: 'raw-seal-v1', sealRaw: async ({ text }) => ({ format: 'local-plain-v1', keyVersion: null, sealed: Buffer.from(text) }),
        openRaw: async ({ sealed }) => ({ text: Buffer.from(sealed).toString() }) }, readPolicy: () => ({ generation: 'synthetic', reason: null }) });
    f.workspace.defer(() => selected.close());
    const parts = splitRaw('x'.repeat(8000));
    ok(await selected.captureRaw(request(parts[0], { client })));
    const other = { ...ns, scope: 'project', projectId: 'other-project' };
    ok(await selected.captureRaw(request(parts[0], { namespace: other, client })));
    const before = usage(selected); assert.equal(before.reservedBytes, 8000);
    ok(old.setCapturePaused({ namespace: ns, expectedGeneration: 'initial', paused: true }));
    assert.equal(usage(selected).reservedBytes, 4000);
    assert.equal(f.db.prepare("SELECT assembly_state FROM raw_messages m JOIN raw_conversations c ON c.id=m.conversation_id WHERE c.scope='personal'").get().assembly_state, 'closed');
    assert.equal(f.db.prepare("SELECT assembly_state FROM raw_messages m JOIN raw_conversations c ON c.id=m.conversation_id WHERE c.scope='project'").get().assembly_state, 'pending');
  });
}
