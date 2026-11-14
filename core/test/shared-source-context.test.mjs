import { productSidecar } from "../context-product-sidecar.mjs";
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { ns, ok, receipt } from "../testing/card-lineage-fixture.mjs";
import { openContextProductFacade } from "../context-read-facade.mjs";
import { openProductIndex } from "../context-product-index.mjs";
import { accessDigest } from "../context-product-validation.mjs";
import { configured, descriptor } from "../testing/context-product-owner-fixture.mjs";
import { readTransaction } from "../database.mjs";
import { receiptDeliverySnapshot, createContentReadMemo, cardDeliverySnapshot, cardDeliverable } from "../content-safety.mjs";
import { receiptDenialTokens } from "../content-safety.mjs";
import { message, operations, isLookup, source, noLeak, hasId, trace, fixture, capture, act, memoryRef, reads } from "../testing/shared-source-fixture.mjs";
// A pending adapter/worker call must fail the case within the file budget.
const test=(name,run)=>nodeTest(name,{timeout:15000},run);

for (const kind of ['ordinary-53', 'ordinary-48']) test(`embedded and product context omit withheld provenance ids ${kind}`, async t => {
  const f = await fixture(t, kind), [b, a] = await capture(f);
  ok(f.core.admit({ namespace: ns, memory: { content: 'Synthetic third surviving signal', kind: 'fact' }, receipts: [source()] }));
  const denied = f.db.prepare('SELECT id FROM receipts WHERE excerpt=?').all(message).map(row => row.id);
  ok(await act(f, 'forget', a));
  const embedded = await reads(f, b, []);
  const service = configured(t, f.path, [ns], { service: true }), maintainer = await service.open();
  const refreshed = await maintainer.refreshContextIndex({ readSet: [ns], types: ['memory'], intent: 'current',
    mode: 'lexical', budget: { maxItems: 1024, maxMs: 5000 } }, service.token);
  if (!refreshed.ok) assert.equal(refreshed.error?.code, 'index_unavailable');
  await maintainer.close();
  const config = configured(t, f.path, [ns]), reader = await config.open();
  const product = ok(await reader.contextRead({ readSet: [ns], types: ['memory'], intent: 'current', query: 'Synthetic',
    semantic: false, deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } }, config.token));
  for (const [name, value] of Object.entries({ embedded: embedded.contextRead, product })) {
    noLeak(value, name); for (const id of denied) assert.equal(hasId(value, id), false, name + ' withheld receipt id');
    assert.ok(hasId(value, b.id), name + ' retains B');
  }
});

for (const route of ['embedded', 'product']) for (const marked of [false, true])
for (const multiNamespace of [false, true])
test(`context receipt lookups are batched per snapshot ${route}, markers=${marked}, namespaces=${multiNamespace ? 2 : 1}`, async t => {
  const f = await fixture(t, 'ordinary-53');
  const readSet = multiNamespace ? [ns, { ...ns, scope: 'personal', projectId: null }] : [ns], expected = [];
  f.trusted.state.allowed = readSet;
  const deniedIds = [];
  for (let index = 0; index < 12; index++) {
    const namespace = readSet[index % readSet.length], excerpt = 'Synthetic context support ' + index;
    const evidence = receipt('synthetic-context-' + index, excerpt);
    const qualification = { version: 1, slot: { subject: 'User', property: 'signal', scope: null, applies: null },
      value: excerpt, attribution: 'direct', commitment: 'considered',
      anchors: [{ receiptIndex: 0, start: 0, end: excerpt.length, text: excerpt, fields: ['subject', 'property', 'value', 'attribution', 'commitment'] }] };
    const memory = ok(f.core.admit({ namespace, memory: { content: 'Synthetic context candidate ' + index, kind: 'fact' },
      receipts: [evidence], qualification })).memory;
    expected.push(memory.id);
    if (marked && index % 3 === 0) {
      const row = f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id);
      deniedIds.push(row.id);
      for (const token of receiptDenialTokens([row])) f.db.prepare('INSERT INTO suppressed VALUES(?,?,?,?)')
        .run(namespace.ownerId, namespace.scope, namespace.projectId ?? '', token);
    }
  }
  const input = { readSet, types: ['memory'], intent: 'current', query: 'Synthetic context', semantic: false,
    deadlineMs: 5000, budget: { maxItems: 12, maxTokens: 3000 } };
  let call;
  if (route === 'embedded') {
    ok(await f.trusted.call(f.context, 'refreshContextIndex', { readSet, types: ['memory'], intent: 'current',
      budget: { maxItems: 1024, maxMs: 5000 } }));
    call = () => f.trusted.call(f.context, 'contextRead', input);
  } else {
    // The worker uses this exact private index. Running it in-process lets the
    // statement meter observe canonical SQLite execution without worker hooks.
    const facade = openContextProductFacade(f.path, {});
    const index = openProductIndex({ path: f.path, facade, ownerCoverage: descriptor(readSet), maintenance: true,
      counter: { id: 'synthetic', countTokens: () => 1 },
      authorize: () => ({ accessGenerations: accessDigest({ ownerId: ns.ownerId, namespaces: { readSet } }),
        check() {}, envelope: work => work() }) });
    t.after(() => { index.close(); facade.close(); });
    ok(index.run('refreshContextIndex', { readSet, types: ['memory'], intent: 'current', mode: 'lexical',
      budget: { maxItems: 1024, maxMs: 5000 } }, {}));
    call = () => index.run('contextRead', input, {});
  }
  const measured = await trace(call), value = ok(measured.result);
  assert.equal(value.metered.items.length, 12);
  for (const id of expected) assert.ok(hasId(value, id), 'every candidate remains readable');
  for (const id of deniedIds) assert.equal(hasId(value, id), false, 'withheld provenance id');
  for (let index = 0; index < 12; index++) assert.equal(
    JSON.stringify(value).includes('Synthetic context support ' + index + '"'), !(marked && index % 3 === 0),
    'only denied receipt excerpts are omitted');
  const lookups = measured.rows.filter(isLookup);
  assert.equal(lookups.length, 2, 'one preparation lookup and one independent final-delivery lookup');
  assert.equal(new Set(lookups.map(row => row.snapshot)).size, 2);
  const collectors = measured.rows.filter(row => row.sql.includes('CROSS JOIN qualification_anchors q'));
  assert.equal(collectors.length, 2, 'one anchor collector in each delivery snapshot');
  assert.equal(new Set(collectors.map(row => row.snapshot)).size, 2);
  for (const lookup of lookups) {
    assert.ok(lookup.snapshot, 'lookup belongs to an actual read transaction');
    const tokens=JSON.parse(lookup.args[0]);
    assert.equal(tokens.length,24,'two JavaScript tokens for each of twelve selected receipt headers');
    assert.ok(tokens.every(tuple=>readSet.some(namespace=>tuple[0]===namespace.ownerId&&tuple[1]===namespace.scope&&tuple[2]===(namespace.projectId??''))));
    assert.ok(tokens.every(tuple=>/^rs1:[ia]:[0-9a-f]{64}$/.test(tuple[3])));
    const plan = f.db.prepare('EXPLAIN QUERY PLAN ' + lookup.sql).all(...lookup.args);
    assert.ok(plan.some(row => /SEARCH s USING (?:COVERING )?INDEX sqlite_autoindex_suppressed_1/.test(row.detail) &&
      ['owner_id=?', 'scope=?', 'project_id=?', 'fingerprint=?'].every(part => row.detail.includes(part))));
  }
});

for (const operation of operations) for (const route of ['embedded','product'])
test(`candidate fetch aligns omitted Cards and caller fences ${route} ${operation}`, async t => {
  const f=await fixture(t,'ordinary-53',operation),[b,a]=await capture(f);
  let card=ok(f.call('createCardDraft',{actionId:'synthetic-candidate-draft',drafting:'authored',input:{title:'Synthetic',body:message,
    memoryRefs:[memoryRef(b)],sourcePolicy:'retained-receipts-v1'}}));
  card=ok(f.call('confirmCardDraft',{actionId:'synthetic-candidate-confirm',cardId:card.id,expectedRevision:card.revision,applicability:'current'}));
  const cardRef={type:'card',namespace:ns,cardId:card.id,revision:card.revision,bodyRevision:card.bodyRevision};
  const c=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic unaffected candidate',kind:'fact'},receipts:[receipt('synthetic-candidate-independent')]})).memory;
  ok(act(f,operation,a));
  let call;
  if(route==='product') {
    const facade=openContextProductFacade(f.path,{authorize:()=>({accessGenerations:[1],check(){}})});
    t.after(()=>facade.close());call=input=>facade.fetchCandidateEvidence(input,{});
  } else call=input=>f.trusted.call(f.context,'fetchCandidateEvidence',input);
  // Put the omitted Card before both retained items to expose fence shifts.
  const input={readSet:[ns],intent:'current',refs:[cardRef,memoryRef(b),memoryRef(c)]};
  const first=ok(await call(input));
  assert.deepEqual(first.items.map(item=>item.ref.memoryId),[b.id,c.id]);
  assert.deepEqual(first.items[0].provenance.sources,[]);
  const saved=JSON.parse(Buffer.from(first.snapshot.split('.')[0],'base64url').toString());
  assert.equal(saved.refs.length,2);assert.equal(saved.fences.length,2);
  const checked=ok(await call({...input,fences:['omitted0',...saved.fences.map(value=>value.slice(0,8))]}));
  assert.deepEqual(checked.items,first.items);
  assert.deepEqual(ok(await call({readSet:[ns],snapshot:first.snapshot})).items,first.items);
  const wrong=await call({...input,fences:[null,null,'invalid0']});
  assert.equal(wrong.error.code,'snapshot_stale');
  const empty=ok(await call({...input,refs:[cardRef]}));assert.deepEqual(empty.items,[]);
  assert.deepEqual(ok(await call({readSet:[ns],snapshot:empty.snapshot})).items,[]);
  for(const result of [first,checked,empty]){noLeak(result,'candidate fetch');assert.equal(hasId(result,card.id),false);}
});

test('receipt snapshot deduplicates before count, offset and anchor reads',async t=>{
  const f=await fixture(t,'ordinary-53'),entries=[];
  for(let i=0;i<12;i++) {
    const b=ok(f.core.admit({namespace:ns,memory:{content:'Synthetic deduplicated candidate '+i,kind:'fact'},receipts:[receipt('synthetic-deduplicated-'+i)]})).memory;
    entries.push({namespace:ns,memoryId:b.id});
  }
  const measured=await trace(()=>readTransaction(f.db,()=>{
    const memo=createContentReadMemo(f.db);
    receiptDeliverySnapshot(f.db,[],memo,[],{limit:17});
    for(let i=0;i<12;i++)receiptDeliverySnapshot(f.db,[...entries,...entries],memo,[],{limit:17});
    return memo.deliveryHeaders.size;
  }));
  assert.equal(measured.result,12);assert.equal(measured.rows.filter(isLookup).length,1);
  assert.equal(measured.rows.filter(row=>row.sql.startsWith('SELECT count(*) AS n FROM receipts r INDEXED BY memory_receipts')).length,0);
  const counts=measured.rows.filter(row=>row.sql.startsWith('SELECT j.value AS input,(SELECT count(*)'));
  assert.equal(counts.length,1);assert.equal(JSON.parse(counts[0].args[0]).length,12);
  const anchors=measured.rows.filter(row=>row.sql.includes('CROSS JOIN qualification_anchors q'));
  assert.equal(anchors.length,1);assert.equal(JSON.parse(anchors[0].args[0]).length,12);
  assert.equal(anchors[0].args[0],anchors[0].args[1],'both anchor kinds use the same job list');
});

test('Card delivery reuses batched contributors including empty sets within one snapshot',async t=>{
  const f=await fixture(t,'ordinary-53'),[b,a]=await capture(f),refs=[];
  for(let i=0;i<2;i++){
    const card=ok(f.call('createCardDraft',{actionId:'synthetic-token-card-'+i,drafting:'authored',input:{
      title:'Synthetic token Card',body:'Synthetic token body',memoryRefs:[memoryRef(b)],sourcePolicy:'retained-receipts-v1'}}));
    refs.push({type:'card',namespace:ns,cardId:card.id});
  }
  const note=ok(f.call('submitSourceNote',{actionId:'synthetic-token-note',text:'Synthetic note support',occurredAt:null})).source;
  const empty=ok(f.call('createCardDraft',{actionId:'synthetic-token-empty',drafting:'authored',input:{
    title:'Synthetic note Card',body:'Synthetic note body',sources:[note]}}));
  refs.push({type:'card',namespace:ns,cardId:empty.id});
  const check=()=>readTransaction(f.db,()=>{
    const memo=cardDeliverySnapshot(f.db,refs);
    cardDeliverySnapshot(f.db,[...refs,...refs],memo);
    return refs.map(ref=>cardDeliverable(f.db,ns,ref.cardId,memo));
  });
  for(const marked of [false,true]){
    if(marked)ok(act(f,'forget',a));
    const measured=await trace(check);
    assert.deepEqual(measured.result,[!marked,!marked,true]);
    const collectors=measured.rows.filter(row=>row.sql.includes('CROSS JOIN card_memory_bindings b'));
    assert.equal(collectors.length,1,'one contributor collection for all selected Cards');
    assert.equal(JSON.parse(collectors[0].args[0]).length,3);
    assert.doesNotMatch(collectors[0].sql,/excerpt|r\.\*/);
  }
});

for(const kind of ['ordinary-48','ordinary-53'])
test(`product Card lexical filtering refills the ranking bound ${kind}`,async t=>{
  const f=await fixture(t,kind),cards=[];
  for(let i=0;i<26;i++) {
    f.model.items=[{content:'Synthetic lexical claim '+i,kind:'fact',confidence:.8,sourceIndices:[0]}];
    const memory=ok(await f.core.capture({namespace:ns,client:'synthetic',sessionId:'synthetic-lexical-'+i,eventId:'synthetic-lexical-batch-'+i,
      messages:[{id:'synthetic-lexical-message-'+i,role:'user',content:message+' '+i}]})).admission.memories[0];
    let card=ok(f.call('createCardDraft',{actionId:'synthetic-lexical-card-'+i,drafting:'authored',input:{title:'Synthetic needle',body:'Synthetic needle body',
      memoryRefs:[memoryRef(memory)],sourcePolicy:'retained-receipts-v1'}}));
    card=ok(f.call('confirmCardDraft',{actionId:'synthetic-lexical-confirm-'+i,cardId:card.id,expectedRevision:card.revision,applicability:'current'}));
    cards.push({card,memory});
  }
  const facade=openContextProductFacade(f.path,{}),p={readSet:[ns],types:['card'],intent:'current',ownerCoverage:descriptor([ns])};
  const storage=productSidecar({path:f.path,db:facade.port.db,identity:facade.port.identity,features:facade.port.features,writable:true});
  t.after(()=>{storage.close();facade.close();});
  const access=accessDigest({ownerId:ns.ownerId,namespaces:{readSet:[ns]}});
  let observed;
  for(let i=0;i<4;i++) {storage.refresh(p,access,{maxItems:1024,maxMs:1000});observed=storage.observe(p,access);if(observed.dto.lexical.state==='ready')break;}
  assert.equal(observed.dto.lexical.state,'ready');
  const before=storage.lexical(p,observed.publication,'needle',32);assert.equal(before.rows.length,26);
  const denied=new Set(before.rows.slice(0,24).map(row=>row.ref.cardId));
  // Layout 48's zero-fact store reaches the no-fact lexical arm. Layout 53
  // always uses the lineage-aware arm for Cards. Synthetic marker insertion
  // keeps the publication and fact epoch fixed so both arms are exercised.
  for(const {card,memory}of cards.filter(({card})=>denied.has(card.id))) {
    const rows=f.db.prepare('SELECT * FROM receipts WHERE memory_id=?').all(memory.id);
    for(const token of receiptDenialTokens(rows))f.db.prepare('INSERT OR IGNORE INTO suppressed VALUES(?,?,?,?)').run(ns.ownerId,ns.scope,ns.projectId,token);
  }
  const measured=await trace(()=>storage.lexical(p,observed.publication,'needle'));
  assert.equal(measured.result.matched,2);assert.equal(measured.result.rows.length,2);
  for(const row of measured.result.rows)assert.equal(denied.has(row.ref.cardId),false);
  assert.equal(measured.rows.filter(isLookup).length,kind==='ordinary-48'?2:1,
    'one union lookup per population pass; ordinary withholding corrects published BM25 totals in a bounded replay');
});
