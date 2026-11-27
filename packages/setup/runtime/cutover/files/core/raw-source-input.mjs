import { denseArray, fail, identifier, object, revision } from './validation.mjs';

export function rawSpan(value) {
  object(value, ['start','end','precision']);
  const { start, end, precision } = value;
  if (![start,end].every(Number.isSafeInteger) || start < 0 || end <= start ||
      !['exact','whole-message'].includes(precision)) fail('invalid_input');
  return { start, end, precision };
}
export function rawSourceRef(value, ns) {
  object(value, ['type','namespace','conversationId','messageId','span','contentIdentity']);
  object(value.namespace, ['ownerId','scope','projectId']);
  if (value.type !== 'raw' || ['ownerId','scope','projectId'].some(key => value.namespace[key] !== ns[key])) fail('source_unavailable');
  if (typeof value.contentIdentity !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.contentIdentity)) fail('source_unavailable');
  return { type: 'raw', namespace: { ...ns }, conversationId: identifier(value.conversationId),
    messageId: identifier(value.messageId), span: rawSpan(value.span), contentIdentity: value.contentIdentity };
}
export const rawSourceKey = ref => JSON.stringify([ref.conversationId, ref.messageId, ref.span.start, ref.span.end]);
export function sourceBudgets(value = {}) {
  object(value, ['sourceByteLimit','scanRowLimit','deadlineMs','responseByteLimit']);
  return Object.fromEntries(Object.entries({ sourceByteLimit: [16000,64000], scanRowLimit: [128,1024],
    deadlineMs: [1000,5000], responseByteLimit: [65536,65536] }).map(([key,[fallback,max]]) => {
    const number = value[key] ?? fallback;
    if (!Number.isSafeInteger(number) || number < 1 || number > max || value[key] === null) fail('invalid_input');
    return [key,number];
  }));
}
export function sourceAnchors(value) {
  return denseArray(value, 1, 16).map(entry => {
    object(entry, ['rawAnchor','expectedConversationRevision']);
    object(entry.rawAnchor, ['conversationId','messageId','start','end','precision']);
    const { conversationId, messageId, ...span } = entry.rawAnchor;
    return { conversationId: identifier(conversationId), messageId: identifier(messageId), span: rawSpan(span),
      expectedRevision: revision(entry.expectedConversationRevision) };
  });
}
