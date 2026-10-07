import { readFileSync } from 'node:fs';
import { isStorageBusy } from './database.mjs';
import { captureSnapshot, extractedItems, retainedSourceView } from './capture-input.mjs';
import { callModel } from './model-call.mjs';
import { fittingCap, prefixUnits, requestFits } from './model-packing.mjs';
import { fail, MemoryStoreError } from './validation.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import { reconcileCapture } from './ordered-capture.mjs';
import { qualifyExtractedItems } from './automatic-qualification.mjs';
import { qualifyCandidateItems } from './qualification-candidates.mjs';
import { reviewCapturedRationale } from './automatic-rationale.mjs';
import { extractedWindowItems, sourceWindowCatalog } from './source-windows.mjs';

const system = readFileSync(new URL('./prompts/extract-memories.md', import.meta.url), 'utf8');
const retainedSystem = readFileSync(new URL('./prompts/extract-retained-sources.md', import.meta.url), 'utf8');
const episodeSystem = readFileSync(new URL('./prompts/extract-episode-sources.md', import.meta.url), 'utf8');
const windowSystem = readFileSync(new URL('./prompts/extract-source-windows.md', import.meta.url), 'utf8');
const unwrap = (result) => { if (!result.ok) fail(result.error.code); return result.value; };

async function classifyAdmission(model, namespace, admission, operations, key, deadline, keep = false) {
  if (!admission.memories.length) return { status: 'skipped', reason: 'empty' };
  let attemptToken;
  try {
    deadline?.check();
    const guards = [];
    for (const admitted of admission.memories) {
      const inspected = operations.get({ namespace, memoryId: admitted.id });
      if (!inspected.ok && inspected.error.code === 'memory_not_found' && operations.isAwaiting?.(admitted.id)) continue;
      const { memory } = unwrap(inspected);
      if (memory.revision !== admitted.revision) fail('revision_conflict');
      if (memory.filing.status === 'unfiled') guards.push({ memoryId: admitted.id, revision: admitted.revision });
    }
    // Keep has its own durable admission identity; placement uses the same revision guards.
    const started = keep ? { skipped: !guards.length } : unwrap(operations.beginInitialClassification({ ...key,
      admitted: admission.memories.map(({ id, revision }) => ({ memoryId: id, revision })),
      selected: guards }));
    if (started.skipped) return { status: 'skipped', reason: 'already_filed' };
    attemptToken = started.token;
    deadline?.check();
    if (typeof model?.classify !== 'function') {
      emitDiagnostic(model, 'classify', 'core_call', 'model_not_configured');
      fail('model_not_configured');
    }
    const mapped = unwrap(operations.map({ namespace, purpose: 'classification' }));
    deadline?.check();
    const classified = unwrap(await operations.classifyPlacement({ namespace,
      memoryIds: guards.map((guard) => guard.memoryId), expectedMemoryRevisions: guards,
      mapRevision: mapped.indexRevision }));
    deadline?.check();
    const apply = keep ? operations.applyPlacement : operations.applyInitialPlacement;
    const placed = unwrap(apply({ ...(keep ? { namespace } : { ...key, token: attemptToken }),
      proposal: classified.proposal,
      expectedMemoryRevisions: classified.basedOn.memoryRevisions,
      expectedIndexRevision: classified.basedOn.indexRevision }));
    return { status: 'applied', memoryRevisions: placed.memories.map((memory) =>
      ({ memoryId: memory.id, revision: memory.revision })), indexRevision: placed.indexRevision,
    ...(classified.classificationTruncated ? { classificationTruncated: classified.classificationTruncated } : {}) };
  } catch (error) {
    if (attemptToken) {
      try { unwrap(operations.failInitialClassification({ ...key, token: attemptToken })); }
      catch { /* A failed receipt write cannot replace the original failure. */ }
    }
    const code = error instanceof MemoryStoreError ? error.code : 'classification_failed';
    return { status: 'failed', error: { code, retryable: code === 'storage_busy' } };
  }
}

/** The exact extraction request for a snapshot under one capture configuration. */
export function extractionRequest(snapshot, { captureQualification, captureSourcePolicy, episode = false }) {
  const catalog = captureSourcePolicy ? sourceWindowCatalog(snapshot) : null;
  const retained = !catalog && captureQualification === 'source-bound-v2' ? retainedSourceView(snapshot) : null;
  const sourceMessages = retained?.messages ?? snapshot.messages;
  return { catalog, retained, sourceMessages,
    system: episode ? episodeSystem : catalog ? windowSystem : retained ? retainedSystem : system,
    input: catalog?.input ?? { messages: sourceMessages.map(({ role, content }, index) => ({ index, role, content })) } };
}

/**
 * Whether an extraction request fits, counted exactly as the guarded call
 * counts it; null when the port is missing or misconfigured, which the
 * guarded call reports itself.
 */
export function extractionFits(model, request) {
  if (typeof model?.extract !== 'function' || !Number.isSafeInteger(model.contextWindow) ||
      model.contextWindow < 8192) return null;
  return requestFits(model, 'extract')(request.system, request.input);
}

// A submitted batch whose extraction request cannot fit is an input error,
// refused before any claim, staging, write or provider call. Hosts split
// batches with core.planCaptureBatches, which uses this same measurement.
export function checkExtractionFits(model, request) {
  if (extractionFits(model, request) !== false) return;
  emitDiagnostic(model, 'extract', 'core_call', 'context_budget_exceeded');
  fail('context_budget_exceeded');
}

// Keep extracts from an existing episode's staged sources, which the host did
// not size. When they cannot fit, every source stays in the request with its
// text cut to a common prefix of at least 120 units, and the result says so.
function keepRequest(model, request, deadline) {
  if (extractionFits(model, request) !== false) return { request, shortened: 0 };
  const fits = requestFits(model, 'extract', deadline);
  const messages = request.input.messages;
  const view = (cap) => ({ ...request.input, messages: messages.map((message) =>
    ({ ...message, content: prefixUnits(message.content, cap) })) });
  const cap = fittingCap(Math.max(...messages.map((message) => message.content.length)),
    (units) => fits(request.system, view(units)));
  if (cap === null) return { request, shortened: 0 };
  return { request: { ...request, input: view(cap) },
    shortened: messages.filter((message) => message.content.length > cap).length };
}

/** Public-envelope operations own all transactions; no model work runs inside them. */
export async function captureMessages({ model, modelCallTimeoutMs, input, operations, captureQualification,
  captureSourcePolicy, captureRationale, captureEvidence, deadline, episodeRun }) {
  deadline?.check();
  const snapshot = episodeRun?.snapshot ?? captureSnapshot(input, captureQualification, captureSourcePolicy);
  deadline?.check();
  let request = extractionRequest(snapshot, { captureQualification, captureSourcePolicy, episode: Boolean(episodeRun) });
  const { catalog, retained, sourceMessages } = request;
  deadline?.check();
  if (!episodeRun) checkExtractionFits(model, request);
  let extractionTruncated;
  if (episodeRun?.keep) {
    const kept = keepRequest(model, request, deadline);
    request = kept.request;
    if (kept.shortened) extractionTruncated = { messagesShortened: kept.shortened };
  }
  // Retention coverage of this submitted snapshot, not an attestation of which
  // extraction policy executed an earlier duplicate batch.
  const coverage = { ...(catalog?.coverage ?? (retained ? { retainedSourceWindow: retained.retainedSourceWindow } : {})),
    ...(captureSourcePolicy === 'indexed-evidence-v1' ? { qualificationStatus: 'not-requested' } : {}) };
  const key = { namespace: snapshot.namespace, client: snapshot.client,
    eventId: snapshot.eventId, payloadDigest: snapshot.payloadDigest };
  const claim = episodeRun ? episodeRun.claim : snapshot.causal ? unwrap(operations.ordered.claim(snapshot))
    : captureEvidence ? unwrap(operations.claimCaptureEvidence({ ...key, view: retained }))
      : unwrap(operations.claimAdmission({ ...key, leaseMs: 125000 }));
  if (claim.processing || claim.duplicate) return { ...claim, ...coverage,
    ...(captureRationale ? { rationale: { status: 'not-run', reason: claim.processing ? 'processing' : 'duplicate',
      previousOutcome: 'unavailable' } } : {}) };
  const owned = { ...key, token: claim.token };
  const qualificationReport = {};
  let finished;
  try {
    deadline?.check();
    const output = episodeRun?.skip ? { items: [] } : await callModel(model, 'extract', request.system, request.input,
      { failureCode: 'extraction_failed', deadline, modelCallTimeoutMs });
    let items = catalog ? extractedWindowItems(output, snapshot, catalog,
      reason => emitDiagnostic(model, 'extract', 'core_validation', reason)) : extractedItems(output, snapshot, retained?.messages,
      reason => emitDiagnostic(model, 'extract', 'core_validation', reason));
    deadline?.check();
    // Do not start another interpretation stage after explicit discard/forget.
    // A provider request already in flight cannot be recalled by local deletion.
    if (captureEvidence) unwrap(operations.assertCaptureEvidence(owned));
    if (captureQualification && items.length) items = captureQualification === 'source-bound-v2'
      ? await qualifyCandidateItems(model, items, deadline,
        captureEvidence ? () => unwrap(operations.assertCaptureEvidence(owned)) : undefined, Boolean(episodeRun),
        qualificationReport, modelCallTimeoutMs)
      : await qualifyExtractedItems(model, items, deadline, qualificationReport, modelCallTimeoutMs);
    deadline?.check();
    if (snapshot.causal) {
      const prepared = unwrap(operations.ordered.prepare(snapshot, claim.order, items));
      deadline?.check();
      const judged = captureQualification
        ? { decisions: [], reason: items.length ? 'qualification_requires_identity' : null }
        : await reconcileCapture({ model, modelCallTimeoutMs, snapshot, items, discovery: prepared.discovery, deadline });
      deadline?.check();
      finished = unwrap(operations.ordered.finish(snapshot, claim.token, claim.order, prepared, judged));
    } else finished = unwrap(operations.finishAdmission({ ...owned, items }));
  } catch (error) {
    // A failed or stale cleanup cannot replace the original error or release a successor's claim.
    try { operations.abandonAdmission(owned, Boolean(episodeRun &&
      (isStorageBusy(error) || (error instanceof MemoryStoreError && error.code === 'storage_busy')))); } catch { /* The bounded lease can expire. */ }
    if (error instanceof MemoryStoreError) throw error;
    if (episodeRun && isStorageBusy(error)) fail('storage_busy');
    fail(episodeRun?.keep ? 'storage_error' : 'extraction_failed');
  }
  const admission = { ...(episodeRun ? { status: 'completed' } : {}),
    memories: finished.memories, suppressedCount: finished.suppressedCount, indexRevision: finished.indexRevision };
  const classification = await classifyAdmission(model, snapshot.namespace, admission, operations, key, deadline, episodeRun?.keep);
  const rationale = captureRationale ? await reviewCapturedRationale({ snapshot, admission,
    classification, sourceMessages, operations, deadline }) : undefined;
  const { itemsShortened, itemsUnqualified } = qualificationReport;
  return { duplicate: false, admission, classification,
    ...(captureRationale ? { rationale } : {}),
    ...coverage,
    ...(finished.reconciliation ? { reconciliation: finished.reconciliation } : {}),
    ...(itemsShortened || itemsUnqualified
      ? { qualificationTruncated: { itemsShortened, itemsUnqualified, reason: 'context_budget' } } : {}),
    ...(extractionTruncated ? { extractionTruncated } : {}) };
}
