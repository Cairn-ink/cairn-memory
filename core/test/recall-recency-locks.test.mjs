import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { QUERY_CANDIDATES } from '../query-candidates.mjs';
import { installRecallScanClock } from '../testing/recall-scan-clock.mjs';
import { layoutFixture, seed, query, namespace, key, marker, model, ok } from '../testing/recall-recency-fixture.mjs';

for (const layout of ['plain',53]) {
  test(`layout ${layout}: one floor transaction, bounded try-once tail, restored timeout`, async t => {
    let now=0; installRecallScanClock(t,()=>now);
    const f=await layoutFixture(t,layout); seed(f.db,2049);
    f.db.exec('PRAGMA busy_timeout=1234');
    const exec=f.db.exec.bind(f.db), holds=[];
    let began, scored=0, previous=0;
    t.mock.method(f.db,'exec',sql=>{
      assert.notEqual(sql,'BEGIN IMMEDIATE');
      const value=exec(sql);
      if(sql==='BEGIN') began=now;
      if(sql==='COMMIT'&&scored>previous) {
        holds.push({rows:scored-previous,ms:now-began}); previous=scored;
      }
      return value;
    });
    const result=query(f.runtime,'note',{score(){scored++;now+=0.1;return 1;}});
    assert.equal(result.scanBoundary.rows,2049);
    assert.equal(holds[0].rows,1024);
    assert.ok(holds.length>1);
    assert.ok(holds.slice(1).every(h=>h.rows<=QUERY_CANDIDATES.page&&h.ms<QUERY_CANDIDATES.pageMs+0.11));
    assert.equal(f.db.prepare('PRAGMA busy_timeout').get().timeout,1234);
    assert.equal(f.db.isTransaction,false);
  });

  test(`layout ${layout}: BEGIN time consumes budget but never shortens the floor`, async t => {
    let now=0; installRecallScanClock(t,()=>now);
    const f=await layoutFixture(t,layout); seed(f.db,2049);
    const exec=f.db.exec.bind(f.db); let begins=0;
    t.mock.method(f.db,'exec',sql=>{
      const result=exec(sql);
      if(sql==='BEGIN'){begins++;now+=500;}
      return result;
    });
    const result=query(f.runtime,'note');
    assert.equal(result.scanBoundary.rows,1024);
    assert.equal(result.scanBoundary.stop,'budget');
    assert.equal(result.scanExhausted,false); assert.equal(begins,1);
  });

  for (const movementAt of ['floor','tail','placement']) test(`layout ${layout}: epoch movement at ${movementAt} returns only the placed E0 floor`, async t => {
    installRecallScanClock(t);
    const f=await layoutFixture(t,layout); seed(f.db,2049);
    const setClock=installRecallScanClock(t,()=>1000);
    // First compute the identical floor with an exhausted clock.
    let ticks=0; setClock(()=>ticks++*500);
    const floor=query(f.runtime,'note'); setClock(()=>0);
    const writer=openMemoryCore({path:f.path,model:model()}); t.after(()=>writer.close());
    const exec=f.db.exec.bind(f.db); let commits=0, changed=false;
    const target=movementAt==='floor'?1:movementAt==='tail'?2:6;
    t.mock.method(f.db,'exec',sql=>{
      const result=exec(sql);
      if(sql==='COMMIT'&&++commits===target) {
        // A tail memory is forgotten while the scan has released SHARED.
        ok(writer.forget({namespace,memoryId:key(1),expectedRevision:1})); changed=true;
      }
      return result;
    });
    let scored=0;
    const result=query(f.runtime,'note',{score(){scored++;return 1;}});
    assert.equal(scored,movementAt==='floor'?1024:movementAt==='tail'?1280:2049);
    assert.equal(changed,true);
    assert.equal(result.epoch,floor.epoch);
    assert.deepEqual(result.rows,floor.rows);
    assert.equal(result.scanBoundary.rows,1024);
    assert.equal(result.scanBoundary.stop,'changed'); assert.equal(result.scanExhausted,false);
    assert.ok(result.rows.every(row=>row.item.ref.memoryId!==key(1)));
    assert.throws(()=>query(f.runtime,'note',{scanBoundary:result.scanBoundary,expectedEpoch:result.epoch}),
      error=>error.code==='cursor_stale');
  });

  test(`layout ${layout}: BUSY is caught before safety; same connection recalls and captures afterward`, async t => {
    installRecallScanClock(t);
    const port={...model(),
      extract:()=>({items:[{content:'Synthetic capture after contention',kind:'fact',confidence:0.7,sourceIndices:[0]}]}),
      classify:({input})=>({items:input.memories.map(memory=>({memoryId:memory.id,parentIds:[],
        newL1:{title:'Synthetic captures',parentL2Ids:[]}}))})};
    const f=await layoutFixture(t,layout,port); seed(f.db,2049);
    const writer=new DatabaseSync(f.path); writer.exec('PRAGMA busy_timeout=0');
    t.after(()=>{if(writer.isTransaction)writer.exec('ROLLBACK');writer.close();});
    const prepare=DatabaseSync.prototype.prepare, exec=DatabaseSync.prototype.exec;
    let reader, locked=false, released=false, tailProbes=0;
    t.mock.method(DatabaseSync.prototype,'prepare',function(sql){
      if(sql.startsWith('SELECT id, revision, updated_at FROM memories'))reader=this;
      if(this===reader&&sql.startsWith('SELECT epoch FROM namespace_epochs WHERE owner_id = ?'))tailProbes++;
      return prepare.call(this,sql);
    });
    t.mock.method(DatabaseSync.prototype,'exec',function(sql){
      const value=exec.call(this,sql);
      if(this===reader&&sql==='COMMIT'&&!locked){writer.exec('BEGIN EXCLUSIVE');locked=true;}
      if(this===reader&&sql==='PRAGMA busy_timeout=5000'&&locked&&!released){writer.exec('ROLLBACK');released=true;}
      return value;
    });
    const stopped=ok(await f.core.recall({readSet:[namespace],query:marker(2049)}));
    assert.equal(locked,true); assert.equal(released,true); assert.equal(tailProbes,1);
    assert.equal(stopped.coverage,'budget_exhausted');
    assert.equal(Object.hasOwn(stopped,'partialReason'),false);
    assert.equal(reader.prepare('PRAGMA busy_timeout').get().timeout,5000);
    assert.equal(reader.isTransaction,false);
    const sameReader=reader;
    ok(await f.core.recall({readSet:[namespace],query:marker(2049)}));
    assert.equal(reader,sameReader);
    const captured=ok(await f.core.capture({namespace,client:'synthetic',sessionId:'busy-tail',eventId:'after',
      messages:[{id:'after',role:'user',content:'Synthetic capture after contention'}]}));
    assert.equal(captured.admission.memories.length,1);
    assert.equal(captured.classification.status,'applied');
    assert.equal(reader,sameReader);
    assert.equal(ok(f.core.get({namespace,memoryId:captured.admission.memories[0].id})).memory.content,
      'Synthetic capture after contention');
  });

  test(`layout ${layout}: a busy continuation fails cursor_stale and restores a custom timeout`, async t => {
    installRecallScanClock(t);
    const f=await layoutFixture(t,layout); seed(f.db,2049);
    const first=query(f.runtime,'note');
    f.db.exec('PRAGMA busy_timeout=1234');
    const writer=new DatabaseSync(f.path); t.after(()=>{if(writer.isTransaction)writer.exec('ROLLBACK');writer.close();});
    const exec=f.db.exec.bind(f.db); let locked=false;
    t.mock.method(f.db,'exec',sql=>{
      const value=exec(sql);
      if(sql==='COMMIT'&&!locked){writer.exec('BEGIN EXCLUSIVE');locked=true;}
      if(sql==='PRAGMA busy_timeout=1234'&&writer.isTransaction)writer.exec('ROLLBACK');
      return value;
    });
    assert.throws(()=>query(f.runtime,'note',{scanBoundary:first.scanBoundary,expectedEpoch:first.epoch,
      expectedSuppressionEpoch:first.suppressionEpoch}),error=>error.code==='cursor_stale');
    assert.equal(locked,true);
    assert.equal(f.db.prepare('PRAGMA busy_timeout').get().timeout,1234);
    assert.equal(f.db.isTransaction,false);
    assert.deepEqual(query(f.runtime,'note').rows,first.rows);
  });

  test(`layout ${layout}: final placement BUSY drops the tail; later statement errors propagate`,async t=>{
    installRecallScanClock(t);
    const f=await layoutFixture(t,layout);seed(f.db,2049);
    const writer=new DatabaseSync(f.path);t.after(()=>{if(writer.isTransaction)writer.exec('ROLLBACK');writer.close();});
    const exec=f.db.exec.bind(f.db);let commits=0,locked=false,placementAttempted=false;
    t.mock.method(f.db,'exec',sql=>{
      const value=exec(sql);
      // Floor plus five tail scans have completed. The next transaction is
      // placement of new top-K candidates and must acquire SHARED try-once.
      if(sql==='COMMIT'&&++commits===6){writer.exec('BEGIN EXCLUSIVE');locked=true;}
      if(sql==='PRAGMA busy_timeout=0'&&locked)placementAttempted=true;
      if(sql==='PRAGMA busy_timeout=5000'&&placementAttempted&&writer.isTransaction)writer.exec('ROLLBACK');
      return value;
    });
    const stopped=query(f.runtime,'note');
    assert.equal(locked,true);assert.equal(stopped.scanBoundary.rows,1024);
    assert.equal(stopped.scanBoundary.stop,'budget');assert.equal(stopped.scanExhausted,false);
    const expected=query(f.runtime,'note',{scanBoundary:stopped.scanBoundary,expectedEpoch:stopped.epoch});
    assert.deepEqual(stopped,expected);
    let calls=0;
    const failure=Object.assign(new Error('synthetic later-statement busy'),{code:'ERR_SQLITE_ERROR',errcode:5});
    assert.throws(()=>query(f.runtime,'note',{score(){if(++calls===1025)throw failure;return 1;}}),error=>error===failure);
    assert.equal(f.db.prepare('PRAGMA busy_timeout').get().timeout,5000);
    assert.equal(f.db.isTransaction,false);
    assert.equal(query(f.runtime,'note').scanBoundary.rows,2049);
  });
}
