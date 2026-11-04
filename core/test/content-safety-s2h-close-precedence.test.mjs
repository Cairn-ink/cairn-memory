import assert from 'node:assert/strict';
import test from 'node:test';
import { safetyFixture, ns } from '../testing/content-safety-s2h-fixture.mjs';
import { cardHost, localPlainPort } from '../testing/raw-source-fixtures.mjs';
import { createPrivateCardFacade } from '../private-card-facade.mjs';
import { createPrivateCardStorage } from '../private-card-storage.mjs';
import { installedContentLayout } from '../content-safety-schema.mjs';
import { registerContentWriteBoundary } from '../content-write-context.mjs';
import { contentSafetyFacade } from '../content-safety-boundary.mjs';
import { privateFailure } from '../private-card-facade.mjs';
import { callModel } from '../model-call.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';
import { fail, MemoryStoreError } from '../validation.mjs';

for (const layout of [18,23,33,34,38,48])
for (const method of ['resolveSourceReferences','getSource'])
test(`closed Raw delivery precedence v${layout} ${method}`, async t => {
  const base = ({34:18,38:23,48:33})[layout] ?? layout;
  const f = safetyFixture(t, base); if (layout !== base) await f.migrate();
  const db = f.connect(); t.after(() => { if (db.isOpen) db.close(); });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
  installedContentLayout(db);
  const metadata = db.prepare('SELECT store_id,cursor_secret FROM store_metadata').get();
  let closedRefusals = 0, calls = 0, finishes = 0, returned = false;
  const ready = () => { if (!db.isOpen) { closedRefusals++; fail('store_closed'); } };
  const storage = createPrivateCardStorage({ db, ready, rawSources: true,
    identity: { storeId: metadata.store_id, cursorSecret: metadata.cursor_secret } });
  registerContentWriteBoundary(storage, db);
  const host = cardHost(), basePort = localPlainPort();
  let enter, release;
  const entered = new Promise(resolve => { enter = resolve; });
  const blocked = new Promise(resolve => { release = resolve; });
  const port = { async openRaw(input) {
    calls++; assert.equal(db.isOpen, true, 'dispatch happens before close');
    assert.equal(db.isTransaction, false);
    const result = await basePort.openRaw(input);
    enter(); await blocked; returned = true;
    return result;
  } };
  const protectedText = 'SyntheticProtectedPendingRaw';
  const rawReader = { async prepare() {
    const result = await port.openRaw({ sealed: Buffer.from(protectedText) });
    return { finish() { finishes++; return { parts: [result] }; } };
  } };
  const facade = createPrivateCardFacade(storage, host.options, ready, rawReader);
  const input = method === 'resolveSourceReferences'
    ? { namespace: ns, anchors: [{ rawAnchor: { conversationId: 'synthetic-conversation',
      messageId: 'synthetic-message', start: 0, end: protectedText.length, precision: 'exact' },
      expectedConversationRevision: 1 }] }
    : { namespace: ns, source: { type: 'raw', namespace: ns,
      conversationId: 'synthetic-conversation', messageId: 'synthetic-message',
      span: { start: 0, end: protectedText.length, precision: 'exact' }, contentIdentity: 'a'.repeat(43) } };
  const pending = host.call(facade, method, input);
  await entered; host.revoke(); db.close(); release();
  const result = await pending;
  assert.equal(returned, true); assert.equal(calls, 1); assert.equal(finishes, 0);
  assert.equal(closedRefusals, 1, 'the closed-store delivery check must still refuse exactly once');
  assert.equal(result.ok, false); assert.equal(result.value, undefined);
  assert.doesNotMatch(JSON.stringify(result), /SyntheticProtectedPendingRaw/);
  t.diagnostic(JSON.stringify({ layout, method, calls, finishes, closedRefusals, code: result.error.code }));
  assert.deepEqual(result, { ok: false, error: { code: 'scope_changed', retryable: false } });
});

const secret = 'SyntheticProtectedFailureContent';
const failureResult = code => ({ ok: false, error: { code, retryable: false } });
function blocked() {
  let enter, release;
  return { entered: new Promise(resolve => { enter = resolve; }),
    pending: new Promise(resolve => { release = resolve; }),
    enter: () => enter(), release: () => release() };
}
async function boundary(t, layout) {
  const base = ({34:18,38:23,48:33})[layout] ?? layout;
  const f = safetyFixture(t, base); if (layout !== base) await f.migrate();
  const db = f.connect(); t.after(() => { if (db.isOpen) db.close(); });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
  installedContentLayout(db);
  const metadata = db.prepare('SELECT store_id,cursor_secret FROM store_metadata').get();
  let refusals = 0;
  const ready = () => { if (!db.isOpen) { refusals++; fail('store_closed'); } };
  const storage = createPrivateCardStorage({ db, ready,
    identity: { storeId: metadata.store_id, cursorSecret: metadata.cursor_secret } });
  return { db, check: (scopes, phase) => storage.assertContentScope(scopes, phase),
    refusals: () => refusals };
}
function noContent(result) {
  assert.equal(result.value, undefined);
  assert.doesNotMatch(JSON.stringify(result), /SyntheticProtected/);
}

for (const layout of [18,23,33,34,38,48]) {
  test(`closed typed rejection v${layout}: real callModel rejects invalid output`, async t => {
    const b = await boundary(t, layout), gate = blocked();
    // This real engine helper throws MemoryStoreError('invalid_model_output')
    // after an awaited provider returns non-JSON output. The engine, not the
    // stub provider, constructs the typed failure. No protected input is sent.
    const model = { contextWindow: 8192, countTokens: () => 1,
      async extract() { gate.enter(); await gate.pending; return undefined; } };
    const api = contentSafetyFacade({ callModel: () => callModel(model, 'extract', 'synthetic', {}) }, { check: b.check });
    const pending = api.callModel({ namespace: ns });
    const observed = pending.then(value => ({ value }), error => ({ error }));
    await gate.entered; assert.equal(b.db.isTransaction, false); b.db.close(); gate.release();
    const { value, error } = await observed;
    assert.equal(value, undefined); assert.equal(b.refusals(), 1);
    assert.ok(error instanceof MemoryStoreError); assert.doesNotMatch(String(error), /SyntheticProtected/);
    assert.doesNotMatch(JSON.stringify(error), /SyntheticProtected/);
    t.diagnostic(JSON.stringify({ layout, method: 'callModel', closedRefusals: b.refusals(), code: error.code }));
    assert.equal(error.code, 'invalid_model_output');
    assert.equal(error.message, 'invalid_model_output');
  });

  const unsafe = [
    ['payload', () => ({ ...failureResult('scope_changed'), payload: secret })],
    ['message', () => ({ ...failureResult('scope_changed'), error: { code: 'scope_changed', retryable: false, message: secret } })],
    ['details', () => ({ ...failureResult('scope_changed'), error: { code: 'scope_changed', retryable: false, details: { text: secret } } })],
    ['unknown primitive', () => ({ ...failureResult('scope_changed'), extra: 1 })],
    ['content in code', () => ({ ok: false, error: { code: secret, retryable: false } })],
    ['non-string code', () => ({ ok: false, error: { code: 1, retryable: false } })],
    ['nested retryable', () => ({ ok: false, error: { code: 'scope_changed', retryable: { text: secret } } })],
    ['symbol field', () => ({ ...failureResult('scope_changed'), [Symbol('content')]: secret })],
    ['accessor', () => Object.defineProperty(failureResult('scope_changed'), 'payload', { get() { assert.fail('must not invoke accessor'); } })],
    ['proxy', () => new Proxy(failureResult('scope_changed'), { ownKeys() { assert.fail('must not invoke Proxy'); } })],
    ['untyped error', () => { throw new Error(secret); }],
    ['typed content message', () => { const error = new MemoryStoreError('scope_changed'); error.message = secret; throw error; }],
    ['typed content field', () => { throw Object.assign(new MemoryStoreError('scope_changed'), { payload: secret }); }],
    ['typed accessor code', () => { throw Object.defineProperty(new MemoryStoreError('scope_changed'), 'code', { get() { assert.fail('must not invoke error accessor'); } }); }],
    ['typed unknown code', () => { throw new MemoryStoreError(secret); }],
    ['success', () => ({ ok: true, value: secret })],
  ];
  for (const [shape, produce] of unsafe) test(`closed unsafe v${layout}: ${shape}`, async t => {
    const b = await boundary(t, layout), gate = blocked();
    const api = contentSafetyFacade({ async getSource() { gate.enter(); await gate.pending; return produce(); } },
      { check: b.check, failure: privateFailure });
    const pending = api.getSource({ namespace: ns });
    await gate.entered; assert.equal(b.db.isTransaction, false); b.db.close(); gate.release();
    const result = await pending;
    assert.equal(b.refusals(), 1); noContent(result);
    assert.deepEqual(result, failureResult('store_closed'));
  });
}

for (const layout of [34,38,48]) for (const thrown of [false,true])
test(`non-closed delivery denial v${layout}: ${thrown ? 'typed throw' : 'failure envelope'}`, async t => {
  const b = await boundary(t, layout), gate = blocked();
  const api = contentSafetyFacade({ async getSource() {
    gate.enter(); await gate.pending;
    if (thrown) throw new MemoryStoreError('scope_changed');
    return failureResult('scope_changed');
  } }, { check: b.check, failure: privateFailure });
  const pending = api.getSource({ namespace: ns });
  await gate.entered;
  transaction(b.db, () => writeContentSuppressionInside(b.db, {
    namespace: ns, kind: 'namespace', matchMode: 'namespace', reason: 'privacy_erase', actionId: 'synthetic-denial' }));
  gate.release(); const result = await pending;
  assert.equal(b.refusals(), 0); noContent(result);
  assert.deepEqual(result, failureResult('evidence_unavailable'));
});
