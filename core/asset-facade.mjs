import { ASSET_METHODS,ASSET_READS,ASSET_LIMITS,ASSET_MEDIA,assetSnapshot,freezeAssetMetadata,validateAssetCall } from './asset-input.mjs';
import { deepFreeze } from './private-card-input.mjs';
import { verifyPrivateGrant,privateFailure } from './private-card-facade.mjs';
import { envelopeBytes } from './private-operation-helpers.mjs';
import { fail } from './validation.mjs';

export function createAssetFacade(storage,options,ready) {
  if(!options)return {};
  const facade={};
  for(const method of ASSET_METHODS)facade[method]=(input,authority)=>{
    try {
      ready();
      const payload=freezeAssetMetadata(assetSnapshot(input)),ns=validateAssetCall(method,payload),read=ASSET_READS.has(method);
      // Every signature, content/chunk MAC, and the complete pre-redaction
      // action binding is ready before invoking host code or acquiring a lock.
      const prepared=storage.prepare(method,ns,payload);
      const visible=Object.fromEntries(Object.entries(payload).filter(([key])=>key!=='bytes'));
      if(payload.bytes)visible.bytes={byteCount:payload.bytes.byteLength,commitment:prepared.payloadBinding};
      const request=deepFreeze({method,namespace:ns,actionClass:read?'read':'explicit-user',actionId:read?null:payload.actionId,
        targetId:payload.ref?.derivativeId??payload.ref?.versionId??payload.ref?.assetId??payload.version?.versionId??payload.asset?.assetId??payload.actionId??null,
        expectedRevision:payload.expectedRevision??payload.expectedVersionRevision??payload.expectedAssetRevision??null,payloadBinding:prepared.payloadBinding,input:visible});
      if(!authority||typeof authority!=='object')fail('authority_required');
      const grant=options.authority.authorize(request,authority);
      if(!grant||typeof grant!=='object'||typeof grant.then==='function')fail('authority_required');
      const granted=options.authority.isCurrent(grant,request);
      let generation;try{generation=verifyPrivateGrant(granted,request);}catch{fail('authority_required');}
      let current;try{current=verifyPrivateGrant(options.authority.isCurrent(grant,request),request);}catch{fail('scope_changed');}
      if(current!==generation)fail('scope_changed');
      const value=storage.call(method,ns,payload,prepared,read,generation);
      if(envelopeBytes(value)>65536)fail('context_item_too_large');
      return {ok:true,value};
    } catch(error) {return privateFailure(error);}
  };
  facade.getAssetCapabilities=()=>({ok:true,value:{version:'assets-local-v1',storage:'sqlite-blob-v1',methods:[...ASSET_METHODS],
    refs:['asset','asset-version','asset-derivative'],mediaTypes:[...ASSET_MEDIA],limits:{...ASSET_LIMITS},parser:'unavailable',signature:'signature-matched',
    derivatives:{kinds:['caption','transcript','description','alt-text'],method:'user-provided',provenance:'asset-derivative-provenance-v1',alignment:'user-supplied-unverified'},
    usageProjection:'binary-usage-v1',usageScope:'namespace',quotaScope:'owner',modelAssisted:false,execution:false}});
  return facade;
}
