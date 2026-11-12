import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { createQueryScore, QUERY_SCAN_BUDGET_MS, namespaceScanBudgetMs } from '../query-candidates.mjs';
import { createQueryExcerpt } from '../query-excerpt.mjs';
import { installRecallScanClock } from '../testing/recall-scan-clock.mjs';
import { layoutFixture, seed, query, baseCandidates, namespace, ns, key, marker, model, ok } from '../testing/recall-recency-fixture.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside, withContentSuppressionRequest } from '../content-suppression-storage.mjs';

for (const layout of ['plain',53]) {
for (const count of [0,1,100,1024]) for (const sourceReceiptLimit of [0,4]) {
  test(`layout ${layout}, base parity: ${count} current rows, receipt limit ${sourceReceiptLimit}`, async t => {
    installRecallScanClock(t);
    const frames = [], f = await layoutFixture(t, layout, model(frames)); seed(f.db, count);
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

for (const count of [1025,2049,6500]) test(`layout ${layout}, fresh notes found at default limit: ${count}`, async t => {
  const f = await layoutFixture(t, layout); seed(f.db,count);
  const prefix = new Set(baseCandidates(f.db,'absent').rows.map(r => r.item.ref.memoryId));
  let baseHits = 0, newHits = 0;
  for (let i = count-49; i <= count; i++) {
    if (prefix.has(key(i))) baseHits++;
    const result = ok(await f.core.recall({ readSet: [namespace], query: marker(i) }));
    if (result.memories.some(row => row.memory.id === key(i))) newHits++;
  }
  t.diagnostic('FRESH_NOTES ' + JSON.stringify({ layout, count, baseHits, newHits, total: 50 }));
  assert.equal(newHits,50);
});

test('ranking retains older stronger matches ahead of newer weaker matches', async t => {
  installRecallScanClock(t);
  const f = await layoutFixture(t, layout); seed(f.db,2049);
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
  const f = await layoutFixture(t, layout); seed(f.db,2049);
  const score = createQueryScore('note'); let scored = 0;
  const first = query(f.runtime,'note',{ score(text) { scored++; now += 1; return score(text); } });
  assert.equal(QUERY_SCAN_BUDGET_MS,300);
  assert.equal(scored,1024); assert.equal(first.scanBoundary.rows,1024);
  assert.equal(first.scanBoundary.stop,'budget'); assert.equal(first.scanExhausted,false);
  now = 0;
  const map = await mapHarness(f);
  let ticks = 0;
  // Every monotonic sample advances the fake clock: the floor still applies.
  setClock(() => ticks++ * 500);
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

test('floor filters history in its single scan and exhausts all 1024 current rows', async t => {
  let now = 0; installRecallScanClock(t,()=>now++);
  const f = await layoutFixture(t, layout); seed(f.db,2049);
  f.db.exec("UPDATE memories SET currentness='historical' WHERE updated_at > '2026-01-01T00:17:04.000Z'");
  let scored = 0;
  const result = query(f.runtime,'note',{ score(text) {
    scored++; assert.ok(Number(text.match(/^distinctive(\d+) /)[1]) <= 1024); return 1;
  } });
  assert.equal(scored,1024);
  assert.equal(result.scanBoundary.rows,1024); assert.equal(result.rows.length,1024);
  assert.equal(result.scanBoundary.stop,'end'); assert.equal(result.scanExhausted,true);
});

test('tail history rows consume the physical allowance without reaching the scorer', async t => {
  let now = 0; installRecallScanClock(t,()=>now++);
  const f = await layoutFixture(t, layout); seed(f.db,3073);
  f.db.exec("UPDATE memories SET currentness='historical' WHERE updated_at > '2026-01-01T00:17:04.000Z' AND updated_at <= '2026-01-01T00:34:09.000Z'");
  let scored = 0;
  const result = query(f.runtime,'note',{ score(text) {
    scored++; assert.ok(Number(text.match(/^distinctive(\d+) /)[1]) > 2049); return 1;
  } });
  assert.equal(scored,1024);
  assert.ok(result.scanBoundary.rows > 1024 && result.scanBoundary.rows <= 1280);
  assert.equal(result.scanBoundary.stop,'budget'); assert.equal(result.scanExhausted,false);
});

test('foreign owner and project rows never reach physical pages or the scorer', async t => {
  installRecallScanClock(t);
  const f = await layoutFixture(t, layout); seed(f.db,100);
  const before = query(f.runtime,'note');
  seed(f.db,2049,{ ...ns,ownerId:'foreign-owner' },10000);
  seed(f.db,2049,{ ...ns,scope:'project',projectId:'foreign-project' },20000);
  const after = query(f.runtime,'note');
  assert.deepEqual(after,before);
  assert.equal(after.scanBoundary.rows,100);
});

test('foreign rows just older than the floor never reach tail pages or the scan boundary', async t => {
  let tick = 0; installRecallScanClock(t,()=>tick++*.34);
  const f = await layoutFixture(t, layout); seed(f.db,2049);
  seed(f.db,100,{ ...ns,ownerId:'foreign-owner' },10000);
  seed(f.db,100,{ ...ns,scope:'project',projectId:'foreign-project' },20000);
  // Own row 1025 is the first row past the floor; foreign rows sit between it and the floor.
  f.db.prepare('UPDATE memories SET updated_at=? WHERE owner_id=? OR project_id=?')
    .run('2026-01-01T00:17:05.500Z','foreign-owner','foreign-project');
  const foreign = new Set(f.db.prepare('SELECT id FROM memories WHERE owner_id=? OR project_id=?')
    .all('foreign-owner','foreign-project').map(row=>row.id));
  assert.equal(foreign.size,200);
  let pages = 0, fetched = 0; const prepare = f.db.prepare.bind(f.db);
  t.mock.method(f.db,'prepare',sql=>{
    const statement = prepare(sql);
    if (sql.startsWith('SELECT id, revision, updated_at FROM memories')) {
      const all = statement.all.bind(statement);
      statement.all = (...args)=>{ const rows = all(...args); pages++; fetched += rows.filter(row=>foreign.has(row.id)).length; return rows; };
    }
    return statement;
  });
  const result = query(f.runtime,'note');
  assert.ok(pages > 0,'tail pages ran');
  assert.equal(result.scanBoundary.stop,'budget'); assert.ok(result.scanBoundary.rows > 1024);
  assert.equal(fetched,0,'no foreign row in any tail page');
  assert.equal(foreign.has(result.scanBoundary.last.id),false,'scan boundary is an own row');
  assert.equal(result.rows.some(row=>foreign.has(row.item.ref.memoryId)),false);
});

test('20,000-row cap never scores the remaining sentinel and retains only the best 1,024', async t => {
  installRecallScanClock(t);
  const f=await layoutFixture(t, layout); seed(f.db,20001);
  let bodies=0;
  const result=query(f.runtime,'note',{score(text){
    bodies++; assert.ok(!text.startsWith(marker(1)+' ')); return 1;
  }});
  assert.equal(bodies,20000); assert.equal(result.rows.length,1024);
  assert.equal(result.scanBoundary.rows,20000); assert.equal(result.scanBoundary.stop,'cap');
  assert.equal(result.scanExhausted,false);
});

}

test('suppression epoch movement drops the tail before suppressed text can be scored', async t => {
  installRecallScanClock(t);
  const f = await layoutFixture(t, 53); seed(f.db,2049);
  const writer = new DatabaseSync(f.path); t.after(()=>writer.close()); writer.exec('PRAGMA busy_timeout=0');
  const exec = f.db.exec.bind(f.db); let changed=false, scored=0;
  t.mock.method(f.db,'exec',sql => {
    const value=exec(sql);
    if (sql==='COMMIT'&&!changed) {
      changed=true;
      transaction(writer,()=>writeContentSuppressionInside(writer,{namespace:ns,kind:'memory',key:key(1),
        reason:'purge',actionId:'synthetic-suppression'}));
    }
    return value;
  });
  const result = withContentSuppressionRequest(()=>query(f.runtime,'note',{score(text) {
    assert.ok(!text.includes(marker(1)+' ')); scored++; return 1;
  }}));
  assert.equal(scored,1024); assert.equal(result.scanBoundary.rows,1024);
  assert.equal(result.scanExhausted,false); assert.equal(result.scanBoundary.stop,'changed');
  assert.ok(result.rows.every(r=>r.item.ref.memoryId!==key(1)));
});

test('public delivery freshness refuses an E0 floor after its winning memory is suppressed', async t => {
  installRecallScanClock(t);
  const f=await layoutFixture(t,53); seed(f.db,2049);
  const writer=new DatabaseSync(f.path); writer.exec('PRAGMA busy_timeout=0'); t.after(()=>writer.close());
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
  const result=await f.core.recall({readSet:[namespace],query:marker(2049)});
  assert.equal(changed,true); assert.equal(result.ok,false);
  assert.equal(result.error.code,'cursor_stale');
  assert.equal(JSON.stringify(result).includes(marker(2049)),false);
  assert.deepEqual(ok(await f.core.recall({readSet:[namespace],query:marker(2049)})).memories,[]);
});

test('per-namespace scan budget floors the per-call budget across the read set', () => {
  assert.equal(namespaceScanBudgetMs(1), QUERY_SCAN_BUDGET_MS);
  assert.equal(namespaceScanBudgetMs(2), Math.floor(QUERY_SCAN_BUDGET_MS / 2));
  assert.ok(2 * namespaceScanBudgetMs(2) <= QUERY_SCAN_BUDGET_MS);
  assert.equal(namespaceScanBudgetMs(2, 401), 200); assert.equal(namespaceScanBudgetMs(3, 400), 133);
  assert.equal(namespaceScanBudgetMs(2, 1), 0); assert.equal(namespaceScanBudgetMs(2, 0), 0);
  for (const [count, total] of [[0, 400], [-1, 400], [1.5, 400], [2, -1], [2, 1.5]])
    assert.throws(() => namespaceScanBudgetMs(count, total), { code: 'invalid_input' });
});

// Tail page reads advance the injected clock by a fixed step, so the number of
// tail pages a namespace reads is ceil(its budget / step) with the floor at zero.
function tailPageClock(t) {
  const step = 50, reads = new Map(); let now = 0, scans = 0;
  installRecallScanClock(t, () => now);
  const prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'prepare', function (sql) {
    const statement = prepare.call(this, sql);
    if (sql.includes('INDEXED BY namespace_memories')) scans++;
    if (sql.startsWith('SELECT id, revision, updated_at FROM memories')) {
      const all = statement.all;
      statement.all = (...args) => {
        if (args.at(-1) > 1) { now += step; reads.set(args[1], (reads.get(args[1]) ?? 0) + 1); }
        return all.apply(statement, args);
      };
    }
    return statement;
  });
  return { pages: budget => Math.ceil(budget / step),
    reset() { reads.clear(); now = 0; scans = 0; },
    get reads() { return Object.fromEntries(reads); }, get scans() { return scans; } };
}

test('one recall call splits the tail budget evenly across its read set; floors always complete', async t => {
  const project = { ...namespace, scope: 'project', projectId: 'budget-split' };
  const f = await layoutFixture(t, 'plain'); seed(f.db, 3073); seed(f.db, 3073, project, 10000);
  const clock = tailPageClock(t);
  clock.reset(); ok(await f.core.recall({ readSet: [namespace], query: 'note' }));
  assert.deepEqual(clock.reads, { personal: clock.pages(namespaceScanBudgetMs(1)) });
  clock.reset(); ok(await f.core.recall({ readSet: [namespace, project], query: 'note' }));
  const share = clock.pages(namespaceScanBudgetMs(2));
  assert.deepEqual(clock.reads, { personal: share, project: share });
  assert.ok(share < clock.pages(namespaceScanBudgetMs(1)), 'two namespaces read fewer tail pages each');
  clock.reset(); const empty = await f.core.recall({ readSet: [], query: 'note' });
  assert.equal(empty.ok, false); assert.equal(empty.error.code, 'invalid_read_set');
  assert.equal(clock.scans, 0, 'an empty read set prepares no scan'); assert.deepEqual(clock.reads, {});
});

test('a namespace share bounds only discovery; continuation replays the signed boundary under any share', async t => {
  const f = await layoutFixture(t, 'plain'); seed(f.db, 3073);
  const clock = tailPageClock(t);
  clock.reset(); const first = query(f.runtime, 'note', { scanBudgetMs: namespaceScanBudgetMs(2) });
  assert.equal(first.scanBoundary.stop, 'budget'); assert.ok(first.scanBoundary.rows > 1024);
  clock.reset(); const floorOnly = query(f.runtime, 'note', { scanBudgetMs: 0 });
  assert.equal(floorOnly.scanBoundary.rows, 1024); assert.equal(floorOnly.scanBoundary.stop, 'budget');
  for (const scanBudgetMs of [0, namespaceScanBudgetMs(2), QUERY_SCAN_BUDGET_MS]) {
    clock.reset();
    const replay = query(f.runtime, 'note', { scanBoundary: first.scanBoundary, expectedEpoch: first.epoch, scanBudgetMs });
    assert.deepEqual(replay.rows, first.rows); assert.deepEqual(replay.scanBoundary, first.scanBoundary);
  }
  for (const scanBudgetMs of [-1, 1.5, QUERY_SCAN_BUDGET_MS + 1, '200'])
    assert.throws(() => query(f.runtime, 'note', { scanBudgetMs }), { code: 'invalid_input' });
});
