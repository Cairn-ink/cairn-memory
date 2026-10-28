import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
const harness=new URL('../../../tools/testing/fixtures/context-product/',import.meta.url);
async function load(name,overrides={}) {
  const url=new URL(name,harness),dependency=async spec=>{
    const values=overrides[spec]??await import(spec.startsWith('.')?new URL(spec,url).href:spec);
    const m=new vm.SyntheticModule(Object.keys(values),function(){for(const [key,value] of Object.entries(values))this.setExport(key,value);});
    await m.link(()=>{});await m.evaluate();return m;
  };
  const m=new vm.SourceTextModule(readFileSync(url,'utf8'),{identifier:url.href,initializeImportMeta:m=>m.url=url.href,importModuleDynamically:dependency});
  await m.link(dependency);await m.evaluate();return m.namespace;
}
const config={readSet:[],types:['memory'],buildCeiling:3,pump:{quantum:{maxItems:128,maxMs:5000}}};
async function scenario(failure=false) {
  let elapsed=0,calls=0,closed=0,supervised=0;
  const handle=clock=>({async refreshContextIndex(input){
    calls++;const entered=clock();elapsed+=6001; // Deterministic slow quantum; no wall-time sleep or timing assertion.
    if(failure)return {ok:false,error:{code:'storage_error'}};
    return clock()-entered>=input.budget.maxMs?{ok:false,error:{code:'read_timeout'}}:{ok:true,value:{status:'complete'}};
  },async close(){closed++;}});
  const configure=async()=>({options:{},token:{},open:async()=>handle(()=>elapsed),supervisor:{async close(){supervised++;}}});
  const series=await load('series.mjs',{'./engine.mjs':{configure,attempt(){},drain:async()=>[]}});
  let runtimeOptions;
  const preparation=await load('test-preparation.mjs',{'./series.mjs':{build:series.build},'./engine.mjs':{configure},'../../../../core/context-product-reader.mjs':{
    createProductReaderRuntime(options){runtimeOptions=options;return async()=>handle(()=>Number(options.now())/1e6);},
  }});
  return {series,preparation,get state(){return {elapsed,calls,closed,supervised,runtimeOptions};}};
}
test('test preparation accepts one slow successful quantum per intent without retrying a timeout',async()=>{
  const ordinary=await scenario();await assert.rejects(ordinary.series.build(config),e=>e.code==='read_timeout');
  assert.equal(ordinary.state.calls,1);assert.equal(ordinary.state.closed,1);assert.equal(ordinary.state.supervised,1);
  const fixture=await scenario(),result=await fixture.preparation.buildForTests(config);
  assert.deepEqual(result.calls.map(r=>[r.intent,r.quantum,r.status]),[['current',0,'complete'],['history',0,'complete']]);
  assert.equal(fixture.state.elapsed,12002);assert.equal(fixture.state.calls,2);assert.equal(fixture.state.closed,1);assert.equal(fixture.state.supervised,1);
  assert.equal(fixture.state.runtimeOptions.maintenance,true);assert.equal(fixture.state.runtimeOptions.now(),0n);
  assert.equal(fixture.preparation.PREPARATION_WATCHDOG_MS,120000);
});
test('test preparation propagates a failed quantum immediately, with cleanup and no retry',async()=>{
  const fixture=await scenario(true);await assert.rejects(fixture.preparation.buildForTests(config),e=>e.code==='storage_error');
  assert.equal(fixture.state.calls,1);assert.equal(fixture.state.closed,1);assert.equal(fixture.state.supervised,1);
});
test('controlled preparation worker clock is isolated from the calling test process',async()=>{
  const {Worker}=await import('node:worker_threads');
  const source=readFileSync(new URL('test-preparation-worker.mjs',harness),'utf8').replace("await import('../../../../core/context-product-worker.mjs');", "const {parentPort}=await import('node:worker_threads');parentPort.postMessage([String(process.hrtime.bigint()),performance.now()]);");
  const worker=new Worker(source,{eval:true,type:'module'});
  const message=new Promise((resolve,reject)=>{worker.once('message',resolve);worker.once('error',reject);});
  const exit=new Promise(resolve=>worker.once('exit',resolve));
  assert.deepEqual(await message,['0',0]);assert.equal(await exit,0);assert.ok(process.hrtime.bigint()>0n);
});
