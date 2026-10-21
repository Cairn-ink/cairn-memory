import { createHash } from 'node:crypto';
import assert from 'node:assert/strict';
import { createMemoryRuntime } from '../runtime.mjs';
import { memoryInput } from '../validation.mjs';
import { keepEpisodeCapture as p2Keep } from './raw-p2-keep.mjs';
import { fixture, ns, ok } from './raw-capture-fixtures.mjs';

export const internal = { ...ns, projectId: '' };
export const empty = () => ({ items: [] });
export const opposite = client => client === 'codex' ? 'claude-code' : 'codex';
export const episodeInput = (client, sessionId, id = 'message', namespace = ns) => ({ namespace, client, sessionId, eventId: 'event-' + sessionId,
  episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' },
  messages: [{ id, role: 'user', content: 'Synthetic original source ' + sessionId + '.', occurredAt: null }] });
export function runtimeFor(f) {
  const runtime = createMemoryRuntime({ path: f.path, sessionEpisodes: { mode: 'episode-v1' } });
  f.workspace.defer(() => runtime.close()); return runtime;
}
export function consumer(f, runtime, { client, sessionId = 'B', eventId = 'event-B', sourceIds = [], own = false,
  namespace = internal, beforeCommit = () => {} }) {
  const messages = [{ id: 'consumer-' + eventId, role: 'assistant', content: 'Synthetic consumer source.', occurredAt: null }];
  const batch = { client, clientLabel: 'Synthetic', sessionId, eventId, generation: 'initial',
    payloadDigest: createHash('sha256').update(eventId).digest('hex'), messages,
    view: { messages: messages.map(({ occurredAt, ...message }) => message),
      retainedSourceWindow: { maxUnitsPerMessage: 800, truncatedMessageIndices: [] } } };
  const reserved = runtime.reserveEpisodeBatch(namespace, batch);
  const writer = runtime.claimEpisodeWriter(namespace, { episodeId: reserved.episodeId, generation: 'initial' });
  const claimed = runtime.claimEpisodeDraft(namespace, { episodeId: reserved.episodeId, generation: 'initial', writerToken: writer.token,
    trigger: 'batch', watermark: reserved.position });
  const refs = [...sourceIds.map(sourceId => ({ sourceId })), { eventId, messageId: messages[0].id }];
  const indices = own ? [refs.length - 1] : sourceIds.map((_, index) => index);
  const field = value => ({ value, anchors: indices.map(sourceIndex => ({ sourceIndex, start: 0, end: 10 })) });
  const commit = { episodeId: reserved.episodeId, token: claimed.token, sources: refs,
    result: { type: field('work'), language: 'mixed', gist: field('Synthetic consumer prose.'), outcome: null, nextStep: null, disposition: null },
    dispositions: [{ eventId, omitted: 0 }], modelMetadata: { adapter: 'scripted', model: null, profile: null,
      promptVersion: 'synthetic', digest: 'a'.repeat(64), portVersion: 'episode-v1' } };
  beforeCommit({ episodeId: reserved.episodeId, commit });
  let result;
  try { result = runtime.commitEpisodeDraft(namespace, commit); }
  finally { runtime.releaseEpisodeWriter(namespace, { episodeId: reserved.episodeId, token: writer.token }); }
  const claim = runtime.claimAdmission(namespace, { ...batch, leaseMs: 125000 });
  runtime.finishAdmission(namespace, { ...batch, token: claim.token, items: [] });
  return { id: reserved.episodeId, result, batch, commit };
}
export async function legacyKeep(f, runtime, episodeId, content = 'Synthetic legacy interpretation.') {
  const invoke = work => { try { return { ok: true, value: work() }; } catch (error) { return { ok: false, error: { code: error.code } }; } };
  const key = value => ({ ...value, keepActionId: value.eventId });
  const episode = ok(f.core.getEpisode({ namespace: ns, episodeId })).episode;
  return p2Keep({ runtime, ns: internal, input: { namespace: ns }, keepInput: {
    episodeId, expectedRevision: episode.revision, actionId: 'p2-keep' },
    model: { ...f.model, extract: () => ({ items: [{ content, kind: 'fact', confidence: .8, sourceIndices: [0] }] }) },
    captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1',
    operations: {
      finishAdmission: value => invoke(() => runtime.finishCapturedAdmission(internal, { ...key(value), items: value.items.map(item => {
        const { receipt, ...memory } = memoryInput({ content: item.content, kind: item.kind, origin: 'agent-inferred',
          confidence: item.confidence, receipt: item.receipts[0] });
        return { ...memory, receipts: item.receipts, conflictHints: [], qualification: item.qualification };
      }) })),
      assertCaptureEvidence: value => invoke(() => runtime.assertCaptureEvidence(internal, key(value))),
      abandonAdmission: value => runtime.abandonAdmission(internal, key(value)),
      get: f.core.get, map: f.core.map, classifyPlacement: f.core.classifyPlacement, applyPlacement: f.core.applyPlacement,
    } });
}
export async function legacyFixture(t, client, consumerClient = opposite(client), qualified = false) {
  const f = fixture(t, { kind: 'episode', model: { extract: empty, ...(qualified ? {
    qualifyCandidates: ({ input }) => ({ qualifications: input.items.map(item => ({ itemIndex: item.itemIndex,
      ...Object.fromEntries(['subject','property','scope','applies','value','attribution','commitment'].map(field => [field,
        { value: field === 'attribution' ? 'direct' : field === 'commitment' ? 'adopted' : field === 'value' ? 'old' : 'Synthetic',
          evidenceIndices: [item.candidates[0].candidateIndex] }])) })) }),
  } : {}) } });
  const origin = ok(await f.core.capture(episodeInput(client, 'A'))).episode.id;
  const source = f.db.prepare('SELECT id FROM episode_sources WHERE episode_id=?').get(origin);
  const runtime = runtimeFor(f), inherited = consumer(f, runtime, { client: consumerClient, sourceIds: [source.id] });
  const kept = await legacyKeep(f, runtime, inherited.id), memoryId = kept.admission.memories[0].id;
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 25);
  assert.deepEqual(f.db.prepare(`SELECT name FROM sqlite_master WHERE name IN
    ('raw_receipt_lineage','raw_receipt_origins','raw_job_sources')`).all(), []);
  return { ...f, origin, runtime, consumer: inherited.id, memoryId };
}
