import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import test from 'node:test';
import { join } from 'node:path';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

// Advance only the invocation clock, without scheduler/load-dependent sleeps.
globalThis.captureFacadeClock = { now: 0n, preparationMs: 0, starts: [] };
const hook = registerHooks({ load(url, context, next) {
  const result = next(url, context);
  if (!url.endsWith('/core/capture-deadline.mjs') && !url.endsWith('/core/raw-capture-storage.mjs')) return result;
  let source = result.source.toString();
  if (url.endsWith('/core/capture-deadline.mjs')) {
    const marker = 'const monotonicNow = process.hrtime.bigint;';
    assert.ok(source.includes(marker));
    source = source.replace(marker, 'const monotonicNow = () => globalThis.captureFacadeClock.now;');
    source = source.replace('const end = monotonicNow()',
      'globalThis.captureFacadeClock.starts.push(Number(monotonicNow()) / 1e6); const end = monotonicNow()');
  } else {
    const marker = "if (!['claude-code', 'codex'].includes(snapshot.client)) return null;";
    assert.ok(source.includes(marker));
    source = source.replace(marker, `if (!['claude-code', 'codex'].includes(snapshot.client)) {
      globalThis.captureFacadeClock.now += BigInt(globalThis.captureFacadeClock.preparationMs) * 1_000_000n;
      return null;
    }`);
  }
  return { ...result, source };
} });
const { openMemoryCore } = await import('../contract.mjs');
hook.deregister();
const clock = globalThis.captureFacadeClock;
const namespace = { ownerId: 'synthetic-facade-owner', scope: 'personal', projectId: null };
const request = id => ({ namespace, client: 'synthetic-client', eventId: id, sessionId: 'synthetic-session',
  messages: [{ id: `message-${id}`, role: 'user', content: `Synthetic ${id} capture source.` }] });
const scripted = () => ({ contextWindow: 8192, countTokens: () => 1,
  extract: ({ input }) => ({ items: [{ content: input.messages[0].content, kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }),
  classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }),
});
function fixture(t, model, extra = {}) {
  clock.now = 0n; clock.preparationMs = 0; clock.starts = [];
  const workspace = createTestWorkspace(t, { prefix: 'capture-facade-' });
  const core = openMemoryCore({ path: join(workspace.path, 'store.sqlite'), model,
    captureDeadlineMs: 500, rawSearch: false, ...(extra.rawConversations ? {} : { raw: true }), ...extra });
  workspace.defer(() => core.close());
  return core;
}

test('Memory-only capture includes preparation in the inner facade deadline and the next capture is independent', async t => {
  const model = scripted();
  let extracts = 0;
  const extract = model.extract;
  model.extract = value => { extracts++; clock.now += 200_000_000n; return extract(value); };
  const core = fixture(t, model);
  clock.preparationMs = 400;
  const result = await core.capture(request('expired'));
  assert.equal(result.error?.code, 'model_timeout', JSON.stringify(result));
  assert.equal(extracts, 1);
  assert.deepEqual(clock.starts, [0], 'the facade receives the original invocation budget');
  assert.deepEqual(core.list({ namespace }).value.memories, [], 'late extraction publishes nothing');
  clock.preparationMs = 0;
  const next = await core.capture(request('independent'));
  assert.equal(next.value?.classification.status, 'applied', JSON.stringify(next));
  assert.deepEqual(clock.starts, [0, 600], 'unrelated captures create their own deadline');
});

test('a capture started by a provider callback has its own private invocation budget', async t => {
  const model = scripted();
  let core, nested;
  model.extract = ({ input }) => {
    if (input.messages[0].content.includes('outer')) {
      clock.preparationMs = 0;
      nested = core.capture(request('nested'));
      clock.now += 200_000_000n;
    }
    return { items: [] };
  };
  core = fixture(t, model);
  clock.preparationMs = 400;
  const result = await core.capture(request('outer'));
  assert.equal(result.error?.code, 'model_timeout', JSON.stringify(result));
  assert.equal((await nested).ok, true, 'the nested invocation retains its own remaining budget');
  assert.deepEqual(clock.starts, [0, 400]);
});

for (const route of ['default', 'inner']) for (const shape of ['plain', 'frozen', 'request-data', 'expired']) {
  test(`public ${route} capture ignores a ${shape} second argument`, async t => {
    let forgedCalls = 0, extracts = 0, preflight = false;
    const model = scripted();
    model.countTokens = () => { if (preflight) { preflight = false; clock.now += 600_000_000n; } return 1; };
    model.extract = () => { extracts++; return { items: [] }; };
    const core = fixture(t, model, route === 'inner' ? {
      rawConversations: { mode: 'off', interpretation: 'host', readPolicy: () => ({ generation: 'synthetic', reason: null }) },
    } : {});
    const input = request(`${route}-${shape}`);
    const lookalike = { check() { forgedCalls++; }, expired() { forgedCalls++; return false; },
      remainingMs() { forgedCalls++; return 120000; } };
    const value = shape === 'frozen' ? Object.freeze(lookalike) : shape === 'request-data' ? input.messages[0]
      : shape === 'expired' ? { check() { forgedCalls++; throw new Error('forged expiry'); }, expired: () => true, remainingMs: () => 1 }
      : lookalike;
    preflight = shape !== 'expired';
    const result = await core.capture(input, value);
    if (shape === 'expired') assert.equal(result.ok, true, JSON.stringify(result));
    else {
      assert.equal(result.error?.code, 'model_timeout', JSON.stringify(result));
      assert.equal(extracts, 0, 'the configured deadline rejects before provider dispatch');
    }
    assert.equal(forgedCalls, 0, 'untrusted second arguments are opaque');
    assert.deepEqual(clock.starts, [0]);
  });
}

test('Memory-only failed classification delivers only the closed-capture control after commit and close', async t => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const model = scripted();
  model.classify = () => new Promise(resolve => { release = resolve; entered(); });
  const core = fixture(t, model);
  const pending = core.capture(request('closed'));
  await Promise.race([started, pending.then(value => { throw new Error('capture settled before classifier: ' + JSON.stringify(value)); })]);
  core.close();
  release({ items: [] });
  const result = await pending;
  assert.deepEqual(result, { ok: true, value: { classification: { status: 'failed' } } });
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.value) && Object.isFrozen(result.value.classification));
  assert.doesNotMatch(JSON.stringify(result), /Synthetic|memory|receipt|admission|revision/);
});
