import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { openRawCaptureCore } from '../../../core/raw-capture.mjs';
import { createCommitDispatcher } from '../../../core/commit-dispatch.mjs';
import { holdWriteLock, deferred } from './local-shared-support.mjs';
import { localPlainPort, request as rawRequest, splitRaw } from '../../../core/testing/raw-capture-fixtures.mjs';
import { setup as episodeFixture, input as episodeInput, interpretation, counts } from '../../../core/testing/episode-capture-helpers.mjs';
import { host as roleHost, publish } from '../../../core/test/role-fixture.mjs';
import { coreFixture, refresh, policy } from '../../../core/testing/context-read-core-fixture.mjs';
import { createFakeEmbedder } from '../../../core/context-read-embedder.mjs';

const ns = { ownerId: 'owner', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const joined = async lock => assert.deepEqual(await lock.exited, [0, null]);
const idle = host => assert.ok(host.inspectTransactions().every(state => state.isOpen && state.isTransaction === false));

for (const kind of ['Card', 'role']) for (const revoke of [false, true]) {
  test(`${kind} storage retry retains one grant; revoke=${revoke}`, async t => {
    const ws = createTestWorkspace(t, { prefix: 'commit-authority-' }), path = join(ws.path, 'store.sqlite');
    const trusted = roleHost(); let authorizations = 0, checks = 0, backoffs = 0;
    const authority = {
      authorize(...args) { authorizations++; return trusted.authority.authorize(...args); },
      isCurrent(...args) { checks++; return trusted.authority.isCurrent(...args); },
    };
    const host = createCommitDispatcher({ onBackoff() { backoffs++; if (revoke) trusted.revoke(); } });
    const core = host.open(() => openMemoryCore({ path, raw: false,
      ...(kind === 'Card' ? { privateCards: { version: 'private-cards-local-v1', source: 'submitted-note-v1',
        storage: 'local-plain-v1', disclosure: 'explicit-submitted-note-v1', authority } }
        : { roleProfiles: { ...trusted.options, authority } }) }));
    ws.defer(() => core.close());
    const lock = await holdWriteLock(t, path, 400);
    const call = kind === 'Card' ? () => core.createCardDraft({ namespace: ns, actionId: 'draft', drafting: 'authored',
      input: { title: 'Synthetic card', body: 'Synthetic body', authoredInput: { text: 'Synthetic source', occurredAt: null } } }, {})
      : () => core.publishRoleProfileRelease(publish(), {});
    const result = await host.run(call);
    await joined(lock);
    assert.ok(backoffs > 0);
    assert.equal(authorizations, 1, `${kind} original grant must be retained`);
    if (revoke) {
      assert.deepEqual(result, { ok: false, error: { code: 'scope_changed', retryable: false } },
        kind === 'Card' ? 'Card grant must be rechecked during backoff' : 'role grant must be rechecked during backoff');
      const retry = await host.run(call);
      assert.equal(retry.error.code, 'authority_required');
    } else {
      assert.equal(ok(result).revision ?? ok(result).registry.revision, 1);
      assert.ok(checks > 2, `${kind} currentness checks must rerun per attempt`);
    }
    // A fresh independent authority observes whether the refused action wrote.
    const observer = roleHost();
    const inspect = openMemoryCore({ path, raw: false,
      ...(kind === 'Card' ? { privateCards: { version: 'private-cards-local-v1', source: 'submitted-note-v1',
        storage: 'local-plain-v1', disclosure: 'explicit-submitted-note-v1', authority: observer.authority } }
        : { roleProfiles: observer.options }) });
    ws.defer(() => inspect.close());
    if (kind === 'Card') {
      const operation = ok(inspect.inspectCardOperation({ namespace: ns, operationActionId: 'draft' }, {}));
      assert.equal(operation.operation === null, revoke, 'revoked Card action cannot commit');
    } else {
      // The same initial CAS succeeds only if the refused release never existed.
      const next = inspect.publishRoleProfileRelease(publish(ns, 'finance', 'observer'), {});
      assert.equal(next.ok, revoke, 'revoked role action cannot commit');
    }
    idle(host);
  });
}

test('Raw-only commit retries detached sealing exactly once', async t => {
  const ws = createTestWorkspace(t, { prefix: 'commit-raw-' }), path = join(ws.path, 'store.sqlite');
  let seals = 0, lock;
  const plain = localPlainPort(), host = createCommitDispatcher();
  const port = { ...plain, async sealRaw(value) {
    seals++; const sealed = await plain.sealRaw(value);
    lock = await holdWriteLock(t, path, 400); return sealed;
  } };
  const core = host.open(() => openRawCaptureCore({ path }, { mode: 'raw-v1', interpretation: 'host', port,
    readPolicy: () => ({ generation: 'notice-1', reason: null }) }));
  ws.defer(() => core.close());
  const value = ok(await host.run(() => core.captureRaw(rawRequest(splitRaw('Synthetic Raw-only transaction')[0]))));
  assert.ok(value.raw); assert.equal(seals, 1, 'Raw-only retry must never repeat sealing');
  await joined(lock); idle(host);
});

test('Raw replay retries its observation without sealing or model replay', async t => {
  const ws = createTestWorkspace(t, { prefix: 'commit-replay-' }), path = join(ws.path, 'store.sqlite');
  let seals = 0, models = 0, waits = 0;
  const plain = localPlainPort(), host = createCommitDispatcher({ onBackoff() { waits++; } });
  const core = host.open(() => openRawCaptureCore({ path, model: { contextWindow: 8192, countTokens: () => 1,
    extract() { models++; return { items: [] }; } } }, { mode: 'raw-v1',
    port: { ...plain, sealRaw(value) { seals++; return plain.sealRaw(value); } },
    readPolicy: () => ({ generation: 'notice-1', reason: null }) }));
  ws.defer(() => core.close());
  const input = rawRequest(splitRaw('Synthetic replay transaction')[0]);
  const original = ok(await host.run(() => core.captureRaw(input)));
  const lock = await holdWriteLock(t, path, 400);
  const replay = ok(await host.run(() => core.captureRaw(input)));
  await joined(lock);
  assert.deepEqual(replay.raw, original.raw);
  assert.equal(ok(replay.interpretation).duplicate, true);
  assert.equal(seals, 1); assert.equal(models, 1); assert.ok(waits > 0); idle(host);
});

test('episode post-model commit retries without re-entering orchestration', async t => {
  let f, injected = false, backoffs = 0;
  const host = createCommitDispatcher({ strict: true, onBackoff() {
    backoffs++; f.db.exec('ROLLBACK');
  } });
  f = host.open(() => episodeFixture(t, { interpretEpisode: request => interpretation(request) }));
  // Lock the commit itself. A lock taken inside the provider instead refuses
  // callModel's later synchronous freshness check before commitDraft is reached.
  const original = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(sql) {
    const previous = Error.stackTraceLimit;
    let stack;
    try { Error.stackTraceLimit = 100; stack = new Error().stack; }
    finally { Error.stackTraceLimit = previous; }
    if (!injected && sql === 'BEGIN IMMEDIATE' && stack.includes('commitDraft')) {
      injected = true; f.db.exec('BEGIN IMMEDIATE');
    }
    return Reflect.apply(original, this, [sql]);
  };
  let captured;
  try { captured = await host.run(() => f.core.capture(episodeInput())); }
  finally {
    DatabaseSync.prototype.exec = original;
    if (f.db.isTransaction) f.db.exec('ROLLBACK');
  }
  assert.equal(captured.ok, true, 'episode orchestration must not become the retry boundary');
  const value = ok(captured);
  assert.ok(injected && backoffs >= 1, 'R2M_EPISODE_COMMIT_BUSY_OBSERVED');
  assert.equal(value.episode.status, 'interpreted', 'episode orchestration must not become the retry boundary: ' + JSON.stringify(value.episode));
  assert.equal(counts(f.model), 1, 'episode provider must stay at exactly 1 under backoff');
  const episode = ok(await f.core.getEpisode({ namespace: episodeInput().namespace, episodeId: value.episode.id }));
  assert.equal(episode.episode.processing.covered, 1); idle(host);
  assert.equal(host.inspectSynchronousWrites().count, 0);
});

test('context checkpoint and vector publication backoff embed exactly once', async t => {
  let f, lock, calls = 0, waits = 0;
  const observed = createCommitDispatcher({ onBackoff() { waits++; } });
  const base = createFakeEmbedder();
  const embedder = { ...base, async embed(texts, options) {
    calls++; options.beforeDispatch?.();
    lock = await holdWriteLock(t, f.path + '.context-read-v1.sqlite', 400);
    return base.embed(texts, options);
  } };
  f = observed.open(() => coreFixture(t, { embedder, selectedPolicy: policy() }));
  f.admit('apple');
  // Create the empty sidecar before taking its lock; then force a lexical
  // checkpoint under contention before the one provider publication.
  const first = ok(await observed.run(() => f.call('refreshContextIndex', refresh({ budget: { maxItems: 1, maxMs: 5000 } }))));
  assert.equal(first.progress.embeddingAttempts, 0);
  const lexicalLock = await holdWriteLock(t, f.path + '.context-read-v1.sqlite', 400);
  f.admit('pear');
  const result = ok(await observed.run(() => f.call('refreshContextIndex', refresh())));
  await joined(lexicalLock); await joined(lock);
  assert.equal(result.status, 'complete');
  assert.equal(calls, 1, 'context backoff must never repeat embedding');
  assert.ok(waits > 0); idle(observed);
});

for (const event of ['disconnect', 'revoke']) test(`${event} during backoff cannot commit`, async t => {
  const ws = createTestWorkspace(t, { prefix: 'commit-cancel-' }), path = join(ws.path, 'store.sqlite');
  const entered = deferred(), controller = new AbortController(); let revoked = false;
  const host = createCommitDispatcher({ onBackoff() { entered.resolve(); } });
  const core = host.open(() => openMemoryCore({ path, raw: false })); ws.defer(() => core.close());
  const lock = await holdWriteLock(t, path, 400);
  const pending = host.run(() => core.admit({ namespace: ns, memory: { content: 'Synthetic cancelled memory', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 's', eventId: 'e', role: 'user', excerpt: 'Synthetic cancelled memory' }] }),
  { signal: controller.signal, check() { if (revoked) throw Object.assign(Error('authority_required'), { code: 'authority_required' }); } });
  await entered.promise;
  if (event === 'disconnect') controller.abort();
  else { revoked = true; controller.abort(); }
  assert.equal((await pending).error.code, 'authority_required');
  await joined(lock);
  assert.deepEqual(ok(await core.list({ namespace: ns })).memories, [], 'nothing may commit after revocation');
  idle(host);
});
