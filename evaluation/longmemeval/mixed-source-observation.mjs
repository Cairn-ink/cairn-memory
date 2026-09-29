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

const FAMILY_SCOPE = 'one-current-source-family/one-recall';
const FAMILY_REPORT_BYTES = 32 * 1024;

export function unavailableSharedSourceTrace(reason, { batchMembers = null,
  beforeReads = 0, afterReads = 0, carrierOrdinals = null } = {}) {
  return Object.freeze({ version: 2, scope: FAMILY_SCOPE, status: 'unavailable', reason,
    counts: { batchMembers, carriers: carrierOrdinals?.length ?? null, observed: 0,
      unavailable: carrierOrdinals?.length ?? null, beforeReads, afterReads },
    carriers: (carrierOrdinals ?? []).map(localOrdinal => ({ localOrdinal,
      trace: unavailableSourceTrace('family_unavailable') })),
    anyCompleteCarrierPath: 'unavailable' });
}

function memberSnapshot(result, namespace, memoryId, expected) {
  const receipts = validatedMember(result, namespace, memoryId);
  const revision = own(own(own(result, 'value'), 'memory'), 'revision');
  const bindings = [];
  let receiptId = null;
  for (let index = 0; index < receipts.length; index++) {
    const receipt = own(receipts, String(index));
    const binding = ['id', 'client', 'sessionId', 'eventId', 'role', 'excerpt']
      .map(key => own(receipt, key));
    bindings.push(binding);
    if (binding[1] === expected.client && binding[2] === expected.sessionId
      && binding[3] === expected.eventId && binding[4] === expected.role
      && binding[5] === expected.excerpt) {
      if (receiptId !== null) throw new Error('duplicate_source_receipt');
      receiptId = binding[0];
    }
  }
  return { revision, bindings: JSON.stringify(bindings), receiptId, result };
}

function readFamily(core, namespace, members, expected) {
  let reads = 0, unavailable = false;
  const snapshots = members.map(({ memoryId }) => {
    reads++;
    try { return memberSnapshot(core.get({ namespace, memoryId, receiptLimit: 100 }),
      namespace, memoryId, expected); }
    catch { unavailable = true; return null; }
  });
  return { reads, unavailable, snapshots };
}

/** One completed batch, all admitted members, one actual recall and answer pack. */
export function locateMixedSourceFamily({ core, namespace, plan, ingested, probe }) {
  let members, expected;
  try {
    const batch = own(plan, 'cairnPlan').batches[probe.batchIndex];
    const window = batch.indexedWindows[probe.windowIndex];
    const outcome = own(ingested, 'outcomes')[probe.batchIndex];
    if (!outcome || own(outcome, 'batchIndex') !== probe.batchIndex
      || own(outcome, 'status') !== 'completed') return { trace: null,
      report: unavailableSharedSourceTrace('capture_unavailable') };
    const admitted = own(own(own(outcome, 'result'), 'admission'), 'memories');
    if (types.isProxy(admitted) || !Array.isArray(admitted) || admitted.length > 5
      || Object.keys(admitted).length !== admitted.length) throw new Error('capture_shape');
    expected = { namespace, client: batch.captureInput.client,
      sessionId: batch.captureInput.sessionId, eventId: window.id,
      role: window.role, excerpt: window.content, routingCue: probe.routingCue };
    const seen = new Set();
    members = [];
    for (let localOrdinal = 0; localOrdinal < admitted.length; localOrdinal++) {
      const ref = own(admitted, String(localOrdinal));
      const memoryId = own(ref, 'id');
      const revision = own(ref, 'revision');
      if (!bounded(memoryId, 200) || !Number.isSafeInteger(revision)
        || revision < 1 || seen.has(memoryId)) throw new Error('capture_shape');
      seen.add(memoryId);
      members.push({ memoryId, localOrdinal });
    }
  } catch { return { trace: null, report: unavailableSharedSourceTrace('lookup_unavailable') }; }
  const before = readFamily(core, namespace, members, expected);
  const carriers = before.unavailable ? [] : members.flatMap((member, index) => {
    const snapshot = before.snapshots[index];
    return snapshot.receiptId === null ? [] : [{ ...member, before: snapshot,
      trace: createRetainedRecallTrace({ sourceProbe: { ...expected,
        memoryId: member.memoryId }, before: snapshot.result, readSet: [namespace] }) }];
  });
  let closed = false;
  const trace = before.unavailable || !carriers.length ? null : Object.freeze({
    beginSelect(request) {
      const settle = carriers.map(carrier => carrier.trace.beginSelect(request));
      return output => { for (const callback of settle) callback(output); };
    },
    beginRank(request) {
      const settle = carriers.map(carrier => carrier.trace.beginRank(request));
      return output => { for (const callback of settle) callback(output); };
    },
  });
  return { trace, report: null, finish({ recall, packed }) {
    const carrierOrdinals = carriers.map(carrier => carrier.localOrdinal);
    if (closed) return unavailableSharedSourceTrace('already_finished', {
      batchMembers: members.length, beforeReads: before.reads, carrierOrdinals });
    closed = true;
    const after = readFamily(core, namespace, members, expected);
    if (before.unavailable) return unavailableSharedSourceTrace('lookup_unavailable', {
      batchMembers: members.length, beforeReads: before.reads, afterReads: after.reads });
    const current = !after.unavailable && after.snapshots.every((snapshot, index) =>
      snapshot.revision === before.snapshots[index].revision
      && snapshot.bindings === before.snapshots[index].bindings
      && snapshot.receiptId === before.snapshots[index].receiptId);
    if (!current) {
      for (const carrier of carriers) carrier.trace.finish({ recall, packed, after: null });
      return unavailableSharedSourceTrace('family_changed_or_unavailable', {
        batchMembers: members.length, beforeReads: before.reads,
        afterReads: after.reads, carrierOrdinals });
    }
    if (!carriers.length) return unavailableSharedSourceTrace('not_observed_in_batch', {
      batchMembers: members.length, beforeReads: before.reads, afterReads: after.reads,
      carrierOrdinals: [] });
    const reports = carriers.map(carrier => ({ localOrdinal: carrier.localOrdinal,
      trace: carrier.trace.finish({ recall, packed,
        after: after.snapshots[carrier.localOrdinal].result }) }));
    const observed = reports.filter(row => row.trace.status === 'observed').length;
    const gaps = reports.map(row => row.trace.firstObservedGap);
    const anyCompleteCarrierPath = observed !== reports.length ? 'unavailable'
      : gaps.includes(null) ? 'yes'
        : gaps.every(gap => gap !== 'unavailable') ? 'no' : 'unavailable';
    const report = { version: 2, scope: FAMILY_SCOPE,
      status: observed === reports.length ? 'observed' : 'unavailable',
      ...(observed === reports.length ? {} : { reason: 'carrier_unavailable' }),
      counts: { batchMembers: members.length, carriers: carriers.length,
        observed, unavailable: carriers.length - observed,
        beforeReads: before.reads, afterReads: after.reads },
      carriers: reports, anyCompleteCarrierPath };
    if (Buffer.byteLength(JSON.stringify(report), 'utf8') > FAMILY_REPORT_BYTES) {
      return unavailableSharedSourceTrace('report_limit', { batchMembers: members.length,
        beforeReads: before.reads, afterReads: after.reads, carrierOrdinals });
    }
    return Object.freeze(report);
  } };
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
