import {writerOwnerIdentity,writerMarkerName,parseWriterMarker,writerOwnerLiveness} from '../writer-owner.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {dirname,join} from 'node:path';
import {runInNewContext} from 'node:vm';
import {hash,canonical,fail,atomicJSON} from '../common.mjs';
import {loadCarryForward,verifyCarrySnapshot} from '../accounting.mjs';
import {responseRequest,validateRequest} from '../requests.mjs';
import {GuardedTransport} from '../transport.mjs';
import {plan} from './fixtures.mjs';

const request=id=>({id,operation:'reader',body:responseRequest('reader',{})});
function fixture(t){const dir=fs.mkdtempSync('evaluation/hr3/harness/artifacts/ledger-race-');t.after(()=>fs.rmSync(dir,{recursive:true,force:true}));return join(dir,'ledger.jsonl');}
function implementation(hooks={}){
 const baseline=process.env.HR3_LEDGER_RACE_BASELINE==='1',source=fs.readFileSync(new URL(baseline?'./fixtures/ledger-3e49f0a4.mjs.txt':'../ledger.mjs',import.meta.url),'utf8');
 if(baseline)assert.equal(hash(source),'5970aa55fef9e12ba470bc7efeb7b61c1cd4d68655fd3f42b8d4eecc7afdee6b');
 const writes=[],context={...fs,writerOwnerIdentity,writerMarkerName,parseWriterMarker,writerOwnerLiveness,dirname,canonical,hash,fail,loadCarryForward,verifyCarrySnapshot,validateRequest,Buffer,
  mkdirSync(path,...args){hooks.beforeLock?.(path);return fs.mkdirSync(path,...args);},
  readFileSync(path,...args){const value=fs.readFileSync(path,...args);hooks.afterRead?.(path,value);return value;},
  atomicJSON(path,value){writes.push({path,records:value.records,blockedReason:value.blockedReason??null,locked:fs.existsSync(path.replace(/\.head\.json$/,'.lock'))});atomicJSON(path,value);}};
 runInNewContext(source.replace(/^import .*\n/gm,'').replace(/^export /gm,'')+'\nglobalThis.Result=Ledger;',context);
 return {Writer:context.Result,writes,sourceSHA256:hash(source)};
}
function errorCode(fn){try{fn();return null;}catch(e){return e.code??e.message;}}
function state(path){return {events:fs.readFileSync(path,'utf8').trim().split('\n').map(JSON.parse),head:JSON.parse(fs.readFileSync(path+'.head.json'))};}

test('recheck2 race: observer cannot replace a fully committed newer checkpoint',t=>{
 const path=fixture(t);let armed=false,writer,attempt=null;
 const impl=implementation({afterRead(p){if(armed&&p===path+'.head.json'){armed=false;attempt=errorCode(()=>writer.reserve(request('interleaved')));}}});
 writer=new impl.Writer(path,{plan});writer.reserve(request('accepted'));const observer=new impl.Writer(path,{plan});
 armed=true;const observerError=errorCode(()=>observer.snapshot());
 // A cooperating writer blocked by the observer's read lock commits only after
 // that coherent read releases it. The old unlocked implementation commits in
 // the hook and then overwrites its own valid checkpoint from the observer.
 if(attempt==='ledger_locked')writer.reserve(request('interleaved'));
 const beforeHealth=state(path),writerError=errorCode(()=>writer.snapshot()),resumeError=errorCode(()=>new impl.Writer(path,{plan}));
 const result={sourceSHA256:impl.sourceSHA256,observerError,interleavedWriterResult:attempt,journalRecords:beforeHealth.events.length,checkpointRecords:beforeHealth.head.records,blockedReason:beforeHealth.head.blockedReason??null,writerError,resumeError,writes:impl.writes};
 fs.writeFileSync('evaluation/hr3/harness/reports/recheck2-race-'+(process.env.HR3_LEDGER_RACE_BASELINE==='1'?'baseline':'current')+'.json',JSON.stringify(result,null,2)+'\n');
 assert.equal(observerError,null);assert.equal(result.journalRecords,3);assert.equal(result.checkpointRecords,3);assert.equal(result.blockedReason,null);assert.equal(writerError,null);assert.equal(resumeError,null);
 assert.equal(observer.snapshot().reservations,2);assert.ok(impl.writes.every(w=>w.locked));
});

for(const mode of ['observer','writer'])test('recheck2 lock: '+mode+' revalidates forward progress after acquiring the lock',t=>{
 const path=fixture(t);let armed=false,writer;
 const impl=implementation({beforeLock(p){if(armed&&p===path+'.lock'){armed=false;writer.reserve(request('before-acquisition'));}}});
 writer=new impl.Writer(path,{plan});writer.reserve(request('accepted'));const observer=new impl.Writer(path,{plan});armed=true;
 if(mode==='observer')assert.equal(observer.snapshot().reservations,2);
 else observer.reserve(request('after-acquisition'));
 assert.equal(writer.snapshot().reservations,mode==='observer'?2:3);assert.equal(state(path).head.blockedReason,undefined);assert.ok(impl.writes.every(w=>w.locked));
});

test('recheck2 rollback: monitoring is read-only and a writer persists a genuine rollback under lock',async t=>{
 const path=fixture(t),impl=implementation(),writer=new impl.Writer(path,{plan});writer.reserve(request('accepted'));const prefix=fs.readFileSync(path);writer.reserve(request('newer'));
 const observer=new impl.Writer(path,{plan}),checkpoint=fs.readFileSync(path+'.head.json'),writeCount=impl.writes.length;fs.writeFileSync(path,prefix);
 for(let n=0;n<2;n++)assert.throws(()=>observer.snapshot(),/ledger_history_rollback/);
 assert.equal(impl.writes.length,writeCount);assert.deepEqual(fs.readFileSync(path+'.head.json'),checkpoint);
 let calls=0;const guard=new GuardedTransport({async send(){calls++;}},writer);
 await assert.rejects(guard.send(request('blocked')),/accounting_mismatch:ledger_history_rollback/);assert.equal(calls,0);
 assert.equal(state(path).head.blockedReason,'ledger_history_rollback');assert.ok(impl.writes.at(-1).locked);assert.equal(state(path).head.records,3);
 assert.throws(()=>new impl.Writer(path,{plan}),/ledger_history_rollback/);
});

// Fault injection bypasses cooperative locking deliberately. Conditional
// rejection must still leave an intervening, newer checkpoint intact.
function externalCommit(path){
 const {events}=state(path),data={type:'failure',id:'external-forward-record',prior:events.at(-1).digest};events.push({...data,digest:hash(data)});
 const raw=events.map(canonical).join('\n')+'\n';fs.writeFileSync(path,raw);
 atomicJSON(path+'.head.json',{version:'hr3-ledger-head-v1',records:events.length,bytes:Buffer.byteLength(raw),head:events.at(-1).digest,configurationSHA256:hash(events[0].configuration)});
}
for(const mode of ['observer','writer'])test('recheck2 rejection: stale '+mode+' cannot overwrite an intervening checkpoint',t=>{
 const path=fixture(t);let armed=false;
 const impl=implementation({afterRead(p){if(armed&&p===path+'.head.json'){armed=false;externalCommit(path);}}}),writer=new impl.Writer(path,{plan});writer.reserve(request('accepted'));
 const stale=new impl.Writer(path,{plan}),writeCount=impl.writes.length;armed=true;
 assert.throws(()=>mode==='observer'?stale.snapshot():stale.reserve(request('blocked')),mode==='observer'?/ledger_head_mismatch/:/ledger_checkpoint_changed/);
 assert.equal(state(path).head.records,3);assert.equal(state(path).head.blockedReason,undefined);assert.equal(impl.writes.length,writeCount);
 assert.equal(writer.snapshot().failures,1);assert.doesNotThrow(()=>new impl.Writer(path,{plan}));
 stale.reserve(request('after-revalidation'));assert.equal(state(path).head.records,4);assert.equal(state(path).head.blockedReason,undefined);
});

test('recheck2 mutation: direct rejection and append require writer lock ownership',t=>{
 const path=fixture(t),impl=implementation(),writer=new impl.Writer(path,{plan}),head=fs.readFileSync(path+'.head.json'),journal=fs.readFileSync(path);
 assert.throws(()=>writer.reject('injected'),/ledger_rejection_requires_lock/);assert.throws(()=>writer.append(writer.read(),{type:'failure',id:'outside-transaction'}),/ledger_append_requires_transaction/);
 assert.deepEqual(fs.readFileSync(path+'.head.json'),head);assert.deepEqual(fs.readFileSync(path),journal);writer.reserve(request('still-healthy'));assert.equal(state(path).head.records,2);
});

test('recheck2 monitoring: lock contention reports busy without poisoning the writer or checkpoint',async t=>{
 t.mock.timers.enable({apis:['setInterval']});const path=fixture(t),impl=implementation(),writer=new impl.Writer(path,{plan}),observer=new impl.Writer(path,{plan});let now=0,calls=0;const progress=[];
 const guard=new GuardedTransport({async send(r){calls++;return {requestId:'local-'+r.id,model:r.body.model,status:'completed',outputText:'{}',usage:{inputTokens:1,outputTokens:1}};}},observer,{now:()=>now});
 guard.startSupervision(p=>progress.push(p));t.after(()=>guard.stopSupervision());const checkpoint=fs.readFileSync(path+'.head.json');fs.mkdirSync(path+'.lock');
 try{now=60000;t.mock.timers.tick(60000);assert.equal(progress.at(-1).ledgerBusy,true);assert.equal(guard.supervisionError,undefined);assert.deepEqual(fs.readFileSync(path+'.head.json'),checkpoint);assert.ok(fs.existsSync(path+'.lock'));}
 finally{fs.rmdirSync(path+'.lock');}
 await guard.send(request('healthy'));assert.equal(calls,1);assert.equal(writer.snapshot().stopped,null);assert.equal(state(path).head.blockedReason,undefined);
});

test('recheck2 monitoring: five-minute stall still aborts while another writer holds the lock',async t=>{
 t.mock.timers.enable({apis:['setInterval']});const path=fixture(t),impl=implementation(),writer=new impl.Writer(path,{plan});let now=0,signal,calls=0;
 const guard=new GuardedTransport({send(r,options){calls++;signal=options.signal;return new Promise(()=>{});}},writer,{now:()=>now});guard.startSupervision();t.after(()=>guard.stopSupervision());
 const pending=guard.send(request('pending')),checkpoint=fs.readFileSync(path+'.head.json');fs.mkdirSync(path+'.lock');
 try{now=300000;t.mock.timers.tick(60000);await assert.rejects(pending,/five_minutes_without_progress/);assert.equal(signal.aborted,true);assert.equal(calls,1);assert.deepEqual(fs.readFileSync(path+'.head.json'),checkpoint);}
 finally{fs.rmdirSync(path+'.lock');}
 await guard.stopSupervision();assert.equal(writer.snapshot().unsettled.length,1);assert.equal(state(path).head.blockedReason,undefined);
});
