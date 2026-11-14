import nodeTest from "node:test";
import assert from "node:assert/strict";
import { ns, ok, receipt } from "../testing/card-lineage-fixture.mjs";
import { createMemoryRuntime } from "../runtime.mjs";
import { readTransaction } from "../database.mjs";
import { createContentReadMemo, receiptReadSafety } from "../content-safety.mjs";
import { receiptDenialsInside, receiptDenialTokens } from "../content-safety.mjs";
import { survivor, forgotten, operations, lookupSQL, isLookup, source, noLeak, hasId, trace, fixture, capture, act, markers, memoryRef, originalRow, refreshContext, reads, withoutMarkers } from "../testing/shared-source-fixture.mjs";
// A pending adapter/worker call must fail the case within the file budget.
const test=(name,run)=>nodeTest(name,{timeout:15000},run);

for (const operation of operations) test(`Raw keeps existing cascade ${operation}`, async t => {
  const f = await fixture(t, 'raw-53', operation), [b, a] = await capture(f);
  ok(await act(f, operation, a));
  assert.equal(markers(f).length, 2);
  const get = f.core.get({ namespace: ns, memoryId: b.id });
  assert.equal(get.error?.code, 'memory_not_found'); noLeak(get, 'Raw get');
  const list = f.core.list({ namespace: ns, limit: 20 });
  assert.equal(list.error?.code, 'revision_conflict'); noLeak(list, 'Raw list');
  for (const method of ['selectEvidence', 'fetchEvidence']) {
    const value = await f.call(method, method === 'fetchEvidence' ? { intent: 'current', refs: [memoryRef(b)] }
      : { intent: 'current', query: 'Synthetic', types: ['memory'], limit: 24 });
    assert.equal(value.error?.code, 'evidence_unavailable'); noLeak(value, method);
  }
  const recallInput = { readSet: [ns], query: survivor, limit: 8 };
  const recall = ok(await f.core.recall(recallInput));
  const control = ok(await withoutMarkers(f, () => f.core.recall(recallInput)));
  assert.deepEqual(recall, control, 'successful Raw recall matches the unchanged Raw facts without markers');
  assert.equal(hasId(recall, b.id), false); noLeak(recall, 'Raw recall');
  const map = f.core.map({ namespace: ns, purpose: 'recall' });
  assert.equal(map.error?.code, 'evidence_unavailable');
  assert.equal(hasId(map, b.id), false); noLeak(map, 'Raw map');
  await refreshContext(f);
  const context = ok(await f.trusted.call(f.context, 'contextRead', { readSet: [ns], types: ['memory'], intent: 'current',
    query: 'Synthetic', semantic: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } }));
  assert.equal(hasId(context, b.id), false); noLeak(context, 'Raw context');
});

for (const operation of operations) test(`unpackaged Raw withholds evidence ${operation}`, async t => {
  const f = await fixture(t, 'raw-33', operation), [b, a] = await capture(f);
  const before = originalRow(f, b);
  ok(await act(f, operation, a));
  assert.deepEqual(originalRow(f, b), before);
  await reads(f, b, []);
});

test('a sibling own statement survives even when it repeats the wording', async t => {
  const f = await fixture(t, 'ordinary-48'), [, a] = await capture(f);
  const content = 'Synthetic own statement repeats ' + forgotten;
  const b = ok(f.core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [source()] })).memory;
  ok(await act(f, 'forget', a));
  const value = ok(f.core.get({ namespace: ns, memoryId: b.id }));
  assert.equal(value.memory.content, content);
  assert.equal(value.memory.revision, b.revision);
  assert.deepEqual(value.receipts, []);
});

test('denial batch uses one lookup, no empty lookup, and no memo survives a snapshot', async t => {
  const f = await fixture(t, 'ordinary-53'), [b, a] = await capture(f);
  ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' }, receipts: [receipt('synthetic-batch-independent')] }));
  const rows = f.db.prepare('SELECT * FROM receipts WHERE memory_id IN (?,?)').all(a.id, b.id);
  const first = await trace(() => readTransaction(f.db, () => {
    const memo = createContentReadMemo(f.db);
    assert.equal(receiptDenialsInside(f.db, ns, [], memo).size, 0);
    assert.equal(receiptDenialsInside(f.db, ns, rows, memo).size, 0);
    for (const receipt of rows) assert.equal(receiptReadSafety(f.db, { namespace: ns, receipt, memo }).allowed, true);
  }));
  assert.equal(first.rows.filter(row => row.sql === lookupSQL).length, 1);
  ok(f.core.forget({ namespace: ns, memoryId: a.id, expectedRevision: a.revision }));
  readTransaction(f.db, () => assert.equal(receiptDenialsInside(f.db, ns, rows, createContentReadMemo(f.db)).size, 1));
});

test('marker-free receipt batch adds only one primary-key lookup without identity reads', async t => {
  const f = await fixture(t, 'fresh-default'), [b] = await capture(f);
  const rows = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(b.id);
  const measured = await trace(() => receiptDenialsInside(f.db, ns, rows, {}));
  assert.deepEqual([...measured.result], []);
  assert.deepEqual(measured.rows.map(row => row.sql), [lookupSQL]);
  const empty = await trace(() => receiptDenialsInside(f.db, ns, [], {}));
  assert.deepEqual(empty.rows, []);
  const plan = f.db.prepare('EXPLAIN QUERY PLAN ' + lookupSQL).all(JSON.stringify(receiptDenialTokens(rows)), ns.ownerId, ns.scope, ns.projectId);
  assert.ok(plan.some(row => /SEARCH s USING (?:COVERING )?INDEX sqlite_autoindex_suppressed_1/.test(row.detail) &&
    ['owner_id=?', 'scope=?', 'project_id=?', 'fingerprint=?'].every(part => row.detail.includes(part))));
});

for (const marked of [false, true]) test(`review B one lookup per snapshot with a full page, markers=${marked}`, async t => {
  const f = await fixture(t, 'ordinary-53'), memories = [];
  f.model.countTokens = () => 1;
  for (let i=0; i<12; i++) {
    const evidence = { ...receipt('synthetic-batch-'+i), excerpt: 'Synthetic full page '+i };
    const qualification = { version: 1, slot: { subject: 'User', property: 'signal', scope: null, applies: null }, value: null,
      attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0, start: 0, end: evidence.excerpt.length,
        text: evidence.excerpt, fields: ['subject','property'] }] };
    const memory = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic full page '+i, kind: 'instruction' },
      receipts: [evidence], qualification, procedural: { anchors: [{ receiptIndex: 0, start: 0, end: 8 }] } })).memory;
    memories.push(memory);
    if (marked && i<3) {
      const target = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic removed full page '+i, kind: 'fact' }, receipts: [evidence] })).memory;
      ok(f.core.forget({ namespace: ns, memoryId: target.id, expectedRevision: target.revision }));
    }
  }
  const assertLookups = (rows, expected) => {
    const lookups=rows.filter(isLookup);
    assert.equal(lookups.length, expected);
    assert.equal(new Set(lookups.map(row=>row.snapshot)).size, expected, 'at most one statement per synchronous snapshot');
    const anchors=rows.filter(row=>row.sql.includes('CROSS JOIN qualification_anchors q'));
    assert.equal(anchors.length,expected,'one anchor collection per selected snapshot');
    assert.equal(new Set(anchors.map(row=>row.snapshot)).size,expected);
    return lookups;
  };
  assertLookups((await trace(()=>f.core.get({namespace:ns,memoryId:memories[0].id,includeQualification:true}))).rows,1);
  assertLookups((await trace(()=>f.core.fetch({namespace:ns,refs:memories.map(memory=>({memoryId:memory.id,revision:memory.revision})),includeQualification:true}))).rows,2);
  const recall=await trace(()=>f.core.recall({readSet:[ns],query:'Synthetic',limit:12,includeQualification:true}));
  assert.equal(ok(recall.result).memories.length,12); assertLookups(recall.rows,2);
  const fetched=await trace(()=>f.call('fetchEvidence',{intent:'current',refs:memories.map(memoryRef)}));
  assert.equal(ok(fetched.result).items.length,12);assertLookups(fetched.rows,1);
  const selected=await trace(()=>f.call('selectEvidence',{intent:'current',query:'Synthetic',types:['memory'],limit:24}));
  assert.equal(ok(selected.result).items.length,12);assertLookups(selected.rows,1);
  const absent=await trace(()=>f.call('selectEvidence',{intent:'current',query:'Unmatched absenttoken',types:['memory'],limit:24}));
  assert.equal(ok(absent.result).items.length,0);assertLookups(absent.rows,0);
  const runtime=createMemoryRuntime({path:f.path});t.after(()=>runtime.close());
  const queried=await trace(()=>runtime.queryCandidateRows(ns,{score:text=>text.includes('Synthetic')?1:0,memoryLabel:text=>text,
    sourceReceiptLimit:4}));
  assert.ok(queried.result.rows.length>=12); assertLookups(queried.rows,1);
  const sourceRecall=await trace(()=>f.core.recall({readSet:[ns],query:'Synthetic',limit:12,contextMode:'source-evidence'}));
  assert.equal(ok(sourceRecall.result).memories.length,12); assertLookups(sourceRecall.rows,3);
});

test('mixed evidence selection collects anchors once as the candidate population grows',async t=>{
  const f=await fixture(t,'ordinary-53'),memories=[];
  for(const population of [4,8]){
    for(let i=memories.length;i<population;i++)memories.push(ok(f.core.admit({namespace:ns,
      memory:{content:'Synthetic mixed population '+i,kind:'fact'},receipts:[receipt('synthetic-mixed-population-'+i)]})).memory);
    if(population===4){
      const card=ok(f.call('createCardDraft',{actionId:'synthetic-mixed-population-card',drafting:'authored',input:{
        title:'Synthetic mixed population',body:'Synthetic mixed body',memoryRefs:[memoryRef(memories[0])],sourcePolicy:'retained-receipts-v1'}}));
      ok(f.call('confirmCardDraft',{actionId:'synthetic-mixed-population-confirm',cardId:card.id,expectedRevision:card.revision,applicability:'current'}));
    }
    const measured=await trace(()=>f.call('selectEvidence',{intent:'current',query:'Synthetic',types:['memory','card'],limit:1}));
    assert.equal(ok(measured.result).items.length,1);
    const anchors=measured.rows.filter(row=>row.sql.includes('CROSS JOIN qualification_anchors q'));
    assert.equal(anchors.length,1,'exactly one anchor statement at population '+population);
    assert.deepEqual(JSON.parse(anchors[0].args[0]).map(job=>job.id).sort(),memories.map(memory=>memory.id).sort());
    assert.equal(anchors[0].args[0],anchors[0].args[1]);
    assert.doesNotMatch(anchors[0].sql,/excerpt|r\.\*/);
  }
});
