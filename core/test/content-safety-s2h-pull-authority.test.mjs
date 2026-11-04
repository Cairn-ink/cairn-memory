import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { suppressionFixture, ns, ok } from '../testing/content-suppression-fixture.mjs';
import { suppressionServiceIssuance, serviceIssuance } from '../context-product-service.mjs';
import { openContentSuppressionReader } from '../index.mjs';

const refused = (result, code) => { assert.equal(result.ok,false,JSON.stringify(result)); if (code) assert.equal(result.error.code,code); };
test('S2h issuance is closed; owner permission is explicit and namespace grants cannot list or escape', async t => {
  const f = await suppressionFixture(t), a = f.descriptor(f.memory()), b = f.descriptor(f.memory('Synthetic outside source',{ ...ns,projectId:'outside' }),{ ...ns,projectId:'outside' });
  const q = f.grant({ scope:{ kind:'namespaces',readSet:[ns] } }), { handle,state } = await f.reader(q);
  assert.equal(ok(await handle.isSuppressed(ns.ownerId,[a],{ expected:f.checkpoint(0) },f.credential)).results[0].suppressed,false);
  refused(await handle.isSuppressed(ns.ownerId,[b],{ expected:f.checkpoint(0) },f.credential),'authority_required');
  const escaped = { ...b,kind:'raw',messageId:'message',span:{ start:0,end:1,precision:'exact' },contentIdentity:'a'.repeat(43) };
  refused(await handle.isSuppressed(ns.ownerId,[{ ...a,ancestors:[escaped] }],{ expected:f.checkpoint(0) },f.credential),'authority_required');
  refused(await handle.listSuppressionsSince(ns.ownerId,'0',{ expected:f.checkpoint(0) },f.credential),'authority_required');
  refused(await handle.isSuppressed(ns.ownerId,[a],{ expected:f.checkpoint(0),suppression:f.grant() },f.credential));
  assert.throws(() => suppressionServiceIssuance(f.service,{ ...q,permissions:{ reconcile:true,erasureReconciliation:true } }));
  assert.throws(() => suppressionServiceIssuance(f.service,f.grant({ scope:{ kind:'namespaces',readSet:[b.namespace] } })));
  assert.throws(() => serviceIssuance(state.binding,f.service.namespaces.readSet,f.service.namespaces.ownerCoverage));
  for (const patch of [{ accessGeneration:0 },{ extra:'synthetic' },{ permissions:{ reconcile:false,erasureReconciliation:false } },
    { scope:{ kind:'owner',readSet:[ns] } },{ scope:{ kind:'namespaces',readSet:[] } }]) assert.throws(() => suppressionServiceIssuance(f.service,f.grant(patch)));
  const ownerGrant = await f.reader();
  assert.equal(ok(await ownerGrant.handle.isSuppressed(ns.ownerId,[b],{ expected:f.checkpoint(0) },f.credential)).results[0].suppressed,false);
  refused(await ownerGrant.handle.isSuppressed('other-owner',[a],{ expected:{ ...f.checkpoint(0),owner:'other-owner' } },f.credential),'authority_required');
});

for (const method of ['list','batch']) test(`S2h ${method}: full B authorization and synchronous currentness at entry and every delivery`, async t => {
  const f = await suppressionFixture(t), a = f.descriptor(f.memory()), b = f.descriptor(f.memory('Synthetic next source'));
  f.fact(a); f.fact(b);
  const { handle,state } = await f.reader();
  const call = cursor => method === 'list' ? handle.listSuppressionsSince(ns.ownerId,'0',{ expected:f.checkpoint(0),limit:1,...(cursor ? { cursor } : {}) },f.credential)
    : handle.isSuppressed(ns.ownerId,[a,b],{ expected:f.checkpoint(0),limit:1,...(cursor ? { cursor } : {}) },f.credential);
  const first = ok(await call()); assert.equal(state.samples,2);
  assert.deepEqual(state.requests[0].suppression,state.binding.suppression);
  assert.equal(Object.isFrozen(state.requests[0].input),true);
  const second = ok(await call(first.nextCursor)); assert.equal(state.samples,4); assert.equal(second.nextCursor,null);
  assert.equal(state.requests[1].input.options.cursor,first.nextCursor);
  state.binding = f.service; refused(await call(),'authority_required');
  for (const patch of [{ accessGeneration:2 },{ scope:{ kind:'namespaces',readSet:[ns] } },
    { permissions:{ reconcile:true,erasureReconciliation:true } }]) {
    state.binding = suppressionServiceIssuance(f.service,f.grant(patch)); refused(await call(),'authority_required');
  }
  state.binding = suppressionServiceIssuance({ ...f.service,ownerGeneration:2 },f.grant()); refused(await call(),'authority_required');
  state.binding = suppressionServiceIssuance(f.service,f.grant());
  state.current = () => Promise.resolve(true); refused(await call(),'authority_required');
  state.current = () => { throw Error('Synthetic receipt secret'); }; refused(await call(),'authority_required');
  state.current = () => true;
  state.authorize = () => Promise.reject(Error('Synthetic receipt secret')); refused(await call(),'authority_required');
  state.authorize = () => state.binding;
  let samples = 0; state.current = () => ++samples === 1;
  const result = await call(); refused(result,'scope_changed'); f.clean(result);
});

test('S2h revocation destroys cached pages; regrant, close and restart require a full batch restart', async t => {
  const f = await suppressionFixture(t), inputs = [f.descriptor(f.memory()),f.descriptor(f.memory('Synthetic second source'))];
  const { handle,state } = await f.reader(), options = { expected:f.checkpoint(0),limit:1 };
  const first = ok(await handle.isSuppressed(ns.ownerId,inputs,options,f.credential));
  state.live = false;
  refused(await handle.isSuppressed(ns.ownerId,inputs,{ ...options,cursor:first.nextCursor },f.credential),'authority_required');
  state.live = true;
  refused(await handle.isSuppressed(ns.ownerId,inputs,{ ...options,cursor:first.nextCursor },f.credential),'cursor_stale');
  const fresh = ok(await handle.isSuppressed(ns.ownerId,inputs,options,f.credential));
  await handle.close(); refused(await handle.isSuppressed(ns.ownerId,inputs,{ ...options,cursor:fresh.nextCursor },f.credential),'store_closed');
  const restarted = await f.reader();
  refused(await restarted.handle.isSuppressed(ns.ownerId,inputs,{ ...options,cursor:fresh.nextCursor },f.credential),'invalid_cursor');
  const changed = await f.reader(f.grant({ accessGeneration:2 }));
  refused(await changed.handle.isSuppressed(ns.ownerId,inputs,{ ...options,cursor:fresh.nextCursor },f.credential),'invalid_cursor');
});

test('S2h checkpoints bind owner/store/domain/epoch on first pages and continuations, never resetting to zero', async t => {
  const f = await suppressionFixture(t), a = f.descriptor(f.memory()), b = f.descriptor(f.memory('Synthetic second source'));
  f.fact(a); f.fact(b); const { handle,options } = await f.reader();
  await assert.rejects(() => openContentSuppressionReader({ ...options,expected:{ ...f.expected,suppressionDomain:randomUUID() } }));
  await assert.rejects(() => openContentSuppressionReader({ ...options,suppression:f.grant({ expected:{ ...f.expected,storeId:randomUUID() } }) }));
  const first = ok(await handle.listSuppressionsSince(ns.ownerId,'0',{ expected:f.checkpoint(0),limit:1 },f.credential));
  for (const patch of [{ owner:'wrong' },{ storeId:randomUUID() },{ suppressionDomain:randomUUID() },{ epoch:'3' },{ epoch:0 }]) {
    for (const cursor of [undefined,first.nextCursor]) {
      const value = await handle.listSuppressionsSince(ns.ownerId,'0',{ expected:{ ...f.checkpoint(0),...patch },limit:1,...(cursor ? { cursor } : {}) },f.credential);
      refused(value); f.clean(value);
    }
  }
  refused(await handle.listSuppressionsSince(ns.ownerId,'3',{ expected:f.checkpoint(3) },f.credential),'invalid_snapshot');
  refused(await handle.isSuppressed(ns.ownerId,[a],{ expected:f.checkpoint(3) },f.credential),'invalid_snapshot');
  refused(await handle.isSuppressed(ns.ownerId,[a],{ limit:1 },f.credential));
});

test('S2h authenticated cursors bind original input, limit and checkpoint; forged or expired cursors refuse', async t => {
  const f = await suppressionFixture(t), inputs = [f.descriptor(f.memory()),f.descriptor(f.memory('Synthetic second source'))];
  f.fact(inputs[0]); f.fact(inputs[1]); const { handle } = await f.reader(), options = { expected:f.checkpoint(0),limit:1 };
  const batch = ok(await handle.isSuppressed(ns.ownerId,inputs,options,f.credential));
  const list = ok(await handle.listSuppressionsSince(ns.ownerId,'0',options,f.credential));
  for (const cursor of ['forged',list.nextCursor.slice(0,-1)+(list.nextCursor.endsWith('A') ? 'B' : 'A')])
    refused(await handle.listSuppressionsSince(ns.ownerId,'0',{ ...options,cursor },f.credential),'invalid_cursor');
  refused(await handle.listSuppressionsSince(ns.ownerId,'0',{ ...options,limit:2,cursor:list.nextCursor },f.credential),'invalid_cursor');
  refused(await handle.isSuppressed(ns.ownerId,[...inputs].reverse(),{ ...options,cursor:batch.nextCursor },f.credential),'invalid_cursor');
  refused(await handle.isSuppressed(ns.ownerId,inputs,{ ...options,limit:2,cursor:batch.nextCursor },f.credential),'invalid_cursor');
  refused(await handle.isSuppressed(ns.ownerId,inputs,{ ...options,expected:f.checkpoint(1),cursor:batch.nextCursor },f.credential),'invalid_cursor');
  refused(await handle.isSuppressed(ns.ownerId,inputs,{ ...options,cursor:list.nextCursor },f.credential),'invalid_cursor');
  const original = Date.now;
  try {
    const later = original()+900001; Date.now = () => later;
    refused(await handle.listSuppressionsSince(ns.ownerId,'0',{ ...options,cursor:list.nextCursor },f.credential),'cursor_stale');
    refused(await handle.isSuppressed(ns.ownerId,inputs,{ ...options,cursor:batch.nextCursor },f.credential),'cursor_stale');
  } finally { Date.now = original; }
});

test('S2h cache eviction is bounded and forces restart without recomputation at a new epoch', async t => {
  const f = await suppressionFixture(t), inputs = [f.descriptor(f.memory()),f.descriptor(f.memory('Synthetic second source'))];
  const { handle } = await f.reader(), options = { expected:f.checkpoint(0),limit:1 }; let first, last;
  for (let i = 0; i < 65; i++) { last = ok(await handle.isSuppressed(ns.ownerId,inputs,options,f.credential)); first ??= last; }
  f.fact(inputs[1]);
  refused(await handle.isSuppressed(ns.ownerId,inputs,{ ...options,cursor:first.nextCursor },f.credential),'cursor_stale');
  const old = ok(await handle.isSuppressed(ns.ownerId,inputs,{ ...options,cursor:last.nextCursor },f.credential));
  assert.equal(old.observedEpoch,'0'); assert.equal(old.results[0].suppressed,false);
  old.results[0].reasons.push('Synthetic receipt secret'); old.results[0].suppressed = true;
  const replay = ok(await handle.isSuppressed(ns.ownerId,inputs,{ ...options,cursor:last.nextCursor },f.credential));
  assert.equal(replay.results[0].suppressed,false); assert.deepEqual(replay.results[0].reasons,[]); f.clean(replay);
  assert.equal(ok(await handle.isSuppressed(ns.ownerId,inputs,{ expected:f.checkpoint(0) },f.credential)).results[1].suppressed,true);
});

test('S2h missing immutable facts and data-only capability changes refuse', async t => {
  const f = await suppressionFixture(t,23), c = f.descriptor(f.memory()); f.fact(c); f.fact(c);
  const { handle } = await f.reader(), options = { expected:f.checkpoint(0),limit:1 };
  const first = ok(await handle.listSuppressionsSince(ns.ownerId,'0',options,f.credential));
  const guard = f.db.prepare("SELECT sql FROM sqlite_schema WHERE name='safety_suppression_delete'").get().sql;
  f.db.exec('DROP TRIGGER safety_suppression_delete; DELETE FROM content_suppressions WHERE epoch_lo=2'); f.db.exec(guard);
  refused(await handle.listSuppressionsSince(ns.ownerId,'0',{ ...options,cursor:first.nextCursor },f.credential),'unsupported_database');
  refused(await handle.isSuppressed(ns.ownerId,[c],options,f.credential),'unsupported_database');
  f.db.exec('UPDATE content_safety_control SET card_lineage_revision=1');
  refused(await handle.listSuppressionsSince(ns.ownerId,'0',options,f.credential),'unsupported_database');
});

test('S2h counter regression refuses cached delivery and a persisted nonzero checkpoint without resetting', async t => {
  const f = await suppressionFixture(t), c = f.descriptor(f.memory()); f.fact(c); f.fact(c);
  const { handle } = await f.reader(), options = { expected:f.checkpoint(0),limit:1 };
  const first = ok(await handle.isSuppressed(ns.ownerId,[c,c],options,f.credential)); assert.equal(first.observedEpoch,'2');
  // Simulate loss of a committed epoch with exact guards restored. Local
  // checkpoints must refuse it; this is not a serving-restore admission path.
  const guards = f.db.prepare("SELECT sql FROM sqlite_schema WHERE name IN ('safety_epoch_update','safety_suppression_delete')").all();
  f.db.exec('DROP TRIGGER safety_epoch_update; DROP TRIGGER safety_suppression_delete; DELETE FROM content_suppressions WHERE epoch_lo=2; UPDATE owner_suppression_epochs SET epoch_lo=1');
  for (const row of guards) f.db.exec(row.sql);
  refused(await handle.isSuppressed(ns.ownerId,[c,c],{ ...options,cursor:first.nextCursor },f.credential),'invalid_snapshot');
  const reopened = await f.reader();
  refused(await reopened.handle.listSuppressionsSince(ns.ownerId,'2',{ expected:f.checkpoint(2) },f.credential),'invalid_snapshot');
  f.fact(c);
  refused(await handle.isSuppressed(ns.ownerId,[c,c],{ ...options,cursor:first.nextCursor },f.credential),'invalid_snapshot');
});

test('S2h erasure committed by the final host sample still requires erasure authority', async t => {
  const f = await suppressionFixture(t), c = f.descriptor(f.memory()), { handle,state } = await f.reader();
  state.current = () => {
    if (state.samples === 2) f.fact(c,{ namespace:{ ownerId:ns.ownerId,scope:'owner',projectId:'' },kind:'owner',key:'',matchMode:'owner',reason:'account_erasure' });
    return true;
  };
  const result = await handle.isSuppressed(ns.ownerId,[c],{ expected:f.checkpoint(0) },f.credential);
  refused(result,'authority_required'); f.clean(result);
});

test('S2h credential expiry, invalid cutoffs and exhausted execution budgets refuse without a page', async t => {
  const f = await suppressionFixture(t), inputs = [f.descriptor(f.memory()),f.descriptor(f.memory('Synthetic next source'))];
  f.service.credentialExpiresUtcMs = Date.now()+60000;
  const { handle,state,options } = await f.reader(), page = { expected:f.checkpoint(0),limit:1 };
  for (const requestMaxMs of [0,5001,null]) await assert.rejects(() => openContentSuppressionReader({ ...options,requestMaxMs }));
  refused(await handle.isSuppressed(ns.ownerId,inputs,page,{ opaque:'wrong-credential' }),'authority_required');
  const first = ok(await handle.isSuppressed(ns.ownerId,inputs,page,f.credential));
  const original = Date.now;
  try {
    Date.now = () => f.service.credentialExpiresUtcMs+1;
    refused(await handle.isSuppressed(ns.ownerId,inputs,{ ...page,cursor:first.nextCursor },f.credential),'authority_required');
  } finally { Date.now = original; }
  f.service.credentialExpiresUtcMs = null;
  const fresh = await f.reader();
  // No real-time latency threshold: advance only the trusted monotone clock
  // during an authority callback and require refusal after that cutoff.
  const monotone = process.hrtime.bigint;
  try {
    fresh.state.current = () => { process.hrtime.bigint = () => monotone()+6000000000n; return true; };
    const result = await fresh.handle.isSuppressed(ns.ownerId,inputs,page,f.credential);
    refused(result,'read_timeout'); f.clean(result);
  } finally { process.hrtime.bigint = monotone; }
});
