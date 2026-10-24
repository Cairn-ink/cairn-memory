import { resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { readTransaction } from './database.mjs';
import { roleContextInput } from './role-context-input.mjs';
import { roleTaskMeteredText as wire, roleTaskByteCounts } from './role-context-wire.mjs';
import { roleAccess } from './role-profile-facade.mjs';
import { roleEvidence } from './role-context-evidence.mjs';
import { parseTaskReceipt, encodeTaskReceipt, canonicalJSON, authenticatedMAC } from './task-receipt.mjs';
import { contextOptions } from './context-read-input.mjs';
import { ASSEMBLY_FRAMING } from './context-read-assembly.mjs';
import { countTokens } from './model-budget.mjs';
import { deepFreeze, cardNamespace } from './private-card-input.mjs';
import { privateFailure } from './private-card-facade.mjs';
import { privateBoundary as boundary, privateWhere as where } from './private-operation-helpers.mjs';
import { includesNamespace, methodPackageRef, methodVersionRef } from './method-package-input.mjs';
import { fail } from './validation.mjs';

const same=(a,b)=>canonicalJSON(a)===canonicalJSON(b);
const packageOf=(r,readSet)=>methodPackageRef({type:'method-package',namespace:Number.isInteger(r[0])?readSet[r[0]]:r[0],packageId:r[1]});
const versionOf=(r,readSet)=>r[3]?methodVersionRef({type:'method-version',namespace:packageOf(r,readSet).namespace,packageId:r[1],versionId:r[3][0],manifestIdentity:r[3][1]}):null;
const releaseOf=(p,readSet,roleKey)=>({type:'role-profile-release',profile:{type:'role-profile',namespace:readSet[p[0]],profileId:p[1],roleKey},releaseId:p[2],contentIdentity:p[3]});

export function createRoleContextReader(storage,options,config) {
  const {db,identity,methods,bind}=storage;
  config={...config,path:config.path===':memory:'?config.path:resolve(config.path)};
  const counter=config.context?contextOptions(config.context).counter:null;
  const evidence=roleEvidence(storage,config);
  function generation(readSet) {
    return readSet.map(ns=>['role_profile_epochs','method_epochs','card_epochs','raw_exclusion_clocks'].map(table=>db.prepare(`SELECT generation FROM ${table} WHERE ${where}`).get(...boundary(ns))?.generation??0)
      .concat(db.prepare(`SELECT epoch FROM namespace_epochs WHERE ${where}`).get(...boundary(ns))?.epoch??0));
  }
  function cursor(payload) {const body=Buffer.from(canonicalJSON(payload)).toString('base64url');return body+'.'+bind('role-context-cursor-v1',body);}
  function offset(token,binding,gens) {
    if(token===undefined)return 0;
    const [body,mac,extra]=token.split('.');if(!body||extra!==undefined||!authenticatedMAC(bind('role-context-cursor-v1',body),mac))fail('invalid_cursor');
    let p;try{p=JSON.parse(Buffer.from(body,'base64url').toString('utf8'));}catch{fail('invalid_cursor');}
    if(!same(p.binding,binding)||!Number.isSafeInteger(p.after)||p.after<0)fail('invalid_cursor');if(!same(p.generations,gens))fail('cursor_stale');return p.after;
  }
  function releaseTuple(r,readSet) {return [readSet.findIndex(ns=>same(ns,r.ref.profile.namespace)),r.ref.profile.profileId,r.ref.releaseId,r.ref.contentIdentity,r.revision];}
  function methodTuple(found,readSet) {
    const {value,state}=found,index=readSet.findIndex(ns=>same(ns,value.package.namespace));
    const level=b=>b.namespace.scope==='project'?(b.roleKey==='*'?1:0):(b.roleKey==='*'?3:2);
    const target=state.version??state.consulted.at(-1)?.version??null,l=state.lifecycle;
    return [index<0?value.package.namespace:index,value.package.packageId,value.status,target?[target.versionId,target.manifestIdentity]:null,
      value.binding?level({namespace:value.binding.bindingNamespace,roleKey:value.binding.roleKey}):null,
      state.consulted.map(b=>[level(b),b.revision,b.state]),index<0?null:[l.packageRevision,l.packageState,l.versionRevision,l.versionState]];
  }
  function methodView(pkg,version,context,access) {
    const found=methods.stateFor(pkg,context,access),current=found.value;
    const selected=version===undefined?current.version:version;
    let manifest=null,adoptionStatus=null,status=current.status;
    if(selected&&includesNamespace(context.readSet,pkg.namespace)) {
      const target=methods.targetMetadata(pkg.namespace,selected);
      if(target.available) {
        adoptionStatus=methods.adoption(target,{version:selected,intent:'history',context},access,null);
        manifest={format:target.mixed?'mixed-v1':'text-v30',fileCount:target.files.length,
          textBytes:target.files.filter(f=>f.kind!=='binary').reduce((n,f)=>n+f.byte_count,0),binaryBytes:target.files.filter(f=>f.kind==='binary').reduce((n,f)=>n+f.byte_count,0)};
      }else {adoptionStatus='unavailable';status='unavailable';}
    } else if(selected) {adoptionStatus='unavailable';status='unavailable';}
    return {view:{package:pkg,status,version:selected,adoptionStatus,manifest},found};
  }
  function file(input,saved,context,access) {
    const entry=saved.methods.find(m=>same(packageOf(m,saved.readSet),input.package));if(!entry)fail('invalid_input');
    const version=versionOf(entry,saved.readSet);
    if(!version||!includesNamespace(input.readSet,version.namespace))return null;
    const target=methods.targetMetadata(version.namespace,version);if(!target.available)return null;
    methods.adoption(target,{version,intent:'history',context},access,null);
    const f=target.files.find(f=>f.path===input.path);if(!f)fail('method_not_found');
    if(f.kind==='binary') {
      if(!config.assets)fail('unsupported_media');
      methods.verifyBinaryMetadata(version.namespace,target,f);
      return {version,path:f.path,kind:'binary',mediaType:f.media_type,contentIdentity:f.content_identity,totalBytes:f.byte_count,totalUnits:null,parts:[],nextRange:null};
    }
    const row=db.prepare('SELECT text FROM method_files WHERE version_id=? AND path=?').get(version.versionId,input.path);
    const text=methods.verifyFile(version.namespace,{...f,text:row?.text}).text;
    let start=input.range?.start??0,end=input.range?.end??Math.min(4000,text.length);
    if(input.range===undefined&&end<text.length&&/[\uDC00-\uDFFF]/.test(text[end]))end--;
    if(end>text.length||start>text.length||start>0&&/[\uDC00-\uDFFF]/.test(text[start])||end<text.length&&/[\uDC00-\uDFFF]/.test(text[end]))fail('invalid_input');
    let nextEnd=Math.min(end+4000,text.length);if(nextEnd<text.length&&/[\uDC00-\uDFFF]/.test(text[nextEnd]))nextEnd--;
    return {version,path:f.path,kind:'text',mediaType:f.media_type,contentIdentity:f.content_identity,totalBytes:f.byte_count,totalUnits:text.length,
      parts:end>start?[{start,end,text:text.slice(start,end)}]:[],nextRange:end<text.length?{start:end,end:nextEnd}:null};
  }
  function deliverRelease(release,readSet) {
    if(!release?.fields)return release;
    const eligible=release.fields.related.every(ref=>includesNamespace(readSet,ref.namespace)&&methods.reasonAvailable(cardNamespace(ref.namespace),ref));
    // Keep CAS/lifecycle metadata available even when guidance is fenced.
    return eligible?release:{...release,fields:null,actorId:null,agentId:null,changeReason:null};
  }
  function prepare(input,saved,receiptId,access) {
    const roleKey=input.roleKey??saved.roleKey,context={readSet:input.readSet,roleId:roleKey};
    const gens=generation(input.readSet),resolved=storage.resolve(input.readSet,roleKey);
    const streamInput={...input};delete streamInput.cursor;
    if(input.history){streamInput.history={...input.history};delete streamInput.history.cursor;}
    const streamRequest=bind('role-context-stream-request-v1',streamInput);
    let profile=resolved.profile,history=null,historyPage=null,comparison=null,comparisonPage=null,projection=null;
    const issuing=['now','refresh'].includes(input.mode);
    if(!issuing&&saved) {
      const primary=saved.heads.at(-1)[4],prior=primary===null?null:releaseOf(saved.profiles[primary],saved.readSet,roleKey),selected=prior?storage.release(prior):null;
      const winner=resolved.registries.at(-1);
      const applicability=prior&&selected?.state!=='available'?'unavailable':winner.state==='disabled'?'withdrawn':!prior?(resolved.profile.applicability==='current'?'newer-release-available':resolved.profile.applicability):
        resolved.profile.applicability==='current'&&same(resolved.profile.release.ref,prior)?'current':resolved.profile.applicability==='current'?'newer-release-available':'unavailable';
      profile={applicability,release:selected};
    }
    const originalProfile=profile.release;
    profile={...profile,release:deliverRelease(originalProfile,input.readSet)};
    if(originalProfile?.fields&&!profile.release.fields)profile.applicability='unavailable';
    const profiles=[];
    if(profile.release)profiles.push(releaseTuple(profile.release,input.readSet));
    const heads=resolved.registries.map(r=>[input.readSet.findIndex(ns=>same(ns,r.namespace)),r.ref?.profileId??null,r.revision,r.state==='absent'?null:r.state,
      r.currentRelease?(()=>{let i=profiles.findIndex(p=>p[2]===r.currentRelease.releaseId);if(i<0){const release=storage.release(r.currentRelease);profiles.push(releaseTuple(release,input.readSet));i=profiles.length-1;}return i;})():null]);
    let list=issuing?(originalProfile?.fields?.methods??[]):saved?.methods.map(m=>packageOf(m,saved.readSet))??[];
    list=list.map(methodPackageRef);
    const selectedMethods=input.mode==='file'?list.filter(pkg=>same(pkg,input.package)):list;
    const methodResults=selectedMethods.map(pkg=>methodView(pkg,issuing?undefined:versionOf(saved.methods.find(m=>same(packageOf(m,saved.readSet),pkg)),saved.readSet),context,access));
    const methodTuples=methodResults.map(result=>methodTuple(result.found,input.readSet));
    if(input.history) {
      const p=input.history.profile;if(!includesNamespace(input.readSet,p.namespace)||p.roleKey!==roleKey)fail('scope_changed');
      const registry=storage.registry(p.namespace,p.roleKey);if(!same(registry.ref,p))fail('method_not_found');
      const binding={request:streamRequest,readSet:input.readSet,roleKey,profile:p,limit:input.history.limit??20},start=offset(input.history.cursor,binding,gens);
      const rows=db.prepare('SELECT id,content_identity FROM role_profile_releases WHERE profile_id=? ORDER BY ordinal DESC').all(p.profileId);
      if(start>rows.length)fail('invalid_cursor');
      const end=Math.min(start+(input.history.limit??20),rows.length);
      historyPage={binding,start,total:rows.length};
      history={profile:p,rows:rows.slice(start,end).map(r=>deliverRelease(storage.release({type:'role-profile-release',profile:p,releaseId:r.id,contentIdentity:r.content_identity}),input.readSet)),
        nextCursor:end<rows.length?cursor({binding,generations:gens,after:end}):null};
    }
    if(input.mode==='compare') {
      if(input.from.type==='role-profile-release') {
        const a=input.from,b=input.to;if(!same(a.profile,b.profile)||a.profile.roleKey!==roleKey||!includesNamespace(input.readSet,a.profile.namespace))fail('invalid_input');
        const left=deliverRelease(storage.release(a),input.readSet),right=deliverRelease(storage.release(b),input.readSet);
        const available=left?.state==='available'&&right?.state==='available'&&left.fields!==null&&right.fields!==null;
        const edge=available&&same(right.basedOn,a);if(available&&!edge)fail('invalid_input');
        comparison={kind:'profile',from:a,to:b,status:available?'available':'unavailable',changes:available?['duties','requiredOutputs','methods','related','appliesTo'].map(key=>({key,status:same(left.fields[key],right.fields[key])?'unchanged':'changed'})):[],items:[],reason:available?(edge&&right.changeReason?right.changeReason:{status:'not-recorded',text:null,refs:[]}):null,nextCursor:null};
      }else {
        if(!includesNamespace(input.readSet,input.from.namespace)||!same(input.from.namespace,input.to.namespace))fail('scope_changed');
        if(input.from.packageId!==input.to.packageId)fail('invalid_input');
        const left=methods.targetLifecycle(input.from.namespace,input.from),right=methods.targetLifecycle(input.to.namespace,input.to);
        if(left.available&&right.available&&(!right.row.based_on||!same(JSON.parse(right.row.based_on),input.from)))fail('invalid_input');
        const value=methods.readInside('compareMethodVersions',input.from.namespace,{from:input.from,to:input.to,roleProjection:true},access);
        comparison={kind:'method',from:input.from,to:input.to,status:value.status,changes:(value.changes??[]).map(c=>({key:c.path,status:c.status})),items:value.items??[],
          reason:value.status==='available'?{status:value.reason,text:null,refs:value.reasonRefs??[]}:null,nextCursor:value.nextCursor??null};
      }
      const binding={request:streamRequest,readSet:input.readSet,roleKey,from:input.from,to:input.to};
      const start=offset(input.cursor,binding,gens);
      const entries=[...comparison.changes.map(value=>({kind:'change',value})),...comparison.items.map(value=>({kind:'item',value})),
        ...(comparison.reason?.text?[{kind:'text',value:comparison.reason.text}]:[]),...(comparison.reason?.refs??[]).map(value=>({kind:'ref',value}))];
      if(start>entries.length)fail('invalid_cursor');
      comparisonPage={binding,start,total:entries.length,entries:entries.slice(start)};
      profile={...profile,release:null};list=[];
    }
    if(input.mode==='file')projection=file(input,saved,context,access);
    const metered={framing:ASSEMBLY_FRAMING,mode:input.mode,registries:resolved.registries,profile:input.mode==='file'?{...profile,release:null}:profile,
      methods:input.mode==='compare'?[]:methodResults.map(r=>r.view),evidence:[],history,comparison,file:projection,receipt:null};
    const payload={id:receiptId,readSet:input.readSet,roleKey,profiles,heads,methods:methodTuples,evidence:[]};
    return {metered,payload,historyPage,comparisonPage,observation:{generations:gens,states:methodResults.map(r=>r.found.state)}};
  }
  return function readRoleTaskContext(original,token) {
    try {
      storage.ready();const started=performance.now(),{payload,input}=roleContextInput(original),deadlineAt=started+input.deadlineMs;
      const saved=input.receipt===undefined?null:parseTaskReceipt(identity,input.receipt);
      if(saved&&!same(saved.readSet,input.readSet))fail('scope_changed');
      const request=deepFreeze({method:'readRoleTaskContext',namespace:input.readSet[0],actionClass:'read',actionId:null,targetId:null,expectedRevision:null,
        payloadBinding:bind('role-context-action-v1',payload),input:payload});
      const access=roleAccess(options.authority,request,token,input.readSet);access.check();
      if(!counter)fail('invalid_input');
      const receiptId=saved&&input.mode!=='refresh'?saved.id:randomUUID();
      let candidates=null,refs=[],searchGenerations;
      if(input.task&&performance.now()<deadlineAt) {searchGenerations=readTransaction(db,()=>generation(input.readSet));const found=evidence.search(input,access,deadlineAt);candidates=found.diagnostics;refs=found.refs;}
      if(input.mode==='then')refs=saved.evidence.map((e,i)=>({ref:{namespace:input.readSet[e[0][0]],type:e[0][1]===0?'memory':'card',[e[0][1]===0?'memoryId':'cardId']:e[0][2],revision:e[0][3],...(e[0][1]===1?{bodyRevision:e[0][4]}:{})},rank:i+1,saved:e}));
      const prepared=readTransaction(db,()=>{
        const base=prepare(input,saved,receiptId,access.access),items=[];let unavailable=0;
        for(const candidate of refs)try{const item=evidence.item(candidate.ref,input.readSet,candidate.rank,input.mode==='then'?'history':'current');if(candidate.saved){if(item.fence!==candidate.saved[1]){unavailable++;continue;}item.sources=item.sources.filter(source=>candidate.saved[2].some(s=>s[0]===source.index&&s[1]===source.ref.receiptId&&s[2]===source.ref.contentIdentity));}items.push(item);}catch(error){if(!['evidence_unavailable','revision_conflict','source_unavailable','source_excluded'].includes(error.code))throw error;unavailable++;}
        return {...base,items,unavailable};
      });
      if(searchGenerations&&!same(searchGenerations,prepared.observation.generations))fail('snapshot_stale');
      if(prepared.metered.file?.kind==='binary')access.authorize(methodPackageRef(input.package).namespace,true,config.assets.authority);
      const issuing=['now','refresh'].includes(input.mode),selected=[],historyRows=[],comparisonUnits=[],allHistory=prepared.metered.history?.rows??[];
      let calls=0,oversized=0,budgetStop=false;const tokenCounts=new Map();
      function build(items,rows,units=comparisonUnits) {
        const metered=structuredClone(prepared.metered);if(metered.history){metered.history.rows=rows;const page=prepared.historyPage;metered.history.nextCursor=page.start+rows.length<page.total?cursor({binding:page.binding,generations:prepared.observation.generations,after:page.start+rows.length}):null;}
        if(metered.comparison) {
          const c=metered.comparison,page=prepared.comparisonPage;
          c.changes=units.filter(u=>u.kind==='change').map(u=>u.value);c.items=units.filter(u=>u.kind==='item').map(u=>u.value);
          if(c.reason){c.reason.text=units.find(u=>u.kind==='text')?.value??null;c.reason.refs=units.filter(u=>u.kind==='ref').map(u=>u.value);}
          c.nextCursor=page.start+units.length<page.total?cursor({binding:page.binding,generations:prepared.observation.generations,after:page.start+units.length}):null;
        }
        metered.evidence=evidence.project(items);
        const p=structuredClone(prepared.payload);
        for(const release of rows)if(!p.profiles.some(r=>r[2]===release.ref.releaseId))p.profiles.push(releaseTuple(release,input.readSet));
        p.evidence=items.map((item,i)=>{
          const ref=item.ref,sources=metered.evidence[i].sources;
          return [[item.ns,item.type==='memory'?0:1,ref.memoryId??ref.cardId,ref.revision,...(item.type==='card'?[ref.bodyRevision]:[])],item.fence,sources.map(source=>{
            const full=item.sources.find(s=>s.index===source.index).ref;
            return [source.index,full.receiptId,full.contentIdentity,source.sameAsBody?'body':source.sameAs?[source.sameAs.item,source.sameAs.source]:null];
          })];
        });
        metered.receipt=issuing?encodeTaskReceipt(identity,p,true):saved?input.receipt:null;
        return metered;
      }
      const count=metered=>{calls++;return countTokens(counter,wire(metered));};
      function diagnostics(metered,items,used) {
        return {version:'context-read-v1',representation:'representation-v2',policy:{id:'rank-first-whole-v1'},counter:{id:counter?.id},
          items:evidence.details(items,tokenCounts),budget:{...input.budget,used},candidates,
          omitted:{items:prepared.items.length-items.length,bodies:prepared.items.length-items.length,
            sources:prepared.items.reduce((n,i)=>n+i.canonicalSourceCount,0)-items.reduce((n,i)=>n+i.sources.length,0),unavailable:prepared.unavailable,oversized},
          dedup:{sources:metered.evidence.reduce((n,i)=>n+i.sources.filter(s=>s.sameAs).length,0),body:metered.evidence.reduce((n,i)=>n+i.sources.filter(s=>s.sameAsBody).length,0)},
          stops:{budget:budgetStop,items:items.length>=input.budget.maxItems,deadline:performance.now()>=deadlineAt},trace:{timings:{assemblyMs:performance.now()-started},counterCalls:calls}};
      }
      const bounds=(metered,tokens,items=selected)=>roleTaskByteCounts(metered,diagnostics(metered,items,tokens));
      const fits=(metered,tokens,items=selected)=>{const b=bounds(metered,tokens,items);return tokens<=input.budget.maxTokens&&b.receipt<=32768&&b.core<=65536&&b.transport<=262144;};
      let metered=build(selected,historyRows),used=count(metered);access.check();
      if(!fits(metered,used))return {ok:false,error:{code:'budget_insufficient',retryable:false,details:{partial:true,maxTokens:input.budget.maxTokens,requiredTokens:used,requiredBytes:bounds(metered,used)}}};
      function visit(items,rows,text,minItems=[],minRows=[],minUnits=[]) {
        if(performance.now()>=deadlineAt)return false;
        calls++;tokenCounts.set(text,countTokens(counter,text));access.check();
        if(performance.now()>=deadlineAt)return false;
        const trial=build(items,rows),tokens=count(trial);access.check();
        if(performance.now()>=deadlineAt)return false;
        if(fits(trial,tokens,items)){metered=trial;used=tokens;return true;}budgetStop=true;
        const minimum=build(minItems,minRows,minUnits),minimumTokens=count(minimum);access.check();if(!fits(minimum,minimumTokens,minItems))oversized++;return false;
      }
      for(const release of allHistory) {
        if(visit(selected,[...historyRows,release],canonicalJSON(release),[],[release]))historyRows.push(release);else break;
      }
      for(const unit of prepared.comparisonPage?.entries??[]) {
        comparisonUnits.push(unit);
        if(!visit(selected,historyRows,canonicalJSON(unit.value),[],[],[unit])){comparisonUnits.pop();break;}
      }
      for(const item of prepared.items) {
        if(selected.length>=input.budget.maxItems)break;
        const body={...item,sources:[]};
        if(!visit([...selected,body],historyRows,item.text,[body]))continue;
        selected.push(body);
        for(const source of item.sources) {const next={...body,sources:[...body.sources,source]};if(visit([...selected.slice(0,-1),next],historyRows,source.excerpt,[{...body,sources:[source]}])){body.sources.push(source);}}
      }
      used=count(metered);access.check();
      if(!fits(metered,used))fail('context_item_too_large');
      // All serialization, counters, attribution and host callbacks finish here.
      const finalDiagnostics=diagnostics(metered,selected,used);
      const result=deepFreeze({ok:true,value:{metered,diagnostics:finalDiagnostics}});
      const finalBytes=roleTaskByteCounts(metered,finalDiagnostics);
      if(finalBytes.core>65536 || finalBytes.transport>262144)fail('context_item_too_large');
      return readTransaction(db,()=>{
        let final;
        try{final=prepare(input,saved,receiptId,access.access);}catch(error){if(['method_not_found','method_version_unavailable','evidence_unavailable','revision_conflict','cursor_stale'].includes(error.code))fail('snapshot_stale');throw error;}
        if(!same(final.metered,prepared.metered)||!same(final.payload,prepared.payload)||!same(final.observation,prepared.observation))fail('snapshot_stale');
        for(const item of selected){let current;try{current=evidence.item(item.ref,input.readSet,item.rank,input.mode==='then'?'history':'current');}catch(error){if(['evidence_unavailable','revision_conflict','source_unavailable','source_excluded'].includes(error.code))fail('snapshot_stale');throw error;}if(current.fence!==item.fence)fail('snapshot_stale');}
        return result;
      });
    }catch(error){return privateFailure(error);}
  };
}
