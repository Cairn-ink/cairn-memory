import {canonical,fail} from './common.mjs';

// This global key is private diagnostic identity. Public serializers and P
// receipts use source-order reader aliases; the mapping is never reader evidence.
export const eventKey=(family,batch,raw,namespace=null)=>canonical([family,namespace,batch,raw]);

// Provider IDs are batch-local. This is the single shared boundary before
// research/P fan-out; predecessor source-turn anchors are left untouched.
export function identifyEvents(family,batch,events,namespace=null) {
  const ids=new Set();
  return events.map((e,ordinal)=>{
    if(ids.has(e.event_id))fail('duplicate_event_id_within_batch');
    ids.add(e.event_id);
    return {...structuredClone(e),event_id:eventKey(family,batch,e.event_id,namespace),identity_partition:canonical([family,namespace]),batch,ordinal};
  });
}

export function freshEvents(previous,incoming) {
  const seen=new Set(previous.map(e=>e.event_id));
  return incoming.filter(e=>{if(seen.has(e.event_id))return false;seen.add(e.event_id);return true;});
}
