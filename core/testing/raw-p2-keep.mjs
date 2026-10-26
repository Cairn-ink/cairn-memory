// Frozen actual pre-P3a keep entrypoint from 9a7bbe59c9c0ec72227310cece43fce7ac589c6e.
// Only imports are relocated; the shared capture engine retains the old snapshot fallback.
import { captureMessages } from '../capture.mjs';
import { fail, MemoryStoreError } from '../validation.mjs';

export async function keepEpisodeCapture(options) {
  const { runtime, ns, keepInput, startAdmission } = options;
  const kept = runtime.prepareEpisodeKeep(ns, keepInput);
  if (kept.failure) fail(kept.failure);
  const claim = runtime.claimAdmission(ns, { ...kept.key, leaseMs: 125000 });
  if (claim.duplicate || claim.processing) return { ...claim,
    episode: { id: keepInput.episodeId, policy: 'explicit-keep', sourceCoverage: kept.coverage },
    admission: { status: claim.duplicate ? 'completed' : 'processing', memoryIds: claim.memoryIds } };
  kept.admissionToken = claim.token;
  const deadline = startAdmission?.();
  const snapshot = { namespace: options.input.namespace, client: kept.client, eventId: kept.key.eventId,
    payloadDigest: kept.key.payloadDigest, sessionId: kept.sessionKey,
    messages: kept.sources.map(source =>
      ({ id: source.message_id, role: source.role, content: source.text })),
    captureQualification: 'source-bound-v2', sessionEpisodes: 'episode-v1' };
  const operations = { ...options.operations,
    assertCaptureEvidence: value => {
      runtime.assertEpisodeKeep(ns, kept);
      return options.operations.assertCaptureEvidence(value);
    },
    finishAdmission: value => {
      runtime.assertEpisodeKeep(ns, kept);
      // The runtime completion guard repeats the check inside the admission transaction.
      return options.operations.finishAdmission(value);
    } };
  try {
    const result = await captureMessages({ ...options, operations, deadline,
      episodeRun: { snapshot, claim, skip: false, keep: true } });
    return { ...result, episode: {
      id: keepInput.episodeId, policy: 'explicit-keep', sourceCoverage: kept.coverage } };
  } catch (error) {
    const code = error instanceof MemoryStoreError ? error.code : 'storage_error';
    try { runtime.failEpisodeKeep(ns, kept, code); } catch { /* Preserve the original failure. */ }
    throw error;
  }
}

