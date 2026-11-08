import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { openMemoryCore, openMemoryStore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { readTransaction } from '../database.mjs';
import { fingerprint } from '../validation.mjs';
import { validateSourceReceipt } from '../source-evidence.mjs';
import { receiptReadSafety } from '../content-safety.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { eventTimeFixture, ns, ok, receipt } from '../testing/receipt-event-time-fixture.mjs';

const time = '2001-02-03T04:05:06.789Z';
const otherTime = '2001-02-03T04:05:06.790Z';
const content = 'Synthetic dated memory';
const hash = source => createHash('sha256').update(JSON.stringify(source)).digest('hex');
const admit = (core, occurredAt, patch = {}) => core.admit({ namespace: ns,
  memory: { content, kind: 'fact' }, receipts: [{ ...receipt('event'), ...(occurredAt === undefined ? {} : { occurredAt }) }], ...patch });
const error = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };

for (const base of [18, 23, 33]) test(`event-time v${base}: identical key bytes and read-side identity checks; no read time`, async t => {
  const f = await eventTimeFixture(t, base), core = openMemoryCore({ path: f.path }), db = f.connect();
  t.after(() => { core.close(); db.close(); });
  const plain = ok(admit(core)).memory;
  const dated = ok(admit(core, time, { memory: { content: content + ' dated', kind: 'fact' } })).memory;
  const rows = [plain, dated].map(memory => db.prepare('SELECT * FROM receipts WHERE memory_id=?').get(memory.id));
  assert.equal(rows[0].receipt_key, rows[1].receipt_key);
  assert.equal(rows[1].receipt_key, hash(receipt('event')));
  assert.deepEqual(rows.map(row => row.occurred_at), [null, time]);
  for (const row of rows) {
    assert.doesNotThrow(() => validateSourceReceipt(row.memory_id, row, hash));
    assert.equal(readTransaction(db, () => receiptReadSafety(db, { namespace: ns, receipt: row }).allowed), true);
  }
  const runtime = createMemoryRuntime({ path: f.path }); t.after(() => runtime.close());
  for (const result of [core.get({ namespace: ns, memoryId: dated.id }), core.list({ namespace: ns }),
    core.map({ namespace: ns }), runtime.legacyGet(ns, dated.id), runtime.recentReceipts(ns, { memoryId: dated.id, revision: dated.revision }, 12)]) {
    assert.doesNotMatch(JSON.stringify(result), /occurred_at|occurredAt|2001-02-03/);
  }
  assert.throws(() => db.prepare('UPDATE receipts SET occurred_at=? WHERE memory_id=?').run(otherTime, dated.id), /safety_identity_change/);
  assert.throws(() => db.prepare('UPDATE receipts SET occurred_at=NULL WHERE memory_id=?').run(dated.id), /safety_identity_change/);
  assert.throws(() => db.prepare('UPDATE receipts SET occurred_at=? WHERE memory_id=?').run(time, plain.id), /safety_identity_change/);
});

for (const [retained, incoming, expected] of [[time, otherTime, 'storage_error'], [null, time, null], [time, null, time]])
  test(`event-time duplicate retained=${retained} incoming=${incoming}`, async t => {
    const f = await eventTimeFixture(t), core = openMemoryCore({ path: f.path }), db = f.connect();
    t.after(() => { core.close(); db.close(); });
    const first = ok(admit(core, retained));
    const before = db.prepare('SELECT * FROM receipts').all();
    const result = admit(core, incoming);
    if (expected === 'storage_error') error(result, expected);
    else { const next = ok(result); assert.equal(next.deduplicated, true); assert.equal(next.memory.revision, first.memory.revision); }
    assert.deepEqual(db.prepare('SELECT * FROM receipts').all(), before);
  });

test('runtime.admit validates +5 minute boundary against the exact created_at clock', async t => {
  const f = await eventTimeFixture(t), runtime = createMemoryRuntime({ path: f.path }), db = f.connect();
  t.after(() => { runtime.close(); db.close(); });
  const now = '2026-01-01T00:00:00.000Z';
  t.mock.timers.enable({ apis: ['Date'], now: Date.parse(now) });
  const value = occurredAt => ({ content, fingerprint: fingerprint(content), kind: 'fact', origin: 'explicit', confidence: 1,
    receipts: [receipt('event')], receiptTimes: [occurredAt] });
  const accepted = runtime.admit(ns, value('2026-01-01T00:05:00.000Z'));
  assert.equal(db.prepare('SELECT created_at FROM receipts WHERE memory_id=?').get(accepted.memory.id).created_at, now);
  for (const bad of ['2026-01-01T00:05:00.001Z', '2026-01-01T00:00:00Z'])
    assert.throws(() => runtime.admit(ns, value(bad)), { code: 'invalid_input' });
  assert.equal(db.prepare('SELECT count(*) n FROM receipts').get().n, 1);
});

for (const base of [18, 23, 33]) for (const safety of [false, true])
  test(`old-layout v${base} safety=${safety}: timed write drops time; untimed write unchanged`, async t => {
    const f = safetyFixture(t, base); if (safety) await f.migrate();
    const core = openMemoryCore({ path: f.path }), db = f.connect(); t.after(() => { core.close(); db.close(); });
    ok(admit(core)); const before = db.prepare('SELECT * FROM receipts').all();
    assert.equal(Object.hasOwn(before[0], 'occurred_at'), false);
    assert.equal(ok(admit(core, time)).deduplicated, true);
    assert.equal(ok(admit(core, time, { memory: { content: content + ' new', kind: 'fact' } })).deduplicated, false);
    db.prepare('DELETE FROM memories WHERE content=?').run(content + ' new');
    assert.deepEqual(db.prepare('SELECT * FROM receipts').all(), before);
    assert.equal(ok(admit(core, null)).deduplicated, true);
  });

test('legacy remember and correction store side times, and forget removes the dated receipt row', async t => {
  const f = await eventTimeFixture(t), store = openMemoryStore({ path: f.path }), db = f.connect();
  const scope = store.scope({ ownerId: ns.ownerId, projectId: ns.projectId }); t.after(() => { store.close(); db.close(); });
  const first = scope.remember({ content, receipt: { ...receipt('legacy'), occurredAt: time } });
  const old = db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(first.id).id;
  assert.equal(db.prepare('SELECT occurred_at FROM receipts WHERE id=?').get(old).occurred_at, time);
  const next = scope.correct(first.id, { content: content + ' corrected', receipt: { ...receipt('corrected'), occurredAt: otherTime } }, first.revision);
  assert.equal(db.prepare('SELECT 1 FROM receipts WHERE id=?').get(old), undefined);
  assert.equal(db.prepare('SELECT occurred_at FROM receipts WHERE memory_id=?').get(first.id).occurred_at, otherTime);
  assert.doesNotMatch(JSON.stringify(next), /occurred_at|occurredAt|2001-02-03/);
  scope.forget(next.id, next.revision);
  assert.equal(db.prepare('SELECT count(*) n FROM receipts').get().n, 0);
});

test('contract finish binds each receipt time independently; opaque claim unchanged; retry mismatch rolls back', async t => {
  const f = await eventTimeFixture(t), core = openMemoryCore({ path: f.path }), db = f.connect();
  t.after(() => { core.close(); db.close(); });
  const key = { namespace: ns, client: 'synthetic', eventId: 'finish', payloadDigest: 'a'.repeat(64) };
  error(core.claimAdmission({ ...key, leaseMs: 125000, occurredAt: time }), 'invalid_input');
  const token = ok(core.claimAdmission({ ...key, leaseMs: 125000 })).token;
  const item = { content, kind: 'fact', confidence: .8,
    receipts: [{ ...receipt('timed'), occurredAt: time }, receipt('untimed')] };
  ok(core.finishAdmission({ ...key, token, items: [item] }));
  assert.deepEqual(db.prepare('SELECT event_id,occurred_at FROM receipts ORDER BY event_id').all().map(r => [r.event_id, r.occurred_at]),
    [['timed', time], ['untimed', null]]);
  const retryKey = { ...key, eventId: 'retry' }, retryToken = ok(core.claimAdmission({ ...retryKey, leaseMs: 125000 })).token;
  const before = db.prepare('SELECT * FROM receipts').all();
  error(core.finishAdmission({ ...retryKey, token: retryToken, items: [{ ...item,
    receipts: [{ ...receipt('timed'), occurredAt: otherTime }] }] }), 'storage_error');
  assert.deepEqual(db.prepare('SELECT * FROM receipts').all(), before);
  ok(core.finishAdmission({ ...retryKey, token: retryToken, items: [item] }));
});

test('pre-1970 receipt admission has no lower bound', async t => {
  const f = await eventTimeFixture(t), core = openMemoryCore({ path: f.path }), db = f.connect();
  t.after(() => { core.close(); db.close(); });
  for (const occurredAt of ['1901-02-03T04:05:06.789Z','0000-01-01T00:00:00.000Z']) {
    const memory = ok(admit(core,occurredAt,{memory:{content:content+occurredAt,kind:'fact'}})).memory;
    assert.equal(db.prepare('SELECT occurred_at FROM receipts WHERE memory_id=?').get(memory.id).occurred_at,occurredAt);
  }
});

for (const base of [18,23,33]) test(`event-time capabilities v${base} report only installed layout support; context sources and diagnostics omit times`, async t => {
  const { host } = await import('../testing/context-read-core-fixture.mjs');
  const { configured, prebuild } = await import('../testing/context-product-owner-fixture.mjs');
  const f = safetyFixture(t,base), trusted = host();
  let core = openMemoryCore({ path:f.path, model:{countTokens:()=>1}, contextRead:{version:'context-read-v1',authority:trusted.authority,counter:{id:'synthetic',countTokens:()=>1}} });
  assert.equal(ok(core.getContextReadCapabilities()).receiptEventTime,false); core.close();
  const { migrateEventTime } = await import('../testing/receipt-event-time-fixture.mjs'); await migrateEventTime(f);
  core = openMemoryCore({ path:f.path, model:{countTokens:()=>1}, contextRead:{version:'context-read-v1',authority:trusted.authority,counter:{id:'synthetic',countTokens:()=>1}} });
  t.after(() => core.close());
  const memory = ok(admit(core,time)).memory;
  assert.equal(ok(core.getContextReadCapabilities()).receiptEventTime,true);
  const projection = {readSet:[ns],types:['memory'],intent:'current'};
  ok(await trusted.call(core,'refreshContextIndex',{...projection,budget:{maxItems:1024,maxMs:5000}}));
  for (const result of [core.sourceSnapshot({readSet:[ns],limit:12}),
    await trusted.call(core,'findCandidates',{...projection,query:'Synthetic',limit:4}),
    await trusted.call(core,'contextRead',{...projection,representation:'representation-v2',query:'Synthetic',budget:{maxTokens:2000,maxItems:4}})]) {
    ok(result); assert.doesNotMatch(JSON.stringify(result),/occurred_at|occurredAt|2001-02-03/);
  }
  await prebuild(configured(t,f.path,[ns],{service:true}),['memory']);
  const config = configured(t,f.path,[ns]), reader = await config.open(); t.after(() => reader.close());
  assert.equal(ok(await reader.getContextReadCapabilities()).receiptEventTime,true);
  for (const result of [await reader.findCandidates({...projection,query:'Synthetic',limit:4},config.token),
    await reader.fetchCandidateEvidence({readSet:[ns],intent:'current',refs:[{type:'memory',namespace:ns,memoryId:memory.id,revision:memory.revision}]},config.token)]) {
    ok(result); assert.doesNotMatch(JSON.stringify(result),/occurred_at|occurredAt|2001-02-03/);
  }
});

test('supersede preserves the receipt side time accepted by the shared contract parser', async t => {
  const f = await eventTimeFixture(t), core = openMemoryCore({path:f.path}), db = f.connect();
  t.after(() => { core.close(); db.close(); });
  const first = ok(admit(core,time)).memory;
  const result = ok(core.supersede({namespace:ns,memoryId:first.id,expectedRevision:first.revision,
    replacement:{content:content+' replacement',kind:'fact'},receipts:[{...receipt('replacement'),occurredAt:otherTime}]}));
  assert.equal(db.prepare("SELECT occurred_at FROM receipts WHERE event_id='replacement'").get().occurred_at,otherTime);
  assert.doesNotMatch(JSON.stringify(result),/occurred_at|occurredAt|2001-02-03/);
});

test('host erasure deletes the dated receipt with its parent row; no separate time lifecycle', async t => {
  const { transaction } = await import('../database.mjs');
  const { suppressOwnerInside } = await import('../content-suppression-storage.mjs');
  const f = await eventTimeFixture(t), core = openMemoryCore({path:f.path}), db = f.connect();
  t.after(() => { core.close(); db.close(); });
  const first = ok(admit(core,time)).memory;
  transaction(db,() => {
    suppressOwnerInside(db,{ownerId:ns.ownerId,reason:'account_erasure',actionId:'synthetic-erasure'});
    db.prepare('DELETE FROM memories WHERE id=?').run(first.id);
  });
  assert.equal(db.prepare('SELECT count(*) n FROM receipts').get().n,0);
  assert.doesNotMatch(JSON.stringify(core.get({namespace:ns,memoryId:first.id})),/occurred_at|occurredAt|2001-02-03/);
});

test('claim qualification bindings stay identical when receipt fixtures carry event times', async t => {
  const f = await eventTimeFixture(t), core = openMemoryCore({path:f.path}), db = f.connect();
  t.after(() => { core.close(); db.close(); });
  const qualification = {version:1,slot:{subject:null,property:null,scope:null,applies:null},value:null,attribution:'unknown',commitment:'unknown',
    anchors:[{receiptIndex:0,start:0,end:content.length,text:content,fields:['value']}]};
  const source = {...receipt('qualified'),excerpt:content};
  const first = ok(core.admit({namespace:ns,memory:{content,kind:'fact'},receipts:[{...source,occurredAt:time}],qualification})).memory;
  const before = db.prepare('SELECT * FROM qualification_anchors').all();
  ok(core.admit({namespace:ns,memory:{content,kind:'fact'},receipts:[source],qualification}));
  assert.deepEqual(db.prepare('SELECT * FROM qualification_anchors').all(),before);
  const detail = ok(core.get({namespace:ns,memoryId:first.id,includeQualification:true}));
  assert.equal(detail.qualification.anchors[0].receiptId,db.prepare('SELECT id FROM receipts').get().id);
  assert.doesNotMatch(JSON.stringify(detail),/occurred_at|occurredAt|2001-02-03/);
});

test('finish validates future times even on suppressed items using the persisted receipt clock', async t => {
  const f = await eventTimeFixture(t), core = openMemoryCore({path:f.path}), db = f.connect();
  t.after(() => { core.close(); db.close(); });
  const now = '2026-01-01T00:00:00.000Z'; t.mock.timers.enable({apis:['Date'],now:Date.parse(now)});
  const key = {namespace:ns,client:'synthetic',eventId:'clocked-finish',payloadDigest:'b'.repeat(64)};
  const token = ok(core.claimAdmission({...key,leaseMs:125000})).token;
  const item = occurredAt => ({content,kind:'fact',confidence:.8,receipts:[{...receipt('clocked'),occurredAt}]});
  error(core.finishAdmission({...key,token,items:[item('2026-01-01T00:05:00.001Z')]}),'invalid_input');
  const memory = ok(core.finishAdmission({...key,token,items:[item('2026-01-01T00:05:00.000Z')]})).memories[0];
  assert.equal(db.prepare('SELECT created_at FROM receipts').get().created_at,now);
  ok(core.forget({namespace:ns,memoryId:memory.id,expectedRevision:memory.revision}));
  const next = {...key,eventId:'suppressed-finish'}, nextToken = ok(core.claimAdmission({...next,leaseMs:125000})).token;
  error(core.finishAdmission({...next,token:nextToken,items:[item('2026-01-01T00:05:00.001Z')]}),'invalid_input');
  assert.equal(db.prepare('SELECT count(*) n FROM receipts').get().n,0);
});

for (const base of [18,23,33]) for (const layout of ['old','safety','event'])
test(`new receipt fields retain strict validation at every entry: ${base}/${layout}`, async t => {
  const f = layout === 'event' ? await eventTimeFixture(t,base) : safetyFixture(t,base);
  if (layout === 'safety') await f.migrate();
  const core = openMemoryCore({path:f.path}), store = openMemoryStore({path:f.path}), db = f.connect();
  const scope = store.scope({ownerId:ns.ownerId,projectId:ns.projectId});
  t.after(() => {core.close();store.close();db.close();});
  const first = ok(admit(core)).memory;
  const legacy = scope.remember({content:'Synthetic legacy strict source',receipt:receipt('legacy-strict')});
  const key = {namespace:ns,client:'synthetic',eventId:'strict-finish',payloadDigest:'c'.repeat(64)};
  const token = ok(core.claimAdmission({...key,leaseMs:125000})).token;
  const before = db.prepare('SELECT * FROM receipts ORDER BY id').all();
  for (const occurredAt of ['garbage','2001-02-03T04:05:06Z',7,'2099-01-01T00:00:00.000Z']) {
    const r = {...receipt('strict'),occurredAt};
    assert.throws(() => scope.remember({content:'Synthetic invalid remember',receipt:r}),{code:'invalid_input'});
    assert.throws(() => scope.correct(legacy.id,{content:'Synthetic invalid correction',receipt:r},legacy.revision),{code:'invalid_input'});
    error(core.admit({namespace:ns,memory:{content:'Synthetic invalid admit',kind:'fact'},receipts:[r]}),'invalid_input');
    error(core.correct({namespace:ns,memoryId:first.id,expectedRevision:first.revision,content:'Synthetic invalid correction',kind:'fact',receipt:r}),'invalid_input');
    error(core.supersede({namespace:ns,memoryId:first.id,expectedRevision:first.revision,replacement:{content:'Synthetic invalid replacement',kind:'fact'},receipts:[r]}),'invalid_input');
    error(core.finishAdmission({...key,token,items:[{content:'Synthetic invalid finish',kind:'fact',confidence:.8,receipts:[r]}]}),'invalid_input');
    assert.deepEqual(db.prepare('SELECT * FROM receipts ORDER BY id').all(),before);
  }
});
