import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/client';
import { StdioServerTransport } from '@modelcontextprotocol/server/stdio';
import { buildCairnServer } from '../server.mjs';
import { setTimeout as delay } from 'node:timers/promises';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createCommitDispatcher, bindCommitConnection, inCommitDelivery } from '../../../core/commit-dispatch.mjs';
import { createLocalSharedRuntime } from '../local-shared-runtime.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { openRawCaptureCore } from '../../../core/raw-capture.mjs';
import { localPlainPort, request as rawRequest, splitRaw } from '../../../core/testing/raw-capture-fixtures.mjs';
import { safetyFixture } from '../../../core/testing/content-safety-s2h-fixture.mjs';
import { cardHost } from '../../../core/testing/raw-source-fixtures.mjs';
import { writeContentSuppressionInside, cachedContentSuppressionRequestInside } from '../../../core/content-suppression-storage.mjs';
import { transaction } from '../../../core/database.mjs';
import { fixture as sidecarFixture, request as sidecarRequest } from '../../../core/testing/context-read-fixture.mjs';
import { setup as episodeFixture, input as episodeInput } from '../../../core/testing/episode-capture-helpers.mjs';
import { seed } from './fixtures/episode-server.mjs';
import { ns, ok, call, connect, holdWriteLock, streams } from './local-shared-support.mjs';

const text = 'Synthetic slow cobalt telescope preference';
const capture = { namespace: ns, client: 'synthetic', sessionId: 'slow-session', eventId: 'slow-batch',
  messages: [{ id: 'slow-message', role: 'user', content: text }] };
const extraction = () => ({ items: [{ content: text, kind: 'preference', confidence: .8, sourceIndices: [0] }] });
// Dispatcher/facade frames must not hide the actual storage or model seam.
function callStack() {
  const previous = Error.stackTraceLimit;
  try { Error.stackTraceLimit = 100; return new Error().stack; }
  finally { Error.stackTraceLimit = previous; }
}
function hostCore(t, options, dispatchOptions = {}) {
  const workspace = createTestWorkspace(t);
  const path = options.path ?? join(workspace.path, 'review.sqlite');
  const host = createCommitDispatcher({ strict: true, ...dispatchOptions });
  const core = host.open(() => openMemoryCore({ path, raw: false, ...options }));
  workspace.defer(() => core.close());
  return { host, core, path };
}

test('P1-1: an unconfigured deadline permits slow extraction and slow classification', { timeout: 20000 }, async t => {
  const counts = { extract: 0, classify: 0 };
  const base = rationaleModel();
  const model = { ...base, async extract() { counts.extract++; await delay(5200); return extraction(); },
    async classify(request) { counts.classify++; await delay(5200); return base.classify(request); } };
  const w = createTestWorkspace(t), host = createLocalSharedRuntime({ path: join(w.path, 'slow.sqlite'), namespace: ns,
    raw: false, contextRead: false, captureQualification: 'source-bound-v2', model }, { strict: true });
  w.defer(() => host.close());
  const { client } = await connect(t, host);
  const result = ok(await call(client, 'capture_memory', { batchId: 'slow', messages: capture.messages.map(({ role, content }) => ({ role, content })) }));
  assert.equal(result.classification.status, 'applied', 'R2I_SLOW_PROVIDER_ADMITTED');
  assert.equal(result.admission.memories.length, 1); assert.deepEqual(counts, { extract: 1, classify: 1 });
});

test('P1-2: provider timeout abandons the claim and a same-batch retry is not processing', { timeout: 10000 }, async t => {
  let calls = 0;
  const f = hostCore(t, { captureDeadlineMs: 40, captureEvidence: 'staged-v1', captureQualification: 'source-bound-v2',
    model: { ...rationaleModel(), async extract() { if (++calls === 1) await delay(100); return { items: [] }; } } });
  const failed = await f.core.capture(capture);
  assert.equal(failed.error.code, 'model_timeout');
  const observer = new DatabaseSync(f.path);
  try {
    const row = observer.prepare('SELECT lease_expires_at FROM admission_claims WHERE event_id=?').get(capture.eventId);
    assert.equal(row.lease_expires_at, 0, 'R2I_CLEANUP_RELEASED');
  } finally { observer.close(); }
  const retry = await f.core.capture(capture);
  assert.notEqual(retry.value?.processing, true, 'R2I_SAME_BATCH_RECLAIMABLE');
});

test('P1-2: deadline exhausted under a lock still releases its admission lease', { timeout: 10000 }, async t => {
  let lock;
  const f = hostCore(t, { model: { ...rationaleModel(), async extract() {
    lock = await holdWriteLock(t, f.path, 350); return extraction();
  } } });
  const refused = await f.host.run(() => f.core.capture(capture), { deadlineAt: performance.now() + 100 });
  assert.equal(refused.error.code, 'storage_busy');
  assert.deepEqual(await lock.exited, [0, null]);
  const retry = ok(await f.core.capture(capture));
  assert.notEqual(retry.processing, true, 'R2I_SAME_BATCH_RECLAIMABLE');
});

test('P1-3: epoch bump during Raw sealing re-prepares without a lock-contention retry', { timeout: 10000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'raw-epoch.sqlite'), plain = localPlainPort();
  let seals = 0, backoffs = 0, writer;
  const input = rawRequest(splitRaw('Synthetic epoch source')[0]);
  const host = createCommitDispatcher({ strict: true, onBackoff() { backoffs++; } });
  const core = host.open(() => openRawCaptureCore({ path, model: { ...rationaleModel(), extract: () => ({ items: [] }) } },
    { mode: 'raw-v1', port: { ...plain, async sealRaw(value) {
      const sealed = await plain.sealRaw(value);
      if (++seals === 1) ok(writer.admit({ namespace: input.namespace,
        memory: { content: 'Synthetic concurrent epoch bump', kind: 'fact' }, receipts: [{ client: 'synthetic',
          sessionId: 'epoch', eventId: 'epoch', role: 'user', excerpt: 'Synthetic concurrent epoch bump' }] }));
      return sealed;
    } }, readPolicy: () => ({ generation: 'notice-1', reason: null }) }));
  writer = openMemoryCore({ path, raw: false });
  w.defer(() => { core.close(); writer.close(); });
  const value = ok(await core.captureRaw(input));
  assert.ok(value.raw); assert.ok(seals > 1 && seals <= 4);
  assert.equal(backoffs, 0, 'R2I_EPOCH_REPREPARED');
});

for (const operation of ['foreign-inspect', 'forget', 'attach']) test(`P1-4: EXCLUSIVE writer blocks readers during ${operation}`, { timeout: 15000 }, async t => {
  const w = createTestWorkspace(t), path = join(w.path, 'exclusive.sqlite');
  const foreign = await seed(path, { ns, client: 'claude-code', count: 1 });
  const own = await seed(path, { ns, client: 'codex', count: 1 });
  const holder = new DatabaseSync(path); let backoffs = 0;
  const host = createLocalSharedRuntime({ path, namespace: ns, raw: false, contextRead: false,
    sessionEpisodesAccess: 'episode-v1', readClient: 'codex' }, { strict: true, onBackoff() {
      if (holder.isTransaction) { backoffs++; holder.exec('ROLLBACK'); }
    } });
  w.defer(() => host.close());
  w.defer(() => { if (holder.isTransaction) holder.exec('ROLLBACK'); holder.close(); });
  const existing = await connect(t, host);
  const inspected = ok(await call(existing.client, 'inspect_session_episode', { episodeId: own.ids[0] }));
  holder.exec('BEGIN EXCLUSIVE');
  if (operation === 'foreign-inspect') {
    const result = await call(existing.client, 'inspect_session_episode', { episodeId: foreign.ids[0] });
    assert.equal(result.error?.code, 'episode_not_found', 'R2I_FOREIGN_EPISODE_DENIED');
  } else if (operation === 'forget') {
    ok(await call(existing.client, 'forget_session_episode', { episodeId: own.ids[0], expectedRevision: inspected.episode.revision }));
    const result = await call(existing.client, 'inspect_session_episode', { episodeId: own.ids[0] });
    assert.equal(result.error?.code, 'episode_not_found', 'R2I_EPISODE_ACTUALLY_FORGOTTEN');
  } else {
    const attached = await connect(t, host);
    assert.ok((await attached.client.listTools()).tools.some(tool => tool.name === 'remember_memory'), 'R2I_ATTACH_GETS_TOOLS');
  }
  assert.ok(backoffs >= 1, 'R2K_EXCLUSIVE_BUSY_OBSERVED');
  assert.equal(holder.isTransaction, false);
});

test('Card delivery keeps the retry account through its final successful facade fence', { timeout: 10000 }, async t => {
  const f = safetyFixture(t, 23); await f.migrate();
  const authority = cardHost(), writer = f.connect();
  let tracking = false, native, activeAttempt = false, selectedProof, backoffs = 0;
  const fences = [], contractFences = [], traces = [];
  const exec = DatabaseSync.prototype.exec, prepare = DatabaseSync.prototype.prepare;
  t.mock.method(DatabaseSync.prototype, 'exec', function(sql) {
    if (tracking && sql === 'PRAGMA busy_timeout = 5') { native = this; activeAttempt = true; }
    if (tracking && activeAttempt && this === native && sql === 'COMMIT') {
      const proof = cachedContentSuppressionRequestInside(this, ns.ownerId);
      if (proof) selectedProof = proof;
    }
    const value = Reflect.apply(exec, this, [sql]);
    if (tracking && this === native && sql === 'PRAGMA busy_timeout = 5000') activeAttempt = false;
    return value;
  });
  t.mock.method(DatabaseSync.prototype, 'prepare', function(sql) {
    const stack = callStack();
    if (tracking && sql.includes('SELECT epoch_hi,epoch_lo FROM owner_suppression_epochs') && stack.includes('inCommitDelivery')) {
      const proof = cachedContentSuppressionRequestInside(this, ns.ownerId);
      fences.push(proof);
      if (stack.includes('/core/contract.mjs:') && stack.includes('assertContentScope')) contractFences.push(proof);
      traces.push(stack);
    }
    return Reflect.apply(prepare, this, [sql]);
  });
  const host = createCommitDispatcher({ strict: true, onBackoff() { backoffs++; writer.exec('ROLLBACK'); } });
  const core = host.open(() => openMemoryCore({ path: f.path, raw: false, privateCards: authority.options }));
  t.after(async () => { if (writer.isTransaction) writer.exec('ROLLBACK'); await core.close(); writer.close(); });
  const card = ok(await authority.call(core, 'createCardDraft', { namespace: ns, actionId: 'successful-delivery-card', drafting: 'authored',
    input: { title: 'Synthetic account identity Card', body: 'Synthetic successful body', authoredInput: { text: 'Synthetic source', occurredAt: null } } }));
  writer.exec('BEGIN IMMEDIATE'); tracking = true;
  const result = await authority.call(core, 'getCard', { namespace: ns, cardId: card.id });
  tracking = false;
  assert.equal(ok(result).card.body, 'Synthetic successful body');
  assert.ok(backoffs >= 1);
  t.diagnostic('R2O_D5_ACCOUNT_TRACE ' + JSON.stringify({ traces, fenceMatches: fences.map(proof => proof === selectedProof),
    finalMatches: contractFences.map(proof => proof === selectedProof) }));
  assert.ok(selectedProof && fences.includes(selectedProof), 'R2K_CARD_ACCOUNT_HANDOFF');
  assert.ok(contractFences.includes(selectedProof), 'R2N_CARD_DELIVERY_2');
});

for (const handoff of ['core', 'mcp']) for (const raw of [false, true]) for (const depth of [1, 2, 3, 'immediate']) for (const kind of ['card', 'source', 'unrelated']) test(`P1-5: ${kind} suppression at delivery depth ${depth} refuses the body raw=${raw} handoff=${handoff}`, { timeout: 10000 }, async t => {
  const f = safetyFixture(t, raw ? 33 : 23); await f.migrate();
  const authority = cardHost(), writer = f.connect();
  let armed = false, suppressed = false, backoffs = 0, finalSuppression;
  let target;
  const host = createCommitDispatcher({ strict: true, onBackoff() { backoffs++; writer.exec('ROLLBACK'); }, onAwait({ point }) {
    if (armed && point === 'return') {
      armed = false;
      const suppress = () => {
        transaction(writer, () => writeContentSuppressionInside(writer, { namespace: ns, ...target,
          reason: 'user_forget', actionId: 'synthetic-delivery-forget' }));
        suppressed = true;
      };
      const schedule = left => left === 0 ? suppress() : queueMicrotask(() => schedule(left - 1));
      if (raw && depth === 2) finalSuppression = () => schedule(2);
      else if (depth === 'immediate') setImmediate(suppress);
      else schedule(depth);
    }
  } });
  // Model an event-loop yield immediately before the outer facade's delivery
  // reaction. Only that reaction is delayed; suppression still starts from the
  // successful attempt, and the production delivery fence runs afterwards.
  let boundaryDeliveries = 0;
  const nativeThen = Promise.prototype.then;
  if (depth === 'immediate' || raw && depth === 2) t.mock.method(Promise.prototype, 'then', function(fulfilled, rejected) {
    const stack = callStack();
    if (armed && fulfilled?.name === 'deliver' && stack.includes('/content-safety-boundary.mjs:') && ++boundaryDeliveries === (raw ? 4 : 3)) {
      const finalDelivery = fulfilled;
      fulfilled = async value => {
        if (raw && depth === 2) {
          // Exercise the gap after the inner Card fence and before Raw delivery.
          finalSuppression();
          await new Promise(resolve => queueMicrotask(() => queueMicrotask(resolve)));
        } else await new Promise(resolve => setImmediate(resolve));
        return finalDelivery(value);
      };
    }
    return Reflect.apply(nativeThen, this, [fulfilled, rejected]);
  });
  const core = host.open(() => openMemoryCore({ path: f.path, raw, privateCards: authority.options }));
  t.after(async () => { if (writer.isTransaction) writer.exec('ROLLBACK'); await core.close(); writer.close(); });
  const card = ok(await authority.call(core, 'createCardDraft', { namespace: ns, actionId: 'delivery-card', drafting: 'authored',
    input: { title: 'Synthetic retained Card', body: 'Synthetic private body', authoredInput: { text: 'Synthetic source', occurredAt: null } } }));
  target = kind === 'card' ? { kind: 'card', key: card.id }
    : kind === 'source' ? { kind: 'submitted-note', key: writer.prepare('SELECT id FROM card_notes').get().id }
      : { kind: 'memory', key: 'synthetic-unrelated-memory' };
  let read = () => authority.call(core, 'getCard', { namespace: ns, cardId: card.id });
  if (handoff === 'mcp') {
    const server = buildCairnServer({ path: f.path, binding: ns, core, maintenance: false, ownsCore: false,
      cards: { call: (core, method, input) => authority.call(core, method, { ...input, namespace: ns }), revoke() {} },
      lifecycle: { run: work => host.run(work) } });
    const [serverSide, clientSide] = streams(), client = new Client({ name: 'synthetic-card-delivery', version: '1' });
    t.after(async () => { await client.close(); await server.close(); serverSide.destroy(); clientSide.destroy(); });
    await server.connect(new StdioServerTransport(serverSide, serverSide));
    await client.connect(new StdioServerTransport(clientSide, clientSide));
    read = () => call(client, 'inspect_private_card', { cardId: card.id });
  }
  const readable = ok(await read());
  assert.equal(readable.card.body, 'Synthetic private body', 'control: the retained body is readable before suppression');
  writer.exec('BEGIN IMMEDIATE'); armed = true;
  const result = await read();
  assert.ok(backoffs > 0 && suppressed, 'suppression commits before the public result');
  if (depth === 'immediate' || raw && depth === 2) assert.equal(boundaryDeliveries, raw ? 4 : 3, 'delay exactly the final public delivery reaction');
  t.diagnostic('R2M_CARD_HANDOFF ' + JSON.stringify({ handoff, raw, kind, depth, ok: result.ok,
    bodyReturned: JSON.stringify(result).includes('Synthetic private body') }));
  assert.equal(result.error?.code, 'evidence_unavailable', `${kind === 'unrelated' ? 'R2K_CARD_ACCOUNT_HANDOFF' : 'R2I_CARD_DELIVERY_FENCE'} R2N_CARD_DELIVERY_${depth} ${raw ? 'R2O_RAW_CARD_DELIVERY' : ''}`);
  assert.doesNotMatch(JSON.stringify(result), /Synthetic private body/, 'R2M_SUPPRESSED_CARD_BODY_REFUSED');
});

test('P2-1: a reconcile commits its tail after its cooperative budget expires', { timeout: 10000 }, async t => {
  const f = sidecarFixture(t); for (let i = 0; i < 4; i++) f.admit('Synthetic budget document ' + i);
  f.db.exec('PRAGMA busy_timeout=5000');
  const host = createCommitDispatcher({ strict: true }); host.open(() => bindCommitConnection(f.db));
  const side = f.index();
  const originalPrepare = DatabaseSync.prototype.prepare, originalNow = performance.now;
  let expired = false, offset = 0;
  DatabaseSync.prototype.prepare = function(sql) {
    const statement = Reflect.apply(originalPrepare, this, [sql]);
    if (this === f.db && sql.includes('content AS text')) {
      const get = statement.get.bind(statement);
      statement.get = (...args) => { const value = get(...args); expired = true; offset = 100; return value; };
    }
    return statement;
  };
  performance.now = () => Reflect.apply(originalNow, performance, []) + offset;
  let result;
  try { result = await side.reconcileAsync(sidecarRequest({ budget: { maxItems: 1024, maxMs: 20 } })); }
  finally { DatabaseSync.prototype.prepare = originalPrepare; performance.now = originalNow; }
  assert.ok(expired); assert.equal(result.status, 'rebuilding', 'R2I_RECONCILE_TAIL');
  assert.ok(result.progress.checkpoint > 0);
  const observer = new DatabaseSync(f.path + '.context-read-v1.sqlite', { readOnly: true });
  try { assert.ok(observer.prepare('SELECT count(*) AS n FROM documents').get().n > 0); }
  finally { observer.close(); }
});

test('P2-2: capture pre-provider freshness refusal leaves staged evidence reclaimable', { timeout: 10000 }, async t => {
  const safety = safetyFixture(t); await safety.migrate();
  let armed = false, injected = false, providers = 0;
  const model = { ...rationaleModel(), countTokens() {
    if (!injected && callStack().includes('/model-call.mjs')) armed = true;
    return 1;
  }, extract() { providers++; return { items: [] }; } };
  const f = hostCore(t, { path: safety.path, model, captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' });
  const original = DatabaseSync.prototype.exec;
  DatabaseSync.prototype.exec = function(sql) {
    const stack = callStack();
    if (armed && !injected && sql.startsWith('BEGIN') &&
        (stack.includes('captureSourceRead') || stack.includes('assertContentScope'))) {
      injected = true; armed = false;
      throw Object.assign(Error('synthetic busy'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
    }
    return Reflect.apply(original, this, [sql]);
  };
  let result;
  try { result = await f.core.capture(capture); }
  finally { DatabaseSync.prototype.exec = original; }
  assert.ok(injected); assert.equal(providers, 0); assert.equal(result.error?.code, 'storage_busy');
  const retry = ok(await f.core.capture(capture));
  assert.notEqual(retry.processing, true, 'R2I_PREFLIGHT_RECLAIMABLE');
});

test('P2-2: an episode freshness BUSY before the provider leaves no consumed attempt', { timeout: 10000 }, async t => {
  let armed = false, injected = false, providers = 0;
  const host = createCommitDispatcher({ strict: true });
  const f = host.open(() => episodeFixture(t, { countTokens(text) {
    if (!injected && text.includes('classificationTarget') && new Error().stack.includes('/model-call.mjs')) armed = true;
    return 1;
  }, interpretEpisode() { providers++; throw Error('synthetic provider must not run'); } }));
  const original = DatabaseSync.prototype.prepare;
  DatabaseSync.prototype.prepare = function(sql) {
    if (armed && !injected && new Error().stack.includes('episodeDraftSnapshot')) {
      injected = true; armed = false;
      throw Object.assign(Error('synthetic busy'), { code: 'ERR_SQLITE_ERROR', errcode: 5 });
    }
    return Reflect.apply(original, this, [sql]);
  };
  let result;
  try { result = ok(await f.core.capture(episodeInput())); }
  finally { DatabaseSync.prototype.prepare = original; }
  assert.ok(injected); assert.equal(providers, 0);
  assert.equal(result.episode.error.code, 'storage_busy'); assert.equal(result.episode.error.retryable, true);
  assert.equal(f.db.prepare('SELECT count(*) AS n FROM episode_attempts').get().n, 0, 'R2I_EPISODE_NOT_STARTED');
});
