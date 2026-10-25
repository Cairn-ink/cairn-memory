// A-6 §2. Identity-only registry. Decision content lives exclusively in the
// admitted event stream; this registry has no retrieval or serialization API.
import {canonical,normalize,hash,cells,orderEvents,intervalStart} from './common.mjs';
import {canonicalPublicName} from '../generator/slots.mjs';
export const NAME_REGISTRY_VERSION='hr3-source-name-registry-a6-v1';
export const nameToken=name=>typeof name==='string'&&/^[A-Za-z0-9_-]+$/.test(name);
const key=(e,name)=>canonical([e.identity_partition??null,canonicalPublicName(e.subject,'subjects'),canonicalPublicName(e.predicate,'predicates'),normalize(name)]);
const location=(e,a)=>({observed:e.observed_at,batch:e.batch??0,turn:(e.source_turn_order??e.source_turns).indexOf(a.turn_id),start:a.start});
const precedes=(a,b)=>a.observed<b.observed||a.observed===b.observed&&(a.batch<b.batch||a.batch===b.batch&&(a.turn<b.turn||a.turn===b.turn&&a.start<b.start));
export class NameRegistry {
  #names=new Map();#ids=new Map();#forgotten=new Set();
  constructor({forgottenEventIds=[]}={}){this.#forgotten=new Set(forgottenEventIds);}
  lookup(e,name){return structuredClone(this.#names.get(key(e,name))??[]);}
  forgotten(id){return this.#forgotten.has(id);}
  forget(id){this.#forgotten.add(id);}
  register(e) {
    const a=e.record_name?.anchor;
    if(!e.record_name||!nameToken(e.record_name.name)||!a||a.quote!==e.record_name.name||!Number.isSafeInteger(a.start)||!Number.isSafeInteger(a.end)||e.name_errors?.some(x=>x==='invalid_record_name'))return {status:e.record_name?'invalid':'absent',collisions:[]};
    const k=key(e,e.record_name.name),prior=this.#names.get(k)??[];
    if(this.#ids.has(e.event_id))return {status:'replay',collisions:prior.filter(p=>p.event_id!==e.event_id).map(p=>p.event_id)};
    const entry={event_id:e.event_id,name:normalize(e.record_name.name),location:location(e,a),anchor:{turn_id:a.turn_id,start:a.start,end:a.end,sha256:hash(a.quote)}};
    this.#names.set(k,[...prior,entry]);this.#ids.set(e.event_id,k);
    return {status:prior.length?'collision':'registered',collisions:prior.map(p=>p.event_id)};
  }
  audit(){return {version:NAME_REGISTRY_VERSION,bindings:[...this.#names].map(([identity,entries])=>({identity,entries:structuredClone(entries)})),forgotten:[...this.#forgotten]};}
}
export function resolveNamedLinks(raw,{registry=new NameRegistry()}={}) {
  const prior=new Map(),retired=new Map(),result=[];
  for(const original of [...raw].sort(orderEvents)) {
    // Replay is idempotent, including a repeated event after a later collision.
    if(prior.has(original.event_id))continue;
    const e=structuredClone(original),errors=[...(e.name_errors??[])],targets=[],references=[];
    if(!Object.hasOwn(e,'record_name')||!Array.isArray(e.predecessor_refs)){errors.push('missing_name_annotations');e.record_name??=null;e.predecessor_refs=[];}
    for(const ref of e.predecessor_refs) {
      const d={record_name:ref.record_name,reference_turn:ref.anchor?.turn_id,matches:[],status:null};references.push(d);
      if(!nameToken(ref.record_name)||!ref.anchor||ref.anchor.quote!==ref.record_name||ref.anchor.start===undefined||ref.valid_name===false){d.status='invalid_predecessor_ref';errors.push(d.status);continue;}
      const matches=registry.lookup(e,ref.record_name);d.matches=matches.map(p=>p.event_id);
      if(e.record_name&&normalize(e.record_name.name)===normalize(ref.record_name)){d.status='self_named_predecessor';errors.push(d.status);continue;}
      if(matches.length!==1){d.status=matches.length?'ambiguous_named_predecessor':'missing_named_predecessor';errors.push(d.status);continue;}
      const identity=matches[0],p=prior.get(identity.event_id);
      if(!p||!precedes(identity.location,location(e,ref.anchor))){d.status='forward_named_predecessor';errors.push(d.status);continue;}
      if(registry.forgotten(p.event_id)){d.status='forgotten_named_predecessor';errors.push(d.status);continue;}
      if(p.commitment!=='adopted'||p.unresolved||!cells(p.scope).some(c=>cells(e.scope).some(x=>canonical(c)===canonical(x)))||(retired.get(p.event_id)??Infinity)<=Date.parse(e.observed_at)){
        d.status='incompatible_or_historical_named_predecessor';errors.push(d.status);continue;
      }
      if(targets.some(t=>t.event_id===p.event_id)){d.status='duplicate_reference';errors.push(d.status);continue;}
      d.status='resolved';d.target_event=p.event_id;d.target_source_turns=[...p.source_turns];targets.push(p);
    }
    if(!['initial','unchanged'].includes(e.change_type)&&!e.predecessor_refs.length)errors.push('missing_named_predecessor');
    if(e.replacement_extent==='unresolved')errors.push('unresolved_extent');
    // Registration/collision precedes enactment/retirement. Keep every binding,
    // including a rejected, unresolved or historical event, for later ambiguity.
    const registration=registry.register(e);if(registration.status==='collision')errors.push('colliding_record_name');if(registration.status==='invalid')errors.push('invalid_record_name');
    const linked={...e,targets:errors.length?[]:targets.sort(orderEvents).map(p=>p.event_id),unresolved:errors.length>0,link_errors:[...new Set(errors)],name_diagnostics:{registration,references}};
    if(!linked.unresolved&&linked.commitment==='adopted'&&['correction','reversal','expiry'].includes(linked.change_type)&&linked.replacement_extent==='entire_predecessor')for(const p of targets)retired.set(p.event_id,intervalStart(linked));
    prior.set(e.event_id,linked);result.push(linked);
  }
  return result;
}
