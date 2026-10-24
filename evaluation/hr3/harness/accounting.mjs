import {readFileSync} from 'node:fs';
import {resolve,isAbsolute} from 'node:path';
import {fileURLToPath} from 'node:url';
import {hash,canonical,fail} from './common.mjs';

const repo=fileURLToPath(new URL('../../../',import.meta.url));
const stages=['pilot','development','test','alternative'];
const check=(ok,reason)=>{if(!ok)fail('carry_forward:'+reason);};
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const sum=values=>values.reduce((a,b)=>{check(integer(a+b),'amount_overflow');return a+b;},0);
export const FIRST_PILOT_LEDGER_SHA256='785bd208619a9448f7e4d56c1aeb81bd775b487d4d3cb70af6a2e2244451a750';
export function emptyExposure() {
  return {settled:0,outstanding:0,total:0,unsettled:[],embedding:{research:0,product:0},byStage:{},reservations:0,requestIds:[],sourceHashes:[],failures:0};
}

// A carried snapshot is included in the hash-linked configuration record. Its
// sources are re-read and verified when opening a writer; reports can verify
// the immutable recorded snapshot without requiring private source locations.
export function verifyCarrySnapshot(snapshot) {
  if(!snapshot)return emptyExposure();
  const {digest,...data}=snapshot;
  check(hash(data)===digest,'snapshot_hash');
  const e=data.exposure;
  check(e&&['settled','outstanding','total','reservations','failures'].every(k=>integer(e[k])),'snapshot_amounts');
  check(e.total===e.settled+e.outstanding&&sum(Object.values(e.byStage))===e.total,'snapshot_totals');
  check(['research','product'].every(k=>integer(e.embedding[k])),'snapshot_embedding');
  check(Array.isArray(e.unsettled)&&new Set(e.unsettled).size===e.unsettled.length,'snapshot_reservations');
  check(Array.isArray(e.requestIds)&&new Set(e.requestIds).size===e.requestIds.length,'snapshot_provider_ids');
  check(Array.isArray(e.sourceHashes)&&new Set(e.sourceHashes).size===e.sourceHashes.length,'snapshot_sources');
  return structuredClone(e);
}

export function auditLedger(raw) {
  check(raw.length>0&&raw.endsWith('\n'),'incomplete_ledger');
  let events;try{events=raw.trimEnd().split('\n').map(JSON.parse);}catch{fail('carry_forward:unparseable_ledger');}
  check(events[0]?.type==='configuration','configuration_required');
  const seed=verifyCarrySnapshot(events[0].configuration?.carryForward);
  const exposure=structuredClone(seed),reservations=new Map(),settlements=new Set(),providerIds=new Set(seed.requestIds);
  let prior='',stopped=null;
  for(const [index,event] of events.entries()) {
    const {digest,...data}=event;check(data.prior===prior&&hash(data)===digest,'ledger_hash_chain');prior=digest;
    if(event.type==='configuration'){check(index===0,'repeated_configuration');continue;}
    if(event.type==='reserve') {
      const b=event.bound;
      check(typeof event.id==='string'&&!reservations.has(event.id)&&stages.includes(event.stage),'reservation_identity');
      check(b&&['input','output','inputRate','outputRate'].every(k=>integer(b[k]))&&integer(event.reserved),'reservation_amount');
      const embedding=['research-embedding','product-embedding'].includes(event.operation);
      check(embedding||['reader','extraction'].includes(event.operation),'reservation_operation');
      check(embedding?b.inputRate===20&&b.outputRate===0&&b.output===0:
        b.inputRate===400&&b.outputRate===1600||event.operation==='extraction'&&b.inputRate===750&&b.outputRate===4500,'reservation_rates');
      check(event.reserved===b.input*b.inputRate+b.output*b.outputRate,'reservation_arithmetic');
      reservations.set(event.id,event);exposure.reservations++;
      exposure.byStage[event.stage]=sum([exposure.byStage[event.stage]??0,event.reserved]);
      if(embedding){const channel=event.operation.startsWith('product')?'product':'research';exposure.embedding[channel]=sum([exposure.embedding[channel],b.input]);}
    } else if(event.type==='settle') {
      const r=reservations.get(event.id),u=event.usage;
      check(r&&!settlements.has(event.id)&&typeof event.requestId==='string'&&event.requestId&&!providerIds.has(event.requestId),'settlement_identity');
      check(u&&integer(u.inputTokens)&&integer(u.outputTokens)&&u.inputTokens<=r.bound.input&&u.outputTokens<=r.bound.output,'settlement_usage');
      check(integer(event.charged)&&event.charged===u.inputTokens*r.bound.inputRate+u.outputTokens*r.bound.outputRate&&event.charged<=r.reserved,'settlement_arithmetic');
      settlements.add(event.id);providerIds.add(event.requestId);
      exposure.settled=sum([exposure.settled,event.charged]);exposure.byStage[r.stage]-=r.reserved-event.charged;
    } else if(event.type==='failure') {check(reservations.has(event.id),'failure_identity');exposure.failures++;}
    else if(event.type==='stop') {check(typeof event.reason==='string','stop_reason');stopped=event.reason;}
    else fail('carry_forward:unknown_event');
  }
  for(const [id,r] of reservations)if(!settlements.has(id)){exposure.outstanding=sum([exposure.outstanding,r.reserved]);exposure.unsettled.push(id);}
  exposure.total=sum([exposure.settled,exposure.outstanding]);exposure.requestIds=[...providerIds];
  check(sum(Object.values(exposure.byStage))===exposure.total,'ledger_stage_totals');
  return {events,exposure,stopped};
}

function relativePath(path) {
  check(typeof path==='string'&&path&&!isAbsolute(path)&&!path.split(/[\\/]/).some(p=>p==='..'||p===''),'repo_relative_source_required');
  return resolve(repo,path);
}
function verifiedBytes(spec) {
  check(spec&&/^[0-9a-f]{64}$/.test(spec.sha256),'source_digest_required');
  const bytes=readFileSync(relativePath(spec.path));check(hash(bytes)===spec.sha256,'source_hash_mismatch');return bytes;
}

export function loadCarryForward(path,active=new Set()) {
  const manifestBytes=readFileSync(path),manifestHash=hash(manifestBytes);
  check(!active.has(manifestHash),'source_cycle');active=new Set([...active,manifestHash]);
  const input=JSON.parse(manifestBytes);
  check(input.version==='hr3-carry-forward-v1'&&Array.isArray(input.ledgers)&&Array.isArray(input.preparation?.receipts)&&typeof input.preparation.complete==='boolean','manifest_shape');
  check(Object.keys(input).every(k=>['version','ledgers','preparation'].includes(k)),'manifest_extra_fields');
  const exposure=emptyExposure(),used=new Set(),sources=[];
  function merge(e,sha) {
    const hashes=[sha,...e.sourceHashes];check(new Set(hashes).size===hashes.length&&hashes.every(h=>!used.has(h)),'duplicate_or_overlapping_sources');
    for(const h of hashes)used.add(h);
    check(e.requestIds.every(id=>!exposure.requestIds.includes(id)),'duplicate_provider_charge');
    for(const k of ['settled','outstanding','reservations','failures'])exposure[k]=sum([exposure[k],e[k]]);
    exposure.unsettled.push(...e.unsettled.map(id=>sha+':'+id));exposure.requestIds.push(...e.requestIds);
    for(const k of ['research','product'])exposure.embedding[k]=sum([exposure.embedding[k],e.embedding[k]]);
    for(const [stage,value] of Object.entries(e.byStage))exposure.byStage[stage]=sum([exposure.byStage[stage]??0,value]);
  }
  for(const spec of input.ledgers) {
    const raw=verifiedBytes(spec),record=auditLedger(raw.toString());
    const carried=record.events[0].configuration.carryForward;
    if(carried){
      const rebuilt=loadCarryForward(relativePath(carried.manifestPath),active);
      check(canonical(rebuilt)===canonical(carried),'inherited_snapshot_mismatch');
    }
    merge(record.exposure,spec.sha256);sources.push({...spec,kind:'ledger'});
  }
  for(const spec of input.preparation.receipts) {
    const receipt=JSON.parse(verifiedBytes(spec));
    check(receipt.version==='hr3-preparation-charge-v1'&&typeof receipt.charge_id==='string'&&receipt.charge_id&&stages.includes(receipt.stage),'preparation_shape');
    check(integer(receipt.settledNanodollars)&&integer(receipt.outstandingNanodollars)&&receipt.embeddingUnits&&['research','product'].every(k=>integer(receipt.embeddingUnits[k])),'preparation_amounts');
    const e=emptyExposure();e.settled=receipt.settledNanodollars;e.outstanding=receipt.outstandingNanodollars;e.total=sum([e.settled,e.outstanding]);
    e.embedding=receipt.embeddingUnits;e.byStage={[receipt.stage]:e.total};e.requestIds=[receipt.charge_id];
    if(e.outstanding)e.unsettled=[receipt.charge_id];merge(e,spec.sha256);sources.push({...spec,kind:'preparation'});
  }
  exposure.total=sum([exposure.settled,exposure.outstanding]);exposure.sourceHashes=[...used].sort();
  // Keep only a repository-relative manifest locator in durable artifacts.
  const absolute=path instanceof URL?fileURLToPath(path):resolve(path);check(absolute.startsWith(resolve(repo)+'/'),'manifest_must_be_in_repository');
  const relative=absolute.slice(resolve(repo).length+1);
  const data={version:'hr3-carry-forward-snapshot-v1',manifestPath:relative,manifestSHA256:manifestHash,sources,preparationComplete:input.preparation.complete,exposure};
  return {...data,digest:hash(data)};
}
