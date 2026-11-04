import { sqliteFileStat } from './sqlite-journal-probe.mjs';
import { resolve, dirname, basename } from 'node:path';
import { PRODUCT_SIDECAR_SUFFIX } from './context-product-admission.mjs';
import { fail } from './validation.mjs';

// Admission knowledge is process memory only. Never evict a held/quarantined
// domain to admit another one. The cap bounds both keys and numeric cells.
const key=Symbol.for('context-read-product/admission-domains');
const domains=()=>globalThis[key]??={locations:new Map(),physical:new Map(),capacityCount:0};
const file=(path,stat)=>{try {const s=stat(path),id=[s.dev,s.ino,s.birthtimeNs].join(':');return {id,stamp:[id,s.size].join(':')};}catch(e){if(e.code==='ENOENT')return null;fail('reader_failed');}};
export function maintenanceAdmissionIdentity(options,stat=sqliteFileStat) {
  const path=resolve(options.path)+PRODUCT_SIDECAR_SUFFIX,cache=file(path,stat),directory=file(dirname(path)+'/.',stat);
  // Row updates alone do not recharge an integrity-cost allowance: only
  // physical replacement or a changed file length creates a cache epoch.
  // Birth identity distinguishes inode reuse after removal; ordinary writes
  // never change it. The directory/name remains stable while a missing cache
  // is first created. The inode alias joins different paths to the same sidecar.
  return {key:directory?JSON.stringify([directory.id,basename(path)]):path,physical:cache?.id,cache:cache?.stamp??'missing'};
}
function bindIdentity(identity,state) {
  const {locations,physical}=domains();
  if(!locations.has(identity.key)&&locations.size>=1024)fail('read_in_progress');
  locations.set(identity.key,state);
  if(identity.physical!==undefined){
    if(state.physical!==identity.physical&&physical.get(state.physical)===state)physical.delete(state.physical);
    physical.set(identity.physical,state);state.physical=identity.physical;
  }
}
function capacity(domain,maxMs) {
  if(domain.capacities.has(maxMs))return domain.capacities.get(maxMs);
  const all=domains();if(all.capacityCount>=1024)fail('read_in_progress');
  const state={domain,maxMs,profile:{attempts:0,until:0,held:false}};
  // Quota-independent physical ownership is shared across capacities. Retry
  // counters are separate: another owner's Q cannot recharge a known-bad Q.
  for(const name of ['attempts','until','held'])Object.defineProperty(state,name,{get(){return state.profile[name];},set(value){state.profile[name]=value;}});
  for(const name of ['busy','pending','quarantined'])Object.defineProperty(state,name,{get(){return state.domain[name];},set(value){state.domain[name]=value;}});
  domain.capacities.set(maxMs,state);all.capacityCount++;return state;
}
function mergeDomain(target,source) {
  const all=domains();
  target.busy ||= source.busy;target.pending ||= source.pending;target.quarantined ||= source.quarantined;
  target.maxAttempts=Math.max(target.maxAttempts,source.maxAttempts);
  for(const [q,state] of source.capacities){
    state.domain=target;const existing=target.capacities.get(q);
    if(existing){existing.attempts=Math.max(existing.attempts,state.attempts);existing.until=Math.max(existing.until,state.until);existing.held ||= state.held;state.profile=existing.profile;all.capacityCount--;}
    else target.capacities.set(q,state);
  }
  source.capacities.clear();
  for(const map of [all.locations,all.physical])for(const [key,value] of map)if(value===source)map.set(key,target);
}
export function maintenanceAdmissionDomain(identity,maxMs) {
  const {locations,physical}=domains(),epoch=identity.cache;
  let domain=physical.get(identity.physical)??locations.get(identity.key);
  if(!domain)domain={epoch,capacities:new Map(),maxAttempts:0,quarantined:false,pending:false,busy:false};
  bindIdentity(identity,domain);
  // A failed proof cannot be cleared by capacity or cache changes. A pending
  // attempt also survives the creation of its first cache file.
  if(domain.epoch!==epoch&&!domain.quarantined&&!domain.pending&&!domain.busy){
    domain.epoch=epoch;domain.maxAttempts=0;
    for(const state of domain.capacities.values())Object.assign(state.profile,{attempts:0,until:0,held:false});
  }
  return capacity(domain,maxMs);
}
export function retainMaintenanceAdmission(identity,maxMs,state) {
  if(state.maxMs!==maxMs)fail('reader_failed');
  const domain=state.domain,existing=domains().physical.get(identity.physical);
  if(existing&&existing!==domain)mergeDomain(domain,existing);
  // The failed attempt's own creation/repair is not a new capacity epoch.
  bindIdentity(identity,domain);domain.epoch=identity.cache;
}
export function failMaintenanceAdmission(state,now,confirmed) {
  state.pending=false;state.busy=false;state.attempts=Math.min(3,state.attempts+1);
  state.domain.maxAttempts=Math.max(state.domain.maxAttempts,state.attempts);
  if(!confirmed){state.quarantined=true;state.held=true;return;}
  // Initial attempt, then at most two automatic retries, after 5 s and 30 s.
  state.held=state.attempts>=3;
  state.until=now+(state.attempts===1?5000:30000);
}
export const maintenanceAdmissionStatus=state=>Object.freeze({cause:'open_exceeds_quantum',attempts:state.quarantined?Math.max(state.attempts,state.domain.maxAttempts):state.attempts,
  state:state.quarantined?'quarantined':state.held?'held':state.pending?'disposing':'backoff',retryAtMonoMs:state.until});

// Maximum fresh opens in any rotation of a complete sweep, starting cold.
// Cache-incompatible selections can replace the same writer more than once.
export function maintenanceAdmissionSlots(residents,writers,initial=new Map()) {
  let maximum=0;
  for(let start=0;start<residents.length;start++){
    const cache=new Map(initial);let count=0;
    for(let n=0;n<residents.length;n++){
      const i=(start+n)%residents.length;
      if(cache.get(writers[i])!==residents[i]){count++;cache.set(writers[i],residents[i]);}
    }
    maximum=Math.max(maximum,count);
  }
  return maximum;
}

export const maintenanceAdmissionFits=(lanes,coldSlots,spacing,maxMs)=>lanes*spacing+maxMs<=5000&&(lanes+coldSlots)*spacing+maxMs<=5000;
