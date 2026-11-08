import '../testing/context-product-test-clock.mjs';
import { costGateFamilies } from '../testing/content-safety-cost-families.mjs';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { productSemanticCells } from '../testing/content-safety-s2h-product-semantic-probe.mjs';

const nativePins=JSON.parse(readFileSync(new URL('./fixtures/content-safety-s2h-product-semantic-counts.json',import.meta.url),'utf8'));

// Immutable main 26f9e467 native cold-refresh baseline. BEGIN and actual host
// invocations are controls; the statement ceiling fails on a6ec0e0e (+3).
for(const base of [18,23,33])for(const n of [12,24])test(`native legacy cold refresh v${base} n${n}`,async t=>{
 const [row]=await productSemanticCells(t,{base,n,coldOnly:true});
 const key=JSON.stringify([base,n,'scoped-empty','current',false,0,'refreshContextIndex','enabled-cold']);
 assert.ok(nativePins.counts[key],'fresh native D3 cold-refresh pin required');
 assert.ok(row.statements<=nativePins.counts[key][0],'legacy cold refresh stays at the B1 measurement or lower');
 assert.ok(row.statements<=(base===33?(n===12?819:1167):(n===12?687:903)),'legacy cold refresh adds no statements over main 26f9e467');
 assert.equal(row.headerSelects,0,'legacy cold refresh executes no suppression-header probe (also fails on merged #541)');
 assert.ok(row.begin<=52,'control: native BEGIN never exceeds immutable main; #541 also removes two BEGINs');
 assert.equal(row.hostInvocations,27,'control: original host invocation count');
});

// Cold refresh keeps the same-engine ceiling, BEGIN and net-of-E1 slope in
// each event-time family cell as well as the immutable legacy controls above.
for(const family of costGateFamilies())for(const base of [18,23,33])test(`native family cold refresh ${family} v${base}`,async t=>{
 const pairs=[];
 for(const n of [12,24]){
  const [l]=await productSemanticCells(t,{base,n,coldOnly:true});
  for(const facts of [0,5]){
   const [s]=await productSemanticCells(t,{base,n,coldOnly:true,family,safety:true,facts});
   assert.ok(s.statements<=l.statements+6+s.e1,'cold R2-A1 ceiling');
   assert.ok(s.begin<=l.begin,'cold R2-A1 BEGIN');
   assert.equal(s.hostInvocations,l.hostInvocations,'cold native dispatch');
   pairs.push({s,l});
  }
 }
 for(const {s,l}of pairs.filter(p=>p.s.n===12)){
  const next=pairs.find(p=>p.s.n===24&&p.s.facts===s.facts);
  assert.ok((next.s.statements-next.s.e1)-(s.statements-s.e1)<=next.l.statements-l.statements,'cold net-of-E1 slope');
 }
});
