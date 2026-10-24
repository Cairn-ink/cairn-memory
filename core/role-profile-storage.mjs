import { releaseRef as parseReleaseRef } from './role-profile-input.mjs';
import { randomUUID } from 'node:crypto';
import { transaction } from './database.mjs';
import { keyed, cardText } from './private-card-input.mjs';
import { privateBoundary as boundary, privateWhere as where, createOperationLedger } from './private-operation-helpers.mjs';
import { canonicalJSON, canonicalObject } from './task-receipt.mjs';
import { sameNamespace, methodReasons } from './method-package-input.mjs';
import { fail } from './validation.mjs';

export function createRoleProfileStorage({db,identity,ready,methods}) {
  const bind=(purpose,value)=>keyed(identity.cursorSecret,purpose,[identity.storeId,canonicalObject(value)]);
  const ledger=createOperationLedger(db,'role_profile_operations');
  const row=(ns,key)=>db.prepare(`SELECT * FROM role_profiles WHERE ${where} AND role_key=?`).get(...boundary(ns),key);
  const ref=(ns,p)=>({type:'role-profile',namespace:ns,profileId:p.id,roleKey:p.role_key});
  const releaseRef=(profile,id,contentIdentity)=>({type:'role-profile-release',profile,releaseId:id,contentIdentity});
  function registry(ns,key) {
    const p=row(ns,key);
    return {namespace:ns,roleKey:key,ref:p?ref(ns,p):null,state:p?.state??'absent',currentRelease:p?.current_release_id?releaseRef(ref(ns,p),p.current_release_id,p.current_identity):null,revision:p?.revision??null};
  }
  function releaseRow(r) {
    const p=row(r.profile.namespace,r.profile.roleKey);
    if (!p || p.id!==r.profile.profileId) return null;
    return db.prepare('SELECT * FROM role_profile_releases WHERE profile_id=? AND id=? AND content_identity=?').get(p.id,r.releaseId,r.contentIdentity)??null;
  }
  function reason(record,ns) {
    if(!record?.payload)return {status:'not-recorded',text:null,refs:[]};
    const payload=JSON.parse(record.payload),refs=payload.reasonRefs.map(ref=>({ref,status:methods.reasonAvailable(ns,ref)?'available':'unavailable'}));
    const available=refs.length===0||refs.some(r=>r.status==='available');
    return {status:available?'available':'recorded-unavailable',text:available?payload.text:null,refs};
  }
  function release(r) {
    r=parseReleaseRef(r);
    const entry=releaseRow(r);if(!entry)return null;
    const payload=entry.payload?JSON.parse(entry.payload):null;
    if(payload && (canonicalJSON(payload)!==entry.payload || Buffer.byteLength(entry.payload)!==entry.byte_count || bind('role-profile-release-v1',[r.profile,entry.ordinal,payload])!==r.contentIdentity))fail('method_version_unavailable');
    return {ref:r,ordinal:entry.ordinal,basedOn:entry.predecessor_id?releaseRef(r.profile,entry.predecessor_id,entry.predecessor_identity):null,
      state:entry.state,revision:entry.revision,createdAt:entry.created_at,actorId:payload?.actorId??null,agentId:payload?.agentId??null,
      fields:payload?.fields??null,changeReason:payload?(()=>{const record=db.prepare('SELECT * FROM role_profile_changes WHERE to_id=?').get(entry.id);return record?.payload?reason(record,r.profile.namespace):null;})():null};
  }
  function resolve(readSet,key) {
    const registries=[];
    for(const ns of [...readSet].reverse()) {const r=registry(ns,key);registries.push(r);if(r.state!=='absent')break;}
    const winner=registries.at(-1),selected=winner.currentRelease?release(winner.currentRelease):null;
    return {registries,profile:{applicability:winner.state==='absent'?'no-profile':winner.state==='disabled'?'withdrawn':selected?.state==='available'?'current':'unavailable',release:selected}};
  }
  function mutate(method,ns,input,binding,fields,changeReason,attribution) {
    ready();return transaction(db,()=>{
      const replay=ledger.replay(ns,input.actionId,method,binding);if(replay!==undefined)return replay;
      const old=registry(ns,input.roleKey),p=row(ns,input.roleKey),timestamp=new Date().toISOString();
      if(old.revision!==input.expectedRegistryRevision || canonicalJSON(old.currentRelease)!==canonicalJSON(input.expectedCurrentRelease))fail('revision_conflict');
      const profile=p?ref(ns,p):{type:'role-profile',namespace:ns,profileId:randomUUID(),roleKey:input.roleKey};
      if(!p&&db.prepare(`SELECT count(*) n FROM role_profiles WHERE ${where}`).get(...boundary(ns)).n>=256)fail('package_limit_reached');
      let result,kind,head=old.currentRelease,state=p?.state??'disabled',ordinal=p?.next_ordinal??1;
      const nextRevision=(p?.revision??0)+1;
      if(method==='publishRoleProfileRelease') {
        if(ordinal>128)fail('package_limit_reached');
        if(changeReason)changeReason={text:changeReason.text,reasonRefs:methodReasons(changeReason.reasonRefs,ns)};
        if(changeReason?.reasonRefs.some(r=>!methods.reasonAvailable(ns,r)))fail('method_not_found');
        const base=old.currentRelease?releaseRow(old.currentRelease):null;
        const basedOn=base?.state==='available'?old.currentRelease:null;
        const payload=canonicalJSON({fields,actorId:cardText(attribution.actorId,200),agentId:cardText(attribution.agentId,200),createdAt:timestamp});
        const reasonPayload=changeReason?canonicalJSON(changeReason):null;
        const bytes=Buffer.byteLength(payload),reasonBytes=reasonPayload?Buffer.byteLength(reasonPayload):0;
        if(bytes>32768||reasonBytes>32768)fail('invalid_input');
        if(!db.prepare('SELECT 1 FROM role_profile_owner_usage WHERE owner_id=?').get(ns.ownerId))db.prepare('INSERT INTO role_profile_owner_usage VALUES(?,0)').run(ns.ownerId);
        if(db.prepare('UPDATE role_profile_owner_usage SET byte_count=byte_count+? WHERE owner_id=? AND byte_count+?<=50000000').run(bytes+reasonBytes,ns.ownerId,bytes+reasonBytes).changes!==1)fail('quota_reached');
        head=releaseRef(profile,randomUUID(),bind('role-profile-release-v1',[profile,ordinal,JSON.parse(payload)]));state='active';
        if(!p)db.prepare('INSERT INTO role_profiles VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(profile.profileId,...boundary(ns),input.roleKey,state,head.releaseId,head.contentIdentity,nextRevision,ordinal+1,timestamp,timestamp);
        else db.prepare('UPDATE role_profiles SET state=?,current_release_id=?,current_identity=?,revision=?,next_ordinal=?,updated_at=? WHERE id=?').run(state,head.releaseId,head.contentIdentity,nextRevision,ordinal+1,timestamp,p.id);
        db.prepare("INSERT INTO role_profile_releases VALUES(?,?,?,?,?,?,'available',1,?,?,?)").run(head.releaseId,profile.profileId,ordinal,head.contentIdentity,basedOn?.releaseId??null,basedOn?.contentIdentity??null,payload,bytes,timestamp);
        db.prepare('INSERT INTO role_profile_changes VALUES(?,?,?,?,?,?,?)').run(head.releaseId,profile.profileId,head.contentIdentity,basedOn?.releaseId??null,basedOn?.contentIdentity??null,reasonPayload,reasonBytes);
        // A content-free row also freezes the absence of a recorded reason.
        kind='published';
        result={registry:null,release:head,ordinal,createdAt:timestamp};
      } else if(method==='disableRoleProfile') {
        state='disabled';
        if(!p)db.prepare('INSERT INTO role_profiles VALUES(?,?,?,?,?,?,?,?,?,?,?,?)').run(profile.profileId,...boundary(ns),input.roleKey,state,null,null,nextRevision,ordinal,timestamp,timestamp);
        else db.prepare("UPDATE role_profiles SET state='disabled',revision=?,updated_at=? WHERE id=?").run(nextRevision,timestamp,p.id);
        kind='disabled';result={registry:null};
      } else {
        if(!p||!sameNamespace(input.release.profile.namespace,ns))fail('method_not_found');
        const target=releaseRow(input.release);if(!target)fail('method_not_found');
        if(target.revision!==input.expectedRevision)fail('revision_conflict');if(target.state!=='available')fail('method_version_unavailable');
        const charge=db.prepare('SELECT coalesce(sum(byte_count),0) n FROM role_profile_changes WHERE to_id=? OR from_id=?').get(target.id,target.id).n;
        db.prepare("UPDATE role_profile_releases SET state='deleted',revision=2,payload=NULL,byte_count=0 WHERE id=?").run(target.id);
        db.prepare('UPDATE role_profiles SET revision=?,updated_at=? WHERE id=?').run(nextRevision,timestamp,p.id);
        kind='deleted';result={registry:null,release:input.release,state:'deleted',revision:2,purgedBytes:target.byte_count+charge,eventCount:1};
      }
      result.registry=registry(ns,input.roleKey);
      const generation=db.prepare(`SELECT generation FROM role_profile_epochs WHERE ${where}`).get(...boundary(ns));
      if(generation)db.prepare(`UPDATE role_profile_epochs SET generation=generation+1 WHERE ${where}`).run(...boundary(ns));
      else db.prepare('INSERT INTO role_profile_epochs VALUES(?,?,?,1)').run(...boundary(ns));
      const eventOrdinal=db.prepare('SELECT coalesce(max(ordinal),0)+1 n FROM role_profile_events').get().n;
      db.prepare('INSERT INTO role_profile_events VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),...boundary(ns),profile.profileId,kind,nextRevision,input.actionId,eventOrdinal,timestamp);
      ledger.record(ns,input.actionId,method,binding,profile.profileId,result,timestamp);return result;
    });
  }
  return Object.freeze({db,identity,ready,methods,bind,registry,resolve,release,releaseRow,reason,mutate});
}
