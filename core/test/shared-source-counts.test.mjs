import { readFileSync } from "node:fs";
import { sourceEvidence } from "../source-evidence.mjs";
import { model as episodeModel, input as episodeCaptureInput } from "../testing/episode-capture-helpers.mjs";
import { options as episodeOptions } from "../testing/episode-helpers.mjs";
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { openMemoryCore } from "../index.mjs";
import { ns, ok, receipt } from "../testing/card-lineage-fixture.mjs";
import { request, splitRaw } from "../testing/raw-capture-fixtures.mjs";
import { survivor, message, independent, ordinaryKinds, operations, source, key, noLeak, hasId, fixture, capture, act } from "../testing/shared-source-fixture.mjs";
// A pending adapter/worker call must fail the case within the file budget.
const test=(name,run)=>nodeTest(name,{timeout:15000},run);

for (const kind of ordinaryKinds) for (const operation of operations)
test(`host receipt counts ${kind} ${operation}`, async t => {
  const f = await fixture(t, kind, operation), [initialB, a] = await capture(f);
  const storedCount = () => f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(initialB.id).n;
  const oldIds = f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').all(initialB.id).map(row => row.id);
  assert.equal(storedCount(), 1);
  const episode = openMemoryCore({ path: f.path, ...episodeOptions, decisionReview: 'required-v1',
    model: episodeModel({ extract: () => ({ items: [] }) }) });
  t.after(() => episode.close());
  const episodeInput = episodeCaptureInput(1, 'synthetic-count-episode', { namespace: ns });
  const episodeId = ok(await episode.capture(episodeInput)).episode.id;
  f.db.prepare('INSERT INTO episode_memory_links VALUES(?,?,?,?,?,?)').run(
    'synthetic-count-link', episodeId, initialB.id, episodeInput.eventId, initialB.revision, JSON.stringify(oldIds));
  assert.deepEqual(ok(episode.getEpisode({ namespace: ns, episodeId, sourceLimit: 16, memoryLimit: 50 }))
    .memoryLinks.items.find(link => link.memoryId === initialB.id).receiptIds, oldIds);
  ok(act(f, operation, a));
  // A separate retained Memory forces public fetch to finish across references.
  const spare = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic pagination neighbor', kind: 'fact' },
    receipts: [receipt('synthetic-pagination-neighbor')] })).memory;
  let b = initialB;
  async function assertReads(delivered) {
    const count = storedCount();
    assert.equal(count, delivered + 1);
    const detail = ok(f.core.get({ namespace: ns, memoryId: b.id }));
    assert.equal(detail.memory.id, b.id); assert.equal(detail.memory.receiptCount, count);
    assert.equal(detail.receipts.length, delivered); assert.ok(detail.receipts.length <= detail.memory.receiptCount);
    if (!delivered) {
      assert.deepEqual(detail.receipts, []);
      const row = f.db.prepare('SELECT * FROM memories WHERE id=?').get(b.id);
      assert.throws(() => sourceEvidence(row, [], count, key), { code: 'storage_error' });
    }
    const request = { namespace: ns, refs: [b, spare].map(m => ({ memoryId: m.id, revision: m.revision })), tokenBudget: 4000 };
    let cursor, pages = 0; const items = [];
    do {
      const page = ok(f.core.fetch({ ...request, ...(cursor ? { cursor } : {}) }));
      items.push(...page.items); cursor = page.nextCursor; pages++;
      assert.ok(pages <= 4); assert.deepEqual(page.invalidRefs, []); noLeak(page, 'host fetch');
      assert.equal(page.exhausted, cursor === null);
    } while (cursor);
    assert.ok(pages >= 2, 'all requested references finish');
    const fetched = items.find(item => item.memory.id === b.id);
    assert.ok(fetched); assert.equal(fetched.receiptCount, count); assert.equal(fetched.memory.receiptCount, count);
    assert.equal(fetched.receipts.length, delivered); assert.ok(fetched.receipts.length <= fetched.receiptCount);
    const recalled = ok(await f.core.recall({ readSet: [ns], query: survivor, limit: 12 }));
    const item = recalled.memories.find(item => item.memory.id === b.id);
    assert.ok(item); assert.equal(item.receiptCount, count); assert.equal(item.memory.receiptCount, count);
    assert.equal(item.receipts.length, delivered); assert.ok(item.receipts.length <= item.receiptCount);
    assert.equal(item.receiptsOmitted, undefined, 'an uncapped list has no omission field');
    const linked = ok(episode.getEpisode({ namespace: ns, episodeId, sourceLimit: 16, memoryLimit: 50 }));
    assert.equal(linked.episode.id, episodeId);
    assert.deepEqual(linked.memoryLinks.items.find(link => link.memoryId === b.id).receiptIds, []);
    for (const result of [detail, fetched, recalled, linked]) {
      noLeak(result, 'host evidence'); for (const id of oldIds) assert.equal(hasId(result, id), false);
    }
  }
  f.model.countTokens = () => 1;
  await assertReads(0);
  // Force packing to cap another candidate, while B has zero or one delivered
  // receipt. The existing packer keeps at least one, so B itself is uncapped.
  const crowd = ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic capped neighbor', kind: 'fact' },
    receipts: [0, 1, 2].map(i => receipt('synthetic-capped-neighbor-' + i)) })).memory;
  const capCounter = text => {
    try { if (JSON.parse(text).input?.candidates?.some(item => item.receipts.length > 1)) return 6001; } catch {}
    return 1;
  };
  for (const delivered of [0, 1]) {
    f.model.countTokens = capCounter;
    const capped = ok(await f.core.recall({ readSet: [ns], query: survivor, limit: 12 }));
    const item = capped.memories.find(item => item.memory.id === b.id);
    assert.ok(item); assert.equal(item.receipts.length, delivered); assert.equal(item.receiptCount, delivered + 1);
    assert.equal(item.receiptsOmitted, undefined, 'B is below the existing minimum cap');
    const neighbor = capped.memories.find(item => item.memory.id === crowd.id);
    assert.equal(neighbor.receipts.length, 1); assert.equal(neighbor.receiptCount, 3); assert.equal(neighbor.receiptsOmitted, 2);
    assert.ok(capped.recallTruncated.receiptListsCapped >= 1); noLeak(capped, 'capped host recall');
    if (!delivered) {
      b = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' },
        receipts: [{ ...receipt('synthetic-count-independent'), excerpt: independent }] })).memory;
      f.model.countTokens = () => 1;
      await assertReads(1);
    }
  }
  b = ok(f.core.admit({ namespace: ns, memory: { content: survivor, kind: 'fact' },
    receipts: [receipt('synthetic-count-extra-one'), receipt('synthetic-count-extra-two')] })).memory;
  f.model.countTokens = capCounter;
  const capped = ok(await f.core.recall({ readSet: [ns], query: survivor, limit: 12 }));
  const item = capped.memories.find(item => item.memory.id === b.id);
  assert.ok(item); assert.equal(storedCount(), 4); assert.equal(item.receiptCount, 4);
  assert.equal(item.memory.receiptCount, 4); assert.equal(item.receipts.length, 1);
  assert.equal(item.receiptsOmitted, 3, '4 stored - 1 delivered includes 1 withheld + 2 capped');
});

for (const kind of ordinaryKinds) test(`zero stored receipt corruption ${kind}`, async t => {
  const f = await fixture(t, kind), [b] = await capture(f);
  f.model.countTokens = () => 1;
  f.db.prepare('DELETE FROM receipts WHERE memory_id=?').run(b.id);
  assert.equal(f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(b.id).n, 0);
  const check = (result, project) => {
    if (!result.ok) { assert.equal(result.error.code, 'storage_error'); return; }
    const item = project(result.value); assert.ok(item, 'the corrupt Memory must be accounted for');
    assert.equal(item.memory.receiptCount ?? item.receiptCount, 0);
    if (Object.hasOwn(item, 'receiptCount')) assert.equal(item.receiptCount, 0);
    assert.deepEqual(item.receipts, []);
  };
  check(f.core.get({ namespace: ns, memoryId: b.id }), value => value);
  check(f.core.fetch({ namespace: ns, refs: [{ memoryId: b.id, revision: b.revision }] }), value => value.items[0]);
  check(await f.core.recall({ readSet: [ns], query: survivor, limit: 12 }), value => value.memories.find(item => item.memory.id === b.id));
  const row = f.db.prepare('SELECT * FROM memories WHERE id=?').get(b.id);
  assert.throws(() => sourceEvidence(row, [], 0, key), { code: 'storage_error' });
  for (const contextMode of ['source-evidence', 'rationale-evidence']) {
    assert.equal(f.core.fetch({ namespace: ns, refs: [{ memoryId: b.id, revision: b.revision }], contextMode }).error.code, 'storage_error');
    assert.equal((await f.core.recall({ readSet: [ns], query: survivor, limit: 12, contextMode })).error.code, 'storage_error');
  }
});

test('the recall hook prints a zero-delivered-receipt Memory without a receipt suffix', () => {
  const source = readFileSync(new URL('../../plugins/cairn-memory/scripts/hook.mjs', import.meta.url), 'utf8');
  const start = source.indexOf('  const lines = result.memories.map(');
  const end = source.indexOf('\n  await runIfActive', start);
  assert.ok(start >= 0 && end > start);
  const format = new Function('result', source.slice(start, end) + '\nreturn lines;');
  assert.deepEqual(format({ memories: [{ id: 'synthetic-memory', origin: 'agent-inferred', scope: 'project',
    confidence: .8, content: survivor, receipts: [], receiptCount: 1 }] }),
  [`- [synthetic-memory] (agent-inferred, project, confidence 0.80) ${survivor}`]);
});

test('Raw deletion and shared-source markers preserve the retained receipt count',async t=>{
  const f=await fixture(t,'raw-53');
  const rawCapture=async(sessionId,text,eventId)=>{
    const result=ok(await f.core.captureRaw(request(splitRaw(text,{id:eventId})[0],{namespace:ns,sessionId,eventId})));
    const interpreted=result.interpretation.ok===undefined?result.interpretation:ok(result.interpretation);
    return {conversationId:result.raw.conversationId,memories:interpreted.admission.memories};
  };
  // The shared address is ordinary evidence. Forgetting a real Raw-backed
  // sibling would also install the base Raw exclusion, which is a different
  // authority rule from delivery-only markers.
  // Explicit admission proves that the ordinary shared receipt has independent
  // ancestry; deletion conservatively removes recent unknown-origin receipts.
  ok(f.core.admit({namespace:ns,memory:{content:survivor,kind:'fact'},receipts:[{client:'synthetic',sessionId:'synthetic-ordinary-shared',
    eventId:'synthetic-shared-source',role:'user',excerpt:message}]}));
  const shared=ok(await f.core.capture({namespace:ns,client:'synthetic',sessionId:'synthetic-ordinary-shared',eventId:'synthetic-ordinary-batch',
    messages:[{id:'synthetic-shared-source',role:'user',content:message}]}));
  const [initialB,a]=shared.admission.memories;
  f.model.items=[{content:survivor,kind:'fact',confidence:.8,sourceIndices:[0]}];
  const removed=await rawCapture('synthetic-removed-conversation','Synthetic removed conversation support','synthetic-removed-source');
  const retainedText='Synthetic retained conversation support';
  const retained=await rawCapture('synthetic-retained-conversation',retainedText,'synthetic-retained-source');
  const stored=()=>f.db.prepare('SELECT count(*) n FROM receipts WHERE memory_id=?').get(initialB.id).n;
  assert.equal(stored(),3);
  const conversation=ok(await f.core.getConversation({namespace:ns,conversationId:removed.conversationId})).conversation;
  ok(f.core.deleteConversation({namespace:ns,conversationId:removed.conversationId,expectedRevision:conversation.revision,actionId:'synthetic-combined-deletion'}));
  assert.equal(stored(),2,'conversation deletion removes its receipt');
  ok(act(f,'forget',a));
  async function assertDelivered(excerpts){
    const detail=ok(f.core.get({namespace:ns,memoryId:initialB.id}));
    assert.equal(detail.memory.content,survivor);assert.ok(detail.memory.receiptCount>=1);
    assert.deepEqual(detail.receipts.map(receipt=>receipt.excerpt),excerpts);noLeak(detail,'combined get');
    const request={namespace:ns,refs:[{memoryId:initialB.id,revision:detail.memory.revision}],tokenBudget:4000};
    let cursor,pages=0;const items=[];
    do{const page=ok(f.core.fetch({...request,...(cursor?{cursor}:{})}));items.push(...page.items);cursor=page.nextCursor;assert.ok(++pages<=3,'finite combined fetch pages');noLeak(page,'combined fetch');}while(cursor);
    const recalled=ok(await f.core.recall({readSet:[ns],query:survivor,limit:8}));noLeak(recalled,'combined recall');
    const usage=f.core.fetch({...request,contextMode:'source-evidence'});noLeak(usage,'combined source fetch');
    assert.deepEqual(usage,{ok:false,error:{code:'source_unavailable',retryable:false}});
    for(const values of [items,recalled.memories]){
      const item=values.find(item=>item.memory.id===initialB.id);assert.ok(item);
      assert.ok(item.receiptCount>=1);assert.deepEqual(item.receipts.map(receipt=>receipt.excerpt),excerpts);
    }
    assert.equal(JSON.stringify({detail,items,recalled,usage}).includes('Synthetic removed conversation support'),false);
  }
  await assertDelivered([retainedText]);
  const last=ok(await f.core.getConversation({namespace:ns,conversationId:retained.conversationId})).conversation;
  ok(f.core.deleteConversation({namespace:ns,conversationId:retained.conversationId,expectedRevision:last.revision,actionId:'synthetic-final-deletion'}));
  assert.equal(stored(),1,'the ordinary shared receipt remains stored and withheld');
  await assertDelivered([]);
});
