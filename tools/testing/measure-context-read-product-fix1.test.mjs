import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { PassThrough } from 'node:stream';
import { readFile, writeFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createTestWorkspace } from './workspace.mjs';
import { PROTOCOL, V3_DEFINITION, buildPlan, expandPlan, estimatePlan, decide, freshness } from './fixtures/context-product/protocol.mjs';
import { availabilitySeries, freshnessSeries, backupSeries, prepareInput, requireOverflow, ingestTargets, preregister, runRegistered, validateRegistration } from './measure-context-read-product.mjs';
import { requestSeries } from './fixtures/context-product/series.mjs';
import { actor, terminate, attributeBlocks } from './fixtures/context-product/actors.mjs';
import { createSampleBuffer, createSamplerSession } from './fixtures/context-product/io-child.mjs';
import { attempt, observeLoop, selectReadSet } from './fixtures/context-product/engine.mjs';
import { startWriter } from './fixtures/context-product/controller.mjs';
import { freshnessTarget, shutdownRetained } from './fixtures/context-product/writer.mjs';
import { createWriterJournal, createWriterLedger, observedDatabase } from './fixtures/context-product/writer-journal.mjs';
import { createReportSink } from './fixtures/context-product/report.mjs';
import { summarize } from './summarize-context-read-product.mjs';
const namespace={ownerId:'synthetic',scope:'personal',projectId:null};
const loop=(maxMs=1)=>({maxMs,over100:maxMs>100?1:0,blocks:[]});
const good=()=>({ok:true,validated:true,bounds:true,expected:true,overlap:true,elapsedMs:1,readMs:1,
  readStartedAt:1,readFinishedAt:2,hostLoop:loop(),telemetry:'complete',nativeBusy:0,publicBusy:0,code:null});
const diagnostic=(coverage='complete',busy=0)=>({protocol:'context-native-v1',coverage,busy});
const cell={id:0,kind:'requests',count:1112,schema:23,method:'contextRead',intent:'history',canonical:'WAL',sidecar:'WAL',scope:'launch',load:'idle',type:'memory'};
const config=()=>({cell,method:cell.method,types:['memory','card'],...selectReadSet([namespace],'test'),namespace,deadlines:{openMs:5000,requestMs:5000,readMs:5000},
  input:{readSet:[namespace],types:['memory','card'],intent:'history',budget:{maxTokens:1500,maxItems:12},deadlineMs:5000},
  production:true,maintainerCoverage:'complete',maintainerDiagnostics:[diagnostic()],seriesCeilingMs:60000,ledger:{memory:[],cards:[]}});
const writerResult=max=>({diagnostics:{coverage:'complete',busy:0},hostLoop:loop(max),calls:['capture','review'].map(operation=>({operation,deadlineMs:5000,writeElapsedMs:1,writeStartedAt:0,writeFinishedAt:100,elapsedMs:1}))});
const probes=Array.from({length:100},(_,i)=>'uniquelexicalprobe'+String(i).padStart(4,'0'));
const seriesInput={availabilityWindows:1,freshnessObservationMs:60000,probes:{'1112:23:memory:history':probes}};
const sink=()=>({rows:[],async record(cell,series,record){this.rows.push({cell,series,record});}});
const pump=()=>({async flush(){},async stop(){return [{diagnostics:diagnostic()}];}});

test('S1 request path never restores incomplete maintainer coverage from configuration',async()=>{
  const c={...cell,load:'fresh-same'},report=sink(),result=writerResult(1);
  const r=await requestSeries(config(),{cell:c,sink:report},{
    startPump:async()=>({...pump(),async stop(){return [{diagnostics:diagnostic('incomplete')}];}}),
    startWriter:async()=>({child:{pid:10},calls:result.calls,start(){},flush(){},async stop(){return result;}}),
    startSampler:async()=>({async collect(){return [];},async stop(){return {};}}),
    attempt:async()=>({record:good()}),coldAttempt:async()=>({record:good()}),
  });
  assert.equal(r.decision.decision,'invalid');assert.ok(r.decision.invalid.includes('telemetry'));
});

test('S2/T1 sampler stays silent during observations, bounds storage and waits for transfer callbacks',async()=>{
  const b=createSampleBuffer({capacity:3,batchSize:1}),sent=[];let observed=true,ack;
  const send=async message=>{assert.equal(observed,false);sent.push(message);await new Promise(r=>{ack=r;});};
  for(let i=0;i<10;i++)b.push({pid:1,at:i});
  assert.deepEqual(sent,[]);observed=false;
  const draining=b.flush(send);assert.equal(sent.length,1);
  // A pending callback is the rendezvous: no later batch can be dispatched.
  for(let i=1;i<=4;i++){assert.equal(sent.length,i);ack();await Promise.resolve();await Promise.resolve();}
  await draining;
  assert.equal(sent.filter(m=>m.type==='samples').flatMap(m=>m.samples).length,3);
  assert.deepEqual(sent.at(-1),{type:'sample_coverage',missing:0,dropped:7});
});

test('S12/T2 IPC error cannot resolve exit or let termination return before confirmed close',async()=>{
  const fake=new EventEmitter();Object.assign(fake,{pid:123,exitCode:null,signalCode:null,connected:true,stdin:new PassThrough(),stderr:new PassThrough()});
  let killed=false;fake.kill=()=>{killed=true;return true;};
  const child=actor('fake',{}, {forkChild:()=>fake});let exited=false,terminated=false;
  child.exited.then(()=>{exited=true;});
  const waiter=child.wait('result');fake.emit('error',Error('ipc_failure'));await assert.rejects(waiter,/ipc_failure/);
  const stopping=terminate(child).then(()=>{terminated=true;});await Promise.resolve();
  assert.equal(exited,false);assert.equal(terminated,false);assert.equal(killed,true);
  fake.signalCode='SIGKILL';fake.connected=false;fake.emit('close',null,'SIGKILL');await stopping;
  assert.equal(exited,true);assert.equal(terminated,true);
});

for(const kind of ['availability','freshness'])test(`S3/T5 ${kind} includes writer absolute loop gate`,async()=>{
  for(const maximum of [1,101]) {
    let n=0,clock=0,delivered=false;const report=sink();
    const writer={child:{take(){if(delivered)return [];delivered=true;return probes.map((probe,i)=>({target:{type:'memory',id:String(i),revision:2,probe,committedAt:0}}));}},start(){},flush(){},async stop(){return writerResult(maximum);}};
    const deps={now:()=>clock,startPump:async()=>pump(),startWriter:async()=>writer,
      attempt:async c=>{n++;if(n===100)clock=30000;return {record:good(),result:{ok:true,value:{items:[{ref:{type:'memory',memoryId:String(probes.indexOf(c.input.query)),revision:2}}]}}};}};
    const d=kind==='availability'?await availabilitySeries(config(),cell,seriesInput,report,undefined,deps):await freshnessSeries(config(),cell,seriesInput,report,deps);
    assert.equal(d.checks.loop,maximum===1);assert.equal(d.decision,maximum===1?'passed':'failed');
  }
});

for(const kind of ['availability','freshness'])test(`T3 ${kind} writer startup rejection stops acquired pump`,async()=>{
  let stopped=0;const report=sink(),deps={startPump:async()=>({...pump(),async stop(){stopped++;return [];}}),startWriter:async()=>{throw Error('arming_failed');}};
  await assert.rejects(kind==='availability'?availabilitySeries(config(),cell,seriesInput,report,undefined,deps):freshnessSeries(config(),cell,seriesInput,report,deps),/arming_failed/);
  assert.equal(stopped,1);assert.equal(report.rows.at(-1).series,'pump-drain');
});

test('S4 backup restored reader applies every normal acceptance gate and incomplete rebuild invalidates',async()=>{
  for(const [patch,coverage,decision] of [
    [{},'complete','passed'],[{bounds:false},'complete','failed'],[{validated:false},'complete','failed'],
    [{expected:false},'complete','failed'],[{hostLoop:loop(101)},'complete','failed'],
    [{launcherLoop:loop(101)},'complete','failed'],[{lateSuccess:true},'complete','failed'],
    [{overshootMs:51},'complete','failed'],[{nativeBusy:1},'complete','failed'],[{publicBusy:1},'complete','failed'],
    [{telemetry:'incomplete'},'complete','invalid'],[{},'incomplete','invalid'],
    [{elapsedMs:2001},'complete','failed'],
  ]) {
    const d=await backupSeries(config(),cell,{path:'.'},sink(),undefined,{
      storage:async()=>({value:{logicalHash:'same',schema:23}}),fileChild:()=>{},stat:async()=>({size:1}),
      build:async()=>({coverage,diagnostics:[{diagnostics:diagnostic(coverage)}]}),
      configure:async()=>({open:async()=>({getContextIndexStatus:async()=>({ok:true,value:{lexical:{state:'ready'}}}),async close(){}}),
        supervisor:{async close(){},async drain(){return [{diagnostics:diagnostic()}];},ackCleanup(){}}}),
      startSampler:async()=>({async stop(){return {coverage:'complete',samples:[{sizes:[{name:'restore-0.sqlite.context-read-product-v1.1.sqlite',bytes:1}]}]};}}),
      attempt:async()=>({record:{...good(),...patch}}),
    });assert.equal(d.decision,decision,JSON.stringify({patch,coverage,d}));
  }
});

test('S5 non-timeout errors delivered after cutoff keep overshoot and fail settlement',async()=>{
  for(const [mode,delivery,overshoot] of [['error',5060,60],['throw',5060,60],['error',5050,50],['success',5060,60]]) {
    let now=0;
    const r=await attempt({...config(),functionalOnly:true},{clock:()=>now,loopFactory:()=>observeLoop({timers:false,now:()=>0}),
      open:async()=>({async contextRead(){now=delivery;if(mode==='throw')throw Object.assign(Error(),{code:'index_unavailable'});return mode==='success'?{ok:true}:{ok:false,error:{code:'index_unavailable'}};},async close(){now+=1000;}}),
      validate:()=>({bounds:true,validated:true}),oracle:()=>true});
    assert.equal(r.record.overshootMs,overshoot); // Cleanup cannot inflate public settlement.
    const d=decide(cell,{records:[r.record],readerCoverage:'complete',maintainerCoverage:'complete',writerCoverage:'complete',baselineCoverage:'complete'});
    assert.equal(d.checks.settlement,overshoot<=50&&mode!=='success');
  }
});

test('S6 adapter substitutions in every registered workload dimension invalidate the cell',async()=>{
  const c=config();c.cell={...cell,method:'contextRead',maxTokens:4000,limit:24};c.input={...c.input,budget:{maxTokens:4000,maxItems:24}};
  for(const [dimension,value] of [['intent','current'],['types',['memory']],['budget',{maxTokens:1500,maxItems:12}],['readSet',[]],['deadlineMs',2000]]) {
    await assert.rejects(prepareInput(c,{prepare:async()=>({input:{...c.input,[dimension]:value},oracleData:{relevant:[],knownMisses:[]}})}),{code:'invalid_cell'});
  }
  await prepareInput(c,{prepare:async()=>({input:c.input,oracleData:{relevant:[],knownMisses:[]}})});
  await assert.rejects(prepareInput({...c,method:'findCandidates',cell:{...cell,method:'findCandidates',limit:24}},
    {prepare:async()=>({input:{...c.input,limit:12},oracleData:{relevant:[],knownMisses:[]}})}),{code:'invalid_cell'});
});

test('S7 ordinary inventory cannot qualify an overflow cell without omissions',()=>{
  const ordinary=selectReadSet([namespace,...['a','b','c'].map(projectId=>({...namespace,scope:'project',projectId}))],'s');
  assert.throws(()=>requireOverflow(ordinary),{code:'invalid_cell'});
  const c={...cell,scope:'overflow'};
  assert.equal(decide(c,{records:[good()],ownerCoverage:ordinary.ownerCoverage}).decision,'invalid');
  const overflow=selectReadSet([namespace,...Array.from({length:32},(_,i)=>({...namespace,scope:'project',projectId:String(i)}))],'s');
  assert.equal(overflow.ownerCoverage.omittedNamespaces,1);requireOverflow(overflow);
});

test('S8/T6 history starts at capture, updates exact revisions without resetting eligibility or duplicating targets',()=>{
  const commits=new Map(),rows=[];
  const capture=freshnessTarget({type:'memory',intent:'history',operation:'capture',stored:{id:'new',revision:2},committedAt:0,probe:'unique'},commits);
  assert.equal(capture.committedAt,0);ingestTargets(rows,[{target:capture}]);
  assert.equal(freshnessTarget({eligible:false,type:'memory',intent:'current',operation:'review',stored:{id:'new',revision:2},committedAt:20,probe:'unique'}),null);
  const confirmation=freshnessTarget({type:'memory',intent:'history',operation:'review',stored:{id:'new',revision:3},committedAt:20,probe:'unique'},commits);
  ingestTargets(rows,[{target:confirmation}]);assert.equal(rows.length,1);assert.equal(rows[0].committedAt,0);assert.equal(rows[0].revision,3);
  assert.equal(freshness(Array.from({length:100},()=>({...rows[0],observedAt:30010}))).decision,'failed');
  for(const [type,intent] of [['memory','current'],['card','current'],['card','history']]) {
    assert.equal(freshnessTarget({type,intent,operation:'capture',stored:{id:'new'},committedAt:0,probe:'unique'}),null);
    assert.equal(freshnessTarget({type,intent,operation:'review',stored:{id:'new',revision:3},committedAt:20,probe:'unique'}).committedAt,20);
  }
});

test('S9 P2-23 retained shutdown native records are outside public write intervals, including BUSY close',async()=>{
  for(const code of [0,5,6]) {
    let at=0;const observation={stream:'retained',epoch:1,capacity:256};
    const j=createWriterJournal({...observation,clock:()=>at}),l=createWriterLedger(observation),operations=['open',0];
    l.arm({...observation,type:'armed',protocol:'product-writer-v1',boundary:'loader-before-open-v1'});
    l.expect('open',['open']);l.expect(0,['write','inspect']);l.expect('shutdown',['shutdown']);
    class Native {exec(){} close(){if(code)throw Object.assign(Error('mapped_elsewhere'),{code:'ERR_SQLITE_ERROR',errcode:code});}}
    const Database=observedDatabase(Native,j);
    j.enter('open','open');const db=new Database();j.leave();at=10;
    j.enter(0,'write');at=12;db.exec('COMMIT');at=20;j.leave();j.enter(0,'inspect');j.leave();
    const writeInterval={startedAt:10,finishedAt:20};at=30;
    const r=await shutdownRetained(db,{journal:j,operations,clock:()=>at,loopFactory:()=>({async finish(){return loop();}})});
    const chunk=j.chunk();l.chunk(chunk);l.chunk(chunk);l.seal(j.seal(operations,r.disposed));l.acknowledgedSeal();l.exit(0,null,true);
    const evidence=l.result(),closes=evidence.records.filter(r=>r.phase==='shutdown'&&r.kind==='native_end'&&r.stage==='close');
    assert.equal(closes.length,1);assert.equal(closes[0].operation,'shutdown');assert.ok(closes[0].at>writeInterval.finishedAt);
    assert.equal(closes[0].commit,false);assert.equal(r.finalClose.startedAt,30);assert.equal(evidence.commits,1);
    assert.equal(evidence.busy,code?1:0);assert.equal(evidence.coverage,code?'incomplete':'complete');
  }
});

test('S10 preregistration contains method latency thresholds, byte/token bounds, definition and estimate',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'input.json');await writeFile(path,'{}');
  const header=await preregister({fixtures:[],volumeRoot:w.path,adapterModule:pathToFileURL(path).href,counterModule:pathToFileURL(path).href,
    labelsFile:path,queriesFile:path},null,buildPlan(),path);
  assert.deepEqual(header.protocol.latency,{findCandidates:{p95ByCount:{1112:700,3336:1000},referenceP95Ms:300,maxMs:1500},contextRead:{p95Ms:800,maxMs:2000},fetchCandidateEvidence:{p95Ms:150,maxMs:500}});
  assert.deepEqual(header.protocol.bounds,{responseBytes:65536,snapshotUnits:16384,cursorUnits:8192,candidateLimit:24,assembly:[{maxTokens:1500,maxItems:12},{maxTokens:4000,maxItems:24}]});
  assert.equal(header.protocolDefinition.version,'P2-product-v3');assert.equal(header.estimate.lowerBoundWallClockMs,1728541568);
});

test('S11 cell summaries retain both reader populations and the summary prints p50/p95/max',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'report.jsonl'),report=await createReportSink(path,{});
  const populations={main:{successful:{n:50,p50Ms:2,p95Ms:4,maxMs:5},allAttempts:{n:55,p50Ms:1,p95Ms:4,maxMs:6}}};
  await report.cell(cell,{decision:'passed'},{reader:populations});await report.finish('passed');
  const lines=[];await summarize(path,line=>lines.push(line));
  const output=JSON.parse(lines.find(l=>l.startsWith('{"type":"reader-statistics"')));
  assert.deepEqual(output.populations,populations);
  const entry=(await readFile(path,'utf8')).trim().split('\n').map(JSON.parse).find(r=>r.type==='cell');assert.deepEqual(entry.summary.reader,populations);
});

test('T7 cold host attribution is preserved when launcher scheduling samples are available',()=>{
  const original={coverage:'complete',threads:[{tid:99,runqueueNs:123}]};
  const record={hostPid:12345,hostLoop:{blocks:[{startedAt:10,finishedAt:20,scheduling:original}]}};
  const samples=[{pid:process.pid,at:0,threads:[],vm:{}},{pid:process.pid,at:30,threads:[],vm:{}}];
  attributeBlocks(record,samples);assert.deepEqual(record.hostLoop.blocks[0].scheduling,original);
});

test('T8 summary streams blocks before EOF, awaits sink backpressure, and keeps aggregates only',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'stream.records.jsonl');
  await writeFile(path,Array.from({length:1000},(_,i)=>JSON.stringify({type:'record',cell:i,series:'main',record:{hostLoop:{blocks:[{gapMs:101}]}}})).join('\n')+'\n'+JSON.stringify({type:'final',status:'failed'})+'\n');
  let written=0,release,entered;
  const started=new Promise(r=>{entered=r;});let finished=false;
  const result=summarize(path,async line=>{if(line.startsWith('0 main')){entered();await new Promise(r=>{release=r;});}written++;}).then(r=>{finished=true;return r;});
  await started;assert.equal(finished,false);assert.equal(written,1);release();
  const aggregate=await result;assert.equal(aggregate.blockCount,1000);assert.equal(aggregate.blocks,undefined);assert.equal(aggregate.status,'failed');
});

test('T9 legacy maximum-only loop prints its maximum and explicitly unavailable timestamps',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'old.records.jsonl');
  await writeFile(path,JSON.stringify({type:'record',cell:2,series:'cold',record:{hostLoop:{maxMs:250,over100:1}}})+'\n');
  const lines=[],r=await summarize(path,line=>lines.push(line));assert.equal(r.blockCount,1);
  assert.match(lines[1],/^2 cold hostLoop unavailable unavailable 250 /);
});

test('T4 controller crash exports acknowledged BUSY evidence to the numeric report',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'crash.jsonl'),report=await createReportSink(path,{});
  let observation,chunk,flushes=0,acknowledged=false;
  const child={connected:true,send(m){if(m.type==='ack')acknowledged=true;},
    take(type){if(type==='diagnostic_chunk'&&flushes++===0)return [chunk];return [];},
    async wait(type){if(type==='armed')return {...observation,type:'armed',protocol:'product-writer-v1',boundary:'loader-before-open-v1'};if(type==='ready')return {};throw Error('child_exit');},
    exited:Promise.resolve({code:1,signal:null,disconnected:true})};
  const writer=await startWriter({},'fresh',{actor:(kind,c)=>{
    observation=c.observation;const j=createWriterJournal(observation);j.enter(0,'open');
    try{j.invoke('open',()=>{throw Object.assign(Error('native'),{code:'ERR_SQLITE_ERROR',errcode:261});});}catch{}j.leave();chunk=j.chunk();return child;
  },terminate:async()=>{child.connected=false;}});
  const result=await writer.stop();await report.record(0,'writer',result);await report.finish('invalid');
  assert.equal(acknowledged,true);assert.equal(result.diagnostics.busy,1);assert.equal(result.diagnostics.coverage,'incomplete');
  const records=(await readFile(path+'.records.jsonl','utf8')).trim().split('\n').map(JSON.parse);
  assert.equal(records.find(r=>r.series==='writer').record.diagnostics.busy,1);
});

test('declarative v3 preserves every original cell and descriptor; a data-only revision changes the plan',async()=>{
  const original=spawnSync('git',['show','41669767:tools/testing/fixtures/context-product/protocol.mjs'],{encoding:'utf8'});assert.equal(original.status,0);
  const legacy=await import('data:text/javascript;base64,'+Buffer.from(original.stdout).toString('base64'));
  const plan=buildPlan(),old=legacy.buildPlan();
  assert.deepEqual(plan.map(c=>Object.fromEntries(Object.keys(old[c.id]).map(k=>[k,c[k]]))),old);
  assert.deepEqual(expandPlan(plan),legacy.expandPlan(old));
  const d=structuredClone(V3_DEFINITION);d.dimensions.count=[1112];d.dimensions.language=['zh'];d.fixedWindows.loads=['fresh-same'];d.fixedWindows.repetitions=1;
  d.kinds.find(k=>k.kind==='requests').samples.main={minimum:2,ceiling:3};
  const small=buildPlan(d);assert.ok(small.length<plan.length);assert.ok(small.filter(c=>c.windows).every(c=>c.load==='fresh-same'&&c.windows===1));
  assert.equal(small[0].sampleRules.main.minimum,2);
});

test('--estimate is read-only, needs no registration, and reports the v3 lower bound',()=>{
  const r=spawnSync(process.execPath,['tools/testing/measure-context-read-product.mjs','--protocol','v3','--estimate'],{encoding:'utf8'});assert.equal(r.status,0,r.stderr);
  const estimate=JSON.parse(r.stdout);assert.deepEqual(estimate,estimatePlan());
  assert.deepEqual(estimate.counts,{requests:7200,freshness:80,availability:48,overflow:48,backup:24,injection:120});
  assert.equal(estimate.fixedWindowMs,1728000000);assert.equal(estimate.minimumAttempts,541568);assert.equal(estimate.perAttemptFloorMs,1);
});


test('S11 runRegistered writes returned reader statistics into the actual cell summary',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'registered.jsonl');
  const populations={main:{successful:{n:50,p50Ms:2,p95Ms:4,maxMs:5},allAttempts:{n:55,p50Ms:1,p95Ms:4,maxMs:6}}};
  await runRegistered({volumeRoot:w.path},{reportPath:path},{validateRegistration(){},buildPlan:()=>[cell],preregister:async()=>({corpus:[]}),
    loadAdapter:async()=>({}),prepareCell:async()=>config(),probeDependencies:async()=>({ready:true}),build:async()=>({coverage:'complete',diagnostics:[]}),
    prepareInput:async c=>c,requestSeries:async()=>({decision:{decision:'passed'},populations}),storage:async()=>({value:{}}),idleBaseline:async()=>loop()});
  const entry=(await readFile(path,'utf8')).trim().split('\n').map(JSON.parse).find(r=>r.type==='cell');
  assert.deepEqual(entry.summary.reader,populations);
});


test('a revised definition with no fixed windows executes only registered request samples',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'revised.jsonl');
  const revised=structuredClone(V3_DEFINITION);revised.version='fabricated-revision';revised.fixedWindows.loads=[];
  const c={...buildPlan(revised).find(c=>c.kind==='requests'&&c.load==='fresh-same')};let requests=0;
  const result=await runRegistered({volumeRoot:w.path,protocolDefinition:revised},{reportPath:path},{validateRegistration(){},
    buildPlan:definition=>{assert.equal(definition,revised);return [c];},preregister:async()=>({corpus:[]}),
    loadAdapter:async()=>({}),prepareCell:async()=>config(),probeDependencies:async()=>({ready:true}),build:async()=>({coverage:'complete',diagnostics:[]}),
    prepareInput:async config=>config,requestSeries:async()=>{requests++;return {decision:{decision:'passed'},populations:{}};},
    storage:async()=>({value:{}}),idleBaseline:async()=>loop()});
  assert.equal(c.windows,0);assert.equal(requests,1);assert.equal(result.status,'passed');
});

test('--estimate uses the definition in registration JSON without production inputs',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'estimate.json'),definition=structuredClone(V3_DEFINITION);
  definition.version='fabricated-revision';definition.fixedWindows.loads=[];
  await writeFile(path,JSON.stringify({protocolDefinition:definition}));
  const r=spawnSync(process.execPath,['tools/testing/measure-context-read-product.mjs','--estimate','--registration',path],{encoding:'utf8'});
  assert.equal(r.status,0,r.stderr);const estimate=JSON.parse(r.stdout);
  assert.equal(estimate.protocol,'fabricated-revision');assert.equal(estimate.fixedWindowMs,0);
});


test('S2/T1 production sampler message handler sends no timer samples before explicit post-window collection',async()=>{
  let tick,observed=false,release;const sent=[];
  const session=createSamplerSession({buffer:createSampleBuffer({capacity:2,batchSize:1}),
    captureSample:pid=>({pid,at:1}),schedule:callback=>{tick=callback;return 1;},cancel(){},
    async send(m){assert.equal(observed,false);sent.push(m);if(m.type==='samples')await new Promise(r=>{release=r;});}});
  await session.message({type:'start',pids:[1]});observed=true;
  tick();tick();tick();assert.deepEqual(sent,[{type:'started'}]);observed=false;
  const collected=session.message({type:'collect'});await Promise.resolve();await Promise.resolve();
  assert.equal(sent.length,2);release();await Promise.resolve();await Promise.resolve();await Promise.resolve();
  assert.equal(sent.length,3);release();await collected;
  assert.deepEqual(sent.at(-2),{type:'sample_coverage',missing:0,dropped:3});assert.equal(sent.at(-1).type,'collected');session.close();
});


test('a changed cell plan cannot execute under the unchanged v3 revision label',()=>{
  const definition=structuredClone(V3_DEFINITION);definition.fixedWindows.repetitions=1;
  assert.throws(()=>validateRegistration({protocolDefinition:definition}),/protocol_revision_required/);
});
