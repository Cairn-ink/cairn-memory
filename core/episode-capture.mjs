import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { episodeSnapshot } from './episode-input.mjs';
import { captureMessages } from './capture.mjs';
import { callModel } from './model-call.mjs';
import { countTokens } from './model-budget.mjs';
import { fail, MemoryStoreError } from './validation.mjs';

const system = readFileSync(new URL('./prompts/interpret-episode.md', import.meta.url), 'utf8');
const promptDigest = createHash('sha256').update(system).digest('hex');
const errorCode = error => error instanceof MemoryStoreError && error.code === 'model_timeout' ? 'episode_timeout'
  : error instanceof MemoryStoreError && ['context_budget_exceeded','invalid_model_output'].includes(error.code)
    ? error.code : 'episode_failed';

/** Pack current evidence first, then newest undrafted evidence, then prior cited context. */
export function episodeRequest(model, snapshot) {
  const target = snapshot.events.find(event => event.eventId === snapshot.targetEventId);
  if (!target) fail(snapshot.missingReason ?? 'missing_evidence');
  const sources = [], refs = [], counts = new Map();
  let prior = {};
  const request = () => ({ sources: sources.map((source, sourceIndex) => ({ sourceIndex, ...source })),
    classificationTarget: refs.flatMap((ref, index) => ref.eventId === target.eventId ? [index] : []), prior });
  const fits = () => countTokens(model, JSON.stringify({ system, input: request(), maxOutputTokens: 1024 })) <= 6000;
  const add = (event, message) => {
    sources.push({ role: message.role, text: message.content });
    refs.push({ eventId: event.eventId, messageId: message.id });
  };
  for (const message of target.view.messages) add(target, message);
  if (!fits()) fail('context_budget_exceeded');
  counts.set(target.eventId, target.view.messages.length);
  for (const event of snapshot.events) {
    if (event === target) continue;
    let count = 0;
    for (const message of [...event.view.messages].reverse()) {
      add(event, message);
      if (!fits()) { sources.pop(); refs.pop(); } else count++;
    }
    counts.set(event.eventId, count);
  }
  const included = new Map();
  // Newest first is equivalent to dropping the oldest prefix until whole sources fit.
  for (const source of [...snapshot.sources].reverse()) {
    sources.push({ role: source.role, text: source.text }); refs.push({ sourceId: source.id });
    if (!fits()) { sources.pop(); refs.pop(); break; } else included.set(source.id, refs.length - 1);
  }
  for (const field of ['type','gist','outcome','nextStep']) {
    const value = snapshot.record[field];
    const anchors = snapshot.record.anchors[field];
    if (!value || !anchors?.length || anchors.some(anchor => !included.has(anchor.sourceId))) continue;
    prior[field] = { value: field === 'nextStep' ? value.text : value,
      anchors: anchors.map(anchor => ({ sourceIndex: included.get(anchor.sourceId), start: anchor.start, end: anchor.end })) };
    if (!fits()) delete prior[field];
  }
  return { input: request(), refs,
    priorOmitted: snapshot.sources.length - included.size,
    dispositions: snapshot.events.map(event => ({ eventId: event.eventId,
      omitted: event.view.messages.length - counts.get(event.eventId),
      omittedIndices: event.view.messages.flatMap((message,index) => refs.some(ref => ref.eventId===event.eventId && ref.messageId===message.id) ? [] : [index]) })) };
}

async function interpret({ runtime, ns, model, episodeId, generation, writerToken, trigger, watermark, staging }) {
  let owned;
  try {
    const claim = runtime.claimEpisodeDraft(ns, { episodeId, generation, writerToken, trigger, watermark });
    if (claim.consumed) return { id: episodeId, status: 'not-run', reason: 'consumed' };
    owned = { episodeId, token: claim.token };
    if (claim.skipReason) fail(claim.skipReason);
    if (staging === 'not-staged') fail('capacity');
    const snapshot = runtime.episodeDraftSnapshot(ns, owned);
    const planned = episodeRequest(model, snapshot);
    const output = await callModel(model, 'interpretEpisode', system, planned.input, {
      failureCode: 'episode_failed', validateFresh: () => runtime.episodeDraftSnapshot(ns, owned),
    });
    let committed;
    try {
      committed = runtime.commitEpisodeDraft(ns, { ...owned, result: output, sources: planned.refs,
        dispositions: planned.dispositions, ...(trigger === 'batch' ? { classificationEventId: snapshot.targetEventId } : {}), priorOmitted: planned.priorOmitted,
        modelMetadata: { adapter: null, model: null, profile: null, ...model.episodeMetadata,
          promptVersion: 'interpret-episode-v1', digest: promptDigest, portVersion: 'episode-v1' } });
    } catch (error) {
      if (['invalid_input','invalid_text','episode_step_conflict'].includes(error.code)) fail('invalid_model_output');
      throw error;
    }
    return { id: episodeId, status: 'interpreted', revision: committed.revision,
      type: output.type.value, classificationTarget: snapshot.targetEventId };
  } catch (error) {
    const code = ['capacity', 'expired', 'missing_evidence', 'generation_conflict'].includes(error.code) ? error.code : errorCode(error);
    try { if (owned) runtime.failEpisodeDraft(ns, { ...owned, code }); } catch { /* Source/deletion fences win. */ }
    return { id: episodeId, status: 'failed', error: { code, retryable: false } };
  } finally { if (owned) runtime.settleEpisodeAttempt(ns, owned); }
}

async function auxiliary({ runtime, ns, model, episodeId, generation, trigger }) {
  const state = runtime.episodeCaptureState(ns, { episodeId });
  if (!state || state.observed <= state.attempted) return { id: episodeId, status: 'not-run', reason: 'no-undrafted-evidence' };
  const writer = runtime.claimEpisodeWriter(ns, { episodeId, generation });
  if (writer.processing) return { id: episodeId, status: 'processing' };
  try {
    return await interpret({ runtime, ns, model, episodeId, generation, writerToken: writer.token,
      trigger, watermark: state.observed });
  } finally { runtime.releaseEpisodeWriter(ns, { episodeId, token: writer.token }); }
}

export async function endEpisode({ runtime, ns, model, input }) {
  // Validate controls even when no session/evidence exists. End IDs are host metadata only.
  const control = runtime.getCaptureControl(ns);
  if (control.generation !== input.generation) fail('generation_conflict');
  if (control.paused || !control.enabled) fail('capture_disabled');
  const state = runtime.episodeCaptureState(ns, input);
  if (!state) return { episode: { status: 'not-run', reason: 'no-undrafted-evidence' } };
  return { episode: await auxiliary({ runtime, ns, model, episodeId: state.episodeId,
    generation: input.generation, trigger: 'end' }) };
}

export async function captureEpisodeMessages(options) {
  const { runtime, ns, model, input, startAdmission } = options;
  const snapshot = episodeSnapshot(input);
  const batch = { client: snapshot.client, sessionId: snapshot.sessionId, eventId: snapshot.eventId,
    payloadDigest: snapshot.payloadDigest, ...snapshot.episodeContext, view: snapshot.view,
    messages: snapshot.messages, eventStart: snapshot.eventStart, eventEnd: snapshot.eventEnd,
    eventTimeCoverage: snapshot.eventTimeCoverage };
  delete batch.origin;
  const checked = runtime.validateEpisodeBatch(ns, batch);
  if (checked.processing) return { processing: true, episode: { status: 'processing' }, admission: { status: 'processing' } };
  if (checked.overlap) return { duplicate: true, overlap: true, episode: { id: checked.episodeId, status: 'not-run', reason: 'overlap' },
    admission: { status: 'covered' } };
  let lazy;
  if (!checked.duplicate) {
    const pending = runtime.pendingEpisodeSession(ns, batch);
    if (pending) lazy = await auxiliary({ runtime, ns, model, episodeId: pending, generation: batch.generation, trigger: 'lazy' });
  }
  let registered;
  try { registered = runtime.reserveEpisodeBatch(ns, { ...batch, acquireWriter: true }); }
  catch (error) {
    if (error.code !== 'episode_processing') throw error;
    return { processing: true, episode: { status: 'processing' }, admission: { status: 'processing' } };
  }
  const episodeId = registered.episodeId;
  if (registered.processing) return { processing: true, episode: { id: episodeId, status: 'processing' }, admission: { status: 'processing' } };
  if (registered.overlap) return { duplicate: true, overlap: true, episode: { id: episodeId, status: 'not-run', reason: 'overlap' }, admission: { status: 'covered' } };
  const writerToken = registered.token;
  try {
    let state = runtime.episodeCaptureState(ns, { episodeId, client: batch.client, eventId: batch.eventId });
    let episode = { id: episodeId, status: 'not-run', reason: registered.duplicate ? 'replay' : 'debounced' };
    const due = !state.draftConsumed && state.admission !== 'completed' && (state.attempted === 0 ||
      registered.position - state.attempted >= state.draftEvery || snapshot.episodeContext.origin === 'precompact');
    if (due) episode = await interpret({ runtime, ns, model, episodeId, generation: batch.generation,
      writerToken, trigger: 'batch', watermark: registered.position, staging: registered.staging });
    state = runtime.episodeCaptureState(ns, { episodeId, client: batch.client, eventId: batch.eventId });
    const deadline = startAdmission?.();
    const claim = runtime.claimAdmission(ns, { client: batch.client, eventId: batch.eventId,
      payloadDigest: batch.payloadDigest, leaseMs: 125000, episodeWriterToken: writerToken });
    // Only the HMAC session identity can enter newly admitted receipts.
    snapshot.sessionId = registered.sessionKey;
    const result = await captureMessages({ ...options, deadline,
      episodeRun: { snapshot, claim, skip: state.policy === 'skip-quick' } });
    return { ...result, episode, ...(lazy ? { lazyEpisode: lazy } : {}),
      ...(result.duplicate ? { admission: { status: 'completed', memoryIds: result.memoryIds, suppressedCount: result.suppressedCount } }
        : result.processing ? { admission: { status: 'processing' } } : {}) };
  } finally { runtime.releaseEpisodeWriter(ns, { episodeId, token: writerToken }); }
}

export async function keepEpisodeCapture(options) {
  const { runtime, ns, keepInput, startAdmission } = options;
  const kept = runtime.prepareEpisodeKeep(ns, keepInput);
  if (kept.failure) fail(kept.failure);
  const claim = runtime.claimAdmission(ns, { ...kept.key, leaseMs: 125000 });
  if (claim.duplicate || claim.processing) return { ...claim, episode: { id: keepInput.episodeId, policy: 'explicit-keep', sourceCoverage: kept.coverage },
    admission: { status: claim.duplicate ? 'completed' : 'processing', memoryIds: claim.memoryIds } };
  kept.admissionToken = claim.token;
  const deadline = startAdmission?.();
  const snapshot = { namespace: options.input.namespace, client: kept.client, eventId: kept.key.eventId,
    payloadDigest: kept.key.payloadDigest, sessionId: kept.sessionKey, messages: kept.sources.map(source =>
      ({ id: source.message_id, role: source.role, content: source.text })), captureQualification: 'source-bound-v2', sessionEpisodes: 'episode-v1' };
  const operations = { ...options.operations,
    assertCaptureEvidence: value => { runtime.assertEpisodeKeep(ns, kept); return options.operations.assertCaptureEvidence(value); },
    finishAdmission: value => {
      runtime.assertEpisodeKeep(ns, kept);
      // The runtime completion guard repeats the check inside the admission transaction.
      return options.operations.finishAdmission(value);
    } };
  try {
    const result = await captureMessages({ ...options, operations, deadline, episodeRun: { snapshot, claim, skip: false, keep: true } });
    return { ...result, episode: { id: keepInput.episodeId, policy: 'explicit-keep', sourceCoverage: kept.coverage } };
  } catch (error) {
    const code = error instanceof MemoryStoreError ? error.code : 'storage_error';
    try { runtime.failEpisodeKeep(ns, kept, code); } catch { /* Preserve the original failure. */ }
    throw error;
  }
}
