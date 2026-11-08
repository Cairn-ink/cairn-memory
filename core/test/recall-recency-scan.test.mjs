import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { createMemoryRuntime } from '../runtime.mjs';
import { openMemoryCore } from '../contract.mjs';
import { createQueryScore, QUERY_CANDIDATES, QUERY_SCAN_BUDGET_MS } from '../query-candidates.mjs';
import { createQueryExcerpt } from '../query-excerpt.mjs';
import { installRecallScanClock } from '../testing/recall-scan-clock.mjs';
import { fixture, seed, query, baseCandidates, namespace, ns, key, marker, model, ok } from '../testing/recall-recency-fixture.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside, withContentSuppressionRequest } from '../content-suppression-storage.mjs';

for (const count of [0,1,100,1024]) for (const sourceReceiptLimit of [0,4]) {
  test(`base parity: ${count} current rows, receipt limit ${sourceReceiptLimit}`, async t => {
    installRecallScanClock(t);
    const frames = [], f = fixture(t, model(frames)); seed(f.db, count);
    for (const text of ['note', 'sourceonly1', 'absent']) {
      const base = baseCandidates(f.db, text, sourceReceiptLimit);
      const result = query(f.runtime, text, { sourceReceiptLimit });
      assert.deepEqual(result.rows, base.rows);
      assert.equal(result.scanExhausted, base.scanExhausted);
      assert.equal(result.scanBoundary.rows, count);
      frames.length = 0;
      ok(await f.core.recall({ readSet: [namespace], query: text,
        ...(sourceReceiptLimit ? { contextMode: 'source-evidence' } : {}) }));
      const maps = frames.filter(frame => frame.items.every(item => typeof item.type === 'string'));
      assert.ok(maps.length);
      for (let i = 0; i < maps.length; i++) {
        assert.deepEqual(maps[i].items, base.rows.slice(i*100,(i+1)*100).map(r => r.item));
        assert.equal(maps[i].exhausted, (i+1)*100 >= base.rows.length && base.scanExhausted);
      }
    }
  });
}

for (const count of [1025,2049,6500]) test(`fresh notes found at default limit: ${count}`, async t => {
  const f = fixture(t); seed(f.db,count);
  const prefix = new Set(baseCandidates(f.db,'absent').rows.map(r => r.item.ref.memoryId));
  let baseHits = 0, newHits = 0;
  for (let i = count-49; i <= count; i++) {
    if (prefix.has(key(i))) baseHits++;
    const result = ok(await f.core.recall({ readSet: [namespace], query: marker(i) }));
    if (result.memories.some(row => row.memory.id === key(i))) newHits++;
  }
  t.diagnostic('FRESH_NOTES ' + JSON.stringify({ count, baseHits, newHits, total: 50 }));
  assert.equal(newHits,50);
});

test('ranking retains older stronger matches ahead of newer weaker matches', t => {
  installRecallScanClock(t);
  const f = fixture(t); seed(f.db,2049);
  f.db.prepare('UPDATE memories SET content=? WHERE id=?').run('alpha beta gamma old strong note',key(1));
  f.db.prepare('UPDATE memories SET content=? WHERE id=?').run('alpha newest weak note',key(2049));
  const result = query(f.runtime,'alpha beta gamma');
  assert.equal(result.rows[0].item.ref.memoryId,key(1));
  assert.equal(result.rows[1].item.ref.memoryId,key(2049));
  assert.equal(result.rows.length,1024);
});

// Expose the private mapper in a temporary source copy. The production module
// and its public facade gain no test option or additional method.
async function mapHarness(f) {
  const original = new URL('../contract.mjs',import.meta.url);
  let source = readFileSync(original,'utf8');
  source = source.replace('  internal?.attachCapture?.(',
    '  internal?.attachRecallMap?.(mapPage);\n  internal?.attachCapture?.(');
  source = source.replace(/(\bfrom\s*['"])(\.[^'"]+)(['"])/g,
    (_,start,specifier,end) => start+new URL(specifier,original).href+end);
  const path = join(f.workspace.path,'contract-map.mjs'); writeFileSync(path,source);
  const { createMemoryCore } = await import(pathToFileURL(path).href);
  let map;
  const core = createMemoryCore({ path: f.path, model: model() }, { attachRecallMap(fn) { map=fn; } });
  f.workspace.defer(() => core.close());
  return (cursor, text = 'note') => map({ namespace, limit: 100, ...(cursor ? { cursor } : {}) }, {
    pages: new Map(), score: createQueryScore(text), excerpt: createQueryExcerpt(text), queryDigest: 'synthetic-digest',
  });
}

test('budget spends no less than floor; signed cursor replays the exact boundary across cold calls', async t => {
  let now = 0;
  const setClock = installRecallScanClock(t, () => now);
  const f = fixture(t); seed(f.db,2049);
  const score = createQueryScore('note'); let scored = 0;
  const first = query(f.runtime,'note',{ score(text) { scored++; now += 1; return score(text); } });
  assert.equal(QUERY_SCAN_BUDGET_MS,400);
  assert.equal(scored,1024); assert.equal(first.scanBoundary.rows,1024);
  assert.equal(first.scanBoundary.stop,'budget'); assert.equal(first.scanExhausted,false);
  now = 0;
  const map = await mapHarness(f);
  let ticks = 0;
  // Every monotonic sample advances the fake clock: the floor still applies.
  setClock(() => ticks++);
  const page1 = ok(map());
  const payload = JSON.parse(Buffer.from(page1.nextCursor.split('.')[0],'base64url'));
  assert.equal(payload.a.scanBoundary.rows,1024);
  assert.equal(payload.a.scanBoundary.stop,'budget');
  setClock(() => 0); // A fresh budget would discover a different candidate set.
  const page2 = ok(map(page1.nextCursor));
  const rebuilt = query(f.runtime,'note',{ scanBoundary: payload.a.scanBoundary, expectedEpoch: payload.e });
  assert.notDeepEqual(query(f.runtime,'note').rows,rebuilt.rows,
    'applying a fresh budget would change the retained list on this same store');
  assert.deepEqual([...page1.items,...page2.items],rebuilt.rows.slice(0,200).map(r=>r.item));
  assert.equal(new Set([...page1.items,...page2.items].map(r=>r.ref.memoryId)).size,200);
  assert.equal(page1.exhausted,false); assert.equal(page2.exhausted,false);
  ok(f.core.admit({ namespace, memory: { content:'new epoch note',kind:'fact' },
    receipts:[{client:'synthetic',sessionId:'cursor',eventId:'new',role:'user',excerpt:'new epoch note'}] }));
  assert.equal(map(page1.nextCursor).error?.code,'cursor_stale');
});

test('residual history/review filters consume physical rows and budget without scoring', t => {
  let now = 0; installRecallScanClock(t,()=>now++);
  const f = fixture(t); seed(f.db,2049);
  f.db.exec("UPDATE memories SET currentness='historical' WHERE updated_at > '2026-01-01T00:17:04.000Z'");
  const result = query(f.runtime,'note',{ score() { assert.fail('historical text scored'); } });
  // No content callbacks are needed for elapsed time to stop the physical scan.
  assert.equal(result.scanBoundary.rows,1024); assert.equal(result.rows.length,0);
  assert.equal(result.scanExhausted,false);
});

test('foreign owner and project rows never reach physical pages or the scorer', t => {
  installRecallScanClock(t);
  const f = fixture(t); seed(f.db,100);
  const before = query(f.runtime,'note');
  seed(f.db,2049,{ ...ns,ownerId:'foreign-owner' },10000);
  seed(f.db,2049,{ ...ns,scope:'project',projectId:'foreign-project' },20000);
  const after = query(f.runtime,'note');
  assert.deepEqual(after,before);
  assert.equal(after.scanBoundary.rows,100);
});

test('DELETE writer commits between pages; one epoch change restarts and forget is absent', t => {
  installRecallScanClock(t);
  const f = fixture(t); seed(f.db,2049);
  const writer = openMemoryCore({ path:f.path,model:model() }); t.after(()=>writer.close());
  let scored = 0, commits = 0, changed = false;
  const exec = f.db.exec.bind(f.db);
  t.mock.method(f.db,'exec',sql => {
    assert.notEqual(sql,'BEGIN IMMEDIATE');
    const result = exec(sql);
    if (sql === 'COMMIT' && scored > 0 && !changed) {
      changed=true; commits++;
      // The writer's real BEGIN IMMEDIATE and COMMIT must both succeed with
      // the scan suspended between snapshots on a DELETE-journal store.
      ok(writer.forget({ namespace,memoryId:key(2049),expectedRevision:1 }));
    }
    return result;
  });
  const result = query(f.runtime,'note',{ score(text) { scored++; return createQueryScore('note')(text); } });
  assert.equal(commits,1); assert.ok(scored > 2049);
  assert.equal(result.scanBoundary.rows,2048);
  assert.ok(result.rows.every(r=>r.item.ref.memoryId !== key(2049)));
});

for (const lastRow of [false,true]) test(`two epoch changes revalidate the partial prefix, forgotten last key ${lastRow}`, t => {
  installRecallScanClock(t);
  const f=fixture(t); seed(f.db,2049);
  const writer=openMemoryCore({path:f.path,model:model()}); t.after(()=>writer.close());
  let scored=0, previous=0, mutations=0;
  const exec=f.db.exec.bind(f.db);
  t.mock.method(f.db,'exec',sql=>{
    const result=exec(sql);
    if(sql==='COMMIT'&&scored>previous&&mutations<2) {
      previous=scored;
      ok(writer.forget({namespace,memoryId:key(mutations===0?2049:lastRow?1793:2048),expectedRevision:1}));
      mutations++;
    }
    return result;
  });
  const result=query(f.runtime,'note',{score(text){scored++;return createQueryScore('note')(text);}});
  assert.equal(mutations,2); assert.equal(result.scanExhausted,false);
  assert.equal(result.scanBoundary.stop,'changed'); assert.equal(result.scanBoundary.rows,255);
  assert.ok(result.rows.length>0);
  assert.ok(result.rows.every(r=>![key(2049),key(lastRow?1793:2048)].includes(r.item.ref.memoryId)));
  assert.equal(result.scanBoundary.last.id,key(lastRow?1794:1793));
  assert.ok(result.rows.every(r=>r.item.ref.memoryId!==key(1792)),
    'reconciliation never fills a deletion with the next older row outside the interrupted prefix');
  const replay=query(f.runtime,'note',{scanBoundary:result.scanBoundary,expectedEpoch:result.epoch});
  assert.deepEqual(replay,result);
});

test('restart reapplies the floor while keeping the original spent budget', t => {
  let now=0; installRecallScanClock(t,()=>now);
  const f=fixture(t); seed(f.db,2049);
  const writer=openMemoryCore({path:f.path,model:model()}); t.after(()=>writer.close());
  const exec=f.db.exec.bind(f.db); let scored=0, changed=false;
  t.mock.method(f.db,'exec',sql=>{
    const result=exec(sql);
    if(sql==='COMMIT'&&!changed&&scored===300) {
      ok(writer.forget({namespace,memoryId:key(2049),expectedRevision:1}));
      changed=true; now=500;
    }
    return result;
  });
  const result=query(f.runtime,'note',{score(){scored++;now+=changed?0.1:1;return 1;}});
  assert.equal(changed,true); assert.equal(scored,300+1024);
  assert.equal(result.scanBoundary.rows,1024); assert.equal(result.scanBoundary.stop,'budget');
  assert.equal(result.scanExhausted,false);
  assert.ok(result.rows.every(r=>r.item.ref.memoryId!==key(2049)));
});

test('per-page time and row holds release SHARED while the floor finishes', t => {
  let now=0; installRecallScanClock(t,()=>now);
  const f=fixture(t); seed(f.db,2049);
  const exec=f.db.exec.bind(f.db), holds=[];
  let started, bodies=0, previous=0;
  t.mock.method(f.db,'exec',sql=>{
    const result=exec(sql);
    if(sql==='BEGIN') started=now;
    if(sql==='COMMIT'&&bodies>previous) {
      holds.push({rows:bodies-previous,ms:now-started}); previous=bodies;
    }
    return result;
  });
  const result=query(f.runtime,'note',{score(){bodies++;now++;return 1;}});
  assert.equal(result.scanBoundary.rows,1024);
  assert.ok(holds.length>4);
  assert.ok(holds.every(h=>h.rows<=QUERY_CANDIDATES.page&&h.ms<=QUERY_CANDIDATES.pageMs));
});

test('20,000-row cap never scores the remaining sentinel and retains only the best 1,024', t => {
  installRecallScanClock(t);
  const f=fixture(t); seed(f.db,20001);
  let bodies=0;
  const result=query(f.runtime,'note',{score(text){
    bodies++; assert.ok(!text.startsWith(marker(1)+' ')); return 1;
  }});
  assert.equal(bodies,20000); assert.equal(result.rows.length,1024);
  assert.equal(result.scanBoundary.rows,20000); assert.equal(result.scanBoundary.stop,'cap');
  assert.equal(result.scanExhausted,false);
});

test('suppression between pages refreshes canonical decisions before restart, including request memo', async t => {
  installRecallScanClock(t);
  const f = safetyFixture(t,18); await f.migrate();
  let db;
  const runtime = createMemoryRuntime({ path:f.path },{attachRaw(connection) { db=connection; }});
  t.after(()=>runtime.close()); seed(db,2049);
  const writer = new DatabaseSync(f.path); t.after(()=>writer.close()); writer.exec('PRAGMA busy_timeout=0');
  const exec = db.exec.bind(db); let changed=false, scoresAfter=0;
  t.mock.method(db,'exec',sql => {
    const result=exec(sql);
    if (sql==='COMMIT'&&!changed) {
      changed=true;
      transaction(writer,()=>writeContentSuppressionInside(writer,{namespace:ns,kind:'memory',key:key(2049),
        reason:'purge',actionId:'synthetic-suppression'}));
    }
    return result;
  });
  const result = withContentSuppressionRequest(()=>query(runtime,'note',{score(text) {
    if(changed) { assert.ok(!text.includes(marker(2049)+' ')); scoresAfter++; }
    return 1;
  }}));
  assert.ok(scoresAfter>0);
  assert.ok(result.rows.every(r=>r.item.ref.memoryId!==key(2049)));
  assert.notEqual(result.suppressionEpoch,'0:0');
});

test('public recall drops a newly suppressed winning note and delivers ordinary incomplete coverage', async t => {
  installRecallScanClock(t);
  const f=safetyFixture(t,18); await f.migrate();
  const db=f.connect(); seed(db,2049); t.after(()=>db.close());
  const writer=new DatabaseSync(f.path); writer.exec('PRAGMA busy_timeout=0'); t.after(()=>writer.close());
  const core=openMemoryCore({path:f.path,model:model()}); t.after(()=>core.close());
  const prepare=DatabaseSync.prototype.prepare, exec=DatabaseSync.prototype.exec;
  let reader, changed=false;
  t.mock.method(DatabaseSync.prototype,'prepare',function(sql) {
    if(sql.startsWith('SELECT id, revision, updated_at FROM memories')) reader=this;
    return prepare.call(this,sql);
  });
  t.mock.method(DatabaseSync.prototype,'exec',function(sql) {
    const result=exec.call(this,sql);
    if(this===reader&&sql==='COMMIT'&&!changed) {
      changed=true;
      transaction(writer,()=>writeContentSuppressionInside(writer,{namespace:ns,kind:'memory',key:key(2049),
        reason:'purge',actionId:'public-suppression'}));
    }
    return result;
  });
  const result=ok(await core.recall({readSet:[namespace],query:marker(2049)}));
  assert.equal(changed,true); assert.deepEqual(result.memories,[]);
  assert.equal(result.coverage,'budget_exhausted');
  assert.equal(Object.hasOwn(result,'partialReason'),false);
});
