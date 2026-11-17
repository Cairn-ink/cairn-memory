import { host as roleHost, publish as rolePublish, read as roleRead } from "./role-fixture.mjs";
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { openMemoryCore } from "../index.mjs";
import { ns, ok, receipt } from "../testing/card-lineage-fixture.mjs";
import { createContentReadMemo } from "../content-safety.mjs";
import { receiptDenialsInside, receiptDenialTokens } from "../content-safety.mjs";
import { survivor, forgotten, message, operations, source, otherNamespace, noLeak, hasId, fixture, capture, act, markers, memoryRef } from "../testing/shared-source-fixture.mjs";
// A pending adapter/worker call must fail the case within the file budget.
const test=(name,run)=>nodeTest(name,{timeout:15000},run);

for (const kind of ['ordinary-48', 'ordinary-53']) for (const operation of ['forget', 'correct'])
test(`review 8 unrelated Card invalidation ${kind} ${operation}`, async t => {
  const f = await fixture(t, kind);
  const add = (content, evidence) => ok(f.core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [evidence] })).memory;
  const a = add(forgotten, source()), d = add('Synthetic retained contributor', source());
  const b = add(survivor, receipt('synthetic-independent-card'));
  let card = ok(f.call('createCardDraft', { actionId: 'synthetic-dependent-card', drafting: 'authored',
    input: { title: 'Synthetic title', body: 'Synthetic independent Card body', memoryRefs: [memoryRef(b), memoryRef(d)], sourcePolicy: 'retained-receipts-v1' } }));
  card = ok(f.call('confirmCardDraft', { actionId: 'synthetic-confirm-card', cardId: card.id,
    expectedRevision: card.revision, applicability: 'current' }));
  const before = f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(card.id);
  ok(act(f, 'forget', a));
  assert.deepEqual(f.db.prepare('SELECT * FROM private_cards WHERE id=?').get(card.id), before);
  const result = ok(act(f, operation, b));
  assert.ok(result.indexRevision);
  assert.ok(f.db.prepare('SELECT revision FROM private_cards WHERE id=?').get(card.id).revision > before.revision);
  const served = f.call('getCard', { cardId: card.id });
  assert.equal(ok(served).card, null, 'invalidation never waives Card delivery');
  assert.equal(ok(f.core.get({ namespace: ns, memoryId: d.id })).memory.content, 'Synthetic retained contributor');
});

for (const kind of ['ordinary-48','ordinary-53']) for (const writer of ['capture','duplicate-extraction','admit','filing'])
test(`native nonterminal invalidation ${kind} ${writer}`, async t => {
  const f=await fixture(t,kind);
  const add=(content,evidence)=>ok(f.core.admit({namespace:ns,memory:{content,kind:'fact'},receipts:[evidence]})).memory;
  const a=add(forgotten,source()),d=add('Synthetic retained dependency',source()),b=add(survivor,receipt('synthetic-original'));
  let card=ok(f.call('createCardDraft',{actionId:'synthetic-native-draft',drafting:'authored',input:{title:'Synthetic',body:'Synthetic body',
    memoryRefs:[memoryRef(b),memoryRef(d)],sourcePolicy:'retained-receipts-v1'}}));
  card=ok(f.call('confirmCardDraft',{actionId:'synthetic-native-confirm',cardId:card.id,expectedRevision:card.revision,applicability:'current'}));
  ok(act(f,'forget',a));
  const extra=receipt('synthetic-additional');
  if(writer==='admit') assert.equal(add(survivor,extra).id,b.id);
  else if(writer==='filing') {
    assert.equal(add(survivor,extra).id,b.id);
    const current=ok(f.core.get({namespace:ns,memoryId:b.id})).memory,map=ok(f.core.map({namespace:ns}));
    ok(f.core.applyPlacement({namespace:ns,expectedIndexRevision:map.indexRevision,expectedMemoryRevisions:[{memoryId:b.id,revision:current.revision}],
      proposal:{items:[{memoryId:b.id,parentIds:[],newL1:{title:'Synthetic native topic',parentL2Ids:[]}}]}}));
  } else {
    f.model.items=[{content:survivor,kind:'fact',confidence:.8,sourceIndices:[0]}];
    if(writer==='duplicate-extraction') f.model.items.push({...f.model.items[0],sourceIndices:[1]});
    ok(await f.core.capture({namespace:ns,client:extra.client,sessionId:extra.sessionId,eventId:'synthetic-native-capture',
      messages:[{id:extra.eventId,role:extra.role,content:extra.excerpt},
        ...(writer==='duplicate-extraction'?[{id:'synthetic-extra-message',role:'user',content:'Synthetic other attachment'}]:[])]}));
  }
  const value=ok(f.core.get({namespace:ns,memoryId:b.id}));
  assert.ok(value.memory.revision>b.revision);
  assert.ok(value.receipts.some(r=>r.eventId===extra.eventId),'new independent receipt commits');
  assert.equal(ok(f.call('getCard',{cardId:card.id})).card,null);
});

for(const kind of ['ordinary-33','ordinary-48','ordinary-53']) test(`selectEvidence skips denied Card including peek ${kind}`,async t=>{
  const f=await fixture(t,kind),[b,a]=await capture(f);
  let card=ok(f.call('createCardDraft',{actionId:'synthetic-select-draft',drafting:'authored',input:{title:'Unrelated title',body:'Unrelated body',
    memoryRefs:[memoryRef(b)],sourcePolicy:'retained-receipts-v1'}}));
  card=ok(f.call('confirmCardDraft',{actionId:'synthetic-select-confirm',cardId:card.id,expectedRevision:card.revision,applicability:'current'}));
  ok(act(f,'forget',a));
  for(const limit of [1,24]) {
    const value=ok(f.call('selectEvidence',{query:survivor,types:['memory','card'],intent:'current',limit}));
    assert.deepEqual(value.items.map(item=>item.ref.memoryId),[b.id]);
    assert.equal(value.nextCursor,null);noLeak(value,'selection omits denied Card');
  }
});

for(const operation of operations) test(`delivery-only mixed evidence omits a marked Card and keeps its Memory ${operation}`,async t=>{
  const f=await fixture(t,'ordinary-53',operation),[b,a]=await capture(f);
  let card=ok(f.call('createCardDraft',{actionId:'synthetic-mixed-draft',drafting:'authored',input:{title:'Synthetic',body:message,
    memoryRefs:[memoryRef(b)],sourcePolicy:'retained-receipts-v1'}}));
  card=ok(f.call('confirmCardDraft',{actionId:'synthetic-mixed-confirm',cardId:card.id,expectedRevision:card.revision,applicability:'current'}));
  const ref={type:'card',namespace:ns,cardId:card.id,revision:card.revision,bodyRevision:card.bodyRevision};
  const shared=f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(b.id);
  const changed=ok(act(f,operation,a));
  assert.equal(receiptDenialsInside(f.db,ns,[shared],createContentReadMemo(f.db)).has(shared.receipt_key),true);
  const corrected=operation==='correct'?changed.memory:null;
  if(corrected){
    const kept=f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(corrected.id);
    assert.equal(kept.length,1);assert.equal(kept[0].event_id,'synthetic-correction');
    assert.notEqual(kept[0].receipt_key,shared.receipt_key);
    assert.deepEqual(receiptDenialTokens([kept[0]]).filter(token=>markers(f).includes(token)),[]);
    assert.ok(markers(f).includes(receiptDenialTokens([shared])[1]),'shared message address is marked');
  }
  assert.equal(ok(f.call('getCard',{cardId:card.id})).card,null);
  const fetched=ok(f.call('fetchEvidence',{intent:'current',refs:[memoryRef(b),ref]}));
  assert.deepEqual(fetched.items.map(item=>item.ref.memoryId),[b.id]);
  assert.deepEqual(fetched.items[0].provenance.sources,[]);
  assert.deepEqual(ok(f.call('revalidateEvidence',{snapshot:fetched.snapshot})).items,fetched.items);
  const selected=ok(f.call('selectEvidence',{intent:'current',query:'Synthetic',types:['memory','card'],limit:24}));
  assert.deepEqual(selected.items.map(item=>item.ref.memoryId).sort(),[b.id,...(corrected?[corrected.id]:[])].sort());
  assert.ok(selected.items.every(item=>item.type==='memory'),'the marked Card is omitted');
  for(const result of [fetched,selected]){noLeak(result,'mixed evidence');assert.equal(hasId(result,shared.id),false);assert.equal(hasId(result,card.id),false);}
  for(const invalid of [{...ref,namespace:otherNamespace},{...ref,cardId:'synthetic-missing'}, {...ref,revision:0}])
    assert.equal(f.call('fetchEvidence',{intent:'current',refs:[memoryRef(b),invalid]}).ok,false);
  const host=roleHost({counter:{id:'synthetic',countTokens:()=>1}});
  const roles=openMemoryCore({path:f.path,methodPackages:host.methods,assets:host.assets,roleProfiles:host.options,contextRead:host.context});
  t.after(()=>roles.close());
  ok(roles.publishRoleProfileRelease(rolePublish(ns,'synthetic-role','synthetic-role-publication'),{}));
  const context=ok(roles.readRoleTaskContext({...roleRead('synthetic-role',[ns]),task:'Synthetic'},{}));
  noLeak(context,'role task context');assert.ok(hasId(context,b.id));assert.equal(hasId(context,card.id),false);
  const retainedId=f.db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(b.id).id;
  assert.equal(hasId(context,retainedId),false);

});

for(const operation of operations) test(`delivery-only unchanged Card confirmation and retained-receipt creation succeed ${operation}`,async t=>{
  const f=await fixture(t,'ordinary-53',operation),[b,a]=await capture(f);
  const draft=actionId=>ok(f.call('createCardDraft',{actionId,drafting:'authored',input:{title:'Synthetic title',body:message,
    memoryRefs:[memoryRef(b)],sourcePolicy:'retained-receipts-v1'}}));
  const card=draft('synthetic-retained-draft');ok(act(f,operation,a));
  const confirmed=ok(f.call('confirmCardDraft',{actionId:'synthetic-retained-confirm',cardId:card.id,expectedRevision:card.revision,applicability:'current'}));
  assert.equal(confirmed.state,'confirmed');
  const later=draft('synthetic-later-draft');
  for(const c of [confirmed,later]){const read=ok(f.call('getCard',{cardId:c.id}));assert.equal(read.card,null);noLeak(read,'Card projection');}
  const listed=ok(f.call('listCards',{states:['draft','confirmed'],limit:50}));
  assert.deepEqual(listed.cards,[]);noLeak(listed,'Card listing');
});
