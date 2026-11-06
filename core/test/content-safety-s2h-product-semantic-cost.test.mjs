import '../testing/context-product-test-clock.mjs';
import { costGateFamilies } from '../testing/content-safety-cost-families.mjs';
import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productSemanticCells } from '../testing/content-safety-s2h-product-semantic-probe.mjs';

const measured=[];
const recordKey=r=>JSON.stringify([r.base,r.n,r.group,r.intent,r.safety,r.facts,r.method,r.variant,...(r.rawLineage?[r.rawLineage]:[]),...(r.safety&&r.family==='event-time'?['event-time']:[])]);
const pins=JSON.parse(readFileSync(new URL('./fixtures/content-safety-s2h-product-semantic-counts.json',import.meta.url),'utf8'));
assert.deepEqual(pins.provenance.nodes,['v24.22.1','v22.16.0'],'count provenance: both requested Nodes agree');
assert.equal(pins.provenance.main,'26f9e467','immutable native legacy comparator');
function pinned(row) {
 const key=recordKey(row),cap=pins.counts[key];
 assert.ok(cap,'native count pin required: '+key);
 // Fresh measurements bind every metric on both Nodes. A receipt-source
 // fallback must not silently replace the memo projection on this path.
 for(const [i,metric]of pins.metrics.entries())assert.equal(row[metric],cap[i],`${key}: exact native ${metric}`);
 if(!row.safety&&!row.rawLineage){
  const main=pins.mainLegacyCounts[key];assert.ok(main,'historical legacy pin required: '+key);
  for(const metric of ['statements','begin','hostInvocations']){
   const i=pins.metrics.indexOf(metric);assert.ok(i>=0);
   // Preserve the historical comparator. This exact first-call allowance
   // covers the independently counted seal reads at cold sidecar opening.
   const opening=metric==='statements'?(pins.legacyOpeningAllowance[key]??0):0;
   assert.ok(row[metric]<=main[i]+opening,`${key}: unmigrated ${metric} ${row[metric]} > main 26f9e467 ${main[i]} + opening ${opening}`);
  }
 }
}


// The native probe executes enabled semantics, including ledger/provider work.
// Ready state, items, dispatch counts and zero-fact numeric bounds are
// a6ec0e0e controls. Five-fact formula/BEGIN/applicability failures are the
// cost regressions; worker-port tests separately require E1 even where the
// old numeric bound already passed without those observations.
for(const base of [18,23,33])for(const group of ['scoped-empty','same-namespace','empty'])for(const intent of ['current','history'])test(`native product semantic v${base} ${group} ${intent}`,async t=>{
 const pairs=[];
 for(const n of [12,24]){
   const legacy=await productSemanticCells(t,{base,n,group,intent});measured.push(...legacy);legacy.forEach(pinned);
   for(const family of costGateFamilies())for(const facts of [0,5]){
     const rows=await productSemanticCells(t,{base,n,group,intent,family,safety:true,facts});measured.push(...rows);rows.forEach(pinned);
     for(const [i,s]of rows.entries()){
       const l=legacy[i];
       assert.equal(s.hostInvocations,l.hostInvocations,'no additional caller dispatch');
       assert.equal(s.state,'ready','control: enabled native semantic channel is ready');
       assert.equal(s.providerCalls,['enabled-repeat','hit-cursor'].includes(s.variant)||group==='empty'&&s.variant==='enabled-cold'?0:1,'control: actual provider attempts');
       if(s.method!=='refreshContextIndex')assert.equal(s.items,group==='empty'?0:12,'control: actual bounded items');
       assert.ok(s.statements<=l.statements+6+s.e1,`${s.cell} ${n} ${facts} ${s.method}:${s.variant}: S=${s.statements} L=${l.statements} E1=${s.e1}`);
       assert.ok(s.begin<=l.begin,`${s.cell} ${n} ${facts} ${s.method}:${s.variant}: BEGIN ${s.begin}/${l.begin}`);
       pairs.push({s,l});
     }
   }
 }
 for(const {s,l}of pairs.filter(p=>p.s.n===12)){
   const next=pairs.find(p=>p.s.n===24&&p.s.family===s.family&&p.s.facts===s.facts&&p.s.method===s.method&&p.s.variant===s.variant);
   assert.ok((next.s.statements-next.s.e1)-(s.statements-s.e1)<=next.l.statements-l.statements,`${s.cell} ${s.facts} ${s.method}:${s.variant}: net-of-E1 slope`);
 }
});

// Public Raw capture on BOTH sides is part of the same-engine comparator.
// Base 33 supports Raw capture in both safety families (physical 48 and 53).
// The foreign fixture covers both another owner and an unselected namespace;
// in-scope makes every selected Memory Raw-backed; both combines them.
for(const rawLineage of ['foreign','in-scope','both'])for(const intent of ['current','history'])test(`native Raw-present product semantic ${rawLineage} ${intent}`,async t=>{
 const pairs=[];
 for(const n of [12,24]){
  const legacy=await productSemanticCells(t,{base:33,n,group:'same-namespace',intent,rawLineage});measured.push(...legacy);legacy.forEach(pinned);
  for(const family of costGateFamilies())for(const facts of [0,5]){
   const rows=await productSemanticCells(t,{base:33,n,group:'same-namespace',intent,rawLineage,family,safety:true,facts});measured.push(...rows);rows.forEach(pinned);
   for(const [i,s]of rows.entries()){
    const l=legacy[i];pairs.push({s,l});
    assert.equal(s.state,'ready');
    assert.equal(s.providerCalls,['enabled-repeat','hit-cursor'].includes(s.variant)?0:1,'actual native provider attempts');
    if(s.method!=='refreshContextIndex')assert.equal(s.items,12);
    assert.equal(s.hostInvocations,l.hostInvocations,'no additional caller dispatch');
    assert.ok(s.statements<=l.statements+6+s.e1,`${rawLineage} ${n} ${facts} ${s.method}:${s.variant}: S=${s.statements} L=${l.statements} E1=${s.e1}`);
    assert.ok(s.begin<=l.begin,`${rawLineage} ${n} ${facts} ${s.method}:${s.variant}: BEGIN ${s.begin}/${l.begin}`);
   }
  }
 }
 for(const {s,l}of pairs.filter(p=>p.s.n===12)){
  const next=pairs.find(p=>p.s.n===24&&p.s.family===s.family&&p.s.facts===s.facts&&p.s.method===s.method&&p.s.variant===s.variant);
  assert.ok((next.s.statements-next.s.e1)-(s.statements-s.e1)<=next.l.statements-l.statements,`${rawLineage} ${s.facts} ${s.method}:${s.variant}: net-of-E1 slope`);
 }
});

// Control: independent dimension discovery catches deletion/renaming of a
// case or group even when the remaining formula assertions still pass.
after(()=>{
 assert.deepEqual(costGateFamilies(),['safety','event-time'],'native semantic discovery requires both families');
 const expected=[];
 for(const base of [18,23,33])for(const n of [12,24])for(const group of ['scoped-empty','same-namespace','empty'])for(const intent of ['current','history'])for(const [safety,facts,family]of [[false,0,'safety'],...costGateFamilies().flatMap(family=>[[true,0,family],[true,5,family]])])
   for(const [method,variants]of [['refreshContextIndex',['enabled-cold','enabled-repeat']],['findCandidates',['hit','semantic-only',...(n===24&&group!=='empty'?['hit-cursor']:[])]],['contextRead',['hit','semantic-only']]])
     for(const variant of variants)expected.push(recordKey({base,n,group,intent,safety,facts,method,variant,family}));
 for(const rawLineage of ['foreign','in-scope','both'])for(const n of [12,24])for(const intent of ['current','history'])for(const [safety,facts,family]of [[false,0,'safety'],...costGateFamilies().flatMap(family=>[[true,0,family],[true,5,family]])])
   for(const [method,variants]of [['refreshContextIndex',['enabled-cold','enabled-repeat']],['findCandidates',['hit','semantic-only',...(n===24?['hit-cursor']:[])]],['contextRead',['hit','semantic-only']]])
     for(const variant of variants)expected.push(recordKey({base:33,n,group:'same-namespace',intent,safety,facts,method,variant,rawLineage,family}));
 assert.deepEqual(measured.map(recordKey).sort(),expected.sort(),'exact native product cost matrix: no missing, renamed or duplicate case');
 assert.deepEqual(Object.keys(pins.counts).sort(),expected.toSorted(),'exact native count pin keys: no missing or stale record');
 assert.deepEqual(Object.keys(pins.mainLegacyCounts).sort(),measured.filter(r=>!r.safety&&!r.rawLineage).map(recordKey).sort(),'exact immutable native legacy pin keys');
 assert.deepEqual(Object.keys(pins.legacyOpeningAllowance).sort(),measured.filter(r=>!r.safety&&!r.rawLineage&&r.method==='findCandidates'&&r.variant==='hit').map(recordKey).sort(),'exact cold-opening allowance keys');
});
