import { costGateFamilies, costFamilyLabel, costFamilyFixture, costFamilyPhysical } from '../testing/receipt-event-time-gates.mjs';
import { costMatrixGate as familyGate, familyCostParity } from '../testing/receipt-event-time-gates.mjs';
import { assertRoleEmbeddedContentCost, assertRoleEmbeddedContentCostInventory } from '../testing/content-safety-s2h-deferred-cost.mjs';
import { assertCostGateCases, assertCostGateCell, assertCostGateCells, costGatePopulations, unmigratedCostOnly } from '../testing/content-safety-s2h-cost-inventory.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openCostMemoryCore as openMemoryCore } from '../testing/content-safety-cost-hosts.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { host, publish, read } from './role-fixture.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';

const completeRole=familyGate('S2h-3 Role matrices',costGateFamilies().length*6);
const completeRefusal=familyGate('S2h-3 Role feature refusals',costGateFamilies().length*6);
for(const family of costGateFamilies())for(const n of [0,1,12])test(`role R2: ${n} evidence items, private counters add no observations${costFamilyLabel(family, 33)}`,async t=>{
 const records=[];
 for(const [safety,facts]of costGatePopulations()) {
  const f=costFamilyFixture(t,33,family);if(safety)await f.migrate();const db=f.connect();let calls=0;
  const h=host({counter:{id:'synthetic-host',countTokens(){calls++;return 1;}}});
  const core=openMemoryCore({path:f.path,methodPackages:h.methods,roleProfiles:h.options,contextRead:h.context});t.after(()=>{core.close();db.close();});
  for(let i=0;i<n;i++)ok(core.admit({namespace:ns,memory:{content:'Synthetic role evidence '+i,kind:'fact'},receipts:[receipt('role-'+i)]}));
  ok(core.publishRoleProfileRelease(publish(ns,'finance','profile'),{}));
  const now=ok(core.readRoleTaskContext({...read('finance',[ns]),...(n?{task:'Synthetic role evidence'}:{})},{}));
  assert.equal(now.metered.evidence.length,n,'real search selected the requested evidence count');
  if(facts)transaction(db,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
  assertCostGateCell(db,33,safety,facts,ns.ownerId,{family,testName:t.name,n});
  const row=await measureContentRead('readRoleTaskContext','then-'+n,()=>core.readRoleTaskContext({mode:'then',readSet:[ns],receipt:now.metered.receipt},{}),()=>calls);
  assert.equal(row.result.ok,true,JSON.stringify(row.result));assert.equal(row.result.value.metered.evidence.length,n);
  assertCostGateCases('role-'+n,[row]);records.push({safety,facts,...row,result:undefined});
 }
 t.diagnostic('R3_ROLE_COUNTS '+JSON.stringify(records));
 if(assertCostGateCells(records))return;
 const [legacy,zero,five]=records,observed=new Set();
 assert.equal(zero.ports,legacy.ports);assertRoleEmbeddedContentCost(zero,{family,testName:t.name,base:33,n,facts:0},legacy,observed);
 assertRoleEmbeddedContentCost(five,{family,testName:t.name,base:33,n,facts:5},legacy,observed);
 assertRoleEmbeddedContentCostInventory(observed,t.name);
 assert.equal(zero.begin,legacy.begin);assert.equal(five.begin,legacy.begin);
 assert.equal(five.statements-zero.statements,2,'one bounded fact set; no per-counter transactions');
 const epochs=zero.trace.filter(r=>/FROM owner_suppression_epochs/.test(r.sql));
 assert.equal(epochs.length,zero.ports+2,'engine projection counters add zero epochs');
 assert.ok(epochs.slice(1,-1).every(r=>!r.transaction),'E1 outside transactions');
 completeRole(t.name);
});

// These physical cells have no Role schema. Preserve the existing feature
// refusal rather than upgrading a migrated layout merely to manufacture a gate.
for(const family of costGateFamilies())for(const base of [18,23])for(const n of [0,1,12])test(`role feature refusal v${costFamilyPhysical(base,family)} ${n} evidence items${costFamilyLabel(family, base)}`,async t=>{
 if(unmigratedCostOnly)return;
 const f=costFamilyFixture(t,base,family);await f.migrate();const core=openMemoryCore({path:f.path});t.after(()=>core.close());
 for(let i=0;i<n;i++)ok(core.admit({namespace:ns,memory:{content:'Synthetic unsupported role '+i,kind:'fact'},receipts:[receipt('unsupported-'+i)]}));
 let calls=0;const h=host({counter:{id:'synthetic-host',countTokens(){calls++;return 1;}}});
 assert.throws(()=>openMemoryCore({path:f.path,methodPackages:h.methods,roleProfiles:h.options,contextRead:h.context}),{code:'unsupported_database'});
 assert.equal(calls,0);
 completeRefusal(t.name);
});

for(const family of costGateFamilies())for(const n of [0,12,24])test(`role modes R2: ${n} items, now/refresh/compare/file and empty namespace${costFamilyLabel(family, 33)}`,async t=>{
 const cells=[];
 for(const [safety,facts]of costGatePopulations()){
  const f=costFamilyFixture(t,33,family);if(safety)await f.migrate();const db=f.connect();let calls=0;
  const h=host({counter:{id:'synthetic-host',countTokens(){calls++;return 1;}}});
  const core=openMemoryCore({path:f.path,methodPackages:h.methods,assets:h.assets,roleProfiles:h.options,contextRead:h.context});t.after(()=>{core.close();db.close();});
  for(let i=0;i<n;i++)ok(core.admit({namespace:ns,memory:{content:'Synthetic role variant evidence '+i,kind:'fact'},receipts:[receipt('role-mode-'+i)]}));
  const method=ok(core.importMethodVersion({namespace:ns,actionId:'role-mode-method',title:'Synthetic method',manifestFormat:'mixed-v1',files:[
   {kind:'text',path:'guide.txt',text:'Synthetic role guide content',mediaType:'text/plain'},
   {kind:'binary',path:'attachment.pdf',bytes:Buffer.from('%PDF-1.7 Synthetic'),mediaType:'application/pdf'}]},{}));
  ok(core.adoptMethodVersion({bindingNamespace:ns,package:method.package,version:method.version,readSet:[ns],roleId:null,expectedRevision:null,actionId:'adopt'},{}));
  const first=ok(core.publishRoleProfileRelease(publish(ns,'finance','first',null,null,{duties:['Synthetic first duty'],requiredOutputs:['Report'],methods:[method.package]}),{}));
  const saved=ok(core.readRoleTaskContext({...read('finance',[ns]),budget:{maxTokens:4000,maxItems:24},deadlineMs:5000,...(n?{task:'Synthetic role variant evidence'}:{})},{})).metered.receipt;
  const second=ok(core.publishRoleProfileRelease(publish(ns,'finance','second',first.release,1,{duties:['Synthetic second duty'],requiredOutputs:['Report'],methods:[method.package]}),{}));
  if(facts)transaction(db,()=>{for(let i=0;i<facts;i++)writeContentSuppressionInside(db,{namespace:ns,kind:'memory',key:'unrelated-'+i,reason:'purge',actionId:'fact-'+i});});
  assertCostGateCell(db,33,safety,facts,ns.ownerId,{family,testName:t.name,n});
  const file={mode:'file',readSet:[ns],receipt:saved,package:method.package},other={...ns,scope:'project',projectId:'absent'};
  const cases=[['now',{...read('finance',[ns]),budget:{maxTokens:4000,maxItems:24},deadlineMs:5000,...(n?{task:'Synthetic role variant evidence'}:{})}],
   ['refresh',{mode:'refresh',readSet:[ns],receipt:saved,budget:{maxTokens:4000,maxItems:24},deadlineMs:5000,...(n?{task:'Synthetic role variant evidence'}:{})}],
   ['compare',{mode:'compare',readSet:[ns],roleKey:'finance',from:first.release,to:second.release}],
   ['file-text',{...file,path:'guide.txt'}],['file-text-range',{...file,path:'guide.txt',range:{start:2,end:8}}],['file-binary',{...file,path:'attachment.pdf'}],
   ['absent',{...read('finance',[other])}]];
  const records=[];
  for(const [variant,input]of cases){const row=await measureContentRead('readRoleTaskContext',variant,()=>core.readRoleTaskContext(input,{}),()=>calls);assert.equal(row.result.ok,true,variant+' '+JSON.stringify(row.result));
   const value=row.result.value.metered;
   if(variant==='absent'){assert.equal(value.profile.release,null);assert.deepEqual(value.methods,[]);assert.deepEqual(value.evidence,[]);}
   if(['now','refresh'].includes(variant))assert.equal(value.evidence.length,n);
   if(variant==='compare')assert.ok(value.comparison);
   if(variant.startsWith('file-'))assert.ok(value.file);
   records.push({...row,result:undefined});
  }
  assertCostGateCases('role-modes',records);cells.push({base:33,n,safety,facts,records});
 }
 t.diagnostic('R3_ROLE_MODE_COUNTS '+JSON.stringify(cells));if(assertCostGateCells(cells))return;
 const [legacy,zero,five]=cells,ratchets=new Set();
 for(const current of [zero,five])for(const [i,row]of current.records.entries()){
  const old=legacy.records[i],fixed=row.statements-old.statements-row.ports;
  assert.equal(row.ports,old.ports);
  if(n>0&&['now','refresh'].includes(row.variant)){
   // Fail-before on a6ec0e0e for each of the four five-fact cells.
   await t.test(`facts=${current.facts} ${row.variant}`,()=>assertRoleEmbeddedContentCost(row,{family,testName:t.name,base:33,n,facts:current.facts},old,ratchets));continue;
  }
  assert.equal(row.begin,old.begin,'no safety transaction: '+row.variant);
  assert.equal(fixed,(row.variant==='file-binary'?6:4)+(current.facts?2:0),'exact fixed role mode cost: '+row.variant);
 }
 if(n>0)assertRoleEmbeddedContentCostInventory(ratchets,t.name);
 else assert.equal(ratchets.size,0,'zero-item modes retain their fixed-cost checks');
 completeRole(t.name);
});


test('R2 product family gate B: role smallest case, exact zero/five-fact parity', async t => {
  await familyCostParity(t, 33, async (f, db, facts) => {

  let calls = 0;
  const h = host({ counter: { id: 'synthetic-host', countTokens() { calls++; return 1; } } });
  const core = openMemoryCore({ path: f.path, methodPackages: h.methods, roleProfiles: h.options, contextRead: h.context });
  t.after(() => core.close());
  ok(core.publishRoleProfileRelease(publish(ns, 'finance', 'profile'), {}));
  const now = ok(core.readRoleTaskContext(read('finance', [ns]), {}));
  assert.equal(now.metered.evidence.length, 0);
  return { method: 'readRoleTaskContext', variant: 'then-0', ports: () => calls,
    call: () => core.readRoleTaskContext({ mode: 'then', readSet: [ns], receipt: now.metered.receipt }, {}),
    check(result) { assert.equal(result.ok, true, JSON.stringify(result)); assert.equal(result.value.metered.evidence.length, 0); } };
  });
});
