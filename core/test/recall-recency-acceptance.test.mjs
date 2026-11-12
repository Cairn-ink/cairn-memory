import assert from 'node:assert/strict';
import test from 'node:test';
import { openMemoryStore } from '../index.mjs';
import { openMemoryCore } from '../contract.mjs';
import { installRecallScanClock } from '../testing/recall-scan-clock.mjs';
import { layoutFixture, installAscendingUUIDs, seed, query, baseCandidates, namespace, ns, key, model, ok } from '../testing/recall-recency-fixture.mjs';

// These are caller-side HTTP policies, not engine constructor options. The
// injected port deliberately selects only visible literal matches in both cases.
const profiles=[{}, {httpModelFallbackDeadlineMs:900,httpModelMinimumCallMs:600,
  httpModelAdaptiveLatency:true,httpModelSingleCall:false,httpModelDeterministicOnly:false}];
const ids=result=>ok(result).memories.map(row=>row.memory.id);
const remember=(scope,index,content,excerpt=content)=>scope.remember({content,kind:'fact',
  receipt:{client:'synthetic',sessionId:'acceptance',eventId:String(index),role:'user',excerpt}});

for(const layout of ['plain',53]) {
  for(const journal of ['DELETE','WAL']) for(const handle of ['existing','per-operation']) {
    test(`layout ${layout}: host acceptance, ${journal}, ${handle} handle, both phases and profiles`,async t=>{
      installAscendingUUIDs(t);
      t.mock.timers.enable({apis:['Date'],now:Date.UTC(2026,0,1)});
      const f=await layoutFixture(t,layout);
      assert.equal(f.db.prepare('PRAGMA journal_mode='+journal).get().journal_mode,journal.toLowerCase());
      const store=openMemoryStore({path:f.path}); t.after(()=>store.close());
      const scope=store.scope({ownerId:ns.ownerId});
      for(let i=0;i<1024;i++)remember(scope,i,`Synthetic ballast entry number ${i}.`,`Ballast ${i}.`);
      const ports=profiles.map(profile=>({...model(),...profile}));
      const readers=handle==='existing'?ports.map(port=>openMemoryCore({path:f.path,model:port})):[];
      t.after(()=>readers.forEach(core=>core.close()));
      const fresh=remember(scope,'fresh','quartzneedle is the fresh explicit memory.');
      assert.equal(f.db.prepare("SELECT count(*) AS n FROM memories WHERE currentness='current' AND id<?").get(fresh.id).n,1024);
      const row=f.db.prepare('SELECT * FROM memories WHERE id=?').get(fresh.id);
      assert.equal(row.origin,'explicit'); assert.equal(row.currentness,'current');
      assert.equal(row.review_state,'none'); assert.equal(row.deleted,0);
      for(const phase of ['immediate','aged']) {
        if(phase==='aged')t.mock.timers.tick(180001);
        for(let profile=0;profile<profiles.length;profile++) {
          const read=async(method,input)=>{
            const core=readers[profile]??openMemoryCore({path:f.path,model:ports[profile]});
            try{return await core[method](input);}
            finally{if(!readers[profile])core.close();}
          };
          // Each per-operation call gets a separate cold connection, including
          // each public map continuation. Existing readers predate fresh admission.
          assert.equal((await read('get',{namespace,memoryId:fresh.id})).ok,true);
          const unfiled=[]; let cursor;
          do {
            const page=ok(await read('map',{namespace,purpose:'recall',tokenBudget:4000,...(cursor?{cursor}:{})}));
            unfiled.push(...page.items.filter(item=>item.type==='unfiled'));
            cursor=page.nextCursor;
          }while(cursor);
          assert.equal(unfiled.length,1025);
          assert.ok(unfiled.some(item=>item.ref.memoryId===fresh.id));
          const base=baseCandidates(f.db,'quartzneedle').rows.filter(row=>row.item.label.includes('quartzneedle'))
            .map(row=>row.item.ref.memoryId);
          const actual=ids(await read('recall',{readSet:[namespace],query:'quartzneedle',limit:6}));
          assert.deepEqual(base,[]); assert.deepEqual(actual,[fresh.id]);
          t.diagnostic('HOST_ACCEPTANCE '+JSON.stringify({layout,journal,handle,phase,profile,base,new:actual}));
        }
      }
    });
  }

  test(`layout ${layout}: large namespace newest write, frozen timestamps and honest truncation`,async t=>{
    const frames=[],f=await layoutFixture(t,layout,model(frames));
    const ascending=index=>'00000000-0000-4000-8000-'+String(index).padStart(12,'0');
    seed(f.db,6500,ns,0,ascending);
    installAscendingUUIDs(t,6500);
    const store=openMemoryStore({path:f.path});t.after(()=>store.close());
    const fresh=remember(store.scope({ownerId:ns.ownerId}),'fresh','quartzneedle is the fresh explicit memory.');
    assert.equal(fresh.id,ascending(6501));
    assert.ok(f.db.prepare('SELECT updated_at FROM memories WHERE id=?').get(fresh.id).updated_at>
      f.db.prepare('SELECT max(updated_at) AS time FROM memories WHERE id!=?').get(fresh.id).time);
    // This first recall uses the real monotonic budget, without a fake clock.
    assert.deepEqual(ids(await f.core.recall({readSet:[namespace],query:'quartzneedle',limit:6})),[fresh.id]);
    let now=0;const clock=installRecallScanClock(t,()=>now);
    // Timestamp storage is ISO-8601 at millisecond resolution. In a frozen
    // write tick recency becomes ID ASC; deliberately put the match last.
    f.db.exec("UPDATE memories SET updated_at='2026-01-01T00:00:00.000Z'");
    const last=f.db.prepare('SELECT id FROM memories ORDER BY id DESC LIMIT 1').get().id;
    assert.equal(last,fresh.id);
    clock(()=>now++ * 500);
    const frozen=query(f.runtime,'quartzneedle');
    assert.equal(frozen.scanBoundary.rows,1024);
    assert.ok(frozen.rows.every(row=>row.item.ref.memoryId!==fresh.id));
    assert.deepEqual(ids(await f.core.recall({readSet:[namespace],query:'quartzneedle',limit:6})),[]);
    t.diagnostic('FROZEN_TIMESTAMP '+JSON.stringify({layout,rows:frozen.scanBoundary.rows,found:false}));
    f.db.prepare('UPDATE memories SET content=?,updated_at=? WHERE id=?')
      .run('oldstrong alpha beta gamma','2025-12-31T00:00:00.000Z',last);
    const bounded=query(f.runtime,'oldstrong alpha beta gamma');
    assert.equal(bounded.scanBoundary.rows,1024); assert.equal(bounded.scanBoundary.stop,'budget');
    assert.ok(bounded.rows.every(row=>row.item.ref.memoryId!==last));
    frames.length=0;
    const recalled=await f.core.recall({readSet:[namespace],query:'oldstrong alpha beta gamma',limit:6});
    assert.deepEqual(ids(recalled),[]);assert.equal(recalled.value.coverage,'budget_exhausted');
    const maps=frames.filter(frame=>frame.items.every(item=>typeof item.type==='string'));
    assert.ok(maps.length);
    for(const page of maps){
      assert.equal(page.exhausted,false);assert.equal(Object.hasOwn(page,'partialReason'),false);
      assert.deepEqual(Object.keys(page).sort(),['items','nextCursor','exhausted','truncatedBy','indexRevision','invalidRefs'].sort());
    }
  });

  test(`layout ${layout}: deterministic newest timestamp group precedes every older row`,async t=>{
    installRecallScanClock(t);
    const f=await layoutFixture(t,layout); seed(f.db,2002);
    const tie='2026-01-01T00:00:00.001Z';
    f.db.prepare('UPDATE memories SET updated_at=?').run(tie);
    f.db.prepare('UPDATE memories SET updated_at=? WHERE id=?').run('2026-01-01T00:00:00.002Z',key(2002));
    f.db.prepare('UPDATE memories SET updated_at=? WHERE id=?').run('2026-01-01T00:00:00.000Z',key(1));
    const seen=[];
    const result=query(f.runtime,'note',{score(text){seen.push(Number(/distinctive(\d+)/.exec(text)[1]));return 1;}});
    const tied=Array.from({length:2000},(_,i)=>i+2).sort((a,b)=>key(a)<key(b)?-1:1);
    assert.deepEqual(seen,[2002,...tied,1]); assert.equal(result.scanBoundary.rows,2002);
  });

  test(`layout ${layout}: ordinary remember with 1,000 ballast matches base IDs and order`,async t=>{
    installAscendingUUIDs(t); installRecallScanClock(t);
    const f=await layoutFixture(t,layout),store=openMemoryStore({path:f.path}); t.after(()=>store.close());
    const scope=store.scope({ownerId:ns.ownerId});
    for(let i=0;i<1000;i++)remember(scope,i,`Synthetic ballast entry number ${i}.`,`Ballast ${i}.`);
    const fresh=remember(scope,'fresh','quartzneedle is the fresh explicit memory.');
    const base=baseCandidates(f.db,'quartzneedle');
    assert.deepEqual(query(f.runtime,'quartzneedle').rows,base.rows);
    const expected=base.rows.filter(row=>row.item.label.includes('quartzneedle')).slice(0,6).map(row=>row.item.ref.memoryId);
    assert.deepEqual(expected,[fresh.id]);
    assert.deepEqual(ids(await f.core.recall({readSet:[namespace],query:'quartzneedle',limit:6})),expected);
  });
}
