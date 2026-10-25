import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {Ledger} from '../ledger.mjs';
import {hash,atomicJSON} from '../common.mjs';
import {writerOwnerIdentity,writerMarkerName,parseWriterMarker,writerOwnerLiveness,processStartIdentity} from '../writer-owner.mjs';
import {plan} from './fixtures.mjs';
const h='evaluation/hr3/harness',baseline=process.env.HR3_OWNER_BASELINE==='1',timeout=60000;
function fixture(t){const dir=fs.mkdtempSync(h+'/artifacts/writer-owner-'),path=join(dir,'ledger.jsonl'),children=[];new Ledger(path,{plan});t.after(async()=>{await Promise.all(children.map(c=>c.stop()));fs.rmSync(dir,{recursive:true,force:true});});return {dir,path,children};}
async function worker(f){
 const environment={...process.env};delete environment.NODE_TEST_CONTEXT;
 const mailbox=f.dir+'/worker-'+f.children.length,out=fs.openSync(mailbox+'.stdout','wx'),err=fs.openSync(mailbox+'.stderr','wx');
 const child=spawn(process.execPath,[h+'/test/writer-owner-worker.mjs',f.path,baseline?'baseline':'current',mailbox],{env:environment,stdio:['ignore',out,err]});fs.closeSync(out);fs.closeSync(err);
 let sequence=0,closedStatus=null;const closed=new Promise(resolve=>child.once('close',(code,signal)=>{closedStatus={code,signal};resolve(closedStatus);}));
 async function wait(id){
  const path=mailbox+'.reply-'+id+'.json',started=Date.now();
  for(;;){
   if(fs.existsSync(path)){const result=JSON.parse(fs.readFileSync(path));if(result.fatal)throw Error(result.fatal);return result;}
   if(closedStatus)throw Error('worker_closed:'+JSON.stringify({status:closedStatus,stderr:fs.readFileSync(mailbox+'.stderr','utf8')}));
   if(Date.now()-started>=timeout)throw Error('worker_timeout');
   await new Promise(resolve=>setTimeout(resolve,10));
  }
 }
 const api={async request(operation,value){const id=++sequence;atomicJSON(mailbox+'.request.json',{id,operation,value});return wait(id);},async stop(){if(child.exitCode===null&&child.signalCode===null)child.kill('SIGKILL');return closed;}};
 f.children.push(api);api.ready=await wait(0);return api;
}
function evidence(name,data){fs.writeFileSync(h+'/reports/recheck4-'+name+'-'+(baseline?'baseline':'current')+'.json',JSON.stringify(data,null,2)+'\n');}
function marker(f,owner){const directory=f.path+'.lock.writers';fs.mkdirSync(directory,{recursive:true});const name=writerMarkerName(owner);fs.closeSync(fs.openSync(directory+'/'+name,'wx',0o600));return name;}
function present(f,name){return fs.existsSync(f.path+'.lock.writers/'+name);}

test('recheck4 owner: crashed independent writer is reclaimed under lock and observers recover', {timeout:180000},async t=>{
 const f=fixture(t),owner=await worker(f),observer=await worker(f),held=await owner.request('hold');assert.equal(held.markers.length,1);const name=held.markers[0],exit=await owner.stop();assert.equal(exit.signal,'SIGKILL');
 fs.mkdirSync(f.path+'.lock');let locked;try{locked=await observer.request('snapshot');assert.equal(locked.error,'ledger_locked');assert.ok(present(f,name));assert.equal(locked.unlinks.length,0);}finally{fs.rmdirSync(f.path+'.lock');}
 const recovered=await observer.request('snapshot'),fresh=await worker(f),written=await fresh.request('reserve','fresh-after-crash'),observed=await observer.request('read');
 const result={ledgerSHA256:observer.ready.ledgerSHA256,ownerPid:owner.ready.pid,observerPid:observer.ready.pid,exit,marker:name,recovered,written,observed,markerPresent:present(f,name)};evidence('crashed',result);
 assert.equal(recovered.error,null);assert.equal(written.error,null);assert.equal(observed.error,null);assert.equal(observed.records,2);assert.equal(present(f,name),false);assert.ok(recovered.unlinks.some(e=>e.marker===name&&e.underLock));assert.equal(recovered.report.reclaimed[0].reason,'process_missing');
});

test('recheck4 owner: live independent writer retains priority regardless of marker age',{timeout:180000},async t=>{
 const f=fixture(t),owner=await worker(f),observer=await worker(f),fresh=await worker(f),held=await owner.request('hold'),name=held.markers[0],identity=parseWriterMarker(name);assert.ok(identity?.starttime&&identity.bootId&&identity.namespace&&identity.nonce);assert.equal(identity.pid,owner.ready.pid);assert.notEqual(identity.pid,observer.ready.pid);
 fs.utimesSync(f.path+'.lock.writers/'+name,1,1);const before=fs.statSync(f.path+'.lock.writers/'+name,{bigint:true}).ino;
 const attempts=[];for(let i=0;i<3;i++)attempts.push(await observer.request('snapshot'));const written=await fresh.request('reserve','writer-with-live-owner'),alive=await owner.request('ping');
 evidence('live',{ledgerSHA256:observer.ready.ledgerSHA256,owner:identity,attempts,written,alive,markerPresent:present(f,name)});
 for(const r of attempts){assert.equal(r.error,'ledger_locked');assert.equal(r.writerIntents[0].state,'live');assert.equal(r.unlinks.length,0);}assert.equal(written.error,null);assert.equal(alive.error,null);assert.ok(present(f,name));assert.equal(fs.statSync(f.path+'.lock.writers/'+name,{bigint:true}).ino,before);
 await owner.request('release');assert.equal((await observer.request('snapshot')).error,null);
});

test('recheck4 owner: reused pid with a different process start is reclaimed without harming its live replacement',{timeout:180000},async t=>{
 const f=fixture(t),replacement=await worker(f),identity=(await replacement.request('identity')).owner,old={...identity,starttime:String(BigInt(identity.starttime)+1n)},name=marker(f,old),observer=await worker(f),result=await observer.request('snapshot'),alive=await replacement.request('ping');
 evidence('reused',{ledgerSHA256:observer.ready.ledgerSHA256,old,replacement:identity,result,alive,markerPresent:present(f,name)});
 assert.equal(result.error,null);assert.equal(present(f,name),false);assert.equal(alive.error,null);assert.ok(result.report.reclaimed.some(r=>r.marker===name&&r.reason==='pid_reused'));assert.ok(result.unlinks.some(r=>r.marker===name&&r.underLock));assert.equal((await replacement.request('reserve','replacement-proceeds')).error,null);assert.equal((await observer.request('snapshot')).state.reservations,1);
});

test('recheck4 owner: unknown start identity is retained and reported across independent processes',{timeout:180000},async t=>{
 const f=fixture(t),owner=await worker(f),identity=(await owner.request('identity')).owner,name=marker(f,{...identity,starttime:null}),observer=await worker(f),result=await observer.request('snapshot');
 evidence('unknown',{ledgerSHA256:observer.ready.ledgerSHA256,result,owner:identity,markerPresent:present(f,name)});
 assert.equal(result.error,'ledger_locked');assert.ok(present(f,name));assert.equal(result.writerIntents[0].state,'unknown');assert.equal(result.writerIntents[0].reason,'owner_start_unverifiable');assert.equal(result.unlinks.length,0);assert.equal((await owner.request('ping')).error,null);assert.equal((await owner.request('reserve','unknown-owner-writer')).error,null);assert.equal((await observer.request('snapshot')).error,'ledger_locked');assert.ok(present(f,name));
});

test('recheck4 owner: anonymous legacy marker is retained as unknown and reported',{timeout:180000},async t=>{
 const f=fixture(t),directory=f.path+'.lock.writers';fs.mkdirSync(directory);const name=hash('unverifiable-legacy-marker');fs.writeFileSync(directory+'/'+name,'');const observer=await worker(f),result=await observer.request('snapshot');assert.equal(result.error,'ledger_locked');assert.equal(result.writerIntents[0].reason,'unverifiable_marker');assert.ok(present(f,name));assert.equal(result.unlinks.length,0);
});

function probe({starttime='123',readError=null,killError=null,boot=null,platform='linux'}={}){
 const own=writerOwnerIdentity(),p={platform,readFile(path){if(path.endsWith('/boot_id'))return boot??own.bootId;if(readError)throw Object.assign(Error(readError),{code:readError});const fields=Array(20).fill('0');fields[0]='S';fields[19]=starttime;return own.pid+' (worker ) with spaces) '+fields.join(' ');},readlink:()=>`pid:[${own.namespace}]`,kill(){if(killError)throw Object.assign(Error(killError),{code:killError});}};return {owner:{...own,starttime:'123'},p};
}
for(const [name,options,state]of [
 ['same start identity',{},{state:'live',reason:'identity_matches'}],
 ['different start identity',{starttime:'124'},{state:'dead',reason:'pid_reused'}],
 ['missing process corroborated by ESRCH',{readError:'ENOENT',killError:'ESRCH'},{state:'dead',reason:'process_missing'}],
 ['missing proc with existing pid',{readError:'ENOENT'},{state:'unknown',reason:'process_liveness_unverifiable'}],
 ['permission uncertainty',{readError:'EACCES',killError:'EPERM'},{state:'unknown',reason:'process_liveness_unverifiable'}],
 ['missing proc and permission uncertainty',{readError:'ENOENT',killError:'EPERM'},{state:'unknown',reason:'process_liveness_unverifiable'}],
 ['different boot scope',{boot:'00000000-0000-0000-0000-000000000000'},{state:'unknown',reason:'owner_scope_unverifiable'}],
 ['non-Linux safe fallback',{platform:'other'},{state:'unknown',reason:'owner_scope_unverifiable'}]
])test('recheck4 liveness: '+name,()=>{const{owner,p}=probe(options);assert.deepEqual(writerOwnerLiveness(owner,p),state);});

test('recheck4 identity: complete marker names round-trip without a publication window',()=>{
 const owner=writerOwnerIdentity(),name=writerMarkerName(owner);assert.deepEqual(parseWriterMarker(name),owner);assert.ok(name.length<255);const {p}=probe();assert.equal(processStartIdentity(owner.pid,p),'123');
 const padded=name.split('.');padded[2]='0'+padded[2];assert.equal(parseWriterMarker(padded.join('.')),null);
 for(const value of ['',hash('old'),'v2.0.u.u.u.'+owner.nonce,'v2.-1.u.u.u.'+owner.nonce,'v2.2147483648.u.u.u.'+owner.nonce,name+'.partial'])assert.equal(parseWriterMarker(value),null);
});
