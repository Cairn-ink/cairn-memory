import nodeTest from "node:test";
import assert from "node:assert/strict";
import { openMemoryCore, openMemoryStore } from "../index.mjs";
import { ns, ok, receipt } from "../testing/card-lineage-fixture.mjs";
import { createMemoryRuntime } from "../runtime.mjs";
import { transaction } from "../database.mjs";
import { receiptStoredCountInside } from "../content-safety.mjs";
import { receiptDenialTokens } from "../content-safety.mjs";
import { receiptCoordinateStateInside } from "../raw-source-roots.mjs";
import { survivor, forgotten, independent, ordinaryKinds, isLookup, source, key, noLeak, hasId, trace, fixture, capture, act, markers, memoryRef, reads, appendReceipts } from "../testing/shared-source-fixture.mjs";
// A pending adapter/worker call must fail the case within the file budget.
const test=(name,run)=>nodeTest(name,{timeout:15000},run);

for (const kind of ordinaryKinds) test(`receipt caps and cursors follow denial filtering ${kind}`, async t => {
  const f = await fixture(t, kind), [b, a] = await capture(f);
  const denied = f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(b.id).id;
  // Put more withheld rows ahead of the allowed evidence than any private,
  // get, fetch or source projection cap, with stable synthetic timestamps.
  const rows = Array.from({ length: 105 }, (_, index) => ({ ...source(forgotten + ' window ' + index),
    eventId: 'synthetic-denied-' + index }));
  for (let offset = 0; offset < rows.length; offset += 4) b.revision = ok(f.core.admit({ namespace: ns,
    memory: { content: survivor, kind: 'fact' }, receipts: rows.slice(offset, offset + 4) })).memory.revision;
  const stored = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(b.id);
  for (const token of receiptDenialTokens(stored)) f.db.prepare('INSERT OR IGNORE INTO suppressed VALUES(?,?,?,?)')
    .run(ns.ownerId, ns.scope, ns.projectId, token);
  const withSupport = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' },
    receipts: [receipt('synthetic-independent-cap', independent)] })).memory;
  b.revision = withSupport.revision;
  const allowed = f.db.prepare('SELECT id FROM receipts WHERE memory_id=? AND excerpt=?').get(b.id, independent).id;
  f.db.prepare('UPDATE receipts SET created_at=? WHERE memory_id=?').run('2026-01-01T00:00:00.000Z', b.id);
  f.db.prepare('UPDATE receipts SET created_at=? WHERE id=?').run('2026-01-02T00:00:00.000Z', allowed);
  ok(await act(f, 'forget', a));
  const page = ok(f.core.get({ namespace: ns, memoryId: b.id, receiptLimit: 1 }));
  assert.deepEqual(page.receipts.map(row => row.id), [allowed]);
  assert.equal(page.nextReceiptCursor, null);
  const legacy = openMemoryStore({ path: f.path }); t.after(() => legacy.close());
  assert.deepEqual(legacy.scope({ ownerId: ns.ownerId, projectId: ns.projectId }).get(b.id).receipts.map(row => row.excerpt), [independent]);
  const values = await reads(f, b, [independent]);
  for (const value of Object.values(values)) assert.equal(hasId(value, denied), false);
  // Reverse recency: a marker must not occupy the most-recent slot either.
  f.db.prepare('UPDATE receipts SET created_at=? WHERE id=?').run('2025-12-31T00:00:00.000Z', allowed);
  const runtime = createMemoryRuntime({ path: f.path }); t.after(() => runtime.close());
  assert.deepEqual(runtime.recentReceipts(ns, { memoryId: b.id, revision: b.revision }, 1).map(row => row.id), [allowed]);
  const second = 'Synthetic second independent support';
  ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' }, receipts: [receipt('synthetic-second-cap', second)] }));
  const firstPage = ok(f.core.get({ namespace: ns, memoryId: b.id, receiptLimit: 1 }));
  assert.deepEqual(firstPage.receipts.map(row => row.excerpt), [independent]);
  assert.equal(firstPage.exhausted, false);
  const nextPage = ok(f.core.get({ namespace: ns, memoryId: b.id, receiptLimit: 1, receiptCursor: firstPage.nextReceiptCursor }));
  assert.deepEqual(nextPage.receipts.map(row => row.excerpt), [second]);
  assert.equal(nextPage.exhausted, true); noLeak(nextPage, 'get cursor');
});

test('review B full receipt pages resolve qualification and procedural tokens once', async t => {
  const f=await fixture(t,'ordinary-53');f.model.countTokens=()=>1;
  const evidence=receipt('synthetic-full-receipt-first');
  const qualification={version:1,slot:{subject:'User',property:null,scope:null,applies:null},value:null,attribution:'unknown',commitment:'unknown',
    anchors:[{receiptIndex:0,start:0,end:evidence.excerpt.length,text:evidence.excerpt,fields:['subject']}]};
  let memory=ok(f.core.admit({namespace:ns,memory:{content:survivor,kind:'instruction'},receipts:[evidence],qualification,
    procedural:{anchors:[{receiptIndex:0,start:0,end:8}]}})).memory;
  for(let i=0;i<26;i++)memory=ok(f.core.admit({namespace:ns,memory:{content:survivor,kind:'instruction'},
    receipts:Array.from({length:4},(_,j)=>receipt('synthetic-full-receipt-'+(i*4+j)))})).memory;
  for(const [name,call,expected]of [
    ['get',()=>f.core.get({namespace:ns,memoryId:memory.id,receiptLimit:100,includeQualification:true}),1],
    ['fetch',()=>f.core.fetch({namespace:ns,refs:[{memoryId:memory.id,revision:memory.revision}],includeQualification:true}),2],
  ]) {
    const measured=await trace(call),value=ok(measured.result);
    assert.equal((value.receipts??value.items[0].receipts).length,100,name+' full page');
    const lookups=measured.rows.filter(isLookup);assert.equal(lookups.length,expected,name);
    assert.equal(new Set(lookups.map(row=>row.snapshot)).size,expected);
  }
});

test('get paging and context projection stay linear for a large receipt set',async t=>{
  const f=await fixture(t,'ordinary-53');f.model.countTokens=()=>1;
  const b=ok(f.core.admit({namespace:ns,memory:{content:survivor,kind:'fact'},receipts:[receipt('synthetic-linear-first')]})).memory;
  appendReceipts(f,b,Array.from({length:1999},(_,i)=>receipt('synthetic-linear-'+String(i).padStart(4,'0'))));
  const expected=f.db.prepare('SELECT id FROM receipts WHERE memory_id=? ORDER BY created_at,id').all(b.id).map(row=>row.id);
  const measured=await trace(async()=>{
    let cursor,pages=0;const ids=[];
    do {const page=ok(f.core.get({namespace:ns,memoryId:b.id,receiptLimit:16,...(cursor?{receiptCursor:cursor}:{})}));
      ids.push(...page.receipts.map(row=>row.id));cursor=page.nextReceiptCursor;
      assert.ok(++pages<=Math.ceil(expected.length/16),'finite advancing get pages');
    } while(cursor);
    return ids;
  });
  assert.deepEqual(measured.result,expected);
  assert.equal(measured.rows.some(row=>row.sql.includes('receipts previous')),false,'no repeated prefix counts');
  const headers=measured.rows.filter(row=>row.sql.startsWith('SELECT j.value AS input,r.id'));
  assert.ok(headers.length<=Math.ceil(2000/16)+1);
  assert.ok(headers.every(row=>row.args[1]===49),'page probe plus fixed header margin');
  const counted=measured.rows.filter(row=>row.sql.startsWith('SELECT count(*) AS n FROM receipts r INDEXED BY memory_receipts'));
  assert.ok(counted.length<=1,'stored count is cached under both native change counters');
  const result=ok(await f.trusted.call(f.context,'fetchCandidateEvidence',{readSet:[ns],intent:'current',refs:[memoryRef(b)]}));
  assert.equal(result.items[0].provenance.receiptMetadata.length,16);
});

for(const count of [16,17,100,101,200,201,512])
test(`marker-free receipt order, cursors and coverage at ${count}`,async t=>{
  const f=await fixture(t,'ordinary-53'),[initial]=await capture(f);f.model.countTokens=()=>1;
  const b=initial;
  appendReceipts(f,b,Array.from({length:count-1},(_,i)=>receipt('synthetic-boundary-'+String(i).padStart(4,'0'))));
  assert.deepEqual(markers(f),[]);
  const stored=f.db.prepare('SELECT id FROM receipts WHERE memory_id=? ORDER BY created_at,id').all(b.id).map(row=>row.id);
  let cursor,getPages=0;const getIds=[];
  do {
    const page=ok(f.core.get({namespace:ns,memoryId:b.id,receiptLimit:16,...(cursor?{receiptCursor:cursor}:{})}));
    assert.equal(page.memory.receiptCount,count);assert.equal(page.exhausted,page.nextReceiptCursor===null);
    getIds.push(...page.receipts.map(row=>row.id));cursor=page.nextReceiptCursor;assert.ok(++getPages<=Math.ceil(count/16));
  }while(cursor);
  assert.deepEqual(getIds,stored);
  const store=openMemoryStore({path:f.path});t.after(()=>store.close());
  const legacy=await trace(()=>store.scope({ownerId:ns.ownerId,projectId:ns.projectId}).get(b.id));
  assert.equal(legacy.result.receipts.length,count);assert.equal(legacy.rows.filter(isLookup).length,1,'uncapped headers share one marker union');
  cursor=undefined;const fetchIds=[];let pages=0;
  do {
    const page=ok(f.core.fetch({namespace:ns,refs:[{memoryId:b.id,revision:b.revision}],tokenBudget:4000,...(cursor?{cursor}:{})}));
    assert.equal(page.items[0].receiptCount,count);assert.equal(page.exhausted,page.nextCursor===null);
    fetchIds.push(...page.items[0].receipts.map(row=>row.id));cursor=page.nextCursor;pages++;
    assert.ok(pages<=Math.ceil(count/100));
  }while(cursor);
  assert.deepEqual(fetchIds,stored);assert.equal(pages,Math.ceil(count/100));
  const evidence=ok(f.call('fetchEvidence',{intent:'current',refs:[memoryRef(b)]})).items[0];
  assert.deepEqual(evidence.provenance.receiptMetadata.map(row=>row.receiptId),stored.slice(0,16));
  assert.deepEqual(evidence.provenance.coverage,{status:count<=16?'complete':'budget_exhausted',included:Math.min(16,count),omitted:count<=16?0:null});
  const recalled=ok(await f.core.recall({readSet:[ns],query:survivor,limit:8}));
  const item=recalled.memories.find(item=>item.memory.id===b.id);assert.ok(item);
  assert.equal(item.receiptCount,count);assert.deepEqual(item.receipts.map(row=>row.id),stored.slice(0,200));
  const runtime=createMemoryRuntime({path:f.path});t.after(()=>runtime.close());
  const recent=f.db.prepare('SELECT id FROM receipts WHERE memory_id=? ORDER BY created_at DESC,id LIMIT 16').all(b.id).map(row=>row.id);
  assert.deepEqual(runtime.recentReceipts(ns,{memoryId:b.id,revision:b.revision},16).map(row=>row.id),recent);
  const source=f.core.fetch({namespace:ns,refs:[{memoryId:b.id,revision:b.revision}],contextMode:'source-evidence',tokenBudget:4000});
  if(count<=100)assert.deepEqual(ok(source).items[0].receipts.map(row=>row.id),stored);
  else assert.equal(source.error.code,'context_item_too_large');
});

test('receipt counts discard values computed inside a rolled-back write',async t=>{
  const f=await fixture(t,'ordinary-53'),[b]=await capture(f),extra=receipt('synthetic-rollback');
  assert.equal(receiptStoredCountInside(f.db,ns,b.id),1);
  let inside;
  assert.throws(()=>transaction(f.db,()=>{
    f.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,?)').run('synthetic-rollback-receipt',b.id,key(extra),extra.client,extra.sessionId,extra.eventId,extra.role,extra.excerpt,'2026-01-01T00:00:00.000Z');
    assert.equal(receiptStoredCountInside(f.db,ns,b.id),2);
    inside=f.db.prepare('SELECT total_changes() n').get().n;
    throw new Error('synthetic-rollback');
  }),/synthetic-rollback/);
  assert.equal(f.db.prepare('SELECT total_changes() n').get().n,inside,'rollback does not change the native counter');
  assert.equal(receiptStoredCountInside(f.db,ns,b.id),1);
});

function receiptCoordinateCounters(db) {
  return {version:db.prepare('PRAGMA data_version').get().data_version,
    changes:db.prepare('SELECT total_changes() AS n FROM store_metadata WHERE singleton=1').get().n};
}
function observedReceiptCoordinates(db,memoryId) {
  const counters=receiptCoordinateCounters(db);
  const state=receiptCoordinateStateInside(db,counters.version,counters.changes);
  const coordinates=state.memories.get(JSON.stringify([ns.ownerId,ns.scope,ns.projectId??'',memoryId]));
  // This accessor can create an empty state. Requiring the populated entry
  // proves that the preceding public read, rather than this inspection, warmed it.
  assert.ok(coordinates,'public fetch populated this native connection\'s Memory entry');
  assert.ok(coordinates.offsets.size>0,'public fetch cached delivered coordinates');
  return {...counters,state,coordinates};
}
async function observedReceiptFetch(core,input) {
  let native;
  const measured=await trace(()=>core.fetch(input),(sql,args,db)=>{
    if(sql.startsWith('SELECT j.value AS input,r.id')) {
      if(native)assert.equal(db,native,'both fetch snapshots use the same native connection');
      native=db;
    }
  });
  assert.ok(native,'public fetch executed the cached receipt-coordinate path');
  return {page:ok(measured.result),native};
}

for(const kind of ordinaryKinds) for(const connection of ['same','other'])
test(`receipt-coordinate cache resets after ${connection}-connection public forget ${kind}`,async t=>{
  const f=await fixture(t,kind),[initial,sibling]=await capture(f);
  const memory=ok(f.core.admit({namespace:ns,memory:{content:survivor,kind:'fact'},
    receipts:[receipt('synthetic-cache-independent-1',independent),receipt('synthetic-cache-independent-2','Synthetic second independent support')]})).memory;
  assert.equal(memory.id,initial.id);
  const shared=f.db.prepare('SELECT id FROM receipts WHERE memory_id=? AND event_id=?').get(memory.id,'synthetic-message');
  assert.ok(shared);
  // Make the shared receipt the first delivered row, independently of clock
  // resolution and generated ids; the remaining two rows have a stable order.
  f.db.prepare('UPDATE receipts SET created_at=? WHERE memory_id=?').run('2026-01-02T00:00:00.000Z',memory.id);
  f.db.prepare('UPDATE receipts SET created_at=? WHERE id=?').run('2026-01-01T00:00:00.000Z',shared.id);
  const stored=f.db.prepare('SELECT id,created_at AS createdAt FROM receipts WHERE memory_id=? ORDER BY created_at,id').all(memory.id);
  assert.equal(stored.length,3);assert.equal(stored[0].id,shared.id);
  assert.deepEqual(markers(f),[]);
  // Force one receipt per public fetch page without a large fixture or any
  // dependence on a model tokenizer. This exercises nonzero cached offsets.
  f.model.countTokens=text=>{
    try {if(JSON.parse(text).value?.items?.[0]?.receipts?.length>1)return 4001;}catch{}
    return 1;
  };
  const options={path:f.path,model:f.model,decisionReview:'required-v1',...(f.host?{privateCards:f.host.options}:{}),
    contextRead:{version:'context-read-v1',authority:f.trusted.authority,counter:{id:'synthetic',countTokens:()=>1}}};
  const reader=openMemoryCore(options);t.after(()=>reader.close());
  const input={namespace:ns,refs:[{memoryId:memory.id,revision:memory.revision}],tokenBudget:4000};
  const evidence=core=>{
    const items=ok(f.trusted.call(core,'fetchCandidateEvidence',{readSet:[ns],intent:'current',refs:[memoryRef(memory)]})).items;
    assert.equal(items.length,1);return items[0];
  };
  const first=await observedReceiptFetch(reader,input);
  assert.notEqual(first.native,f.db,'inspect the engine connection, not the fixture connection');
  assert.deepEqual(first.page.items[0].receipts.map(row=>row.id),[shared.id],'positive delivery control');
  assert.equal(first.page.items[0].receiptCount,3);assert.equal(first.page.items[0].memory.receiptCount,3);
  assert.equal(first.page.exhausted,false);assert.equal(first.page.truncatedBy,'token_budget');
  assert.equal(typeof first.page.nextCursor,'string');
  const before=observedReceiptCoordinates(first.native,memory.id);
  assert.equal(before.coordinates.total,3,'positive stored-count cache control');
  assert.deepEqual(before.coordinates.offsets,new Map(stored.map((row,i)=>[i+1,{...row}])),'positive offset cache control');
  const beforeEvidence=evidence(reader);
  assert.deepEqual(beforeEvidence.provenance.receiptMetadata.map(row=>row.receiptId),stored.map(row=>row.id));
  assert.deepEqual(beforeEvidence.provenance.coverage,{status:'complete',included:3,omitted:0});

  const writer=connection==='same'?reader:f.core;
  let writerNative;
  const forgotten=await trace(()=>writer.forget({namespace:ns,memoryId:sibling.id,expectedRevision:sibling.revision}),(sql,args,db)=>{
    if(sql.startsWith('UPDATE memories SET content = NULL, deleted = 1,')&&args.at(-1)===sibling.id)writerNative=db;
  });
  assert.equal(ok(forgotten.result).forgotten,true);assert.ok(writerNative);
  if(connection==='same')assert.equal(writerNative,first.native,'public forget uses the warmed connection');
  else assert.notEqual(writerNative,first.native,'handle B owns another native connection');
  const write=forgotten.rows.findIndex(row=>row.sql.startsWith('UPDATE memories SET content = NULL, deleted = 1,'));
  assert.ok(write>=0&&forgotten.rows.slice(write+1).some(row=>row.sql==='COMMIT'),'public forget committed before A reads again');
  const changed=receiptCoordinateCounters(first.native);
  if(connection==='same') {
    assert.notEqual(changed.changes,before.changes,'local total_changes() invalidates A');
    assert.equal(changed.version,before.version,'a local commit does not move A\'s data_version');
  } else {
    assert.notEqual(changed.version,before.version,'B\'s commit moves PRAGMA data_version on A');
    assert.equal(changed.changes,before.changes,'B\'s writes do not move total_changes() on A');
  }
  const second=await observedReceiptFetch(reader,input);
  assert.equal(second.native,first.native);
  const after=observedReceiptCoordinates(second.native,memory.id);
  assert.equal(after.version,changed.version);assert.equal(after.changes,changed.changes);
  assert.notEqual(after.state,before.state,'the public read replaced the old cache state');
  assert.notEqual(after.coordinates,before.coordinates,'no old Memory cache entry survived');
  assert.equal(after.coordinates.total,3,'withholding preserves the three physically stored receipts');
  const expectedOffsets=new Map(stored.slice(1).map((row,i)=>[i+2,{...row}]));
  assert.deepEqual(after.coordinates.offsets,expectedOffsets,'no withheld coordinate remains cached');
  assert.equal(after.coordinates.offsets.has(1),false,'the formerly delivered shared offset was discarded');
  assert.deepEqual(second.page.items[0].receipts.map(row=>row.id),[stored[1].id],'A withholds the shared receipt');
  assert.equal(second.page.items[0].receiptCount,3);assert.equal(second.page.items[0].memory.receiptCount,3);
  const afterEvidence=evidence(reader);
  assert.deepEqual(afterEvidence.provenance.receiptMetadata.map(row=>row.receiptId),stored.slice(1).map(row=>row.id));
  assert.deepEqual(afterEvidence.provenance.coverage,{status:'budget_exhausted',included:2,omitted:1});

  const fresh=openMemoryCore(options);t.after(()=>fresh.close());
  const freshFirst=await observedReceiptFetch(fresh,input),freshCoordinates=observedReceiptCoordinates(freshFirst.native,memory.id);
  assert.notEqual(freshFirst.native,first.native);
  assert.deepEqual(second.page,freshFirst.page,'delivered rows, counts and page coverage equal a post-forget handle');
  assert.equal(after.coordinates.total,freshCoordinates.coordinates.total);
  assert.deepEqual(after.coordinates.offsets,freshCoordinates.coordinates.offsets,'cached offsets equal a fresh handle');
  const freshEvidence=evidence(fresh);
  assert.deepEqual(afterEvidence.provenance.receiptMetadata,freshEvidence.provenance.receiptMetadata);
  assert.deepEqual(afterEvidence.provenance.coverage,freshEvidence.provenance.coverage);
  assert.equal(typeof second.page.nextCursor,'string');
  const last=ok(reader.fetch({...input,cursor:second.page.nextCursor}));
  const freshLast=ok(fresh.fetch({...input,cursor:freshFirst.page.nextCursor}));
  assert.deepEqual(last,freshLast,'the new cursor resumes at the post-forget offset');
  assert.deepEqual([...second.page.items[0].receipts,...last.items[0].receipts].map(row=>row.id),stored.slice(1).map(row=>row.id));
  assert.equal(last.items[0].receiptCount,3);assert.equal(last.exhausted,true);assert.equal(last.nextCursor,null);
  for(const value of [second.page,last,afterEvidence]) {noLeak(value,'post-forget delivery');assert.equal(hasId(value,shared.id),false);}
  // runtime.mjs:683 rejects the pre-forget namespace epoch. Do this last:
  // its rollback clears the cache and must not mask counter invalidation above.
  assert.deepEqual(reader.fetch({...input,cursor:first.page.nextCursor}),{ok:false,error:{code:'cursor_stale',retryable:false}});
});
