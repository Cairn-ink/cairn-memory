import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from '../testing/context-read-fixture.mjs';
import { local } from '../testing/context-product-verification-fixture.mjs';

for(const mode of ['DELETE','WAL'])test(`oversized verification rollback rechecks integrity before same-refresh writes (${mode})`,t=>{
  const f=fixture(t);f.admit('oversized verification token');
  const canonical=new DatabaseSync(f.path);
  try {canonical.prepare('UPDATE memories SET content=?,revision=revision+1').run('x'.repeat(120000));canonical.exec('UPDATE namespace_epochs SET epoch=epoch+1');}
  finally {canonical.close();}
  const a=local(f.path,{mode,enabled:true});f.workspace.defer(()=>a.close());
  a.prepare();
  const events=[],prepare=DatabaseSync.prototype.prepare,exec=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    const statement=Reflect.apply(prepare,this,[sql]),db=this;
    if(sql!=='PRAGMA quick_check'&&sql!=='PRAGMA foreign_key_check')return statement;
    return new Proxy(statement,{get(target,key){const value=Reflect.get(target,key,target);if(typeof value!=='function')return value;
      return (...args)=>{const result=Reflect.apply(value,target,args);if(key==='get')events.push({db,sql});return result;};}});
  });
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    const result=Reflect.apply(exec,this,[sql]);events.push({db:this,sql});return result;
  });
  a.step();
  const rollback=events.findIndex(event=>event.sql==='ROLLBACK TO verification_chunk; RELEASE verification_chunk');
  assert.ok(rollback>=0,'oversized token naturally exceeds the verification meter inside a savepoint');
  const continuation=events.findIndex((event,index)=>index>rollback&&event.sql==='BEGIN IMMEDIATE');
  assert.ok(continuation>rollback,'legacy fallback still writes within the same refresh');
  const next=events[continuation],checks=events.slice(rollback+1,continuation).filter(event=>event.db===next.db);
  assert.ok(checks.some(event=>event.sql==='PRAGMA quick_check')&&checks.some(event=>event.sql==='PRAGMA foreign_key_check'),
    'both integrity checks must succeed before the first writable transaction after a caught rollback');
  assert.notEqual(next.db,events[rollback].db,'fallback uses a freshly opened native connection');
  for(let i=rollback+1;i<events.length;i++)if(events[i].sql==='BEGIN IMMEDIATE'||events[i].sql==='PRAGMA incremental_vacuum(32)')
    assert.notEqual(events[i].db,events[rollback].db,'no later writable step reuses the rolled-back connection');
  assert.equal(a.observe().dto.lexical.state,'ready','fallback still completes verification and publication');
  const metrics=a.attribution.snapshot();
  assert.deepEqual(Object.fromEntries(Object.entries(metrics).filter(([key])=>key.startsWith('verification'))),
    {verificationUnits:8,verificationRows:10,verificationCommitAttempts:3,verificationCommits:3,verificationRollbacks:2},
    'fallback retains the reviewed verification work, commit and rollback accounting');
  t.diagnostic(JSON.stringify(Object.fromEntries(Object.entries(metrics).filter(([key])=>/verification|Commit|Rollbacks/.test(key)))));
});
