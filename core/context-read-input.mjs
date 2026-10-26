import { types } from 'node:util';
import { ownData } from './local-authority-input.mjs';
import { cardNamespace, deepFreeze } from './private-card-input.mjs';
import { evidenceRef } from './private-evidence-input.mjs';
import { denseArray, fail } from './validation.mjs';
import { validateEmbedder } from './context-read-embedder.mjs';

// U5c-2: optional sources are host availability, per-call narrowing only.
export const CONTEXT_SOURCES = Object.freeze(['relations-one-hop-v1', 'moc-v1']);
export const SOURCE_LIMITS = Object.freeze({ seeds: 4, perSeed: 2, additions: 8, horizon: 32, work: 50000, stateBytes: 8 * 1024 * 1024, retainedBytes: 16 * 1024 * 1024 });
export function contextSources(value, enabled = CONTEXT_SOURCES, allowEmpty = false) {
  const selected = denseArray(contextSnapshot(value), allowEmpty ? 0 : 1, 2);
  if (new Set(selected).size !== selected.length || selected.some(id => !enabled.includes(id))) fail('invalid_input');
  return Object.freeze(CONTEXT_SOURCES.filter(id => selected.includes(id)));
}
export const CONTEXT_VERSION = 'context-read-v1';
export const CONTEXT_METHODS = Object.freeze(['findCandidates', 'refreshContextIndex', 'fetchCandidateEvidence', 'contextRead']);
export const ASSEMBLY_POLICIES = Object.freeze(['rank-first-whole-v1', 'coverage-first-v1', 'rank-first-first-source-v1']);
export const ASSEMBLY_DEFAULTS = deepFreeze({ metadata: {
  memory: { state: 'active', reviewState: 'none', filing: { status: 'unfiled' }, kind: 'fact', origin: 'explicit', confidence: 1 },
  card: { state: 'confirmed' } }, sourceAccess: 'available', sourcesComplete: true });
export const DEFAULT_ASSEMBLY_POLICY = 'rank-first-whole-v1';
export const ASSEMBLY_LIMITS = Object.freeze({ defaultMaxTokens: 1500, minTokens: 64, maxTokens: 4000,
  defaultMaxItems: 12, maxItems: 24, candidates: 24, sourcesPerItem: 16, responseBytes: 65536,
  defaultDeadlineMs: 1000, deadlineMs: 5000, counterCalls: 1226 });
export const CONTEXT_LIMITS = Object.freeze({ defaultLimit: 12, horizon: 24, queryUnits: 4000,
  defaultDeadlineMs: 1000, deadlineMs: 5000, responseBytes: 65536, cursorUnits: 8192,
  snapshotUnits: 16384, refreshItems: 1024, batchRows: 128, batchTextUnits: 2_000_000,
  vectors: 20000, cacheBytes: 134217728, dimensions: 32768, embedderMetadataUnits: 200, rankings: 128, rankingTtlMs: 300000 });
export function contextOptions(value) {
  const options = ownData(value, ['version', 'authority', 'embedder', 'policy', 'counter', 'sources', 'localStatus']);
  if (options.version !== CONTEXT_VERSION) fail('invalid_input');
  const sources = Object.hasOwn(options, 'sources') ? contextSources(options.sources) : null;
  const authority = ownData(options.authority, ['authorize', 'isCurrent']);
  if (typeof authority.authorize !== 'function' || typeof authority.isCurrent !== 'function' ||
      [authority.authorize, authority.isCurrent].some(fn => types.isAsyncFunction(fn))) fail('authority_required');
  const embedder = options.embedder === undefined ? null : validateEmbedder(ownData(options.embedder,
    ['id', 'revision', 'dimensions', 'normalization', 'embed']));
  const counter = options.counter === undefined ? null : ownData(options.counter, ['id', 'countTokens']);
  if (counter && (typeof counter.id !== 'string' || !counter.id.isWellFormed() ||
      counter.id.includes('\0') || counter.id.length < 1 || counter.id.length > 200)) fail('invalid_input');
  const policy = options.policy === undefined ? {} : ownData(options.policy,
    ['family', 'maxRequests', 'maxUsd', 'maxConcurrent', 'estimateUsd', 'maxBatchDocuments']);
  const family = policy.family ?? 'local';
  if (!['local', 'hosted'].includes(family)) fail('invalid_input');
  const explicitLocal = Object.hasOwn(policy, 'maxBatchDocuments');
  const localStatus = options.localStatus;
  if (explicitLocal) {
    if (family !== 'local' || policy.family !== 'local' || policy.maxBatchDocuments !== 1 || policy.maxConcurrent !== 1 ||
        !Number.isSafeInteger(policy.maxRequests) || policy.maxRequests < 1 || Object.keys(policy).length !== 4 ||
        !embedder || typeof localStatus !== 'function' || types.isAsyncFunction(localStatus)) fail('invalid_input');
  } else if (Object.hasOwn(options, 'localStatus')) fail('invalid_input');
  const budgeted = explicitLocal || ['maxRequests', 'maxUsd', 'maxConcurrent', 'estimateUsd'].some(key => Object.hasOwn(policy, key));
  if (!explicitLocal && budgeted && (!Number.isSafeInteger(policy.maxRequests) || policy.maxRequests < 1 ||
      !Number.isFinite(policy.maxUsd) || policy.maxUsd <= 0 || typeof policy.estimateUsd !== 'function' ||
      types.isAsyncFunction(policy.estimateUsd) || policy.maxConcurrent !== undefined &&
      (!Number.isInteger(policy.maxConcurrent) || policy.maxConcurrent < 1 || policy.maxConcurrent > 1024))) fail('invalid_input');
  return Object.freeze({ authority: Object.freeze(authority), embedder, counter: counter && Object.freeze(counter), family,
    ...(explicitLocal ? { localStatus } : {}),
    preset: sources?.includes('moc-v1') ? 'rrf-k60-d12-moc-v1' : family === 'hosted' ? 'rrf-k10' : 'rrf-k60-d12',
    ...(sources ? { sources } : {}),
    policy: Object.freeze({ ...policy, maxConcurrent: policy.maxConcurrent ?? 1 }),
    budgetConfigured: budgeted });
}
export function contextSnapshot(value, depth = 0, budget = { nodes: 8192, units: 100000 }) {
  if (--budget.nodes < 0 || depth > 16) fail('invalid_input');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (!value.isWellFormed() || value.includes('\0') || value.length > 20000 || (budget.units -= value.length) < 0) fail('invalid_input');
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || types.isProxy(value) ||
      ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_input');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string') || Reflect.ownKeys(descriptors).length > budget.nodes) fail('invalid_input');
  if (Array.isArray(value)) {
    denseArray(value, 0, 100);
    return Array.from({ length: value.length }, (_, i) => {
      if (!Object.hasOwn(descriptors[i], 'value')) fail('invalid_input');
      return contextSnapshot(descriptors[i].value, depth + 1, budget);
    });
  }
  const result = {};
  for (const key of Object.keys(descriptors).sort()) {
    if (key === '__proto__' || !key.isWellFormed() || !Object.hasOwn(descriptors[key], 'value') || (budget.units -= key.length) < 0) fail('invalid_input');
    result[key] = contextSnapshot(descriptors[key].value, depth + 1, budget);
  }
  return result;
}
export const namespaceKey = ns => JSON.stringify([ns.ownerId, ns.scope, ns.projectId]);
export function contextReadSet(value) {
  try {
    const result = denseArray(value, 1, 2).map(cardNamespace);
    if (result.length === 2 && (result[0].ownerId !== result[1].ownerId || result[0].scope === result[1].scope)) fail('invalid_read_set');
    return result.sort((a, b) => Buffer.compare(Buffer.from(namespaceKey(a)), Buffer.from(namespaceKey(b))));
  } catch { fail('invalid_read_set'); }
}
function integer(value, fallback, maximum) {
  const n = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(n) || n < 1 || n > maximum) fail('invalid_input');
  return n;
}
export function contextRefs(values, readSet, supportedTypes) {
  const refs = denseArray(values, 1, 24).map(value => {
    const ns = cardNamespace(value.namespace);
    if (!readSet.some(scope => namespaceKey(scope) === namespaceKey(ns))) fail('scope_changed');
    if (!supportedTypes.includes(value.type)) fail('invalid_input');
    return evidenceRef(value, ns);
  });
  if (new Set(refs.map(ref => JSON.stringify([namespaceKey(ref.namespace), ref.type, ref.memoryId ?? ref.cardId]))).size !== refs.length) fail('invalid_input');
  return refs;
}
export function contextInput(method, value, supportedTypes, enabledSources) {
  const payload = deepFreeze(contextSnapshot(value));
  const selected = ownData(payload, method === 'findCandidates' ?
    ['readSet', 'query', 'types', 'intent', 'semantic', 'limit', 'deadlineMs', 'cursor', ...(enabledSources ? ['sources'] : [])] : method === 'contextRead' ?
      ['readSet', 'query', 'types', 'intent', 'semantic', 'budget', 'policy', 'deadlineMs', ...(enabledSources ? ['sources'] : [])] : method === 'refreshContextIndex' ?
      ['readSet', 'types', 'intent', 'budget'] : ['readSet', 'refs', 'intent', 'snapshot', 'responseByteLimit', 'fences']);
  const result = { readSet: contextReadSet(selected.readSet) };
  if (method === 'fetchCandidateEvidence') {
    if (Object.hasOwn(selected, 'fences') && Object.hasOwn(selected, 'snapshot')) fail('invalid_input');
    result.responseByteLimit = integer(selected.responseByteLimit, 65536, 65536);
    if (Object.hasOwn(selected, 'snapshot')) {
      if (Object.hasOwn(selected, 'refs') || Object.hasOwn(selected, 'intent') ||
          typeof selected.snapshot !== 'string' || selected.snapshot.length > 16384) fail('invalid_snapshot');
      result.snapshot = selected.snapshot;
    } else {
      if (!['current', 'history'].includes(selected.intent)) fail('invalid_input');
      result.intent = selected.intent; result.refs = contextRefs(selected.refs, result.readSet, supportedTypes);
      if (Object.hasOwn(selected, 'fences')) {
        result.fences = denseArray(selected.fences, result.refs.length, result.refs.length).map(prefix => {
          if (prefix !== null && (typeof prefix !== 'string' || !/^[A-Za-z0-9_-]{8}$/.test(prefix))) fail('invalid_input');
          return prefix;
        });
      }
    }
  } else {
    denseArray(selected.types, 1, 2);
    if (new Set(selected.types).size !== selected.types.length || selected.types.some(type => !supportedTypes.includes(type)) ||
        !['current', 'history'].includes(selected.intent)) fail('invalid_input');
    result.types = ['memory', 'card'].filter(type => selected.types.includes(type)); result.intent = selected.intent;
    if (method === 'findCandidates' || method === 'contextRead') {
      if (typeof selected.query !== 'string' || !selected.query.trim() || selected.query.length > 4000 ||
          selected.semantic !== undefined && typeof selected.semantic !== 'boolean') fail('invalid_input');
      if (enabledSources) result.sources = Object.hasOwn(selected, 'sources') ? contextSources(selected.sources, enabledSources, true) : enabledSources;
      result.query = selected.query; result.semantic = selected.semantic ?? false;
      result.deadlineMs = integer(selected.deadlineMs, 1000, 5000);
      if (method === 'contextRead') {
        const budget = selected.budget === undefined ? {} : ownData(selected.budget, ['maxTokens', 'maxItems']);
        result.budget = { maxTokens: integer(budget.maxTokens, 1500, 4000), maxItems: integer(budget.maxItems, 12, 24) };
        if (result.budget.maxTokens < 64) fail('invalid_input');
        const policy = selected.policy === undefined ? { id: DEFAULT_ASSEMBLY_POLICY } : ownData(selected.policy, ['id']);
        if (!ASSEMBLY_POLICIES.includes(policy.id)) fail('invalid_input');
        result.policy = { id: policy.id };
      } else result.limit = integer(selected.limit, 12, 24);
      if (Object.hasOwn(selected, 'cursor')) {
        if (typeof selected.cursor !== 'string' || selected.cursor.length > 8192) fail('invalid_cursor');
        result.cursor = selected.cursor;
      }
    } else {
      const budget = ownData(selected.budget, ['maxItems', 'maxMs']);
      result.budget = { maxItems: integer(budget.maxItems, null, 1024), maxMs: integer(budget.maxMs, null, 5000) };
    }
  }
  return { payload, input: result };
}
