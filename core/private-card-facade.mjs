import { isStorageBusy } from './database.mjs';
import { MemoryStoreError, fail } from './validation.mjs';
import { CARD_METHODS, CARD_READS, deepFreeze, snapshot, validateCardCall } from './private-card-input.mjs';

const fields = ['method', 'namespace', 'actionClass', 'actionId', 'targetId', 'expectedRevision', 'payloadBinding'];
function verified(value, request) {
  if (!value || typeof value !== 'object') fail('authority_required');
  const data = snapshot(value);
  if (Object.keys(data).sort().join() !== [...fields, 'accessGeneration'].sort().join() ||
      !Number.isSafeInteger(data.accessGeneration) || data.accessGeneration < 1 ||
      fields.some(field => JSON.stringify(data[field]) !== JSON.stringify(snapshot(request[field])))) fail('authority_required');
  return data.accessGeneration;
}
function failure(error) {
  let code = error instanceof MemoryStoreError ? error.code : 'storage_error';
  if (isStorageBusy(error)) code = 'storage_busy';
  if (['invalid_identifier', 'invalid_revision', 'invalid_text'].includes(code)) code = 'invalid_input';
  return { ok: false, error: { code, retryable: code === 'storage_busy' } };
}

export function createPrivateCardFacade(storage, options, ready) {
  if (!options) return {};
  const result = {};
  for (const method of CARD_METHODS) {
    result[method] = (input, authority) => {
      try {
        ready();
        const payload = snapshot(input);
        if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > 200_000) fail('invalid_input');
        const ns = validateCardCall(method, payload), read = CARD_READS.has(method);
        const request = deepFreeze({ method, namespace: ns,
          actionClass: read ? 'read' : method === 'createCardDraft' && payload.input.authoredInput !== undefined
            ? 'explicit-user' : ['createCardDraft', 'editCardDraft', 'cancelCardDraft'].includes(method) ? 'draft' : 'explicit-user',
          actionId: read ? null : payload.actionId,
          targetId: payload.cardId ?? payload.sourceId ?? payload.source?.sourceId ?? payload.source?.receiptId ?? payload.operationActionId ?? payload.actionId ?? null,
          expectedRevision: payload.expectedRevision ?? payload.source?.revision ?? payload.source?.memoryRevision ?? null,
          payloadBinding: storage.payloadBinding([method, payload]), input: payload });
        if (!authority || typeof authority !== 'object') fail('authority_required');
        // Both host callbacks run outside the SQLite transaction. No callback,
        // model or await occurs between the final fence and canonical read/commit.
        const grant = options.authority.authorize(request, authority);
        if (!grant || typeof grant !== 'object' || typeof grant.then === 'function') fail('authority_required');
        const generation = verified(options.authority.isCurrent(grant, request), request);
        let finalGeneration;
        try { finalGeneration = verified(options.authority.isCurrent(grant, request), request); }
        catch { fail('scope_changed'); }
        if (generation !== finalGeneration) fail('scope_changed');
        const value = storage.call(method, ns, payload, request.payloadBinding, read);
        if (Buffer.byteLength(JSON.stringify({ ok: true, value }), 'utf8') > 65536) fail('context_item_too_large');
        return { ok: true, value };
      } catch (error) { return failure(error); }
    };
  }
  result.getPrivateCardCapabilities = () => ({ ok: true, value: {
    version: 'private-cards-local-v1', source: 'submitted-note-v1', storage: 'local-plain-v1',
    disclosure: 'explicit-submitted-note-v1', methods: [...CARD_METHODS],
    drafting: ['authored'], sourceTypes: ['submitted-note', 'receipt'],
    memorySourcePolicies: ['retained-receipts-v1'], applicability: ['unknown'],
    usageProjection: 'submitted-note-usage-v1', responseByteLimit: 65536,
    currentEvidence: false, raw: false, modelAssisted: false, publication: false,
  } });
  return result;
}
