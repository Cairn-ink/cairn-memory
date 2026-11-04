import test from 'node:test';
import assert from 'node:assert/strict';
import { assertCostGateCases, assertCostGateCell, assertCostGateCells, costGatePopulations, unmigratedCostOnly } from '../testing/content-safety-s2h-cost-inventory.mjs';
const from=name=>import(new URL('../'+name+'.mjs',import.meta.url));
const {openCostMemoryCore:openMemoryCore}=await from('testing/content-safety-cost-hosts');
const {safetyFixture,ns,ok,receipt}=await from('testing/content-safety-s2h-fixture');
const {measureContentRead}=await from('testing/content-safety-cost-meter');
const {createFakeEmbedder}=await from('context-read-embedder');
const {transaction}=await from('database');
const {writeContentSuppressionInside}=await from('content-suppression-storage');
const authority={authorize(request){const {input,...binding}=request;return {...binding,accessGeneration:1};},isCurrent:g=>g};
for(const base of [18,23,33])for(const n of [12,24])test(`enabled embedded semantic v${base} ${n}`,async t=>{
 const cells=[];
 for(const [safety,facts]of costGatePopulations()) {
 const f=safetyFixture(t,base);if(safety)await f.migrate();let counters=0,embeds=0;
 const fake=createFakeEmbedder({dimensions:8});
 const db=f.connect();
 const core=openMemoryCore({path:f.path,model:{countTokens:()=>1},contextRead:{version:'context-read-v1',authority,counter:{id:'synthetic',countTokens(){counters++;return 1;}},
 embedder:{...fake,embed(...args){embeds++;return args[0].map(()=>new Float32Array([1,0,0,0,0,0,0,0]));}},policy:{family:'local',maxRequests:10000,maxUsd:1,maxConcurrent:1,estimateUsd:()=>0}}});t.after(()=>{core.close();db.close();});
 for(let i=0;i<n;i++)ok(core.admit({namespace:ns,memory:{content:'probecommon synthetic semantic '+i,kind:'fact'},receipts:[receipt('semantic-'+i)]}));
 if(facts)transaction(db,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(db,{namespace:{...ns,projectId:'unrelated'},kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
  assertCostGateCell(db,base,safety,facts,ns.ownerId,{testName:t.name,n});
 const projection={readSet:[ns],types:['memory'],intent:'current'};
 const tasks=[['refreshContextIndex','cold',{...projection,budget:{maxItems:1024,maxMs:5000}}],['refreshContextIndex','repeat',{...projection,budget:{maxItems:1024,maxMs:5000}}],
  ['findCandidates','hit',{...projection,query:'probecommon',semantic:true,limit:1,deadlineMs:5000}],
  ['contextRead','hit',{...projection,query:'probecommon',semantic:true,budget:{maxTokens:4000,maxItems:12},deadlineMs:5000}],
  ['findCandidates','absent',{...projection,readSet:[{...ns,projectId:'absent'}],query:'probecommon',semantic:true,limit:12,deadlineMs:5000}],
  ['contextRead','absent',{...projection,readSet:[{...ns,projectId:'absent'}],query:'probecommon',semantic:true,budget:{maxTokens:4000,maxItems:12},deadlineMs:5000}]];
 const records=[];
 for(const [method,variant,input]of tasks){const before={counters,embeds};const row=await measureContentRead(method,variant,()=>core[method](input,{}),()=>counters+embeds);
  assert.equal(row.result.ok,true,JSON.stringify(row.result));const channels=method==='contextRead'?row.result.value.diagnostics.candidates.channels:row.result.value.channels;assert.equal(channels.semantic.state,'ready','actually enabled semantic execution');
  if(variant==='absent')assert.equal((method==='contextRead'?row.result.value.metered.items:row.result.value.items).length,0);
  records.push({...row,result:undefined,counterCalls:counters-before.counters,embedderCalls:embeds-before.embeds});
  if(method==='findCandidates'&&variant==='hit'){
   assert.ok(row.result.value.nextCursor);const page=await measureContentRead(method,'cursor',()=>core[method]({...input,cursor:row.result.value.nextCursor},{}),()=>counters+embeds);assert.equal(page.result.ok,true,JSON.stringify(page.result));assert.equal(page.result.value.items.length,1);records.push({...page,result:undefined,counterCalls:0,embedderCalls:0});
  }
 }
 assertCostGateCases('embedded-semantic',records);cells.push({base,n,safety,facts,records});
 }
 t.diagnostic('R3_ENABLED_COUNTS '+JSON.stringify(cells));
 if(assertCostGateCells(cells))return;
 const [legacy,zero,five]=cells;
 for(const cell of [zero,five])for(const [i,row]of cell.records.entries()){
  const old=legacy.records[i];assert.equal(row.begin,old.begin,row.method+' '+row.variant);assert.equal(row.ports,old.ports);
  assert.equal(row.statements-old.statements-row.ports,cell.facts?6:4,row.method+' '+row.variant+' fixed budget');
  const epochs=row.trace.filter(r=>/^SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs/.test(r.sql));
  assert.equal(epochs.length,row.ports+2,'entry/delivery plus one E1 per actual host counter or embedder invocation');assert.ok(epochs.slice(1,-1).every(r=>!r.transaction));
 }
});
