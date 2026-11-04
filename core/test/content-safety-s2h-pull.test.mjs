import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { suppressionFixture, ns, ok, receipt } from '../testing/content-suppression-fixture.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside, suppressOwnerInside } from '../content-suppression-storage.mjs';
import { denialKeyFromFact, denialKeyTarget, denialKeyMatches } from '../content-suppression-input.mjs';
const matches = (key,c) => denialKeyMatches(key,c,undefined,ns.ownerId);

for (const base of [18,23,33]) test(`S2h pull ${base}: owner windows, exact envelopes and fixed batch snapshots`, async t => {
  const f = await suppressionFixture(t,base), a = f.descriptor(f.memory()), b = f.descriptor(f.memory('Synthetic second source'));
  const { handle } = await f.reader();
  assert.deepEqual(Object.keys(handle).sort(),['close','isSuppressed','listSuppressionsSince']);
  const options = { expected:f.checkpoint(0),limit:1 };
  const initial = ok(await handle.isSuppressed(ns.ownerId,[a,b],options,f.credential));
  assert.deepEqual(initial.results,[{ inputIndex:0,suppressed:false,reasons:[],matchedEpoch:null }]);
  f.fact(b,{ reason:'privacy_erase' });
  f.db.exec("UPDATE content_suppressions SET cleanup_status='failed',cleanup_attempt=cleanup_attempt+1; UPDATE content_suppressions SET cleanup_status='complete',cleanup_attempt=cleanup_attempt+1");
  const later = ok(await handle.isSuppressed(ns.ownerId,[a,b],{ ...options,cursor:initial.nextCursor },f.credential));
  assert.deepEqual(later.results,[{ inputIndex:1,suppressed:false,reasons:[],matchedEpoch:null }]);
  assert.equal(later.observedEpoch,'0'); assert.equal(later.nextCursor,null);
  const fresh = ok(await handle.isSuppressed(ns.ownerId,[a,b],{ expected:f.checkpoint(0) },f.credential));
  assert.equal(fresh.observedEpoch,'1'); assert.equal(fresh.results[1].suppressed,true);
  f.fact(a); const first = ok(await handle.listSuppressionsSince(ns.ownerId,'0',options,f.credential));
  assert.equal(first.items[0].epoch,'1'); assert.equal(first.throughEpoch,'2'); assert.ok(first.nextCursor);
  f.fact(a,{ reason:'user_forget' });
  const second = ok(await handle.listSuppressionsSince(ns.ownerId,'0',{ ...options,cursor:first.nextCursor },f.credential));
  assert.equal(second.throughEpoch,'2'); assert.equal(second.items[0].epoch,'2'); assert.equal(second.nextCursor,null);
  const next = ok(await handle.listSuppressionsSince(ns.ownerId,'2',{ expected:f.checkpoint(2) },f.credential));
  assert.equal(next.items.length,1); assert.equal(next.items[0].epoch,'3');
  const empty = ok(await handle.listSuppressionsSince(ns.ownerId,'3',{ expected:f.checkpoint(3) },f.credential));
  assert.deepEqual(empty,{ items:[],throughEpoch:'3',nextCursor:null });
  for (const value of [initial,later,fresh,first,second,next,empty]) f.clean(value);
});

test('S2h DenialKey fact/wire/target round trips every mode without content or widening', async t => {
  const f = await suppressionFixture(t), c = f.descriptor(f.memory()), raw = { ...c,kind:'raw',messageId:'synthetic-message',span:{ start:4,end:8,precision:'exact' } };
  for (const patch of [
    { namespace:{ ownerId:ns.ownerId,scope:'owner',projectId:'' },kind:'owner',key:'',matchMode:'owner' },
    { kind:'namespace',key:'',matchMode:'namespace' }, {},
    { matchMode:'version',sourceVersion:'["memory-revision-v1",4]' },
    { matchMode:'revision-through',sourceVersion:'["memory-revision-through-v1",6]' },
    { kind:'raw',matchMode:'span',messageId:raw.messageId,start:3,end:5 },
  ]) transaction(f.db,() => writeContentSuppressionInside(f.db,{ namespace:ns,kind:'memory',key:c.key,reason:'purge',actionId:randomUUID(),...patch }));
  const rows = f.db.prepare('SELECT * FROM content_suppressions ORDER BY epoch_hi,epoch_lo').all();
  for (const row of rows) {
    const wire = JSON.parse(JSON.stringify(denialKeyFromFact(row))), target = denialKeyTarget(wire,ns.ownerId);
    for (const [key,value] of Object.entries(target)) assert.equal(value,row[key],key);
    const descriptor = wire.matchMode === 'span' ? raw : { ...c,boundRevision:4 };
    assert.equal(matches(wire,descriptor),true,wire.matchMode);
    if (wire.matchMode === 'revision-through') {
      assert.equal(matches(wire,{ ...c,boundRevision:6 }),true);
      assert.equal(matches(wire,{ ...c,boundRevision:7 }),false);
    }
    if (wire.matchMode === 'span') assert.equal(matches(wire,{ ...raw,span:{ ...raw.span,start:5,end:10 } }),false);
    if (wire.matchMode === 'owner') {
      assert.equal(matches(wire,{ ...c,namespace:{ ...ns,projectId:'another' },key:randomUUID(),incarnation:randomUUID() }),true);
      assert.equal(matches(wire,{ ...c,namespace:{ ...ns,ownerId:'different-owner' } }),false);
    }
    if (wire.matchMode === 'namespace') assert.equal(matches(wire,{ ...c,key:randomUUID(),incarnation:randomUUID(),kind:'card' }),true);
    f.clean(wire);
  }
});

test('S2h M@4 is retained unchanged through correction retiring M@6 and creating M@7', async t => {
  const f = await suppressionFixture(t), memory = f.memory();
  f.db.prepare('UPDATE memories SET revision=4 WHERE id=?').run(memory.id);
  const delivered = ok(f.core.get({ namespace:ns,memoryId:memory.id })).memory;
  const m4 = { kind:'memory',...f.expected,namespace:delivered.namespace,key:delivered.id,incarnation:delivered.id,boundRevision:4,ancestors:[] };
  const { handle } = await f.reader();
  assert.equal(ok(await handle.isSuppressed(ns.ownerId,[m4],{ expected:f.checkpoint(0) },f.credential)).results[0].suppressed,false);
  f.db.prepare('UPDATE memories SET revision=6 WHERE id=?').run(memory.id);
  ok(f.core.correct({ namespace:ns,memoryId:memory.id,expectedRevision:6,content:'Synthetic corrected version seven',kind:'fact',receipt:receipt('corrected') }));
  const inputs = [m4,{ ...m4,boundRevision:6 },{ ...m4,boundRevision:7 }];
  const value = ok(await handle.isSuppressed(ns.ownerId,inputs,{ expected:f.checkpoint(0) },f.credential));
  assert.deepEqual(value.results.map(r => r.suppressed),[true,true,false]);
  assert.deepEqual(value.results[0].reasons,['correction_supersession']);
  ok(f.core.forget({ namespace:ns,memoryId:memory.id,expectedRevision:7 }));
  const erased = ok(await handle.isSuppressed(ns.ownerId,inputs,{ expected:f.checkpoint(0) },f.credential));
  assert.ok(erased.results.every(r => r.suppressed)); f.clean(erased);
});

test('S2h batch taxonomy order, highest matching epoch and owner/namespace wildcard semantics', async t => {
  const f = await suppressionFixture(t), c = f.descriptor(f.memory()), other = { ...ns,projectId:'outside-selection' };
  f.fact(c,{ reason:'privacy_erase' }); f.fact(c,{ reason:'purge' }); f.fact(c,{ reason:'user_forget' });
  f.fact(c,{ reason:'purge' });
  const { handle } = await f.reader();
  const result = ok(await handle.isSuppressed(ns.ownerId,[c],{ expected:f.checkpoint(0) },f.credential));
  assert.deepEqual(result.results[0],{ inputIndex:0,suppressed:true,reasons:['user_forget','purge','privacy_erase'],matchedEpoch:'4' });
  transaction(f.db,() => writeContentSuppressionInside(f.db,{ namespace:other,kind:'namespace',matchMode:'namespace',reason:'purge',actionId:'namespace' }));
  const unknown = { ...c,namespace:other,key:randomUUID(),incarnation:null }; unknown.incarnation = unknown.key;
  assert.equal(ok(await handle.isSuppressed(ns.ownerId,[unknown],{ expected:f.checkpoint(0) },f.credential)).results[0].suppressed,true);
  const list = ok(await handle.listSuppressionsSince(ns.ownerId,'0',{ expected:f.checkpoint(0) },f.credential));
  assert.ok(list.items.some(item => item.key.namespace?.projectId === other.projectId)); f.clean(list);
  transaction(f.db,() => suppressOwnerInside(f.db,{ ownerId:ns.ownerId,reason:'account_erasure',actionId:'erasure' }));
  assert.equal((await handle.isSuppressed(ns.ownerId,[c],{ expected:f.checkpoint(0) },f.credential)).error.code,'authority_required');
  const erasure = await f.reader(f.grant({ permissions:{ reconcile:true,erasureReconciliation:true } }));
  const allowed = ok(await erasure.handle.listSuppressionsSince(ns.ownerId,'0',{ expected:f.checkpoint(0) },f.credential));
  assert.ok(allowed.items.some(item => item.reason === 'account_erasure')); f.clean(allowed);
});

test('S2h list byte caps shorten a validated prefix while preserving order and the fixed window', async t => {
  const f = await suppressionFixture(t), c = f.descriptor(f.memory()), parts = Array.from({ length:400 },(_,i) => i);
  transaction(f.db,() => {
    for (let i = 0; i < 100; i++) writeContentSuppressionInside(f.db,{ namespace:ns,kind:'raw',key:c.key,reason:'purge',actionId:'window-'+i,
      matchMode:'version',sourceVersion:JSON.stringify(['raw-span-v1','message',0,400,'exact',parts]) });
  });
  const { handle } = await f.reader(), epochs = []; let cursor;
  do {
    const response = await handle.listSuppressionsSince(ns.ownerId,'0',{ expected:f.checkpoint(0),limit:100,...(cursor ? { cursor } : {}) },f.credential);
    const page = ok(response); assert.ok(Buffer.byteLength(JSON.stringify(response)) <= 65536);
    assert.equal(page.throughEpoch,'100'); epochs.push(...page.items.map(item => item.epoch)); cursor = page.nextCursor;
    if (cursor) { assert.ok(page.items.length < 100); assert.ok(Buffer.byteLength(cursor) <= 2048); } f.clean(response);
  } while (cursor);
  assert.deepEqual(epochs,Array.from({ length:100 },(_,i) => String(i+1)));
});

test('S2h malformed fact versions cannot serialize arbitrary source text as a DenialKey', async t => {
  const f = await suppressionFixture(t), c = f.descriptor(f.memory());
  f.fact(c,{ matchMode:'version',sourceVersion:'["Synthetic receipt secret"]' });
  const { handle } = await f.reader();
  const response = await handle.listSuppressionsSince(ns.ownerId,'0',{ expected:f.checkpoint(0) },f.credential);
  assert.equal(response.ok,false); f.clean(response);
});
