import { readFileSync } from 'node:fs';
import { captureSnapshot, extractedItems } from './capture-input.mjs';
import { callModel } from './model-call.mjs';
import { fail, MemoryStoreError } from './validation.mjs';
import { emitDiagnostic } from './model-diagnostics.mjs';
import { reconcileCapture } from './ordered-capture.mjs';

const system = readFileSync(new URL('./prompts/extract-memories.md', import.meta.url), 'utf8');
const unwrap = (result) => { if (!result.ok) fail(result.error.code); return result.value; };

async function classifyAdmission(model, namespace, admission, operations) {
  if (!admission.memories.length) return { status: 'skipped', reason: 'empty' };
  try {
    const guards = [];
    for (const admitted of admission.memories) {
      const { memory } = unwrap(operations.get({ namespace, memoryId: admitted.id }));
      if (memory.revision !== admitted.revision) fail('revision_conflict');
      if (memory.filing.status === 'unfiled') guards.push({ memoryId: admitted.id, revision: admitted.revision });
    }
    if (!guards.length) return { status: 'skipped', reason: 'already_filed' };
    if (typeof model?.classify !== 'function') {
      emitDiagnostic(model, 'classify', 'core_call', 'model_not_configured');
      fail('model_not_configured');
    }
    const mapped = unwrap(operations.map({ namespace, purpose: 'classification' }));
    const classified = unwrap(await operations.classifyPlacement({ namespace,
      memoryIds: guards.map((guard) => guard.memoryId), expectedMemoryRevisions: guards,
      mapRevision: mapped.indexRevision }));
    const placed = unwrap(operations.applyPlacement({ namespace, proposal: classified.proposal,
      expectedMemoryRevisions: classified.basedOn.memoryRevisions,
      expectedIndexRevision: classified.basedOn.indexRevision }));
    return { status: 'applied', memoryRevisions: placed.memories.map((memory) =>
      ({ memoryId: memory.id, revision: memory.revision })), indexRevision: placed.indexRevision };
  } catch (error) {
    const code = error instanceof MemoryStoreError ? error.code : 'classification_failed';
    return { status: 'failed', error: { code, retryable: code === 'storage_busy' } };
  }
}

/** Public-envelope operations own all transactions; no model work runs inside them. */
export async function captureMessages({ model, input, operations }) {
  const snapshot = captureSnapshot(input);
  const key = { namespace: snapshot.namespace, client: snapshot.client,
    eventId: snapshot.eventId, payloadDigest: snapshot.payloadDigest };
  const claim = snapshot.causal ? unwrap(operations.ordered.claim(snapshot))
    : unwrap(operations.claimAdmission({ ...key, leaseMs: 125000 }));
  if (claim.processing || claim.duplicate) return claim;
  const owned = { ...key, token: claim.token };
  let finished;
  try {
    const output = await callModel(model, 'extract', system, {
      messages: snapshot.messages.map(({ role, content }, index) => ({ index, role, content })),
    }, { failureCode: 'extraction_failed' });
    let items;
    try { items = extractedItems(output, snapshot); }
    catch (error) { emitDiagnostic(model, 'extract', 'core_validation', 'invalid_extraction'); throw error; }
    if (snapshot.causal) {
      const prepared = unwrap(operations.ordered.prepare(snapshot, claim.order, items));
      const judged = await reconcileCapture({ model, snapshot, items, discovery: prepared.discovery });
      finished = unwrap(operations.ordered.finish(snapshot, claim.token, claim.order, prepared, judged));
    } else finished = unwrap(operations.finishAdmission({ ...owned, items }));
  } catch (error) {
    // A failed or stale cleanup cannot replace the original error or release a successor's claim.
    try { operations.abandonAdmission(owned); } catch { /* The bounded lease can expire. */ }
    if (error instanceof MemoryStoreError) throw error;
    fail('extraction_failed');
  }
  const admission = { memories: finished.memories, suppressedCount: finished.suppressedCount,
    indexRevision: finished.indexRevision };
  const classification = await classifyAdmission(model, snapshot.namespace, admission, operations);
  return { duplicate: false, admission, classification,
    ...(finished.reconciliation ? { reconciliation: finished.reconciliation } : {}) };
}
