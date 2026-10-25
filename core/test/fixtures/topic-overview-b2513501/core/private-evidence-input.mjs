import { denseArray, fail, identifier, object, revision } from './validation.mjs';

export const EVIDENCE_METHODS = Object.freeze(['selectEvidence', 'fetchEvidence', 'revalidateEvidence']);
export const APPLICABILITY = Object.freeze(['current', 'historical', 'conflict', 'unknown']);
export const EVIDENCE_DEFAULTS = Object.freeze({ limit: 12, scanRows: 128,
  scanBodyUnits: 256_000, deadlineMs: 1000, responseByteLimit: 65536 });
function integer(value, fallback, maximum) {
  const result = value === undefined ? fallback : value;
  if (!Number.isSafeInteger(result) || result < 1 || result > maximum) fail('invalid_input');
  return result;
}
export function evidenceRef(value, ns) {
  if (!['memory', 'card'].includes(value?.type)) fail('invalid_input');
  object(value, value.type === 'memory' ? ['type', 'namespace', 'memoryId', 'revision'] :
    ['type', 'namespace', 'cardId', 'revision', 'bodyRevision']);
  object(value.namespace, ['ownerId', 'scope', 'projectId']);
  if (['ownerId', 'scope', 'projectId'].some(field => value.namespace[field] !== ns[field])) fail('scope_changed');
  revision(value.revision);
  identifier(value.type === 'memory' ? value.memoryId : value.cardId);
  if (value.type === 'card') revision(value.bodyRevision);
  return { type: value.type, namespace: ns,
    ...(value.type === 'memory' ? { memoryId: value.memoryId } : { cardId: value.cardId }),
    revision: value.revision, ...(value.type === 'card' ? { bodyRevision: value.bodyRevision } : {}) };
}
export function evidenceRefs(values, ns) {
  const result = denseArray(values, 1, 24).map(value => evidenceRef(value, ns));
  if (new Set(result.map(ref => `${ref.type}:${ref.memoryId ?? ref.cardId}`)).size !== result.length) fail('invalid_input');
  return result;
}
export function evidenceInput(method, input, ns) {
  const allowed = method === 'selectEvidence' ? ['query', 'types', 'intent', 'limit', 'scanRows', 'scanBodyUnits', 'deadlineMs', 'cursor'] :
    method === 'fetchEvidence' ? ['refs', 'intent', 'responseByteLimit'] : ['snapshot', 'responseByteLimit'];
  object(input, ['namespace', ...allowed]);
  if (method === 'selectEvidence') {
    if (typeof input.query !== 'string' || !input.query.trim() || input.query.length > 4000) fail('invalid_input');
    denseArray(input.types, 1, 2);
    if (input.types.some(type => !['memory', 'card'].includes(type)) || new Set(input.types).size !== input.types.length) fail('invalid_input');
    if (input.cursor !== undefined && (typeof input.cursor !== 'string' || input.cursor.length > 8192)) fail('invalid_cursor');
    const result = { query: input.query, types: ['memory', 'card'].filter(type => input.types.includes(type)), intent: input.intent,
      limit: integer(input.limit, 12, 24), scanRows: integer(input.scanRows, 128, 1024),
      scanBodyUnits: integer(input.scanBodyUnits, 256_000, 2_000_000), deadlineMs: integer(input.deadlineMs, 1000, 5000) };
    if (!['current', 'history'].includes(result.intent)) fail('invalid_input');
    return result;
  }
  const responseByteLimit = integer(input.responseByteLimit, 65536, 65536);
  if (method === 'fetchEvidence') {
    if (!['current', 'history'].includes(input.intent)) fail('invalid_input');
    return { refs: evidenceRefs(input.refs, ns), intent: input.intent, responseByteLimit };
  }
  if (typeof input.snapshot !== 'string' || input.snapshot.length > 16384) fail('invalid_snapshot');
  return { snapshot: input.snapshot, responseByteLimit };
}
