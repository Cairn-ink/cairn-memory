import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { familyGate } from '../testing/receipt-event-time-gates.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { transaction } from '../database.mjs';
import { suppressionFixture, ns, ok } from '../testing/content-suppression-fixture.mjs';
import { openMemoryCore } from '../index.mjs';
import { openRawCaptureCore } from '../raw-capture.mjs';
import { createCardRawSources } from '../card-raw-sources.mjs';
import { cardHost } from '../testing/raw-source-fixtures.mjs';
import { request, splitRaw, localPlainPort } from '../testing/raw-capture-fixtures.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';

const refused = result => assert.equal(result.ok,false,JSON.stringify(result));
test('S2h closure validates captured versions and receipt parents, refusing unknown origins and conflicting duplicates', async t => {
  const f = await suppressionFixture(t), memory = f.memory(), c = f.descriptor(memory), { handle } = await f.reader();
  const row = ok(f.core.get({ namespace:ns,memoryId:memory.id })).receipts[0];
  const receipt = { ...c,kind:'receipt',key:row.id,incarnation:row.id,memoryId:memory.id,ancestors:[c] };
  const call = values => handle.isSuppressed(ns.ownerId,values,{ expected:f.checkpoint(0) },f.credential);
  assert.deepEqual(ok(await call([c,receipt,c])).results.map(r => r.inputIndex),[0,1,2]);
  for (const patch of [{ boundRevision:undefined },{ storeId:undefined },{ incarnation:randomUUID() },{ ancestors:undefined },
    { extra:'Synthetic receipt secret' },{ namespace:{ ...ns,sourceName:'synthetic-source-name' } }]) {
    const result = await call([{ ...c,...patch }]); refused(result); f.clean(result);
  }
  refused(await call([{ ...receipt,ancestors:[] }]));
  refused(await call([{ ...receipt,memoryId:randomUUID() }]));
  refused(await call([c,{ ...c,ancestors:[{ ...c,kind:'raw',messageId:'message',span:{ start:0,end:1,precision:'exact' },contentIdentity:'a'.repeat(43) }] }]));
  const cycle = { ...c }; cycle.ancestors = [cycle]; refused(await call([cycle]));
  const semanticCycle = { ...c,ancestors:[{ ...c,ancestors:[] }] }; refused(await call([semanticCycle]));
  f.db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(memory.id);
  refused(await call([c])); refused(await call([receipt]));
  // A known denial can identify an old, removed source without filling fields.
  f.fact(c); assert.equal(ok(await call([c])).results[0].suppressed,true);
  refused(await call([{ ...c,boundRevision:undefined }]));
});

for (const base of [18,23,33]) test(`S2h ${base}: H-only Card closure cannot establish a negative result`, async t => {
  const f = await suppressionFixture(t,base), c = { ...f.descriptor(f.memory()),kind:'card',bodyRevision:1 }, { handle } = await f.reader();
  const result = await handle.isSuppressed(ns.ownerId,[c],{ expected:f.checkpoint(0) },f.credential); refused(result); f.clean(result);
  f.fact(c); assert.equal(ok(await handle.isSuppressed(ns.ownerId,[c],{ expected:f.checkpoint(0) },f.credential)).results[0].suppressed,true);
});

test('S2h note identities require exact captured commitments and versions', async t => {
  const f = await suppressionFixture(t,23), host = cardHost(), core = openMemoryCore({ path:f.path,privateCards:host.options }); t.after(() => core.close());
  const ref = ok(host.call(core,'submitSourceNote',{ namespace:ns,actionId:'note',text:'Synthetic receipt secret',occurredAt:null })).source;
  const c = { kind:'submitted-note',...f.expected,namespace:ns,key:ref.sourceId,incarnation:ref.sourceId,boundRevision:ref.revision,ancestors:[],contentIdentity:ref.contentIdentity };
  const { handle } = await f.reader(), call = inputs => handle.isSuppressed(ns.ownerId,inputs,{ expected:f.checkpoint(0) },f.credential);
  assert.equal(ok(await call([c])).results[0].suppressed,false);
  refused(await call([{ ...c,contentIdentity:'a'.repeat(43) }]));
  refused(await call([{ ...c,boundRevision:2 }]));
  ok(host.call(core,'deleteSourceNote',{ namespace:ns,sourceId:ref.sourceId,expectedRevision:ref.revision,actionId:'delete' }));
  const value = ok(await call([c])); assert.equal(value.results[0].suppressed,true); f.clean(value);
});

test('S2h Raw closure binds capture revision, span, precision, identity and every Memory/receipt ancestor', async t => {
  const f = await suppressionFixture(t,33), host = cardHost();
  const core = openRawCaptureCore({ path:f.path,privateCards:host.options,
    model:{ ...rationaleModel(),extract:() => ({ items:[{ content:'Synthetic derived interpretation',kind:'fact',confidence:.8,sourceIndices:[0] }] }) } },
    { mode:'raw-v1',port:localPlainPort(),sources:true,readPolicy:() => ({ generation:'synthetic',reason:null }) });
  t.after(() => core.close());
  const captured = ok(await core.captureRaw(request(splitRaw('Synthetic receipt secret')[0],{ namespace:ns,client:'codex',sessionId:'raw',eventId:'raw' })));
  const memory = ok(captured.interpretation).admission.memories[0], conversationId = captured.raw.conversationId;
  const lineage = f.db.prepare('SELECT * FROM raw_receipt_lineage WHERE receipt_id IN (SELECT id FROM receipts WHERE memory_id=?)').all(memory.id);
  assert.equal(lineage.length,1);
  const row = lineage[0], revision = f.db.prepare('SELECT revision FROM raw_conversations WHERE id=?').get(conversationId).revision;
  const identity = f.db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata').get();
  const raw = createCardRawSources(f.db,identity), anchor = { conversationId,messageId:row.message_id,span:{ start:row.start,end:row.end,precision:row.precision } };
  const ref = raw.refFor(ns,anchor,raw.inspect(ns,anchor));
  const c = { kind:'raw',...f.expected,namespace:ns,key:conversationId,incarnation:conversationId,boundRevision:revision,
    ancestors:[],messageId:row.message_id,span:ref.span,contentIdentity:ref.contentIdentity };
  const m = { ...f.descriptor(memory),ancestors:[c] }, r = { ...m,kind:'receipt',key:row.receipt_id,incarnation:row.receipt_id,memoryId:memory.id,ancestors:[m] };
  const { handle } = await f.reader(), call = values => handle.isSuppressed(ns.ownerId,values,{ expected:f.checkpoint(0) },f.credential);
  assert.ok(ok(await call([c,m,r])).results.every(value => !value.suppressed));
  refused(await call([{ ...m,ancestors:[] }]));
  for (const patch of [{ boundRevision:undefined },{ boundRevision:revision+1 },{ messageId:'wrong' },{ span:{ start:0,end:1 } },
    { span:{ ...c.span,precision:c.span.precision === 'exact' ? 'whole-message' : 'exact' } },{ contentIdentity:'a'.repeat(43) }]) refused(await call([{ ...c,...patch }]));
  f.db.prepare("UPDATE raw_receipt_origins SET kind='unknown' WHERE receipt_id=?").run(row.receipt_id);
  refused(await call([m]));
  f.db.prepare("UPDATE raw_receipt_origins SET kind='derived' WHERE receipt_id=?").run(row.receipt_id);
  const middle = Math.floor((c.span.start+c.span.end)/2);
  const right = { ...anchor,span:{ start:middle,end:c.span.end,precision:'exact' } };
  const rightRef = raw.refFor(ns,right,raw.inspect(ns,right));
  const disjoint = { ...c,span:rightRef.span,contentIdentity:rightRef.contentIdentity };
  f.fact(c,{ matchMode:'span',messageId:c.messageId,start:c.span.start,end:middle,reason:'privacy_erase' });
  const positive = ok(await call([m,r])); assert.ok(positive.results.every(value => value.suppressed)); f.clean(positive);
  assert.equal(ok(await call([disjoint])).results[0].suppressed,false);
  refused(await call([{ ...c,span:{ start:c.span.end,end:c.span.end+1,precision:'exact' } }]));
});

test('S2h input/response bounds refuse oversize, invalid limits and exhausted closure budgets without echoing data', async t => {
  const f = await suppressionFixture(t), c = f.descriptor(f.memory()), { handle } = await f.reader();
  const call = (values,options = {},credential = f.credential) => handle.isSuppressed(ns.ownerId,values,{ expected:f.checkpoint(0),...options },credential);
  for (const values of [[],Array(257).fill(c)]) refused(await call(values));
  for (const limit of [0,101,null,1.5]) refused(await call([c],{ limit }));
  refused(await call([c],{ cursor:'x'.repeat(2049) }));
  const oversized = await call([c],{}, { opaque:'Synthetic receipt secret'.repeat(4000) }); refused(oversized); f.clean(oversized);
  const huge = { ...c,ancestors:Array.from({ length:1025 },() => ({ ...c,key:randomUUID(),incarnation:randomUUID() })) };
  refused(await call([huge]));
  // Count and byte caps both apply; 256 full descriptors exceed this request's
  // byte cap even though they do not exceed its input-count cap.
  assert.ok(Buffer.byteLength(JSON.stringify(Array(256).fill(c))) > 65536); refused(await call(Array(256).fill(c)));
  const maximum = ok(await call(Array(100).fill(c),{ limit:50 }));
  assert.equal(maximum.results.length,50); assert.ok(Buffer.byteLength(JSON.stringify(maximum)) <= 65536); assert.ok(Buffer.byteLength(maximum.nextCursor) <= 2048); f.clean(maximum);
});

test('S2h canonical ancestry enumeration refuses a bounded prefix instead of claiming completeness', async t => {
  const f = await suppressionFixture(t,33), c = f.descriptor(f.memory());
  transaction(f.db,() => {
    const insert = f.db.prepare('INSERT INTO receipts VALUES(?,?,?,?,?,?,?,?,?)');
    const origin = f.db.prepare("INSERT INTO raw_receipt_origins VALUES(?,'independent')");
    for (let i = 0; i < 1025; i++) {
      const id = randomUUID(), source = { client:'synthetic',sessionId:'budget',eventId:String(i),role:'user',excerpt:'Synthetic receipt secret' };
      insert.run(id,c.key,createHash('sha256').update(JSON.stringify(source)).digest('hex'),source.client,source.sessionId,source.eventId,source.role,source.excerpt,'time');
      origin.run(id);
    }
  });
  const { handle } = await f.reader();
  const result = await handle.isSuppressed(ns.ownerId,[c],{ expected:f.checkpoint(0) },f.credential);
  refused(result); assert.equal(result.error.code,'context_item_too_large'); f.clean(result);
});


const completeFamilyPull = familyGate('H/pull-evidence', 1);
test('family gate H: v53 pull-evidence', async t => {
  const f = await suppressionFixture(t,33,eventTimeSafetyFixture), memory = f.memory(), c = f.descriptor(memory), { handle } = await f.reader();
  const row = ok(f.core.get({ namespace:ns,memoryId:memory.id })).receipts[0];
  const receipt = { ...c,kind:'receipt',key:row.id,incarnation:row.id,memoryId:memory.id,ancestors:[c] };
  const call = values => handle.isSuppressed(ns.ownerId,values,{ expected:f.checkpoint(0) },f.credential);
  assert.deepEqual(ok(await call([c,receipt,c])).results.map(r => r.inputIndex),[0,1,2]);
  for (const patch of [{ boundRevision:undefined },{ storeId:undefined },{ incarnation:randomUUID() },{ ancestors:undefined },
    { extra:'Synthetic receipt secret' },{ namespace:{ ...ns,sourceName:'synthetic-source-name' } }]) {
    const result = await call([{ ...c,...patch }]); refused(result); f.clean(result);
  }
  refused(await call([{ ...receipt,ancestors:[] }]));
  refused(await call([{ ...receipt,memoryId:randomUUID() }]));
  refused(await call([c,{ ...c,ancestors:[{ ...c,kind:'raw',messageId:'message',span:{ start:0,end:1,precision:'exact' },contentIdentity:'a'.repeat(43) }] }]));
  const cycle = { ...c }; cycle.ancestors = [cycle]; refused(await call([cycle]));
  const semanticCycle = { ...c,ancestors:[{ ...c,ancestors:[] }] }; refused(await call([semanticCycle]));
  f.db.prepare('UPDATE memories SET revision=revision+1 WHERE id=?').run(memory.id);
  refused(await call([c])); refused(await call([receipt]));
  // A known denial can identify an old, removed source without filling fields.
  f.fact(c); assert.equal(ok(await call([c])).results[0].suppressed,true);
  refused(await call([{ ...c,boundRevision:undefined }]));
  assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, 53);
  completeFamilyPull('pull-evidence');
});
