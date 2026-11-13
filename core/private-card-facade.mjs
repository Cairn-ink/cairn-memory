import { contentSafetyFacade, contentAuthorityPort } from './content-safety-boundary.mjs';
import { dispatchCommit, hasCommitDispatcher, withCommitDelivery, inCommitDelivery } from './commit-dispatch.mjs';
import { CARD_CURRENT_VERSION, CARD_CURRENT_METHODS } from './card-current-input.mjs';
import { authorizeCardCurrentDependencies } from './card-current-facade.mjs';
import { isStorageBusy } from './database.mjs';
import { MemoryStoreError, fail } from './validation.mjs';
import { CARD_METHODS, CARD_READS, deepFreeze, snapshot, validateCardCall } from './private-card-input.mjs';
import { APPLICABILITY, EVIDENCE_DEFAULTS } from './private-evidence-input.mjs';
import { ORGANIZATION_METHODS, ORGANIZATION_WRITES } from './private-organization-input.mjs';

const fields = ['method', 'namespace', 'actionClass', 'actionId', 'targetId', 'expectedRevision', 'payloadBinding'];
export function verifyPrivateGrant(value, request) {
  if (!value || typeof value !== 'object') fail('authority_required');
  const data = snapshot(value);
  if (Object.keys(data).sort().join() !== [...fields, 'accessGeneration'].sort().join() ||
      !Number.isSafeInteger(data.accessGeneration) || data.accessGeneration < 1 ||
      fields.some(field => JSON.stringify(data[field]) !== JSON.stringify(snapshot(request[field])))) fail('authority_required');
  return data.accessGeneration;
}
function verifyCardMutationGrant(value,request) {
  if(!value||typeof value!=='object')fail('authority_required');
  const data=snapshot(value), extra=['auditVersion','actorId','authorizedAt','authorizationKind'];
  if(Object.keys(data).sort().join()!==[...fields,'accessGeneration',...extra].sort().join()||
    data.auditVersion!=='card-action-audit-v1'||typeof data.actorId!=='string'||!data.actorId||data.actorId.length>200||
    typeof data.authorizedAt!=='string'||!Number.isFinite(Date.parse(data.authorizedAt))||new Date(data.authorizedAt).toISOString()!==data.authorizedAt||
    !['operation','authored-input','keep-as-own','user-rewrite'].includes(data.authorizationKind)||
    data.authorizationKind!=='operation'&&request.actionClass!=='explicit-user')fail('authority_required');
  const ordinary=Object.fromEntries(Object.entries(data).filter(([key])=>!extra.includes(key)));
  return {generation:verifyPrivateGrant(ordinary,request),audit:{actorId:data.actorId,authorizedAt:data.authorizedAt,authorizationKind:data.authorizationKind}};
}
export function privateFailure(error) {
  let code = error instanceof MemoryStoreError ? error.code : 'storage_error';
  if (isStorageBusy(error)) code = 'storage_busy';
  if (['invalid_identifier', 'invalid_revision', 'invalid_text'].includes(code)) code = 'invalid_input';
  return { ok: false, error: { code, retryable: code === 'storage_busy' } };
}

export function createPrivateCardFacade(storage, options, ready, rawReader) {
  if (!options) return {};
  options={...options,authority:contentAuthorityPort(options.authority)};
  const result = {};
  const methods = [...CARD_METHODS, ...(options.currentDependencies ? CARD_CURRENT_METHODS : []), ...(rawReader ? ['resolveSourceReferences'] : [])];
  for (const method of methods) {
    result[method] = (input, authority) => {
      try {
        ready();
        const dependencyAuthoring = options.currentDependencies && (CARD_CURRENT_METHODS.includes(method) || method === 'confirmCardDraft');
        const payload = dependencyAuthoring ? snapshot(input, 0, { nodes: 16384, units: 400_000 }) : snapshot(input);
        if (Buffer.byteLength(JSON.stringify(payload), 'utf8') > (dependencyAuthoring ? 400_000 : 200_000)) fail('invalid_input');
        const lineage=storage.lineageEnabled(), read = CARD_READS.has(method) || method === 'resolveSourceReferences';
        const ns = validateCardCall(method, payload, Boolean(rawReader), Boolean(options.currentDependencies),lineage);
        const request = deepFreeze({ method, namespace: ns,
          actionClass: read ? 'read' : ORGANIZATION_WRITES.includes(method) ? 'organization' :
            (method === 'createCardDraft' && payload.input.authoredInput !== undefined || lineage && method === 'editCardDraft' && payload.bindings.length===0)
            ? 'explicit-user' : ['createCardDraft', 'editCardDraft', 'cancelCardDraft'].includes(method) ? 'draft' : 'explicit-user',
          actionId: read ? null : payload.actionId,
          targetId: payload.cardId ?? payload.mappingId ?? payload.mocId ?? payload.topicRef?.mocId ?? payload.sourceId ?? payload.source?.sourceId ?? payload.source?.receiptId ?? payload.operationActionId ?? payload.actionId ?? null,
          expectedRevision: payload.expectedRevision ?? payload.topicRef?.revision ?? payload.source?.revision ?? payload.source?.memoryRevision ?? null,
          payloadBinding: storage.payloadBinding([method, payload]), input: payload,
          ...(lineage&&!read?{auditVersion:'card-action-audit-v1'}:{}) });
        if (!authority || typeof authority !== 'object') fail('authority_required');
        // Both host callbacks run outside the SQLite transaction. No callback,
        // model or await occurs between the final fence and canonical read/commit.
        const grant = options.authority.authorize(request, authority);
        if (!grant || typeof grant !== 'object' || typeof grant.then === 'function') fail('authority_required');
        const verify=value=>lineage&&!read?verifyCardMutationGrant(value,request):{generation:verifyPrivateGrant(value,request)};
        const verified=verify(options.authority.isCurrent(grant,request)),generation=verified.generation;
        if (rawReader && (method === 'resolveSourceReferences' || method === 'getSource' && payload.source.type === 'raw')) {
          return (async () => {
            try {
              const prepared = await rawReader.prepare(method, ns, payload, generation);
              let current;
              try { current = verifyPrivateGrant(options.authority.isCurrent(grant, request), request); }
              catch { fail('scope_changed'); }
              if (current !== generation) fail('scope_changed');
              const value = prepared.finish();
              return { ok: true, value };
            } catch (error) { return privateFailure(error); }
          })();
        }
        const dependencies = payload.currentDependencies ? authorizeCardCurrentDependencies(options, request, authority) : null;
        const mutate = () => {
        if (hasCommitDispatcher(storage)) storage.assertContentScope([ns], { delivery: false });
        let finalGeneration;
        try { const final=verify(options.authority.isCurrent(grant,request));finalGeneration=final.generation;
          if(JSON.stringify(final.audit)!==JSON.stringify(verified.audit))fail('scope_changed'); }
        catch { fail('scope_changed'); }
        if (generation !== finalGeneration) fail('scope_changed');
        dependencies?.check();
        const value = storage.call(method, ns, payload, request.payloadBinding, read, { accessGeneration: finalGeneration, access: dependencies?.access, audit:verified.audit });
        return value;
        };
        const deliver = value => {
        if (Buffer.byteLength(JSON.stringify({ ok: true, value }), 'utf8') > 65536) fail('context_item_too_large');
        return { ok: true, value };
        };
        const value = hasCommitDispatcher(storage) ? dispatchCommit(storage, mutate) : mutate();
        return value && typeof value.then === 'function' ? value.then(deliver).catch(privateFailure) : deliver(value);
      } catch (error) { return privateFailure(error); }
    };
  }
  result.getPrivateCardCapabilities = () => ({ ok: true, value: {
    version: 'private-cards-local-v1', source: 'submitted-note-v1', storage: 'local-plain-v1',
    disclosure: 'explicit-submitted-note-v1', methods: [...methods],
    drafting: ['authored'], sourceTypes: ['submitted-note', 'receipt', ...(rawReader ? ['raw'] : [])],
    memorySourcePolicies: ['retained-receipts-v1'], applicability: [...APPLICABILITY],
    confirmationApplicability: 'explicit-optional-review',
    usageProjection: 'submitted-note-usage-v1', responseByteLimit: 65536,
    currentEvidence: true, evidenceReads: { version: 'exact-namespace-evidence-v1', namespace: 'exact',
      types: ['memory', 'card'], intents: ['current', 'history'], selection: 'literal-unicode-word-overlap',
      defaults: { ...EVIDENCE_DEFAULTS }, limits: { limit: 24, scanRows: 1024,
        scanBodyUnits: 2_000_000, deadlineMs: 5000, refs: 24, receiptMetadata: 16 },
      semanticRelevance: false, typedCardMoc: true },
    organization: { version: 'typed-evidence-organization-v1', methods: [...ORGANIZATION_METHODS],
      actionClasses: { applyCardPlacement: 'organization', refreshCardTopic: 'organization', proposeEvidenceMapping: 'organization', reviewEvidenceMapping: 'explicit-user' },
      maxCards: 5, maxParents: 3, maxActiveMappingsPerTopic: 16,
      defaultPageLimit: 20, maxPageLimit: 50, maxCardMapScanRows: 256, implicitSelectionExpansion: false },
    ...(options.currentDependencies ? { currentDependencies: { version: CARD_CURRENT_VERSION, methods: [...CARD_CURRENT_METHODS], maxPackages: 16, maxVectorBytes: 32768, actionClass: 'explicit-user' } } : {}),
    raw: Boolean(rawReader), modelAssisted: false, publication: false,
  } });
  return contentSafetyFacade(result, { writeBoundary:storage, requestScope: hasCommitDispatcher(storage) ? work => withCommitDelivery(work) : undefined, check: (scopes,phase) => phase?.delivery && hasCommitDispatcher(storage) ? inCommitDelivery(() => storage.assertContentScope(scopes,phase)) : storage.assertContentScope(scopes,phase), failure: privateFailure, validate: (method,args,result,scopes) => { if(CARD_READS.has(method)&&result?.ok) { const validate=()=>storage.assertContentOutput(result.value,scopes); if(hasCommitDispatcher(storage))inCommitDelivery(validate);else validate(); } }, noOwner: ['getPrivateCardCapabilities'] });
}
