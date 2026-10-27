import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from './workspace.mjs';
import { PROTOCOL, buildPlan, expandPlan, quantiles, population, exposure, availability, freshness, decide, aggregate } from './fixtures/context-product/protocol.mjs';
import { createWriterJournal, createWriterLedger, observedDatabase } from './fixtures/context-product/writer-journal.mjs';
import { attempt, observeLoop, selectReadSet, closedShape, retrievalQuality } from './fixtures/context-product/engine.mjs';
import { createReportSink } from './fixtures/context-product/report.mjs';
import { summarize } from './summarize-context-read-product.mjs';
import { windows } from './fixtures/context-product/series.mjs';
import { writerProfile } from './measure-context-read-product.mjs';
const good=(elapsedMs=1)=>({ok:true,validated:true,expected:true,bounds:true,overlap:true,elapsedMs,readMs:elapsedMs,
  hostLoop:{maxMs:1,over100:0,blocks:[]},telemetry:'complete',code:null});
const repeat=(n,f=good)=>Array.from({length:n},(_,i)=>f(i+1));
const cell={method:'findCandidates',count:1112,canonical:'WAL',sidecar:'WAL'};
function evidence(patch={}) {return {records:repeat(50),loops:[{maxMs:1,over100:0}],warmups:3,populations:{main:population(repeat(50)),cold:population(repeat(10),{cold:true})},
  readerCoverage:'complete',maintainerCoverage:'complete',writerCoverage:'complete',baselineCoverage:'complete',nativeBusy:0,publicBusy:0,
  writers:[{operation:'capture',deadlineMs:900,writeElapsedMs:2},{operation:'review',deadlineMs:5000,writeElapsedMs:3}],production:true,...patch};}

test('P2-19 independent nearest-rank successful-only and all-attempt arithmetic',()=>{
  const records=[...repeat(50,i=>good(i*10)),...repeat(450,()=>({...good(0),ok:false,code:'index_unavailable'}))];
  const p=population(records);
  // Independent fixed answers: all n=500, rank250=0, rank475=250;
  // successful n=50, rank25=250, rank48=480. Fast failures cannot help.
  assert.deepEqual(p.allAttempts,{n:500,p50Ms:0,p95Ms:250,maxMs:500});
  assert.deepEqual(p.successful,{n:50,p50Ms:250,p95Ms:480,maxMs:500});assert.equal(p.decision,'passed');
  assert.equal(population(repeat(500,()=>({...good(0),ok:false}))).decision,'inconclusive');
  assert.deepEqual(quantiles([4,1,3,2]),{n:4,p50Ms:2,p95Ms:4,maxMs:4});
  assert.throws(()=>quantiles([NaN]));
});
test('P2-19 exact warm-ups, main/cold minima, ceilings, no warmups inside cold',()=>{
  for(const [cold,min,ceiling] of [[false,50,500],[true,10,100]]) {
    assert.equal(population(repeat(min-1),{cold}).decision,'inconclusive');
    assert.equal(population(repeat(min),{cold}).decision,'passed');
    const a=[...repeat(min-1),...repeat(ceiling-min+1,()=>({...good(0),ok:false}))];
    assert.equal(population(a,{cold}).decision,'inconclusive');assert.equal(population([...a,good()],{cold}).decision,'invalid');
    assert.equal(population(repeat(min,()=>({...good(),overlap:false})),{cold,concurrent:true}).decision,'inconclusive');
  }
  assert.equal(PROTOCOL.warmups,3);assert.equal(decide(cell,evidence({warmups:2})).decision,'invalid');
  assert.equal(decide(cell,evidence()).decision,'passed');
});
test('P2-19 F7 retained needs writes/commits, fresh needs ten close overlaps, baseline only commits',()=>{
  const m={commits:100,activeWriteOverlap:{pages:20},activeCloseOverlap:{pages:0}};
  assert.equal(exposure('retained',m).decision,'passed');assert.equal(exposure('fresh',m).decision,'invalid');
  assert.equal(exposure('fresh',{...m,activeCloseOverlap:{pages:10}}).decision,'passed');
  assert.equal(exposure('fresh',{...m,activeCloseOverlap:{pages:9}}).decision,'invalid');
  assert.equal(exposure('retained',{...m,activeWriteOverlap:{pages:19}}).decision,'invalid');
  assert.equal(exposure('baseline',{commits:100}).decision,'passed');assert.equal(exposure('baseline',{commits:99}).decision,'invalid');
  assert.equal(exposure('retained',m,99).decision,'invalid');assert.equal(exposure('idle',{}).decision,'passed');
});
test('inventory covers every independent dimension, stress, overflow and required/control modes',()=>{
  const p=buildPlan();assert.equal(p.length,7520);assert.equal(new Set(p.map(c=>c.id)).size,p.length);
  assert.equal(p.filter(c=>c.kind==='requests').length,7200);
  assert.equal(expandPlan(p).length,81056);assert.equal(expandPlan(p).filter(c=>c.series==='contention').length,57600);
  for(const c of p.filter(c=>c.kind==='requests'))assert.equal(c.windows,c.load==='idle'?0:5);
  assert.deepEqual(windows().map(w=>w.order),[['baseline','reader'],['reader','baseline'],['baseline','reader'],['reader','baseline'],['baseline','reader']]);
  assert.ok(windows().every(w=>w.windowMs===30000));assert.deepEqual(windows(true),[{repetition:0,windowMs:2000,order:['baseline','reader']}]);
  assert.equal(p.filter(c=>c.kind==='freshness'&&c.schema===18).every(c=>c.type==='memory'),true);
});
for(const [name,patch,key] of [
  ['absolute host loop',{loops:[{maxMs:101,over100:1}]},'loop'],
  ['launcher loop',{loops:[{maxMs:1,over100:0},{maxMs:100.01,over100:1}]},'loop'],
  ['native busy hidden by public generic error',{nativeBusy:1},'busy'],
  ['public busy',{publicBusy:1},'busy'],
  ['deadline overshoot',{records:[{...good(),overshootMs:50.01}]},'settlement'],
  ['late success',{records:[{...good(),lateSuccess:true}]},'settlement'],
  ['bounds',{records:[{...good(),bounds:false}]},'functional'],
  ['oracle',{records:[{...good(),expected:false}]},'functional'],
  ['unknown error',{records:[{...good(),code:'unknown'}]},'unexpectedErrors'],
  ['writer overrun',{writers:[{operation:'capture',deadlineMs:1,writeElapsedMs:2}]},'captureDeadline'],
  ['writer timeout',{writers:[{operation:'review',deadlineMs:5000,writeElapsedMs:2,code:'model_timeout'}]},'reviewTimeout'],
])test('decision gate: '+name,()=>{const d=decide(cell,evidence(patch));assert.equal(d.checks[key],false);assert.equal(d.decision,'failed');});
test('each method/size/reference threshold uses exact <= p95/max boundaries',()=>{
  for(const [method,count,series,p95,max] of [['findCandidates',1112,'main',700,1500],['findCandidates',3336,'cold',1000,1500],['findCandidates',1112,'warm-reference',300,1500],['fetchCandidateEvidence',3336,'cold',150,500],['contextRead',1112,'main',800,2000]]){
    const c={...cell,method,count},sample={decision:'passed',successful:{n:50,p95Ms:p95,maxMs:max}};
    assert.equal(decide(c,evidence({populations:{[series]:sample}})).decision,'passed');
    assert.equal(decide(c,evidence({populations:{[series]:{...sample,successful:{...sample.successful,p95Ms:p95+.01}}}})).decision,'failed');
    assert.equal(decide(c,evidence({populations:{[series]:{...sample,successful:{...sample.successful,maxMs:max+.01}}}})).decision,'failed');
  }
});
test('missing coverage, blocked dependency, null deadlines and smoke cannot pass',()=>{
  for(const k of ['readerCoverage','maintainerCoverage','writerCoverage','baselineCoverage'])assert.equal(decide(cell,evidence({[k]:'incomplete'})).decision,'invalid');
  const b=decide(cell,{blocked:['P2c','P2d-WAL']});assert.equal(b.decision,'invalid');assert.equal(b.reason,'blocked_dependency');
  for(const patch of [{smoke:true},{functionalOnly:true},{production:false},{reportOutputsComplete:false},{writers:[{operation:'capture',deadlineMs:null,writeElapsedMs:1}]}])assert.equal(decide(cell,evidence(patch)).decision,'inconclusive');
  const d=decide(cell,evidence({writerCoverage:'incomplete',nativeBusy:1}));assert.equal(d.decision,'invalid');assert.equal(d.observedFailure,true);
  assert.equal(decide({...cell,canonical:'DELETE',sidecar:'DELETE'},evidence({nativeBusy:100,publicBusy:100})).decision,'passed');
  assert.equal(aggregate(['passed','invalid']),'invalid');assert.equal(aggregate(['failed','invalid']),'failed');assert.equal(aggregate([]),'inconclusive');
  assert.equal(writerProfile({captureMs:900,reviewMs:null,provenance:'host'}).reviewMs,null);assert.throws(()=>writerProfile({captureMs:900,provenance:'host'}));
});
test('availability mutually exclusive denominator and freshness right censoring',()=>{
  const scheduled=()=>({method:'findCandidates',scheduled:true});
  const a=repeat(100,scheduled);a[0]={...a[0],code:'index_unavailable',notReady:true};a[1]={...a[1],code:'read_timeout'};
  assert.equal(availability(a).fraction,.01);assert.equal(availability(a).decision,'passed');assert.equal(availability(a).categories.timeout,1);
  a[2]={...a[2],notReady:true};assert.equal(availability(a).decision,'failed');assert.equal(availability(a.slice(3)).decision,'inconclusive');
  assert.throws(()=>availability([{method:'fetchCandidateEvidence',scheduled:true}]));
  const targets=repeat(100,()=>({committedAt:0,observedAt:30000}));assert.equal(freshness(targets).decision,'passed');
  targets.slice(0,6).forEach(t=>t.observedAt=null);assert.equal(freshness(targets).p95Ms,Infinity);assert.equal(freshness(targets).decision,'failed');
  assert.equal(freshness(targets.slice(6)).decision,'inconclusive');
});
function stream() {
  const config={stream:'numeric-stream',epoch:7,capacity:256},journal=createWriterJournal(config),ledger=createWriterLedger(config);
  ledger.arm({...config,type:'armed',protocol:'product-writer-v1',boundary:'loader-before-open-v1'});
  return {config,journal,ledger};
}
function complete(s,{code=0}={}) {
  const {journal:j,ledger:l}=s;l.expect(0,['open','write','close']);
  for(const phase of ['open','write','close']){j.enter(0,phase);try{j.invoke(phase==='write'?'commit':phase,()=>{if(code)throw Object.assign(Error('native'),{code:'ERR_SQLITE_ERROR',errcode:code});},phase==='write');}catch{}j.leave();}
  const chunk=j.chunk();assert.equal(l.chunk(chunk),chunk.through);assert.equal(l.chunk(chunk),chunk.through);j.ack(chunk.through);
  const seal=j.seal([0],true);assert.equal(l.seal(seal),true);l.acknowledgedSeal();l.exit(0,null,true);return {chunk,seal};
}
test('P2-23 install before ordinary open; native open/write/rollback/close failures survive generic public mapping',()=>{
  for(const primary of [5,6])for(const stage of ['open','write','rollback','close']){
    const s=stream(),j=s.journal,l=s.ledger;l.expect(0,['open','write','close']);let installed=false;
    class Native {
      constructor(){assert.equal(installed,true);if(stage==='open')throw Object.assign(Error(),{code:'ERR_SQLITE_ERROR',errcode:primary+256});}
      exec(sql){if(stage==='write'&&sql==='COMMIT'||stage==='rollback'&&sql==='ROLLBACK')throw Object.assign(Error(),{code:'ERR_SQLITE_ERROR',errcode:primary});}
      close(){if(stage==='close')throw Object.assign(Error(),{code:'ERR_SQLITE_ERROR',errcode:primary});}
    }
    const Observed=observedDatabase(Native,j);installed=true;let db;
    j.enter(0,'open');try{db=new Observed();}catch{}j.leave();
    j.enter(0,'write');try{db?.exec(stage==='rollback'?'ROLLBACK':'COMMIT');}catch{const mapped={code:'storage_error'};assert.equal(mapped.errcode,undefined);}j.leave();
    j.enter(0,'close');try{db?.close();}catch{}j.leave();
    const chunk=j.chunk();l.chunk(chunk);const seal=j.seal([0],true);assert.equal(l.seal(seal),true);l.acknowledgedSeal();l.exit(0,null,true);
    const r=l.result();assert.equal(r.coverage,'complete');assert.equal(r.busy,1);assert.ok(r.records.some(r=>r.primary===primary));
    assert.equal(decide(cell,evidence({nativeBusy:r.busy,writerCoverage:r.coverage})).decision,'failed');
  }
});
test('P2-23 lost chunk/seal, wrong epoch, conflicting duplicate, overflow, missing operation, crash or unacked seal invalidates',()=>{
  for(const defect of ['chunk','seal','epoch','conflict','overflow','operation','crash','ack','disconnect']) {
    const s=stream(),{journal:j,ledger:l}=s;l.expect(0,['write']);j.enter(0,'write');j.invoke('commit',()=>1,true);j.leave();
    const m=j.chunk();if(defect==='epoch')m.epoch++;
    if(defect==='overflow')m.counters.overflow++;
    if(defect!=='chunk')l.chunk(m);
    if(defect==='conflict'){const resend=structuredClone(m);resend.records[1].stage='rollback';l.chunk(resend);}
    if(defect==='operation')l.expect(1,['write']);
    if(defect!=='seal'&&defect!=='crash')l.seal(j.seal([0],true));
    if(defect!=='ack')l.acknowledgedSeal();l.exit(defect==='crash'?1:0,null,defect!=='disconnect');
    const r=l.result();assert.equal(r.coverage,'incomplete',defect);
    assert.equal(decide(cell,evidence({writerCoverage:r.coverage})).decision,'invalid');
  }
});
test('P2-23 exact resends deduplicate and journal overflow is explicit',()=>{
  const s=stream();complete(s);assert.equal(s.ledger.result().coverage,'complete');assert.equal(s.ledger.result().commits,1);
  const closes=s.ledger.result().records.filter(r=>r.phase==='close');assert.ok(closes.length);assert.ok(closes.every(r=>!r.commit));
  const overflow=createWriterJournal({stream:'s',epoch:1,capacity:1});overflow.enter(0,'write');overflow.invoke('execute',()=>1);overflow.leave();assert.ok(overflow.seal([0],true).counters.overflow>0);
});
test('exact closed DTO shapes reject unknown keys/statuses; recent-projects-v1 canonical selection is deterministic',()=>{
  const schema={type:'object',properties:{status:{enum:['complete','partial']},items:{type:'array',items:{type:'number'},max:24}}};
  assert.equal(closedShape({status:'complete',items:[]},schema),true);
  for(const v of [{status:'new',items:[]},{status:'complete',items:[],hidden:1},{status:'complete'}])assert.equal(closedShape(v,schema),false);
  const inventory=[{ownerId:'o',scope:'personal',projectId:null},...repeat(32,i=>({ownerId:'o',scope:'project',projectId:String(i).padStart(2,'0'),lastActiveAt:i%3}))];
  const a=selectReadSet(inventory,'r'),b=selectReadSet([...inventory].reverse(),'r');assert.deepEqual(a,b);assert.equal(a.readSet.length,32);assert.equal(a.ownerCoverage.omittedNamespaces,1);
});
test('slow harness validation is outside observation; synchronous blocking injection inside engine call remains observed',async()=>{
  for(const block of [0,250]) {
    let now=0;const ns={ownerId:'test',scope:'personal',projectId:null};
    const config={path:new URL('unused.sqlite',import.meta.url).pathname,readSet:[ns],ownerCoverage:{policy:'recent-projects-v1',selectionRevision:'s',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0},
      functionalOnly:true,deadlines:{openMs:5000,requestMs:5000},input:{},method:'findCandidates',load:'idle'};
    const result=await attempt(config,{open:async()=>({async findCandidates(){now+=block;return {ok:true};},async close(){}}),
      loopFactory:()=>observeLoop({now:()=>now,timers:false}),validate:()=>{now+=10000;return {bytes:2,bounds:true,validated:true};},oracle:()=>{now+=10000;return true;}});
    assert.equal(result.record.hostLoop.maxMs,block);assert.equal(result.record.hostLoop.over100,block?1:0);
  }
});
test('numeric journal, immutable registration, interrupted partial and streaming decision/block summary',async t=>{
  const w=createTestWorkspace(t),path=join(w.path,'report.jsonl'),header={protocol:PROTOCOL,cellCount:1};
  const sink=await createReportSink(path,header);const before=await readFile(path+'.header.json','utf8');
  await sink.record(0,'main',{hostLoop:{blocks:[{gapMs:101}]}});await sink.cell({id:0},{decision:'invalid',reason:'blocked_dependency'});
  const partial=await summarize(path+'.partial',()=>{});assert.equal(partial.status,'interrupted');assert.equal(partial.cells,1);
  await sink.finish('invalid');assert.equal(await readFile(path+'.header.json','utf8'),before);
  assert.equal((await summarize(path,()=>{})).tally.invalid,1);assert.equal((await summarize(path+'.records.jsonl',()=>{})).blockCount,1);
  await assert.rejects(createReportSink(path,header),{code:'EEXIST'});
});

test('P2-23 known native busy counter survives a lost chunk and incomplete seal',()=>{
  const {journal,ledger}=stream();ledger.expect(0,['write']);journal.enter(0,'write');
  try{journal.invoke('execute',()=>{throw Object.assign(Error(),{code:'ERR_SQLITE_ERROR',errcode:261});});}catch{}
  journal.leave();ledger.seal(journal.seal([0],true));ledger.exit(0,null,true);
  assert.equal(ledger.result().coverage,'incomplete');assert.equal(ledger.result().busy,1);
  const d=decide(cell,evidence({writerCoverage:'incomplete',nativeBusy:ledger.result().busy}));assert.equal(d.decision,'invalid');assert.equal(d.observedFailure,true);
});
test('importing the harness and child entry dependencies keeps SQLite behind dynamic invocation',()=>{
  const harness=new URL('./measure-context-read-product.mjs',import.meta.url).href;
  const script=`import {register} from 'node:module';register('data:text/javascript,'+encodeURIComponent('export async function resolve(s,c,n){if(s==="node:sqlite")throw Error("eager_sqlite");return n(s,c);}'),import.meta.url);await import(process.argv[1]);`;
  const r=spawnSync(process.execPath,['--input-type=module','--eval',script,harness],{env:{},encoding:'utf8',timeout:10000});
  assert.equal(r.status,0,r.stderr);assert.equal(r.signal,null);
});

test('language retrieval reports labeled recall at 5/12 and known misses without a new quality threshold',()=>{
  const namespace={ownerId:'o',scope:'personal',projectId:null},ref=id=>({type:'memory',namespace,memoryId:String(id)});
  const result={ok:true,value:{items:Array.from({length:12},(_,i)=>({ref:ref(i)}))}};
  const quality=retrievalQuality(result,{readSet:[namespace],oracleData:{relevant:[ref(0),ref(7),ref(20)],knownMisses:['single-han']}});
  assert.deepEqual(quality,{relevant:3,hits5:1,hits12:2,recallAt5:1/3,recallAt12:2/3,knownMisses:1});
});
