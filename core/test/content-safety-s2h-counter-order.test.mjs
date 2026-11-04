import assert from 'node:assert/strict';
import test from 'node:test';
import { safetyFixture, ns } from '../testing/content-safety-s2h-fixture.mjs';
import { contentSafetyFacade, contentScopeEpochGuard } from '../content-safety-boundary.mjs';
import { countTokens } from '../model-budget.mjs';
import { MemoryStoreError } from '../validation.mjs';
import { openMemoryCore } from '../index.mjs';
import { host, publish, read } from './role-fixture.mjs';

const secret = 'SyntheticProtectedCounterFailure';
for (const layout of [18,23,33,34,38,48])
for (const outcome of ['negative','non-number','throw','valid'])
test(`counter validation precedence v${layout} ${outcome}`, async t => {
  const base = ({34:18,38:23,48:33})[layout] ?? layout;
  const f = safetyFixture(t, base); if (layout !== base) await f.migrate();
  const db = f.connect(); t.after(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, layout);
  let calls = 0, authorities = 0, epochs = 0, returned = false;
  const prepare = db.prepare;
  db.prepare = function(sql, ...args) {
    if (returned && /^SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs/.test(sql)) epochs++;
    return Reflect.apply(prepare, this, [sql, ...args]);
  };
  const counter = { countTokens() {
    calls++; returned = true; assert.equal(db.isTransaction, false);
    if (outcome === 'throw') throw new Error(secret);
    return outcome === 'valid' ? 1 : outcome === 'negative' ? -1 : { text: secret };
  } };
  // The facade supplies only the real layout-dependent epoch context here.
  // Its delivery check cannot replace the helper's refusal, so this observes
  // countTokens below public Role framing and the closed-delivery wrapper.
  const api = contentSafetyFacade({ getSource() {
    return countTokens(counter, secret, () => { authorities++; throw new MemoryStoreError('scope_changed'); });
  } }, { check: () => {}, portGuard: scopes => contentScopeEpochGuard(db, scopes) });
  let result;
  try { result = { value: api.getSource({ namespace: ns }) }; } catch (error) { result = { error }; }
  assert.equal(result.value, undefined); assert.doesNotMatch(JSON.stringify(result), /SyntheticProtected/);
  assert.ok(result.error instanceof MemoryStoreError);
  assert.equal(result.error.code, outcome === 'valid' ? 'scope_changed' : 'token_count_unavailable');
  assert.equal(calls, 1); assert.equal(authorities, outcome === 'valid' ? 1 : 0);
  assert.equal(epochs, layout >= 34 ? 1 : 0, 'one E1 read for the actual caller invocation, including invalid returns');
  t.diagnostic(JSON.stringify({ layout, outcome, calls, authorities, epochs, code: result.error.code }));
});

// Role is available on the v33/v48 family. Its first metering counter now
// validates before authority just as main does. v33 is the legacy control;
// v48 fails on ba04ab33 and on the rule-A-only candidate.
for (const layout of [33,48]) for (const outcome of ['negative','throw'])
test(`Role public counter refusal v${layout} ${outcome}`, async t => {
  const f = safetyFixture(t, 33); if (layout === 48) await f.migrate();
  let armed = false, calls = 0;
  const h = host({ counter: { id: 'synthetic-refusal', countTokens() {
    calls++;
    if (armed) { h.revoke(); if (outcome === 'throw') throw new Error(secret); return -1; }
    return 1;
  } } });
  const core = openMemoryCore({ path: f.path, methodPackages: h.methods, roleProfiles: h.options, contextRead: h.context });
  t.after(() => core.close());
  assert.equal(core.publishRoleProfileRelease(publish(), {}).ok, true);
  armed = true; calls = 0;
  const result = core.readRoleTaskContext(read(), {});
  assert.equal(result.value, undefined); assert.doesNotMatch(JSON.stringify(result), /SyntheticProtected/);
  assert.deepEqual(result, { ok: false, error: { code: 'token_count_unavailable', retryable: false } });
  assert.equal(calls, 1);
  t.diagnostic(JSON.stringify({ layout, outcome, calls, code: result.error.code }));
});
