// Explicit-path deterministic regressions. VM modules supply import doubles to
// the unchanged contention orchestration too, so the tests are safe on the base.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createTestWorkspace } from './workspace.mjs';
import { V3_DEFINITION, buildPlan, expandPlan, estimatePlan } from './fixtures/context-product/protocol.mjs';
import { validateRegistration, prepareInput, availabilitySeries, freshnessSeries } from './measure-context-read-product.mjs';
import { requestSeries } from './fixtures/context-product/series.mjs';
import { startWriter } from './fixtures/context-product/controller.mjs';
import { createWriterJournal } from './fixtures/context-product/writer-journal.mjs';
import { createReportSink } from './fixtures/context-product/report.mjs';

const {SourceTextModule,SyntheticModule}=vm;
if(!SourceTextModule) {
  // Keep ordinary *.test.mjs discovery working without global VM flags.
  test('fix2 regressions in an isolated VM-enabled test runner',()=>{
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const result=spawnSync(process.execPath,['--experimental-vm-modules','--test','--test-reporter=tap',fileURLToPath(import.meta.url)],{env,encoding:'utf8'});
    assert.equal(result.status,0,result.stdout+result.stderr);assert.equal(result.signal,null);
  });
} else {
const ns={ownerId:'synthetic',scope:'personal',projectId:null};
const loop=()=>({maxMs:1,over100:0,blocks:[]});
const good=()=>({ok:true,validated:true,bounds:true,expected:true,elapsedMs:1,readMs:1,hostLoop:loop(),telemetry:'complete',nativeBusy:0,publicBusy:0});
const cell={id:0,kind:'requests',count:1112,schema:23,scope:'launch',canonical:'WAL',sidecar:'WAL',intent:'history',
  language:'mixed',method:'contextRead',load:'fresh-same',windows:1,pairedBaseline:true,windowMs:30,type:'memory'};
const config=()=>({cell,method:cell.method,types:['memory','card'],readSet:[ns],namespace:ns,deadlines:{readMs:5000},input:{},
  production:true,maintainerCoverage:'complete',maintainerDiagnostics:[],seriesCeilingMs:60000,ledger:{memory:[],cards:[]},pump:{id:'fake',cronMs:60000}});
const rows=()=>({records:[],async record(cell,series,record){this.records.push({cell,series,record});}});
const sampler=()=>({async collect(){return [];},async stop(){return {};}});
const pump=()=>({async flush(){},async stop(){return [];}});
const calls=()=>['capture','review'].map(operation=>({operation,deadlineMs:5000,writeElapsedMs:1,elapsedMs:1}));

// Link real production source to in-memory dependencies; no rewritten function
// bodies, child processes, SQLite imports, actual waits or measured thresholds.
async function seriesWithDoubles(overrides) {
  const url=new URL('./fixtures/context-product/series.mjs',import.meta.url);
  async function dependency(specifier) {
    const namespace=overrides[specifier]??await import(new URL(specifier,url).href);
    const module=new SyntheticModule(Object.keys(namespace),function(){for(const [key,value] of Object.entries(namespace))this.setExport(key,value);});
    await module.link(()=>{});await module.evaluate();return module;
  }
  const module=new SourceTextModule(await readFile(url,'utf8'),{identifier:url.href,
    importModuleDynamically:dependency,initializeImportMeta:meta=>{meta.url=url.href;}});
  await module.link(dependency);await module.evaluate();return module.namespace;
}

async function contentionDoubles(t,{makeWriter,read}={}) {
  let clock=0;
  t.mock.method(Date,'now',()=>clock);
  return seriesWithDoubles({
    'node:perf_hooks':{performance:{now:()=>0}},
    'node:timers/promises':{setTimeout:async ms=>{clock+=ms;}},
    './controller.mjs':{...await import('./fixtures/context-product/controller.mjs'),startWriter:makeWriter??(async()=>{
      let start,end;return {child:{pid:1},start(a,b){start=a;end=b;},flush(){},async stop(){return {
        hostLoop:loop(),calls:calls().map(c=>({...c,writeStartedAt:start,writeFinishedAt:end,closeStartedAt:start,finishedAt:end})),
        diagnostics:{coverage:'complete',busy:0,records:Array.from({length:100},()=>({kind:'native_end',phase:'write',commit:true,at:start}))},
      };}};
    })},
    './actors.mjs':{coldAttempt:async()=>({record:good()}),startSampler:async()=>sampler(),attributeBlocks(){},terminate:async child=>{await child?.exited;}},
    './engine.mjs':{attempt:read??(async()=>{const start=clock++;return {record:{...good(),readStartedAt:start,readFinishedAt:clock}};}),
      configure:async()=>({options:{},supervisor:{async drain(){return [];},async close(){},ackCleanup(){}}}),drain:async()=>[]},
    '../../../../core/index.mjs':{renewContextMaintenancePump:()=>({completion:new Promise(()=>{}),async close(){}})},
  });
}

test('S1 paired WAL rejects each incomplete clone build even with empty drains',async t=>{
  const series=await contentionDoubles(t);
  for(const incomplete of [null,'reader','baseline'])for(const diagnostics of [[],[{coverage:'complete',busy:0}]]) {
    const report=rows(),clones=[];
    const result=await series.pairedWindows(config(),{cell,sink:report},async suffix=>{
      clones.push(suffix);return {maintainerCoverage:suffix.endsWith(incomplete)?'incomplete':'complete',maintainerDiagnostics:diagnostics};
    });
    assert.equal(clones.length,2);
    assert.equal(result.decision,incomplete?'invalid':'passed',JSON.stringify({incomplete,diagnostics,result}));
    if(incomplete)assert.ok(result.decisions[0].invalid.includes('telemetry'));
  }
});

const revised=()=>({...structuredClone(V3_DEFINITION),version:'fabricated-revision'});
for(const [name,mutate] of [
  ['nested array',d=>{d.dimensions.language=[['zh','ja']];}],
  ['object',d=>{d.dimensions.language=[{language:['zh','ja','mixed']}];}],
  ['omitted language axis',d=>{d.kinds.find(k=>k.kind==='requests').axes=d.kinds[0].axes.filter(a=>a!=='language');}],
])test(`schema refuses pooled population: ${name} before registration`,()=>{
  const definition=revised();mutate(definition);
  assert.throws(()=>buildPlan(definition),/invalid_protocol_definition/);
  assert.throws(()=>validateRegistration({protocolDefinition:definition}),/invalid_protocol_definition/);
});

for(const kind of V3_DEFINITION.kinds)test(`schema requires complete ${kind.kind} axes`,()=>{
  for(const axis of kind.axes) {
    const d=revised();d.kinds.find(k=>k.kind===kind.kind).axes=kind.axes.filter(a=>a!==axis);
    assert.throws(()=>buildPlan(d),/invalid_protocol_definition/,axis);
  }
});

test('schema closes every scalar axis and the method profile; defaults cannot pool populations',()=>{
  for(const axis of Object.keys(V3_DEFINITION.dimensions))for(const value of [[],{},null,'unregistered']) {
    const d=revised();d.dimensions[axis]=[value];assert.throws(()=>buildPlan(d),/invalid_protocol_definition/,axis);
  }
  const d=revised();d.kinds.find(k=>k.kind==='overflow').defaults.language=['zh','ja'];
  assert.throws(()=>buildPlan(d),/invalid_protocol_definition/);
});

test('paired:false is rejected before estimation, registration or orchestration',async t=>{
  const d=revised();d.fixedWindows.paired=false;d.fixedWindows.repetitions=1;
  assert.throws(()=>estimatePlan(buildPlan(d),d),/paired_baseline_required/);
  assert.throws(()=>validateRegistration({protocolDefinition:d}),/paired_baseline_required/);
  const series=await contentionDoubles(t);let clones=0;
  await assert.rejects(series.pairedWindows(config(),{cell:{...cell,pairedBaseline:false},sink:rows()},async()=>{clones++;return {};}),/paired_baseline_required/);
  assert.equal(clones,0);
});

// An actual controller acknowledges a native BUSY chunk, then recovers it on
// stop after the injected reader cleanup error. Only its child is a double.
async function busyWriter() {
  let observation,chunk,delivered=false,acknowledged=false,stops=0;
  const child={connected:true,pid:1,send(message){if(message.type==='ack')acknowledged=true;},
    take(type){if(type==='diagnostic_chunk'&&!delivered){delivered=true;return [chunk];}
      if(type==='target')return [{target:{id:'new',type:'memory',revision:1,committedAt:0,probe:'uniquelexicalprobe'}}];return [];},
    async wait(type){if(type==='armed')return {...observation,type:'armed',protocol:'product-writer-v1',boundary:'loader-before-open-v1'};
      if(type==='ready')return {};throw Error('child_exit');},exited:Promise.resolve({code:1,signal:null,disconnected:true})};
  const writer=await startWriter({},'fresh',{actor:(kind,c)=>{
    observation=c.observation;const journal=createWriterJournal({...observation,clock:()=>0});journal.enter(0,'open');
    assert.throws(()=>journal.invoke('open',()=>{throw Object.assign(Error('native'),{code:'ERR_SQLITE_ERROR',errcode:261});}));
    journal.leave();chunk=journal.chunk();return child;
  },terminate:async()=>{child.connected=false;}});
  const stop=writer.stop;writer.stop=()=>{stops++;return stop();};
  assert.equal(acknowledged,true);
  return {writer,stops:()=>stops};
}

for(const kind of ['requests','contention','availability','freshness'])test(`T4 ${kind} journals acknowledged writer BUSY before reader cleanup rethrows`,async t=>{
  const workspace=createTestWorkspace(t),path=join(workspace.path,'cleanup.jsonl'),sink=await createReportSink(path,{});
  const cleanupError=Error('reader_cleanup_failed'),busy=await busyWriter();let pumpStopped=0,samplerStopped=0;
  const deps={startWriter:async()=>busy.writer,startPump:async()=>({...pump(),async stop(){pumpStopped++;return [];}}),
    startSampler:async()=>({...sampler(),async stop(){samplerStopped++;return {};}}),
    attempt:async()=>{throw cleanupError;},now:()=>0};
  try {
    let result;
    if(kind==='requests')result=requestSeries(config(),{cell,sink},deps);
    else if(kind==='contention') {
      const series=await contentionDoubles(t,{makeWriter:deps.startWriter,read:deps.attempt});
      result=series.contentionWindow(config(),{cell,sink,windowMs:30});
    } else if(kind==='availability')result=availabilitySeries(config(),cell,{availabilityWindows:1},sink,undefined,deps);
    else result=freshnessSeries(config(),{...cell,sampleRules:{freshness:{minimum:1}}},
      {freshnessObservationMs:30000,probes:{'1112:23:memory:history':['uniquelexicalprobe']}},sink,deps);
    await assert.rejects(result,error=>error===cleanupError);
  } finally {await sink.finish('failed');}
  const records=(await readFile(path+'.records.jsonl','utf8')).trim().split('\n').map(JSON.parse);
  const writers=records.filter(r=>r.series===(kind==='contention'?'window-writer':'writer'));
  assert.equal(writers.length,1);assert.equal(writers[0].record.diagnostics.busy,1);
  assert.equal(writers[0].record.diagnostics.coverage,'incomplete');assert.equal(writers[0].record.exit.code,1);
  assert.ok(writers[0].record.diagnostics.records.some(r=>r.primary===5));assert.equal(busy.stops(),1);
  if(kind!=='contention')assert.equal(pumpStopped,1);
  if(kind==='requests')assert.equal(samplerStopped,1);
});

test('writer startup evidence is journaled by request, availability and freshness cleanup',async()=>{
  for(const kind of ['requests','availability','freshness']) {
    const report=rows(),evidence={diagnostics:{coverage:'incomplete',busy:1}},error=Object.assign(Error('startup_failed'),{writerEvidence:evidence});
    const deps={startPump:async()=>pump(),startWriter:async()=>{throw error;}};
    const running=kind==='requests'?requestSeries(config(),{cell,sink:report},deps):kind==='availability'?
      availabilitySeries(config(),cell,{},report,undefined,deps):freshnessSeries(config(),{...cell,sampleRules:{freshness:{minimum:1}}},
        {probes:{'1112:23:memory:history':['uniquelexicalprobe']}},report,deps);
    await assert.rejects(running,e=>e===error);assert.deepEqual(report.records.find(r=>r.series==='writer')?.record,evidence);
  }
});

const refs=n=>Array.from({length:n},(_,i)=>i%2?{namespace:ns,type:'card',cardId:String(i),revision:2,bodyRevision:3}:
  {namespace:ns,type:'memory',memoryId:String(i),revision:2});
const fetchConfig=(adapter,n=1)=>({...config(),method:'fetchCandidateEvidence',cell:{...cell,method:'fetchCandidateEvidence',adapter,refs:n}});
const fetchInput=(adapter,n=1)=>({readSet:[ns],deadlineMs:5000,...(adapter==='snapshot'?{snapshot:'opaque-host-snapshot'}:
  {intent:'history',refs:refs(n),...(adapter==='compact'?{fences:Array(n).fill('Abcd_123')}:{})})});

for(const profile of ['full','compact','snapshot'])test(`S6 ${profile} refuses substitutions from other fetch profiles`,async()=>{
  const c=fetchConfig(profile);
  for(const other of ['full','compact','snapshot'].filter(p=>p!==profile))
    await assert.rejects(prepareInput(c,{prepare:async()=>({input:fetchInput(other)})}),{code:'invalid_cell'},other);
  for(const n of [1,24])await prepareInput(fetchConfig(profile,n),{prepare:async()=>({input:fetchInput(profile,n)})});
});

test('S6 compact requires one valid eight-character fence for every expanded full ref',async()=>{
  for(const fences of [undefined,[],[null],[''],['short'],['Abcd_1234'],['invalid!'],[['Abcd_123']],new Array(1)]) {
    const input={...fetchInput('full'),...(fences===undefined?{}:{fences})};
    await assert.rejects(prepareInput(fetchConfig('compact'),{prepare:async()=>({input})}),{code:'invalid_cell'});
  }
});

test('S6 snapshot excludes refs, intent and fences; direct fetch requires complete typed refs',async()=>{
  for(const [key,value] of [['refs',refs(1)],['intent','history'],['fences',['Abcd_123']]])
    await assert.rejects(prepareInput(fetchConfig('snapshot'),{prepare:async()=>({input:{...fetchInput('snapshot'),[key]:value}})}),{code:'invalid_cell'});
  for(const profile of ['full','compact'])for(const ref of [{type:'memory'}, {...refs(1)[0],revision:0},
    {...refs(1)[0],namespace:{...ns,ownerId:'other'}}, {namespace:ns,type:'card',cardId:'card',revision:1}, {ns:0,type:'memory',id:'1',rev:1,f:'Abcd_123'}])
    await assert.rejects(prepareInput(fetchConfig(profile),{prepare:async()=>({input:{...fetchInput(profile),refs:[ref]}})}),{code:'invalid_cell'});
});

test('v3 retains 7520 cells, 81056 descriptors and 57600 fixed windows',()=>{
  const plan=buildPlan(),expanded=expandPlan(plan);
  assert.equal(plan.length,7520);assert.equal(expanded.length,81056);assert.equal(expanded.filter(d=>d.series==='contention').length,57600);
  assert.equal(estimatePlan(plan).fixedWindowMs,expanded.filter(d=>d.series==='contention').reduce((n,d)=>n+d.windowMs,0));
});
}
