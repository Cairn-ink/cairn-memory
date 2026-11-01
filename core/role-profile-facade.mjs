import { cachedContentLayout } from './content-safety-schema.mjs';
import { hasContentSuppressionRequestInside, contentSuppressionRequestInside, assertContentSuppressionRequestInside } from './content-suppression-storage.mjs';
import { assertContentScopes, contentSafetyFacade, contentScopeEpochGuard, contentAuthorityPort } from './content-safety-boundary.mjs';
import { ROLE_WRITES, roleWriteInput } from './role-profile-input.mjs';
import { deepFreeze, cardNamespace } from './private-card-input.mjs';
import { verifyPrivateGrant, privateFailure } from './private-card-facade.mjs';
import { canonicalJSON } from './task-receipt.mjs';
import { createRoleContextReader } from './role-context-facade.mjs';
import { fail } from './validation.mjs';

export function roleAccess(port,request,token,scopes) {
  if(!token||typeof token!=='object')fail('authority_required');
  const grants=[];
  const authorize=(namespace,primary=false,selectedPort=port)=>{
    selectedPort=contentAuthorityPort(selectedPort);
    const selected=deepFreeze(primary?{...request,namespace}:{...request,namespace,actionClass:'read',actionId:null,targetId:null,expectedRevision:null});
    let grant,generation;
    try {grant=selectedPort.authorize(selected,token);if(!grant||typeof grant!=='object'||typeof grant.then==='function')fail('authority_required');generation=verifyPrivateGrant(selectedPort.isCurrent(grant,selected),selected);}catch{fail('authority_required');}
    grants.push({grant,generation,request:selected,port:selectedPort});return generation;
  };
  authorize(request.namespace,true);
  for(const ns of scopes)if(!grants.some(g=>canonicalJSON(g.request.namespace)===canonicalJSON(ns)&&g.request.actionClass==='read'))authorize(ns);
  const check=()=>{for(const g of grants){let current;try{current=verifyPrivateGrant(g.port.isCurrent(g.grant,g.request),g.request);}catch{fail('scope_changed');}if(current!==g.generation)fail('scope_changed');}};
  return {check,authorize,access:scopes.map(namespace=>({namespace,accessGeneration:grants.find(g=>g.request.actionClass==='read'&&canonicalJSON(g.request.namespace)===canonicalJSON(namespace))?.generation??grants[0].generation}))};
}
export function createRoleProfileFacade(storage,options,config) {
  if(!options)return {};
  const result={};
  for(const method of ROLE_WRITES)result[method]=(original,token)=>{
    try {
      storage.ready();const {payload,namespace,fields,changeReason}=roleWriteInput(method,original);
      const input=deepFreeze({payload,attribution:options.attribution});
      const request=deepFreeze({method,namespace,actionClass:'write',actionId:payload.actionId,
        targetId:method==='deleteRoleProfileRelease'?payload.release.releaseId:payload.roleKey,
        expectedRevision:method==='deleteRoleProfileRelease'?payload.expectedRevision:payload.expectedRegistryRevision,
        payloadBinding:storage.bind('role-profile-action-v1',[method,input]),input});
      const scopes=[...new Map((payload.changeReason?.reasonRefs??[]).map(ref=>{const ns=cardNamespace(ref.namespace);return [canonicalJSON(ns),ns];})).values()];
      const access=roleAccess(options.authority,request,token,scopes);access.check();
      return {ok:true,value:storage.mutate(method,namespace,payload,request.payloadBinding,fields,changeReason,options.attribution)};
    }catch(error){return privateFailure(error);}
  };
  return contentSafetyFacade({...result,readRoleTaskContext:createRoleContextReader(storage,options,config)}, { writeBoundary:storage, portGuard:scopes=>contentScopeEpochGuard(storage.db,scopes),
    check: (scopes,{delivery}) => { storage.ready(); if (!delivery && scopes.length && cachedContentLayout(storage.db)?.suppressionRevision && hasContentSuppressionRequestInside(storage.db) && !storage.db.isTransaction) { contentSuppressionRequestInside(storage.db,scopes,{defer:true}); return; } if(delivery)assertContentSuppressionRequestInside(storage.db,scopes); assertContentScopes(storage.db,scopes); }, failure: privateFailure, validate: (method,args,result,scopes) => { if(method==='readRoleTaskContext'&&result?.ok)storage.assertContentOutput(result.value,scopes); } });
}
