import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { openMemoryCore } from '../contract.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { interpretation } from '../testing/episode-capture-helpers.mjs';
import { fixture, ns, request, splitRaw, localPlainPort, ok, usage, count } from '../testing/raw-capture-fixtures.mjs';

const empty = () => ({ items: [] });
const item = () => ({ items: [{ content: 'Synthetic shared interpretation.', kind: 'fact', confidence: .8, sourceIndices: [0] }] });
const error = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };
const key = async (f, id, actionId = 'delete') => ({ namespace: ns, conversationId: id, actionId,
  expectedRevision: ok(await f.core.getConversation({ namespace: ns, conversationId: id })).conversation.revision });
const legacy = (client, sessionId, eventId, id = 'message') => ({ namespace: ns, client, sessionId, eventId,
  messages: [{ id, role: 'user', content: 'Synthetic retained source.' }] });

for (const client of ['claude-code', 'codex']) {
  for (const kind of ['staged', 'ordered']) test(`P3b-08 ${client}: ${kind} actual claim binds session and closed retry cannot dispatch`, async t => {
    const f = fixture(t, { deletion: true, model: { extract: empty } });
    const first = ok(await f.core.captureRaw(request(splitRaw('Synthetic retained source.')[0], { client, sessionId: 'A' })));
    let remove = true, calls = 0;
    const writer = openMemoryCore({ path: f.path, ...(kind === 'staged' ? {
      captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' } : {}),
      model: { ...f.model, extract: async () => {
        calls++;
        const binding = f.db.prepare("SELECT * FROM raw_job_sources WHERE event_id='pending-job'").get();
        assert.equal(binding.source_client, client); assert.equal(binding.message_id, 'message');
        if (remove) { remove = false; ok(f.core.deleteConversation(await key(f, first.raw.conversationId))); }
        return item();
      } } });
    f.workspace.defer(() => writer.close());
    const input = { ...legacy(client, 'A', 'pending-job'), ...(kind === 'ordered' ? { causal: { streamId: 'stream', sequence: 1 } } : {}) };
    error(await writer.capture(input), 'conversation_deleted');
    assert.equal(calls, 1); assert.equal(count(f.db, 'raw_job_sources'), 0);
    const stage = f.db.prepare("SELECT * FROM staged_capture_evidence WHERE event_id='pending-job'").get();
    if (kind === 'staged') { assert.equal(stage.state, 'forgotten'); assert.equal(stage.payload, null); assert.equal(stage.payload_bytes, 0); }
    error(await writer.capture(input), 'conversation_deleted'); assert.equal(calls, 1);
    assert.equal(f.db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n, 0);
  });

  test(`P3b-08 ${client}: actual keep binds original sources and deletion during extraction closes its action`, async t => {
    let removing = false, f, conversation;
    f = fixture(t, { kind: 'episode', deletion: true, model: { extract: async () => {
      if (removing) {
        const bindings = f.db.prepare('SELECT * FROM raw_job_sources WHERE event_id IN (SELECT event_id FROM episode_keep_actions)').all();
        assert.equal(bindings.length, 1); assert.equal(bindings[0].source_client, client);
        assert.equal(bindings[0].message_id, 'message');
        ok(f.core.deleteConversation(await key(f, conversation)));
      }
      return empty();
    } } });
    const first = ok(await f.core.captureRaw(request(splitRaw('Synthetic retained source.')[0], { client }, 'episode')));
    conversation = first.raw.conversationId;
    const episode = ok(f.core.getEpisode({ namespace: ns, episodeId: ok(first.interpretation).episode.id })).episode;
    removing = true;
    error(await f.core.keepEpisode({ namespace: ns, episodeId: episode.id, expectedRevision: episode.revision, actionId: 'keep' }), 'conversation_deleted');
    const action = f.db.prepare('SELECT * FROM episode_keep_actions').get();
    assert.equal(action.keep_state, 'failed'); assert.equal(action.keep_error_code, 'capture_evidence_closed');
    assert.equal(action.token, null); assert.equal(action.lease_expires_at, null);
    assert.equal(count(f.db, 'raw_job_sources'), 0); assert.equal(count(f.db, 'raw_closed_jobs'), 1);
    assert.equal(count(f.db, 'episode_sources'), 0);
  });

  test(`P3b-02/08 ${client}: expired retained pre-upgrade staging refuses before any deletion`, async t => {
    const f = fixture(t, { kind: 'staged', model: { extract: () => { throw Error('Synthetic extraction failure'); } } });
    error(await f.core.capture(legacy(client, 'unprovable-legacy', 'old-job')), 'extraction_failed');
    const row = f.db.prepare('SELECT * FROM staged_capture_evidence').get();
    assert.equal(typeof row.payload, 'string');
    const selected = openRawCaptureCore({ path: f.path, model: { ...f.model, extract: empty } }, {
      mode: 'raw-v1', deletion: true, port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }) });
    f.workspace.defer(() => selected.close());
    const first = ok(await selected.captureRaw(request(splitRaw('Synthetic target source.')[0], { client, sessionId: 'A' })));
    // Advance expiry after registration; a new capture legitimately touches and
    // purges expired staging, whereas preview/delete themselves must not.
    f.db.prepare("UPDATE staged_capture_evidence SET expires_at=0 WHERE event_id='old-job'").run();
    f.db.prepare("UPDATE admission_claims SET lease_expires_at=0 WHERE event_id='old-job'").run();
    const input = { namespace: ns, conversationId: first.raw.conversationId,
      expectedRevision: ok(await selected.getConversation({ namespace: ns, conversationId: first.raw.conversationId })).conversation.revision };
    const before = usage(selected), changes = f.db.prepare('PRAGMA data_version').get().data_version;
    error(selected.previewDeleteConversation(input), 'raw_lineage_unavailable');
    error(selected.deleteConversation({ ...input, actionId: 'delete' }), 'raw_lineage_unavailable');
    assert.equal(f.db.prepare('PRAGMA data_version').get().data_version, changes);
    assert.deepEqual(usage(selected), before); assert.equal(count(f.db, 'raw_session_fences'), 0);
    assert.equal(f.db.prepare("SELECT payload FROM staged_capture_evidence WHERE event_id='old-job'").get().payload, row.payload);
    // An unbound foreign-client job is not authority to block this client.
    const otherClient = client === 'codex' ? 'claude-code' : 'codex';
    const other = ok(await selected.captureRaw(request(splitRaw('Other client source.')[0], { client: otherClient, sessionId: 'B' })));
    ok(selected.deleteConversation({ namespace: ns, conversationId: other.raw.conversationId, actionId: 'other',
      expectedRevision: ok(await selected.getConversation({ namespace: ns, conversationId: other.raw.conversationId })).conversation.revision }));
  });

  for (const barrier of ['project', 'client']) test(`P3b-09 ${client}: option-off ${barrier} closure preserves other roots and never backfills`, async t => {
    const f = fixture(t, { deletion: true, model: { extract: empty } });
    const writer = openMemoryCore({ path: f.path }); f.workspace.defer(() => writer.close());
    const target = barrier === 'project' ? { ...ns, scope: 'project', projectId: 'target' } : ns;
    const other = barrier === 'project' ? { ...target, projectId: 'other' } : { ...ns, ownerId: 'other-owner' };
    const parts = splitRaw('x'.repeat(8000));
    for (const namespace of [target, other]) ok(await f.core.captureRaw(request(parts[0], { namespace, client })));
    const opposite = client === 'codex' ? 'claude-code' : 'codex';
    ok(await f.core.captureRaw(request(parts[0], { namespace: target, client: opposite })));
    let generation;
    if (barrier === 'project') {
      generation = ok(writer.setProjectCapture({ namespace: target, expectedGeneration: 'initial', enabled: false })).generation;
      ok(writer.setProjectCapture({ namespace: target, expectedGeneration: generation, enabled: true }));
    } else {
      // Raw-off is an internal owner/client control, not a new public option.
      ok(f.core.setRawCaptureControl({ ownerId: ns.ownerId, client, expectedRevision: 0, enabled: false }));
      ok(f.core.setRawCaptureControl({ ownerId: ns.ownerId, client, expectedRevision: 1, enabled: true }));
    }
    const states = f.db.prepare('SELECT c.owner_id,c.project_id,c.client,m.assembly_state FROM raw_messages m JOIN raw_conversations c ON c.id=m.conversation_id').all();
    assert.equal(states.filter(row => row.assembly_state === 'closed').length, barrier === 'project' ? 2 : 1);
    const late = ok(await f.core.captureRaw(request(parts[1], { namespace: target, client })));
    assert.equal(late.raw.parts[0].saved, false);
    assert.equal(late.raw.parts[0].reason, barrier === 'project' ? 'capture_barrier' : 'tool_off');
    const fresh = ok(await f.core.captureRaw(request(splitRaw('Fresh after resume.', { id: 'fresh', ordinal: 2 })[0], { namespace: target, client })));
    assert.equal(fresh.raw.parts[0].saved, true);
  });

  for (const state of ['skipped', 'incomplete']) test(`P3b-05/11 ${client}: ${state} usage is released once without fabricated Memory`, async t => {
    const f = fixture(t, { deletion: true, ...(state === 'skipped' ? { capBytes: 1 } : {}), model: { extract: empty } });
    const first = ok(await f.core.captureRaw(request(splitRaw('x'.repeat(8000))[0], { client })));
    assert.equal(first.raw.parts[0].saved, state !== 'skipped');
    const before = usage(f.core); assert.equal(before.reservedBytes, state === 'skipped' ? 0 : 4000);
    const input = await key(f, first.raw.conversationId), result = ok(f.core.deleteConversation(input));
    assert.equal(result.forgottenMemories, 0); assert.equal(result.removedReceipts, 0);
    assert.equal(usage(f.core).savedBytes, 0); assert.equal(usage(f.core).reservedBytes, 0);
    f.reopen(); assert.deepEqual(ok(f.core.deleteConversation(input)), result); assert.equal(usage(f.core).savedBytes, 0);
  });
}

for (const kind of ['ordinary', 'episode', 'raw']) test(`P3b-03 ${kind} source-root proof changes invalidate CAS without a new receipt`, async t => {
  const f = fixture(t, { lineage: true, model: { extract: item } });
  const old = legacy('codex', 'B', 'legacy-B'); ok(await f.core.capture(old));
  const selected = openRawCaptureCore({ path: f.path, model: f.model }, { mode: 'raw-v1', deletion: true,
    port: localPlainPort(), readPolicy: () => ({ generation: 'synthetic', reason: null }) });
  f.workspace.defer(() => selected.close());
  const source = ok(await selected.captureRaw(request(splitRaw('Synthetic retained source.')[0], { client: 'codex', sessionId: 'A' })));
  const input = { namespace: ns, conversationId: source.raw.conversationId,
    expectedRevision: ok(await selected.getConversation({ namespace: ns, conversationId: source.raw.conversationId })).conversation.revision };
  error(selected.previewDeleteConversation(input), 'raw_lineage_unavailable');
  const parts = count(f.db, 'raw_parts'), receipts = f.db.prepare('SELECT * FROM receipts ORDER BY id').all();
  const writer = kind === 'ordinary' ? selected : kind === 'raw'
    ? openRawCaptureCore({ path: f.path, model: { ...f.model, extract: empty } }, { mode: 'raw-v1', port: localPlainPort(),
      readPolicy: () => ({ generation: 'synthetic', reason: null }) })
    : openMemoryCore({ path: f.path, model: { ...f.model, extract: empty },
      captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1', sessionEpisodes: { mode: 'episode-v1' } });
  if (writer !== selected) f.workspace.defer(() => writer.close());
  if (kind === 'raw') ok(ok(await writer.captureRaw(request(splitRaw(old.messages[0].content)[0], {
    client: old.client, sessionId: old.sessionId, eventId: 'reprove-B' }))).interpretation);
  else ok(await writer.capture({ ...old, eventId: 'reprove-B', ...(kind === 'episode' ? {
    episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' } } : {}) }));
  assert.equal(count(f.db, 'raw_parts'), parts + (kind === 'raw' ? 1 : 0));
  assert.deepEqual(f.db.prepare('SELECT * FROM receipts ORDER BY id').all(), receipts);
  error(selected.previewDeleteConversation(input), 'revision_conflict');
});

for (const client of ['claude-code', 'codex']) test(`P3b-07/08 ${client}: source-only cross-client consumer and pending keep close by original root`, async t => {
  const f = fixture(t, { kind: 'episode', deletion: true, model: { extract: empty } });
  const first = ok(await f.core.captureRaw(request(splitRaw('Synthetic original episode source.')[0], { client, sessionId: 'A' }, 'episode')));
  const origin = ok(first.interpretation).episode.id;
  const passage = f.db.prepare('SELECT id FROM episode_sources WHERE episode_id=?').get(origin);
  const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  f.workspace.defer(() => runtime.close());
  const internal = { ...ns, projectId: '' };
  const consumerClient = client === 'codex' ? 'claude-code' : 'codex';
  const messages = [{ id: 'consumer-message', role: 'assistant', content: 'Synthetic independent consumer source.', occurredAt: null }];
  const batch = { client: consumerClient, clientLabel: 'Synthetic', sessionId: 'B', eventId: 'consumer-event', generation: 'initial',
    payloadDigest: createHash('sha256').update('synthetic-consumer').digest('hex'), messages,
    view: { messages: messages.map(({ occurredAt, ...message }) => message),
      retainedSourceWindow: { maxUnitsPerMessage: 800, truncatedMessageIndices: [] } } };
  const reserved = runtime.reserveEpisodeBatch(internal, batch);
  const writer = runtime.claimEpisodeWriter(internal, { episodeId: reserved.episodeId, generation: 'initial' });
  const draft = runtime.claimEpisodeDraft(internal, { episodeId: reserved.episodeId, generation: 'initial', writerToken: writer.token,
    trigger: 'batch', watermark: reserved.position });
  const field = value => ({ value, anchors: [{ sourceIndex: 0, start: 0, end: 10 }] });
  runtime.commitEpisodeDraft(internal, { episodeId: reserved.episodeId, token: draft.token,
    sources: [{ sourceId: passage.id }, { eventId: batch.eventId, messageId: messages[0].id }],
    result: { type: field('work'), language: 'mixed', gist: field('Synthetic inherited prose.'), outcome: null, nextStep: field('Synthetic inherited step.'), disposition: null },
    dispositions: [{ eventId: batch.eventId, omitted: 0 }],
    modelMetadata: { adapter: 'scripted', model: null, profile: null, promptVersion: 'synthetic', digest: 'a'.repeat(64), portVersion: 'episode-v1' } });
  runtime.releaseEpisodeWriter(internal, { episodeId: reserved.episodeId, token: writer.token });
  const detail = ok(f.core.getEpisode({ namespace: ns, episodeId: reserved.episodeId })).episode;
  const action = { episodeId: detail.id, expectedRevision: detail.revision, actionId: 'pending-cross-client-keep' };
  const kept = runtime.prepareEpisodeKeep(internal, action);
  const bindings = f.db.prepare('SELECT * FROM raw_job_sources WHERE event_id=?').all(kept.key.eventId);
  // The real commit prunes uncited passages; this keep retains only A even
  // though its action belongs to the other client's B episode.
  assert.equal(bindings.length, 1); assert.equal(bindings[0].source_client, client);
  assert.equal(count(f.db, 'memories'), 0); assert.equal(count(f.db, 'episode_memory_links'), 0);
  const result = ok(f.core.deleteConversation(await key(f, first.raw.conversationId)));
  assert.equal(result.invalidatedEpisodes, 2); assert.equal(result.forgottenMemories, 0);
  const consumer = f.db.prepare('SELECT * FROM session_episodes WHERE id=?').get(detail.id);
  assert.equal(consumer.deleted, 0);
  const record = JSON.parse(consumer.record); assert.equal(record.gist, null); assert.equal(record.nextStep, null);
  assert.equal(count(f.db, 'episode_sources'), 0);
  assert.equal(f.db.prepare('SELECT keep_state FROM episode_keep_actions WHERE event_id=?').get(kept.key.eventId).keep_state, 'failed');
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_job_sources WHERE event_id=?').get(kept.key.eventId).n, 0);
  error(await f.core.keepEpisode({ namespace: ns, ...action }), 'capture_evidence_closed');
});
