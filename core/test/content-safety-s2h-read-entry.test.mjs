import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { openMemoryCore } from '../index.mjs';
import { transaction, readTransaction } from '../database.mjs';
import { contentReadSafety, sourceReadSafety, receiptReadSafety, createContentReadMemo } from '../content-safety.mjs';
import { createCardReceiptSources } from '../card-receipt-sources.mjs';
import { bindContentSafetyConnection } from '../content-safety-schema.mjs';
import { contentSafetyFacade, contentReceiptCount } from '../content-safety-boundary.mjs';
import { migrateContentSafety } from '../content-safety-migration.mjs';
import { writeContentSuppressionInside, withContentSuppressionRequest, withContentSuppressionReadInside } from '../content-suppression-storage.mjs';
import { assertContentReadGraph } from '../testing/content-safety-read-audit.mjs';
import { splitSources } from '../testing/content-safety-split-audit.mjs';
import { safetyFixture, copySqliteFixture, quiescence, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { localPlainPort, request as rawRequest, splitRaw } from '../testing/raw-capture-fixtures.mjs';

test('R1 lower-layer import graph rejects predicate re-entry, including aliases and callbacks', t => {
  t.diagnostic('READ_GRAPH ' + JSON.stringify(assertContentReadGraph()));
  for (const [file, mutate] of [
    ['core/raw-lineage-storage.mjs', source => "import { contentReadSafety } from './content-safety.mjs';\n" + source.replace(
      'function assertReceipts(ns, receipts, readExisting = false, rawTargets) {',
      'function assertReceipts(ns, receipts, readExisting = false, rawTargets) {\n    contentReadSafety(db, { namespace: ns, receipts });')],
    ['core/content-suppression-storage.mjs', source => source + '\nconst callback = options => options.contentReadSafety();\n'],
    ['core/raw-source-roots.mjs', source => source + "export { receiptReadSafety as validate } from './content-safety.mjs';\n"],
    ['core/content-safety.mjs', source => source.replace('function rawSuppression(db, ns, targets) {',
      'function rawSuppression(db, ns, targets) {\n  receiptReadSafety(db, targets);')],
  ]) {
    const sources = splitSources(); sources.set(file, mutate(sources.get(file)));
    assert.throws(() => assertContentReadGraph(sources), /re-entry/, file);
  }
  t.diagnostic('READ_GRAPH_MUTATIONS rejected=4');
});

test('R1/R2 S1 memo precedes all fact SQL for Memory, receipt and receipt source decisions', async t => {
  const f = safetyFixture(t); await f.migrate();
  const core = openMemoryCore({ path: f.path }), db = f.connect(); t.after(() => { core.close(); db.close(); });
  const memory = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic memo decision', kind: 'fact' }, receipts: [receipt('memo')] })).memory;
  const stored = db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id);
  const identity = db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  const bind = (purpose, value) => createHmac('sha256', identity.cursorSecret)
    .update(JSON.stringify([purpose, [identity.storeId, value]])).digest('base64url');
  const source = createCardReceiptSources(db, bind).refInside(ns, memory, stored);
  let executed = 0;
  const metered = bindContentSafetyConnection({ get isTransaction() { return db.isTransaction; }, prepare(sql) {
    const statement = db.prepare(sql);
    return new Proxy(statement, { get(target, field) {
      const value = Reflect.get(target, field, target);
      if (typeof value !== 'function') return value;
      return (...args) => { if (['get','all','iterate','run'].includes(field)) executed++; return value.apply(target, args); };
    } });
  } }, db);
  withContentSuppressionRequest(() => readTransaction(db, () => withContentSuppressionReadInside(metered, [ns], () => {
    const memo = createContentReadMemo(metered);
    const decide = () => {
      assert.deepEqual(receiptReadSafety(metered, { namespace: ns, receipt: stored, memo }), { allowed: true });
      assert.deepEqual(sourceReadSafety(metered, { identity, namespace: ns, ref: source, memo }), { allowed: true });
      assert.deepEqual(contentReadSafety(metered, { namespace: ns, ref: { type: 'memory', namespace: ns,
        memoryId: memory.id, revision: memory.revision }, receipts: [stored], memo }), { allowed: true });
    };
    decide(); const before = executed; decide();
    assert.equal(executed - before, 0, 'memo hits execute no S1 or S2h statements');
  })));
});

test('R1 Card memo decisions bind the current-eligibility callback as well as purpose and identity', async t => {
  const f = safetyFixture(t,23); await f.migrate();
  const host = cardHost(), core = openMemoryCore({path:f.path,privateCards:host.options}), db = f.connect();
  t.after(()=>{core.close();db.close();});
  const call = (method,input) => host.call(core,method,{namespace:ns,...input});
  const draft = ok(call('createCardDraft',{actionId:'policy-card',drafting:'authored',input:{
    title:'Synthetic policy Card',body:'Synthetic policy body',authoredInput:{text:'Synthetic policy source',occurredAt:null}}}));
  ok(call('confirmCardDraft',{actionId:'policy-confirm',cardId:draft.id,expectedRevision:draft.revision}));
  const card = ok(call('getCard',{cardId:draft.id})).card;
  const identity = db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  let admitted = 0, refused = 0;
  const eligible = () => { admitted++; return true; }, ineligible = () => { refused++; return false; };
  readTransaction(db,()=>{
    const memo = createContentReadMemo(db), options = {identity,namespace:ns,memo,intent:'current',
      ref:{type:'card',namespace:ns,cardId:card.id,revision:card.revision,bodyRevision:card.bodyRevision}};
    for (let repeat=0;repeat<2;repeat++) {
      assert.deepEqual(contentReadSafety(db,{...options,currentCardEligible:eligible}),{allowed:true});
      assert.deepEqual(contentReadSafety(db,{...options,currentCardEligible:ineligible}),{allowed:false,reason:'ineligible'});
    }
    const recursive = () => contentReadSafety(db,{...options,currentCardEligible:recursive}).allowed;
    assert.throws(()=>contentReadSafety(db,{...options,currentCardEligible:recursive}),{code:'storage_error',contentSafetyReentry:true});
    assert.deepEqual(contentReadSafety(db,{...options,currentCardEligible:eligible}),{allowed:true},'re-entry rejection clears the active decision');
    t.diagnostic('READ_RUNTIME_MUTATION rejected=1');
  });
  assert.equal(admitted,1); assert.equal(refused,1);
});

test('R2 zero-fact Raw proof retains uncertain-ancestry refusal in the existing Memory row statement', async t => {
  const f = safetyFixture(t,33); await f.migrate();
  const core = openMemoryCore({path:f.path}), db = f.connect(); t.after(()=>{core.close();db.close();});
  const memory = ok(core.admit({namespace:ns,memory:{content:'Synthetic ancestry proof',kind:'fact'},receipts:[receipt('ancestry-proof')]})).memory;
  transaction(db,()=>{
    db.prepare('INSERT INTO raw_conversations VALUES(?,?,?,?,?,?,1,?,?)').run('foreign-raw','foreign-synthetic',ns.scope,ns.projectId,'codex','foreign-session','time','time');
    const id = db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memory.id).id;
    db.prepare('INSERT INTO raw_receipt_lineage VALUES(?,?,?,?,?,?)').run(id,'foreign-raw','message',0,2,'exact');
  });
  assert.equal(db.prepare('SELECT count(*) n FROM content_suppressions').get().n,0);
  for (const memoized of [false,true]) withContentSuppressionRequest(()=>readTransaction(db,()=>withContentSuppressionReadInside(db,[ns],()=>{
    assert.deepEqual(contentReadSafety(db,{namespace:ns,intent:'history',
      ref:{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision},
      memo:memoized?createContentReadMemo(db):undefined}),{allowed:false,reason:'ineligible'});
  })));
});

test('R2 owner/epoch fact caches isolate selected namespaces and retain the original request fence', async t => {
  const f = safetyFixture(t); await f.migrate();
  const core = openMemoryCore({path:f.path}), db = f.connect(); t.after(()=>{core.close();db.close();});
  const other = {...ns,projectId:'other-synthetic-project'};
  const make = namespace => ok(core.admit({namespace,memory:{content:'Synthetic scoped fact cache',kind:'fact'},receipts:[receipt('scoped-cache')]})).memory;
  const local = make(ns), remote = make(other);
  transaction(db,()=>{
    writeContentSuppressionInside(db,{namespace:other,kind:'memory',key:remote.id,reason:'purge',actionId:'other-scope'});
    const receiptId = db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(remote.id).id;
    writeContentSuppressionInside(db,{namespace:other,kind:'receipt',key:receiptId,reason:'purge',actionId:'other-receipt'});
  });
  withContentSuppressionRequest(()=>readTransaction(db,()=>{
    for (const namespace of [ns,other,ns]) withContentSuppressionReadInside(db,[namespace],memo=>{
      assert.equal(memo.epoch,'0:2');
      assert.equal(memo.facts.length,namespace===ns?0:2);
      const memory = namespace===ns?local:remote;
      assert.equal(contentReceiptCount(db,namespace,memory,1),namespace===ns?1:0,
        'a primary namespace fact set cannot prove receipt counts in another namespace');
      assert.deepEqual(contentReadSafety(db,{namespace,intent:'history',
        ref:{type:'memory',namespace,memoryId:memory.id,revision:memory.revision}}),
      namespace===ns?{allowed:true}:{allowed:false,reason:'purge'});
    });
  }));
});

test('R2 read caches cannot hide pre-write facts from a nested write acknowledgement', async t => {
  const f = safetyFixture(t); await f.migrate();
  const core = openMemoryCore({path:f.path}), db = f.connect(), other = f.connect();
  t.after(()=>{core.close();db.close();other.close();});
  const memory = ok(core.admit({namespace:ns,memory:{content:'Synthetic nested acknowledgement',kind:'fact'},receipts:[receipt('nested-ack')]})).memory;
  const before = db.prepare('SELECT confidence FROM memories WHERE id=?').get(memory.id).confidence;
  const api = contentSafetyFacade({admit(){return transaction(db,()=>{
    db.prepare('UPDATE memories SET confidence=? WHERE id=?').run(.73,memory.id);
    return {ok:true,value:{memoryId:memory.id}};
  });}}, {check(){},failure:error=>({ok:false,error:{code:error.code}})});
  withContentSuppressionRequest(()=>{
    readTransaction(db,()=>withContentSuppressionReadInside(db,[ns],()=>{
      assert.equal(contentReadSafety(db,{namespace:ns,intent:'history',
        ref:{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}}).allowed,true);
    }));
    transaction(other,()=>writeContentSuppressionInside(other,{namespace:ns,kind:'memory',key:memory.id,reason:'privacy_erase',actionId:'before-nested-write'}));
    const result = api.admit({namespace:ns});
    assert.equal(result.ok,false); assert.equal(result.error.code,'evidence_unavailable');
    assert.ok(!JSON.stringify(result).includes(memory.id));
  });
  assert.equal(db.prepare('SELECT confidence FROM memories WHERE id=?').get(memory.id).confidence,before);
  assert.equal(db.prepare('SELECT count(*) n FROM content_suppressions').get().n,1);
});

for (const base of [18,33]) test(`R2 v${base} read caches do not invalidate a committed nested terminal acknowledgement`, async t => {
  const f = safetyFixture(t,base); await f.migrate();
  const core = openMemoryCore({path:f.path}), db = f.connect();
  t.after(()=>{core.close();db.close();});
  const memory = ok(core.admit({namespace:ns,memory:{content:'Synthetic nested terminal target',kind:'fact'},
    receipts:[receipt('nested-terminal')]})).memory;
  withContentSuppressionRequest(()=>{
    assert.equal(ok(core.get({namespace:ns,memoryId:memory.id})).memory.id,memory.id);
    const result = core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision});
    assert.equal(result.ok,true,JSON.stringify(result));
  });
  assert.equal(db.prepare('SELECT deleted FROM memories WHERE id=?').get(memory.id).deleted,1);
  assert.equal(db.prepare('SELECT count(*) n FROM content_suppressions').get().n,2);
  assert.doesNotMatch(JSON.stringify(core.get({namespace:ns,memoryId:memory.id})),/Synthetic nested terminal target/);
});

test('R1 v18 receipts upgraded to v48 retain the legacy fallback after unrelated same-session Raw capture', async t => {
  const f = safetyFixture(t);
  const original = openMemoryCore({ path: f.path });
  const evidence = {...receipt('before-raw', 'Synthetic legacy receipt'),client:'codex'};
  const memory = ok(original.admit({ namespace: ns, memory: { content: 'Synthetic legacy Memory', kind: 'fact' }, receipts: [evidence] })).memory;
  original.close();
  const authority = { authorize: () => null, isCurrent: () => null };
  const upgraded = openMemoryCore({ path: f.path,
    privateCards: { version: 'private-cards-local-v1', source: 'submitted-note-v1', storage: 'local-plain-v1',
      disclosure: 'explicit-submitted-note-v1', authority, currentDependencies: { version: 'card-current-dependencies-v1' } },
    methodPackages: { version: 'method-packages-local-v1', storage: 'local-plain-v1', authority } });
  upgraded.close();
  copySqliteFixture(f.path, f.backupPath);
  await migrateContentSafety({ path: f.path, backupPath: f.backupPath, expected: { storeId: f.storeId, base: 33 }, quiescence });
  const core = openMemoryCore({ path: f.path, model: rationaleModel(), rawConversations: { mode: 'raw-v1', port: localPlainPort(), capBytes: 1048576,
    readPolicy: () => ({ generation: 'synthetic', reason: null }) } });
  t.after(() => core.close());
  const first = ok(await core.captureRaw(rawRequest(splitRaw('Synthetic unrelated Raw input')[0],
    { namespace: ns, client: evidence.client, sessionId: evidence.sessionId, eventId: 'after-raw' })));
  assert.equal(first.raw.parts[0].saved,true);
  const db = f.connect(); t.after(() => db.close());
  const stored = db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id);
  assert.equal(db.prepare('SELECT 1 FROM raw_receipt_origins WHERE receipt_id=?').get(stored.id), undefined);
  for (const memoized of [false, true]) readTransaction(db, () => {
    const memo = memoized ? createContentReadMemo(db) : undefined;
    for (let repeat = 0; repeat < 2; repeat++) {
      assert.deepEqual(receiptReadSafety(db, { namespace: ns, receipt: stored, memo }), { allowed: true });
      assert.deepEqual(contentReadSafety(db, { namespace: ns,
        ref: { type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }, receipts: [stored], memo }), { allowed: true });
    }
  });
  assert.equal(ok(core.get({ namespace: ns, memoryId: memory.id })).memory.content, 'Synthetic legacy Memory');
  // An exact legacy fallback anchor is handed to the fact stage as data. A
  // fact-only Raw denial must apply even though the old receipt has no stored
  // lineage row and no canonical Raw exclusion was written.
  ok(await core.captureRaw(rawRequest({...splitRaw(evidence.excerpt)[0],id:evidence.eventId,messageOrdinal:2},
    { namespace: ns, client: evidence.client, sessionId: evidence.sessionId, eventId: 'matching-raw' })));
  assert.equal(db.prepare('SELECT 1 FROM raw_receipt_lineage WHERE receipt_id=?').get(stored.id),undefined);
  const raw = db.prepare('SELECT conversation_id FROM raw_messages WHERE message_id=?').get(evidence.eventId);
  transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'raw', key: raw.conversation_id,
    matchMode: 'span', messageId: evidence.eventId, start: 0, end: 3, reason: 'purge', actionId: 'legacy-raw-denial' }));
  for (const memoized of [false, true]) readTransaction(db, () => {
    assert.deepEqual(receiptReadSafety(db, { namespace: ns, receipt: stored,
      memo: memoized ? createContentReadMemo(db) : undefined }), { allowed: false, reason: 'purge' });
  });
  transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'receipt', key: stored.id,
    reason: 'privacy_erase', actionId: 'legacy-receipt-denial' }));
  for (const memoized of [false, true]) readTransaction(db, () => {
    assert.deepEqual(receiptReadSafety(db, { namespace: ns, receipt: stored,
      memo: memoized ? createContentReadMemo(db) : undefined }), { allowed: false, reason: 'privacy_erase' });
  });
  assert.doesNotMatch(JSON.stringify(core.get({ namespace: ns, memoryId: memory.id })), /Synthetic legacy receipt/);
});
