import { types } from 'node:util';
import { fail, identifier } from './validation.mjs';
import { rawNamespace, rawClient } from './raw-input.mjs';

// Reject proxies before reflection, and accessors before reading any value.
export function ownData(value, allowed) {
  if (!value || typeof value !== 'object' || types.isProxy(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('invalid_input');
  const descriptors = Object.getOwnPropertyDescriptors(value), result = {};
  for (const key of Reflect.ownKeys(descriptors)) {
    if (typeof key !== 'string' || !allowed.includes(key) || !Object.hasOwn(descriptors[key], 'value')) fail('invalid_input');
    result[key] = descriptors[key].value;
  }
  return result;
}
const count = value => { if (!Number.isSafeInteger(value) || value < 0) fail('invalid_input'); return value; };
const id = value => { try { return identifier(value); } catch { fail('invalid_input'); } };
export function localNamespace(value) {
  try { return Object.freeze(rawNamespace(ownData(value, ['ownerId','scope','projectId']))); }
  catch { fail('invalid_input'); }
}
export function localControlInput(value, setter = false) {
  const input = ownData(value, ['namespace','client', ...(setter ? ['targetId','expectedStoreId','expectedRevision','automaticCaptureEnabled','rawNoticeVersion'] : [])]);
  const result = { namespace: localNamespace(input.namespace), client: rawClient(input.client) };
  if (!setter) return result;
  if (typeof input.automaticCaptureEnabled !== 'boolean' || ![null,'local-plain-v1'].includes(input.rawNoticeVersion)) fail('invalid_input');
  return { ...result, targetId: id(input.targetId), expectedStoreId: id(input.expectedStoreId), expectedRevision: count(input.expectedRevision),
    automaticCaptureEnabled: input.automaticCaptureEnabled, rawNoticeVersion: input.rawNoticeVersion };
}
export function localAuthorityInput(value) {
  const input = ownData(value, ['version','targetId','storeId','namespace','client','expectedControlRevision',
    'expectedConsentGeneration','expectedNamespaceGeneration','expectedRawRevision']);
  if (input.version !== 'local-capture-authority-v1') fail('invalid_input');
  return Object.freeze({ version: input.version, targetId: id(input.targetId), storeId: id(input.storeId),
    namespace: localNamespace(input.namespace), client: rawClient(input.client), expectedControlRevision: count(input.expectedControlRevision),
    expectedConsentGeneration: id(input.expectedConsentGeneration), expectedNamespaceGeneration: id(input.expectedNamespaceGeneration),
    expectedRawRevision: count(input.expectedRawRevision) });
}
export function managedRequest(value, episodes) {
  const input = ownData(value, ['namespace','client','sessionId','eventId','messages', episodes ? 'episodeContext' : 'causal']);
  input.namespace = localNamespace(input.namespace);
  const messages = input.messages;
  if (!Array.isArray(messages) || types.isProxy(messages) || messages.length < 1 || messages.length > 24) fail('invalid_input');
  const descriptors = Object.getOwnPropertyDescriptors(messages);
  if (Reflect.ownKeys(descriptors).some(key => typeof key !== 'string' || key !== 'length' &&
      (!/^(0|[1-9][0-9]*)$/.test(key) || Number(key) >= messages.length || !Object.hasOwn(descriptors[key], 'value')))) fail('invalid_input');
  input.messages = Array.from({ length: messages.length }, (_, index) => {
    if (!Object.hasOwn(descriptors, index)) fail('invalid_input');
    const message = ownData(descriptors[index].value, ['id','role','occurredAt','messageOrdinal','content','part']);
    message.part = ownData(message.part, ['index','start','totalUnits','totalBytes']);
    return message;
  });
  if (Object.hasOwn(input,'causal')) input.causal = ownData(input.causal, ['streamId','sequence']);
  if (Object.hasOwn(input,'episodeContext')) input.episodeContext = ownData(input.episodeContext, ['clientLabel','generation','origin']);
  return input;
}
