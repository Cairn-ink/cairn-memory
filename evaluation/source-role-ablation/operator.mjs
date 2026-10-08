// Trusted maintainer entry point only: no CLI, environment discovery or fallback fetch.
import { createOpenAIModel } from '../../adapters/openai/index.mjs';
import { checkExtractionFits } from '../../core/capture.mjs';
import { callModel } from '../../core/model-call.mjs';
import { extractedWindowItems } from '../../core/source-windows.mjs';
import { MemoryStoreError } from '../../core/validation.mjs';
import { createSourceRoleAblationRequestGuard } from '../experiment-budget/request-guard.mjs';
import { snapshotJson, freeze } from '../longmemeval/mixed-validation.mjs';
import { prepareSourceRoleArm } from './compiler.mjs';

const keys = ['ledger', 'policy', 'benchmarkExtension', 'sourceRoleAblationCapability',
  'apiKey', 'fetchImpl', 'persistSlot'];
const finiteRefusals = new Set(['invalid_model_output', 'invalid_extraction', 'context_budget_exceeded',
  'token_count_unavailable', 'extraction_failed', 'model_timeout', 'model_cancelled']);

function configured(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype ||
    Reflect.ownKeys(options).length !== keys.length) throw new Error('invalid_source_role_operator');
  const descriptors = Object.getOwnPropertyDescriptors(options);
  for (const key of keys) {
    if (!descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value')) {
      throw new Error('invalid_source_role_operator');
    }
  }
  const data = Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  if (typeof data.apiKey !== 'string' || data.apiKey.length < 1 || data.apiKey.length > 4096 ||
    typeof data.fetchImpl !== 'function' || typeof data.persistSlot !== 'function') {
    throw new Error('invalid_source_role_operator');
  }
  const detached = snapshotJson(Object.fromEntries(keys.filter(key =>
    !['apiKey', 'fetchImpl', 'persistSlot'].includes(key)).map(key => [key, data[key]])),
  { bytes: 1_000_000, nodes: 100_000, depth: 32 }, 'invalid_source_role_operator');
  return { ...detached, apiKey: data.apiKey, fetchImpl: data.fetchImpl, persistSlot: data.persistSlot };
}

function passagesFor(items, catalog) {
  const passages = [];
  for (const item of items) for (const receipt of item.receipts) {
    const entry = catalog.entries.find(entry => entry.id === receipt.eventId &&
      entry.role === receipt.role && entry.content === receipt.excerpt);
    if (!entry) throw new Error('source_role_binding_failed');
    if (!passages.some(passage => passage.index === entry.index)) passages.push({ index: entry.index,
      messageIndex: entry.messageIndex, messageId: entry.id, role: entry.role,
      start: entry.start, end: entry.end, excerpt: entry.content });
  }
  return passages;
}

const attemptProjection = attempts => attempts.map(attempt => ({
  stage: attempt.stage, outcome: attempt.outcome, actualMicroUsd: attempt.actualMicroUsd,
  reservedMicroUsd: attempt.reservedMicroUsd }));

/** Runs exactly the frozen 24 slots once; the caller owns private durable persistence. */
export async function runSourceRoleAblation(options) {
  const config = configured(options);
  const guard = await createSourceRoleAblationRequestGuard({ ledger: config.ledger, policy: config.policy,
    benchmarkExtension: config.benchmarkExtension, sourceRoleAblationCapability: config.sourceRoleAblationCapability,
    fetchImpl: config.fetchImpl });
  const results = [];
  let stopReason = null;
  try {
    const model = createOpenAIModel({ apiKey: config.apiKey, fetchImpl: guard.cairnFetch });
    for (const slot of guard.sourceRoleAblationCapability.protocol.slots) {
      const identity = { slot: slot.slot, ordinal: slot.ordinal, arm: slot.arm };
      if (stopReason !== null || guard.isHalted()) {
        results.push(freeze({ ...identity, caseOrdinal: slot.ordinal, status: 'not_run',
          reason: stopReason ?? 'paid_work_halted', invocation: 'not_started', persistence: 'not_attempted',
          items: [], passages: [], attempts: [] }));
        continue;
      }
      const before = guard.attempts().length;
      let result;
      let persistenceStarted = false;
      let persistenceCompleted = false;
      try {
        await guard.withSlotScope(identity, async () => {
          const prepared = prepareSourceRoleArm({ caseOrdinal: slot.ordinal, arm: slot.arm });
          try {
            // The real guarded adapter is checked, with the chosen frozen prompt, before invocation.
            checkExtractionFits(model, prepared.request);
            const output = await callModel(model, 'extract', prepared.request.system, prepared.request.input,
              { failureCode: 'extraction_failed' });
            const items = extractedWindowItems(output, prepared.snapshot, prepared.catalog);
            result = { ...identity, caseOrdinal: slot.ordinal, status: 'completed', reason: null,
              invocation: 'completed', items, passages: passagesFor(items, prepared.catalog) };
          } catch (error) {
            const reason = error instanceof MemoryStoreError && finiteRefusals.has(error.code)
              ? error.code : 'extraction_refused';
            result = { ...identity, caseOrdinal: slot.ordinal, status: 'refused', reason,
              invocation: guard.attempts().length > before ? 'attempted' : 'not_started', items: [], passages: [] };
          }
          await guard.awaitSettlement();
          result.attempts = attemptProjection(guard.attempts().slice(before));
          result.persistence = 'pending';
          result = freeze(result);
          persistenceStarted = true;
          // Persistence is inside the scope: it cannot advance before this settles.
          await config.persistSlot(result);
          persistenceCompleted = true;
          result = freeze({ ...result, persistence: 'persisted' });
        });
      } catch {
        guard.halt();
        stopReason = persistenceStarted && !persistenceCompleted ? 'persistence_failed' : 'execution_halted';
        result = freeze({ ...(result ?? { ...identity, caseOrdinal: slot.ordinal, status: 'refused',
          reason: 'execution_halted', invocation: guard.attempts().length > before ? 'attempted' : 'not_started',
          items: [], passages: [] }),
        persistence: persistenceCompleted ? 'persisted' : persistenceStarted ? 'failed' : 'not_attempted',
        attempts: attemptProjection(guard.attempts().slice(before)) });
      }
      results.push(result);
      if (guard.isHalted()) stopReason ??= 'paid_work_halted';
    }
  } catch {
    guard.halt();
    stopReason = 'execution_halted';
    for (const slot of guard.sourceRoleAblationCapability.protocol.slots.slice(results.length)) {
      results.push(freeze({ slot: slot.slot, ordinal: slot.ordinal, arm: slot.arm, caseOrdinal: slot.ordinal,
        status: 'not_run', reason: stopReason, invocation: 'not_started', persistence: 'not_attempted',
        items: [], passages: [], attempts: [] }));
    }
  } finally {
    try { guard.close(); } catch { guard.halt(); stopReason = 'cleanup_failed'; }
  }
  return freeze({ version: 'source-role-extraction-result-v1', quality: 'unassessed',
    status: stopReason === null ? 'completed' : 'halted', reason: stopReason,
    protocol: guard.sourceRoleAblationCapability.protocol, results,
    counts: Object.fromEntries(['completed', 'refused', 'not_run'].map(status =>
      [status, results.filter(result => result.status === status).length])) });
}
