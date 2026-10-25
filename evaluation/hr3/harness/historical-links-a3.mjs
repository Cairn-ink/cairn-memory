// Frozen historical diagnostic only. Never imported by live ingestion/requests.
// A-6 must not reinterpret paid graph replies using its source-name contract.
import {canonical,normalize,cells,orderEvents,intervalStart} from './common.mjs';
const adopted=e=>e.commitment==='adopted';
export function resolveLinks(events) {
  const prior=[], retired=new Map(),ids=new Set();
  return [...events].sort(orderEvents).map(e=>{
    const targets=[],errors=[];
    if(ids.has(e.event_id))errors.push('duplicate_event_id');ids.add(e.event_id);
    for(const a of e.predecessor_anchors) {
      const matches=prior.filter(p=>p.source_turns.includes(a.source_turn)&&normalize(p.subject)===normalize(a.subject)&&normalize(p.predicate)===normalize(a.predicate));
      if(matches.length!==1){errors.push(matches.length?'nonunique_anchor':'missing_anchor');continue;}
      const p=matches[0];
      if(!adopted(p)||p.unresolved||normalize(p.subject)!==normalize(e.subject)||normalize(p.predicate)!==normalize(e.predicate)||!cells(p.scope).some(c=>cells(e.scope).some(d=>canonical(c)===canonical(d)))||(retired.get(p.event_id)??Infinity)<=Date.parse(e.observed_at))errors.push('incompatible_or_historical_anchor');
      targets.push(p);
    }
    if(new Set(targets).size!==targets.length)errors.push('duplicate_anchor');
    if(e.change_type!=='initial'&&e.change_type!=='unchanged'&&!e.predecessor_anchors.length)errors.push('missing_predecessor');
    if(e.replacement_extent==='unresolved')errors.push('unresolved_extent');
    targets.sort(orderEvents);
    const event={...structuredClone(e),targets:targets.map(p=>p.event_id),unresolved:errors.length>0,link_errors:errors};
    if(!event.unresolved&&adopted(event)&&['correction','reversal','expiry'].includes(event.change_type)&&event.replacement_extent==='entire_predecessor')for(const p of targets)retired.set(p.event_id,intervalStart(event));
    prior.push(event);return event;
  });
}
