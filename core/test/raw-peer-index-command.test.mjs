import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../index.mjs';
import { rawCommand } from '../../adapters/mcp/raw-command.mjs';

const schema = db => JSON.stringify(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());
const present = db => Boolean(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='local_raw_message_peers'").get());
async function fixture(t, { v2=false, high=false }={}) {
  const workspace=createTestWorkspace(t),path=join(workspace.path,'offline.sqlite');
  const core=openMemoryCore({path,raw:true,rawSearch:false});await core.close();
  const db=new DatabaseSync(path);workspace.defer(()=>db.close());
  if(!v2)db.exec('DROP INDEX local_raw_message_peers');
  if(high)db.exec(`INSERT INTO raw_conversations VALUES('c','owner','personal','','codex','s',1,'2026','2026');
    INSERT INTO raw_messages(rowid,conversation_id,message_id,ordinal,role,total_units,total_bytes,assembly_state,first_event_id)
    VALUES(2000001,'c','m',1,'user',1,1,'complete','e')`);
  const mock=t.mock.method(fs,'statfsSync',directory=>{
    assert.equal(directory,dirname(path));return {bavail:1e12,bsize:1};
  });
  syncBuiltinESMExports();t.after(()=>{mock.mock.restore();syncBuiltinESMExports();});
  return {path,db,mock};
}
async function command(path, flags=[]) {
  const lines=[];const code=await rawCommand(['index','--db',path,...flags],line=>lines.push(line));
  return {code,lines};
}
for(const high of [false,true]) test(`raw index builds v1 regardless of threshold (high=${high})`,async t=>{
  const f=await fixture(t,{high});
  assert.deepEqual(await command(f.path),{code:0,lines:['index: built']});
  assert.ok(present(f.db));
  const before=schema(f.db);
  assert.deepEqual(await command(f.path),{code:0,lines:['index: present']});
  assert.equal(schema(f.db),before);assert.equal(f.mock.mock.callCount(),1);
});

test('raw index present never runs the size or space probes',async t=>{
  const f=await fixture(t,{v2:true}),prepare=DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
    assert.notEqual(sql,'SELECT max(rowid) AS n FROM raw_messages');return prepare.call(this,sql);
  });
  assert.deepEqual(await command(f.path),{code:0,lines:['index: present']});
  assert.equal(f.mock.mock.callCount(),0);
});

test('raw index refuses insufficient space before taking a write lock',async t=>{
  const f=await fixture(t),before=schema(f.db),exec=DatabaseSync.prototype.exec;
  f.mock.mock.mockImplementation(()=>({bavail:0,bsize:4096}));
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){assert.notEqual(sql,'BEGIN IMMEDIATE');return exec.call(this,sql);});
  assert.deepEqual(await command(f.path),{code:1,lines:['index: insufficient_space']});
  assert.equal(schema(f.db),before);assert.equal(present(f.db),false);
});

test('raw index reports busy after the existing 5-second timeout without retry or schema changes',async t=>{
  const f=await fixture(t),before=schema(f.db),locker=new DatabaseSync(f.path);
  locker.exec('BEGIN IMMEDIATE');const start=performance.now();
  try {
    assert.deepEqual(await command(f.path),{code:3,lines:['index: busy, close Claude Code and Codex and run again']});
    const elapsed=performance.now()-start;
    assert.ok(elapsed>=4900 && elapsed<6500,`single native busy wait: ${elapsed}`);
    assert.equal(schema(f.db),before);assert.equal(present(f.db),false);
  } finally {locker.exec('ROLLBACK');locker.close();}
});

for(const errcode of [5,6]) test(`raw index rolls back BUSY/LOCKED during DDL (${errcode})`,async t=>{
  const f=await fixture(t),before=schema(f.db),exec=DatabaseSync.prototype.exec;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    if(sql.startsWith('CREATE INDEX IF NOT EXISTS local_raw_message_peers')) {
      exec.call(this,sql);
      throw Object.assign(Error('synthetic locked build'),{code:'ERR_SQLITE_ERROR',errcode});
    }
    return exec.call(this,sql);
  });
  assert.deepEqual(await command(f.path),{code:3,lines:['index: busy, close Claude Code and Codex and run again']});
  assert.equal(schema(f.db),before);assert.equal(present(f.db),false);
});

for(const args of [['index'],['index','--db','relative'],['index','--db','/abs','--owner','owner'],['index','--db','/abs','--yes'],['index','--db','/abs','--db','/abs']])
test(`raw index validates its exact local command grammar: ${args.join(' ')}`,async()=>{
  const lines=[];assert.equal(await rawCommand(args,line=>lines.push(line)),2);
  assert.deepEqual(lines.map(JSON.parse),[{ok:false,error:{code:'invalid_raw_arguments',retryable:false}}]);
});
