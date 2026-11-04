import assert from 'node:assert/strict';
import test from 'node:test';
import { safetyFixture, ns } from '../testing/content-safety-s2h-fixture.mjs';
import { createPrivateCardStorage } from '../private-card-storage.mjs';
import { privateFailure } from '../private-card-facade.mjs';
import { installedContentLayout } from '../content-safety-schema.mjs';
import { contentSafetyFacade } from '../content-safety-boundary.mjs';
import { openMemoryStore } from '../index.mjs';
import { MemoryStoreError, fail } from '../validation.mjs';

const payload = 'SyntheticClosedStackPayload';
const envelope = (code = 'scope_changed') => ({ ok: false, error: { code, retryable: false } });
async function fixture(t, layout) {
  const base = ({34:18,38:23,48:33})[layout] ?? layout;
  const f = safetyFixture(t, base); if (base !== layout) await f.migrate();
  return f;
}
async function boundary(t, layout) {
  const f = await fixture(t, layout), db = f.connect();
  t.after(() => { if (db.isOpen) db.close(); });
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
function cleanSurfaces(value) {
  assert.equal('toJSON' in value, false, 'caller serialization hook survived delivery');
  assert.equal(Symbol.toPrimitive in value, false, 'caller coercion hook survived delivery');
  assert.equal(Object.hasOwn(value, 'cause'), false, 'caller cause survived delivery');
  assert.equal(JSON.stringify(value).includes(payload), false);
  assert.equal(String(value).includes(payload), false);
  assert.equal(`${value}`.includes(payload), false);
}
function clean(error, original, code) {
  // Identity is checked before reading stack: a retained custom getter must
  // never be invoked, even when exercising the vulnerable baseline.
  assert.notEqual(error, original, 'caller error object crossed delivery');
  assert.ok(error instanceof MemoryStoreError);
  assert.equal(Object.getPrototypeOf(error), MemoryStoreError.prototype);
  assert.equal(error.code, code);
  assert.deepEqual(Reflect.ownKeys(error).sort(), ['code','message','name','stack']);
  assert.equal(error.message, code); assert.equal(error.name, 'MemoryStoreError');
  cleanSurfaces(error);
  assert.equal(String(error.stack).includes(payload), false);
}
const shapes = [
  ['enumerable data object', error => Object.defineProperty(error, 'stack', { value: {payload}, enumerable: true }), 'store_closed'],
  ['enumerable data string', error => Object.defineProperty(error, 'stack', { value: payload, enumerable: true }), 'store_closed'],
  ['non-enumerable data string', error => Object.defineProperty(error, 'stack', { value: payload, enumerable: false }), 'store_closed'],
  ['custom accessor', error => Object.defineProperty(error, 'stack', { get() { assert.fail('stack getter invoked'); }, enumerable: false }), 'store_closed'],
  ['native setter', error => { error.stack = payload; return error; }, 'scope_changed'],
  // Behaviour controls for rule A; freshness assertions are new regressions.
  ['plain typed control', error => error, 'scope_changed'],
  ['missing stack control', error => { delete error.stack; return error; }, 'scope_changed'],
  ['Proxy', error => new Proxy(error, { getPrototypeOf() { assert.fail('Proxy trap invoked'); }, ownKeys() { assert.fail('Proxy trap invoked'); }, get() { assert.fail('Proxy trap invoked'); } }), 'store_closed'],
  // Refusal controls on the baseline: extra own keys and non-exact prototypes
  // are not content-free, so each shape must select store_closed, not rule A.
  ['own cause control', error => Object.defineProperty(error, 'cause', { value: payload }), 'store_closed'],
  ['own toJSON control', error => Object.defineProperty(error, 'toJSON', { value() { return payload; } }), 'store_closed'],
  ['own Symbol.toPrimitive control', error => Object.defineProperty(error, Symbol.toPrimitive, { value() { return payload; } }), 'store_closed'],
  ['prototype hooks control', error => Object.setPrototypeOf(error, Object.assign(Object.create(MemoryStoreError.prototype), {
    toJSON() { return payload; }, [Symbol.toPrimitive]() { return payload; },
  })), 'store_closed'],
];
const envelopeShapes = [
  ['exact', value => value, 'scope_changed'],
  // Refusal controls on the baseline: each added own key invalidates the
  // exact envelope shape and must produce the private store_closed failure.
  ['own toJSON', value => Object.defineProperty(value, 'toJSON', { value() { return payload; } }), 'store_closed'],
  ['nested own toJSON', value => { Object.defineProperty(value.error, 'toJSON', { value() { return payload; } }); return value; }, 'store_closed'],
  ['own Symbol.toPrimitive', value => Object.defineProperty(value, Symbol.toPrimitive, { value() { return payload; } }), 'store_closed'],
  ['nested cause', value => { Object.defineProperty(value.error, 'cause', { value: payload }); return value; }, 'store_closed'],
];
for (const layout of [18,23,33,34,38,48]) {
  test(`public stack payload v${layout}`, async t => {
    const f = await fixture(t, layout), store = openMemoryStore({path: f.path});
    t.after(() => store.close());
    const scoped = store.scope({ownerId: ns.ownerId, projectId: ns.projectId});
    const original = Object.defineProperty(new MemoryStoreError('scope_changed'), 'stack', {value: {payload}, enumerable: true});
    let result;
    try { scoped.list({get limit() { store.close(); throw original; }}); }
    catch (error) { result = error; }
    assert.equal(JSON.stringify(result).includes(payload), false, 'public list leaked caller payload');
    clean(result, original, 'store_closed');
  });
  for (const [shape, prepare, code] of shapes)
  for (const mode of ['sync throw','async reject','async failure mapper'])
  test(`closed rebuild v${layout}: ${shape}, ${mode}`, async t => {
    const b = await boundary(t, layout);
    const original = prepare(new MemoryStoreError('scope_changed'));
    let mapped;
    const operation = () => { b.db.close(); throw original; };
    const api = contentSafetyFacade({ getSource: mode === 'sync throw' ? operation : async () => operation() }, {
      check: b.check,
      ...(mode === 'async failure mapper' ? {failure(error) { mapped = error; return error; }} : {}),
    });
    let result;
    try { result = await api.getSource({namespace: ns}); } catch (error) { result = error; }
    assert.equal(b.refusals(), 1, 'delivery must refuse exactly once');
    clean(result, original, code);
    if (mode === 'async failure mapper') assert.equal(mapped, result);
  });
  for (const [shape, prepare, code] of envelopeShapes)
  for (const asynchronous of [false,true])
  test(`closed envelope control v${layout}: ${shape}, ${asynchronous ? 'async' : 'sync'}`, async t => {
    const b = await boundary(t, layout), original = prepare(envelope());
    const operation = () => { b.db.close(); return original; };
    const api = contentSafetyFacade({ getSource: asynchronous ? async () => operation() : operation }, {check: b.check, failure: privateFailure});
    const result = await api.getSource({namespace: ns});
    assert.equal(b.refusals(), 1);
    assert.notEqual(result, original, 'caller envelope crossed delivery');
    assert.notEqual(result.error, original.error, 'caller nested error crossed delivery');
    assert.deepEqual(result, envelope(code));
    assert.deepEqual(Reflect.ownKeys(result), ['ok','error']);
    assert.deepEqual(Reflect.ownKeys(result.error), ['code','retryable']);
    assert.equal(Object.getPrototypeOf(result), Object.prototype);
    assert.equal(Object.getPrototypeOf(result.error), Object.prototype);
    cleanSurfaces(result);
    cleanSurfaces(result.error);
  });
}
