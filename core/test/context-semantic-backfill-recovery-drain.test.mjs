import test from 'node:test';
import assert from 'node:assert/strict';
import { scenario, balance, checkpoint, until, ns, ok } from './fixtures/context-semantic-backfill-recovery-host.mjs';
import { openMemoryCore } from '../index.mjs';
import { receipt } from '../testing/context-read-fixture.mjs';

const cachedVectors=s=>s.sidecar(db=>db.prepare('SELECT count(*) n FROM semantic_vectors').get().n,true);

test('R01 gate-off exact equality preserves zero embedded and zero cached vectors',async t=>{
  const s=await scenario(t,{base:balance,enabled:false});
  assert.equal(ok(await s.refresh()).progress.embedded,0);
  assert.equal(cachedVectors(s),0);
  assert.equal((await s.status()).refresh.phase,'blocked');
  assert.equal((await s.status()).refresh.backfillUsdCharged,balance);
});

test('R01 gate-on exact equality drains only the paid batch and certifies after restart without dispatch',async t=>{
  const s=await scenario(t,{base:balance});
  const refresh=ok(await s.refresh());
  assert.equal(refresh.progress.embedded,2,'the exact-balance settled batch reaches the writer');
  assert.equal(cachedVectors(s),2);
  assert.equal((await s.status()).refresh.phase,'blocked');
  assert.equal((await s.status()).refresh.backfillUsdCharged,balance);
  const sent=s.state[6];
  assert.equal(ok(await s.validate()).status,'partial');
  await s.restart({enabled:true});
  assert.equal(ok(await s.refresh('history')).progress.embeddingAttempts,0);
  assert.equal(ok(await s.validate()).status,'complete');
  assert.equal((await s.status()).refresh.phase,'steady');
  assert.equal(s.state[6],sent);
  assert.equal(s.read().blocked,false);
});

test('R02 in-flight and undisposed unknown work refuse grants and stay conservatively charged',async t=>{
  const s=await scenario(t,{base:balance});s.state[7]=7;
  const refresh=s.refresh();
  try {
    await until(()=>s.state[10]===1);
    const status=await s.status();
    assert.equal(status.refresh.backfillUsdReserved,balance);
    const input=s.intent();s.approve(input);
    assert.equal((await s.grant(input)).error.code,'read_in_progress');
    s.state[7]=3;
  }finally{s.unpause();}
  assert.equal(ok(await refresh).progress.embedded,0);
  assert.equal(Object.values(s.read().reservations)[0].status,'unknown');
  assert.equal((await s.status()).refresh.backfillUsdCharged,balance);
  assert.equal(ok(await s.validate()).status,'partial');
  const input=s.intent(),before=s.row();s.approve(input);
  assert.equal((await s.grant(input)).error?.code,'read_in_progress');
  assert.deepEqual(s.row(),before);
  s.settings('disposed',1);
  assert.equal(ok(await s.grant(input)).status,'granted');
});

test('R03 certification-only rows are removed by disable and complete purge without spend',async t=>{
  const s=await scenario(t);s.latch();
  const counts=()=>s.sidecar(db=>[
    db.prepare('SELECT count(*) n FROM vector_generations').get().n,
    db.prepare('SELECT count(*) n FROM vector_rows').get().n,
    db.prepare('SELECT count(*) n FROM vector_publications').get().n,
    db.prepare('SELECT count(*) n FROM vector_validation_records').get().n,
  ],true);
  const reservations=s.read().reservations;
  assert.deepEqual(s.read().catalog,{});
  assert.equal(ok(await s.refresh()).progress.embeddingAttempts,0);
  assert.deepEqual(counts(),[1,2,1,1]);
  assert.deepEqual(s.read().reservations,reservations);
  assert.equal(s.state[6],0);
  ok(await s.set(false,1));
  assert.equal(ok(await s.purge()).status,'complete');
  assert.deepEqual(counts(),[0,0,0,0]);
});

test('R04 revocation during the coverage hint refuses delivery of a drained refresh',async t=>{
  const s=await scenario(t,{base:balance});s.state[7]=7;
  const refresh=s.refresh();
  try {
    await until(()=>s.state[10]===1);
    s.arm(checkpoint.holdPrepare,{expected:{sequence:s.read().sequence+1}});
    Atomics.store(s.state,11,1);Atomics.notify(s.state,11);
    await Promise.race([until(()=>s.settings('reached')===1),refresh.then(()=>assert.fail('refresh returned before the hint'))]);
    assert.equal(cachedVectors(s),2);
    s.state[0]=0;
  }finally{s.unpause();}
  const result=await refresh;
  s.state[0]=1;
  assert.equal(result.ok,false);
  assert.equal(result.error.code,'scope_changed');
  assert.equal((await s.status()).refresh.backfillUsdCharged,balance);
});

test('R05 ordinary zero-dollar history refresh certifies warm current vectors with either startup setting',async t=>{
  let ordinary;
  for(const enabled of [false,true]) {
    await t.test(`recovery enabled = ${enabled}`,async t=>{
      const s=await scenario(t,{enabled});
      assert.equal(ok(await s.refresh()).status,'complete');
      assert.equal((await s.status()).refresh.phase,'backfill');
      assert.equal(s.sidecar(db=>db.prepare('SELECT count(*) n FROM vector_publications').get().n,true),1);
      const sent=s.state[6];
      const result=ok(await s.refresh('history','embeddings','0'));
      assert.equal(result.status,'complete');
      assert.equal(result.progress.embeddingAttempts,0);
      assert.equal(s.state[6],sent);
      if(enabled)assert.deepEqual(result,ordinary);
      else ordinary=result;
    });
  }
});

test('disposal releases a definite reserve and charges an ambiguous send without replay',async t=>{
  const s=await scenario(t);
  s.seed(row=>{
    row.blocked=true;
    row.reservations.release={kind:'refresh',phase:'backfill',status:'reserved',day:0,items:1,cost:'2000'};
    row.reservations.ambiguous={kind:'refresh',phase:'backfill',status:'may_transmit',day:0,items:1,cost:'3000'};
  });
  await assert.rejects(s.restart(),{code:'read_in_progress'});
  s.settings('disposed',1);await s.restart();
  const {release,ambiguous}=s.read().reservations;
  assert.equal(release.status,'released');assert.equal(ambiguous.status,'unknown');
  assert.equal((await s.status()).refresh.backfillUsdCharged,'0.000000003');
  assert.equal((await s.status()).refresh.phase,'blocked');assert.equal(s.state[6],0);
});

for(const race of ['correction','revoked access'])test('a paid result cannot cross '+race,async t=>{
  const s=await scenario(t,{base:balance});s.state[7]=7;
  const refresh=s.refresh();
  try {
    await until(()=>s.state[10]===1);
    if(race==='correction'){
      const writer=openMemoryCore({path:s.f.path}), memory=s.memories[0],content='updated synthetic revision';
      try{ok(writer.correct({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision,content,kind:'fact',receipt:receipt(content)}));}
      finally{writer.close();}
    }else s.state[0]=0;
  }finally{s.unpause();}
  const result=await refresh;s.state[0]=1;
  if(race==='correction')assert.equal(ok(result).progress.embedded,0);
  else assert.equal(result.error.code,'scope_changed');
  assert.equal(s.sidecar(db=>db.prepare('SELECT count(*) n FROM semantic_vectors').get().n,true),0);
  assert.equal((await s.status()).refresh.backfillUsdCharged,balance);
  assert.equal(s.state[6],1);
});

test('the final coverage pass detects same-version certificate removal after prepare',async t=>{
  const s=await scenario(t,{base:balance});
  ok(await s.refresh());ok(await s.refresh('history'));
  const sent=s.state[6], intent=s.intent();intent.expected.sequence++;
  s.arm(checkpoint.holdPrepare,intent);
  const validating=s.validate();
  try {
    await Promise.race([until(()=>s.settings('reached')===1),validating.then(()=>assert.fail('validation returned before final prepare'))]);
    s.sidecar(db=>db.prepare('DELETE FROM vector_publications').run());
  }finally{s.unpause();}
  assert.equal(ok(await validating).status,'partial');
  assert.equal((await s.status()).refresh.phase,'blocked');
  assert.equal(s.anchor().pending,null);assert.equal(s.state[6],sent);
});
