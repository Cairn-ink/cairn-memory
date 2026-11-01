import { exact, integer } from './context-semantic-input.mjs';
import { fail } from './validation.mjs';

// Optional v1 metadata upgrades new quanta only; legacy charges are immutable.
export function validatePumpAccounting(w) {
  if(w.accounting!==undefined){
    const a=exact(w.accounting,'version,floorItems,floorMs');
    if(a.version!==1)fail('index_unavailable');integer(a.floorItems);integer(a.floorMs);
    if(w.usedItems<a.floorItems||w.usedMs<a.floorMs)fail('index_unavailable');
  }
  for(const q of Object.values(w.quanta))if(q.accounting!==undefined){
    const a=exact(q.accounting,'version,mode,items,ms,stage,known,usage');
    if(a.version!==1||!['lexical','embeddings','validation'].includes(a.mode)||!['reserved','receipt','closed'].includes(a.stage)||typeof a.known!=='boolean')fail('index_unavailable');
    integer(a.items,0,1024);integer(a.ms,1,5000);
    if((q.status==='reserved')!==(a.stage==='reserved')||a.stage==='receipt'&&!a.known)fail('index_unavailable');
    if(a.usage!==null){const u=exact(a.usage,'items,elapsedMs');integer(u.items,0,a.items);integer(u.elapsedMs,0,a.ms);if(a.stage!=='closed'||!a.known)fail('index_unavailable');}
  }
}
export function pumpFloors(w,floors) {
  if(floors===undefined)return;
  exact(floors,'items,ms');integer(floors.items);integer(floors.ms);
  const a=w.accounting??={version:1,floorItems:0,floorMs:0};
  a.floorItems=Math.max(a.floorItems,floors.items);a.floorMs=Math.max(a.floorMs,floors.ms);
  w.usedItems=Math.max(w.usedItems,a.floorItems);w.usedMs=Math.max(w.usedMs,a.floorMs);
}
export function pumpExpiry(input,time,monoNow) {
  const a=exact(input,'version,generation,floors,endsMonoNs');
  if(a.version!==1||typeof a.endsMonoNs!=='string'||!/^\d{1,24}$/.test(a.endsMonoNs))fail('invalid_input');
  integer(a.generation);
  // The absolute deadline precedes transport. Keep negative remaining time:
  // an already-expired message must not move expiry forward to receipt time.
  const remaining=Math.floor(Number(BigInt(a.endsMonoNs)-monoNow)/1e6);
  integer(remaining,-Number.MAX_SAFE_INTEGER,60000);return integer(time+remaining);
}
export function pumpUsage(w,q,input) {
  const a=q.accounting;if(!a)return; // Legacy: never infer a refund entitlement.
  if(a.stage==='reserved'){
    a.known=input.known===true;a.stage=a.known&&!Object.hasOwn(input,'usage')?'receipt':'closed';return;
  }
  if(a.stage!=='receipt')return; // Exactly once, including invalid reconciliation.
  a.stage='closed';
  try {
    const u=exact(input.usage,'version,items,elapsedMs');
    if(u.version!==1||input.known!==true||!a.known)return;
    integer(u.items,0,a.items);integer(u.elapsedMs,0,a.ms);
    a.usage={items:u.items,elapsedMs:u.elapsedMs};
    const floor=w.accounting??{floorItems:0,floorMs:0};
    w.usedItems=Math.max(floor.floorItems,w.usedItems-a.items+u.items);
    w.usedMs=Math.max(floor.floorMs,w.usedMs-a.ms+u.elapsedMs);
  }catch{} // Invalid/missing usage closes eligibility with the full charge.
}
