import { AsyncLocalStorage } from 'node:async_hooks';
import { types } from 'node:util';

import { createRetainedRecallTrace } from '../long-history/recall-observation.mjs';

const own = (value, key) => {
  if (!value || typeof value !== 'object' || types.isProxy(value)) throw new Error('shape');
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw new Error('shape');
  return descriptor.value;
};
const bounded = (value, maximum) => typeof value === 'string' && value.length > 0
  && value.length <= maximum && value.isWellFormed();
const sameNamespace = (actual, expected) => own(actual, 'ownerId') === expected.ownerId
  && own(actual, 'scope') === expected.scope
  && own(actual, 'projectId') === expected.projectId;

export const unavailableSourceTrace = reason => Object.freeze({ version: 1,
  scope: 'one-current-source/one-recall', status: 'unavailable', reason,
  firstObservedGap: 'unavailable' });

function validatedMember(result, namespace, memoryId) {
  if (own(result, 'ok') !== true) throw new Error('read_failed');
  const value = own(result, 'value');
  const memory = own(value, 'memory');
  const revision = own(memory, 'revision');
  const receiptCount = own(memory, 'receiptCount');
  if (own(memory, 'id') !== memoryId || !sameNamespace(own(memory, 'namespace'), namespace)
    || own(memory, 'state') !== 'active' || !Number.isSafeInteger(revision) || revision < 1
    || !Number.isSafeInteger(receiptCount) || receiptCount < 0 || receiptCount > 100
    || own(value, 'exhausted') !== true || own(value, 'nextReceiptCursor') !== null) {
    throw new Error('read_incomplete');
  }
  const receipts = own(value, 'receipts');
  if (types.isProxy(receipts) || !Array.isArray(receipts) || receipts.length !== receiptCount
    || receiptCount > 100) throw new Error('read_incomplete');
  const seenReceiptIds = new Set();
  for (let index = 0; index < receipts.length; index++) {
    const receipt = own(receipts, String(index));
    const receiptId = own(receipt, 'id');
    if (!bounded(receiptId, 200) || seenReceiptIds.has(receiptId)
      || !bounded(own(receipt, 'client'), 200)
      || !bounded(own(receipt, 'sessionId'), 200) || !bounded(own(receipt, 'eventId'), 200)
      || !['user', 'assistant'].includes(own(receipt, 'role'))
      || !bounded(own(receipt, 'excerpt'), 800)) throw new Error('read_shape');
    seenReceiptIds.add(receiptId);
  }
  return receipts;
}

/** The designated fresh batch only; every admitted member must be a complete current read. */
export function locateMixedSource({ core, namespace, plan, ingested, probe }) {
  try {
    const batch = own(plan, 'cairnPlan').batches[probe.batchIndex];
    const window = batch.indexedWindows[probe.windowIndex];
    const outcome = own(ingested, 'outcomes')[probe.batchIndex];
    if (!outcome || own(outcome, 'batchIndex') !== probe.batchIndex
      || own(outcome, 'status') !== 'completed') return { trace: null,
      report: unavailableSourceTrace('capture_unavailable') };
    const memories = own(own(own(outcome, 'result'), 'admission'), 'memories');
    if (types.isProxy(memories) || !Array.isArray(memories) || memories.length > 5) {
      throw new Error('capture_shape');
    }
    const expected = { namespace, client: batch.captureInput.client,
      sessionId: batch.captureInput.sessionId, eventId: window.id,
      role: window.role, excerpt: window.content, routingCue: probe.routingCue };
    const seen = new Set(), matches = [];
    for (let index = 0; index < memories.length; index++) {
      const ref = own(memories, String(index));
      const memoryId = own(ref, 'id');
      if (!bounded(memoryId, 200) || !Number.isSafeInteger(own(ref, 'revision'))
        || own(ref, 'revision') < 1 || seen.has(memoryId)) throw new Error('capture_shape');
      seen.add(memoryId);
      const before = core.get({ namespace, memoryId, receiptLimit: 100 });
      const receipts = validatedMember(before, namespace, memoryId);
      for (let receiptIndex = 0; receiptIndex < receipts.length; receiptIndex++) {
        const receipt = own(receipts, String(receiptIndex));
        if (own(receipt, 'client') === expected.client
          && own(receipt, 'sessionId') === expected.sessionId
          && own(receipt, 'eventId') === expected.eventId
          && own(receipt, 'role') === expected.role
          && own(receipt, 'excerpt') === expected.excerpt) {
          matches.push({ memoryId, before });
        }
      }
    }
    if (matches.length !== 1) return { trace: null,
      report: unavailableSourceTrace(matches.length ? 'ambiguous_source' : 'not_observed_in_batch') };
    const { memoryId, before } = matches[0];
    return { trace: createRetainedRecallTrace({ sourceProbe: { ...expected, memoryId },
      before, readSet: [namespace] }), memoryId, report: null };
  } catch { return { trace: null, report: unavailableSourceTrace('lookup_unavailable') }; }
}

/** A per-case trusted-adapter facade; only native Promise settlements are observed. */
export function observedMixedCairnModel(original) {
  const scope = new AsyncLocalStorage();
  const facade = {};
  for (const [key, descriptor] of Object.entries(Object.getOwnPropertyDescriptors(original))) {
    if (!Object.hasOwn(descriptor, 'value')) throw new Error('invalid_observed_model');
    const method = descriptor.value;
    if (typeof method !== 'function') { facade[key] = method; continue; }
    facade[key] = function (...args) {
      let settle = null;
      if (key === 'select' || key === 'rank') {
        const trace = scope.getStore();
        try { settle = trace?.[key === 'select' ? 'beginSelect' : 'beginRank'](args[0]) ?? null; }
        catch { /* Observation is never an adapter failure. */ }
      }
      const result = Reflect.apply(method, original, args);
      if (settle && result && typeof result === 'object' && !types.isProxy(result)
        && types.isPromise(result) && Object.getPrototypeOf(result) === Promise.prototype
        && !Object.hasOwn(result, 'constructor')) {
        // Return the original promise. The side branch has both outcomes handled
        // and does not touch thenable accessors or alter cancellation/errors.
        try {
          Promise.prototype.then.call(result, output => {
            try { settle(output); } catch { /* Observation is passive. */ }
          }, () => {});
        } catch { /* Promise registration cannot change the original result. */ }
      }
      return result;
    };
  }
  return Object.freeze({ model: Object.freeze(facade),
    recall(trace, core, input) {
      return trace ? scope.run(trace, () => core.recall(input)) : core.recall(input);
    } });
}
