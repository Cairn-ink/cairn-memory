import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../contract.mjs';
import { createCommitDispatcher } from '../commit-dispatch.mjs';
import { holdWriteLock } from '../../adapters/mcp/test/local-shared-support.mjs';
import { safetyFixture } from '../testing/content-safety-s2h-fixture.mjs';
import { transaction } from '../database.mjs';
import { writeContentSuppressionInside } from '../content-suppression-storage.mjs';

const ns = { ownerId: 'synthetic-commit-owner', scope: 'personal', projectId: null };
const text = 'Synthetic cobalt telescope preference';
const receipt = { client: 'synthetic', sessionId: 'session', eventId: 'message', role: 'user', excerpt: text };
const request = client => ({ namespace: ns, client, sessionId: 'session', eventId: 'batch',
  messages: [{ id: 'message', role: 'user', content: text }] });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const extraction = () => ({ items: [{ content: text, kind: 'preference', confidence: .8, sourceIndices: [0] }] });
const placement = ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id,
  parentIds: [], newL1: { title: 'Synthetic telescope', parentL2Ids: [] } })) });
function fixture(t, { path, raw = false, stage = 'extract', holdMs = 3000, afterLock, options = {} } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'commit-capture-' });
  path ??= join(workspace.path, 'store.sqlite');
  const calls = { extract: 0, classify: 0 }, states = []; let lock, changed;
  const lockOnce = async () => {
    lock = await holdWriteLock(t, path, holdMs);
    changed = lock.exited.then(async ([code, signal]) => {
      assert.equal(code, 0); assert.equal(signal, null);
      if (afterLock) await afterLock({ path, writer });
    });
    changed.catch(() => {});
  };
  const model = { contextWindow: 8192, countTokens: () => 1,
    async extract() { calls.extract++; if (stage === 'extract') await lockOnce(); return extraction(); },
    async classify(value) { calls.classify++; if (stage === 'classify') await lockOnce(); return placement(value); } };
  const host = createCommitDispatcher({ random: () => 1, onAwait: state => states.push(state) });
  const core = host.open(() => openMemoryCore({ path, model, raw, rawSearch: false, ...options }));
  const writer = openMemoryCore({ path, raw, rawSearch: false });
  workspace.defer(() => { core.close(); writer.close(); });
  return { path, core, writer, host, calls, states,
    settled: () => changed, run: budget => host.run(() => core.capture(request(raw ? 'codex' : 'synthetic')),
      budget === undefined ? {} : { deadlineAt: performance.now() + budget }) };
}

for (const stage of ['extract','classify']) test(`3s external lock after ${stage}: provider dispatch is never replayed`, async t => {
  const f = fixture(t, { stage });
  const start = performance.now(); let last = start, largestGap = 0;
  const heartbeat = setInterval(() => { const now = performance.now(); largestGap = Math.max(largestGap, now-last); last = now; }, 10);
  let result;
  try { result = await f.run(); }
  finally { clearInterval(heartbeat); largestGap = Math.max(largestGap, performance.now()-last); }
  await f.settled();
  assert.notEqual(result.error?.code, 'storage_error', 'await inside a commit closure must never be introduced');
  assert.equal(f.calls.extract, 1, 'extract provider must stay at exactly 1 per request under a 3s lock');
  assert.equal(f.calls.classify, 1, 'classify provider must stay at exactly 1 per request under a 3s lock');
  const value = ok(result);
  assert.equal(value.classification.status, 'applied', 'request must succeed after asynchronous commit retry');
  assert.ok(performance.now() - start >= 2900);
  assert.ok(largestGap < 200, 'timer backoff must keep event loop responsive');
  assert.equal(ok(await f.core.list({ namespace: ns })).memories.length, 1);
  assert.ok(f.states.some(state => state.point === 'before_timer'));
  assert.ok(f.states.every(state => state.isTransaction === false), 'actual commit dispatcher must never await in a transaction');
  assert.ok(f.host.inspectTransactions().every(state => state.isOpen && !state.isTransaction));
});

test('deadline expiry after extraction returns retryable storage_busy with no admitted partial state', async t => {
  const f = fixture(t, { holdMs: 1000 });
  const result = await f.run(150);
  assert.deepEqual(result, { ok: false, error: { code: 'storage_busy', retryable: true } },
    'deadline expiry must return storage_busy with no partial state');
  assert.equal(f.calls.extract, 1, 'deadline must never replay the provider phase');
  assert.equal(f.calls.classify, 0);
  assert.deepEqual(ok(await f.core.list({ namespace: ns })).memories, [], 'deadline cannot expose a partial Memory');
  assert.ok(f.host.inspectTransactions().every(state => !state.isTransaction));
  await f.settled();
});

test('pause committed during admission backoff fences the detached Raw capture', async t => {
  const f = fixture(t, { raw: true, holdMs: 400, afterLock: ({ writer }) => {
    ok(writer.setCapturePaused({ namespace: ns, expectedGeneration: 'initial', paused: true }));
  } });
  const result = await f.run(); await f.settled();
  assert.equal(f.calls.extract, 1);
  assert.deepEqual(result, { ok: false, error: { code: 'capture_evidence_closed', retryable: false } },
    'pause guard must rerun during admission backoff');
  assert.deepEqual(ok(await f.core.list({ namespace: ns })).memories, []);
});

test('forget committed during placement backoff refuses with the existing index revision code', async t => {
  let forgotten;
  const f = fixture(t, { stage: 'classify', holdMs: 400, afterLock: ({ writer }) => {
    const memory = ok(writer.list({ namespace: ns })).memories[0]; forgotten = memory.id;
    ok(writer.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  } });
  const result = ok(await f.run()); await f.settled();
  assert.deepEqual(result.classification, { status: 'failed', error: { code: 'index_revision_conflict', retryable: false } },
    'forget guard must rerun during placement backoff');
  assert.equal(f.calls.extract, 1); assert.equal(f.calls.classify, 1);
  assert.equal((await f.core.get({ namespace: ns, memoryId: forgotten })).ok, false, 'retry must never resurrect forgotten content');
});

test('source suppression committed during admission backoff refuses the existing prepared source', async t => {
  const safety = safetyFixture(t); await safety.migrate();
  let source;
  const f = fixture(t, { path: safety.path, holdMs: 400, afterLock: () => {
    const db = safety.connect();
    try { transaction(db, () => writeContentSuppressionInside(db, { namespace: ns, kind: 'receipt', key: source,
      reason: 'user_forget', actionId: 'synthetic-backoff-suppression' })); } finally { db.close(); }
  } });
  const memory = ok(await f.core.admit({ namespace: ns, memory: { content: 'Synthetic source anchor', kind: 'fact' }, receipts: [receipt] })).memory;
  const db = safety.connect();
  try { source = db.prepare('SELECT id FROM receipts WHERE memory_id=?').get(memory.id).id; } finally { db.close(); }
  const result = await f.run(); await f.settled();
  assert.deepEqual(result, { ok: false, error: { code: 'source_excluded', retryable: false } },
    'suppression guard must rerun during admission backoff');
  assert.equal(f.calls.extract, 1); assert.equal(f.calls.classify, 0);
  const visible = ok(await f.core.list({ namespace: ns })).memories;
  assert.ok(visible.every(row => row.id === memory.id), 'suppressed source cannot admit a new Memory');
});
