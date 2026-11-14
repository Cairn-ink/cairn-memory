import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../contract.mjs';
import { createCommitDispatcher } from '../commit-dispatch.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { writeContentSuppressionInside, suppressOwnerInside, suppressReceiptsInside } from '../content-suppression-storage.mjs';

const ns = { ownerId: 'synthetic-suppression-owner', scope: 'personal', projectId: null };
const text = 'Synthetic cobalt telescope preference';
const receipt = { client: 'synthetic', sessionId: 'session', eventId: 'message', role: 'user', excerpt: text };
const input = { namespace: ns, client: receipt.client, sessionId: receipt.sessionId, eventId: 'batch',
  messages: [{ id: receipt.eventId, role: receipt.role, content: text }] };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };

async function fixture(t, kind, dispatched) {
  const f = safetyFixture(t); await f.migrate();
  const holder = f.connect();
  let armed = false, extract = 0, backoffs = 0, memory;
  const exec = DatabaseSync.prototype.exec;
  const mock = t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (armed && this !== holder && sql === 'BEGIN IMMEDIATE' && new Error().stack.includes('finishAdmission')) {
      armed = false; holder.exec('BEGIN IMMEDIATE');
    }
    return Reflect.apply(exec, this, [sql]);
  });
  t.after(() => mock.mock.restore());
  const suppress = () => {
    const options = { reason: 'user_forget', actionId: 'synthetic-directed-forget' };
    if (kind === 'owner') suppressOwnerInside(holder, { ownerId: ns.ownerId, ...options });
    else if (kind === 'receipt') suppressReceiptsInside(holder, ns, memory.id, options);
    else {
      // The zero-tolerance part of forget_memory: fingerprint, memory and all
      // receipts are suppressed in the same writer transaction as the tombstone.
      holder.prepare('INSERT OR IGNORE INTO suppressed SELECT owner_id,scope,project_id,fingerprint FROM memories WHERE id=?').run(memory.id);
      writeContentSuppressionInside(holder, { namespace: ns, kind: 'memory', key: memory.id, ...options });
      suppressReceiptsInside(holder, ns, memory.id, options);
      holder.prepare('UPDATE memories SET content=NULL,deleted=1,revision=revision+1 WHERE id=?').run(memory.id);
      holder.prepare('DELETE FROM receipts WHERE memory_id=?').run(memory.id);
      holder.prepare(`INSERT INTO namespace_epochs(owner_id,scope,project_id,epoch) VALUES(?,?,?,2)
        ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET epoch=epoch+1`).run(ns.ownerId, ns.scope, '');
    }
  };
  const host = createCommitDispatcher({ random: () => 0, onBackoff() {
    backoffs++;
    assert.equal(holder.isTransaction, true, 'the contested admission must reach BUSY');
    assert.ok(host.inspectTransactions().every(state => state.isOpen && !state.isTransaction),
      'the failed engine attempt is rolled back before suppression commits');
    suppress(); holder.exec('COMMIT');
  } });
  const model = { contextWindow: 8192, countTokens: () => 1, extract() {
    extract++;
    // Only this test holder spans the capture's await; engine transactions do
    // not. No child exit notification or wall-clock lock-release timer exists.
    if (dispatched) armed = true;
    return { items: [{ content: text, kind: 'preference', confidence: .8, sourceIndices: [0] }] };
  } };
  const open = () => openMemoryCore({ path: f.path, raw: false, model });
  const core = dispatched ? host.open(open) : open();
  t.after(() => { if (holder.isTransaction) holder.exec('ROLLBACK'); core.close(); holder.close(); });
  memory = ok(await core.admit({ namespace: ns, memory: { content: kind === 'memory' ? text : 'Synthetic source anchor', kind: 'fact' },
    receipts: [{ ...receipt, ...(kind === 'memory' ? { eventId: 'other-source' } : {}) }] })).memory;
  // The default control starts after the forget has committed, so it tests
  // admission refusal rather than the provider-return E1 epoch fence.
  if (!dispatched) {
    if (kind === 'memory') ok(core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    else { holder.exec('BEGIN IMMEDIATE'); suppress(); holder.exec('COMMIT'); }
  }
  return { path: f.path, core, host, memory, holder, suppress, counts: () => ({ extract, backoffs }) };
}

for (const kind of ['memory', 'receipt', 'owner']) test(`${kind}: suppression before admission matches the default path after BUSY`, async t => {
  const control = await fixture(t, kind, false);
  const expected = await control.core.capture(input);
  const f = await fixture(t, kind, true);
  const actual = await f.host.run(() => f.core.capture(input));
  if (kind === 'memory') {
    // Automatic capture has always counted forgotten fingerprints as skipped.
    // Explicit admission below separately establishes memory_suppressed.
    assert.equal(expected.ok, true, JSON.stringify(expected));
    assert.deepEqual(expected.value.admission.memories, []);
    assert.equal(expected.value.admission.suppressedCount, 1);
    // Coordinator 11-14 D1 decision (i) with (iii): retained epoch disagreement
    // refuses earlier; the content-free staged release permits a fresh retry.
    assert.deepEqual(actual, { ok: false, error: { code: 'evidence_unavailable', retryable: false } }, 'R2K_MEMORY_GUARD_RERUN');
  } else {
    assert.equal(expected.ok, false, JSON.stringify(expected));
    assert.equal(expected.error.code, kind === 'receipt' ? 'source_excluded' : 'memory_not_found');
    assert.deepEqual(actual, kind === 'receipt'
      ? { ok: false, error: { code: 'evidence_unavailable', retryable: false } } : expected,
    'R2K_' + kind.toUpperCase() + '_GUARD_RERUN');
  }
  assert.equal(f.counts().extract, 1, 'provider extraction must not replay');
  assert.equal(control.counts().extract, kind === 'memory' ? 1 : 0);
  assert.ok(f.counts().backoffs >= 1, 'the admission attempt really encountered BUSY');
  assert.equal(f.holder.prepare('SELECT count(*) n FROM memories WHERE id!=?').get(f.memory.id).n, 0,
    'no suppressed content may commit even if owner-level delivery refuses');
  const visible = await f.core.list({ namespace: ns });
  if (kind === 'owner') assert.equal(visible.ok, false);
  else assert.ok(ok(visible).memories.every(row => kind === 'receipt' && row.id === f.memory.id));
  if (kind === 'memory') assert.equal((await f.core.get({ namespace: ns, memoryId: f.memory.id })).ok, false);
});

test('explicit admission: forgotten fingerprint returns default memory_suppressed after BUSY', async t => {
  const control = await fixture(t, 'memory', false);
  const request = { namespace: ns, memory: { content: text, kind: 'fact' }, receipts: [receipt] };
  const expected = control.core.admit(request);
  assert.deepEqual(expected, { ok: false, error: { code: 'memory_suppressed', retryable: false } });
  const f = await fixture(t, 'memory', true);
  // This explicit-admission holder releases on the first observed BUSY as well.
  let backoffs = 0;
  const host = createCommitDispatcher({ onBackoff() { backoffs++; f.suppress(); f.holder.exec('COMMIT'); } });
  const core = host.open(() => openMemoryCore({ path: f.path, raw: false })); t.after(() => core.close());
  f.holder.exec('BEGIN IMMEDIATE');
  assert.deepEqual(await core.admit(request), expected, 'R2K_EXPLICIT_MEMORY_GUARD_RERUN');
  assert.ok(backoffs >= 1);
  assert.deepEqual(ok(await core.list({ namespace: ns })).memories, []);
});
