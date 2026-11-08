import { denseArray, fail, identifier, object } from './validation.mjs';

export const RAW_CLIENTS = Object.freeze(['claude-code', 'codex']);
export const RAW_REASONS = Object.freeze(['tool_off', 'notice_required', 'quota_reached', 'raw_disabled', 'capture_barrier']);
export const rawBoundary = ns => [ns.ownerId, ns.scope, ns.projectId];

export function rawNamespace(input) {
  object(input, ['ownerId', 'scope', 'projectId']);
  const ownerId = identifier(input.ownerId), scope = input.scope;
  if (scope === 'personal' && (input.projectId === null || input.projectId === '')) return { ownerId, scope, projectId: '' };
  if (scope === 'project') return { ownerId, scope, projectId: identifier(input.projectId) };
  fail('invalid_namespace');
}

export function rawClient(value) {
  if (!RAW_CLIENTS.includes(value)) fail('invalid_input');
  return value;
}

export function rawInstant(value) {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(value) ||
      !Number.isFinite(Date.parse(value)) || new Date(value).toISOString() !== value) fail('invalid_input');
  return value;
}

export function rawText(value) {
  if (typeof value !== 'string' || !value.length || value.length > 4000 || !value.isWellFormed() || value.includes('\0')) {
    fail('invalid_input');
  }
  return value;
}

export function rawRegistration(input) {
  object(input, ['namespace', 'client', 'sessionId', 'eventId', 'messages']);
  const result = { namespace: rawNamespace(input.namespace), client: rawClient(input.client),
    sessionId: identifier(input.sessionId), eventId: identifier(input.eventId), messages: [] };
  const ids = new Set();
  for (const message of denseArray(input.messages, 1, 24)) {
    object(message, ['id', 'role', 'occurredAt', 'messageOrdinal', 'content', 'part']);
    const id = identifier(message.id), content = rawText(message.content), occurredAt = rawInstant(message.occurredAt);
    if (ids.has(id) || !['user','assistant'].includes(message.role) || !Number.isSafeInteger(message.messageOrdinal) || message.messageOrdinal < 1) fail('invalid_input');
    ids.add(id);
    object(message.part, ['index','start','totalUnits','totalBytes']);
    const { index, start, totalUnits, totalBytes } = message.part;
    if (![index,start,totalUnits,totalBytes].every(Number.isSafeInteger) || index < 0 || start < 0 || totalUnits < 1 || totalBytes < 1 ||
        start + content.length > totalUnits || !Number.isSafeInteger(start + content.length) ||
        (index === 0 && start !== 0) || (index > 0 && start === 0) || Buffer.byteLength(content) > totalBytes) fail('invalid_input');
    result.messages.push({ id, role: message.role, occurredAt, messageOrdinal: message.messageOrdinal, content,
      part: { index, start, totalUnits, totalBytes } });
  }
  if (result.messages.reduce((n,m) => n + m.content.length, 0) > 20000 || Buffer.byteLength(JSON.stringify(result)) > 65536) fail('invalid_input');
  return result;
}

export function rawPolicy(value) {
  object(value, ['generation','reason']);
  const generation = identifier(value.generation);
  if (value.reason !== null && !['tool_off','notice_required','raw_disabled'].includes(value.reason)) fail('invalid_input');
  return { generation, reason: value.reason };
}

export function rawContext(ns, client, sessionKey, conversationId, message, end = message.part.start + message.content.length) {
  return { version: 'raw-seal-v1', namespace: { ownerId: ns.ownerId, scope: ns.scope, projectId: ns.projectId || null },
    client, sessionKey, conversationId, messageId: message.id, messageOrdinal: message.messageOrdinal,
    role: message.role, occurredAt: message.occurredAt, partIndex: message.part.index,
    start: message.part.start, end,
    totalUnits: message.part.totalUnits, totalBytes: message.part.totalBytes };
}

export function rawSealed(value) {
  object(value, ['format','keyVersion','sealed']);
  if (!(value.sealed instanceof Uint8Array) || !value.sealed.byteLength ||
      !['local-plain-v1','envelope-aes-256-gcm-v1'].includes(value.format) ||
      (value.format === 'local-plain-v1' ? value.keyVersion !== null :
        typeof value.keyVersion !== 'string' || !/^[\x21-\x7e]{1,64}$/.test(value.keyVersion))) fail('raw_crypto_unavailable');
  return { format: value.format, keyVersion: value.keyVersion, sealed: Buffer.from(value.sealed) };
}
