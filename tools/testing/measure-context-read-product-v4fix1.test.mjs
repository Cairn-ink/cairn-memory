// Deterministic review regressions: fabricated clocks, processes and native work.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { readFile,writeFile,symlink,mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createTestWorkspace } from './workspace.mjs';
import { buildV4Plan,windowSlot } from './fixtures/context-product/v4-plan.mjs';
import { PROTOCOL } from './fixtures/context-product/protocol.mjs';
import { createReportSink } from './fixtures/context-product/report.mjs';
import { checkedSegments } from './fixtures/context-product/v4-checkpoints.mjs';
import { normalDecision } from './fixtures/context-product/v4-windows.mjs';
const base=process.env.P2D_V4FIX1_BASE;
const directory=new URL('./fixtures/context-product/',import.meta.url);
const loop=(maxMs=1)=>({maxMs,over100:maxMs>100?1:0,blocks:[]});
const good=(extra={})=>({ok:true,validated:true,bounds:true,expected:true,elapsedMs:1,readMs:1,telemetry:'complete',hostLoop:loop(),...extra});
const output=()=>({rows:[],async record(cell,series,record){this.rows.push({cell,series,record});},async cell(cell,decision){this.rows.push({type:'cell',cell,decision});},async finish(status,extra){this.final={status,...extra};}});
const namespace={ownerId:'owner',scope:'personal',projectId:null};
async function load(name,overrides={},transform=s=>s,context) {
  const url=new URL(name,directory),path=fileURLToPath(url);
  let source;
  if(base){const r=spawnSync('git',['show',base+':'+path.slice(process.cwd().length+1)],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);source=r.stdout;}
  else source=await readFile(url,'utf8');
  async function dependency(specifier){
    const ns=overrides[specifier]??(specifier.endsWith('.json')?{default:JSON.parse(await readFile(new URL(specifier,url),'utf8'))}:await import(specifier.startsWith('.')?new URL(specifier,url).href:specifier));
    const m=new vm.SyntheticModule(Object.keys(ns),function(){for(const [k,v] of Object.entries(ns))this.setExport(k,v);},{context});
    await m.link(()=>{});await m.evaluate();return m;
  }
  const m=new vm.SourceTextModule(transform(source),{identifier:url.href,context,initializeImportMeta:meta=>{meta.url=url.href;},importModuleDynamically:dependency});
  await m.link(dependency);await m.evaluate();return m.namespace;
}
if(!vm.SourceTextModule){
  test('v4fix1 regressions in VM-enabled isolated runner',()=>{
    const env={...process.env};delete env.NODE_TEST_CONTEXT;
    const r=spawnSync(process.execPath,['--experimental-vm-modules','--test','--test-reporter=tap',fileURLToPath(import.meta.url)],{env,encoding:'utf8'});
    assert.equal(r.status,0,r.stdout+r.stderr);
  });
}else{
function sessionFixture(){
  return {key:JSON.stringify([1112,18,'DELETE','DELETE']),durationMs:180000,probeLanes:20,availabilityLanes:1,probeEveryMs:900,
    writer:{lifecycle:'fresh',target:'same-projection',cadenceMs:20,backlog:false,keeper:false,operations:['capture','review'],startMs:0,endMs:180000},
    availability:Array.from({length:100},(_,k)=>['current','history'].map((intent,i)=>({id:intent+':'+k,intent,methodLabel:['c12','a1500'][k%2],language:['zh','ja','mixed'][k%3],releaseMs:k*1800+i*5}))).flat(),
    targets:Array.from({length:100},(_,k)=>({id:'m'+k,type:'memory',probe:'unique'+k,batch:Math.floor(k/20),createMs:k*850,reviewMs:k*850+35000})),batches:[]};
}
function registration(plan){
  const sessions=[];
  for(const count of [1112,3336])for(const schema of [18,23,33])for(const journals of [['DELETE','DELETE'],['WAL','WAL']]){
    const s=sessionFixture();s.key=JSON.stringify([count,schema,...journals]);
    if(schema!==18)s.targets.push(...s.targets.map(t=>({...t,type:'card',id:'c'+t.id,probe:'c'+t.probe,batch:t.batch+5})));
    s.batches=Array.from({length:schema===18?5:10},(_,ordinal)=>({ordinal,query:'batch'+ordinal}));sessions.push(s);
  }
  const projects=Array.from({length:32},(_,i)=>({...namespace,scope:'project',projectId:String(i)}));
  return {host:{id:'host',cpu:'cpu',ramBytes:1,os:'Linux',owner:'owner'},volume:{id:'volume',mount:'volume',filesystem:'ext4'},productionNode:'v24.15.0',
    telemetryCapacities:PROTOCOL.telemetry,drainSchedule:PROTOCOL.drainSchedule,reservation:{seconds:47700,exclusive:true,owner:'owner'},observationBudgetMs:47700000,
    supervision:{stallMs:100,progressMs:200,drainAllowanceMs:1},deadlineProvenance:'product',writerProfile:{provenance:'product'},stateDeadlines:{opening:1000,candidates:1000,fetch:1000,assembly:1000},sessions,
    fixtures:[{count:1112,schema:18,cards:0,selectionRevision:'selection',inventory:[namespace,...projects.slice(0,3)],overflowInventory:[namespace,...projects],otherOwnerNamespace:{...namespace,ownerId:'other'}}],
    segments:[{id:'first',cellKeys:plan.map(c=>c.key)}],stateProbes:Object.fromEntries(plan.filter(c=>c.kind==='injection'&&c.injection==='post-catch-up').flatMap(c=>c.subprobes.map(p=>[c.key+':'+p.id,'unique'+c.id+p.id]))),
    adapterModule:'data:text/javascript,export const validate=()=>true;'};
}
async function runner(t,{reason,exception=false,priorFailure=false,resumed=[]}={}){
  const plan=buildV4Plan('engine'),cell=exception?plan.find(c=>c.kind==='injection'&&c.injection==='post-catch-up'):plan.find(c=>c.kind==='requests');
  const report=output(),w=createTestWorkspace(t);let clock=0,supervise,runs=0;
  const context=vm.createContext({process:{version:'v24.15.0',once(){},off(){}},console:{log(){},error(){}},Date:{now:()=>clock},setInterval:fn=>{supervise=fn;return 1;},clearInterval(){}});
  const prior=plan.filter(c=>c!==cell).map(c=>({key:c.key,cell:c,complete:true,decision:'passed'}));
  const actualReport=await import('./fixtures/context-product/report.mjs');
  const mod=await load('v4-runner.mjs',{
    './report.mjs':{...actualReport,createReportSink:async()=>report},
    './v4-checkpoints.mjs':{readSegments:async()=>resumed,checkedSegments:()=>({cells:[...prior,...resumed.flatMap(s=>s.cells)],decision:priorFailure||resumed.some(s=>s.knownFailure)?'failed':'inconclusive'})},
    './v4-state.mjs':{stateCell:async()=>{runs++;await report.record(cell.id,'subprobe',{id:'status',code:null,expected:true});throw Error('interrupted');}},
    './series.mjs':{build:async()=>({coverage:'complete',diagnostics:[]}),requestSeries:async()=>{
      runs++;if(reason){clock=reason==='projected_overrun'?47700001:reason==='stalled_activity'?101:201;
        if(reason==='projected_overrun')await report.record(cell.id,'main',{});
        if(reason==='missing_progress')await report.record(cell.id,'pump',{});
        supervise();}return {decision:{decision:'passed'},languageCoverage:true};}},
  },s=>s,context);
  const input={...registration(plan),volumeRoot:w.path};
  await mod.runV4(input,{profile:'engine',segmentId:'first',reportPath:'unused',resume:['checkpoint.jsonl']},{validateRegistration(){},preregister:async()=>({node:'v24.15.0',hardware:{cpus:[]},filesystem:{},corpus:[]}),idleBaseline:async()=>({}),
    prepareCell:async()=>({readSet:[namespace],inspectLedger:async()=>({})}),probeDependencies:async()=>({ready:true}),prepareInput:async c=>c,storage:async()=>({value:{}})});
  return {report,cell,runs,plan};
}
for(const reason of ['projected_overrun','stalled_activity','missing_progress'])test(`final-cell supervision ${reason} cannot pass despite all cells finishing`,async t=>{
  const {report,plan}=await runner(t,{reason});assert.equal(report.final.completedCells,plan.length);assert.equal(report.final.stopReason,reason);assert.equal(report.final.status,'inconclusive');assert.equal(report.final.complete,false);
});
test('stopped profile retains a prior failed verdict',async t=>{const {report}=await runner(t,{reason:'projected_overrun',priorFailure:true});assert.equal(report.final.status,'failed');});
test('mid-T exception remains incomplete and is rerun on resume',async t=>{
  const {report,cell,plan,runs}=await runner(t,{exception:true});assert.equal(runs,1);assert.equal(report.final.completedCells,plan.length-1);
  const row=report.rows.find(r=>r.type==='cell');assert.equal(row.cell.key,cell.key);assert.equal(row.decision.complete,false);assert.equal(report.final.complete,false);
  const w=createTestWorkspace(t),path=join(w.path,'interrupted.jsonl'),s=await createReportSink(path,header(cell));
  for(const r of report.rows)if(r.type==='cell')await s.cell(r.cell,r.decision);else await s.record(r.cell,r.series,r.record);
  await s.finish(report.final.status);
  const {readSegments}=await load('v4-checkpoints.mjs'),segments=await readSegments([path]);assert.equal(segments[0].cells.length,0);assert.equal(segments[0].knownFailure,true);
  const rerun=await runner(t,{exception:true,resumed:segments});assert.equal(rerun.runs,1);assert.equal(rerun.report.final.status,'failed');
});
function header(cell){return {protocol:{version:'P2-product-v4'},segmentId:'first',registrationHash:'registered',host:{id:'host'},volume:{id:'volume'},node:'v24.15.0',segments:[{id:'first',cellKeys:[cell.key]}],inventory:[cell],cellCount:1};}
for(const [method,max] of Object.entries(PROTOCOL.latency))for(const series of method==='findCandidates'?['main','cold','warm-reference','WM']:['main','cold'])test(`interrupted ${method} ${series} maximum stays failed after a faster complete segment`,async t=>{
  const w=createTestWorkspace(t),cell={id:0,key:'cell',kind:series==='window'||series==='WM'?'exposure':'requests',method,canonical:'WAL',sidecar:'WAL'},h=header(cell);
  const path=join(w.path,'interrupted.jsonl'),s=await createReportSink(path,h);
  const label=method==='findCandidates'?'c12':method==='contextRead'?'a1500':'f24-full';
  await s.record(0,series,good({methodLabel:label,elapsedMs:max.maxMs+1,readMs:max.maxMs+1}));await s.interrupt();
  const complete=join(w.path,'complete.jsonl'),c=await createReportSink(complete,h);await c.cell(cell,{decision:'passed',complete:true});await c.finish('passed');
  const {readSegments}=await load('v4-checkpoints.mjs'),segments=await readSegments([path+'.partial',complete]);
  assert.equal(segments[0].knownFailure,true);assert.equal(checkedSegments(h,segments).decision,'failed');
});
test('interrupted restored-reader maximum is retained for the implicit backup candidate method',async t=>{
  const {readSegments}=await load('v4-checkpoints.mjs'),w=createTestWorkspace(t),cell={id:0,key:'backup',kind:'backup'};
  const path=join(w.path,'backup.jsonl'),sink=await createReportSink(path,header(cell));await sink.record(0,'restored-reader',good({elapsedMs:1501}));await sink.interrupt();
  assert.equal((await readSegments([path+'.partial']))[0].knownFailure,true);
});
test('loaded latency requires actual overlap, including late final reconciliation',async t=>{
  const {readSegments}=await load('v4-checkpoints.mjs'),w=createTestWorkspace(t),cell={id:0,key:'loaded',kind:'requests',method:'findCandidates',load:'fresh-same'};
  for(const overlap of [false,true]){
    const path=join(w.path,String(overlap)+'.jsonl'),sink=await createReportSink(path,header(cell));
    await sink.record(0,'main',good({elapsedMs:1501,overlap:false}));await sink.record(0,'overlap-final',{series:'main',index:0,overlap});await sink.interrupt();
    assert.equal((await readSegments([path+'.partial']))[0].knownFailure,overlap);
  }
});
test('partial evidence latches loop, overshoot, busy, bounds, functional and writer gates',async t=>{
  const w=createTestWorkspace(t),cell={id:0,key:'cell',kind:'requests',method:'findCandidates',canonical:'WAL',sidecar:'WAL'};
  const {readSegments}=await load('v4-checkpoints.mjs');
  const cases=[{hostLoop:loop(101)},{launcherLoop:loop(101)},{startupLoop:loop(101)},{overshootMs:51},{lateSuccess:true},{nativeBusy:1},{publicBusy:1},{bounds:false},{validated:false},{expected:false},{calls:[{operation:'review',deadlineMs:10,writeElapsedMs:11}]},{calls:[{operation:'capture',deadlineMs:100,writeElapsedMs:1,code:'read_timeout'}]},{calls:[{operation:'review',code:'storage_error'}]}];
  for(const [i,patch] of cases.entries()){const p=join(w.path,i+'.jsonl'),s=await createReportSink(p,header(cell));await s.record(0,'main',good(patch));await s.interrupt();assert.equal((await readSegments([p+'.partial']))[0].knownFailure,true,JSON.stringify(patch));}
});
test('checkpoint database names never open a descriptor in the measuring process; links and non-files refuse',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'canonical.sqlite.jsonl');await writeFile(path,'SQLite format 3\u0000');
  const opens=[],fs=await import('node:fs');const {readSegments}=await load('v4-checkpoints.mjs',{'node:fs':{...fs,createReadStream:(...args)=>{opens.push(args[0]);return fs.createReadStream(...args);}}});
  await assert.rejects(readSegments([path]));assert.equal(opens.length,0);
  const cell={id:0,key:'cell'},p=join(w.path,'report.jsonl'),s=await createReportSink(p,header(cell));await s.finish('inconclusive');
  const link=join(w.path,'link.jsonl');await symlink(p,link);await assert.rejects(readSegments([link]),/regular_file_required/);
  const dbLink=join(w.path,'database-link.jsonl');await symlink(path,dbLink);await assert.rejects(readSegments([dbLink]),/regular_file_required/);
  const dir=join(w.path,'directory.jsonl');await mkdir(dir);await assert.rejects(readSegments([dir]),/regular_file_required/);
  // A valid report copied with a linked journal is also refused.
  const copy=join(w.path,'copy.jsonl');await writeFile(copy,await readFile(p));await symlink(p+'.records.jsonl',copy+'.records.jsonl');await assert.rejects(readSegments([copy]),/regular_file_required/);
});
async function runSession({blockAt,failure}={}){
  const {sharedSession}=await load('v4-session.mjs'),{observeLoop}=await import('./fixtures/context-product/engine.mjs');
  const session=sessionFixture(),report=output(),lanes=[];let clock=0,parentClock=0,pumpStopped=false,writerStopped=false;
  const block=phase=>{if(blockAt===phase)parentClock+=150;};
  const cells=['current','history'].map(intent=>({id:0,key:intent,kind:'availability',intent,canonical:'WAL',sidecar:'WAL',schema:18}));
  const config={cell:cells[0],supervision:{stallMs:1000},maintainerCoverage:'complete',maintainerDiagnostics:[{coverage:'complete',busy:0}]};
  const promise=sharedSession(cells,session,{config,sink:report,prepareInput:async c=>{block('harness-validation');return {...c,input:{}};},validateProbe:()=>true},{
    now:()=>clock,wait:async ms=>{clock+=ms;},loopFactory:()=>observeLoop({timers:false,now:()=>parentClock}),
    makeLane:()=>{
      const queue=[],waiters=[];let exit;const exited=new Promise(r=>{exit=r;});
      const send=m=>{const i=waiters.findIndex(w=>Array.isArray(w.type)?w.type.includes(m.type):w.type===m.type);if(i>=0)waiters.splice(i,1)[0].resolve(m);else queue.push(m);};
      const lane={pid:lanes.length+1,connected:true,exited,stopped:false,send(m){
        if(m.type==='read'){
          if(failure==='rejected-wait'){for(const w of waiters.splice(0))w.reject(Error('attempt_rejected'));lane.reject=true;}
          else if(failure==='lane-failure')send({type:'lane-failure',id:m.id,code:'sampler_failed'});
          else send({type:'read-result',id:m.id,value:{record:good({startedAt:clock,readStartedAt:clock,readFinishedAt:clock+1})}});
        }else if(m.type==='stop'){block('lane-stop');lane.connected=false;lane.stopped=true;send({type:'result',attribution:{}});exit({code:0,signal:null});}
      },wait(type){if(type==='ready')return Promise.resolve({startupLoop:loop()});if(lane.reject)return Promise.reject(Error('attempt_rejected'));
        const i=queue.findIndex(m=>Array.isArray(type)?type.includes(m.type):m.type===type);return i>=0?Promise.resolve(queue.splice(i,1)[0]):new Promise((resolve,reject)=>waiters.push({type,resolve,reject}));}};
      lanes.push(lane);return lane;
    },
    makePump:async()=>({async flush(){block('pump-renewal');},async stop(){block('pump-stop');pumpStopped=true;return [{diagnostics:{protocol:'context-native-v1',coverage:'complete',busy:0}}];}}),
    makeWriter:async()=>{let startAt,endAt;return {child:{take:()=>[]},flush(){},start(s,e){startAt=s;endAt=e;},async stop(){writerStopped=true;
      const calls=[0,179990].map((offset,k)=>({id:k,ordinaryOrdinal:k,streamKind:'ordinary',operation:k?'review':'capture',lifecycle:'fresh',writerTarget:'same',nativeCommit:true,startedAt:startAt+offset,
        cycleStartedMono:offset,openStartedAt:startAt+offset+1,openFinishedAt:startAt+offset+2,writeStartedAt:startAt+offset+3,writeFinishedAt:startAt+offset+4,closeStartedAt:startAt+offset+5,closeFinishedAt:startAt+offset+6,finishedAt:startAt+offset+6,deadlineMs:5000,writeElapsedMs:1}));
      return {writerEndAt:endAt,calls,hostLoop:loop(),exit:{code:0,signal:null},diagnostics:{coverage:'complete',busy:0,records:[]},pacing:[0,179990].map((offset,ordinal)=>({ordinal,startedMono:offset,workFinishedMono:offset+6,delayMs:14,resumedMono:offset+20}))};}};},
  });
  return {promise,report,lanes,drained:()=>pumpStopped&&writerStopped&&lanes.every(l=>l.stopped)};
}
for(const blockAt of [undefined,'harness-validation','pump-renewal','pump-stop','lane-stop'])test(`shared-session parent loop includes ${blockAt??'healthy control'} through final drain`,async()=>{
  const r=await runSession({blockAt}),ds=await r.promise;assert.equal(r.drained(),true);const engineBlock=blockAt&&blockAt!=='harness-validation';
  for(const d of ds.values())assert.equal(d.decision,engineBlock?'failed':'passed',JSON.stringify(d));
  if(engineBlock){const observed=r.report.rows.find(r=>r.series==='session-parent-loop').record.hostLoop;assert.equal(observed.maxMs>100,true);}
});
for(const failure of ['lane-failure','rejected-wait'])test(`session ${failure} settles pending work and drains every actor`,async()=>{
  const r=await runSession({failure});let timer;
  const result=await Promise.race([r.promise.then(()=>({success:true}),error=>({error})),new Promise(resolve=>{timer=setTimeout(()=>resolve({hung:true}),100);})]);clearTimeout(timer);
  assert.equal(result.hung,undefined);assert.ok(result.error);assert.equal(r.drained(),true);assert.ok(r.report.rows.some(r=>r.series==='lane-failure'));
});
for(const defect of ['oracle','bounds','functional','not-ok','throw'])test(`WM initialization ${defect} failure survives a correct measured read`,async()=>{
  const {attempt}=await load('engine.mjs'),{observeLoop}=await import('./fixtures/context-product/engine.mjs');let calls=0,validated=0,oracles=0;
  const config={method:'findCandidates',readSet:[namespace],ownerCoverage:{policy:'recent-projects-v1',selectionRevision:'test',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0},deadlines:{openMs:5000,requestMs:5000},cell:{kind:'exposure'},input:{}};
  const r=await attempt(config,{initialize:true,clock:()=>1,loopFactory:()=>observeLoop({timers:false,now:()=>0}),
    open:async()=>({findCandidates:async()=>{calls++;if(calls===1&&defect==='throw')throw Object.assign(Error('initialization_failed'),{code:'index_unavailable'});return calls===1?{ok:defect!=='not-ok',error:{code:'index_unavailable'},value:{initial:true}}:{ok:true,value:{}};},async close(){}}),
    validate:async r=>{validated++;return {bounds:!(r.value?.initial&&['bounds','functional'].includes(defect)),validated:true};},
    oracle:async r=>{oracles++;return !(r?.value?.initial&&defect==='oracle');}});
  assert.equal(r.record.expected,false);assert.ok(validated>=(defect==='throw'?0:2));assert.ok(oracles>=(defect==='throw'?1:2));assert.equal(normalDecision({canonical:'DELETE'},[r.record]).decision,'failed');
});
test('three-window spread fixture otherwise passes, and deleting both spread checks changes its verdict',async()=>{
  const cell=buildV4Plan('engine').find(c=>c.kind==='exposure');
  const windows=Array.from({length:cell.windows},(_,repetition)=>{
    const startAt=repetition*100000,endAt=startAt+30000;
    const writer=()=>{const calls=Array.from({length:100},(_,id)=>({id,writerTarget:'same',operation:id%2?'review':'capture',lifecycle:'fresh',writeStartedAt:startAt,writeFinishedAt:endAt,closeStartedAt:startAt,closeFinishedAt:endAt}));
      return {calls,diagnostics:{records:calls.map(c=>({kind:'native_end',stage:'commit',ok:true,operation:c.id,phase:'write',commit:true,at:startAt+1}))}};};
    return {repetition,startAt,endAt,writer:writer(),baseline:{startAt,endAt,writer:writer()},attempts:Array.from({length:repetition<2?200:40},(_,slot)=>({...good({ok:repetition<2}),...windowSlot(cell,repetition,slot),slot,series:'window',readStartedAt:startAt+slot*2+1,readFinishedAt:startAt+slot*2+2}))};
  });
  const actual=await load('v4-validation.mjs'),mutant=await load('v4-validation.mjs',{},s=>s.replace('||c.writeWindows.size<3','').replace('||c.closeWindows.size<3',''));
  const r=actual.validateExposure(cell,windows);assert.equal(r.decision,'invalid');assert.ok(r.errors.every(e=>e.startsWith('method_minima:')));assert.equal(mutant.validateExposure(cell,windows).decision,'passed');
});
test('crash quarantine released at reader_failed settlement is rejected despite later native disposal',async()=>{
  const {stateCell}=await load('v4-state.mjs'),{createSupervisorRegistry}=await import('../../core/context-read-supervisor.mjs');
  for(const earlyRelease of [false,true]){
    const report=output();let ordinal=0,current;
    const result=await stateCell({id:0,injection:'crash',canonical:'DELETE'}, {sink:report,input:{stateDeadlines:{opening:1000,candidates:1000,fetch:1000,assembly:1000}},build:async()=>{},
      prepare:async cell=>({cell,method:cell.method,path:'owned.sqlite',deadlines:{requestMs:5000},input:{},initialCounts:{},inspectLedger:async()=>({})}),prepareInput:async c=>c}, {
      nativeFactory:({gate})=>{const flags=new Int32Array(gate,0,8),times=new BigInt64Array(gate,32,2);const probe=ordinal++;
        current={flags,times,workers:[{terminate(){current.resource.safety=!earlyRelease;current.settle();return Promise.resolve(0);}}],arm(){},release(){if(current.resource){current.registry.finish(current.resource);}},evidence:()=>({}),close(){}};current.probe=probe;return current;},
      configure:async()=>{
        const native=current,registry=createSupervisorRegistry(),supervisor=registry.supervisor();native.registry=registry;
        const {supervisorOwner}=await import('../../core/context-read-supervisor.mjs');
        const resource=registry.register(supervisorOwner(supervisor).owner,{path:'owned.sqlite',domain:'test',resources:new SharedArrayBuffer(16)});native.resource=resource;resource.workerStopped=false;resource.nativeDisposed=false;
        const failure=()=>new Promise((resolve,reject)=>{Atomics.store(native.flags,1,1);native.settle=()=>{registry.cleanup(resource);if(earlyRelease)resource.safety=false;
          if(native.probe===0)reject(Object.assign(Error('reader_failed'),{code:'reader_failed',cleanupId:resource.id}));else resolve({ok:false,error:{code:'reader_failed'}});};});
        const h={findCandidates:failure,fetchCandidateEvidence:failure,contextRead:failure,close:()=>resource.delivery};
        return {supervisor,open:()=>native.probe===0?failure():Promise.resolve(h)};
      },
      readValidate:async()=>({bounds:true,validated:true}),observeLoop:()=>({finish:async()=>loop()}),instrumentGc:()=>({entries:[],close(){}}),startSampler:async()=>({collect:async()=>[],stop:async()=>({})}),
    });
    assert.equal(result.decision,earlyRelease?'invalid':'passed',JSON.stringify(result));
    const records=report.rows.filter(r=>r.series==='subprobe').map(r=>r.record);assert.equal(records.length,4);assert.ok(records.every(r=>r.nativeDisposed));assert.ok(records.every(r=>r.supervisedUntilDisposal===!earlyRelease));
  }
});
test('checkpoint latency clocks follow registered populations and do not add a W latency claim',async t=>{
  const {readSegments}=await load('v4-checkpoints.mjs'),w=createTestWorkspace(t),cell={id:0,key:'cell',kind:'exposure',method:'findCandidates'};
  for(const [series,patch] of [['WM',{elapsedMs:9000,readMs:1}],['warm-reference',{elapsedMs:9000,readMs:1}],['window',{elapsedMs:9000,readMs:9000}],['warmups',{elapsedMs:9000,readMs:9000}]]){
    const path=join(w.path,series+'.jsonl'),sink=await createReportSink(path,header(cell));await sink.record(0,series,good(patch));await sink.interrupt();
    assert.equal((await readSegments([path+'.partial']))[0].knownFailure,false,series);
  }
});
test('actor consumes a failure alternative without leaving a read-result waiter behind',async()=>{
  const {actor}=await load('actors.mjs'),{EventEmitter}=await import('node:events');
  const child=new EventEmitter();child.stdin={on(){},end(){}};child.stderr=new EventEmitter();child.connected=true;child.pid=1;
  const a=actor('lane',{}, {forkChild:()=>child});
  try{
    const result=a.wait(['read-result','lane-failure']);child.emit('message',{type:'lane-failure',id:'attempt'});
    child.connected=false;child.emit('close',0,null);assert.equal((await result).type,'lane-failure');assert.equal((await a.exited).code,0);
  }finally{child.emit('close',0,null);}
});

}
