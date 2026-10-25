import { ownData } from './local-authority-input.mjs';
import { cardNamespace, cardText, deepFreeze } from './private-card-input.mjs';
import { methodSnapshot, methodRole, methodPackageRef, sameNamespace } from './method-package-input.mjs';
import { evidenceRef } from './private-evidence-input.mjs';
import { fail, identifier, revision, denseArray, object } from './validation.mjs';
import { canonicalJSON } from './task-receipt.mjs';

export const ROLE_WRITES = Object.freeze(['publishRoleProfileRelease','disableRoleProfile','deleteRoleProfileRelease']);
export function roleProfileOptions(value) {
  if (value === undefined) return undefined;
  const input=ownData(value,['version','storage','authority','attribution']);
  if (input.version !== 'role-profiles-local-v1' || input.storage !== 'local-plain-v1') fail('invalid_input');
  const authority=ownData(input.authority,['authorize','isCurrent']);
  if (typeof authority.authorize !== 'function' || typeof authority.isCurrent !== 'function') fail('authority_required');
  const attribution=ownData(input.attribution,['actorId','agentId']);
  for (const key of ['actorId','agentId']) {
    const text=attribution[key]; if (typeof text !== 'string' || !text.trim() || !text.isWellFormed() || text.includes('\0') || text.length>200) fail('invalid_input');
  }
  return Object.freeze({...input,authority:Object.freeze(authority),attribution:Object.freeze(attribution)});
}
export function profileRef(value) {
  object(value,['type','namespace','profileId','roleKey']);
  if (value.type !== 'role-profile' || value.roleKey === null) fail('invalid_input');
  return {type:value.type,namespace:cardNamespace(value.namespace),profileId:identifier(value.profileId),roleKey:methodRole(value.roleKey)};
}
export function releaseRef(value) {
  object(value,['type','profile','releaseId','contentIdentity']);
  if (value.type !== 'role-profile-release' || typeof value.contentIdentity !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.contentIdentity)) fail('invalid_input');
  return {type:value.type,profile:profileRef(value.profile),releaseId:identifier(value.releaseId),contentIdentity:value.contentIdentity};
}
export function roleFields(value,ns) {
  object(value,['duties','requiredOutputs','methods','related','appliesTo']);
  const distinct = refs => { if (new Set(refs.map(canonicalJSON)).size !== refs.length) fail('invalid_input'); return refs; };
  const fields={duties:denseArray(value.duties,1,8).map(text=>cardText(text,300)),requiredOutputs:denseArray(value.requiredOutputs,1,8).map(text=>cardText(text,300)),
    methods:distinct(denseArray(value.methods === undefined ? [] : value.methods,0,16).map(methodPackageRef)),
    related:distinct(denseArray(value.related === undefined ? [] : value.related,0,16).map(ref=>evidenceRef(ref,cardNamespace(ref.namespace)))),
    appliesTo:value.appliesTo === undefined ? null : cardText(value.appliesTo,500)};
  if (fields.methods.some(ref=>ref.namespace.ownerId!==ns.ownerId || !sameNamespace(ref.namespace,ns) && !(ns.scope==='project' && ref.namespace.scope==='personal'))) fail('invalid_input');
  return fields;
}
export function roleWriteInput(method,value) {
  const payload=deepFreeze(methodSnapshot(value,0,{nodes:8192,units:100000,bytes:0}));
  const common=['namespace','roleKey','actionId','expectedCurrentRelease','expectedRegistryRevision'];
  object(payload,[...common,...(method==='publishRoleProfileRelease'?['fields','changeReason']:method==='deleteRoleProfileRelease'?['release','expectedRevision']:[])]);
  if (common.some(key=>!Object.hasOwn(payload,key))) fail('invalid_input');
  const namespace=cardNamespace(payload.namespace); if(payload.roleKey===null)fail('invalid_input'); methodRole(payload.roleKey); identifier(payload.actionId);
  if (payload.expectedRegistryRevision!==null)revision(payload.expectedRegistryRevision);
  if (payload.expectedCurrentRelease!==null)releaseRef(payload.expectedCurrentRelease);
  if (payload.expectedRegistryRevision===null && payload.expectedCurrentRelease!==null)fail('invalid_input');
  for (const ref of [payload.expectedCurrentRelease,payload.release].filter(Boolean)) {
    const r=releaseRef(ref); if(!sameNamespace(r.profile.namespace,namespace)||r.profile.roleKey!==payload.roleKey)fail('invalid_input');
  }
  if(method==='deleteRoleProfileRelease'){releaseRef(payload.release);revision(payload.expectedRevision);}
  let fields,changeReason;
  if(method==='publishRoleProfileRelease') {
    if(Buffer.byteLength(canonicalJSON(payload))>32768)fail('invalid_input');
    fields=roleFields(payload.fields,namespace);
    if(payload.changeReason!==undefined){object(payload.changeReason,['text','reasonRefs']);changeReason={text:cardText(payload.changeReason.text,500),reasonRefs:denseArray(payload.changeReason.reasonRefs===undefined?[]:payload.changeReason.reasonRefs,0,16)};}
  }
  return {payload,namespace,fields,changeReason};
}
