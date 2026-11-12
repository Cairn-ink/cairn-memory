import '../testing/context-product-test-clock.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { semanticFixture,ns } from '../testing/context-semantic-pause-fixture.mjs';

for(const operation of ['query','refresh'])for(const mode of [9,10])test(`product ${operation} refuses ${mode===9?'pause':'disable'} committed by another process inside transport validation`,async t=>{
  const s=await semanticFixture(t,[ns],{transmissionSnapshot:true});
  const db=new DatabaseSync(s.f.path);t.after(()=>db.close());
  assert.equal(db.prepare('PRAGMA journal_mode').get().journal_mode,'wal');
  if(operation==='refresh') {
    db.prepare("UPDATE memories SET content=content||' changed',revision=revision+1 WHERE owner_id=?").run(ns.ownerId);
    db.prepare('UPDATE namespace_epochs SET epoch=epoch+1 WHERE owner_id=?').run(ns.ownerId);
    await s.refresh('lexical');
  }
  const before=s.view[6],acknowledgements=s.view[10];s.view[8]=mode;
  const result=operation==='query'?await s.query(true):await s.refresh();
  assert.equal(s.view[10],acknowledgements+1,'writer acknowledged within the final validation snapshot');
  assert.equal(s.view[6],before,'zero entries in the recording transport after beforeDispatch');
  assert.equal(s.view[11],1,'same budget_denied transport refusal as the pre-send pause guard');
  const control=db.prepare('SELECT paused,enabled FROM episode_controls WHERE owner_id=? AND scope=? AND project_id=?').get(ns.ownerId,ns.scope,ns.projectId);
  assert.equal(mode===9?control.paused:control.enabled,mode===9?1:0,'canonical control really committed');
  if(operation==='query') {
    assert.deepEqual(result,{ok:false,error:{code:'snapshot_stale',retryable:false}},'the real control writer also advances the namespace epoch');
  }else {
    assert.equal(result.progress.embedded,0);
    assert.equal(result.status,'rebuilding');
  }
});
