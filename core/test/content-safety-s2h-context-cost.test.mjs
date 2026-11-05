import { familyCostParity } from '../testing/receipt-event-time-gates.mjs';
import { assertDeferredContentCost, assertDeferredContentCostInventory } from '../testing/content-safety-s2h-deferred-cost.mjs';
import { assertCostGateCases, assertCostGateCell, assertCostGateCells, costGatePopulations, unmigratedCostOnly } from '../testing/content-safety-s2h-cost-inventory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { openCostMemoryCore as openMemoryCore } from '../testing/content-safety-cost-hosts.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
const authority={authorize(request){const {input,...binding}=request;return {...binding,accessGeneration:1};},isCurrent:g=>g};
for(const base of [18,23,33])for(const n of [12,24])test(`R2 embedded lexical v${base} ${n} documents: real refresh, query, assembly, evidence and cursor`,async t=>{
 const records=[];
 for(const [safety,facts]of costGatePopulations()) {
  const f=safetyFixture(t,base);if(safety)await f.migrate();const db=f.connect();let calls=0;
  const core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority,counter:{id:'synthetic',countTokens(){calls++;return 1;}}}});t.after(()=>{core.close();db.close();});
  const refs=Array.from({length:n},(_,i)=>{const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic lexical evidence '+i,kind:'fact'},receipts:[receipt('lexical-'+i)]})).memory;return {type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision};});
  if(facts)transaction(db,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(db,{namespace:{...ns,scope:'project',projectId:'unrelated'},kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
  assertCostGateCell(db,base,safety,facts,ns.ownerId,{testName:t.name,n});
  const p={readSet:[ns],types:['memory'],intent:'current'},cases=[['refreshContextIndex',{...p,budget:{maxItems:1024,maxMs:5000}},'lexical'],['findCandidates',{...p,query:'Synthetic lexical',limit:1,deadlineMs:5000},'lexical'],
   ['findCandidates',{...p,query:'absentterm',limit:1,deadlineMs:5000},'absent'],['contextRead',{...p,query:'Synthetic lexical',budget:{maxTokens:4000,maxItems:12},deadlineMs:5000},'lexical'],
   ['contextRead',{...p,query:'absentterm',budget:{maxTokens:4000,maxItems:12},deadlineMs:5000},'absent'],['fetchCandidateEvidence',{readSet:[ns],intent:'current',refs:refs.slice(0,12)},'refs']];
  const measured=[];
  for(const [method,input,variant]of cases){const row=await measureContentRead(method,variant,()=>core[method](input,{}),()=>calls);assert.equal(row.result.ok,true,method+' '+JSON.stringify(row.result));
   if(variant==='absent')assert.deepEqual(method==='contextRead'?row.result.value.metered.items:row.result.value.items,[]);
   measured.push({...row,result:undefined});
   if(method==='findCandidates'&&variant==='lexical'){assert.ok(row.result.value.nextCursor);const page=await measureContentRead(method,'cursor',()=>core[method]({...input,cursor:row.result.value.nextCursor},{}));assert.equal(page.result.ok,true,JSON.stringify(page.result));assert.ok(page.result.value.items.length);measured.push({...page,result:undefined});}
   if(method==='fetchCandidateEvidence'){const snapshot=await measureContentRead(method,'snapshot',()=>core[method]({readSet:[ns],snapshot:row.result.value.snapshot},{}));assert.equal(snapshot.result.ok,true,JSON.stringify(snapshot.result));assert.equal(snapshot.result.value.items.length,12);measured.push({...snapshot,result:undefined});}
  }
  assert.deepEqual(measured.map(r=>[r.method,r.variant]),[['refreshContextIndex','lexical'],['findCandidates','lexical'],['findCandidates','cursor'],['findCandidates','absent'],['contextRead','lexical'],['contextRead','absent'],['fetchCandidateEvidence','refs'],['fetchCandidateEvidence','snapshot']]);
  assertCostGateCases('embedded-lexical',measured);records.push({base,n,safety,facts,records:measured});
 }
 t.diagnostic('R3_EMBEDDED_LEXICAL_COUNTS '+JSON.stringify(records));
 if(assertCostGateCells(records))return;
 const [legacy,zero,five]=records;
 for(const current of [zero,five])for(const [i,row]of current.records.entries()) {const old=legacy.records[i];assert.equal(row.ports,old.ports);assert.equal(row.begin,old.begin,row.method);assert.equal(row.statements-old.statements-row.ports,current.facts?6:4,row.method+' '+row.variant);}
});

const probe=fileURLToPath(new URL('../testing/content-safety-s2h-path-cost-probe.mjs',import.meta.url));
for(const [v,base]of [[34,18],[38,23],[48,33]])test(`R2 product fetchCandidateEvidence v${v}: exact refs/snapshot/cell inventory`,t=>{
 if(unmigratedCostOnly)return;
 for(const n of [24,48])for(const limit of [1,12]){
  const records=[];
  for(const [physical,facts]of [[base,0],[v,0],[v,5]]) {
   const child=spawnSync(process.execPath,[probe,'evidence',String(physical),String(n),String(facts),'match','lexical',String(limit)],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});assert.equal(child.status,0,child.stderr+child.stdout.slice(-5000));
   const rows=child.stdout.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s)).filter(r=>r.phase==='query');
   assert.deepEqual(rows.map(r=>r.label),['current-first','current-repeat','current-snapshot','history-first','history-repeat','history-snapshot']);
   assertCostGateCases('product-evidence',rows);
   for(const r of rows){assert.equal(r.method,'fetchCandidateEvidence');assert.equal(r.ok,true);assert.equal(r.items,limit);}
   records.push({physical,facts,rows});
  }
  t.diagnostic('R3_PRODUCT_EVIDENCE_COUNTS '+JSON.stringify({v,base,n,limit,records}));

 const [legacy,zero,five]=records;
  for(const current of [zero,five])for(const [i,row]of current.rows.entries()){
   const old=legacy.rows[i],begins=r=>r.sqlSummary.filter(s=>/^BEGIN/.test(s.sql)).reduce((n,s)=>n+s.exec,0);
   assert.equal(row.totalExecuted-old.totalExecuted,current.facts?6:4);assert.equal(begins(row),begins(old));assert.equal(row.counterCalls,0);
  }
 }
});

for(const [v,base]of [[34,18],[38,23],[48,33]])test(`R2 product lexical maintenance v${v}: real cold/repeat refresh at two corpus sizes`,t=>{
 if(unmigratedCostOnly)return;
 const fixed=new Map(),fiveDelta=new Map();
 for(const n of [12,24]){
  const records=[];
  for(const [physical,facts]of [[base,0],[v,0],[v,5]]) {
   const child=spawnSync(process.execPath,[probe,'maintenance',String(physical),String(n),String(facts)],{encoding:'utf8',timeout:120000,maxBuffer:16*1024*1024});assert.equal(child.status,0,child.stderr+child.stdout.slice(-5000));
   const rows=child.stdout.split('\n').filter(s=>s.startsWith('{')).map(s=>JSON.parse(s)).filter(r=>r.phase==='maintenance');
   assertCostGateCases('product-maintenance',rows);
   assert.deepEqual(rows.map(r=>[r.method,r.variant]),['current-first','current-repeat','history-first','history-repeat'].map(v=>['refreshContextIndex',v]));records.push({physical,facts,rows});
  }
  t.diagnostic('R3_PRODUCT_MAINTENANCE_COUNTS '+JSON.stringify({v,base,n,records}));

 const [legacy,zero,five]=records;
  for(const [i,row]of zero.rows.entries()){
   const old=legacy.rows[i],delta=row.statements-old.statements;
   assert.equal(row.begin,old.begin);assert.equal(row.ports,0);assert.ok(delta>=0&&delta<=6,JSON.stringify({v,n,method:row.variant,delta}));
   if(fixed.has(row.variant))assert.equal(delta,fixed.get(row.variant));else fixed.set(row.variant,delta);
   const factDelta=five.rows[i].statements-row.statements;
   if(fiveDelta.has(row.variant))assert.equal(factDelta,fiveDelta.get(row.variant),'five unrelated facts add no document-dependent SQL');else fiveDelta.set(row.variant,factDelta);
  }
 }
});

// Keep same-namespace unrelated facts separate from the scoped-empty proof.
// A maintenance refusal is an established privacy result, not a successful
// empty read; subsequent retained reads still exercise the completed index.
for(const base of [18,23,33])for(const semantic of [false,true])test(`embedded same-namespace facts v${base} semantic=${semantic}: five-fact slope and no-hit`,async t=>{
 const sizes=[];
 for(const n of [12,24]){
  const cells=[];
  for(const [safety,facts]of costGatePopulations()){
   const f=safetyFixture(t,base);if(safety)await f.migrate();const db=f.connect();let ports=0;
   const core=openMemoryCore({path:f.path,contextRead:{version:'context-read-v1',authority,counter:{id:'same-scope-counter',countTokens(){ports++;return 1;}},
    ...(semantic?{embedder:{id:'same-scope-fake',revision:'1',dimensions:2,normalization:'l2',embed(texts){ports++;return texts.map(()=>[1,0]);}},policy:{family:'local',maxRequests:10000,maxUsd:1,maxConcurrent:1,estimateUsd:()=>0}}:{})}});t.after(()=>{core.close();db.close();});
   for(let i=0;i<n;i++)ok(core.admit({namespace:ns,memory:{content:'Synthetic same-scope evidence '+i,kind:'fact'},receipts:[receipt('same-scope-'+i)]}));
   if(facts)transaction(db,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
   assertCostGateCell(db,base,safety,facts,ns.ownerId,{testName:t.name,n,semantic});
   const p={readSet:[ns],types:['memory'],intent:'current'},tasks=[['refreshContextIndex','refresh',{...p,budget:{maxItems:1024,maxMs:5000}}],
    ['findCandidates','hit',{...p,query:'Synthetic same-scope',semantic,limit:12,deadlineMs:5000}],
    ['contextRead','hit',{...p,query:'Synthetic same-scope',semantic,budget:{maxTokens:4000,maxItems:12},deadlineMs:5000}],
    ['findCandidates','lexical-absent',{...p,query:'absentterm',semantic:false,limit:12,deadlineMs:5000}],
    ['contextRead','lexical-absent',{...p,query:'absentterm',semantic:false,budget:{maxTokens:4000,maxItems:12},deadlineMs:5000}]];
   const records=[];
   for(const [method,variant,input]of tasks){const row=await measureContentRead(method,variant,()=>core[method](input,{}),()=>ports);
    if(facts&&method==='refreshContextIndex'){assert.equal(row.result.ok,false);assert.equal(row.result.error.code,'index_unavailable');assert.equal(row.result.error.details,undefined,'no population from a maintenance refusal');}
    else{assert.equal(row.result.ok,true,JSON.stringify(row.result));if(variant==='lexical-absent')assert.deepEqual(method==='contextRead'?row.result.value.metered.items:row.result.value.items,[]);}
    records.push({...row,result:undefined});
   }
   assertCostGateCases('embedded-same-scope',records);cells.push({base,n,semantic,safety,facts,records});
  }
  t.diagnostic('R3_SAME_SCOPE_COUNTS '+JSON.stringify(cells));assertCostGateCells(cells);sizes.push(cells);
 }
 if(unmigratedCostOnly)return;
 const problems=[],ratchets=new Set();
 for(const cells of sizes){const [legacy,zero]=cells;for(const [i,row]of zero.records.entries()){
  const old=legacy.records[i];if(row.begin!==old.begin||row.statements-old.statements-row.ports!==4)problems.push({n:cells[0].n,method:row.method,variant:row.variant,legacy:[old.statements,old.begin],zero:[row.statements,row.begin],ports:row.ports});
 }}
 for(const cells of sizes)for(const row of cells[2].records)
  assertDeferredContentCost(row,{testName:t.name,base,n:cells[0].n,semantic,facts:5},ratchets);
 assertDeferredContentCostInventory(ratchets,t.name);
 for(const [i,small]of sizes[0][2].records.entries()){
  const large=sizes[1][2].records[i];

  if(small.variant==='lexical-absent'&&(small.statements!==large.statements||small.begin!==large.begin))problems.push({method:small.method,variant:small.variant,noHitSmall:[small.statements,small.begin],noHitLarge:[large.statements,large.begin]});
 }
 assert.deepEqual(problems,[],'non-deferred zero-fact and no-hit costs');
});


test('R2 product family gate B: context smallest case, exact zero/five-fact parity', async t => {
  await familyCostParity(t, 33, async (f, db, facts) => {

  let calls = 0;
  const core = openMemoryCore({ path: f.path, contextRead: { version: 'context-read-v1', authority,
    counter: { id: 'synthetic', countTokens() { calls++; return 1; } } } }); t.after(() => core.close());
  for (let i = 0; i < 12; i++) ok(core.admit({ namespace: ns, memory: { content: 'Synthetic lexical evidence ' + i, kind: 'fact' }, receipts: [receipt('lexical-' + i)] }));
  const p = { readSet: [ns], types: ['memory'], intent: 'current' };
  ok(await core.refreshContextIndex({ ...p, budget: { maxItems: 1024, maxMs: 5000 } }, {}));
  return { method: 'contextRead', variant: 'lexical', ports: () => calls,
    call: () => core.contextRead({ ...p, query: 'Synthetic lexical', budget: { maxTokens: 4000, maxItems: 12 }, deadlineMs: 5000 }, {}),
    check(result) { assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.value.metered.items.length, 12); } };
  }, { factNamespace: { ...ns, scope: 'project', projectId: 'unrelated' } });
});
