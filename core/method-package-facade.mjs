import { fail } from './validation.mjs';
import { cardNamespace, deepFreeze } from './private-card-input.mjs';
import { verifyPrivateGrant, privateFailure } from './private-card-facade.mjs';
import { envelopeBytes } from './private-operation-helpers.mjs';
import { METHOD_METHODS, METHOD_READS, METHOD_LIMITS, METHOD_MEDIA, methodSnapshot, validateMethodCall, methodReadSet, methodContext } from './method-package-input.mjs';
import { ASSET_MEDIA,freezeAssetMetadata } from './asset-input.mjs';
import { mixedMethodFiles,METHOD_BINARY_LIMITS } from './method-attachment-input.mjs';

export function createMethodPackageFacade(storage, options, ready,assets) {
  if (!options) return {};
  const result = {};
  for (const method of METHOD_METHODS) result[method] = (input, authority) => {
    try {
      ready();
      const payload = freezeAssetMetadata(methodSnapshot(input,0,undefined,true)), ns = validateMethodCall(method,payload,mixedMethodFiles), read = METHOD_READS.has(method);
      const binary=method==='readMethodAttachmentBytes'||method==='importMethodVersion'&&payload.manifestFormat==='mixed-v1';
      if(binary&&!assets)fail('unsupported_media');
      const prepared=method==='importMethodVersion'&&payload.manifestFormat==='mixed-v1'?storage.prepareMixed(ns,payload):null;
      const payloadBinding=prepared?.payloadBinding??storage.payloadBinding([method,payload]);
      const visible=prepared?{...payload,files:payload.files.map(file=>file.kind==='binary'?{...file,bytes:{byteCount:file.bytes.byteLength,commitment:payloadBinding}}:file)}:payload;
      const request = deepFreeze({ method,namespace: ns,actionClass: read ? 'read' : 'explicit-user',
        actionId: read ? null : payload.actionId,
        targetId: payload.ref?.versionId ?? payload.ref?.packageId ?? payload.version?.versionId ?? payload.package?.packageId ?? payload.from?.packageId ?? payload.actionId ?? null,
        expectedRevision: payload.expectedRevision ?? payload.expectedPackageRevision ?? null,
        payloadBinding,input: visible });
      if (!authority || typeof authority !== 'object') fail('authority_required');
      const grants = [], readGrants = new Map();
      function authorize(selected,port=options.authority) {
        const grant = port.authorize(selected,authority);
        if (!grant || typeof grant !== 'object' || typeof grant.then === 'function') fail('authority_required');
        const current = port.isCurrent(grant,selected);
        let generation;
        try { generation = verifyPrivateGrant(current,selected); } catch { fail('authority_required'); }
        grants.push({ grant,request: selected,generation,port });
        return generation;
      }
      const accessGeneration = authorize(request);
      const binaryAccessGeneration=binary?authorize(deepFreeze({...request,namespace:method==='readMethodAttachmentBytes'?payload.version.namespace:ns}),assets.authority):null;
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
        try { current = verifyPrivateGrant(selected.port.isCurrent(selected.grant,selected.request),selected.request); }
        catch { fail('scope_changed'); }
        if (current !== selected.generation) fail('scope_changed');
      }
      const value = storage.call(method,ns,payload,request.payloadBinding,read,{ accessGeneration,access: [...readGrants.values()],binaryAccessGeneration },prepared);
      if (envelopeBytes(value) > 65536) fail('context_item_too_large');
      return { ok: true,value };
    } catch (error) { return privateFailure(error); }
  };
  result.getMethodPackageCapabilities = () => ({ ok: true,value: {
    version: 'method-packages-local-v1',storage: 'local-plain-v1',methods: [...METHOD_METHODS],
    refs: ['method-package','method-version','method-binding'],intents: ['history','current'],context: true,snapshots: true,
    adoptionBindings: true,adoptionStatus: ['current','never-adopted','withdrawn','newer-version-available','historical','unassessed','unavailable'],mediaTypes: [...METHOD_MEDIA],limits: { ...METHOD_LIMITS },
    usageProjection: 'method-package-usage-v1',usageScope: 'namespace',quotaScope: 'owner',
    manifestFormats:['text-v30','mixed-v1'],binaryDelivery:Boolean(assets),binaryLimits:{...METHOD_BINARY_LIMITS},
    binaryMediaTypes:[...ASSET_MEDIA],parser:'unavailable',modelAssisted: false,execution: false,sourceDerivedImports: false,
  } });
  return result;
}
