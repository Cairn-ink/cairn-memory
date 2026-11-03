import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { familyGate } from '../testing/receipt-event-time-gates.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { openMemoryCore } from '../index.mjs';
import { openProductIndex } from '../context-product-index.mjs';
import { openContextProductFacade } from '../context-read-facade.mjs';
import { requestAuthority } from '../context-product-authority.mjs';
import { credentialDigest } from '../context-product-control.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';

for (const base of [18, 33]) for (const method of ['findCandidates', 'contextRead']) for (const semantic of [false, true]) {
  test(`r5 v${base === 18 ? 34 : 48} ${method} ${semantic ? 'semantic' : 'lexical'} sanitizes after final authority callback`, async t => {
    const f = safetyFixture(t, base); await f.migrate();
    const core = openMemoryCore({ path: f.path }), db = f.connect(); t.after(() => { core.close(); db.close(); });
    const memories = Array.from({ length: 3 }, (_, i) => ok(core.admit({ namespace: ns,
      memory: { content: 'Synthetic delivery population ' + i, kind: 'fact' }, receipts: [receipt('delivery-' + i)] })).memory);
    const token = { opaque: 'synthetic-token' }, ownerCoverage = { policy: 'recent-projects-v1', selectionRevision: 'synthetic',
      requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 };
    const binding = { kind: 'request', requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: randomUUID(),
      credentialExpiresUtcMs: null, credentialDigest: credentialDigest(token), ownerId: ns.ownerId,
      namespaces: { readSet: [ns], ownerCoverage }, issuedAt: 0 };
    const open = (maintenance, host) => {
      const authorize = requestAuthority(host, binding, {}), facade = openContextProductFacade(f.path, { authorize }); t.after(() => facade.close());
      const index = openProductIndex({ path: f.path, facade, authorize, maintenance, ownerCoverage,
        counter: { id: 'synthetic-counter', countTokens: () => 1 },
        operation: () => ({ operationCutoffMonoNs: String(process.hrtime.bigint() + 5000000000n) }),
        ...(semantic && !maintenance ? { semantic: { async snapshot() { return { policy: { semantic: false }, identity: null }; },
          call() { assert.fail('unavailable query must not dispatch a provider'); } } } : {}) });
      t.after(() => index.close()); return { index, facade };
    };
    const maintainer = open(true, { authorize: () => binding, isCurrent: () => true });
    const partial = ok(await maintainer.index.run('refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current',
      mode: 'lexical', budget: { maxItems: 1, maxMs: 5000 } }, token));
    assert.ok(partial.coverage.maintenance.progress); assert.equal(partial.status, 'rebuilding');
    let samples = 0, forgotten = 0, reader, callbackError;
    reader = open(false, { authorize: () => binding, isCurrent() {
      samples++;
      if (samples === 2) {
        try {
          assert.equal(reader.facade.port.db.isTransaction, false, 'authority runs outside the canonical snapshot');
          for (const memory of memories) {
            assert.equal(ok(core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision })).forgotten, true); forgotten++;
          }
        } catch (error) { callbackError = error; }
      }
      return true;
    } });
    const result = await reader.index.run(method, { readSet: [ns], types: ['memory'], intent: 'current', query: 'unmatched', semantic,
      ...(method === 'contextRead' ? { budget: { maxItems: 4, maxTokens: 2000 } } : {}) }, token);
    if (callbackError) throw callbackError;
    assert.equal(samples, 2); assert.equal(forgotten, 3); assert.equal(db.prepare('SELECT count(*) n FROM memories WHERE deleted=1').get().n, 3);
    assert.equal(result.ok, false); assert.equal(result.error.code, 'index_unavailable');
    const details = method === 'contextRead' ? result.error.details.candidates : result.error.details;
    assert.equal(details.coverage.maintenance.progress, null, 'no pre-forget maintenance progress survives final authority');
    assert.equal(details.coverage.byType.memory.eligible, null); assert.equal(details.coverage.byType.memory.indexed, null);
    assert.doesNotMatch(JSON.stringify(result), /baseSequence|checkpoint|Synthetic delivery/);
  });
}


const completeFamilyDelivery = familyGate('E/semantic', 4);
for (const method of ['findCandidates', 'contextRead']) for (const semantic of [false, true])
test(`family gate E: delivery v53 ${method} semantic=${semantic}`, async t => {
  const base = 33;
  const f = eventTimeSafetyFixture(t, base); await f.migrate();
  const core = openMemoryCore({ path: f.path }), db = f.connect(); t.after(() => { core.close(); db.close(); });
  const memories = Array.from({ length: 3 }, (_, i) => ok(core.admit({ namespace: ns,
    memory: { content: 'Synthetic delivery population ' + i, kind: 'fact' }, receipts: [receipt('delivery-' + i)] })).memory);
  const token = { opaque: 'synthetic-token' }, ownerCoverage = { policy: 'recent-projects-v1', selectionRevision: 'synthetic',
    requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 };
  const binding = { kind: 'request', requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: randomUUID(),
    credentialExpiresUtcMs: null, credentialDigest: credentialDigest(token), ownerId: ns.ownerId,
    namespaces: { readSet: [ns], ownerCoverage }, issuedAt: 0 };
  const open = (maintenance, host) => {
    const authorize = requestAuthority(host, binding, {}), facade = openContextProductFacade(f.path, { authorize }); t.after(() => facade.close());
    const index = openProductIndex({ path: f.path, facade, authorize, maintenance, ownerCoverage,
      counter: { id: 'synthetic-counter', countTokens: () => 1 },
      operation: () => ({ operationCutoffMonoNs: String(process.hrtime.bigint() + 5000000000n) }),
      ...(semantic && !maintenance ? { semantic: { async snapshot() { return { policy: { semantic: false }, identity: null }; },
        call() { assert.fail('unavailable query must not dispatch a provider'); } } } : {}) });
    t.after(() => index.close()); return { index, facade };
  };
  const maintainer = open(true, { authorize: () => binding, isCurrent: () => true });
  const partial = ok(await maintainer.index.run('refreshContextIndex', { readSet: [ns], types: ['memory'], intent: 'current',
    mode: 'lexical', budget: { maxItems: 1, maxMs: 5000 } }, token));
  assert.ok(partial.coverage.maintenance.progress); assert.equal(partial.status, 'rebuilding');
  let samples = 0, forgotten = 0, reader, callbackError;
  reader = open(false, { authorize: () => binding, isCurrent() {
    samples++;
    if (samples === 2) {
      try {
        assert.equal(reader.facade.port.db.isTransaction, false, 'authority runs outside the canonical snapshot');
        for (const memory of memories) {
          assert.equal(ok(core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision })).forgotten, true); forgotten++;
        }
      } catch (error) { callbackError = error; }
    }
    return true;
  } });
  const result = await reader.index.run(method, { readSet: [ns], types: ['memory'], intent: 'current', query: 'unmatched', semantic,
    ...(method === 'contextRead' ? { budget: { maxItems: 4, maxTokens: 2000 } } : {}) }, token);
  if (callbackError) throw callbackError;
  assert.equal(samples, 2); assert.equal(forgotten, 3); assert.equal(db.prepare('SELECT count(*) n FROM memories WHERE deleted=1').get().n, 3);
  assert.equal(result.ok, false); assert.equal(result.error.code, 'index_unavailable');
  const details = method === 'contextRead' ? result.error.details.candidates : result.error.details;
  assert.equal(details.coverage.maintenance.progress, null, 'no pre-forget maintenance progress survives final authority');
  assert.equal(details.coverage.byType.memory.eligible, null); assert.equal(details.coverage.byType.memory.indexed, null);
  assert.doesNotMatch(JSON.stringify(result), /baseSequence|checkpoint|Synthetic delivery/);

  completeFamilyDelivery(`${method}/${semantic}`);
});
