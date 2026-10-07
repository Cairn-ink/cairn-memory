import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import { openMemoryCore } from '../contract.mjs';
import { callModel, isCoreModelDeadlineSignal } from '../model-call.mjs';
import { rationaleModel } from '../testing/rationale-model.mjs';
import { interpretation, input as episodeInput, ns as episodeNamespace,
  options as episodeOptions } from '../testing/episode-capture-helpers.mjs';
import { createRecallWitness } from '../../evaluation/long-history/recall-witness.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const namespace = { ownerId: 'call-timeout', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const captureInput = (index = 1, extra = {}) => ({ namespace, client: 'synthetic',
  eventId: `event-${index}`, sessionId: 'session', messages: [{ id: `message-${index}`,
    role: 'user', content: `Project train departure is day ${index}.` }], ...extra });
function fixture(t, model = rationaleModel(), config = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-model-call-timeout-' });
  const path = join(workspace.path, 'memory.sqlite');
  const constructor = { path, model, ...config };
  const core = openMemoryCore(constructor);
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path);
  workspace.defer(() => db.close());
  return { core, db, path, constructor };
}
const admit = core => ok(core.admit({ namespace, memory: { content: 'Synthetic train preference', kind: 'fact' },
  receipts: [{ client: 'synthetic', sessionId: 'session', eventId: 'explicit', role: 'user',
    excerpt: 'I choose the train.' }] })).memory;
const classifyInput = (core, memory) => ({ namespace, memoryIds: [memory.id],
  expectedMemoryRevisions: [{ memoryId: memory.id, revision: memory.revision }],
  mapRevision: ok(core.map({ namespace, purpose: 'classification' })).indexRevision });
const select = ({ input }) => ({ refs: input.maps.flatMap(page => page.items.filter(item => item.type === 'unfiled')
  .map(item => ({ namespaceIndex: page.namespaceIndex, ...item.ref }))) });
const qualify = ({ input }) => ({ qualifications: input.items.map(item => ({ itemIndex: item.itemIndex,
  qualification: { version: 1, slot: { subject: null, property: null, scope: null, applies: null },
    value: null, attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0,
      start: 0, end: item.sources[0].excerpt.length, text: item.sources[0].excerpt, fields: ['value'] }] } })) });
const port = () => ({ ...rationaleModel(), select, qualify, reconcile: () => ({ transitions: [] }),
  reviewBasis: () => ({ units: [], links: [] }), interpretEpisode: interpretation });
const timeoutResult = result => assert.deepEqual(result,
  { ok: false, error: { code: 'model_timeout', retryable: false } });

test('N22A explicit model-call timeout is accepted by the core constructor', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-model-call-timeout-' });
  const path = join(workspace.path, 'memory.sqlite');
  const core = openMemoryCore({ path, modelCallTimeoutMs: 60_000 });
  workspace.defer(() => core.close());
  assert.equal(existsSync(path), true);
});

test('N22A strict option validation precedes database creation and never invokes getters', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-timeout-invalid-' });
  const path = join(workspace.path, 'absent.sqlite');
  for (const value of [undefined, null, false, true, '10', {}, [], 0, -1, 120001, 1.5, NaN, Infinity]) {
    assert.throws(() => openMemoryCore({ path, modelCallTimeoutMs: value }), { code: 'invalid_input' });
    assert.equal(existsSync(path), false);
  }
  let getterCalls = 0;
  const getter = { get modelCallTimeoutMs() { getterCalls++; return 60000; } };
  for (const options of [Object.defineProperty({ path }, 'modelCallTimeoutMs',
    Object.getOwnPropertyDescriptor(getter, 'modelCallTimeoutMs')),
  Object.assign(Object.create(getter), { path }),
  Object.assign(Object.create({ modelCallTimeoutMs: 60000 }), { path })]) {
    assert.throws(() => openMemoryCore(options), { code: 'invalid_input' });
    assert.equal(existsSync(path), false);
  }
  assert.equal(getterCalls, 0);
  for (const value of [1, 120000]) fixture(t, undefined, { modelCallTimeoutMs: value });
  const f = fixture(t);
  assert.equal((await f.core.capture({ ...captureInput(), modelCallTimeoutMs: 1 })).error.code, 'invalid_input');
});

test('N22B default and configured caps cover both adapter phases without a second clock', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const cap of [undefined, 60_000]) {
    let signal, beginCount, beginGeneration;
    const counting = new Promise(resolve => { beginCount = resolve; });
    const generating = new Promise(resolve => { beginGeneration = resolve; });
    const f = fixture(t, { contextWindow: 8192, countTokens: () => 1,
      async extract(request) {
        signal = request.signal; beginCount();
        await new Promise(resolve => setTimeout(resolve, 10_000));
        beginGeneration(); return new Promise(() => {});
      } }, cap === undefined ? {} : { modelCallTimeoutMs: cap });
    const pending = f.core.capture(captureInput());
    await counting; t.mock.timers.tick(10_000); await generating;
    t.mock.timers.tick((cap ?? 30_000) - 10_001);
    assert.equal(signal.aborted, false);
    t.mock.timers.tick(1); timeoutResult(await pending);
    assert.equal(isCoreModelDeadlineSignal(signal), true);
    assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
  }
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  const f = fixture(t, { contextWindow: 8192, countTokens: () => 1,
    async extract() { started(); await new Promise(resolve => setTimeout(resolve, 40_000)); return { items: [] }; } },
  { modelCallTimeoutMs: 60_000 });
  const pending = f.core.capture(captureInput()); await ready;
  t.mock.timers.tick(40_000); ok(await pending);
});

test('N22D/E shared frozen model isolates cores and constructor mutation cannot alter calls', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const signals = [];
  const model = Object.freeze({ contextWindow: 8192, countTokens: () => 1,
    extract({ signal }) { signals.push(signal); return new Promise(() => {}); } });
  const before = Object.getOwnPropertyDescriptors(model);
  const short = fixture(t, model, { modelCallTimeoutMs: 10_000 });
  const long = fixture(t, model, { modelCallTimeoutMs: 60_000 });
  const first = short.core.capture(captureInput()), second = long.core.capture(captureInput());
  await setImmediate(); assert.equal(signals.length, 2);
  short.constructor.modelCallTimeoutMs = 120_000; long.constructor.modelCallTimeoutMs = 1;
  t.mock.timers.tick(10_000); timeoutResult(await first);
  assert.equal(signals[0].aborted, true); assert.equal(signals[1].aborted, false);
  t.mock.timers.tick(50_000); timeoutResult(await second);
  const next = long.core.capture(captureInput(2)); await setImmediate();
  t.mock.timers.tick(59_999); assert.equal(signals[2].aborted, false);
  t.mock.timers.tick(1); timeoutResult(await next);
  assert.deepEqual(Object.getOwnPropertyDescriptors(model), before);
});

test('N22C aggregate capture remainder caps a longer model call', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let signal;
  const f = fixture(t, { contextWindow: 8192, countTokens: () => 1,
    extract(request) { signal = request.signal; return new Promise(() => {}); } },
  { modelCallTimeoutMs: 60_000, captureDeadlineMs: 1000 });
  const pending = f.core.capture(captureInput()); await setImmediate();
  t.mock.timers.tick(1000); timeoutResult(await pending);
  assert.equal(isCoreModelDeadlineSignal(signal), true);
  assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
  let ceiling;
  const bounded = assert.rejects(callModel({ contextWindow: 8192, countTokens: () => 1,
    extract: () => new Promise(() => {}) }, 'extract', 'Synthetic', {},
  { modelCallTimeoutMs: 60_000, deadline: { expired: () => false,
    remainingMs(value) { ceiling = value; return 10; } } }), { code: 'model_timeout' });
  await setImmediate(); t.mock.timers.tick(10); await bounded;
  assert.equal(ceiling, 60_000);
});

for (const afterAdmission of [false, true]) {
  test(`N22C cumulative aggregate expiry ${afterAdmission ? 'preserves admission with failed later stages' : 'prevents admission'}`, () => {
    const child = fileURLToPath(new URL('../testing/model-call-timeout-clock-child.mjs', import.meta.url));
    const observed = spawnSync(process.execPath, [child, afterAdmission ? 'after' : 'before'],
      { encoding: 'utf8', env: { TMPDIR: process.env.TMPDIR }, timeout: 10_000 });
    assert.equal(observed.status, 0, `${observed.stdout}\n${observed.stderr}`);
    assert.match(observed.stdout, /configured cap and cumulative capture expiry/u);
  });
}

test('N22H late output cannot admit or start classification; external aborts stay unbranded', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const rejects of [false, true]) {
    let resolveLate, rejectLate, signal, calls = 0;
    const f = fixture(t, { contextWindow: 8192, countTokens: () => 1,
      extract(request) { signal = request.signal; return new Promise((resolve, reject) => {
        resolveLate = resolve; rejectLate = reject;
      }); }, classify() { calls++; return { items: [] }; } }, { modelCallTimeoutMs: 1000 });
    const pending = f.core.capture(captureInput()); await setImmediate();
    t.mock.timers.tick(1000); timeoutResult(await pending);
    if (rejects) rejectLate(new Error('Synthetic late rejection'));
    else resolveLate({ items: [{ content: 'Late proposal', kind: 'fact', confidence: 0.8, sourceIndices: [0] }] });
    await setImmediate();
    assert.equal(calls, 0); assert.equal(f.db.prepare('SELECT count(*) n FROM memories').get().n, 0);
    assert.equal(isCoreModelDeadlineSignal(signal), true);
  }
  assert.equal(isCoreModelDeadlineSignal(AbortSignal.abort('model_timeout')), false);
  let external;
  await assert.rejects(callModel({ contextWindow: 8192, countTokens: () => 1,
    extract(request) { external = request.signal; throw new DOMException('Synthetic', 'AbortError'); } },
  'extract', 'Synthetic', {}, { modelCallTimeoutMs: 1000 }), { code: 'model_cancelled' });
  assert.equal(isCoreModelDeadlineSignal(external), false);
});

for (const method of ['extract', 'qualify', 'qualifyCandidates', 'reconcile', 'classify', 'relate', 'select', 'rank', 'reviewBasis']) {
  test(`N22G real core forwards configured budget to ${method}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const model = port();
    let reveal, signal;
    const ready = new Promise(resolve => { reveal = resolve; });
    const f = fixture(t, model, { modelCallTimeoutMs: 60_000,
      ...(method === 'qualify' ? { captureQualification: 'source-bound-v1' } : {}),
      ...(method === 'qualifyCandidates' ? { captureQualification: 'source-bound-v2' } : {}) });
    let operation;
    if (method === 'reconcile') {
      ok(await f.core.capture(captureInput(1, { causal: { streamId: 'stream', sequence: 1 } })));
    }
    let memory;
    if (['classify', 'relate', 'reviewBasis', 'select', 'rank'].includes(method)) memory = admit(f.core);
    model[method] = request => { signal = request.signal; reveal(); return new Promise(() => {}); };
    if (method === 'classify') operation = f.core.classifyPlacement(classifyInput(f.core, memory));
    else if (method === 'relate' || method === 'reviewBasis') operation = f.core[method === 'relate' ? 'reviewRationale' : 'reviewDecisionBasis']({
      namespace, refs: [{ memoryId: memory.id, revision: memory.revision }] });
    else if (method === 'select' || method === 'rank') operation = f.core.recall({ readSet: [namespace], query: 'train' });
    else operation = f.core.capture(captureInput(2,
      method === 'reconcile' ? { causal: { streamId: 'stream', sequence: 2 } } : {}));
    await ready; t.mock.timers.tick(30_001); assert.equal(signal.aborted, false);
    t.mock.timers.tick(29_999); timeoutResult(await operation);
    assert.equal(isCoreModelDeadlineSignal(signal), true);
  });
}

for (const trigger of ['batch', 'lazy', 'end']) {
  test(`N22G episode ${trigger} interpretation uses the configured call budget`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const model = { ...port(), extract: () => ({ items: [] }) };
    const f = fixture(t, model, { ...episodeOptions, modelCallTimeoutMs: 60_000,
      sessionEpisodes: { mode: 'episode-v1', draftEveryBatches: 16 } });
    if (trigger !== 'batch') {
      ok(await f.core.capture(episodeInput(1)));
      ok(await f.core.capture(episodeInput(2)));
    }
    let signal, reveal, stalls = 0;
    const ready = new Promise(resolve => { reveal = resolve; });
    model.interpretEpisode = request => {
      if (stalls++) return interpretation(request);
      signal = request.signal; reveal(); return new Promise(() => {});
    };
    const operation = trigger === 'end' ? f.core.endEpisodeSession({ namespace: episodeNamespace,
      client: 'synthetic', sessionId: 'private-session', generation: 'initial', eventId: 'end' })
      : f.core.capture(episodeInput(3, trigger === 'lazy' ? 'new-session' : 'private-session'));
    await ready; t.mock.timers.tick(30_001); assert.equal(signal.aborted, false);
    t.mock.timers.tick(29_999);
    const result = ok(await operation);
    assert.equal((trigger === 'lazy' ? result.lazyEpisode : result.episode).error.code, 'episode_timeout');
    assert.equal(isCoreModelDeadlineSignal(signal), true);
  });
}

test('N22F original receivers support private fields, qualification fit and witness facades', async t => {
  class Model {
    #calls = 0;
    #fitCalls = 0;
    contextWindow = 8192;
    countTokens() { assert.equal(this, model); this.#calls++; return 1; }
    extract(request) {
      assert.equal(this, model);
      assert.deepEqual(Object.keys(request).sort(), ['input', 'maxOutputTokens', 'signal', 'system']);
      this.#calls++; return port().extract(request);
    }
    qualifyCandidates(request) { assert.equal(this, model); this.#calls++; return port().qualifyCandidates(request); }
    fitsQualificationRequest = function () { assert.equal(this, model); this.#fitCalls++; return true; };
    classify(request) { assert.equal(this, model); this.#calls++; return port().classify(request); }
    calls() { return this.#calls; }
    fitCalls() { return this.#fitCalls; }
  }
  const model = new Model();
  const f = fixture(t, model, { captureQualification: 'source-bound-v2', modelCallTimeoutMs: 60_000 });
  ok(await f.core.capture(captureInput())); assert.ok(model.calls() > 4);
  assert.ok(model.fitCalls() > 0);
  const original = port();
  const witness = createRecallWitness(original);
  const observed = fixture(t, witness.model, { modelCallTimeoutMs: 60_000 });
  admit(observed.core);
  const result = await observed.core.recall({ readSet: [namespace], query: 'train' });
  ok(result); witness.finish(result);
  assert.equal(witness.summary().selectCalls, 1);
  assert.equal(witness.summary().rankCalls, 1);
});
