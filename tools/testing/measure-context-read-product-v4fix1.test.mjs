// Deterministic review regressions: fabricated clocks, processes and native work.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { AsyncResource } from 'node:async_hooks';
import { performance } from 'node:perf_hooks';
import { spawnSync } from 'node:child_process';
import { readFile,writeFile,symlink,mkdir,readdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { createTestWorkspace } from './workspace.mjs';
import { buildV4Plan,windowSlot } from './fixtures/context-product/v4-plan.mjs';
import { PROTOCOL,availability } from './fixtures/context-product/protocol.mjs';
import { createReportSink } from './fixtures/context-product/report.mjs';
import { checkedSegments } from './fixtures/context-product/v4-checkpoints.mjs';
import { normalDecision } from './fixtures/context-product/v4-windows.mjs';
const base=process.env.P2D_V4FIX1_BASE;
const directory=new URL('./fixtures/context-product/',import.meta.url);
const loop=(maxMs=1)=>({maxMs,over100:maxMs>100?1:0,blocks:[]});
const good=(extra={})=>({ok:true,validated:true,bounds:true,expected:true,elapsedMs:1,readMs:1,telemetry:'complete',hostLoop:loop(),...extra});
const output=()=>({rows:[],async record(cell,series,record){this.rows.push({cell,series,record});},async cell(cell,decision){this.rows.push({type:'cell',cell,decision});},async finish(status,extra){this.final={status,...extra};},async interrupt(){this.interrupted=true;}});
const namespace={ownerId:'owner',scope:'personal',projectId:null};
async function load(name,overrides={},transform=s=>s,context) {
  const url=new URL(name,directory),path=fileURLToPath(url);
  let source;
  if(base){const r=spawnSync('git',['show',base+':'+path.slice(process.cwd().length+1)],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);source=r.stdout;}
  else source=await readFile(url,'utf8');
  if(name==='v4-session.mjs'&&process.env.P2D_V4FIX3_MUTANT==='async-blind')source=source.replace("child.send(START);await child.wait('done');","parentLoop.pause();child.send(START);await child.wait('done');parentLoop.resume();");
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
async function runner(t,{reason,exception=false,priorFailure=false,resumed=[],sessionCell=false,cleanupLost=false,sessionDecision={decision:'passed'},sessionFailureOnResumed=false}={}){
  const plan=buildV4Plan('engine'),cell=sessionCell?plan.find(c=>c.kind==='availability'):exception?plan.find(c=>c.kind==='injection'&&c.injection==='post-catch-up'):plan.find(c=>c.kind==='requests');
  const report=output(),w=createTestWorkspace(t),errors=[];let clock=0,supervise,runs=0,monitorActive=false;
  const context=vm.createContext({process:{version:'v24.15.0',once(){},off(){}},console:{log(){},error:r=>errors.push(r)},Date:{now:()=>clock},setInterval:fn=>{supervise=fn;monitorActive=true;return 1;},clearInterval(){monitorActive=false;}});
  const prior=plan.filter(c=>c!==cell).map(c=>({key:c.key,cell:c,complete:true,decision:'passed'}));
  const actualReport=await import('./fixtures/context-product/report.mjs');
  const mod=await load('v4-runner.mjs',{
    './report.mjs':{...actualReport,createReportSink:async()=>report},
    './v4-checkpoints.mjs':{readSegments:async()=>resumed,checkedSegments:()=>({cells:[...prior,...resumed.flatMap(s=>s.cells)],decision:priorFailure||resumed.some(s=>s.knownFailure)?'failed':'inconclusive'})},
    './v4-session.mjs':{sharedSession:async(group,session,{sink})=>{runs++;assert.equal(monitorActive,false);if(cleanupLost)throw Object.assign(Error(cleanupLost==='pump'?'session_pump_shutdown_unconfirmed_workspace_retained':'descendants_unconfirmed'),{cleanup:{descendantsUnconfirmed:true,...(cleanupLost==='pump'?{pumpUnconfirmed:true}:{})}});if(reason==='projected_overrun')clock=47700001;await sink.record(cell.id,'session-test',{});const target=sessionFailureOnResumed?group.find(c=>c.key!==cell.key).key:cell.key;return new Map(group.map(c=>[c.key,c.key===target?sessionDecision:{decision:'passed'}]));}},
    './v4-state.mjs':{stateCell:async()=>{runs++;await report.record(cell.id,'subprobe',{id:'status',code:null,expected:true});throw Error('interrupted');}},
    './series.mjs':{build:async()=>({coverage:'complete',diagnostics:[]}),requestSeries:async()=>{
      runs++;if(reason){clock=reason==='projected_overrun'?47700001:reason==='stalled_activity'?101:201;
        if(reason==='projected_overrun')await report.record(cell.id,'main',{});
        if(reason==='missing_progress')await report.record(cell.id,'pump',{});
        supervise();}return {decision:{decision:'passed'},languageCoverage:true};}},
  },s=>s,context);
  const input={...registration(plan),volumeRoot:w.path};
  if(sessionCell)input.adapterModule='data:text/javascript,export const validate=()=>true;export const validateProbe=()=>true;';
  const execution=mod.runV4(input,{profile:'engine',segmentId:'first',reportPath:'unused',resume:['checkpoint.jsonl']},{validateRegistration(){},preregister:async()=>({node:'v24.15.0',hardware:{cpus:[]},filesystem:{},corpus:[]}),idleBaseline:async()=>({}),
    prepareCell:async()=>({readSet:[namespace],inspectLedger:async()=>({})}),probeDependencies:async()=>({ready:true}),prepareInput:async c=>c,storage:async()=>({value:{}})});
  if(cleanupLost)await assert.rejects(execution,e=>e.cleanup?.descendantsUnconfirmed===true);else await execution;
  return {report,cell,runs,plan,workspace:w.path,errors};
}
test('round4 unconfirmed cleanup retains both workspace levels and interrupts the leased report',async t=>{const r=await runner(t,{sessionCell:true,cleanupLost:true});const paths=await readdir(r.workspace);assert.equal(paths.length,1);assert.equal((await readdir(join(r.workspace,paths[0]))).length,1);assert.equal(r.report.interrupted,true);assert.equal(r.report.final,undefined);});
test('round4 final session rechecks reservation with every other cell complete',async t=>{const {report}=await runner(t,{sessionCell:true,reason:'projected_overrun'});assert.equal(report.final.stopReason,'projected_overrun');assert.equal(report.final.complete,false);assert.equal(report.final.status,'inconclusive');});
for(const sessionDecision of [{decision:'failed',observedFailure:true},{decision:'failed'},{decision:'invalid',observedFailure:true}])test(`round5 over-budget session retains ${JSON.stringify(sessionDecision)}`,async t=>{
  const {report,cell,plan}=await runner(t,{sessionCell:true,reason:'projected_overrun',sessionDecision});
  assert.equal(report.final.status,'failed');assert.equal(report.final.tally.failed,1);
  assert.equal(report.final.stopReason,'projected_overrun');assert.equal(report.final.complete,false);assert.equal(report.final.segmentComplete,false);assert.equal(report.final.completedCells,plan.length-1);
  const row=report.rows.find(r=>r.type==='cell'&&r.cell.key===cell.key);assert.equal(row.decision.decision,'failed');assert.equal(row.decision.complete,false);
  assert.ok(report.rows.some(r=>r.series==='checkpoint'&&r.record.cellKey===cell.key&&r.record.complete===false&&r.record.decision.decision==='failed'));
});
test('round5 over-budget session retains a new failure for a resumed sibling',async t=>{
  const {report}=await runner(t,{sessionCell:true,reason:'projected_overrun',sessionDecision:{decision:'failed',observedFailure:true},sessionFailureOnResumed:true});
  assert.equal(report.final.status,'failed');assert.equal(report.final.tally.failed,1);assert.equal(report.final.complete,false);
});
test('round5 unconfirmed pump shutdown retains both workspace levels and reports retention',async t=>{
  const r=await runner(t,{sessionCell:true,cleanupLost:'pump'}),paths=await readdir(r.workspace);
  assert.equal(paths.length,1);assert.equal((await readdir(join(r.workspace,paths[0]))).length,1);assert.equal(r.report.interrupted,true);assert.equal(r.report.final,undefined);
  const failure=r.errors.map(JSON.parse).find(r=>r.workspaceRetained);assert.equal(failure.status,'failed');assert.equal(failure.cleanup.pumpUnconfirmed,true);assert.match(failure.reason,/workspace_retained/);
});
test('round3 runner suspends parent harness supervision while the session owns the journal',async t=>{const {report,runs}=await runner(t,{sessionCell:true});assert.equal(runs,1);assert.equal(report.final.status,'passed');assert.equal(report.final.complete,true);});
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
  const {readSegments}=await load('v4-checkpoints.mjs'),segments=await readSegments([path]);assert.equal(segments[0].cells.length,plan.length-1);assert.ok(segments[0].cells.every(c=>c.key!==cell.key));assert.equal(segments[0].knownFailure,true);
  const rerun=await runner(t,{exception:true,resumed:segments});assert.equal(rerun.runs,1);assert.equal(rerun.report.final.status,'failed');
});
function header(cell){return {protocol:{version:'P2-product-v4'},segmentId:'first',registrationHash:'registered',host:{id:'host'},volume:{id:'volume'},node:'v24.15.0',segments:[{id:'first',cellKeys:[cell.key]}],inventory:[cell],cellCount:1};}
async function round6Recovery(paths){
  // Current runs exercise the SQLite-free child; counterfactuals load that same
  // reader from Git, leaving the worktree and report-writing code unchanged.
  const {readSegments}=base?await load('v4-checkpoint-child.mjs',{},s=>s.slice(0,s.indexOf('\ntry{console.log'))+'\nexport {readSegments};'):await import('./fixtures/context-product/v4-checkpoints.mjs');
  return readSegments(paths);
}
for(const boundary of ['cell','checkpoint'])test(`round6 availability budget-stop failure survives interruption after ${boundary} and a passing retry`,async t=>{
  const cell=buildV4Plan('engine').find(c=>c.kind==='availability'),h=header(cell),w=createTestWorkspace(t);
  const records=Array.from({length:100},(_,i)=>good({method:'findCandidates',scheduled:true,intent:cell.intent,...(i<2?{ok:false,notReady:true,code:'index_unavailable'}:{})}));
  const metric=availability(records);assert.equal(metric.fraction,.02);assert.equal(metric.decision,'failed');
  const verdict=normalDecision(cell,records,{availability:metric});assert.equal(verdict.decision,'failed');assert.equal(verdict.observedFailure,true);
  const path=join(w.path,'stopped.jsonl'),sink=await createReportSink(path,h);
  for(const r of records)await sink.record(cell.id,'availability',r);
  const incomplete={...verdict,complete:false,key:cell.key};await sink.cell(cell,incomplete);
  if(boundary==='checkpoint')await sink.record(cell.id,'checkpoint',{complete:false,cellKey:cell.key,decision:incomplete});
  await sink.interrupt(); // No final marker; even the cell/journal gap is recoverable.
  assert.equal((await readFile(path+'.partial','utf8')).includes('"type":"final"'),false);
  const passingRecords=records.map(r=>({...r,ok:true,notReady:false,code:null}));
  const passing=normalDecision(cell,passingRecords,{availability:availability(passingRecords)});assert.equal(passing.decision,'passed');
  const retry=join(w.path,'retry.jsonl'),next=await createReportSink(retry,h);
  for(const r of passingRecords)await next.record(cell.id,'availability',r);
  await next.cell(cell,{...passing,complete:true});await next.finish('passed');
  const segments=await round6Recovery([path+'.partial',retry]);
  assert.equal(segments[0].knownFailure,true);assert.deepEqual(segments[0].cells,[]);
  const merged=checkedSegments(h,segments);assert.equal(merged.decision,'failed');assert.equal(merged.complete,true);assert.deepEqual(merged.cells,segments[1].cells);
  const resumed=await runner(t,{sessionCell:true,resumed:[segments[0]]});assert.equal(resumed.runs,1);assert.equal(resumed.report.final.status,'failed');
});
const round6Verdicts=[{decision:'failed'},{decision:'invalid',observedFailure:true},{decision:'inconclusive',observedFailure:true}];
for(const kind of ['cell','checkpoint'])for(const verdict of round6Verdicts)test(`round6 ${kind} independently latches ${JSON.stringify(verdict)} without merging incomplete evidence`,async t=>{
  const cell={id:0,key:'T',kind:'injection'},w=createTestWorkspace(t),path=join(w.path,'verdict.jsonl'),sink=await createReportSink(path,header(cell));
  const decision={...verdict,complete:false};
  if(kind==='cell')await sink.cell(cell,decision,{samples:['must-rerun']});else await sink.record(cell.id,'checkpoint',{complete:false,decision});
  await sink.interrupt();const [segment]=await round6Recovery([path+'.partial']);assert.equal(segment.knownFailure,true);assert.deepEqual(segment.cells,[]);
});
const round6JournalFailures=[
  ['pair',{decision:{decision:'failed'}}],['WM-evidence',{decisions:[{decision:'invalid',observedFailure:true}]}],
  ['session-validation',{decision:'failed'}],['exposure-final',{decision:'failed'}],
  ['resumed-checkpoints',{retainedDecisions:['passed','failed']}],['failure',{code:'harness_failed'}],
  ['lane-failure',{code:'lane_failed'}],['session-supervision',{code:'session_progress_timeout'}],['capability',{ready:false,blocked:false,code:'dependency_failed'}],
];
for(const [series,record] of round6JournalFailures)test(`round6 audit retains interrupted ${series} failure`,async t=>{
  const cell={id:0,key:'audit',kind:'requests'},w=createTestWorkspace(t),path=join(w.path,'journal.jsonl'),sink=await createReportSink(path,header(cell));
  await sink.record(cell.id,series,record);await sink.interrupt();const [segment]=await round6Recovery([path+'.partial']);assert.equal(segment.knownFailure,true);assert.deepEqual(segment.cells,[]);
});
test('round6 audit retains final failure and observed failure in a complete cell',async t=>{
  const cell={id:0,key:'complete',kind:'requests'},w=createTestWorkspace(t);
  for(const complete of [false,true]){
    const path=join(w.path,String(complete)+'.jsonl'),sink=await createReportSink(path,header(cell));
    if(complete)await sink.cell(cell,{decision:'invalid',observedFailure:true,complete:true});
    await sink.finish(complete?'invalid':'failed');const [segment]=await round6Recovery([path]);assert.equal(segment.knownFailure,true);assert.equal(segment.cells.length,Number(complete));
  }
});
test('round6 nonfailure incomplete verdicts and blocked capabilities remain rerunnable without a failure latch',async t=>{
  const cell={id:0,key:'control',kind:'requests'},w=createTestWorkspace(t),path=join(w.path,'control.jsonl'),sink=await createReportSink(path,header(cell));
  for(const decision of ['passed','invalid','inconclusive']){
    const value={decision,observedFailure:false,complete:false};await sink.cell(cell,value);await sink.record(cell.id,'checkpoint',{decision:value});
  }
  await sink.record(cell.id,'resumed-checkpoints',{retainedDecisions:['passed','invalid','inconclusive']});
  await sink.record(cell.id,'capability',{ready:false,blocked:['missing-capability']});await sink.interrupt();
  const [segment]=await round6Recovery([path+'.partial']);assert.equal(segment.knownFailure,false);assert.deepEqual(segment.cells,[]);
});
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
async function percentileCheckpoint(t,cell,rows,{boundary=false}={}){
  const w=createTestWorkspace(t),h=header(cell),path=join(w.path,'interrupted.jsonl'),sink=await createReportSink(path,h);
  for(const [series,record] of rows)await sink.record(cell.id,series,record);
  if(boundary)await sink.record(cell.id+1,'main',good());await sink.interrupt();
  const {readSegments}=await load('v4-checkpoint-child.mjs',{},s=>s.slice(0,s.indexOf('\ntry{console.log'))+'\nexport {readSegments};');
  const [segment]=await readSegments([path+'.partial']);
  const faster={...segment,cells:[{key:cell.key,cell,complete:true,decision:'passed'}],knownFailure:false};
  return {failed:segment.knownFailure,merged:checkedSegments(h,[segment,faster]).decision};
}
const percentileCases=[
  ['candidate main 1112','requests','findCandidates','main',1112,50,800],
  ['candidate main 3336','requests','findCandidates','main',3336,50,1100],
  ['candidate cold','requests','findCandidates','cold',1112,10,800],
  ['assembly main','requests','contextRead','main',1112,50,900],
  ['assembly cold','requests','contextRead','cold',1112,10,900],
  ['fetch main','requests','fetchCandidateEvidence','main',1112,50,200],
  ['fetch cold','requests','fetchCandidateEvidence','cold',1112,10,200],
  ['overflow main','overflow','findCandidates','main',1112,50,800],
  ['idle reference','requests','findCandidates','warm-reference',1112,50,350],
  ['WM reference','exposure','findCandidates','WM',1112,50,350],
  ['restored reader','backup',undefined,'restored-reader',1112,1,800],
];
for(const [name,kind,method,series,count,n,ms] of percentileCases)test(`round2 interrupted ${name} completed p95 survives a faster resume`,async t=>{
  const cell={id:0,key:name,kind,method,count,load:'idle'};
  const record=good({methodLabel:series==='WM'?'c12':undefined,intent:'current',elapsedMs:['warm-reference','WM'].includes(series)?1:ms,readMs:ms});
  const r=await percentileCheckpoint(t,cell,Array.from({length:n},()=>[series,record]));
  assert.equal(r.failed,true);assert.equal(r.merged,'failed');
});
test('round2 completed p95 is retained at a cell boundary as well as EOF',async t=>{
  const cell={id:0,key:'boundary',kind:'requests',method:'findCandidates',count:1112};
  assert.equal((await percentileCheckpoint(t,cell,Array.from({length:50},()=>['main',good({elapsedMs:800})]),{boundary:true})).failed,true);
});
for(const overlap of [false,true])test(`round2 completed loaded p95 uses final overlap ${overlap}`,async t=>{
  const cell={id:0,key:'loaded',kind:'requests',method:'findCandidates',count:1112,load:'fresh-same'};
  const rows=Array.from({length:50},()=>['main',good({elapsedMs:800,overlap:false})]);
  rows.push(...Array.from({length:50},(_,index)=>['overlap-final',{series:'main',index,overlap}]));
  assert.equal((await percentileCheckpoint(t,cell,rows)).failed,overlap);
});
test('round2 incomplete and failed attempts do not complete a percentile population',async t=>{
  const cell={id:0,key:'short',kind:'requests',method:'findCandidates',count:1112};
  const rows=Array.from({length:49},()=>['main',good({elapsedMs:800})]);rows.push(['main',good({ok:false,code:'read_timeout',elapsedMs:1})]);
  assert.equal((await percentileCheckpoint(t,cell,rows)).failed,false);
});
test('round2 prefix percentile failures are evaluated on the final population',async t=>{
  const cell={id:0,key:'prefix',kind:'requests',method:'findCandidates',count:1112};
  const rows=Array.from({length:100},(_,i)=>['main',good({elapsedMs:i<3?800:1})]);
  assert.equal((await percentileCheckpoint(t,cell,rows)).failed,false);
});
test('round2 WM keeps method and intent percentiles separate',async t=>{
  const cell={id:0,key:'WM',kind:'exposure',count:1112,load:'fresh-same'};
  const rows=['c12','c24'].flatMap(methodLabel=>['current','history'].flatMap(intent=>Array.from({length:50},()=>['WM',good({methodLabel,intent,elapsedMs:1,readMs:methodLabel==='c12'&&intent==='current'?350:1})])));
  assert.equal((await percentileCheckpoint(t,cell,rows)).failed,true);
  const incomplete=rows.filter(([,r])=>r.methodLabel==='c24'||r.intent==='history').concat(rows.filter(([,r])=>r.methodLabel==='c12'&&r.intent==='current').slice(0,49));
  assert.equal((await percentileCheckpoint(t,cell,incomplete)).failed,false);
});
test('round2 completed freshness percentile survives interruption and resume',async t=>{
  const cell={id:0,key:'F',kind:'freshness',count:1112,type:'memory',intent:'current'};
  const targets=Array.from({length:100},(_,i)=>({type:'memory',id:'target-'+i,revision:1,intent:'current',committedAt:0,observedAt:31000}));
  const r=await percentileCheckpoint(t,cell,[['freshness-targets',targets]]);assert.equal(r.failed,true);assert.equal(r.merged,'failed');
  assert.equal((await percentileCheckpoint(t,cell,[['freshness-targets',targets.slice(0,99)]])).failed,false);
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
async function runSession({blockAt,failure,afterAwait=false,attribution='complete',probe=false,concurrentEngine=false,synchronousEngine=false,realPump=false}={}){
  const {sharedSession}=await load('v4-session.mjs'),{sessionWork}=await import('./fixtures/context-product/v4-session-work.mjs'),{observeLoop}=await import('./fixtures/context-product/engine.mjs');
  const session=sessionFixture(),report=output(),lanes=[];let clock=0,parentClock=0,pumpStopped=false,writerStopped=false,finished=false,sampled=false,samplerStopped=false,validateCalls=0,engineCallback;
  if(probe)session.batches=[{ordinal:0,query:'frozen'}];
  const target={targetId:'m0',type:'memory',id:'m0',revision:1,namespace,batch:0,intent:'history',committedAt:50};
  const structural=!base;let childClock=0;
  report.delegate=async()=>({path:'unused',sequence:0});report.reclaim=async()=>{};
  let targetSent=false;
  const originalRecord=report.record;
  report.record=async function(...args){if(afterAwait)await Promise.resolve();if(blockAt==='harness-record')parentClock+=150;return originalRecord.apply(this,args);};
  const block=phase=>{if(blockAt===phase){if(structural&&phase.startsWith('harness-')&&phase!=='harness-pump-setup')childClock+=150;else parentClock+=150;}};
  const cells=['current','history'].map(intent=>({id:0,key:intent,kind:'availability',intent,canonical:'WAL',sidecar:'WAL',schema:18}));
  const config={protocol:'P2-product-v4',pump:{cronMs:1000,budgets:{},quantum:{}},cell:cells[0],supervision:{stallMs:1000},maintainerCoverage:'complete',maintainerDiagnostics:[{coverage:'complete',busy:0}]};
  const harnessCallbacks={config,sink:report,prepareInput:async c=>{if(afterAwait)await Promise.resolve();block('harness-validation');if(concurrentEngine&&!structural)await engineCallback();return {...c,input:c.cell.kind==='freshness'?{query:'frozen'}:{}};},validateProbe:async()=>{validateCalls++;if(afterAwait)await Promise.resolve();block('harness-probe');return true;}};
  const dependencies={
    now:()=>clock,wait:async ms=>{
      if(realPump&&ms===1){const next=session.availability.find(s=>s.releaseMs>clock-50)?.releaseMs??180000;clock+=Math.min(100,Math.max(1,next-(clock-50)-5));}
      else clock+=ms;
    },loopFactory:()=>{
      const observed=observeLoop({timers:false,now:()=>parentClock});return {...observed,async finish(){const r=await observed.finish();finished=true;return r;}};
    },
    makeSampler:async pids=>{assert.deepEqual(pids,[process.pid]);sampled=true;return {async collect(){assert.fail('sampler transfer during observation');},async stop(){
      assert.equal(finished,true);samplerStopped=true;if(attribution==='failed')throw Error('sampler_exit');
      const sample=(at,n)=>({pid:process.pid,at,threads:[{tid:process.pid,runtimeNs:n*10,runqueueNs:n*20,slices:n},{tid:123,runtimeNs:n*30,runqueueNs:n*40,slices:n}],vm:{pswpin:n,pswpout:n*2,pgmajfault:n*3}});
      const samples=attribution==='unsupported'||attribution==='missing'?[]:[sample(performance.timeOrigin-1,1),sample(performance.timeOrigin+parentClock+1,2)];
      if(attribution==='missing-main')for(const sample of samples)sample.threads=sample.threads.filter(t=>t.tid!==process.pid);
      return {supported:attribution!=='unsupported',coverage:attribution==='dropped'?'incomplete':'complete',dropped:attribution==='dropped'?1:0,samples};
    }};},
    makeLane:()=>{
      const queue=[],waiters=[];let exit;const exited=new Promise(r=>{exit=r;});
      const send=m=>{const i=waiters.findIndex(w=>Array.isArray(w.type)?w.type.includes(m.type):w.type===m.type);if(i>=0)waiters.splice(i,1)[0].resolve(m);else queue.push(m);};
      const lane={pid:lanes.length+1,connected:true,exited,stopped:false,send(m){
        if(m.type==='read'){
          JSON.stringify(m);block('harness-serialization');
          if(failure==='rejected-wait'){for(const w of waiters.splice(0))w.reject(Error('attempt_rejected'));lane.reject=true;}
          else if(failure==='lane-failure')send({type:'lane-failure',id:m.id,code:'sampler_failed'});
          else send({type:'read-result',id:m.id,value:{record:good({startedAt:clock,readStartedAt:clock,readFinishedAt:clock+1}),result:{value:{items:[{ref:{type:'memory',memoryId:'m0',revision:1,namespace}}]}}}});
        }else if(m.type==='stop'){block('lane-stop');lane.connected=false;lane.stopped=true;send({type:'result',attribution:{}});exit({code:0,signal:null});}
      },wait(type){if(type==='ready')return Promise.resolve({startupLoop:loop()});if(lane.reject)return Promise.reject(Error('attempt_rejected'));
        const i=queue.findIndex(m=>Array.isArray(type)?type.includes(m.type):m.type===type);return i>=0?Promise.resolve(queue.splice(i,1)[0]):new Promise((resolve,reject)=>waiters.push({type,resolve,reject}));}};
      lanes.push(lane);return lane;
    },
    makePump:async(config,write,{harness=fn=>fn()}={})=>{
      if(realPump){
        const engineModule=await import('./fixtures/context-product/engine.mjs');
        const context=vm.createContext({process,Date,setInterval:()=>1,clearInterval(){}});
        const nativePump={completion:new Promise(()=>{}),getStatus:()=>({}),async close(){await Promise.resolve();block('pump-stop');}};
        const {startPump}=await load('series.mjs',{
          './engine.mjs':{...engineModule,configure:async()=>{await Promise.resolve();block('harness-pump-setup');return {token:{},options:{},supervisor:{async drain(){await Promise.resolve();block('pump-drain');return [];},ackCleanup(){},async close(){await Promise.resolve();block('pump-supervisor-stop');}}};}},
          '../../../../core/index.mjs':{renewContextMaintenancePump:()=>{block('pump-renewal');return nativePump;}},
        },s=>s,context);
        const pump=await startPump(config,write,{harness});
        return {...pump,async stop(){const drained=await pump.stop();pumpStopped=true;return [...drained,{diagnostics:{protocol:'context-native-v1',coverage:'complete',busy:0}}];}};
      }
      // Created in the engine scope. Delivery while preparation is awaiting must
      // remain observed, independently of that harness Promise's lifetime.
      const resource=new AsyncResource('fixture-engine');
      engineCallback=()=>resource.runInAsyncScope(()=>{if(synchronousEngine){parentClock+=150;return Promise.resolve();}return Promise.resolve().then(()=>{parentClock+=150;});});
      return {async flush(){if(afterAwait)await Promise.resolve();block('pump-renewal');},async stop(){if(afterAwait)await Promise.resolve();block('pump-stop');pumpStopped=true;resource.emitDestroy();return [{diagnostics:{protocol:'context-native-v1',coverage:'complete',busy:0}}];}};
    },
    makeWriter:async()=>{let startAt,endAt;return {child:{take:()=>{if(!probe||targetSent)return [];targetSent=true;return [{target}];}},flush(){},start(s,e){startAt=s;endAt=e;},async stop(){writerStopped=true;await Promise.resolve();block('harness-writer-bookkeeping');
      const calls=[0,179990].map((offset,k)=>({id:k,ordinaryOrdinal:k,streamKind:'ordinary',operation:k?'review':'capture',lifecycle:'fresh',writerTarget:'same',nativeCommit:true,startedAt:startAt+offset,
        cycleStartedMono:offset,openStartedAt:startAt+offset+1,openFinishedAt:startAt+offset+2,writeStartedAt:startAt+offset+3,writeFinishedAt:startAt+offset+4,closeStartedAt:startAt+offset+5,closeFinishedAt:startAt+offset+6,finishedAt:startAt+offset+6,deadlineMs:5000,writeElapsedMs:1}));
      return {writerEndAt:endAt,calls,hostLoop:loop(),exit:{code:0,signal:null},diagnostics:{coverage:'complete',busy:0,records:[]},pacing:[0,179990].map((offset,ordinal)=>({ordinal,startedMono:offset,workFinishedMono:offset+6,delayMs:14,resumedMono:offset+20}))};}};},
  };
  // The coordinator double has its own harness clock and represents a separate
  // process. Parent engine callbacks use parentClock even while that child waits.
  dependencies.preparePump=async()=>{
    const prepared=structural&&realPump?await (async()=>{
      const engineModule=await import('./fixtures/context-product/engine.mjs');
      const {prepareSessionPump}=await load('v4-session-pump.mjs',{
        './engine.mjs':{...engineModule,configure:async()=>{await Promise.resolve();block('harness-pump-setup');return {token:{},options:{},supervisor:{async drain(){await Promise.resolve();block('pump-drain');return [];},ackCleanup(){},async close(){await Promise.resolve();block('pump-supervisor-stop');}}};}},
        '../../../../core/index.mjs':{renewContextMaintenancePump:()=>{block('pump-renewal');return {completion:new Promise(()=>{}),getStatus:()=>({}),async close(){await Promise.resolve();block('pump-stop');}};}},
      },s=>s,vm.createContext({process,Date,setInterval:()=>1,clearInterval(){}}));
      return prepareSessionPump(config);
    })():null;
    const pump=prepared?null:await dependencies.makePump(config,async()=>{});
    return {start(){
      const active=prepared?prepared.start():pump;
      if(concurrentEngine)void engineCallback();
      else if(!realPump)void active.flush();
      return {async stop(){const r=await active.stop();pumpStopped=true;return r;}};
    },report:async()=>[]};
  };
  dependencies.makeSession=encoded=>{
    const payload=JSON.parse(encoded),queue=[],waiters=[];let resolveStart,resolveExit;
    const start=new Promise(r=>{resolveStart=r;}),exited=new Promise(r=>{resolveExit=r;});
    let value,error;
    const deliver=m=>{const i=waiters.findIndex(w=>Array.isArray(w.type)?w.type.includes(m.type):w.type===m.type);if(i<0)queue.push(m);else waiters.splice(i,1)[0].resolve(m);};
    const child={connected:true,exited,send(m){assert.ok(['start','export'].includes(m));assert.ok(Buffer.byteLength(JSON.stringify(m))<=8);
      if(m==='start')resolveStart();
      else {assert.equal(finished,true);deliver({type:'result',value,error});child.connected=false;resolveExit({code:0,signal:null});}
    },wait(type){const i=queue.findIndex(m=>Array.isArray(type)?type.includes(m.type):m.type===type);return i<0?new Promise(resolve=>waiters.push({type,resolve})):Promise.resolve(queue.splice(i,1)[0]);}};
    const childReport={async record(...args){if(afterAwait)await Promise.resolve();block('harness-record');return originalRecord.apply(report,args);}};
    void sessionWork(payload.cells,payload.session,{...harnessCallbacks,sink:childReport},{...dependencies,ready:async()=>deliver({type:'ready'}),start:()=>start})
      .then(r=>{value=r;},e=>{error=e.code??e.message;}).finally(()=>deliver({type:'done'}));
    return child;
  };
  const promise=sharedSession(cells,session,harnessCallbacks,dependencies);
  return {promise,report,lanes,clocks:()=>({parentClock,childClock}),coverage:()=>({sampled,samplerStopped,validateCalls}),drained:()=>pumpStopped&&writerStopped&&lanes.every(l=>l.stopped)};
}
for(const synchronousEngine of [true,false])test(`round3 ${synchronousEngine?'synchronous callback body':'async engine continuation'} records 150 ms`,async()=>{
  const r=await runSession({afterAwait:true,concurrentEngine:true,synchronousEngine});const ds=await r.promise;
  const observed=r.report.rows.find(r=>r.series==='session-parent-loop').record.hostLoop;
  assert.ok(observed.maxMs>=150);assert.ok(observed.over100>0);
  for(const d of ds.values())assert.equal(d.decision,'failed');assert.equal(r.drained(),true);
});
test('round3 variable lane serialization occurs in child outside parent observation',async()=>{
  const r=await runSession({blockAt:'harness-serialization',afterAwait:true});const ds=await r.promise;
  const observed=r.report.rows.find(r=>r.series==='session-parent-loop').record.hostLoop;
  assert.equal(observed.maxMs,0);assert.ok(r.clocks().childClock>=150);for(const d of ds.values())assert.equal(d.decision,'passed');assert.equal(r.drained(),true);
});
for(const blockAt of [undefined,'harness-validation','pump-renewal','pump-stop','lane-stop'])test(`shared-session parent loop includes ${blockAt??'healthy control'} through final drain`,async()=>{
  const r=await runSession({blockAt}),ds=await r.promise;assert.equal(r.drained(),true);const engineBlock=blockAt&&blockAt!=='harness-validation';
  for(const d of ds.values())assert.equal(d.decision,engineBlock?'failed':'passed',JSON.stringify(d));
  if(engineBlock){const observed=r.report.rows.find(r=>r.series==='session-parent-loop').record.hostLoop;assert.equal(observed.maxMs>100,true);}
});
for(const blockAt of ['harness-validation','harness-record','harness-probe','harness-writer-bookkeeping'])test(`round2 async ${blockAt} stays outside the parent loop`,async()=>{
  const r=await runSession({blockAt,afterAwait:true,probe:blockAt==='harness-probe'}),ds=await r.promise;
  const observed=r.report.rows.find(r=>r.series==='session-parent-loop').record.hostLoop;
  assert.equal(observed.maxMs,0);assert.equal(observed.over100,0);assert.equal(r.drained(),true);
  if(blockAt==='harness-probe')assert.ok(r.coverage().validateCalls>0);
  else for(const d of ds.values())assert.equal(d.decision,'passed',JSON.stringify(d));
});
for(const blockAt of ['pump-renewal','pump-stop'])test(`round2 async engine ${blockAt} remains observed`,async()=>{
  const r=await runSession({blockAt,afterAwait:true}),ds=await r.promise;
  for(const d of ds.values())assert.equal(d.decision,'failed');assert.equal(r.drained(),true);
});
test('round2 engine callback delivered during async harness preparation stays observed',async()=>{
  const r=await runSession({afterAwait:true,concurrentEngine:true}),ds=await r.promise;
  for(const d of ds.values())assert.equal(d.decision,'failed');assert.equal(r.drained(),true);
});
for(const blockAt of ['harness-pump-setup','pump-renewal','pump-drain','pump-stop','pump-supervisor-stop'])test(`round2 real pump helper isolates ${blockAt}`,async()=>{
  const r=await runSession({blockAt,realPump:true}),ds=await r.promise;
  const engineBlock=blockAt!=='harness-pump-setup';
  for(const d of ds.values())assert.equal(d.decision,engineBlock?'failed':'passed',JSON.stringify(d));
  const observed=r.report.rows.find(r=>r.series==='session-parent-loop').record.hostLoop;
  assert.equal(observed.maxMs>100,engineBlock);assert.equal(r.drained(),true);
});
for(const attribution of ['complete','unsupported','missing','dropped','missing-main','failed'])test(`round2 parent scheduling attribution ${attribution} is collected after finish`,async()=>{
  const r=await runSession({blockAt:'pump-stop',attribution});await r.promise;
  assert.deepEqual(r.coverage(),{sampled:true,samplerStopped:true,validateCalls:0});
  const record=r.report.rows.find(r=>r.series==='session-parent-loop').record;
  assert.equal(record.hostPid,process.pid);assert.ok(record.hostLoop.blocks.length>0);
  for(const block of record.hostLoop.blocks){
    assert.equal(block.scheduling.coverage,attribution==='complete'?'complete':'incomplete');
    if(attribution==='complete'){
      assert.deepEqual(block.scheduling.threads.map(t=>t.runqueueNs),[20,40]);
      assert.deepEqual(block.scheduling.vm,{pswpin:1,pswpout:2,pgmajfault:3});
    }
  }
  assert.ok(r.report.rows.some(r=>r.series==='session-parent-attribution'));assert.equal(r.drained(),true);
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
