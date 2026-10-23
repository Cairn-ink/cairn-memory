import { fail } from './validation.mjs';
import { cardNamespace, deepFreeze } from './private-card-input.mjs';
import { verifyPrivateGrant, privateFailure } from './private-card-facade.mjs';
import { envelopeBytes } from './private-operation-helpers.mjs';
import { METHOD_METHODS, METHOD_READS, METHOD_LIMITS, METHOD_MEDIA, methodSnapshot, validateMethodCall, methodReadSet, methodContext } from './method-package-input.mjs';

export function createMethodPackageFacade(storage, options, ready) {
  if (!options) return {};
  const result = {};
  for (const method of METHOD_METHODS) result[method] = (input, authority) => {
    try {
      ready();
      const payload = methodSnapshot(input), ns = validateMethodCall(method,payload), read = METHOD_READS.has(method);
      const request = deepFreeze({ method,namespace: ns,actionClass: read ? 'read' : 'explicit-user',
        actionId: read ? null : payload.actionId,
        targetId: payload.ref?.versionId ?? payload.ref?.packageId ?? payload.version?.versionId ?? payload.package?.packageId ?? payload.from?.packageId ?? payload.actionId ?? null,
        expectedRevision: payload.expectedRevision ?? payload.expectedPackageRevision ?? null,
        payloadBinding: storage.payloadBinding([method,payload]),input: payload });
      if (!authority || typeof authority !== 'object') fail('authority_required');
      const grants = [], readGrants = new Map();
      function authorize(selected) {
        const grant = options.authority.authorize(selected,authority);
        if (!grant || typeof grant !== 'object' || typeof grant.then === 'function') fail('authority_required');
        const current = options.authority.isCurrent(grant,selected);
        let generation;
        try { generation = verifyPrivateGrant(current,selected); } catch { fail('authority_required'); }
        grants.push({ grant,request: selected,generation });
        return generation;
      }
      const accessGeneration = authorize(request);
      if(read)readGrants.set(JSON.stringify(ns),{namespace:ns,accessGeneration});
      function authorizeRead(namespace) {
        const key=JSON.stringify(namespace);
        if(!readGrants.has(key))readGrants.set(key,{namespace,accessGeneration:authorize(deepFreeze({...request,namespace,actionClass:'read',actionId:null}))});
      }
      if(payload.readSet!==undefined)for(const namespace of methodReadSet(payload.readSet))authorizeRead(namespace);
      if(payload.context!==undefined)for(const namespace of methodContext(payload.context).readSet)authorizeRead(namespace);
      // Import consent is not source-read authority. Authorize each exact reason
      // namespace before canonical shape/existence validation in the transaction.
      if (['importMethodVersion','adoptMethodVersion','disableMethodBinding','checkMethodReasonRefs'].includes(method)) {
        const namespaces = new Map((method==='importMethodVersion'?payload.change?.reasonRefs ?? []:payload.reasonRefs ?? []).map(ref => {
          const namespace = cardNamespace(ref.namespace);
          return [JSON.stringify(namespace),namespace];
        }));
        for (const namespace of namespaces.values()) authorizeRead(namespace);
      }
      for (const selected of grants) {
        let current;
        try { current = verifyPrivateGrant(options.authority.isCurrent(selected.grant,selected.request),selected.request); }
        catch { fail('scope_changed'); }
        if (current !== selected.generation) fail('scope_changed');
      }
      const value = storage.call(method,ns,payload,request.payloadBinding,read,{ accessGeneration,access: [...readGrants.values()] });
      if (envelopeBytes(value) > 65536) fail('context_item_too_large');
      return { ok: true,value };
    } catch (error) { return privateFailure(error); }
  };
  result.getMethodPackageCapabilities = () => ({ ok: true,value: {
    version: 'method-packages-local-v1',storage: 'local-plain-v1',methods: [...METHOD_METHODS],
    refs: ['method-package','method-version','method-binding'],intents: ['history','current'],context: true,snapshots: true,
    adoptionBindings: true,adoptionStatus: ['current','never-adopted','withdrawn','newer-version-available','historical','unassessed','unavailable'],mediaTypes: [...METHOD_MEDIA],limits: { ...METHOD_LIMITS },
    usageProjection: 'method-package-usage-v1',usageScope: 'namespace',quotaScope: 'owner',
    modelAssisted: false,execution: false,sourceDerivedImports: false,
  } });
  return result;
}
