import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {closeSync,existsSync,openSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {setTimeout as delay} from 'node:timers/promises';
async function until(predicate,label) {
  const deadline=Date.now()+15000;
  while(!predicate()) {
    if(Date.now()>deadline)throw Error('race_barrier_timeout: '+label);
    await delay(5);
  }
}
export async function race(f,operations) {
  const start=join(f.workspace.path,'start'),workers=[];
  for(const [index,operation] of operations.entries()) {
    const stem=join(f.workspace.path,'writer-'+index),configuration=stem+'.json';
    const paths={ready:stem+'.ready',entered:stem+'.entered',result:stem+'.result'};
    writeFileSync(configuration,JSON.stringify({path:f.path,...operation,...paths,start,fenceChecks:['adoptMethodVersion','disableMethodBinding'].includes(operation.method)?2*(1+operation.input.readSet.length):2}),{mode:0o600});
    const stdout=stem+'.stdout',stderr=stem+'.stderr',out=openSync(stdout,'wx',0o600),err=openSync(stderr,'wx',0o600);
    // These writers are independent processes, not node:test workers. Match
    // the owned runner's environment fence before their fixture imports node:test.
    const environment={...globalThis.process.env};delete environment.NODE_TEST_CONTEXT;
    let process;
    try{process=spawn(globalThis.process.execPath,[fileURLToPath(new URL('./method-binding-race-child.mjs',import.meta.url)),configuration],{env:environment,stdio:['ignore',out,err]});}
    finally{closeSync(out);closeSync(err);}
    const closed=new Promise(resolve=>{
      process.once('error',error=>resolve({error}));
      process.once('close',(code,signal)=>resolve({code,signal}));
    });
    const worker={process,closed,stdout,stderr,...paths};workers.push(worker);
    f.workspace.defer(async()=>{if(process.exitCode===null && process.signalCode===null)process.kill('SIGKILL');await closed;});
  }
  await until(()=>workers.every(worker=>existsSync(worker.ready)),'both writers opened');
  assert.equal(new Set(workers.map(worker=>readFileSync(worker.ready,'utf8'))).size,operations.length,'independent processes');
  assert.ok(workers.every(worker=>!existsSync(worker.result)),'both children wait before invoking the API');
  // Force both calls past the final authority fence while a third connection
  // holds the write lock. They then compete for the same BEGIN IMMEDIATE lock.
  f.db.exec('BEGIN IMMEDIATE');
  try {
    writeFileSync(start,'go',{flag:'wx',mode:0o600});
    await until(()=>workers.every(worker=>existsSync(worker.entered)),'both writers attempting transactions');
    assert.ok(workers.every(worker=>!existsSync(worker.result)),'neither writer can commit before release');
  } finally {f.db.exec('COMMIT');}
  const results=await Promise.all(workers.map(async worker=>{
    const state=await worker.closed;
    const diagnostics=readFileSync(worker.stderr,'utf8')+readFileSync(worker.stdout,'utf8');
    assert.equal(state.error,undefined,String(state.error));assert.equal(state.signal,null,diagnostics);assert.equal(state.code,0,diagnostics);
    const saved=JSON.parse(readFileSync(worker.result,'utf8'));assert.equal(saved.checks,['adoptMethodVersion','disableMethodBinding'].includes(operations[workers.indexOf(worker)].method)?2*(1+operations[workers.indexOf(worker)].input.readSet.length):2);return saved.outcome;
  }));
  return results;
}
