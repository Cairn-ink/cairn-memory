import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { transaction } from '../database.mjs';
import { suppressOwnerInside } from '../content-suppression-storage.mjs';
import { countTokens, modelPortValue } from '../model-budget.mjs';
import { callModel } from '../model-call.mjs';
import { emitDiagnostic } from '../model-diagnostics.mjs';
import { contentSafetyFacade, assertContentScopes, contentScopeEpochGuard, hasContentPortBoundary } from '../content-safety-boundary.mjs';
import { measureContentRead } from '../testing/content-safety-cost-meter.mjs';
import { openCostMemoryCore } from '../testing/content-safety-cost-hosts.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

for (const base of [18,23,33]) for (const migrated of [false,true]) {
 const version=migrated?{18:34,23:38,33:48}[base]:base;
 for (const protectedWork of [false,true]) test(`fix4b model ports v${version}, ${protectedWork?'content read':'outside content read'}: main lookup and call semantics`,async t=>{
  const f=safetyFixture(t,base);if(migrated)await f.migrate();const db=f.connect();t.after(()=>db.close());assert.equal(db.prepare('PRAGMA user_version').get().user_version,version,'actual physical layout');
  const reader=contentSafetyFacade({recall:work=>work()},{select:()=>ns,check:scopes=>assertContentScopes(db,scopes),portGuard:scopes=>contentScopeEpochGuard(db,scopes)});
  const run=work=>protectedWork?reader.recall(work):work();
  const refused=migrated&&protectedWork;
  for(const site of ['counter','diagnostic','provider','contextWindow','preflight']) await t.test(site,async()=>{
   for(const shape of ['proxy','prototype-proxy','accessor']) {
   const lookups=[],events=[],receivers=[];
   const target={contextWindow:8192,countTokens(){receivers.push(this);return 1;},select(){receivers.push(this);return {items:[]};},onDiagnostic:function(event){receivers.push(this);events.push(event);}};
   const key={counter:'countTokens',diagnostic:'onDiagnostic',provider:'select',contextWindow:'contextWindow',preflight:'countTokens'}[site];
   let model=target;
   if(shape==='proxy')model=new Proxy(target,{get(t,k,r){lookups.push(k);return Reflect.get(t,k,r);}});
   else if(shape==='prototype-proxy')model=Object.create(new Proxy(target,{get(t,k,r){lookups.push(k);return Reflect.get(t,k,r);}}));
   else {const value=target[key];Object.defineProperty(target,key,{get(){lookups.push(key);return value;},configurable:true});}
   const label=JSON.stringify({version,protectedWork,site,shape});
   if(site==='diagnostic'){
    await run(()=>emitDiagnostic(model,'select','core_call','provider_failure'));
    assert.equal(events.length,refused?0:1,label);
    if(!refused){assert.equal(receivers[0],undefined,'main invokes its diagnostic observer unbound: '+label);assert.equal(lookups.filter(k=>k==='onDiagnostic').length,1,label);}
   }else{
    const work=()=>site==='counter'?countTokens(model,'synthetic'):site==='preflight'?modelPortValue(model,'countTokens','token_count_unavailable'):callModel(model,'select','synthetic',{});
    if(refused){
     const code=site==='contextWindow'&&shape==='accessor'?'context_budget_exceeded':site==='provider'||site==='contextWindow'?'model_not_configured':'token_count_unavailable';
     await assert.rejects(async()=>run(work),{code},label);
    }else{
     const value=await run(work);
     if(site==='counter'){assert.equal(value,1,label);assert.equal(lookups.filter(k=>k==='countTokens').length,2,label);}
     else if(site==='preflight')assert.equal(typeof value,'function',label);
     else {assert.deepEqual(value,{items:[]},label);if(shape==='accessor')assert.equal(lookups.filter(k=>k===key).length,2,label);else{assert.equal(lookups.filter(k=>k==='select').length,2,label);assert.equal(lookups.filter(k=>k==='contextWindow').length,2,label);}}
     if(site!=='preflight')assert.ok(receivers.every(receiver=>receiver===model),label);
    }
   }
   if(refused)assert.equal(lookups.length,0,'protected lookup never invokes a Proxy trap or accessor: '+label);
   }
  });
  assert.equal(hasContentPortBoundary(),false,'the boundary never escapes its read');
 });
 test(`fix4b public counter preflights v${version}: Proxy and accessor follow the layout boundary`,async t=>{
  const f=safetyFixture(t,base);if(migrated)await f.migrate();
  for(const shape of ['proxy','accessor']){
   let calls=0,lookups=0;
   const target={countTokens(){calls++;return 1;}};
   const model=shape==='proxy'?new Proxy(target,{get(t,k,r){lookups++;return Reflect.get(t,k,r);}}):Object.defineProperty({},'countTokens',{get(){lookups++;return target.countTokens;}});
   const core=openMemoryCore({path:f.path,model});t.after(()=>core.close());
   const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic model port '+shape,kind:'fact'},receipts:[receipt(shape)]})).memory;
   for(const [method,input]of [['map',{namespace:ns}],['sourceSnapshot',{readSet:[ns]}],['fetch',{namespace:ns,refs:[{memoryId:memory.id,revision:memory.revision}]}]]){
    calls=lookups=0;const result=core[method](input);
    assert.equal(result.ok,!migrated,method+' '+shape+' '+JSON.stringify(result));
    if(migrated){assert.equal(result.error.code,'token_count_unavailable');assert.equal(calls,0);assert.equal(lookups,0);}else{assert.ok(calls>0);assert.equal(lookups,2*calls,'main looks up once for validation and once for each call');}
   }
   core.close();
  }
 });
}

for(const base of [18,23,33])test(`fix4b sourceSnapshot v${{18:34,23:38,33:48}[base]} validates every counter before corrupt source reads, outside transactions`,async t=>{
 const f=safetyFixture(t,base);await f.migrate();const db=f.connect(),connections=new Set();assert.equal(db.prepare('PRAGMA user_version').get().user_version,{18:34,23:38,33:48}[base],'actual migrated layout');
 const prepare=DatabaseSync.prototype.prepare;DatabaseSync.prototype.prepare=function(...args){connections.add(this);return Reflect.apply(prepare,this,args);};t.after(()=>{DatabaseSync.prototype.prepare=prepare;});
 const model={countTokens:()=>1},core=openMemoryCore({path:f.path,model});t.after(()=>{core.close();db.close();});
 const memory=ok(core.admit({namespace:ns,memory:{content:'Synthetic corrupt snapshot',kind:'fact'},receipts:[receipt('counter-first')]})).memory;
 db.prepare("UPDATE receipts SET excerpt='corrupted evidence' WHERE memory_id=?").run(memory.id);
 for(const value of [NaN,-1,0.5,Promise.resolve(1),'throw'])await t.test(String(value),()=>{
  let calls=0;model.countTokens=text=>{calls++;assert.equal(text,'');assert.ok([...connections].every(c=>!c.isOpen||!c.isTransaction));if(value==='throw')throw Error('synthetic');return value;};
  const result=core.sourceSnapshot({readSet:[ns]});assert.equal(result.ok,false);assert.equal(result.error.code,'token_count_unavailable');assert.equal(calls,1);
 });
});


for(const base of [18,23,33])test(`fix4b sourceSnapshot v${base} pair: overflow validates once and shares its enclosing failure fence`,async t=>{
 const cells=[];
 for(const migrated of [false,true]){
  const f=safetyFixture(t,base);if(migrated)await f.migrate();const db=f.connect();t.after(()=>db.close());
  const physical=db.prepare('PRAGMA user_version').get().user_version;assert.equal(physical,migrated?{18:34,23:38,33:48}[base]:base);
  const inputs=[],model={countTokens(text){inputs.push(text);return 1;}},core=openCostMemoryCore({path:f.path,model});t.after(()=>core.close());
  for(let i=0;i<2;i++)ok(core.admit({namespace:ns,memory:{content:'Synthetic snapshot overflow '+i,kind:'fact'},receipts:[receipt('overflow-'+i)]}));
  inputs.length=0;
  const row=await measureContentRead('sourceSnapshot','initial-counter-overflow',()=>core.sourceSnapshot({readSet:[ns],limit:1}),()=>inputs.length);
  assert.equal(row.result.ok,false);assert.equal(row.result.error.code,'context_item_too_large');assert.doesNotMatch(JSON.stringify(row.result),/Synthetic snapshot overflow/);
  const canonicalProofInside=row.trace.some(entry=>/SELECT schema_version AS cookie/.test(entry.sql)&&entry.transaction===true);
  if(migrated)assert.equal(canonicalProofInside,true,'canonical proof remains inside the source transaction after initial validation');
  cells.push({node:process.version,base,physical,migrated,statements:row.statements,begin:row.begin,ports:row.ports,hostInvocations:row.hostInvocations,counterInputs:inputs,canonicalProofInside});
 }
 t.diagnostic('FIX4B_SOURCE_VALIDATION_COST '+JSON.stringify(cells));
 for(const cell of cells){assert.deepEqual(cell.counterInputs,[''],'counter validation precedes the overflow read and dispatches no source text');assert.equal(cell.ports,1);assert.equal(cell.hostInvocations,1);}
 const [legacy,safety]=cells;assert.ok(safety.statements<=legacy.statements+6+safety.ports,JSON.stringify(cells));assert.ok(safety.begin<=legacy.begin,JSON.stringify(cells));
});

for(const base of [18,23,33])test(`fix4b sourceSnapshot v${{18:34,23:38,33:48}[base]}: erasure during initial validation stops all source dispatch`,async t=>{
 const f=safetyFixture(t,base);await f.migrate();const db=f.connect();let armed=false,erased=false;const inputs=[];
 const core=openMemoryCore({path:f.path,model:{countTokens(text){
  if(armed){inputs.push(text);assert.equal(text,'');assert.equal(db.isTransaction,false);transaction(db,()=>suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'fix4b-initial-validation'}));erased=true;}
  return 1;
 }}});t.after(()=>{core.close();db.close();});
 ok(core.admit({namespace:ns,memory:{content:'ProtectedSyntheticFix4bInitialValidation',kind:'fact'},receipts:[receipt('initial-validation')]}));
 armed=true;const result=core.sourceSnapshot({readSet:[ns]});assert.equal(erased,true);assert.deepEqual(inputs,['']);assert.equal(result.ok,false);assert.doesNotMatch(JSON.stringify(result),/ProtectedSyntheticFix4bInitialValidation/);
});
