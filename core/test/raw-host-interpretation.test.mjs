import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { openMemoryCore } from '../contract.mjs';
import { createRawCaptureStorage } from '../raw-capture-storage.mjs';
import { createRawLineageStorage } from '../raw-lineage-storage.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { interpretation } from '../testing/episode-capture-helpers.mjs';
import { fixture, config, ns, request, splitRaw, localPlainPort, ok, count, usage } from '../testing/raw-capture-fixtures.mjs';

const rawOptions = patch => ({ mode: 'raw-v1', capBytes: 200000000, port: localPlainPort(),
  readPolicy: () => ({ generation: 'notice-1', reason: null }), interpretation: 'host', ...patch });
const denied = (result, code) => assert.deepEqual(result, { ok: false, error: { code, retryable: false } });
const empty = { ok: true, value: { status: 'not-run', reason: 'no-eligible-first-part' } };
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
// Frozen engine bindings recorded before host interpretation was introduced.
const engineBindings = {
  ordinary: {
    unmanaged: 'b0af8fff1a56bf166c5dfb54608bf0b4a94d70fc6534a0905b2826899ff5831b',
    managed: '46111850552974b4fb29925a1a6a12caef2f3fb9dc4207193db9efadf89100d2',
  },
  staged: {
    unmanaged: '24ee851aa8fdc8326d5f0e9c501951a3856ad78f1df85abfbd76540a5aea4b04',
    managed: '73c68e5cbac1bdfb16d5590119c207da78854b4f07a4b300d3969bf7d144e246',
  },
  episode: {
    unmanaged: '5514778d99fbc5306b5331873b2d69186a79f9c5f8990acd760ff1876b668f63',
    managed: '6dedcd0f0c78de473cd1814c0f71768fd014df0a80930239332f683cdb4c3ce7',
  },
};
function hostFixture(t, { kind = 'ordinary', raw = {}, coreOptions = {}, model = {}, omitInterpretation = false } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'raw-host-' }), path = join(workspace.path, 'store.sqlite');
  const calls = [], base = { ...rationaleModel(), interpretEpisode: interpretation, ...model };
  const portModel = Object.fromEntries(Object.entries(base).map(([name, value]) => [name,
    typeof value === 'function' ? (...args) => { calls.push(name); return value(...args); } : value]));
  let core;
  const options = rawOptions(raw);
  if (omitInterpretation) delete options.interpretation;
  const reopen = (patch = {}) => {
    core?.close();
    core = openMemoryCore({ path, model: portModel, ...config(kind), ...coreOptions,
      rawConversations: { ...options, ...patch } });
    return core;
  };
  reopen(); workspace.defer(() => core.close());
  const db = new DatabaseSync(path); db.exec('PRAGMA foreign_keys=ON'); workspace.defer(() => db.close());
  return { path, db, calls, reopen, get core() { return core; } };
}
function grantAuthority(f, client) {
  const current = ok(f.core.getLocalCaptureControl({ namespace: ns, client }));
  const granted = ok(f.core.setLocalCaptureControl({ namespace: ns, client, targetId: 'synthetic-target',
    expectedStoreId: current.storeId, expectedRevision: current.revision,
    automaticCaptureEnabled: true, rawNoticeVersion: 'local-plain-v1' }));
  return { version: 'local-capture-authority-v1', targetId: granted.targetId, storeId: granted.storeId,
    namespace: { ...ns, projectId: ns.projectId ?? '' }, client,
    expectedControlRevision: granted.revision, expectedConsentGeneration: granted.consentGeneration,
    expectedNamespaceGeneration: 'initial', expectedRawRevision: 0 };
}
const noInterpretation = f => {
  assert.deepEqual(f.calls, []);
  for (const table of ['staged_capture_evidence', 'admission_claims', 'episode_events', 'session_episodes',
    'memories', 'receipts', 'raw_source_maps']) assert.equal(count(f.db, table), 0, table);
  for (const row of f.db.prepare('SELECT staging,eligible_message_ids FROM raw_capture_events').all()) {
    assert.equal(row.staging, 'none'); assert.equal(row.eligible_message_ids, '[]');
  }
};

for (const kind of ['ordinary', 'staged', 'episode']) test(`host ${kind}: eligible batch registers exact Raw with no interpretation`, async t => {
  const f = hostFixture(t, { kind });
  const text = 'Synthetic Ａ 😀 source', first = splitRaw(text)[0];
  const second = splitRaw('Synthetic second source', { id: 'second', ordinal: 2, role: 'assistant' })[0];
  const source = request(first, { messages: [first, second] }, kind);
  const result = ok(await f.core.captureRaw(source));
  assert.deepEqual(result.interpretation, empty);
  assert.equal(count(f.db, 'raw_conversations'), 1);
  for (const table of ['raw_parts', 'raw_messages']) assert.equal(count(f.db, table), 2);
  assert.equal(count(f.db, 'raw_events'), 1); assert.equal(count(f.db, 'raw_capture_events'), 1);
  const binding = f.db.prepare('SELECT * FROM raw_capture_events').get();
  assert.equal(binding.binding_digest, hash(['raw-capture-host-v1', engineBindings[kind].unmanaged]));
  const identity = [binding.session_key, source.eventId, JSON.parse(binding.first_message_ids), binding.binding_digest];
  assert.equal(binding.projection_digest, hash(['raw-capture-host-empty-v1', ...identity]));
  assert.notEqual(binding.projection_digest, hash(['raw-capture-empty-v1', ...identity]));
  assert.ok(result.raw.parts.every(part => part.saved && part.reason === null));
  assert.equal(usage(f.core).savedBytes, Buffer.byteLength(text + second.content));
  assert.equal(usage(f.core).reservedBytes, 0);
  const page = ok(await f.core.getConversation({ namespace: ns, conversationId: result.raw.conversationId }));
  assert.deepEqual(page.messages.map(message => message.parts[0].text), [text, second.content]);
  const before = usage(f.core);
  assert.deepEqual(ok(await f.core.captureRaw(source)), result);
  f.reopen();
  assert.deepEqual(ok(await f.core.captureRaw(source)), result);
  assert.deepEqual(usage(f.core), before);
  noInterpretation(f);
  // Host archives take the existing no-maps, whole-message receipt path.
  const anchors = [];
  createRawLineageStorage(f.db).assertReceipts(ns, [{ client: source.client, sessionId: source.sessionId,
    eventId: first.id, role: first.role, excerpt: 'Synthetic' }], false, anchors);
  assert.deepEqual(anchors, [{ conversationId: result.raw.conversationId, messageId: first.id,
    start: 0, end: text.length, precision: 'whole-message' }]);
});

test('host multipart reservations, continuation and overlap retain identity and charge once', async t => {
  const f = hostFixture(t), text = 'Synthetic 😀 '.repeat(600), parts = splitRaw(text);
  const first = ok(await f.core.captureRaw(request(parts[0])));
  assert.equal(usage(f.core).savedBytes, Buffer.byteLength(parts[0].content));
  assert.equal(usage(f.core).reservedBytes, Buffer.byteLength(text) - Buffer.byteLength(parts[0].content));
  const overlap = ok(await f.core.captureRaw(request(parts[0], { eventId: 'overlap' })));
  assert.deepEqual(overlap.interpretation, { ok: true, value: { status: 'not-run', reason: 'continuation' } });
  for (const part of parts.slice(1)) {
    const source = request(part), result = ok(await f.core.captureRaw(source)), before = usage(f.core);
    assert.deepEqual(result.interpretation, overlap.interpretation);
    assert.deepEqual(ok(await f.core.captureRaw(source)), result);
    assert.deepEqual(usage(f.core), before);
  }
  assert.equal(usage(f.core).savedBytes, Buffer.byteLength(text)); assert.equal(usage(f.core).reservedBytes, 0);
  const changed = request({ ...parts[0], content: parts[0].content.replace('Synthetic', 'synthetic') });
  denied(await f.core.captureRaw(changed), 'event_payload_conflict');
  assert.equal(count(f.db, 'raw_conversations'), 1); assert.equal(first.raw.parts[0].saved, true);
  noInterpretation(f);
});

test('host exact replay across pause and resume returns its recorded disposition without new work', async t => {
  const f = hostFixture(t), source = request(splitRaw('Synthetic replay source')[0]);
  const original = await f.core.captureRaw(source);
  ok(original);
  const generation = f.db.prepare('SELECT capture_generation FROM raw_capture_events').get().capture_generation;
  const snapshot = () => ({
    rows: Object.fromEntries(['raw_events', 'raw_parts', 'raw_capture_events', 'raw_messages',
      'raw_conversations', 'raw_owner_usage'].map(table => [table, f.db.prepare(`SELECT * FROM ${table}`).all()])),
    usage: usage(f.core), calls: [...f.calls],
  });
  const before = snapshot();
  const paused = ok(f.core.setCapturePaused({ namespace: ns, expectedGeneration: generation, paused: true }));
  assert.notEqual(paused.generation, generation);
  denied(await f.core.captureRaw(source), 'capture_disabled');
  assert.deepEqual(snapshot(), before);
  const resumed = ok(f.core.setCapturePaused({ namespace: ns, expectedGeneration: paused.generation, paused: false }));
  assert.notEqual(resumed.generation, paused.generation);
  assert.notEqual(resumed.generation, generation);
  assert.deepEqual(await f.core.captureRaw(source), original);
  assert.deepEqual(snapshot(), before);
  noInterpretation(f);
});

for (const initial of ['host', 'engine']) test(`event mode binding refuses ${initial} to other mode, including empty projections`, async t => {
  for (const text of ['Synthetic eligible source', '   ']) {
    const f = hostFixture(t, { raw: { interpretation: initial }, model: { extract: () => ({ items: [] }) } });
    const source = request(splitRaw(text)[0]);
    ok(await f.core.captureRaw(source));
    const before = usage(f.core), calls = f.calls.length;
    f.reopen({ interpretation: initial === 'host' ? 'engine' : 'host' });
    denied(await f.core.captureRaw(source), 'event_payload_conflict');
    assert.deepEqual(usage(f.core), before); assert.equal(f.calls.length, calls);
    assert.equal(count(f.db, 'raw_capture_events'), 1);
  }
});

for (const barrier of ['pause', 'project', 'fence']) for (const duringSeal of [false, true]) {
  test(`host ${barrier} ${duringSeal ? 'during seal' : 'preflight'} refuses without registration`, async t => {
    let f, apply;
    const namespace = barrier === 'project' ? { ...ns, scope: 'project', projectId: 'synthetic-project' } : ns;
    const port = localPlainPort(), seal = port.sealRaw;
    if (duringSeal) port.sealRaw = async value => { apply(); return seal(value); };
    f = hostFixture(t, { raw: { port } });
    const source = request(splitRaw('Synthetic fenced source')[0], { namespace });
    apply = () => {
      if (barrier === 'pause') ok(f.core.setCapturePaused({ namespace, expectedGeneration: 'initial', paused: true }));
      if (barrier === 'project') ok(f.core.setProjectCapture({ namespace, expectedGeneration: 'initial', enabled: false }));
      if (barrier === 'fence') ok(f.core.fenceSession({ namespace, client: source.client, sessionId: source.sessionId }));
    };
    if (!duringSeal) apply();
    denied(await f.core.captureRaw(source), ['pause', 'project'].includes(barrier) ? 'capture_disabled' : 'conversation_deleted');
    assert.equal(count(f.db, 'raw_events'), 0); assert.equal(count(f.db, 'raw_owner_usage'), 0);
    noInterpretation(f);
  });
}

for (const duringSeal of [false, true]) test(`host deleted episode ${duringSeal ? 'during seal' : 'preflight'} refuses`, async t => {
  const f = fixture(t, { kind: 'episode' });
  const source = request(splitRaw('Synthetic deleted episode')[0], {}, 'episode');
  ok(await f.core.captureRaw(source));
  const row = f.db.prepare('SELECT id,revision FROM session_episodes').get();
  const remove = () => ok(f.core.forgetEpisode({ namespace: ns, episodeId: row.id, expectedRevision: row.revision }));
  const port = localPlainPort(), seal = port.sealRaw;
  let before, events;
  if (duringSeal) port.sealRaw = async value => {
    remove();
    before = usage(host); events = count(f.db, 'raw_events');
    return seal(value);
  }; else remove();
  const host = openMemoryCore({ path: f.path, model: f.model, rawConversations: rawOptions({ port }) });
  f.workspace.defer(() => host.close());
  before = usage(host); events = count(f.db, 'raw_events');
  const calls = f.calls.length, late = request(splitRaw('Synthetic late source', { id: 'late', ordinal: 2 })[0]);
  denied(await host.captureRaw(late), 'conversation_deleted');
  assert.equal(count(f.db, 'raw_events'), events); assert.equal(f.calls.length, calls);
  assert.deepEqual(usage(host), before);
  if (duringSeal) for (const table of ['raw_events', 'raw_capture_events', 'raw_parts'])
    assert.equal(f.db.prepare(`SELECT count(*) n FROM ${table} WHERE event_id=?`).get(late.eventId).n, 0, table);
});

test('managed host preparation refuses authority revoked during its final seal', async t => {
  const f = hostFixture(t), source = request(splitRaw('Synthetic managed source')[0]);
  const localAuthority = grantAuthority(f, source.client), port = localPlainPort(), seal = port.sealRaw;
  let seals = 0;
  port.sealRaw = async value => {
    seals++;
    ok(f.core.setLocalCaptureControl({ namespace: ns, client: source.client, targetId: localAuthority.targetId,
      expectedStoreId: localAuthority.storeId, expectedRevision: localAuthority.expectedControlRevision,
      automaticCaptureEnabled: false, rawNoticeVersion: 'local-plain-v1' }));
    return seal(value);
  };
  const storage = createRawCaptureStorage({ db: f.db, profile: {}, ...rawOptions({ port, localAuthority }) });
  const before = usage(f.core);
  // Test prepare itself: a later commit guard must not mask this recheck.
  await assert.rejects(storage.prepare(source), { code: 'capture_disabled' });
  assert.equal(seals, 1);
  for (const table of ['raw_events', 'raw_capture_events', 'raw_parts', 'raw_owner_usage'])
    assert.equal(count(f.db, table), 0, table);
  assert.deepEqual(usage(f.core), before);
  noInterpretation(f);
});

for (const reason of ['tool_off', 'notice_required', 'raw_disabled', 'quota_reached']) test(`host trusted ${reason} disposition skips sealing and interpretation`, async t => {
  let seals = 0;
  const port = localPlainPort(); port.sealRaw = () => { seals++; throw Error('Synthetic unused seal'); };
  const f = hostFixture(t, { raw: { port, ...(reason === 'raw_disabled' ? { mode: 'off' }
    : reason === 'quota_reached' ? { capBytes: 1 } : { readPolicy: () => ({ generation: 'notice-1', reason }) }) } });
  const source = request(splitRaw('Synthetic skipped source')[0]);
  const result = ok(await f.core.captureRaw(source));
  assert.equal(result.raw.parts[0].reason, reason); assert.deepEqual(result.interpretation, empty);
  const before = usage(f.core); assert.equal(before.savedBytes, 0); assert.equal(before.reservedBytes, 0);
  assert.deepEqual(ok(await f.core.captureRaw(source)), result); assert.deepEqual(usage(f.core), before);
  assert.equal(seals, 0); noInterpretation(f);
});

test('host cap never evicts saved text and quota retries never backfill', async t => {
  const f = hostFixture(t, { raw: { capBytes: 24 } });
  const saved = ok(await f.core.captureRaw(request(splitRaw('Synthetic saved source')[0])));
  const before = usage(f.core), stored = f.db.prepare('SELECT * FROM raw_parts').all();
  const source = request(splitRaw('Synthetic over-cap source', { id: 'second', ordinal: 2 })[0]);
  const skipped = ok(await f.core.captureRaw(source));
  assert.equal(skipped.raw.parts[0].reason, 'quota_reached');
  assert.equal(usage(f.core).savedBytes, before.savedBytes);
  assert.deepEqual(f.db.prepare('SELECT * FROM raw_parts WHERE saved=1').all(), stored);
  assert.equal(skipped.raw.conversationId, saved.raw.conversationId);
  f.reopen({ capBytes: 1000 }); const increased = usage(f.core);
  assert.deepEqual(ok(await f.core.captureRaw(source)), skipped); assert.deepEqual(usage(f.core), increased);
  noInterpretation(f);
});

test('host seal failure and malformed requests have no registration or usage', async t => {
  const port = localPlainPort(); port.sealRaw = () => { throw Error('Synthetic private seal failure'); };
  const f = hostFixture(t, { raw: { port } }), source = request(splitRaw('Synthetic source')[0]);
  for (const patch of [{ extra: true }, { interpretation: 'host' }, { readPolicy: () => ({ reason: null }) },
    { messages: [{ ...source.messages[0], role: 'system' }] }]) denied(await f.core.captureRaw({ ...source, ...patch }), 'invalid_input');
  denied(await f.core.captureRaw(source), 'raw_crypto_unavailable');
  for (const table of ['raw_parts', 'raw_messages', 'raw_events', 'raw_capture_events', 'raw_conversations', 'raw_owner_usage'])
    assert.equal(count(f.db, table), 0, table);
  assert.equal(usage(f.core).savedBytes, 0); assert.equal(usage(f.core).reservedBytes, 0); noInterpretation(f);
});

test('interpretation is a strict own data option, validated before opening SQLite', t => {
  const workspace = createTestWorkspace(t, { prefix: 'raw-host-options-' }); let getters = 0;
  const accessor = Object.defineProperty(rawOptions(), 'interpretation', { get() { getters++; return 'host'; } });
  for (const [index, raw] of [accessor, ...['HOST', 1, null, undefined, new String('host')].map(interpretation => rawOptions({ interpretation })),
    rawOptions({ extra: true }), Object.assign(Object.create({ interpretation: 'host' }), rawOptions())].entries()) {
    const path = join(workspace.path, `${index}.sqlite`);
    assert.throws(() => openMemoryCore({ path, rawConversations: raw }), { code: 'invalid_input' });
    assert.equal(existsSync(path), false);
  }
  assert.equal(getters, 0);
});

// Compare the internal raw-capture fixture path against both public defaults.
// A fixed identity secret and clock make all relevant persisted rows comparable.
test('omitted and engine match the current ordinary raw capture fixture rows and outcomes', async t => {
  t.mock.timers.enable({ apis: ['Date'], now: 1730000000000 });
  const baseline = fixture(t, { lineage: true, deletion: true, model: { extract: () => ({ items: [] }) } });
  const tables = ['raw_conversations', 'raw_messages', 'raw_parts', 'raw_events', 'raw_capture_events', 'raw_owner_usage',
    'raw_source_maps', 'admission_claims', 'staged_capture_evidence', 'episode_events', 'session_episodes', 'memories', 'receipts'];
  const canonical = value => JSON.parse(JSON.stringify(value).replace(/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}/g, 'synthetic-id'));
  const dump = db => canonical(Object.fromEntries(tables.map(table => [table, db.prepare(`SELECT * FROM ${table}`).all()
    .map(row => Object.fromEntries(Object.entries(row).filter(([key]) => !key.startsWith('local_'))))])));
  const source = request(splitRaw('Synthetic default behavior')[0]);
  baseline.db.prepare('UPDATE episode_identity SET secret=?').run('a'.repeat(64)); baseline.reopen();
  const expected = await baseline.core.captureRaw(source);
  for (const interpretationMode of [undefined, 'engine']) {
    const f = fixture(t, { lineage: true, deletion: true, model: { extract: () => ({ items: [] }) } });
    f.core.close(); f.db.prepare('UPDATE episode_identity SET secret=?').run('a'.repeat(64));
    const raw = rawOptions(); delete raw.interpretation;
    if (interpretationMode) raw.interpretation = interpretationMode;
    const core = openMemoryCore({ path: f.path, model: f.model, rawConversations: raw }); f.workspace.defer(() => core.close());
    assert.deepEqual(canonical(await core.captureRaw(source)), canonical(expected));
    assert.deepEqual(dump(f.db), dump(baseline.db));
    assert.ok(f.calls.some(call => call.method === 'extract'));
    const binding = f.db.prepare('SELECT binding_digest FROM raw_capture_events').get().binding_digest;
    assert.equal(binding, engineBindings.ordinary.unmanaged);
  }
});

test('omitted and engine retain frozen engine bindings for every profile and authority mode', async t => {
  for (const kind of ['ordinary', 'staged', 'episode']) for (const managed of [false, true]) {
    for (const mode of [undefined, 'engine']) {
      const raw = rawOptions(); delete raw.interpretation;
      if (mode) raw.interpretation = mode;
      const f = hostFixture(t, { kind, raw, omitInterpretation: mode === undefined });
      const source = request(splitRaw('Synthetic binding source')[0], {}, kind);
      if (managed) {
        // Fixed synthetic identities used to record the frozen managed bindings.
        f.db.prepare('UPDATE store_metadata SET store_id=?').run('00000000-0000-4000-8000-000000000000');
        f.reopen();
        const localAuthority = grantAuthority(f, source.client);
        localAuthority.expectedConsentGeneration = '00000000-0000-4000-8000-000000000002';
        f.db.prepare('UPDATE local_capture_controls SET consent_generation=?').run(localAuthority.expectedConsentGeneration);
        f.reopen({ localAuthority });
      }
      ok(await f.core.captureRaw(source));
      const binding = f.db.prepare('SELECT binding_digest FROM raw_capture_events WHERE event_id=?').get(source.eventId);
      assert.equal(binding.binding_digest, engineBindings[kind][managed ? 'managed' : 'unmanaged'],
        `${kind}/${managed ? 'managed' : 'unmanaged'}/${mode ?? 'omitted'}`);
    }
  }
});
