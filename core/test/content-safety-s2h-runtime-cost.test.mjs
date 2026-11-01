import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { assertCostGateCases, assertCostGateCell, assertCostGateCells } from '../testing/content-safety-s2h-cost-inventory.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
const fixed=new Map();
for(const base of [18,23,33])for(const n of [1,12])test(`R2 direct runtime recentReceipts v${base} ${n} receipts`,async t=>{
 const cells=[];
 for(const safety of [false,true])for(const facts of safety?[0,5]:[0]){
  const f=safetyFixture(t,base);if(safety)await f.migrate();const db=f.connect(),core=openMemoryCore({path:f.path}),runtime=createMemoryRuntime({path:f.path});
  t.after(()=>{runtime.close();core.close();db.close();});
  let memory;
  for(let i=0;i<n;i++)memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic recent receipt Memory',kind:'fact'},receipts:[receipt('runtime-recent-'+i)]})).memory;
  assert.equal(db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(memory.id).n,n,'actual retained receipt population');
  if(facts)transaction(db,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
  assertCostGateCell(db,base,safety,facts,ns.ownerId,{testName:t.name,n});
  const cases=[['runtime',memory,n],['empty-count',memory,0],['missing-ref',{id:'absent',revision:1},1]],records=[];
  for(const [variant,ref,count]of cases){
   const row=await measureContentRead('recentReceipts',variant,()=>{try{return {ok:true,value:runtime.recentReceipts(ns,{memoryId:ref.id,revision:ref.revision},count)};}catch(error){return {ok:false,error:{code:error.code}};}});
   if(variant==='missing-ref'){assert.equal(row.result.ok,false);assert.equal(row.result.error.code,'revision_conflict');}
   else{assert.equal(row.result.ok,true,JSON.stringify(row.result));assert.equal(row.result.value.length,count);if(!count)assert.deepEqual(row.result.value,[]);}
   records.push({...row,result:undefined});
  }
  assertCostGateCases('runtime-reads',records);cells.push({base,n,safety,facts,records});
 }
 t.diagnostic('R3_RUNTIME_COUNTS '+JSON.stringify(cells));assertCostGateCells(cells);
 const [legacy,zero,five]=cells;
 for(const cell of [zero,five])for(const [i,row]of cell.records.entries()){
  const old=legacy.records[i],addition=row.statements-old.statements,key=JSON.stringify([base,cell.facts,row.variant]);
  assert.equal(row.ports,0);assert.equal(row.begin,old.begin,'no safety BEGIN');
  if(!cell.facts)assert.ok(addition>=0&&addition<=6,JSON.stringify({base,n,variant:row.variant,addition}));
  if(fixed.has(key))assert.equal(addition,fixed.get(key),'zero per-receipt safety statements');else fixed.set(key,addition);
 }
});
