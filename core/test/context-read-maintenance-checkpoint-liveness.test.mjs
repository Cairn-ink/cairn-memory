import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { fixture } from '../testing/context-read-fixture.mjs';
import { local, workRow, inspect, snapshot, authenticate } from '../testing/context-product-verification-fixture.mjs';

test('one indivisible commit stall cannot refuse later turns or prevent publication',t=>{
  const f=fixture(t);
  for(let i=0;i<320;i++)f.admit('checkpoint liveness orchard '+i);
  const a=local(f.path);f.workspace.defer(()=>a.close());a.prepare();
  const initial=workRow(f.path).checkpoint,exec=DatabaseSync.prototype.exec,writers=new WeakSet();
  let stalled=false,clock=0,commits=0;
  t.mock.method(DatabaseSync.prototype,'exec',function(sql){
    const result=exec.call(this,sql);
    if(sql==='BEGIN IMMEDIATE')writers.add(this);
    if(sql==='COMMIT'&&writers.has(this)){
      commits++;
      if(!stalled){stalled=true;clock+=10000;a.setClock(clock);}
    }
    if(sql==='COMMIT'||sql==='ROLLBACK')writers.delete(this);
    return result;
  });
  a.step();
  assert.equal(commits,1,'the indivisible first commit overruns and durably advances');
  const first=inspect(f.path,snapshot);authenticate(a,first);
  assert.equal(first.generation.checkpoint,initial+1);
  const checkpoints=[initial,first.generation.checkpoint],commitsPerTurn=[commits];
  let published=false;
  for(let turn=0;turn<100;turn++){
    clock=0;commits=0;a.step(32);commitsPerTurn.push(commits);
    assert.ok(commits>0,'every following turn admits a transaction despite the previous outlier');
    const observed=a.observe();
    if(observed.publication){
      assert.equal(observed.publication.counts.byType.memory.indexed,320);published=true;break;
    }
    const next=inspect(f.path,snapshot);authenticate(a,next);
    assert.ok(next.generation.checkpoint>checkpoints.at(-1),'signed checkpoints advance on every unfinished turn');
    checkpoints.push(next.generation.checkpoint);
  }
  assert.equal(published,true,'normal commits eventually publish after the single stall');
  t.diagnostic(JSON.stringify({injectedStallMs:10000,checkpoints,commitsPerTurn,published}));
});
