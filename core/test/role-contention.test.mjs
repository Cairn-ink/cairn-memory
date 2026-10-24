import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync,closeSync,writeFileSync,readFileSync,existsSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { fixture,ns,publish,read,ok } from './role-fixture.mjs';
const index=new URL('../index.mjs',import.meta.url).href,helper=new URL('./role-fixture.mjs',import.meta.url).href;
const percentile=(values,p)=>[...values].sort((a,b)=>a-b)[Math.ceil(values.length*p)-1];
test('C05 §16 paced profile writer and now/then readers overlap actual call intervals without busy outcomes',async t=>{
 const f=fixture(t),first=ok(f.call('publishRoleProfileRelease',publish())),receipt=ok(f.call('readRoleTaskContext',read())).metered.receipt;
 const stdout=openSync(f.dir+'/writer.stdout','w',0o600),stderr=openSync(f.dir+'/writer.stderr','w',0o600),gate=f.dir+'/start',report=f.dir+'/report';
 const child=spawn(process.execPath,['--input-type=module','-e',`import {openMemoryCore} from ${JSON.stringify(index)};import {host,ns,ok} from ${JSON.stringify(helper)};import {existsSync,writeFileSync,appendFileSync} from 'node:fs';
 const h=host(),core=openMemoryCore({path:process.argv[1],roleProfiles:h.options}),head=JSON.parse(process.argv[4]),intervals=[];writeFileSync(process.argv[2]+'.ready','ready');const end=Date.now()+40000;
 while(!existsSync(process.argv[2])){if(Date.now()>end)throw Error('gate timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2);}
 for(let i=0;i<3000&&!existsSync(process.argv[2]+'.stop');i++){if(Date.now()>end)throw Error('writer deadline');const start=performance.timeOrigin+performance.now();const result=core.disableRoleProfile({namespace:ns,roleKey:'finance',actionId:'paced-'+i,expectedCurrentRelease:head,expectedRegistryRevision:i+1},{});const finish=performance.timeOrigin+performance.now();ok(result);intervals.push([start,finish]);appendFileSync(process.argv[3]+'.intervals',JSON.stringify([start,finish])+String.fromCharCode(10));Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);}
 writeFileSync(process.argv[3],JSON.stringify(intervals));core.close();`,f.path,gate,report,JSON.stringify(first.release)],{stdio:['ignore',stdout,stderr]});
 closeSync(stdout);closeSync(stderr);const exit=new Promise(resolve=>child.on('exit',(code,signal)=>resolve({code,signal}))),timer=setTimeout(()=>child.kill('SIGKILL'),45000);
 let pages=[],latencies=[],statuses={};
 try{
  const deadline=Date.now()+40000;while(!existsSync(gate+'.ready')){if(child.exitCode!==null)throw Error(readFileSync(f.dir+'/writer.stderr','utf8'));if(Date.now()>deadline)throw Error('writer readiness timeout');await new Promise(resolve=>setTimeout(resolve,5));}writeFileSync(gate,'go');
  let i=0;
  while(!existsSync(report)){
   if(child.exitCode!==null)throw Error('writer exited '+child.exitCode+': '+readFileSync(f.dir+'/writer.stderr','utf8'));
   assert.ok(Date.now()<deadline,'paced deadline');const start=performance.timeOrigin+performance.now();
   const result=f.call('readRoleTaskContext',i++%2?{mode:'then',readSet:[ns],receipt}:read());const end=performance.timeOrigin+performance.now();pages.push([start,end]);latencies.push(end-start);
   const status=result.ok?'ok':result.error.code;statuses[status]=(statuses[status]??0)+1;assert.ok(['ok','snapshot_stale'].includes(status),JSON.stringify(result));
   if(i%10===0){
    const log=existsSync(report+'.intervals')?readFileSync(report+'.intervals','utf8'):'';
    const intervals=log.split('\n').slice(0,-1).map(line=>JSON.parse(line));
    const overlap=pages.filter(([a,b])=>intervals.some(([c,d])=>a<d&&b>c)).length;
    if(intervals.length>=100&&overlap>=200)writeFileSync(gate+'.stop','stop');
    await new Promise(resolve=>setTimeout(resolve,0));
   }
  }
  assert.deepEqual(await exit,{code:0,signal:null},readFileSync(f.dir+'/writer.stderr','utf8'));
  const intervals=JSON.parse(readFileSync(report,'utf8')),overlap=pages.filter(([start,end])=>intervals.some(([a,b])=>start<b&&end>a)).length,p95=percentile(intervals.map(([a,b])=>b-a),0.95);
  t.diagnostic(JSON.stringify({commits:intervals.length,readerPages:pages.length,activelyOverlappingPages:overlap,writerP95Ms:p95,statuses}));
  assert.ok(intervals.length>=100);assert.ok(overlap>=200,'actively overlapping pages: '+overlap);assert.ok(p95<=250,'writer p95: '+p95);
  t.diagnostic(JSON.stringify({scenario:'paced',counter:'synthetic exact byte/4 counter',commits:intervals.length,readerPages:pages.length,activelyOverlappingPages:overlap,writerP95Ms:p95,readerP50Ms:percentile(latencies,.5),readerP95Ms:percentile(latencies,.95),statuses,writerExit:0}));
 }catch(error){
  const log=existsSync(report+'.intervals')?readFileSync(report+'.intervals','utf8'):'';const intervals=log.split('\n').slice(0,-1).map(line=>JSON.parse(line));
  t.diagnostic(JSON.stringify({partial:true,writerExit:child.exitCode,writerIntervals:intervals.length,readerPages:pages.length,activelyOverlappingPages:pages.filter(([a,b])=>intervals.some(([c,d])=>a<d&&b>c)).length,statuses,writerError:readFileSync(f.dir+'/writer.stderr','utf8').slice(-2500)}));throw error;
 }finally{clearTimeout(timer);if(child.exitCode===null){child.kill('SIGKILL');await exit;}}
});
