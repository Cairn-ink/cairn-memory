import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync,closeSync,writeFileSync,readFileSync,existsSync,renameSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { fixture,host,ns,publish,read,importMethod,adopt,ok } from './role-fixture.mjs';

const index=new URL('../index.mjs',import.meta.url).href,helper=new URL('./role-fixture.mjs',import.meta.url).href;
const emit=(path,value)=>{writeFileSync(path+'.tmp',JSON.stringify(value));renameSync(path+'.tmp',path);};

test('C05 rendezvous publishes during now/then reads without busy outcomes or mixed versions',async t=>{
 let rendezvous=null,inFlight=false;const statuses=[],h=host({counter:{id:'functional-byte-counter',countTokens:text=>{
  if(rendezvous){const run=rendezvous;rendezvous=null;assert.equal(inFlight,true);run();}
  return Math.ceil(Buffer.byteLength(text)/4);
 }}}),f=fixture(t,{h});
 const methods=['one','two'].map(id=>ok(f.call('importMethodVersion',importMethod('method-'+id,id))));
 for(const [i,value]of methods.entries())ok(f.call('adoptMethodVersion',adopt(value,'adopt-'+i)));
 const fields=i=>({duties:['Duty '+i],requiredOutputs:['Output '+i],methods:[methods[i%2].package],related:[],appliesTo:'Scope '+i});
 let head=ok(f.call('publishRoleProfileRelease',publish(ns,'finance','first',null,null,fields(0))));
 const original=head,receipt=ok(f.call('readRoleTaskContext',read())).metered.receipt;
 const prefix=f.dir+'/writer',out=openSync(prefix+'.out','wx',0o600),err=openSync(prefix+'.err','wx',0o600);
 const source=`import {openMemoryCore} from ${JSON.stringify(index)};import {host} from ${JSON.stringify(helper)};
 import {existsSync,readFileSync,writeFileSync,renameSync} from 'node:fs';import {setTimeout as delay} from 'node:timers/promises';
 const prefix=process.argv[2],emit=(p,v)=>{writeFileSync(p+'.tmp',JSON.stringify(v));renameSync(p+'.tmp',p);};
 const h=host();let core,events=0;
 const watchdog=setInterval(()=>console.error(JSON.stringify({watchdog:'diagnostic-only',events})),120000);watchdog.unref();
 try{core=openMemoryCore({path:process.argv[1],roleProfiles:h.options});emit(prefix+'.ready',{pid:process.pid});
  for(let i=0;i<2;i++){
   while(!existsSync(prefix+'.request-'+i)){if(existsSync(prefix+'.stop'))break;await delay(1);}
   if(existsSync(prefix+'.stop'))break;
   const input=JSON.parse(readFileSync(prefix+'.request-'+i,'utf8')),result=core.publishRoleProfileRelease(input,{});
   events++;emit(prefix+'.response-'+i,{pid:process.pid,result});if(!result.ok)break;
  }
 }catch(error){emit(prefix+'.error',{message:error.stack});process.exitCode=1;}
 finally{core?.close();clearInterval(watchdog);emit(prefix+'.done',{events});}`;
 let child;try{child=spawn(process.execPath,['--input-type=module','-e',source,f.path,prefix],{stdio:['ignore',out,err]});}finally{closeSync(out);closeSync(err);}
 let exit;const closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{exit={code,signal};resolve(exit);});});
 // No throughput, latency or readiness deadline. This watchdog only reports;
 // the two request/response events and checked child exit determine the result.
 const watchdog=setInterval(()=>t.diagnostic(JSON.stringify({watchdog:'diagnostic-only',responses:statuses.length,exit})),120000);watchdog.unref();
 const checkChild=()=>{if(existsSync(prefix+'.error'))throw Error(readFileSync(prefix+'.error','utf8'));if(exit)assert.fail('writer exited before rendezvous: '+JSON.stringify(exit));};
 function coherent(result,mode,current){
  const status=result.ok?'ok':result.error.code;statuses.push(status);assert.ok(['ok','snapshot_stale'].includes(status),JSON.stringify(result));
  if(!result.ok){assert.equal(result.value,undefined);return;}
  const value=result.value.metered,selected=mode==='then'?original:current,index=mode==='then'?0:current.registry.revision-1;
  assert.deepEqual(value.profile.release.ref,selected.release);assert.deepEqual(value.profile.release.fields,fields(index));
  assert.deepEqual(value.methods.map(m=>m.package),[methods[index%2].package]);assert.deepEqual(value.methods.map(m=>m.version),[methods[index%2].version]);
  assert.deepEqual(value.registries[0].currentRelease,current.release);
  if(mode==='then')assert.equal(value.receipt,receipt);
 }
 try{
  while(!existsSync(prefix+'.ready')){checkChild();await delay(1);}
  assert.notEqual(JSON.parse(readFileSync(prefix+'.ready','utf8')).pid,process.pid);
  for(const [event,mode]of ['now','then'].entries()){
   const input=mode==='now'?read():{mode,readSet:[ns],receipt};coherent(f.call('readRoleTaskContext',input),mode,head);
   let committed;
   rendezvous=()=>{
    emit(prefix+'.request-'+event,publish(ns,'finance','rendezvous-'+event,head.release,head.registry.revision,fields(event+1)));
    while(!existsSync(prefix+'.response-'+event)){
     if(existsSync(prefix+'.error'))throw Error(readFileSync(prefix+'.error','utf8'));
     if(existsSync(prefix+'.done')&&!existsSync(prefix+'.response-'+event))assert.fail('writer completed without response '+event);
     Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,1);
    }
    const response=JSON.parse(readFileSync(prefix+'.response-'+event,'utf8'));assert.notEqual(response.pid,process.pid);committed=ok(response.result);
   };
   let result;inFlight=true;try{result=f.call('readRoleTaskContext',input);}finally{inFlight=false;}
   assert.equal(rendezvous,null,'publish rendezvous ran during counting');assert.ok(committed);head=committed;
   coherent(result,mode,head);coherent(f.call('readRoleTaskContext',input),mode,head);
  }
  assert.deepEqual(await closed,{code:0,signal:null},readFileSync(prefix+'.err','utf8'));
  assert.equal(JSON.parse(readFileSync(prefix+'.done','utf8')).events,2);assert.equal(statuses.filter(s=>s==='storage_busy').length,0);
  assert.equal(statuses.length,6);t.diagnostic(JSON.stringify({publishEvents:2,reads:statuses.length,statuses,busy:0,writerExit:exit.code}));
 }finally{
  clearInterval(watchdog);writeFileSync(prefix+'.stop','stop');
  if(!exit){child.kill('SIGKILL');await closed;}
 }
});
