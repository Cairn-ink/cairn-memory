import test from 'node:test';
import assert from 'node:assert/strict';
import { fork } from 'node:child_process';
import { Readable } from 'node:stream';
import { unlinkSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { lazyFixture,setupFixture } from './fixtures/local-setup-workspace.mjs';
import { runLocalSetupCli } from '../raw/local-setup-cli.mjs';
import { sessionId } from './fixtures/raw-fixtures.mjs';

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

for (const holdMs of [100,6000]) test(`installed Claude SessionStart under ${holdMs} ms exclusive lock`,async t=>{
  const f = await lazyFixture(t,'claude-code');
  // A missing transcript is the installed delayed-observation marker path.
  unlinkSync(f.sourcePath);
  await locked(t,f.request.databasePath,holdMs,async()=>{
    // The public hook DTO preserves its existing refusal reason past the bound.
    if (holdMs > 2000) assert.deepEqual(await f.hook(),{
      version:'local-raw-hook-v1',status:'blocked',reason:'authority_changed',
    });
    let output='';
    const code=await runLocalSetupCli(['hook','--installation',f.request.installationDirectory,'--event','SessionStart'],{
      stdin:Readable.from([JSON.stringify({hook_event_name:'SessionStart',session_id:sessionId,transcript_path:f.sourcePath})]),
      stdout:{write:text=>{output+=text;}},
    });
    assert.equal(code,0); assert.equal(output,'');
  });
  f.append('Synthetic copper saved turn');
  const stop = await f.hook('Stop');
  const db = new DatabaseSync(f.request.databasePath,{readOnly:true});
  let saved; try {saved=db.prepare('SELECT count(*) n FROM raw_messages').get().n;} finally {db.close();}
  assert.deepEqual({status:stop.status,reason:stop.reason,saved},holdMs === 100
    ? {status:'progress',reason:null,saved:1}
    : {status:'blocked',reason:'state_invalid',saved:0});
});
for (const holdMs of [100,6000]) test(`setup store validation under ${holdMs} ms exclusive lock`,async t=>{
  const f=await setupFixture(t);
  f.request.interpretationConsent=false;
  const result=await locked(t,f.request.databasePath,holdMs,()=>f.setup());
  assert.deepEqual({status:result.status,reason:result.reason},holdMs === 100
    ? {status:'prepared',reason:null}:{status:'blocked',reason:'store_invalid'});
});
}
