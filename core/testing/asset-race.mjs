import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { openSync,closeSync,readFileSync,writeFileSync,existsSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
export async function until(predicate,label,maximumMs=30000) {
  const deadline=Date.now()+maximumMs;
  while(!predicate()){if(Date.now()>deadline)throw Error('asset_race_timeout: '+label);await delay(5);}
}
export function launch(f,operation,index=0) {
  const prefix=join(f.workspace.path,'asset-child-'+index),config={path:f.path,start:join(f.workspace.path,'asset-start'),
    ready:prefix+'.ready',entered:prefix+'.entered',result:prefix+'.result',beforeCommit:prefix+'.before-commit',...operation};
  writeFileSync(prefix+'.json',JSON.stringify(config),{mode:0o600});
  const out=openSync(prefix+'.stdout','wx',0o600),err=openSync(prefix+'.stderr','wx',0o600),env={...process.env};delete env.NODE_TEST_CONTEXT;
  let child;try{child=spawn(process.execPath,[fileURLToPath(new URL('./asset-race-child.mjs',import.meta.url)),prefix+'.json'],{env,stdio:['ignore',out,err]});}
  finally{closeSync(out);closeSync(err);}
  const state={child,config,exit:null,diagnostics:()=>readFileSync(prefix+'.stderr','utf8')+readFileSync(prefix+'.stdout','utf8')};
  state.closed=new Promise((resolve,reject)=>{child.once('error',reject);child.once('close',(code,signal)=>{state.exit={code,signal};resolve(state.exit);});});
  f.workspace.defer(async()=>{if(!state.exit)child.kill('SIGKILL');await state.closed;});return state;
}
export async function race(f,operations) {
  const workers=operations.map((operation,i)=>launch(f,operation,i));
  await until(()=>{for(const worker of workers)assert.equal(worker.exit,null,worker.diagnostics());return workers.every(worker=>existsSync(worker.config.ready));},'both ready');
  assert.equal(new Set(workers.map(worker=>readFileSync(worker.config.ready,'utf8'))).size,operations.length);
  f.db.exec('BEGIN IMMEDIATE');
  try {
    writeFileSync(workers[0].config.start,'go',{flag:'wx',mode:0o600});
    await until(()=>workers.every(worker=>existsSync(worker.config.entered)),'both authority fences');
    assert.ok(workers.every(worker=>!existsSync(worker.config.result)),'independent concurrent calls both wait for the SQLite lock');
  }finally{f.db.exec('COMMIT');}
  return Promise.all(workers.map(async worker=>{
    const exit=await worker.closed;assert.deepEqual(exit,{code:0,signal:null},worker.diagnostics());
    const saved=JSON.parse(readFileSync(worker.config.result,'utf8'));assert.equal(saved.checks,2);return saved.outcome;
  }));
}
