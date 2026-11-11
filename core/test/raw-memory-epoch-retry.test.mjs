import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Trace the actual checks, without replacing their implementations. Install
// before dynamically loading the engine; each test gets a fresh trace.
let checks = [];
globalThis.traceMemoryEpochCheck = name => checks.push(name);
const hooks = registerHooks({ load(url, context, next) {
  const result = next(url, context);
  const markers = url.endsWith('/core/raw-journal.mjs') ? [
    ['async function prepareRegistration(request) {', 'validate-registration'],
    ['function policy(input) {', 'policy-and-authority'],
    ['function durableFence(ns, client, session) {', 'controls-deletion-fences'],
    ['function assertRegistrationSources(input, conversationId) {', 'sources'],
    ['function validateMessage(id, message, shadow) {', 'message-order-and-parts'],
    ['function commitInside(value) {', 'commit-revision'],
  ] : url.endsWith('/core/raw-capture-storage.mjs') ? [
    ['const managed = options.localAuthority;', 'prepare-profile-and-privacy'],
    ['const previous = binding(input);', 'binding'],
    ['const token = await journal.prepareRegistration(input);', 'projection'],
  ] : [];
  if (!markers.length) return result;
  let source = typeof result.source === 'string' ? result.source : Buffer.from(result.source).toString();
  for (const [marker, name] of markers) {
    assert.ok(source.includes(marker), marker);
    source = source.replace(marker, marker + ` globalThis.traceMemoryEpochCheck(${JSON.stringify(name)});`);
  }
  return { ...result, source };
} });
const { fixture, ns, request, splitRaw, localPlainPort, ok, count } = await import('../testing/raw-capture-fixtures.mjs');
const { openMemoryStore } = await import('../index.mjs');
const { openRawCaptureCore } = await import('../raw-capture.mjs');
hooks.deregister();

const memoryInput = id => ({ content: 'Synthetic independent Memory ' + id, kind: 'fact', receipt: {
  client: 'synthetic', sessionId: 'memory-writer', eventId: id, role: 'user', excerpt: 'Synthetic independent evidence',
} });
const batch = (id, ordinal) => request(splitRaw('Synthetic capture ' + id, { id, ordinal })[0], { eventId: id });

for (const write of ['remember', 'forget', 'index-publish']) test(`${write} between preparation and commit reruns all capture checks`, async t => {
  let seals = 0, active = false, mutate;
  const port = localPlainPort(), seal = port.sealRaw;
  port.sealRaw = async value => { if (active && ++seals === 1) mutate(); return seal(value); };
  const f = fixture(t);
  const store = openMemoryStore({ path: f.path }), memory = store.scope({ ownerId: ns.ownerId });
  f.workspace.defer(() => store.close());
  const core = openRawCaptureCore({ path: f.path }, { mode: 'raw-v1', interpretation: 'host', port,
    readPolicy: () => ({ generation: 'notice-1', reason: null }) });
  f.workspace.defer(() => core.close());
  ok(await core.captureRaw(batch('seed', 1)));
  const target = memory.remember(memoryInput('forget-target'));
  const epoch = () => f.db.prepare('SELECT epoch FROM namespace_epochs WHERE owner_id=? AND scope=? AND project_id=?')
    .get(ns.ownerId, ns.scope, ns.projectId ?? '').epoch;
  const before = epoch();
  mutate = () => {
    assert.equal(f.db.isTransaction, false);
    if (write === 'remember') memory.remember(memoryInput('remember-race'));
    if (write === 'forget') assert.equal(memory.forget(target.id, target.revision), true);
    if (write === 'index-publish') assert.equal(ok(core.rebuildIndex({ namespace: ns, expectedIndexRevision: epoch(), limit: 500 })).state, 'published');
    assert.equal(epoch(), before + 1, 'the public Memory write really advances the same namespace epoch');
  };
  checks = []; active = true;
  const result = ok(await core.captureRaw(batch('racing', 2)));
  assert.equal(result.raw.parts[0].saved, true); assert.equal(seals, 2);
  const frequencies = Object.fromEntries([...new Set(checks)].map(name => [name, checks.filter(check => check === name).length]));
  assert.deepEqual(frequencies, {
    'prepare-profile-and-privacy': 2, binding: 2, projection: 2, 'validate-registration': 2,
    'policy-and-authority': 4, 'controls-deletion-fences': 4, sources: 4,
    'message-order-and-parts': 3, 'commit-revision': 2,
  });
  t.diagnostic(JSON.stringify({ write, checks: frequencies }));
  assert.equal(count(f.db, 'raw_events'), 2); assert.equal(count(f.db, 'raw_parts'), 2);
  assert.equal(count(f.db, 'raw_capture_events'), 2);
  assert.deepEqual(ok(await core.captureRaw(batch('racing', 2))).raw, result.raw);
  assert.equal(count(f.db, 'raw_events'), 2); assert.equal(count(f.db, 'raw_parts'), 2);
  assert.equal(count(f.db, 'memories'), write === 'remember' ? 2 : 1);
});

for (const barrier of ['policy', 'client', 'pause', 'session', 'revision', 'invalid-input']) test(`Memory retry rechecks ${barrier} on its second preparation`, async t => {
  let f, memory, active = false, seals = 0;
  const port = localPlainPort(), seal = port.sealRaw;
  const input = batch('racing', 2);
  port.sealRaw = async value => {
    if (active && ++seals === 1) {
      memory.remember(memoryInput('barrier-' + barrier));
      if (barrier === 'invalid-input') input.messages[0].part.totalBytes++;
    } else if (active && seals === 2) {
      if (barrier === 'policy') f.policy.generation = 'revoked';
      if (barrier === 'client') ok(f.core.setRawCaptureControl({ ownerId: ns.ownerId, client: 'claude-code', enabled: false, expectedRevision: 0 }));
      if (barrier === 'pause') ok(f.core.setCapturePaused({ namespace: ns, expectedGeneration: 'initial', paused: true }));
      if (barrier === 'session') ok(f.core.fenceSession({ namespace: ns, client: 'claude-code', sessionId: input.sessionId }));
      if (barrier === 'revision') f.db.prepare('UPDATE raw_conversations SET revision=revision+1').run();
    }
    return seal(value);
  };
  f = fixture(t, { port });
  const store = openMemoryStore({ path: f.path }); memory = store.scope({ ownerId: ns.ownerId }); f.workspace.defer(() => store.close());
  ok(await f.core.captureRaw(batch('seed', 1))); active = true;
  const result = await f.core.captureRaw(input);
  assert.deepEqual(result, { ok: false, error: { code: barrier === 'pause' ? 'capture_disabled' :
    barrier === 'session' ? 'conversation_deleted' : barrier === 'invalid-input' ? 'event_payload_conflict' : 'revision_conflict', retryable: false } });
  assert.equal(seals, barrier === 'invalid-input' ? 1 : 2);
  assert.equal(count(f.db, 'raw_events'), 1); assert.equal(count(f.db, 'raw_parts'), 1);
});
