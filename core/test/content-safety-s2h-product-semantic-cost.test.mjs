import test,{after} from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { productSemanticCells } from '../testing/content-safety-s2h-product-semantic-probe.mjs';

const measured=[];
const recordKey=r=>JSON.stringify([r.base,r.n,r.group,r.intent,r.safety,r.facts,r.method,r.variant]);
const pins=JSON.parse(readFileSync(new URL('./fixtures/content-safety-s2h-product-semantic-counts.json',import.meta.url),'utf8'));
assert.deepEqual(pins.provenance.nodes,['v24.22.1','v22.16.0'],'count provenance: both requested Nodes agree');
assert.equal(pins.provenance.main,'26f9e467','immutable native legacy comparator');
function pinned(row) {
 const key=recordKey(row),cap=pins.counts[key];
 assert.ok(cap,'native count pin required: '+key);
 // Downward pins are controls where the old incomplete E1 path was cheaper;
 // populated fact paths fail these pins before the projection/cost fix.
 for(const [i,metric]of pins.metrics.entries())assert.ok(row[metric]<=cap[i],`${key}: ${metric} ${row[metric]} > post-change pin ${cap[i]}`);
 if(!row.safety){
  const main=pins.mainLegacyCounts[key];assert.ok(main,'historical legacy pin required: '+key);
  for(const metric of ['statements','begin','hostInvocations']){
   const i=pins.metrics.indexOf(metric);assert.ok(i>=0);
   assert.ok(row[metric]<=main[i],`${key}: unmigrated ${metric} ${row[metric]} > main 26f9e467 ${main[i]}`);
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
   for(const facts of [0,5]){
     const rows=await productSemanticCells(t,{base,n,group,intent,safety:true,facts});measured.push(...rows);rows.forEach(pinned);
     for(const [i,s]of rows.entries()){
       const l=legacy[i];
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
   const next=pairs.find(p=>p.s.n===24&&p.s.facts===s.facts&&p.s.method===s.method&&p.s.variant===s.variant);
   assert.ok((next.s.statements-next.s.e1)-(s.statements-s.e1)<=next.l.statements-l.statements,`${s.cell} ${s.facts} ${s.method}:${s.variant}: net-of-E1 slope`);
 }
});

// Control: independent dimension discovery catches deletion/renaming of a
// case or group even when the remaining formula assertions still pass.
after(()=>{
 const expected=[];
 for(const base of [18,23,33])for(const n of [12,24])for(const group of ['scoped-empty','same-namespace','empty'])for(const intent of ['current','history'])for(const [safety,facts]of [[false,0],[true,0],[true,5]])
   for(const [method,variants]of [['refreshContextIndex',['enabled-cold','enabled-repeat']],['findCandidates',['hit','semantic-only',...(n===24&&group!=='empty'?['hit-cursor']:[])]],['contextRead',['hit','semantic-only']]])
     for(const variant of variants)expected.push(recordKey({base,n,group,intent,safety,facts,method,variant}));
 assert.deepEqual(measured.map(recordKey).sort(),expected.sort(),'exact native product cost matrix: no missing, renamed or duplicate case');
 assert.deepEqual(Object.keys(pins.counts).sort(),expected.toSorted(),'exact native count pin keys: no missing or stale record');
 assert.deepEqual(Object.keys(pins.mainLegacyCounts).sort(),measured.filter(r=>!r.safety).map(recordKey).sort(),'exact immutable native legacy pin keys');
});
