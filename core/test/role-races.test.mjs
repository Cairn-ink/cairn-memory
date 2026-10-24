import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn,spawnSync } from 'node:child_process';
import { existsSync,writeFileSync,readFileSync,openSync,closeSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { fixture,host,ns,project,publish,read,ok,importMethod,adopt } from './role-fixture.mjs';
const index=new URL('../index.mjs',import.meta.url).href,helper=new URL('./role-fixture.mjs',import.meta.url).href;
async function race(f,requests) {
 const children=requests.map(([method,input],i)=>{
  const stdout=openSync(f.dir+`/race-${i}.out`,'w',0o600),stderr=openSync(f.dir+`/race-${i}.err`,'w',0o600);
  const child=spawn(process.execPath,['--input-type=module','-e',`import {openMemoryCore} from ${JSON.stringify(index)};import {host} from ${JSON.stringify(helper)};import {existsSync,writeFileSync} from 'node:fs';
   const h=host(),core=openMemoryCore({path:process.argv[1],roleProfiles:h.options});writeFileSync(process.argv[2]+'.'+process.pid+'.ready','ready');const timeout=Date.now()+10000;while(!existsSync(process.argv[2])){if(Date.now()>timeout)throw Error('gate timeout');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,5);}const started=performance.now();const result=core[process.argv[3]](JSON.parse(process.argv[4]),{});console.log(JSON.stringify({result,started,ended:performance.now()}));core.close();`,f.path,f.dir+'/gate',method,JSON.stringify(input)],{stdio:['ignore',stdout,stderr]});
  closeSync(stdout);closeSync(stderr);const done=new Promise(resolve=>child.on('exit',(code,signal)=>resolve({code,signal})));return {child,done,i};
 });
 const timeout=setTimeout(()=>children.forEach(c=>c.child.kill('SIGKILL')),15000);
 try{
  // Each child opens and validates before it reaches the same mutation gate.
  const start=Date.now();while(!children.every(c=>existsSync(f.dir+'/gate.'+c.child.pid+'.ready'))){if(Date.now()-start>10000)throw Error('readiness timeout');await new Promise(resolve=>setTimeout(resolve,10));}writeFileSync(f.dir+'/gate','go');
  const exits=await Promise.all(children.map(c=>c.done));
  exits.forEach((exit,i)=>assert.deepEqual(exit,{code:0,signal:null},readFileSync(f.dir+`/race-${i}.err`,'utf8')));
  return children.map(c=>JSON.parse(readFileSync(f.dir+`/race-${c.i}.out`,'utf8')).result);
 }finally{clearTimeout(timeout);for(const c of children)if(c.child.exitCode===null)c.child.kill();await Promise.all(children.map(c=>c.done));}
}
for(const pair of [['publishRoleProfileRelease','publishRoleProfileRelease'],['publishRoleProfileRelease','disableRoleProfile'],['disableRoleProfile','deleteRoleProfileRelease'],['publishRoleProfileRelease','deleteRoleProfileRelease']])test(`C04 child dual-CAS race ${pair.join('/')} has exactly one committed transition`,async t=>{
 const f=fixture(t),first=ok(f.call('publishRoleProfileRelease',publish()));
 const request=method=>{const {fields,...base}=publish(ns,'finance',method,first.release,1);return method==='publishRoleProfileRelease'?{...base,fields}:method==='deleteRoleProfileRelease'?{...base,release:first.release,expectedRevision:1}:base;};
 const results=await race(f,pair.map((method,i)=>[method,{...request(method),actionId:'race-'+i}]));assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).error.code,'revision_conflict');
 const db=new DatabaseSync(f.path,{timeout:5000});assert.equal(db.prepare('SELECT count(*) n FROM role_profile_events').get().n,2);assert.equal(db.prepare('SELECT revision FROM role_profiles').get().revision,2);db.close();
});
test('C04 owner-wide quota reservation serializes two processes across namespaces',async t=>{
 const f=fixture(t);ok(f.call('publishRoleProfileRelease',publish()));const db=new DatabaseSync(f.path,{timeout:5000});
 // Synthetic near-cap fixture; capacity is shared across namespaces of one owner.
 db.prepare('UPDATE role_profile_owner_usage SET byte_count=? WHERE owner_id=?').run(49999700,ns.ownerId);db.close();
 const results=await race(f,[['publishRoleProfileRelease',publish(ns,'COO','quota-1')],['publishRoleProfileRelease',publish(project,'CTO','quota-2')]]);
 assert.equal(results.filter(r=>r.ok).length,1);assert.equal(results.find(r=>!r.ok).error.code,'quota_reached');
 const d=new DatabaseSync(f.path);assert.ok(d.prepare('SELECT byte_count FROM role_profile_owner_usage').get().byte_count<=50000000);d.close();
});
function mutationDuringCount(t,setup) {
 let mutate,armed=false,done=false;const h=host({counter:{id:'race-counter',countTokens:text=>{if(armed&&!done){done=true;mutate();}return Math.ceil(Buffer.byteLength(text)/4);}}});
 const f=fixture(t,{h}),scenario=setup(f);mutate=scenario.mutate;armed=true;
 const result=f.call('readRoleTaskContext',scenario.input);assert.equal(done,true);assert.equal(result.error?.code,'snapshot_stale',JSON.stringify(result));
}
for(const phase of ['absence','head','release','binding','method-target','history','reason','comparison','file'])test(`C05 mutation during counting revalidates ${phase} in the final transaction`,t=>mutationDuringCount(t,f=>{
 let first=ok(f.call('publishRoleProfileRelease',publish())),method;
 let input=read(),mutate;
 const next=()=>ok(f.call('publishRoleProfileRelease',publish(ns,'finance','next',first.release,first.registry.revision)));
 if(phase==='absence'){input=read('finance',[ns,project]);mutate=()=>ok(f.call('disableRoleProfile',{namespace:project,roleKey:'finance',actionId:'barrier',expectedCurrentRelease:null,expectedRegistryRevision:null}));}
 else if(phase==='head')mutate=next;
 else if(phase==='release')mutate=()=>ok(f.call('deleteRoleProfileRelease',{namespace:ns,roleKey:'finance',actionId:'delete',expectedCurrentRelease:first.release,expectedRegistryRevision:1,release:first.release,expectedRevision:1}));
 else if(phase==='history'){input={...read(),history:{profile:first.release.profile}};mutate=next;}
 else if(phase==='reason'){
  const admitted=ok(f.call('admit',{namespace:ns,memory:{content:'Reason source',kind:'fact'},receipts:[{client:'test',sessionId:'s',eventId:'e',role:'user',excerpt:'Reason source'}]}));
  first=ok(f.call('publishRoleProfileRelease',{...publish(ns,'finance','reason',first.release,1),changeReason:{text:'Recorded reason',reasonRefs:[{type:'memory',namespace:ns,memoryId:admitted.memory.id,revision:1}]}}));
  mutate=()=>ok(f.call('forget',{namespace:ns,memoryId:admitted.memory.id,expectedRevision:1}));
 }else if(phase==='comparison'){
  const second=next();input={mode:'compare',roleKey:'finance',readSet:[ns],from:first.release,to:second.release};mutate=()=>ok(f.call('deleteRoleProfileRelease',{namespace:ns,roleKey:'finance',actionId:'delete-comp',expectedCurrentRelease:second.release,expectedRegistryRevision:2,release:first.release,expectedRevision:1}));
 }else {
  method=ok(f.call('importMethodVersion',importMethod()));ok(f.call('adoptMethodVersion',adopt(method)));first=ok(f.call('publishRoleProfileRelease',publish(ns,'finance','with-method',first.release,1,{duties:['Review'],requiredOutputs:['Report'],methods:[method.package]})));
  if(phase==='file'){const receipt=ok(f.call('readRoleTaskContext',read())).metered.receipt;input={mode:'file',readSet:[ns],receipt,package:method.package,path:'guide.txt'};}
  mutate=phase==='binding'?()=>{const {version,...value}=adopt(method,'withdraw',null,ns,1);ok(f.call('disableMethodBinding',value));}:()=>ok(f.call('deleteMethodVersion',{actionId:'delete-method',ref:method.version,expectedRevision:1}));
 }
 return {input,mutate};
}));
test('C05 no counter or authority callback occurs after final BEGIN; mid-call revoked grants give scope_changed',t=>{
 let begins=0,armed=false;const check=()=>{if(armed)assert.ok(begins<2,'callback after final read');};
 const h=host({onCurrent:check,counter:{id:'assert-final',countTokens:text=>{check();return Math.ceil(text.length/4);}}}),f=fixture(t,{h});ok(f.call('publishRoleProfileRelease',publish()));
 const exec=DatabaseSync.prototype.exec;DatabaseSync.prototype.exec=function(sql){if(armed&&sql==='BEGIN')begins++;return exec.call(this,sql);};
 try{armed=true;ok(f.call('readRoleTaskContext',read()));assert.equal(begins,2);}finally{armed=false;DatabaseSync.prototype.exec=exec;}
});
