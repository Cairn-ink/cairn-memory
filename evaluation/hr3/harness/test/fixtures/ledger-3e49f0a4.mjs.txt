import { mkdirSync, readFileSync, openSync, closeSync, writeSync, fsyncSync, rmdirSync, existsSync, statSync } from 'node:fs';
import { dirname } from 'node:path';
import { canonical, hash, fail, atomicJSON } from './common.mjs';
import {loadCarryForward,verifyCarrySnapshot} from './accounting.mjs';
import { validateRequest } from './requests.mjs';
export const CAPS={smoke:50,pilot:50,development:46,test:345,alternative:45,embeddings:2.56};
const NANO=1e9;
export function journalCheckpoint(events,bytes) {
  return {version:'hr3-ledger-head-v1',records:events.length,bytes,head:events.at(-1)?.digest,configurationSHA256:hash(events[0]?.configuration??null)};
}
export function verifyJournalCheckpoint(events,bytes,checkpoint) {
  if(checkpoint?.blockedReason)fail(checkpoint.blockedReason);
  if(canonical(checkpoint)!==canonical(journalCheckpoint(events,bytes)))fail('ledger_head_mismatch');
}
// A durable append-only journal, serialized by an exclusive directory lock.
// Stale locks and partial records fail closed; the operator must reconcile them.
export class Ledger {
  constructor(path,{stage='pilot',plan,limits={},carryForward=null}={}) {
    this.path=path;this.lock=path+'.lock';this.headPath=path+'.head.json';this.stage=stage==='smoke'?'pilot':stage;
    if(!CAPS[stage]||!Array.isArray(plan)||!plan.length||plan.some(p=>!['extraction','reader','research-embedding','product-embedding'].includes(p.operation)||!Number.isSafeInteger(p.maxDispatches)||p.maxDispatches<1||typeof p.ids!=='string'||!p.ids.startsWith('^')||!p.ids.endsWith('$')))fail('invalid_plan');
    if(limits.operational>450||limits.authorization>500)fail('cap_increase');
    const stageLimits={...CAPS,...limits.stages};
    if(limits.embeddingUnits&&['research','product'].some(k=>!Number.isSafeInteger(limits.embeddingUnits[k])||limits.embeddingUnits[k]<0||limits.embeddingUnits[k]>64000000))fail('embedding_allowance_increase');
    if(['operational','authorization'].some(k=>limits[k]!==undefined&&(!Number.isFinite(limits[k])||limits[k]<0)))fail('invalid_cap');
    for(const k of Object.keys(stageLimits))if(!(stageLimits[k]>=0&&stageLimits[k]<=CAPS[k]))fail('cap_increase');
    this.configuration={version:'hr3-ledger-a4-v2',plan,limits:{stages:Object.fromEntries(Object.entries(stageLimits).map(([s,v])=>[s,Math.round(v*NANO)])),operational:Math.round(Math.min(limits.operational??450,450)*NANO),authorization:Math.round(Math.min(limits.authorization??500,500)*NANO),embeddingUnits:limits.embeddingUnits??{research:64000000,product:64000000}},...(carryForward?{carryForward:loadCarryForward(carryForward)}:{})};
    this.configurationSHA256=hash(this.configuration);
    const carried=verifyCarrySnapshot(this.configuration.carryForward);
    if(carried.total>this.configuration.limits.operational||carried.total>this.configuration.limits.authorization-50*NANO||Object.entries(carried.byStage).some(([s,n])=>n>(this.configuration.limits.stages[s]??0))||['research','product'].some(k=>carried.embedding[k]>this.configuration.limits.embeddingUnits[k]))fail('carried_exposure_exceeds_cap');
    mkdirSync(dirname(path),{recursive:true,mode:0o700});
    this.initializing=true;
    try{this.transaction(events=>{if(!events.length)this.append(events,{type:'configuration',configuration:this.configuration});});}
    finally{this.initializing=false;}
  }
  reject(reason) {
    this.hardStop=reason;
    // Preserve the last trusted position separately from damaged journal bytes.
    // Failure to persist this stop still throws; it never permits dispatch.
    if(this.acceptedHead)atomicJSON(this.headPath,{...this.acceptedHead,blockedReason:reason});
    fail(reason);
  }
  read() {
    if(this.hardStop)fail(this.hardStop);
    if(hash(this.configuration)!==this.configurationSHA256)return this.reject('ledger_configuration_mismatch');
    let head;
    if(existsSync(this.headPath)){
      try{head=JSON.parse(readFileSync(this.headPath));}catch{return this.reject('ledger_head_corrupt');}
      if(head.blockedReason)fail(head.blockedReason);
      if(head.version!=='hr3-ledger-head-v1'||!Number.isSafeInteger(head.records)||head.records<1||!Number.isSafeInteger(head.bytes)||head.bytes<1||typeof head.head!=='string'||typeof head.configurationSHA256!=='string')return this.reject('ledger_head_corrupt');
    }
    if(!existsSync(this.path)){
      if(this.initializing&&!head&&!this.acceptedHead)return [];
      this.acceptedHead??=head;return this.reject('ledger_journal_missing');
    }
    const stat=statSync(this.path,{bigint:true}),stamp=[stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');
    if(!stat.size){this.acceptedHead??=head;return this.reject('ledger_journal_empty');}
    let events;
    if(this.cachedStamp===stamp)events=this.cachedEvents;
    else {
      const raw=readFileSync(this.path,'utf8');if(!raw.endsWith('\n'))return this.reject('ledger_incomplete');
      try{events=raw.trimEnd().split('\n').map(JSON.parse);}catch{return this.reject('ledger_corrupt');}
      let prior='';for(const e of events){const {digest,...data}=e;if(data.prior!==prior||hash(data)!==digest)return this.reject('ledger_corrupt');prior=digest;}
    }
    if(events[0]?.type!=='configuration'||!events[0].configuration||events.filter(e=>e.type==='configuration').length!==1)return this.reject('ledger_configuration_missing');
    if(head&&hash(events[0].configuration)!==head.configurationSHA256){this.acceptedHead??=head;return this.reject('ledger_configuration_mismatch');}
    if(hash(events[0].configuration)!==this.configurationSHA256)return this.reject('ledger_configuration_mismatch');
    if(!head)return this.reject('ledger_head_missing');
    if(this.acceptedHead&&(head.records<this.acceptedHead.records||head.bytes<this.acceptedHead.bytes||events[this.acceptedHead.records-1]?.digest!==this.acceptedHead.head))return this.reject('ledger_history_rollback');
    this.acceptedHead??=head;
    try{verifyJournalCheckpoint(events,Number(stat.size),head);}catch{return this.reject('ledger_head_mismatch');}
    this.acceptedHead=head;this.cachedStamp=stamp;this.cachedEvents=events;return events;
  }
  transaction(fn) {
    try {mkdirSync(this.lock,{mode:0o700});}catch {fail('ledger_locked');}
    try{return fn(this.read());}finally{rmdirSync(this.lock);}
  }
  append(events,event) {
    const data={...event,prior:events.at(-1)?.digest??''}, record={...data,digest:hash(data)};
    const fd=openSync(this.path,'a',0o600);try {const data=Buffer.from(canonical(record)+'\n');let offset=0;while(offset<data.length)offset+=writeSync(fd,data,offset,data.length-offset);fsyncSync(fd);}finally{closeSync(fd);}
    const parent=openSync(dirname(this.path),'r');try{fsyncSync(parent);}finally{closeSync(parent);}
    events.push(record);const stat=statSync(this.path,{bigint:true});
    const head=journalCheckpoint(events,Number(stat.size));
    // Journal fsync precedes checkpoint replacement and directory fsync. A crash
    // between them is a hard mismatch requiring reconciliation, never a replay.
    atomicJSON(this.headPath,head);this.acceptedHead=head;
    this.cachedStamp=[stat.ino,stat.size,stat.mtimeNs,stat.ctimeNs].join(':');this.cachedEvents=events;return record;
  }
  snapshot(events=this.read()) {
    const seed=verifyCarrySnapshot(events[0]?.configuration?.carryForward);
    const charges=new Map(),settled=new Set(),embedding={...seed.embedding},byStage={...seed.byStage},reservedById=new Map();let stopped=null,failures=seed.failures;
    for(const e of events) {
      if(e.type==='reserve'){reservedById.set(e.id,e);charges.set(e.id,e.reserved);byStage[e.stage]=(byStage[e.stage]??0)+e.reserved;if(e.operation.endsWith('embedding'))embedding[e.operation.startsWith('product')?'product':'research']+=e.bound.input;}
      if(e.type==='settle'){const r=reservedById.get(e.id);byStage[r.stage]-=r.reserved-e.charged;charges.set(e.id,e.charged);settled.add(e.id);}
      if(e.type==='failure')failures++;
      if(e.type==='stop')stopped=e.reason;
    }
    return {total:seed.total+[...charges.values()].reduce((a,b)=>a+b,0),reservations:seed.reservations+charges.size,unsettled:[...seed.unsettled,...[...charges.keys()].filter(id=>!settled.has(id))],embedding,byStage,failures,stopped};
  }
  stop(reason) {return this.transaction(events=>{if(!this.snapshot(events).stopped)this.append(events,{type:'stop',reason});});}
  reserve(request) {
    const bound=validateRequest(request),reserved=bound.input*bound.inputRate+bound.output*bound.outputRate;
    return this.transaction(events=>{
      const state=this.snapshot(events);if(state.stopped)fail('stopped:'+state.stopped);
      if(events.some(e=>e.type==='reserve'&&e.id===request.id))fail('request_already_reserved');
      const route=this.configuration.plan.find(p=>p.operation===request.operation&&(!p.stage||p.stage===this.stage)&&new RegExp(p.ids).test(request.id));
      if(!route||events.filter(e=>e.type==='reserve'&&e.operation===request.operation&&new RegExp(route.ids).test(e.id)&&(!route.stage||e.stage===route.stage)).length>=route.maxDispatches)fail('unlisted_call');
      const cap=Math.min(this.configuration.limits.operational,this.configuration.limits.authorization-50*NANO);
      const kind=request.operation.startsWith('product')?'product':'research';
      if(state.total+reserved>cap||(state.byStage[this.stage]??0)+reserved>this.configuration.limits.stages[this.stage]||request.operation.endsWith('embedding')&&state.embedding[kind]+bound.input>this.configuration.limits.embeddingUnits[kind]) {
        this.append(events,{type:'stop',reason:'cap_exceeded'});fail('cap_exceeded');
      }
      return this.append(events,{type:'reserve',id:request.id,logicalId:request.logicalId??request.id,operation:request.operation,stage:this.stage,bodyHash:hash(request.body),bound,reserved});
    });
  }
  settle(id,response) {
    return this.transaction(events=>{
      const r=events.find(e=>e.type==='reserve'&&e.id===id);if(!r||events.some(e=>e.type==='settle'&&e.id===id))fail('invalid_settlement');
      const usage=response.usage;
      if(!response.requestId||verifyCarrySnapshot(events[0]?.configuration?.carryForward).requestIds.includes(response.requestId)||events.some(e=>e.type==='settle'&&e.requestId===response.requestId)||!usage||![usage.inputTokens,usage.outputTokens].every(Number.isSafeInteger)||usage.inputTokens<0||usage.outputTokens<0||usage.inputTokens>r.bound.input||usage.outputTokens>r.bound.output) {
        this.append(events,{type:'stop',reason:'unexplained_usage'});fail('unexplained_usage');
      }
      return this.append(events,{type:'settle',id,requestId:response.requestId,usage,charged:usage.inputTokens*r.bound.inputRate+usage.outputTokens*r.bound.outputRate});
    });
  }
  failure(id) {return this.transaction(events=>{this.append(events,{type:'failure',id});if(this.snapshot(events).failures>=3){this.append(events,{type:'stop',reason:'three_transport_failures'});fail('three_transport_failures');}});}
}
