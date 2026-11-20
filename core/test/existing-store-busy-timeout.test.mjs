import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { inspectExistingStorePin } from '../existing-store.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

// The lock lives in a separate process: a synchronous busy wait cannot
// release a lock via a timer on this test's own event loop.
async function locked(t,path,holdMs,check) {
  const child = fork(new URL(import.meta.url),['lock-child',path,String(holdMs)],
    { execArgv:[],stdio:['ignore','ignore','pipe','ipc'] });
  let stderr=''; child.stderr.on('data',chunk=>{stderr+=chunk;});
  const exited = new Promise((resolve,reject)=>{
    child.once('error',reject); child.once('exit',(code,signal)=>resolve({code,signal}));
  });
  t.after(async()=>{if(child.exitCode === null && child.signalCode === null)child.kill();await exited;});
  await new Promise((resolve,reject)=>{
    child.once('message',message=>message === 'ready' ? resolve():reject(Error('lock readiness')));
    exited.then(result=>reject(Error('lock child exited before ready: '+JSON.stringify(result)+stderr)));
  });
  // Begin the hold interval at the first SQL call, after any fixture, CLI
  // input or filesystem work. Runner startup speed cannot consume the lock.
  let started=false;
  const mocks=['prepare','exec'].map(name=>{
    const original=DatabaseSync.prototype[name];
    return t.mock.method(DatabaseSync.prototype,name,function(...args){
      if(!started){started=true;child.send('check');}
      return original.apply(this,args);
    });
  });
  try { return await check(); }
  finally {
    for(const mock of mocks)mock.mock.restore();
    if(!started)child.send('check');
    assert.deepEqual(await exited,{code:0,signal:null},stderr);
  }
}
if (process.argv[2] === 'lock-child') {
  const db = new DatabaseSync(process.argv[3]);
  db.exec('PRAGMA journal_mode=DELETE; BEGIN EXCLUSIVE');
  process.once('message',()=>setTimeout(()=>{db.exec('ROLLBACK');db.close();process.disconnect();},Number(process.argv[4])));
  process.send('ready');
} else {

for (const holdMs of [100,6000]) test(`existing store pin under ${holdMs} ms exclusive lock`,async t=>{
  const workspace=createTestWorkspace(t,{prefix:'existing-busy-'}),path=join(workspace.path,'memory.sqlite');
  const core=openMemoryCore({path,rawConversations:{mode:'off',configureCap:false,readPolicy:()=>({generation:'synthetic',reason:'tool_off'})}}); core.close();
  const db=new DatabaseSync(path,{readOnly:true});
  const storeId=db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get().store_id; db.close();
  await locked(t,path,holdMs,async()=>{
    if (holdMs === 100) assert.deepEqual(await inspectExistingStorePin(path,storeId),{version:'schema29-existing-v1',storeId});
    else await assert.rejects(inspectExistingStorePin(path,storeId),{code:'ERR_SQLITE_ERROR',errcode:5,errstr:'database is locked',message:'database is locked'});
  });
});
}
