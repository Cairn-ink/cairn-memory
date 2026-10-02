// Maintainer-only observation. This module is not wired into paid generation.
const MAXIMUM = Object.freeze({ calls: 4, refs: 128, receipts: 256, identities: 1024 });
const invalid = () => { throw new TypeError('invalid_recall_witness'); };
const own = (value, key) => {
  if (!value || typeof value !== 'object') invalid();
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) invalid();
  return descriptor.value;
};
const optional = (value, key, fallback) => Object.hasOwn(value, key) ? own(value, key) : fallback;
const integer = (value, minimum = 0) => {
  if (!Number.isSafeInteger(value) || value < minimum) invalid();
  return value;
};
const array = value => {
  if (!Array.isArray(value)) invalid();
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (!length || !Object.hasOwn(length, 'value')) invalid();
  integer(length.value);
  return value;
};
const element = (value, index) => own(value, String(index));
const id = value => {
  if (typeof value !== 'string' || !value.length || value.length > 200) invalid();
  return value;
};
const refKey = value => JSON.stringify([integer(own(value, 'namespaceIndex')),
  id(own(value, 'memoryId')), integer(own(value, 'revision'), 1)]);
const memoryRef = (value, namespaceIndex) => ({ namespaceIndex,
  memoryId: own(value, 'id'), revision: own(value, 'revision') });

function limitsOf(options) {
  if (!options || Object.getPrototypeOf(options) !== Object.prototype) invalid();
  if (Reflect.ownKeys(options).some(key => !Object.hasOwn(MAXIMUM, key))) invalid();
  return Object.freeze(Object.fromEntries(Object.entries(MAXIMUM).map(([key, maximum]) => {
    const value = optional(options, key, maximum);
    if (integer(value, 1) > maximum) invalid();
    return [key, value];
  })));
}

/**
 * Observe a trusted data-property model without changing its invocation result.
 * Native Promise taps preserve the original Promise; arbitrary thenables are
 * forwarded unobserved. Caller-supplied finish results are not authenticated.
 */
export function createRecallWitness(model, options = {}) {
  const limits = limitsOf(options);
  if (!model || ![Object.prototype, null].includes(Object.getPrototypeOf(model))) invalid();
  const descriptors = Object.getOwnPropertyDescriptors(model);
  if (Reflect.ownKeys(descriptors).some(key => !Object.hasOwn(descriptors[key], 'value'))) invalid();
  if (typeof descriptors.select?.value !== 'function' || typeof descriptors.rank?.value !== 'function'
    || typeof descriptors.countTokens?.value !== 'function') invalid();

  const mappings = new Map();
  const events = [];
  const counts = { calls: 0, omittedCalls: 0, selectCalls: 0, rankCalls: 0,
    projectionFailures: 0, shownRefs: 0, returnedRefs: 0, rankReceipts: 0 };
  let closed = false, disposed = false, overflow = false, disposedObservation = null;
  let final = { outcome: 'unknown', observation: 'not-run', refs: [], receipts: [],
    refCount: 0, receiptCount: 0, strategy: 'unknown' };
  const increment = key => {
    if (counts[key] === Number.MAX_SAFE_INTEGER) { overflow = true; closed = true; return; }
    counts[key]++;
  };
  const token = (key, kind) => {
    if (mappings.has(key)) return mappings.get(key);
    if (mappings.size === limits.identities) { overflow = true; return null; }
    const value = `${kind}${mappings.size.toString(36)}`;
    mappings.set(key, value);
    return value;
  };
  const projectRef = (value, budget, row) => {
    if (budget.refs === limits.refs) { overflow = true; row.observation = 'partial'; return null; }
    budget.refs++;
    const valueToken = token(`ref:${refKey(value)}`, 'r');
    if (valueToken === null) row.observation = 'partial';
    return valueToken;
  };
  const projectReceipt = (value, association, budget, row) => {
    if (budget.receipts === limits.receipts) { overflow = true; row.observation = 'partial'; return null; }
    budget.receipts++;
    const valueToken = token(`receipt:${association}:${id(own(value, 'id'))}`, 'p');
    if (valueToken === null) row.observation = 'partial';
    return valueToken;
  };
  const attempt = (row, work) => {
    if (closed) return;
    try { work(); }
    catch { increment('projectionFailures'); row.observation = 'unknown'; }
  };
  const inputProjection = (stage, request, budget) => {
    const input = own(request, 'input');
    const row = { observation: 'complete', refs: [], refCount: 0 };
    if (stage === 'select') {
      row.pages = [];
      const pages = array(own(input, 'maps'));
      if (pages.length > 8) { overflow = true; row.observation = 'partial'; }
      for (let pageIndex = 0; pageIndex < Math.min(8, pages.length); pageIndex++) {
        const page = element(pages, pageIndex), namespaceIndex = integer(own(page, 'namespaceIndex'));
        const items = array(own(page, 'items'));
        const exhausted = own(page, 'exhausted');
        if (typeof exhausted !== 'boolean' || items.length > 100) invalid();
        const pageRow = { itemCount: items.length, exhausted, refCount: 0 };
        row.pages.push(pageRow);
        for (let index = 0; index < items.length; index++) {
          const item = element(items, index), type = own(item, 'type');
          let value;
          if (type === 'unfiled') value = { namespaceIndex,
            memoryId: own(own(item, 'ref'), 'memoryId'), revision: own(own(item, 'ref'), 'revision') };
          else if (type === 'ref' && own(own(item, 'ref'), 'childType') === 'memory') {
            value = { namespaceIndex, memoryId: own(own(item, 'ref'), 'childId'),
              revision: own(own(item, 'ref'), 'childRevision') };
          }
          if (!value) continue;
          pageRow.refCount++; row.refCount++; increment('shownRefs');
          const valueToken = projectRef(value, budget, row);
          if (valueToken !== null) row.refs.push(valueToken);
        }
      }
    } else {
      row.candidates = []; row.receiptCount = 0;
      const candidates = array(own(input, 'candidates'));
      if (candidates.length > 36) invalid();
      for (let index = 0; index < candidates.length; index++) {
        const candidate = element(candidates, index);
        const reference = memoryRef(own(candidate, 'memory'), integer(own(candidate, 'namespaceIndex')));
        const association = refKey(reference);
        const valueToken = projectRef(reference, budget, row);
        row.refCount++; increment('shownRefs');
        if (valueToken !== null) row.refs.push(valueToken);
        const receipts = array(own(candidate, 'receipts'));
        const candidateRow = { ref: valueToken, receipts: [], receiptCount: receipts.length,
          textShortened: optional(candidate, 'textShortened', false) === true,
          receiptsOmitted: integer(optional(candidate, 'receiptsOmitted', 0)) };
        row.candidates.push(candidateRow);
        // No unbounded traversal of a supplied receipt list.
        if (receipts.length > limits.receipts - budget.receipts) { overflow = true; row.observation = 'partial'; }
        const take = Math.min(receipts.length, limits.receipts - budget.receipts);
        row.receiptCount += take;
        for (let receiptIndex = 0; receiptIndex < take; receiptIndex++) {
          increment('rankReceipts');
          const receiptToken = projectReceipt(element(receipts, receiptIndex), association, budget, row);
          if (receiptToken !== null) candidateRow.receipts.push(receiptToken);
        }
      }
    }
    return row;
  };
  const returned = (event, output, budget) => {
    event.returned.boundary = 'adapter-returned';
    const refs = array(own(output, 'refs'));
    event.returned.refCount = refs.length;
    if (refs.length > limits.refs - budget.refs) { overflow = true; event.returned.observation = 'partial'; }
    const take = Math.min(refs.length, limits.refs - budget.refs);
    for (let index = 0; index < take; index++) {
      increment('returnedRefs');
      const valueToken = projectRef(element(refs, index), budget, event.returned);
      if (valueToken !== null) event.returned.refs.push(valueToken);
    }
  };
  const wrap = (stage, original) => function(request) {
    let event, budget;
    if (!closed) {
      increment('calls'); increment(stage === 'select' ? 'selectCalls' : 'rankCalls');
      if (events.length === limits.calls) { overflow = true; increment('omittedCalls'); }
      else {
        budget = { refs: 0, receipts: 0 };
        event = { ordinal: events.length, stage, input: { observation: 'unknown', refs: [], refCount: 0 },
          returned: { boundary: 'pending', observation: 'complete', refs: [], refCount: null } };
        events.push(event);
        attempt(event.input, () => { event.input = inputProjection(stage, request, budget); });
      }
    }
    let result;
    try { result = Reflect.apply(original, model, [request]); }
    catch (error) { if (event && !closed) event.returned.boundary = 'rejected'; throw error; }
    if (event) {
      if (result instanceof Promise) {
        // Do not return this extra tap Promise or await observation.
        try {
          Promise.prototype.then.call(result,
            output => attempt(event.returned, () => returned(event, output, budget)),
            () => { if (!closed) event.returned.boundary = 'rejected'; });
        } catch { attempt(event.returned, () => { invalid(); }); }
      } else if (result && typeof result === 'object' && Object.hasOwn(result, 'then')) {
        event.returned.boundary = 'unknown'; event.returned.observation = 'unknown';
      } else attempt(event.returned, () => returned(event, result, budget));
    }
    return result;
  };
  const facade = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    const value = descriptors[key].value;
    Object.defineProperty(facade, key, { enumerable: descriptors[key].enumerable,
      value: key === 'select' || key === 'rank' ? wrap(key, value)
        : typeof value === 'function' && key !== 'onDiagnostic' ? value.bind(model) : value });
  }
  Object.freeze(facade);

  const summary = () => ({ version: 1, closed, disposed, recallOutcome: final.outcome,
    referenceAcceptance: 'not-observed', observation: disposedObservation ?? (overflow || counts.projectionFailures
      ? 'partial' : final.outcome === 'unknown' ? 'unknown'
        : final.observation === 'partial' || final.observation === 'unknown' || events.some(event =>
          event.input.observation !== 'complete' || event.returned.observation !== 'complete' ||
          ['pending', 'unknown'].includes(event.returned.boundary)) ? 'partial' : 'complete'),
    selectVisibility: counts.selectCalls ? 'model-requests-only' : 'unobservable',
    ...counts, retainedCalls: events.length, overflow,
    finalReturnedRefs: final.refCount, finalReturnedReceipts: final.receiptCount,
    strategy: final.strategy });
  const afterClose = key => {
    if (!closed) throw new Error('recall_witness_not_closed');
    return mappings.has(key) ? { status: 'known', token: mappings.get(key) } : { status: 'unknown' };
  };
  return Object.freeze({ model: facade,
    finish(result) {
      if (closed) return;
      attempt(final, () => {
        const resultOk = own(result, 'ok');
        if (resultOk === false) { final.outcome = 'failed'; final.observation = 'not-run'; return; }
        if (resultOk !== true) invalid();
        const value = own(result, 'value'), memories = array(own(value, 'memories'));
        if (memories.length > 12) invalid();
        final.outcome = 'completed'; final.observation = 'complete';
        const selection = optional(value, 'selection', null);
        if (selection) {
          const strategy = own(selection, 'strategy');
          if (['complete-map', 'model-selected'].includes(strategy)) final.strategy = strategy;
        }
        const budget = { refs: 0, receipts: 0 };
        for (let index = 0; index < memories.length; index++) {
          const item = element(memories, index), memory = own(item, 'memory');
          // Final namespaces stay private: join refs via model-shown IDs/revisions.
          const memoryId = id(own(memory, 'id')), revision = integer(own(memory, 'revision'), 1);
          final.refCount++;
          const matching = [];
          for (const [key, valueToken] of mappings) {
            if (!key.startsWith('ref:')) continue;
            const ref = JSON.parse(key.slice(4));
            if (ref[1] === memoryId && ref[2] === revision) {
              matching.push({ valueToken, association: key.slice(4) });
            }
          }
          const association = matching.length === 1 ? matching[0].association : undefined;
          if (association !== undefined) final.refs.push(matching[0].valueToken);
          const receipts = array(own(item, 'receipts'));
          final.receiptCount += receipts.length;
          if (receipts.length > limits.receipts - budget.receipts) { overflow = true; final.observation = 'partial'; }
          const take = Math.min(receipts.length, limits.receipts - budget.receipts);
          if (association === undefined) { final.observation = 'partial'; continue; }
          for (let receiptIndex = 0; receiptIndex < take; receiptIndex++) {
            const valueToken = projectReceipt(element(receipts, receiptIndex), association, budget, final);
            if (valueToken !== null) final.receipts.push(valueToken);
          }
        }
      });
      closed = true;
    },
    close() { closed = true; },
    snapshot() { return structuredClone({ version: 1, closed, disposed, events, final }); },
    summary,
    lookupRefAfterClose(ref) {
      if (!closed) throw new Error('recall_witness_not_closed');
      try { return afterClose(`ref:${refKey(ref)}`); } catch { return { status: 'unknown' }; }
    },
    lookupReceiptAfterClose(receiptId, ref) {
      if (!closed) throw new Error('recall_witness_not_closed');
      try { return afterClose(`receipt:${refKey(ref)}:${id(receiptId)}`); } catch { return { status: 'unknown' }; }
    },
    dispose() {
      disposedObservation = summary().observation;
      closed = true; disposed = true; mappings.clear(); events.length = 0;
      final.refs = []; final.receipts = [];
    },
  });
}
