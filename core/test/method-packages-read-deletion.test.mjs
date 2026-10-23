import assert from 'node:assert/strict';
import test from 'node:test';
import {spawn} from 'node:child_process';
import {existsSync,writeFileSync,readFileSync,openSync,closeSync} from 'node:fs';
import {join} from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {fixture,ok,input,file,childHost,moduleURL} from '../testing/method-package-fixtures.mjs';

const source=`
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {existsSync,writeFileSync,readFileSync} from 'node:fs';
import {setTimeout as delay} from 'node:timers/promises';
import {openMemoryCore} from ${JSON.stringify(moduleURL('core/contract.mjs'))};
${childHost}
const config=JSON.parse(readFileSync(process.argv[1],'utf8')),role=process.argv[2];
const until=async path=>{const end=Date.now()+15000;while(!existsSync(path)){assert.ok(Date.now()<end,'barrier '+path);await delay(2);}};
const core=openMemoryCore({path:config.path,methodPackages:methods}),call=(method,input)=>core[method](input,token);
writeFileSync(config[role+'Ready'],String(process.pid));await until(config.start);
try{
  if(role==='reader'){
    const args={version:config.version,intent:'history',path:'long'},first=ok(call('readMethodFile',args));
    assert.ok(first.nextCursor);assert.ok(first.parts.every(part=>part.text==='x'.repeat(part.text.length)));
    const prepare=DatabaseSync.prototype.prepare;let paused=false;
    // Test-only scheduling: pause after metadata established the read snapshot.
    // The independent writer reaches COMMIT with its purge pending.
    DatabaseSync.prototype.prepare=function(sql){
      const statement=prepare.call(this,sql);
      if(!paused&&sql==='SELECT text FROM method_files WHERE version_id=? AND path=?'){
        const get=statement.get.bind(statement);statement.get=(...args)=>{
          paused=true;writeFileSync(config.readSnapshot,'snapshot');const end=Date.now()+4000;
          while(!existsSync(config.releaseRead)){assert.ok(Date.now()<end,'release read snapshot');Atomics.wait(new Int32Array(new SharedArrayBuffer(4)),0,0,2);}
          return get(...args);
        };
      }
      return statement;
    };
    const second=ok(call('readMethodFile',{...args,cursor:first.nextCursor}));DatabaseSync.prototype.prepare=prepare;
    assert.equal(paused,true);assert.ok(second.nextCursor);assert.ok(second.parts.length>0);
    assert.ok(second.parts.every(part=>part.text==='x'.repeat(part.text.length)));
    assert.equal(first.parts[0].start,0);assert.equal(second.parts[0].start,first.parts.at(-1).end);assert.ok(Buffer.byteLength(JSON.stringify({ok:true,value:second}))<=65536);
    writeFileSync(config.completePage,JSON.stringify(second));await until(config.deleted);
    assert.deepEqual(call('readMethodFile',{...args,cursor:second.nextCursor}),{ok:false,error:{code:'cursor_stale',retryable:false}});
    assert.equal(ok(call('readMethodFile',args)).status,'unavailable');
    assert.equal(ok(call('readMethodFile',{...args,version:config.other})).parts[0].text,'other immutable version');
  }else{
    await until(config.startDelete);const exec=DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec=function(sql){if(sql==='COMMIT')writeFileSync(config.deletePending,'pending');return exec.call(this,sql);};
    const receipt=ok(call(config.method,config.deletion));DatabaseSync.prototype.exec=exec;
    assert.equal(receipt.effectCount,1);assert.deepEqual(ok(call(config.method,config.deletion)),receipt);
    writeFileSync(config.deleted,'committed');
  }
}finally{core.close();}
`;

// Two live processes, regular-file stdio and bounded file barriers work in
// restricted runners too; no historical Git object or privileged setup.
test('C05 deletion waits for a complete old page, then continuation is stale and a fresh read unavailable',async t=>{
  const f=fixture(t),first=ok(f.call('importMethodVersion',input('first',{files:[file('long','x'.repeat(20000))]})));
  const other=ok(f.call('importMethodVersion',input('other',{package:first.package,expectedPackageRevision:1,basedOn:first.version,
    files:[file('long','other immutable version')]})));
  f.core.close();
  const config={path:f.path,version:first.version,other:other.version,method:'deleteMethodVersion',
    deletion:{actionId:'concurrent-purge',ref:first.version,expectedRevision:1},
    ...Object.fromEntries(['readerReady','deleterReady','start','readSnapshot','releaseRead','startDelete','deletePending','completePage','deleted']
      .map(name=>[name,join(f.workspace.path,name)]))};
  const configuration=join(f.workspace.path,'configuration.json');writeFileSync(configuration,JSON.stringify(config));
  const children=[];
  for(const role of ['reader','deleter']){
    const stdout=join(f.workspace.path,role+'.stdout'),stderr=join(f.workspace.path,role+'.stderr'),out=openSync(stdout,'wx'),err=openSync(stderr,'wx');
    const env={...process.env};delete env.NODE_TEST_CONTEXT;let child;
    try{child=spawn(process.execPath,['--input-type=module','-e',source,configuration,role],{env,stdio:['ignore',out,err]});}
    finally{closeSync(out);closeSync(err);}
    const state={child,stderr,stdout,exit:null};children.push(state);
    state.closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{state.exit={code,signal};resolve(state.exit);});});
    f.workspace.defer(async()=>{if(!state.exit)child.kill('SIGKILL');await state.closed;});
  }
  async function until(predicate){const end=Date.now()+15000;while(!predicate()){
    for(const state of children)assert.equal(state.exit,null,readFileSync(state.stderr,'utf8'));
    assert.ok(Date.now()<end,'parent barrier');await delay(2);
  }}
  await until(()=>existsSync(config.readerReady)&&existsSync(config.deleterReady));
  assert.notEqual(readFileSync(config.readerReady,'utf8'),readFileSync(config.deleterReady,'utf8'));
  writeFileSync(config.start,'start');await until(()=>existsSync(config.readSnapshot));
  writeFileSync(config.startDelete,'delete');await until(()=>existsSync(config.deletePending));
  assert.equal(existsSync(config.deleted),false,'writer cannot commit through the reader snapshot');
  writeFileSync(config.releaseRead,'release');
  await until(()=>existsSync(config.completePage)&&existsSync(config.deleted));
  for(const state of children){const exit=await state.closed;assert.equal(exit.signal,null);assert.equal(exit.code,0,readFileSync(state.stderr,'utf8'));}
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_files WHERE version_id=?').get(first.version.versionId).n,0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM method_effects').get().n,1);
  assert.deepEqual(f.db.prepare('PRAGMA foreign_key_check').all(),[]);
});
