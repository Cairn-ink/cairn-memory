import { deepFreeze } from '../longmemeval/validation.mjs';

export const RECALL_STAGE_OBSERVATION_VERSION = 'cairn-recall-stage-observation-v1';
export const RECALL_SELECTION_RECORD_LIMIT = 2;

const NO_VALUE = Symbol('no-value');
const MAX_NAMESPACES = 2;
const MAX_MAP_ITEMS = 200;
const MAX_SELECTION_REFS = 24;
const MAX_CHOSEN_REFS = 36;
const MAX_OBSERVED_INVOCATIONS = 64;

const dataProperty = (value, key) => {
  if ((typeof value !== 'object' && typeof value !== 'function') || value === null) return NO_VALUE;
  const descriptor = Object.getOwnPropertyDescriptor(value, key);
  return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : NO_VALUE;
};

const denseItems = (value, maximum) => {
  if (!Array.isArray(value)) return null;
  const length = dataProperty(value, 'length');
  if (!Number.isSafeInteger(length) || length < 0 || length > maximum) return null;
  const items = [];
  for (let index = 0; index < length; index += 1) {
    const item = dataProperty(value, `${index}`);
    if (item === NO_VALUE) return null;
    items.push(item);
  }
  return items;
};

const unavailableSelectionInput = () => ({ visibleMapCount: null, visibleItemCount: null,
  filedRefCount: null, unfiledCount: null, mapExhausted: null });

const projectSelectionInput = (request) => {
  try {
    const input = dataProperty(request, 'input');
    const maps = denseItems(dataProperty(input, 'maps'), MAX_NAMESPACES);
    if (maps === null) return unavailableSelectionInput();
    let visibleItemCount = 0;
    let filedRefCount = 0;
    let unfiledCount = 0;
    const mapExhausted = [];
    for (const map of maps) {
      const items = denseItems(dataProperty(map, 'items'), 100);
      const exhausted = dataProperty(map, 'exhausted');
      if (items === null || typeof exhausted !== 'boolean') return unavailableSelectionInput();
      mapExhausted.push(exhausted);
      visibleItemCount += items.length;
      if (visibleItemCount > MAX_MAP_ITEMS) return unavailableSelectionInput();
      for (const item of items) {
        const type = dataProperty(item, 'type');
        if (type === 'ref') filedRefCount += 1;
        else if (type === 'unfiled') unfiledCount += 1;
        else return unavailableSelectionInput();
      }
    }
    return { visibleMapCount: maps.length, visibleItemCount, filedRefCount, unfiledCount, mapExhausted };
  } catch { return unavailableSelectionInput(); }
};

const projectRankInput = (request) => {
  try {
    const input = dataProperty(request, 'input');
    const candidates = denseItems(dataProperty(input, 'candidates'), MAX_CHOSEN_REFS);
    return candidates === null ? null : candidates.length;
  } catch { return null; }
};

const projectRefs = (response, maximum) => {
  try {
    const refs = denseItems(dataProperty(response, 'refs'), maximum);
    if (refs === null) return null;
    const identities = [];
    for (const ref of refs) {
      const namespaceIndex = dataProperty(ref, 'namespaceIndex');
      const memoryId = dataProperty(ref, 'memoryId');
      const revision = dataProperty(ref, 'revision');
      if (!Number.isSafeInteger(namespaceIndex) || namespaceIndex < 0
        || typeof memoryId !== 'string' || memoryId.length < 1 || memoryId.length > 200
        || !Number.isSafeInteger(revision) || revision < 1) return null;
      identities.push(JSON.stringify([namespaceIndex, memoryId, revision]));
    }
    return { count: refs.length, identities };
  } catch { return null; }
};

const projectRecall = (response) => {
  try {
    const ok = dataProperty(response, 'ok');
    if (ok === false) {
      const error = dataProperty(response, 'error');
      const code = dataProperty(error, 'code');
      const retryable = dataProperty(error, 'retryable');
      return typeof code === 'string' && typeof retryable === 'boolean'
        ? { status: 'failed', mapExhausted: null, fetchExhausted: null }
        : { status: 'unavailable', mapExhausted: null, fetchExhausted: null };
    }
    if (ok !== true) return { status: 'unavailable', mapExhausted: null, fetchExhausted: null };
    const value = dataProperty(response, 'value');
    const namespaces = denseItems(dataProperty(value, 'namespaces'), MAX_NAMESPACES);
    if (namespaces === null) return { status: 'unavailable', mapExhausted: null, fetchExhausted: null };
    const mapExhausted = [];
    const fetchExhausted = [];
    for (const namespace of namespaces) {
      const mapped = dataProperty(namespace, 'mapExhausted');
      const fetched = dataProperty(namespace, 'fetchExhausted');
      if (typeof mapped !== 'boolean' || typeof fetched !== 'boolean') {
        return { status: 'unavailable', mapExhausted: null, fetchExhausted: null };
      }
      mapExhausted.push(mapped);
      fetchExhausted.push(fetched);
    }
    return { status: 'completed', mapExhausted, fetchExhausted };
  } catch { return { status: 'unavailable', mapExhausted: null, fetchExhausted: null }; }
};

const recordBucket = (limit) => ({ limit, records: [], droppedRecords: 0, invocations: 0, overflowed: false });
const appendPending = (bucket, record) => {
  if (bucket.overflowed) return null;
  if (bucket.invocations === MAX_OBSERVED_INVOCATIONS) {
    bucket.overflowed = true;
    return null;
  }
  bucket.invocations += 1;
  if (bucket.records.length === bucket.limit) {
    bucket.droppedRecords += 1;
    return null;
  }
  bucket.records.push(record);
  return record;
};

const snapshotBucket = (bucket) => ({ recordLimit: bucket.limit,
  invocationCount: bucket.overflowed ? null : bucket.invocations,
  droppedRecords: bucket.overflowed ? null : bucket.droppedRecords,
  overflowed: bucket.overflowed,
  records: bucket.records.map((record) => ({ ...record,
    ...(Array.isArray(record.mapExhausted) ? { mapExhausted: [...record.mapExhausted] } : {}),
    ...(Array.isArray(record.fetchExhausted) ? { fetchExhausted: [...record.fetchExhausted] } : {}) })) });

export const createRecallStageCollector = () => {
  const selection = recordBucket(RECALL_SELECTION_RECORD_LIMIT);
  const ranking = recordBucket(1);
  const recall = recordBucket(1);
  const selectedIdentities = new Set();
  let selectedIdentityCountAvailable = true;
  let closed = false;

  const observeSelection = (original, receiver, args) => {
    if (closed) return Reflect.apply(original, receiver, args);
    const invocationOrdinal = selection.invocations;
    const input = projectSelectionInput(args[0]);
    const record = appendPending(selection, { invocationOrdinal, status: 'pending', ...input,
      returnedRefCount: null, cumulativeUniqueSelectedRefCount: null });
    let returned;
    try { returned = Reflect.apply(original, receiver, args); }
    catch (error) {
      if (!closed && record) {
        record.status = 'failed';
        record.cumulativeUniqueSelectedRefCount = selectedIdentityCountAvailable
          ? selectedIdentities.size : null;
      }
      throw error;
    }
    return Promise.resolve(returned).then((value) => {
      if (!closed) {
        const projected = projectRefs(value, MAX_SELECTION_REFS);
        if (!projected || input.visibleMapCount === null) {
          selectedIdentityCountAvailable = false;
          selectedIdentities.clear();
        } else if (selectedIdentityCountAvailable) {
          for (const identity of projected.identities) selectedIdentities.add(identity);
          if (selectedIdentities.size > MAX_CHOSEN_REFS) {
            selectedIdentityCountAvailable = false;
            selectedIdentities.clear();
          }
        }
        if (record) {
          record.status = projected && input.visibleMapCount !== null && selectedIdentityCountAvailable
            ? 'completed' : 'unavailable';
          record.returnedRefCount = projected?.count ?? null;
          record.cumulativeUniqueSelectedRefCount = selectedIdentityCountAvailable
            ? selectedIdentities.size : null;
        }
      }
      return value;
    }, (error) => {
      if (!closed && record) {
        record.status = 'failed';
        record.cumulativeUniqueSelectedRefCount = selectedIdentityCountAvailable
          ? selectedIdentities.size : null;
      }
      throw error;
    });
  };

  const observeRank = (original, receiver, args) => {
    if (closed) return Reflect.apply(original, receiver, args);
    const invocationOrdinal = ranking.invocations;
    const inputCandidateCount = projectRankInput(args[0]);
    const record = appendPending(ranking, { invocationOrdinal, status: 'pending', inputCandidateCount,
      returnedRefCount: null });
    let returned;
    try { returned = Reflect.apply(original, receiver, args); }
    catch (error) {
      if (!closed && record) record.status = 'failed';
      throw error;
    }
    return Promise.resolve(returned).then((value) => {
      if (!closed && record) {
        const projected = projectRefs(value, 12);
        record.status = projected && inputCandidateCount !== null ? 'completed' : 'unavailable';
        record.returnedRefCount = projected?.count ?? null;
      }
      return value;
    }, (error) => {
      if (!closed && record) record.status = 'failed';
      throw error;
    });
  };

  const observeModel = (model) => {
    const wrappers = new Map();
    const forwardingTarget = Object.create(null);
    return new Proxy(forwardingTarget, {
      get(_target, property) {
        const value = Reflect.get(model, property, model);
        if (typeof value !== 'function' || property === 'onDiagnostic') return value;
        const cached = wrappers.get(property);
        if (cached?.original === value) return cached.wrapper;
        const wrapper = property === 'select'
          ? function (...args) { return observeSelection(value, model, args); }
          : property === 'rank'
            ? function (...args) { return observeRank(value, model, args); }
            : function (...args) { return Reflect.apply(value, model, args); };
        wrappers.set(property, { original: value, wrapper });
        return wrapper;
      },
    });
  };

  const observeRecall = (operation) => {
    if (closed) return operation();
    const invocationOrdinal = recall.invocations;
    const record = appendPending(recall, { invocationOrdinal, status: 'pending', mapExhausted: null,
      fetchExhausted: null });
    let returned;
    try { returned = operation(); }
    catch (error) {
      if (!closed && record) record.status = 'failed';
      throw error;
    }
    return Promise.resolve(returned).then((value) => {
      if (!closed && record) Object.assign(record, projectRecall(value));
      return value;
    }, (error) => {
      if (!closed && record) record.status = 'failed';
      throw error;
    });
  };

  const close = () => {
    if (closed) return;
    closed = true;
    for (const bucket of [selection, ranking, recall]) {
      for (const record of bucket.records) {
        if (record.status === 'pending') record.status = 'unavailable';
      }
    }
    selectedIdentities.clear();
  };
  const snapshot = () => deepFreeze({
    schemaVersion: RECALL_STAGE_OBSERVATION_VERSION,
    availability: 'available',
    closed,
    selection: snapshotBucket(selection),
    ranking: snapshotBucket(ranking),
    recall: snapshotBucket(recall),
  });
  return Object.freeze({ observeModel, observeRecall, close, snapshot });
};
