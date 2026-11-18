import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { statSync } from 'node:fs';
import { DatabaseSync } from 'node:sqlite';
import { openMemoryCore } from '../index.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { captureMessages } from '../capture.mjs';
import { openDatabase as openVersion29 } from '../testing/method-package-v29-database.mjs';
import { resolveContentLayout } from '../content-safety-layout.mjs';
import { rawSessionKeys } from '../raw-source-roots.mjs';
import { eventTimeSafetyFixture } from '../testing/receipt-event-time-fixture.mjs';
import { safetyFixture, ns, ok } from '../testing/content-safety-s2h-fixture.mjs';
import { options as episodeOptions, interpretation } from '../testing/episode-capture-helpers.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { workerFixture } from '../../integrations/client/test/fixtures/local-worker-workspace.mjs';
import { claude } from '../../integrations/client/test/fixtures/raw-fixtures.mjs';

const source = { id: 'synthetic-message', role: 'user', content: 'Synthetic forgotten source.' };
const clean = { id: 'synthetic-independent', role: 'user', content: 'Synthetic independent source.' };
const fact = 'Synthetic forgotten fact';
const excluded = { ok: false, error: { code: 'source_excluded', retryable: false } };
const success = indexRevision => ({ ok: true, value: { duplicate: false,
  admission: { memories: [], suppressedCount: 1, indexRevision },
  classification: { status: 'skipped', reason: 'empty' } } });

async function fixture(t, shape, config = {}) {
  let f;
  if (shape === 'local-29') {
    const workspace = createTestWorkspace(t, { prefix: 'forgotten-empty-29-' });
    const path = join(workspace.path, 'store.sqlite');
    const old = openVersion29(path, { localControls: true }); old.close();
    f = { workspace, path, connect: () => new DatabaseSync(path) };
  } else {
    f = shape === 'hosted-53' ? eventTimeSafetyFixture(t, 33) : safetyFixture(t, 18);
    if (shape === 'hosted-53') await f.migrate();
  }
  const calls = [];
  const model = { ...rationaleModel(method => calls.push(method)),
    extract({ input }) {
      calls.push({ extract: structuredClone(input.messages) });
      return { items: input.messages.map((message, index) => ({ content: message.content === source.content ? fact : 'Synthetic independent fact',
        kind: 'fact', confidence: .9, sourceIndices: [index] })) };
    }, interpretEpisode: request => { calls.push('interpretEpisode'); return interpretation(request); },
  };
  const core = openMemoryCore({ path: f.path, model, ...(shape === 'local-29' ? { raw: true } : {}), ...config });
  f.workspace.defer(() => core.close());
  const db = f.connect(); f.workspace.defer(() => db.close());
  assert.equal(db.prepare('PRAGMA user_version').get().user_version, { 'hosted-53': 53, 'legacy-18': 18, 'local-29': 29 }[shape]);
  if (shape === 'local-29') {
    assert.equal(resolveContentLayout(29).suppressionRevision, 0);
    assert.equal(db.prepare("SELECT 1 FROM sqlite_schema WHERE name='content_safety_control'").get(), undefined);
    assert.equal(typeof core.getLocalCaptureControl, 'function');
  }
  const input = (eventId, messages = [source], extra = {}) => ({ namespace: ns, client: 'synthetic', sessionId: 'synthetic-session', eventId, messages, ...extra });
  const send = (eventId, messages, extra) => core.capture(input(eventId, messages, extra));
  const forget = memory => {
    ok(core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
    calls.length = 0;
  };
  const material = () => ['memories', 'receipts', 'suppressed', 'namespace_epochs'].map(table =>
    [table, db.prepare(`SELECT * FROM ${table}`).all()]);
  const epoch = () => ok(core.map({ namespace: ns })).indexRevision;
  return { ...f, core, db, calls, model, input, send, forget, material, epoch };
}

for (const shape of ['hosted-53', 'legacy-18', 'local-29']) {
  test(`${shape}: all forgotten completes the base success envelope and replay, then captures an independent message`, async t => {
    const f = await fixture(t, shape);
    f.forget(ok(await f.send('first')).admission.memories[0]);
    const before = f.material(), revision = f.epoch();
    assert.deepEqual(await f.send('second'), success(revision));
    assert.deepEqual(f.calls, [], 'no extract, qualification or classification call');
    assert.deepEqual(f.material(), before, 'only the admission claim may change');
    assert.deepEqual(await f.send('second'), { ok: true, value: { duplicate: true, memoryIds: [], suppressedCount: 1 } });
    assert.deepEqual(f.calls, []);
    const row = f.db.prepare("SELECT state,memory_ids,suppressed_count FROM admission_claims WHERE event_id='second'").get();
    assert.deepEqual({ ...row }, { state: 'completed', memory_ids: '[]', suppressed_count: 1 });
    assert.equal(ok(await f.send('third', [clean])).admission.memories.length, 1);
    assert.deepEqual(f.calls.find(call => call.extract)?.extract.map(message => message.content), [clean.content]);
  });

  test(`${shape}: a mixed forgotten and clean batch keeps its admission and suppressed count`, async t => {
    const f = await fixture(t, shape);
    f.forget(ok(await f.send('first')).admission.memories[0]);
    const result = ok(await f.send('second', [source, clean]));
    assert.equal(result.admission.memories.length, 1);
    assert.equal(result.admission.suppressedCount, 0);
    assert.deepEqual(f.calls.find(call => call.extract).extract.map(message => message.content), [clean.content]);
  });

  test(`${shape}: admit retains source_excluded for the same forgotten source`, async t => {
    const f = await fixture(t, shape);
    f.forget(ok(await f.send('first')).admission.memories[0]);
    assert.deepEqual(f.core.admit({ namespace: ns, memory: { content: 'Synthetic reworded fact', kind: 'fact' }, receipts: [{
      client: 'synthetic', sessionId: 'synthetic-session', eventId: source.id, role: source.role, excerpt: source.content,
    }] }), excluded);
  });
}

for (const qualified of [false, true]) test(`ordered ${qualified ? 'v2' : 'ordinary'}: all-forgotten capture completes the ordered claim`, async t => {
  const f = await fixture(t, 'legacy-18', qualified ? { captureQualification: 'source-bound-v2' } : {});
  f.forget(ok(await f.send('first')).admission.memories[0]);
  const extra = { causal: { streamId: 'synthetic-stream', sequence: 1 } };
  const result = ok(await f.send('second', [source], extra));
  assert.deepEqual(result.admission, { memories: [], suppressedCount: 1, indexRevision: f.epoch() });
  assert.deepEqual(result.reconciliation, { status: qualified ? 'unresolved' : 'complete_no_change',
    reason: qualified ? 'qualification_requires_identity' : null, retiredCount: 0 });
  assert.deepEqual(f.calls, []);
  assert.equal(ok(await f.send('second', [source], extra)).duplicate, true);
  assert.equal(ok(await f.send('third', [clean], { causal: { ...extra.causal, sequence: 2 } })).admission.memories.length, 1);
});

for (const shape of ['hosted-53', 'local-29']) test(`${shape}: Episode admission follows the empty completion branch`, async t => {
  const f = await fixture(t, shape, episodeOptions);
  // Ordinary admission first leaves no staged episode evidence for interpretation.
  const first = ok(f.core.admit({ namespace: ns, memory: { content: fact, kind: 'fact' }, receipts: [{
    client: 'synthetic', sessionId: 'synthetic-session', eventId: source.id, role: source.role, excerpt: source.content,
  }] })).memory;
  f.forget(first);
  const extra = { episodeContext: { clientLabel: 'Synthetic', generation: 'initial', origin: 'ordinary' } };
  const result = ok(await f.send('second', [source], extra));
  assert.deepEqual(result.admission, { status: 'completed', memories: [], suppressedCount: 1, indexRevision: f.epoch() });
  assert.deepEqual(f.calls, []);
  assert.equal(ok(await f.send('second', [source], extra)).duplicate, true);
  assert.equal(ok(await f.send('third', [clean], extra)).admission.memories.length, 1);
});

test('local-29: sources already excluded by Raw keep source_excluded even with forget tokens', async t => {
  const f = await fixture(t, 'local-29');
  const input = f.input('first'); input.client = 'codex';
  f.forget(ok(await f.core.capture(input)).admission.memories[0]);
  assert.ok(f.db.prepare('SELECT 1 FROM raw_source_exclusions').get(), 'actual Raw exclusion');
  assert.deepEqual(await f.core.capture({ ...input, eventId: 'second' }), excluded);
  assert.deepEqual(f.calls, []);
});

test('local-29: a session fence retains conversation_deleted with forget tokens', async t => {
  const f = await fixture(t, 'local-29');
  const input = { ...f.input('first'), client: 'codex' };
  f.forget(ok(await f.core.capture(input)).admission.memories[0]);
  ok(f.core.fenceSession({ namespace: ns, client: input.client, sessionId: input.sessionId }));
  assert.deepEqual(await f.core.capture({ ...input, eventId: 'second' }), {
    ok: false, error: { code: 'conversation_deleted', retryable: false },
  });
  assert.deepEqual(f.calls, []);
});

test('host-shaped captureMessages uses the same empty completion and duplicate', async t => {
  const f = await fixture(t, 'hosted-53');
  f.forget(ok(await f.send('first')).admission.memories[0]);
  const runtime = createMemoryRuntime({ path: f.path }); f.workspace.defer(() => runtime.close());
  const invoke = work => { try { return { ok: true, value: work() }; } catch (error) { return { ok: false, error: { code: error.code } }; } };
  const send = () => captureMessages({ input: f.input('second'), model: f.model,
    operations: {
      filterCaptureSources: (sources, observed) => runtime.filterCaptureSources(ns, sources, observed),
      assertCaptureSources: sources => runtime.assertCaptureSources(ns, sources),
      claimAdmission: value => f.core.claimAdmission({ ...value, leaseMs: 125000 }),
      finishAdmission: (value, suppressed) => invoke(() => runtime.finishCapturedAdmission(ns, value, undefined, undefined, suppressed)),
      abandonAdmission: value => f.core.abandonAdmission(value),
    } });
  assert.deepEqual(await send(), success(f.epoch()).value);
  assert.deepEqual(await send(), { duplicate: true, memoryIds: [], suppressedCount: 1 });
  assert.deepEqual(f.calls, []);
});

test('installed local worker progress advances on the real all-forgotten engine acknowledgement', { timeout: 30000 }, async t => {
  const f = workerFixture(t, { rows: [claude(source.content)] });
  f.providerMode('memory');
  const call = async (action, settings) => {
    const outcome = await f.runWorker(action, settings).done;
    assert.equal(outcome.code, 0, outcome.stderr); assert.equal(outcome.signal, null);
    return JSON.parse(outcome.stdout);
  };
  assert.equal((await call('initialize', { start: 'beginning' })).status, 'ready');
  const db = new DatabaseSync(f.databasePath); f.workspace.defer(() => db.close());
  const secret = db.prepare('SELECT secret FROM episode_identity WHERE singleton=1').get().secret;
  const receiptSession = rawSessionKeys(f.namespace, 'claude-code', f.cursor().wireSessionId, secret)[1];
  const saved = ok(f.core.admit({ namespace: f.namespace, memory: { content: fact, kind: 'fact' }, receipts: [{
    client: 'claude-code', sessionId: receiptSession, eventId: source.id, role: source.role, excerpt: source.content,
  }] })).memory;
  ok(f.core.forget({ namespace: f.namespace, memoryId: saved.id, expectedRevision: saved.revision }));
  const result = await call('run');
  assert.equal(result.status, 'progress', JSON.stringify(result));
  assert.equal(result.reason, null);
  assert.equal(result.hasPending, false);
  assert.equal(f.cursor().pending, null);
  assert.equal(f.cursor().blockedReason, null);
  assert.equal(f.cursor().offset, statSync(f.sourcePath).size);
  assert.deepEqual(f.calls().filter(call => !call.count), [], 'no model inference');
  assert.equal(db.prepare('SELECT count(*) n FROM memories WHERE deleted=0').get().n, 0);
  assert.equal(db.prepare('SELECT count(*) n FROM receipts').get().n, 0);
});
