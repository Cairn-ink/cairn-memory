import { createHmac } from 'node:crypto';
import { redactSecrets } from '../plugins/cairn-memory/lib/redact.mjs';
import { denseArray, fail, identifier, object, revision } from './validation.mjs';
import { APPLICABILITY, EVIDENCE_METHODS, evidenceInput } from './private-evidence-input.mjs';
import { ORGANIZATION_METHODS, ORGANIZATION_READS, organizationInput } from './private-organization-input.mjs';
import { rawSourceRef, rawSourceKey, sourceAnchors, sourceBudgets } from './raw-source-input.mjs';

export const CARD_METHODS = Object.freeze([
  'submitSourceNote', 'getSource', 'deleteSourceNote', 'createCardDraft', 'getCard',
  'listCards', 'editCardDraft', 'confirmCardDraft', 'cancelCardDraft',
  'editKnowledgeCard', 'deleteKnowledgeCard', 'inspectCardOperation',
  'listCardEffects', 'getPrivateCardUsage',
  ...EVIDENCE_METHODS,
  ...ORGANIZATION_METHODS,
]);
export const CARD_READS = new Set(['getSource', 'getCard', 'listCards',
  'inspectCardOperation', 'listCardEffects', 'getPrivateCardUsage', ...EVIDENCE_METHODS, ...ORGANIZATION_READS]);
export const OWNER_NOTE_CAP = 200_000_000;

export function privateCardOptions(value) {
  if (value === undefined) return undefined;
  object(value, ['version', 'source', 'storage', 'disclosure', 'authority']);
  if (value.version !== 'private-cards-local-v1' || value.source !== 'submitted-note-v1' ||
      value.storage !== 'local-plain-v1' || value.disclosure !== 'explicit-submitted-note-v1') fail('source_unavailable');
  object(value.authority, ['authorize', 'isCurrent']);
  if (typeof value.authority.authorize !== 'function' || typeof value.authority.isCurrent !== 'function') fail('authority_required');
  return Object.freeze({ ...value, authority: Object.freeze({ ...value.authority }) });
}

// Snapshot plain serialized data once, rejecting getters, sparse arrays and non-JSON values.
// Authority objects deliberately never enter this function.
export function snapshot(value, depth = 0, budget = { nodes: 4096, units: 100_000 }) {
  if (--budget.nodes < 0) fail('invalid_input');
  if (depth > 16) fail('invalid_input');
  if (value === null || typeof value === 'boolean') return value;
  if (typeof value === 'string') {
    if (!value.isWellFormed() || value.includes('\0') || value.length > 100_000) fail('invalid_input');
    budget.units -= value.length;
    if (budget.units < 0) fail('invalid_input');
    return value;
  }
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value !== 'object' || !value ||
      ![Object.prototype, Array.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_input');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length > budget.nodes) fail('invalid_input');
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string')) fail('invalid_input');
  if (Array.isArray(value)) {
    denseArray(value, 0, 100);
    return Array.from({ length: value.length }, (_, index) => {
      if (!Object.hasOwn(descriptors[index], 'value')) fail('invalid_input');
      return snapshot(descriptors[index].value, depth + 1, budget);
    });
  }
  const result = {};
  for (const key of Object.keys(descriptors).sort()) {
    if (key === '__proto__' || !Object.hasOwn(descriptors[key], 'value')) fail('invalid_input');
    budget.units -= key.length;
    if (budget.units < 0) fail('invalid_input');
    result[key] = snapshot(descriptors[key].value, depth + 1, budget);
  }
  return result;
}
export function deepFreeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(deepFreeze); Object.freeze(value); }
  return value;
}
export function cardNamespace(value) {
  object(value, ['ownerId', 'scope', 'projectId']);
  identifier(value.ownerId);
  if (!(value.scope === 'personal' && value.projectId === null) &&
      !(value.scope === 'project' && typeof value.projectId === 'string' && identifier(value.projectId))) fail('invalid_input');
  return { ownerId: value.ownerId, scope: value.scope, projectId: value.projectId };
}
export function cardText(value, max) {
  if (typeof value !== 'string' || !value.isWellFormed() || value.includes('\0') ||
      !value.trim() || value.length > max) fail('invalid_input');
  const result = redactSecrets(value);
  if (result.length > max || !result.trim()) fail('invalid_input');
  return result;
}
export function noteInput(value) {
  object(value, ['text', 'occurredAt']);
  const text = cardText(value.text, 20_000);
  if (value.occurredAt !== null && (typeof value.occurredAt !== 'string' ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value.occurredAt) ||
      !Number.isFinite(Date.parse(value.occurredAt)) || new Date(value.occurredAt).toISOString() !== value.occurredAt)) fail('invalid_input');
  return { text, occurredAt: value.occurredAt };
}
export const keyed = (secret, purpose, value) => createHmac('sha256', secret)
  .update(JSON.stringify([purpose, value])).digest('base64url');

export function sourceRef(value, ns, raw = false) {
  if (raw && value?.type === 'raw') return rawSourceRef(value, ns);
  if (value?.type === 'receipt') {
    object(value, ['type', 'namespace', 'memoryId', 'memoryRevision', 'receiptId', 'contentIdentity', 'completeness']);
    const scope = cardNamespace(value.namespace);
    if (JSON.stringify(scope) !== JSON.stringify(ns)) fail('source_unavailable');
    identifier(value.memoryId); identifier(value.receiptId); revision(value.memoryRevision);
    if (value.completeness !== 'excerpt-only' || typeof value.contentIdentity !== 'string' ||
        !/^[A-Za-z0-9_-]{43}$/.test(value.contentIdentity)) fail('source_unavailable');
    return { type: 'receipt', namespace: scope, memoryId: value.memoryId,
      memoryRevision: value.memoryRevision, receiptId: value.receiptId,
      contentIdentity: value.contentIdentity, completeness: 'excerpt-only' };
  }
  if (value?.type !== 'submitted-note') fail('source_unavailable');
  object(value, ['type', 'namespace', 'sourceId', 'revision', 'contentIdentity', 'completeness']);
  const scope = cardNamespace(value.namespace);
  if (JSON.stringify(scope) !== JSON.stringify(ns)) fail('source_unavailable');
  identifier(value.sourceId); revision(value.revision);
  if (value.completeness !== 'provided-note' || typeof value.contentIdentity !== 'string' ||
      !/^[A-Za-z0-9_-]{43}$/.test(value.contentIdentity)) fail('source_unavailable');
  return { type: 'submitted-note', namespace: scope, sourceId: value.sourceId,
    revision: value.revision, contentIdentity: value.contentIdentity, completeness: 'provided-note' };
}
export function refs(value, ns, raw = false) {
  const result = denseArray(value, 1, 16).map(ref => sourceRef(ref, ns, raw));
  if (new Set(result.map(ref => `${ref.type}:${ref.type === 'raw' ? rawSourceKey(ref) : ref.sourceId ?? ref.receiptId}`)).size !== result.length) fail('invalid_input');
  return result;
}
export function cardMemoryRefs(value, ns) {
  const result = denseArray(value, 1, 6).map(ref => {
    object(ref, ['type', 'namespace', 'memoryId', 'revision']);
    if (ref.type !== 'memory' || JSON.stringify(cardNamespace(ref.namespace)) !== JSON.stringify(ns)) fail('source_unavailable');
    return { type: 'memory', namespace: ns, memoryId: identifier(ref.memoryId), revision: revision(ref.revision) };
  });
  if (new Set(result.map(ref => ref.memoryId)).size !== result.length) fail('invalid_input');
  return result;
}
export function pageLimit(value = 20) {
  if (!Number.isSafeInteger(value) || value < 1 || value > 50) fail('invalid_input');
  return value;
}
export function validateCardCall(method, input, raw = false) {
  const ns = cardNamespace(input.namespace);
  if (method === 'resolveSourceReferences' && raw) {
    object(input, ['namespace','anchors','budgets']); sourceAnchors(input.anchors); sourceBudgets(input.budgets); return ns;
  }
  if (EVIDENCE_METHODS.includes(method)) { evidenceInput(method, input, ns); return ns; }
  if (ORGANIZATION_METHODS.includes(method)) { organizationInput(method, input, ns); return ns; }
  const allowed = {
    submitSourceNote: ['actionId', 'text', 'occurredAt'],
    getSource: ['source', 'limit', 'cursor', ...(raw && input.source?.type === 'raw' ? ['budgets'] : [])],
    deleteSourceNote: ['sourceId', 'expectedRevision', 'actionId'],
    createCardDraft: ['actionId', 'input', 'drafting'],
    getCard: ['cardId', 'responseByteLimit'], listCards: ['states', 'limit', 'cursor'],
    editCardDraft: ['cardId', 'expectedRevision', 'actionId', 'title', 'body', 'bindings'],
    editKnowledgeCard: ['cardId', 'expectedRevision', 'actionId', 'title', 'body', 'bindings', 'applicability'],
    confirmCardDraft: ['cardId', 'expectedRevision', 'actionId', 'applicability'],
    cancelCardDraft: ['cardId', 'expectedRevision', 'actionId'],
    deleteKnowledgeCard: ['cardId', 'expectedRevision', 'actionId'],
    inspectCardOperation: ['operationActionId'], listCardEffects: ['limit', 'cursor'],
    getPrivateCardUsage: [],
  };
  object(input, ['namespace', ...allowed[method]]);
  if (!CARD_READS.has(method)) identifier(input.actionId);
  if (['editCardDraft', 'editKnowledgeCard', 'confirmCardDraft', 'cancelCardDraft',
    'deleteKnowledgeCard', 'deleteSourceNote'].includes(method)) revision(input.expectedRevision);
  if (Object.hasOwn(input, 'cardId')) identifier(input.cardId);
  if (method === 'getCard' && !Object.hasOwn(input, 'cardId')) fail('invalid_input');
  if (method === 'deleteSourceNote') identifier(input.sourceId);
  if (method === 'inspectCardOperation') identifier(input.operationActionId);
  if (method === 'confirmCardDraft' && input.applicability !== undefined &&
      !APPLICABILITY.includes(input.applicability)) fail('invalid_input');
  if (Object.hasOwn(input, 'cursor') && (typeof input.cursor !== 'string' || input.cursor.length > 8192)) fail('invalid_cursor');
  if (['listCards', 'listCardEffects', 'getSource'].includes(method)) pageLimit(input.limit);
  if (method === 'listCards') {
    denseArray(input.states, 1, 2);
    if (input.states.some(state => !['draft', 'confirmed'].includes(state)) || new Set(input.states).size !== input.states.length) fail('invalid_input');
  }
  if (method === 'getCard' && input.responseByteLimit !== undefined &&
      (!Number.isSafeInteger(input.responseByteLimit) || input.responseByteLimit < 1 || input.responseByteLimit > 65536)) fail('invalid_input');
  if (method === 'submitSourceNote') noteInput({ text: input.text, occurredAt: input.occurredAt });
  if (method === 'getSource') {
    sourceRef(input.source, ns, raw);
    if (input.source?.type === 'raw') sourceBudgets(input.budgets);
  }
  if (method === 'createCardDraft') {
    if (input.drafting !== 'authored') fail('source_unavailable');
    object(input.input, ['sources', 'authoredInput', 'memoryRefs', 'sourcePolicy', 'title', 'body']);
    if (['sources', 'authoredInput', 'memoryRefs'].filter(key => Object.hasOwn(input.input, key)).length !== 1) fail('invalid_input');
    if (Object.hasOwn(input.input, 'memoryRefs')) {
      if (input.input.sourcePolicy !== 'retained-receipts-v1') fail('invalid_input');
      cardMemoryRefs(input.input.memoryRefs, ns);
    } else if (Object.hasOwn(input.input, 'sourcePolicy')) fail('invalid_input');
    if (input.input.authoredInput !== undefined) noteInput(input.input.authoredInput);
    else if (input.input.sources !== undefined && refs(input.input.sources, ns, raw).some(ref =>
      !['submitted-note', ...(raw ? ['raw'] : [])].includes(ref.type))) fail('source_unavailable');
    cardText(input.input.title, 200); cardText(input.input.body, 20_000);
  }
  if (method === 'editCardDraft' || method === 'editKnowledgeCard') {
    identifier(input.cardId); cardText(input.title, 200); cardText(input.body, 20_000);
    refs(input.bindings, ns, raw);
    if (method === 'editKnowledgeCard' && !APPLICABILITY.includes(input.applicability)) fail('invalid_input');
  }
  for (const methodName of ['confirmCardDraft', 'cancelCardDraft', 'deleteKnowledgeCard']) {
    if (methodName === method) identifier(input.cardId);
  }
  return ns;
}
