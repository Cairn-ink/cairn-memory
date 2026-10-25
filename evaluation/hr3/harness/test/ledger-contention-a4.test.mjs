import {writerOwnerIdentity,writerMarkerName,parseWriterMarker,writerOwnerLiveness} from '../writer-owner.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {dirname,join,relative} from 'node:path';
import {runInNewContext} from 'node:vm';
import {performance} from 'node:perf_hooks';
import {canonical,hash,fail,atomicJSON} from '../common.mjs';
import {loadCarryForward,verifyCarrySnapshot} from '../accounting.mjs';
import {responseRequest,embeddingRequest,validateRequest,EMBEDDING} from '../requests.mjs';
import {plan} from './fixtures.mjs';
const h='evaluation/hr3/harness',baseline=process.env.HR3_CONTENTION_BASELINE==='1';
const request=id=>({id,operation:'extraction',body:responseRequest('extraction',{})});
function implementation({watchdogMs=60000,captureInterval=null}={}){
 const sources=Object.fromEntries(['ledger','transport'].map(name=>[name,fs.readFileSync(new URL(baseline?'./fixtures/'+name+'-2221f923.mjs.txt':'../'+name+'.mjs',import.meta.url),'utf8')]));
 if(baseline){assert.equal(hash(sources.ledger),'f67e392aa9c95db171f5c9ff33806771ddeb4f6941d6baff33098af017a4a396');assert.equal(hash(sources.transport),'2d9ecd49ae1607711248bba55390d7801e6eb9bfa9b85feeb3e61e1d8ddd93be');}
 const context={...fs,writerOwnerIdentity,writerMarkerName,parseWriterMarker,writerOwnerLiveness,dirname,relative,Buffer,performance,canonical,hash,fail,atomicJSON,loadCarryForward,verifyCarrySnapshot,responseRequest,embeddingRequest,validateRequest,EMBEDDING,AbortController,setTimeout,clearTimeout,setInterval:fn=>captureInterval?(captureInterval(fn),0):setInterval(fn,watchdogMs),clearInterval};
 runInNewContext(Object.values(sources).map(s=>s.replace(/^import .*\n/gm,'').replace(/^export /gm,'')).join('\n')+'\nglobalThis.Result={Ledger,GuardedTransport,TransportError};',context);
 return {...context.Result,sourceHashes:Object.fromEntries(Object.entries(sources).map(([k,v])=>[k,hash(v)]))};
}
function fixture(t,options={}){const dir=fs.mkdtempSync(h+'/artifacts/ledger-contention-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));const path=join(dir,'ledger.jsonl'),impl=implementation(options);return {...impl,dir,path,ledger:new impl.Ledger(path,{plan})};}
const response=r=>({requestId:'local-'+r.id,model:r.body.model,status:'completed',outputText:'{"exact":"paid reply 假回覆"}',usage:{inputTokens:1,outputTokens:1}});
function journal(path){return fs.readFileSync(path,'utf8').trim().split('\n').map(JSON.parse);}
function hold(t,path,ms){fs.mkdirSync(path+'.lock');const timer=setTimeout(()=>{if(fs.existsSync(path+'.lock'))fs.rmdirSync(path+'.lock');},ms);t.after(()=>{clearTimeout(timer);if(fs.existsSync(path+'.lock'))fs.rmdirSync(path+'.lock');});}
function savedResponses(path){const d=path+'.responses';return fs.existsSync(d)?fs.readdirSync(d).map(n=>({path:d+'/'+n,value:JSON.parse(fs.readFileSync(d+'/'+n)),mode:fs.statSync(d+'/'+n).mode&0o777})):[];}
async function outcome(p){try{return {reply:await p,error:null};}catch(e){return {reply:null,error:e.code??e.message};}}
function evidence(name,f,data){fs.writeFileSync(h+'/reports/recheck3-'+name+'-'+(baseline?'baseline':'current')+'.json',JSON.stringify({sourceHashes:f.sourceHashes,...data},null,2)+'\n');}

test('recheck3 contention: monitoring lock at reply settles once after release with one dispatch',async t=>{
 const f=fixture(t);let dispatches=0,received;
 const guard=new f.GuardedTransport({async send(r){dispatches++;received=response(r);hold(t,f.path,25);return received;}},f.ledger,{accountingTimeoutMs:20000});
 const result=await outcome(guard.send(request('reply')));await new Promise(resolve=>setTimeout(resolve,30));
 const rows=journal(f.path);evidence('reply',f,{result,dispatches,reservations:rows.filter(e=>e.type==='reserve').length,settlements:rows.filter(e=>e.type==='settle').length,responses:savedResponses(f.path)});
 assert.equal(result.error,null);assert.deepEqual(result.reply,received);assert.equal(dispatches,1);assert.equal(rows.filter(e=>e.type==='reserve').length,1);assert.equal(rows.filter(e=>e.type==='settle').length,1);assert.equal(f.ledger.snapshot().unsettled.length,0);assert.equal(savedResponses(f.path).length,0);
});

test('recheck3 contention: exhausted reply wait stops durably with reservation and response retained and no redispatch',async t=>{
 const f=fixture(t);let dispatches=0,received;
 const guard=new f.GuardedTransport({async send(r){dispatches++;received=response(r);fs.mkdirSync(f.path+'.lock');return received;}},f.ledger,{accountingTimeoutMs:30,accountingBackoffMs:2});
 t.after(()=>{if(fs.existsSync(f.path+'.lock'))fs.rmdirSync(f.path+'.lock');});
 const started=performance.now(),result=await outcome(guard.send(request('exhausted'))),elapsed=performance.now()-started;
 const checkpoint=fs.readFileSync(f.path+'.head.json'),responses=savedResponses(f.path),stopPath=f.path+'.accounting-stop.json',stop=fs.existsSync(stopPath)?JSON.parse(fs.readFileSync(stopPath)):null;
 fs.rmdirSync(f.path+'.lock');
 const before=fs.readFileSync(f.path),retry=await outcome(guard.send(request('exhausted')));
 const resumed=new f.Ledger(f.path,{plan}),again=await outcome(new f.GuardedTransport(guard.transport,resumed).send(request('exhausted')));
 evidence('exhausted',f,{result,retry,again,elapsed,dispatches,stop,responses,snapshot:resumed.snapshot()});
 assert.equal(result.error,'accounting_contention_exhausted');assert.match((await guard.snapshot({forReport:true})).observation,/last coherent snapshot/);assert.ok(elapsed>=25&&elapsed<30000);assert.equal(dispatches,1);assert.equal(responses.length,1);assert.equal(responses[0].mode,0o600);assert.deepEqual(responses[0].value.response,received);assert.equal(responses[0].value.id,'exhausted/attempt-0');assert.equal(responses[0].value.bodySHA256,hash(request('exhausted').body));
 assert.equal(stop.reason,'accounting_contention_exhausted');assert.equal(stop.responsePath,relative(dirname(f.path),responses[0].path));assert.equal(resumed.snapshot().stopped,'accounting_contention_exhausted');assert.equal(resumed.snapshot().unsettled.length,1);assert.equal(journal(f.path).filter(e=>e.type==='settle').length,0);assert.deepEqual(fs.readFileSync(f.path),before);assert.deepEqual(fs.readFileSync(f.path+'.head.json'),checkpoint);assert.equal(savedResponses(f.path).length,1);
});

test('recheck3 contention: busy watchdog yields to pending writer without starvation',async t=>{
 const f=fixture(t,{watchdogMs:1}),observer=new f.Ledger(f.path,{plan});let dispatches=0,busy=0,checks=0,observerBusy=0;
 const guard=new f.GuardedTransport({async send(r){dispatches++;hold(t,f.path,20);return response(r);}},f.ledger,{accountingTimeoutMs:20000,accountingBackoffMs:2});
 guard.startSupervision(p=>{checks++;if(p.ledgerBusy)busy++;});t.after(()=>guard.stopSupervision());
 const monitoring=setInterval(()=>{try{observer.snapshot();}catch(e){if(e.code==='ledger_locked')observerBusy++;else throw e;}},1);t.after(()=>clearInterval(monitoring));
 const started=performance.now(),result=await outcome(guard.send(request('watchdog')));await new Promise(resolve=>setTimeout(resolve,25));guard.stopSupervision();clearInterval(monitoring);
 const state=f.ledger.snapshot();evidence('watchdog',f,{result,dispatches,busy,checks,observerBusy,elapsed:performance.now()-started,state});
 assert.equal(result.error,null);assert.equal(dispatches,1);assert.ok(checks>0&&busy>0&&observerBusy>0);assert.equal(state.unsettled.length,0);assert.equal(state.stopped,null);assert.equal(guard.supervisionError,undefined);assert.equal(journal(f.path).filter(e=>e.type==='settle').length,1);
});

for(const step of ['reserve','settle','failure','stop'])test('recheck3 accounting: '+step+' contention retries only the accounting step',async t=>{
 const f=fixture(t);let dispatches=0,invocations=0;
 const original=f.ledger[step].bind(f.ledger);f.ledger[step]=(...args)=>{if(++invocations===1)hold(t,f.path,15);return original(...args);};
 const guard=new f.GuardedTransport({async send(r){dispatches++;if(step==='failure'&&dispatches===1)throw new f.TransportError();const reply=response(r);if(step==='stop')reply.model='wrong';return reply;}},f.ledger,{accountingTimeoutMs:20000,accountingBackoffMs:2});
 const result=await outcome(guard.send(request(step)));await new Promise(resolve=>setTimeout(resolve,20));
 assert.equal(result.error,step==='stop'?'model_mismatch':null);assert.equal(dispatches,step==='failure'?2:1);assert.ok(invocations>1);
 assert.equal(journal(f.path).filter(e=>e.type===step).length,1);assert.equal(f.ledger.snapshot().stopped,step==='stop'?'model_mismatch':null);
});

test('recheck3 accounting: pre-dispatch contention expires without reservation or dispatch',async t=>{
 const f=fixture(t);let dispatches=0;const guard=new f.GuardedTransport({async send(){dispatches++;}},f.ledger,{accountingTimeoutMs:20});fs.mkdirSync(f.path+'.lock');t.after(()=>{if(fs.existsSync(f.path+'.lock'))fs.rmdirSync(f.path+'.lock');});
 const result=await outcome(guard.send(request('not-dispatched')));assert.equal(result.error,'accounting_contention_exhausted');assert.equal(dispatches,0);assert.equal(journal(f.path).filter(e=>e.type==='reserve').length,0);fs.rmdirSync(f.path+'.lock');assert.equal(f.ledger.snapshot().stopped,'accounting_contention_exhausted');
});

test('recheck3 accounting: independent writer intents keep observers yielding until every writer finishes',t=>{
 const f=fixture(t),other=new f.Ledger(f.path,{plan}),observer=new f.Ledger(f.path,{plan});const one=f.ledger.writerPriority(),two=other.writerPriority();
 try{assert.throws(()=>observer.snapshot(),/ledger_locked/);one();assert.throws(()=>observer.snapshot(),/ledger_locked/);other.reserve(request('other'));two();assert.equal(observer.snapshot().reservations,1);}finally{for(const release of [one,two])try{release();}catch{}}
});

test('recheck3 accounting: wait ceiling cannot reach the five-minute stall bound',t=>{
 const f=fixture(t);assert.throws(()=>new f.GuardedTransport({},f.ledger,{accountingTimeoutMs:30001}),/invalid_accounting_contention_bound/);assert.throws(()=>new f.GuardedTransport({},f.ledger,{accountingTimeoutMs:0}),/invalid_accounting_contention_bound/);
 const guard=new f.GuardedTransport({},f.ledger);assert.equal(guard.accountingTimeoutMs,15000);assert.ok(guard.accountingTimeoutMs<guard.stallMs/10);
});

for(const step of ['settle','failure'])test('recheck3 accounting: exhausted '+step+' retains reservation and never retries provider',async t=>{
 const f=fixture(t);let dispatches=0;const original=f.ledger[step].bind(f.ledger);
 f.ledger[step]=(...args)=>{if(!fs.existsSync(f.path+'.lock'))fs.mkdirSync(f.path+'.lock');return original(...args);};
 t.after(()=>{if(fs.existsSync(f.path+'.lock'))fs.rmdirSync(f.path+'.lock');});
 const guard=new f.GuardedTransport({async send(r){dispatches++;if(step==='failure')throw new f.TransportError();return response(r);}},f.ledger,{accountingTimeoutMs:20});
 const result=await outcome(guard.send(request(step)));assert.equal(result.error,'accounting_contention_exhausted');assert.equal(dispatches,1);assert.equal(JSON.parse(fs.readFileSync(f.path+'.accounting-stop.json')).operation,step);
 assert.equal(savedResponses(f.path).length,step==='settle'?1:0);assert.equal(journal(f.path).filter(e=>e.type===step).length,0);
 const report=await guard.snapshot({forReport:true});assert.equal(report.unsettled.length,1);assert.equal(report.stopped,'accounting_contention_exhausted');assert.match(report.observation,/reconciliation required/);
 fs.rmdirSync(f.path+'.lock');assert.equal(f.ledger.snapshot().unsettled.length,1);assert.equal(f.ledger.snapshot().stopped,'accounting_contention_exhausted');
});

test('recheck3 accounting: runner-style snapshot retries contention and preserves coherent totals',async t=>{
 const f=fixture(t),guard=new f.GuardedTransport({},f.ledger,{accountingTimeoutMs:20000});f.ledger.reserve(request('outstanding'));hold(t,f.path,15);
 const state=await guard.snapshot();assert.equal(state.unsettled.length,1);assert.equal(state.stopped,null);assert.equal(state.total,f.ledger.snapshot().total);
});

test('recheck3 accounting: watchdog stop drains bounded recording before artifact reporting',async t=>{
 let tick,now=0,calls=0,signal;const f=fixture(t,{captureInterval:fn=>{tick=fn;}});
 const guard=new f.GuardedTransport({send(r,options){calls++;signal=options.signal;return new Promise(()=>{});}},f.ledger,{now:()=>now,accountingTimeoutMs:20000});guard.startSupervision();t.after(()=>guard.stopSupervision());
 const pending=guard.send(request('supervised')),checkpoint=fs.readFileSync(f.path+'.head.json');fs.mkdirSync(f.path+'.lock');t.after(()=>{if(fs.existsSync(f.path+'.lock'))fs.rmdirSync(f.path+'.lock');});now=300000;tick();
 assert.equal((await outcome(pending)).error,'five_minutes_without_progress');assert.equal(signal.aborted,true);assert.equal(calls,1);assert.deepEqual(fs.readFileSync(f.path+'.head.json'),checkpoint);
 fs.rmdirSync(f.path+'.lock');await guard.stopSupervision();const state=await guard.snapshot({forReport:true});assert.equal(state.stopped,'five_minutes_without_progress');assert.equal(state.unsettled.length,1);assert.equal(journal(f.path).filter(e=>e.type==='stop').length,1);assert.equal(fs.readdirSync(f.path+'.lock.writers').length,0);
});

test('recheck3 accounting: settlement backoff cannot reset an elapsed five-minute deadline',async t=>{
 const f=fixture(t);let now=0,dispatches=0,first=true,received,timer;const original=f.ledger.settle.bind(f.ledger);
 f.ledger.settle=(...args)=>{if(first){first=false;fs.mkdirSync(f.path+'.lock');timer=setTimeout(()=>{now=300000;fs.rmdirSync(f.path+'.lock');},15);}return original(...args);};
 t.after(()=>{clearTimeout(timer);if(fs.existsSync(f.path+'.lock'))fs.rmdirSync(f.path+'.lock');});
 const guard=new f.GuardedTransport({async send(r){dispatches++;now=299990;received=response(r);return received;}},f.ledger,{now:()=>now,accountingTimeoutMs:20000,accountingBackoffMs:2});
 const result=await outcome(guard.send(request('elapsed'))),state=f.ledger.snapshot(),responses=savedResponses(f.path);evidence('deadline',f,{result,state,dispatches,lastProgress:guard.lastProgress,responses});
 assert.equal(result.error,'five_minutes_without_progress');assert.equal(dispatches,1);assert.equal(guard.lastProgress,0);assert.equal(state.stopped,'five_minutes_without_progress');assert.equal(state.unsettled.length,1);assert.equal(journal(f.path).filter(e=>e.type==='settle').length,0);assert.equal(responses.length,1);assert.deepEqual(responses[0].value.response,received);
});
