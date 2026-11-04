import { assertCostGateCases, assertCostGateCell, assertCostGateCells, costGatePopulations, unmigratedCostOnly } from '../testing/content-safety-s2h-cost-inventory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openMemoryStore } from '../index.mjs';
import { openCostMemoryCore as openMemoryCore } from '../testing/content-safety-cost-hosts.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';

for(const base of [18,23,33])for(const n of [24,48])test(`R2 cursor pages v${base} ${n} Memories`,async t=>{
 const records=[];
 for(const [safety,facts]of costGatePopulations()) {
  const f=safetyFixture(t,base);if(safety)await f.migrate();let calls=0;
  const db=f.connect(),core=openMemoryCore({path:f.path,model:{countTokens(){calls++;return 1;}}}),store=openMemoryStore({path:f.path});t.after(()=>{store.close();core.close();db.close();});
  const memories=Array.from({length:n},(_,i)=>ok(core.admit({namespace:ns,memory:{content:'Synthetic cursor memory '+i,kind:'fact'},receipts:[receipt('cursor-'+i),...(i?[]:[receipt('cursor-extra')])]})).memory);
  if(facts)transaction(db,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
  assertCostGateCell(db,base,safety,facts,ns.ownerId,{testName:t.name,n});
  const cases=[['get',{namespace:ns,memoryId:memories[0].id,receiptLimit:1},'nextReceiptCursor','receiptCursor'],['list',{namespace:ns,limit:12},'nextCursor','cursor'],
   ['map',{namespace:ns,limit:12},'nextCursor','cursor'],['fetch',{namespace:ns,refs:memories.slice(0,12).map(m=>({memoryId:m.id,revision:m.revision}))},'nextCursor','cursor']];
  const measured=[];
  for(const [method,input,next,key]of cases){const first=ok(core[method](input));assert.equal(typeof first[next],'string',method+' really has a page');
   const row=await measureContentRead(method,'cursor',()=>core[method]({...input,[key]:first[next]}),()=>calls);assert.equal(row.result.ok,true,JSON.stringify(row.result));
   const value=row.result.value;assert.ok(method==='get'?value.receipts.length>0:method==='list'?value.memories.length>0:value.items.length>0,'successful populated cursor page');
   measured.push({...row,result:undefined});
  }
  const scope=store.scope({ownerId:ns.ownerId,projectId:ns.projectId});
  for(const [method,call]of [['get',()=>scope.get(memories[0].id)],['list',()=>scope.list({limit:12})],['search',()=>scope.search('Synthetic cursor',{limit:12})]]){
   const row=await measureContentRead(method,'legacy-scope',call);assert.ok(row.result);assert.ok(method==='get'?row.result.content:row.result.length);measured.push({...row,result:undefined});
  }
  assert.deepEqual(measured.map(r=>[r.method,r.variant]),[['get','cursor'],['list','cursor'],['map','cursor'],['fetch','cursor'],['get','legacy-scope'],['list','legacy-scope'],['search','legacy-scope']]);
  assertCostGateCases('cursor',measured);
  records.push({base,n,safety,facts,records:measured});
 }
 t.diagnostic('R3_CURSOR_COUNTS '+JSON.stringify(records));
 if(assertCostGateCells(records))return;
 const [legacy,zero,five]=records;
 for(const current of [zero,five])for(const [i,row]of current.records.entries()) {const old=legacy.records[i];
  assert.equal(row.ports,old.ports);assert.equal(row.begin,old.begin);
  assert.equal(row.statements-old.statements-row.ports,4+(current.facts?2:0),row.method+' '+row.variant+' fixed statement formula');
 }
});
