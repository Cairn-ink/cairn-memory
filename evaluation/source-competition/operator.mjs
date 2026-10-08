// Trusted maintainer entry point only: no CLI, environment discovery or fallback fetch.
import { createOpenAIModel } from '../../adapters/openai/index.mjs';
import { checkExtractionFits } from '../../core/capture.mjs';
import { callModel } from '../../core/model-call.mjs';
import { extractedWindowItems } from '../../core/source-windows.mjs';
import { MemoryStoreError } from '../../core/validation.mjs';
import { createSourceCompetitionRequestGuard } from '../experiment-budget/request-guard.mjs';
import { snapshotJson, freeze } from '../longmemeval/mixed-validation.mjs';
import { prepareSourceCompetitionBatch } from './index.mjs';

const keys = ['ledger', 'policy', 'benchmarkExtension', 'sourceCompetitionCapability',
  'apiKey', 'fetchImpl', 'persistSlot'];
const finiteRefusals = new Set(['invalid_model_output', 'invalid_extraction', 'context_budget_exceeded',
  'token_count_unavailable', 'extraction_failed', 'model_timeout', 'model_cancelled']);

function configured(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype ||
    Reflect.ownKeys(options).length !== keys.length) throw new Error('invalid_source_competition_operator');
  const descriptors = Object.getOwnPropertyDescriptors(options);
  for (const key of keys) {
    if (!descriptors[key]?.enumerable || !Object.hasOwn(descriptors[key], 'value')) {
      throw new Error('invalid_source_competition_operator');
    }
  }
  const data = Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
  if (typeof data.apiKey !== 'string' || data.apiKey.length < 1 || data.apiKey.length > 4096 ||
    typeof data.fetchImpl !== 'function' || typeof data.persistSlot !== 'function') {
    throw new Error('invalid_source_competition_operator');
  }
  const detached = snapshotJson(Object.fromEntries(keys.filter(key =>
    !['apiKey', 'fetchImpl', 'persistSlot'].includes(key)).map(key => [key, data[key]])),
  { bytes: 1_000_000, nodes: 100_000, depth: 32 }, 'invalid_source_competition_operator');
  return { ...detached, apiKey: data.apiKey, fetchImpl: data.fetchImpl, persistSlot: data.persistSlot };
}

function passagesFor(items, catalog) {
  const passages = [];
  for (const item of items) for (const receipt of item.receipts) {
    const entry = catalog.entries.find(entry => entry.id === receipt.eventId &&
      entry.role === receipt.role && entry.content === receipt.excerpt);
    if (!entry) throw new Error('source_competition_binding_failed');
    if (!passages.some(passage => passage.index === entry.index)) passages.push({ index: entry.index,
      messageIndex: entry.messageIndex, messageId: entry.id, role: entry.role,
      start: entry.start, end: entry.end, excerpt: entry.content });
  }
  return passages;
}

const attemptProjection = attempts => attempts.map(attempt => ({
  stage: attempt.stage, outcome: attempt.outcome, actualMicroUsd: attempt.actualMicroUsd,
  reservedMicroUsd: attempt.reservedMicroUsd }));

function observeParsed(output) {
  const detached = snapshotJson(output, { bytes: 64_000, nodes: 4096, depth: 10 }, 'parsed_output_unavailable');
  // Structural budgets do not include all JSON escaping and punctuation overhead.
  if (Buffer.byteLength(JSON.stringify(detached), 'utf8') > 64_000) throw new Error('parsed_output_unavailable');
  return detached;
}

/** Runs exactly the frozen 24 slots once; the caller owns private durable persistence. */
export async function runSourceCompetition(options) {
  const config = configured(options);
  const guard = await createSourceCompetitionRequestGuard({ ledger: config.ledger, policy: config.policy,
    benchmarkExtension: config.benchmarkExtension, sourceCompetitionCapability: config.sourceCompetitionCapability,
    fetchImpl: config.fetchImpl });
  const results = [];
  let stopReason = null;
  try {
    const model = createOpenAIModel({ apiKey: config.apiKey, fetchImpl: guard.cairnFetch });
    for (const slot of guard.sourceCompetitionCapability.protocol.slots) {
      const identity = { slot: slot.slot, ordinal: slot.ordinal, arm: slot.arm, subBatch: slot.subBatch };
      if (stopReason !== null || guard.isHalted()) {
        results.push(freeze({ ...identity, caseOrdinal: slot.ordinal, status: 'not_run',
          reason: stopReason ?? 'paid_work_halted', invocation: 'not_started', persistence: 'not_attempted',
          parsedObservation: { state: 'not_observed', output: null }, items: [], passages: [], attempts: [] }));
        continue;
      }
      const before = guard.attempts().length;
      let result;
      let persistenceStarted = false;
      let persistenceCompleted = false;
      try {
        await guard.withSlotScope(identity, async () => {
          const prepared = prepareSourceCompetitionBatch({ ordinal: slot.ordinal, arm: slot.arm, subBatch: slot.subBatch });
          let parsedObservation = { state: 'not_observed', output: null };
          try {
            // The real guarded adapter is checked, with the chosen frozen prompt, before invocation.
            checkExtractionFits(model, prepared.request);
            const output = await callModel(model, 'extract', prepared.request.system, prepared.request.input,
              { failureCode: 'extraction_failed' });
            // Observe the complete bounded parsed value before canonical receipt binding.
            parsedObservation = { state: 'observed', output: observeParsed(output) };
            const items = extractedWindowItems(output, prepared.snapshot, prepared.catalog);
            result = { ...identity, caseOrdinal: slot.ordinal, status: 'completed', reason: null,
              invocation: 'completed', parsedObservation, items, passages: passagesFor(items, prepared.catalog) };
          } catch (error) {
            // A failed model parse or unavailable observation cannot masquerade as an ordinary
            // source-binding refusal. Only observed parsed proposals may continue after refusal.
            if (parsedObservation.state !== 'observed' && guard.attempts().length > before) guard.halt();
            const reason = error instanceof MemoryStoreError && finiteRefusals.has(error.code)
              ? error.code : 'extraction_refused';
            result = { ...identity, caseOrdinal: slot.ordinal, status: 'refused', reason,
              invocation: guard.attempts().length > before ? 'attempted' : 'not_started',
              parsedObservation: error?.message === 'parsed_output_unavailable'
                ? { state: 'unavailable', output: null } : parsedObservation, items: [], passages: [] };
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
          parsedObservation: { state: 'not_observed', output: null },
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
    for (const slot of guard.sourceCompetitionCapability.protocol.slots.slice(results.length)) {
      results.push(freeze({ slot: slot.slot, ordinal: slot.ordinal, arm: slot.arm, caseOrdinal: slot.ordinal,
        status: 'not_run', reason: stopReason, invocation: 'not_started', persistence: 'not_attempted',
        subBatch: slot.subBatch, parsedObservation: { state: 'not_observed', output: null }, items: [], passages: [], attempts: [] }));
    }
  } finally {
    try { guard.close(); } catch { guard.halt(); stopReason = 'cleanup_failed'; }
  }
  return freeze({ version: 'source-competition-result-v1', quality: 'unassessed',
    status: stopReason === null ? 'completed' : 'halted', reason: stopReason,
    protocol: guard.sourceCompetitionCapability.protocol, results,
    logicalArms: Array.from({ length: 8 }, (_, index) => index + 1).flatMap(ordinal =>
      ['control', 'candidate'].map(arm => {
        const batches = results.filter(row => row.ordinal === ordinal && row.arm === arm);
        return { ordinal, arm, slots: batches.map(row => row.slot),
          status: batches.some(row => row.status === 'refused') ? 'refused'
            : batches.some(row => row.status === 'not_run') ? 'not_run' : 'completed' };
      })),
    counts: Object.fromEntries(['completed', 'refused', 'not_run'].map(status =>
      [status, results.filter(result => result.status === status).length])) });
}
