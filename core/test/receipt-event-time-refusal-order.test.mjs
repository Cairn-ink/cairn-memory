// Rotated family twins for the post-ba04ab33 refusal fixes. Gate A covers the
// layout-independent transfer; these count completed behavioural seam cases.
import assert from 'node:assert/strict';
import test from 'node:test';
import { performance } from 'node:perf_hooks';
import { eventTimeSafetyFixture, ns, ok, receipt } from '../testing/receipt-event-time-fixture.mjs';
import { familyGate } from '../testing/receipt-event-time-gates.mjs';
import { createPrivateCardStorage } from '../private-card-storage.mjs';
import { privateFailure } from '../private-card-facade.mjs';
import { installedContentLayout } from '../content-safety-schema.mjs';
import { contentSafetyFacade, contentScopeEpochGuard } from '../content-safety-boundary.mjs';
import { countTokens } from '../model-budget.mjs';
import { openMemoryCore } from '../index.mjs';
import { openContextReadSidecar } from '../context-read-sidecar.mjs';
import { drain } from '../testing/context-read-fixture.mjs';
import { waitForContextEntry } from '../testing/context-read-core-fixture.mjs';
import { MemoryStoreError, fail } from '../validation.mjs';

const complete = familyGate('S2h-2 refusal seam', 16);
const secret = 'SyntheticProtectedFamilyFailure';
async function fixture(t, base) {
  const f = eventTimeSafetyFixture(t, base); await f.migrate();
  const db = f.connect(); t.after(() => { if (db.isOpen) db.close(); });
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, {18:51,23:52,33:53}[base]);
  installedContentLayout(db);
  return { ...f, db };
}
const envelope = code => ({ ok: false, error: { code, retryable: false } });
for (const mode of ['sync typed','async mapped','native stack setter','custom stack','exact envelope','unsafe envelope'])
test(`family refusal seam v51: closed ${mode}`, async t => {
  const f = await fixture(t, 18), { db } = f;
  const metadata = db.prepare('SELECT store_id,cursor_secret FROM store_metadata').get();
  let refusals = 0, mapped;
  const storage = createPrivateCardStorage({ db,
    ready() { if (!db.isOpen) { refusals++; fail('store_closed'); } },
    identity: { storeId: metadata.store_id, cursorSecret: metadata.cursor_secret } });
  const isEnvelope = mode.endsWith('envelope');
  const original = isEnvelope ? envelope('scope_changed') : new MemoryStoreError('scope_changed');
  if (mode === 'native stack setter') original.stack = secret;
  if (mode === 'custom stack') Object.defineProperty(original, 'stack', { get() { assert.fail('caller stack getter ran'); } });
  if (mode === 'unsafe envelope') Object.defineProperty(original.error, 'cause', { value: secret });
  const operation = () => { db.close(); if (isEnvelope) return original; throw original; };
  const api = contentSafetyFacade({ getSource: mode === 'sync typed' ? operation : async () => operation() }, {
    check: (scopes, phase) => storage.assertContentScope(scopes, phase),
    ...(isEnvelope ? { failure: privateFailure } : mode === 'async mapped' ? { failure(error) { mapped = error; return error; } } : {}),
  });
  let result;
  try { result = await api.getSource({ namespace: ns }); } catch (error) { result = error; }
  const code = ['custom stack','unsafe envelope'].includes(mode) ? 'store_closed' : 'scope_changed';
  assert.equal(refusals, 1); assert.notEqual(result, original);
  assert.doesNotMatch(JSON.stringify(result), /SyntheticProtected/);
  if (isEnvelope) {
    assert.notEqual(result.error, original.error); assert.deepEqual(result, envelope(code));
    assert.deepEqual(Reflect.ownKeys(result), ['ok','error']);
    assert.deepEqual(Reflect.ownKeys(result.error), ['code','retryable']);
  } else {
    assert.ok(result instanceof MemoryStoreError);
    assert.equal(Object.getPrototypeOf(result), MemoryStoreError.prototype);
    assert.equal(result.code, code); assert.equal(result.message, code);
    assert.deepEqual(Reflect.ownKeys(result).sort(), ['code','message','name','stack']);
    assert.doesNotMatch(String(result.stack), /SyntheticProtected/);
    if (mode === 'async mapped') assert.equal(mapped, result);
  }
  complete('v51:' + mode);
});

for (const outcome of ['negative','throw','valid'])
test(`family refusal seam v52: counter ${outcome}`, async t => {
  const { db } = await fixture(t, 23);
  let calls = 0, authorities = 0, epochs = 0, returned = false;
  const prepare = db.prepare;
  db.prepare = function(sql, ...args) {
    if (returned && /^SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs/.test(sql)) epochs++;
    return Reflect.apply(prepare, this, [sql, ...args]);
  };
  const counter = { countTokens() {
    calls++; returned = true; assert.equal(db.isTransaction, false);
    if (outcome === 'throw') throw new Error(secret);
    return outcome === 'valid' ? 1 : -1;
  } };
  const api = contentSafetyFacade({ getSource() {
    return countTokens(counter, secret, () => { authorities++; throw new MemoryStoreError('scope_changed'); });
  } }, { check: () => {}, portGuard: scopes => contentScopeEpochGuard(db, scopes) });
  let error;
  try { api.getSource({ namespace: ns }); } catch (value) { error = value; }
  assert.ok(error instanceof MemoryStoreError);
  assert.equal(error.code, outcome === 'valid' ? 'scope_changed' : 'token_count_unavailable');
  assert.doesNotMatch(JSON.stringify(error), /SyntheticProtected/);
  assert.equal(calls, 1); assert.equal(authorities, outcome === 'valid' ? 1 : 0); assert.equal(epochs, 1);
  complete('v52:' + outcome);
});

const gate = () => { let release; return { promise: new Promise(resolve => { release = resolve; }), release: () => release() }; };
for (const outcome of ['vector','provider_error','timeout','abort','revoked','guard-close','guard-abort'])
test(`family refusal seam v53: sidecar ${outcome}`, async t => {
  t.mock.method(performance, 'now', () => 0);
  const f = await fixture(t, 33), core = openMemoryCore({ path: f.path }); t.after(() => core.close());
  ok(core.admit({ namespace: ns, memory: { content: secret, kind: 'fact' }, receipts: [receipt('refusal-seam')] }));
  const index = openContextReadSidecar({ path: f.path, db: f.db }); t.after(() => index.close());
  const input = { readSet: [ns], types: ['memory'], intent: 'current', accessGeneration: 1, budget: { maxItems: 1024, maxMs: 5000 } };
  drain(index, input);
  const entered = gate(), release = gate(), controller = new AbortController();
  let calls = 0, returned = false, checks = 0, current = true;
  const port = { id: 'synthetic-family-refusal', revision: 'one', dimensions: 8, normalization: 'l2', async embed() {
    calls++; assert.equal(f.db.isTransaction, false); entered.release(); await release.promise; returned = true;
    if (['provider_error','timeout'].includes(outcome)) throw Object.assign(new Error(outcome), { code: outcome });
    return [new Float32Array([1,0,0,0,0,0,0,0])];
  } };
  const operation = index.refreshVectors(input, port, { signal: controller.signal, isCurrent() {
    if (returned) {
      checks++;
      if (outcome === 'guard-close') index.close();
      if (outcome === 'guard-abort') controller.abort(new MemoryStoreError('read_cancelled'));
    }
    return current;
  } });
  const observed = operation.then(value => ({ value }), error => ({ error }));
  try {
    await waitForContextEntry(entered.promise, operation);
    current = outcome !== 'revoked';
    if (['vector','provider_error','timeout','abort'].includes(outcome)) { current = false; index.close(); }
    if (outcome === 'abort') controller.abort(new MemoryStoreError('read_cancelled'));
    release.release();
    const result = await observed;
    assert.equal(result.value, undefined); assert.equal(calls, 1);
    assert.ok(result.error instanceof MemoryStoreError);
    assert.equal(result.error.code, ['abort','guard-abort'].includes(outcome) ? 'read_cancelled' : outcome === 'revoked' ? 'scope_changed' : 'store_closed');
    assert.equal(checks, ['revoked','guard-close','guard-abort'].includes(outcome) ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(result), /SyntheticProtected/);
    const inspect = openContextReadSidecar({ path: f.path, db: f.db }); t.after(() => inspect.close());
    assert.equal(inspect.semanticPreflight(input, port).embedded, 0, 'refusal publishes no vector');
    complete('v53:' + outcome);
  } finally { release.release(); await observed; }
});
