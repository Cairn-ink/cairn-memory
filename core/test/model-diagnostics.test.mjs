import assert from 'node:assert/strict';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';
import { openMemoryCore } from '../contract.mjs';
import { callModel } from '../model-call.mjs';
import { MemoryStoreError } from '../validation.mjs';
import { emitDiagnostic } from '../model-diagnostics.mjs';

const secret = 'SYNTHETIC_PRIVATE_QUERY_RECEIPT_PROVIDER';
const namespace = { ownerId: 'diagnostics', scope: 'personal', projectId: null };
const ok = (r) => { assert.equal(r.ok, true, JSON.stringify(r)); return r.value; };
const failed = (code) => ({ ok: false, error: { code, retryable: false } });
const select = ({ input }) => ({ refs: input.maps.flatMap((m) => m.items.filter((i) => i.type === 'unfiled')
  .map((i) => ({ namespaceIndex: m.namespaceIndex, ...i.ref }))) });
const rank = ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map((c) => ({
  namespaceIndex: c.namespaceIndex, memoryId: c.memory.id, revision: c.memory.revision })) });
function fixture(t, overrides = {}) {
  const events = [];
  const model = { contextWindow: 8192, countTokens: () => 1, select, rank,
    extract: () => ({ items: [{ content: secret, kind: 'fact', confidence: 0.8, sourceIndices: [0] }] }),
    classify: ({ input }) => ({ items: input.memories.map((m) => ({ memoryId: m.id, parentIds: [],
      newL1: { title: 'Synthetic topic', parentL2Ids: [] } })) }), onDiagnostic: (e) => events.push(e), ...overrides };
  const core = openMemoryCore({ path: join(mkdtempSync(join(tmpdir(), 'cairn-diagnostic-')), 'test.sqlite'), model });
  t.after(() => core.close());
  return { core, model, events };
}
function admit(core, content = secret, ns = namespace) {
  return ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' }, receipts: [{
    client: 'test', sessionId: 's', eventId: content, role: 'user', excerpt: content }] })).memory;
}
const recall = (core) => core.recall({ readSet: [namespace], query: secret });
const capture = (core) => core.capture({ namespace, client: 'test', sessionId: 's', eventId: 'capture',
  messages: [{ id: 'source', role: 'user', content: secret }] });
function event(actual, stage, layer, reason) {
  assert.deepEqual(actual, { version: 1, stage, layer, reason });
  assert.equal(Object.isFrozen(actual), true);
  assert.equal(JSON.stringify(actual).includes(secret), false);
}

test('diagnostics: core callback configuration fails before creating a database', () => {
  for (const onDiagnostic of [null, false, 1, 'callback', {}, []]) {
    const path = join(mkdtempSync(join(tmpdir(), 'cairn-diagnostic-config-')), 'absent.sqlite');
    assert.throws(() => openMemoryCore({ path, model: { onDiagnostic } }), (e) => e.code === 'invalid_input');
    assert.equal(existsSync(path), false);
  }
});

test('diagnostics: helper rejects unallowlisted fields and inherited layer names', () => {
  const events = [];
  const model = { onDiagnostic: (e) => events.push(e) };
  for (const [stage, layer, reason] of [
    [secret, 'adapter', 'output_bounds'], ['select', secret, 'output_bounds'],
    ['select', 'adapter', secret], ['select', '__proto__', 'output_bounds'],
    ['select', 'constructor', 'output_bounds'], ['select', 'adapter', 'invalid_extraction'],
  ]) emitDiagnostic(model, stage, layer, reason);
  assert.deepEqual(events, []);
  emitDiagnostic(model, 'rank', 'core_validation', 'duplicate_ref');
  event(events[0], 'rank', 'core_validation', 'duplicate_ref');
});

test('diagnostics: malformed, duplicate and non-visible references retain recall envelopes at both ports', async (t) => {
  for (const stage of ['select', 'rank']) for (const reason of ['malformed_refs', 'duplicate_ref', 'non_visible_ref']) {
    const { core, events } = fixture(t, { [stage]: (request) => {
      const output = (stage === 'select' ? select : rank)(request);
      if (reason === 'malformed_refs') return { refs: [], extra: secret };
      if (reason === 'duplicate_ref') output.refs.push({ ...output.refs[0] });
      if (reason === 'non_visible_ref') output.refs[0].memoryId = foreign.id;
      return output;
    } });
    admit(core);
    const foreign = admit(core, 'Foreign synthetic evidence', { ...namespace, ownerId: 'foreign' });
    assert.deepEqual(await recall(core), failed('invalid_model_output'));
    assert.equal(events.length, 1);
    event(events[0], stage, 'core_validation', reason);
  }
});

test('diagnostics: namespace selection bounds remain strict', async (t) => {
  const { core, events } = fixture(t);
  for (let i = 0; i < 13; i++) admit(core, `Synthetic ${i}`);
  assert.deepEqual(await recall(core), failed('invalid_model_output'));
  event(events.at(-1), 'select', 'core_validation', 'namespace_selection_limit');
});

test('diagnostics: extraction and classification validation preserve admitted-but-unfiled capture', async (t) => {
  const extraction = fixture(t, { extract: () => ({ items: [{ content: secret, sourceIndices: [99] }] }) });
  assert.deepEqual(await capture(extraction.core), failed('invalid_model_output'));
  event(extraction.events.at(-1), 'extract', 'core_validation', 'invalid_extraction');
  const classification = fixture(t, { classify: () => ({ items: [] }) });
  const value = ok(await capture(classification.core));
  assert.equal(value.admission.memories.length, 1);
  assert.equal(value.classification.status, 'failed');
  event(classification.events.at(-1), 'classify', 'core_validation', 'invalid_classification');
  const stored = ok(classification.core.get({ namespace, memoryId: value.admission.memories[0].id }));
  assert.equal(stored.memory.filing.status, 'unfiled');
});

test('diagnostics: successful capture and recall emit nothing, including after final evidence read', async (t) => {
  const captureFixture = fixture(t);
  ok(await capture(captureFixture.core));
  assert.deepEqual(captureFixture.events, []);
  const { core, events } = fixture(t);
  admit(core);
  assert.equal(ok(await recall(core)).memories.length, 1);
  await setImmediate();
  assert.deepEqual(events, []);
});

test('diagnostics: static core call reasons across all ports never reflect forged error fields', async () => {
  const circular = {}; circular.self = circular;
  const cases = [
    ['model_not_configured', 'model_not_configured', { callback: undefined }],
    ['context_budget_exceeded', 'context_budget_exceeded', { contextWindow: 1 }],
    ['token_count_unavailable', 'token_count_unavailable', { countTokens: () => NaN }],
    ['provider_failure', 'recall_failed', { callback: () => { throw { code: secret, reason: secret, stage: secret }; } }],
    ['provider_failure', 'recall_failed', { callback: () => { throw { code: 'invalid_model_output', reason: 'output_bounds' }; } }],
    ['model_cancelled', 'model_cancelled', { callback: () => { throw new DOMException(secret, 'AbortError'); } }],
    ['adapter_output_invalid', 'invalid_model_output', { callback: () => { throw new MemoryStoreError('invalid_model_output'); } }],
    ['output_serialization', 'invalid_model_output', { callback: () => circular }],
    ['output_bounds', 'invalid_model_output', { callback: () => ({ text: 'x'.repeat(40001) }) }],
  ];
  for (const stage of ['extract', 'classify', 'select', 'rank']) for (const [reason, code, options] of cases) {
    const events = [];
    const { callback = () => ({}), ...settings } = options;
    const model = { contextWindow: 8192, countTokens: () => 1, [stage]: callback,
      onDiagnostic: (e) => events.push(e), ...settings };
    if (reason === 'model_not_configured') delete model[stage];
    await assert.rejects(callModel(model, stage, secret, { query: secret }), (e) => e.code === code);
    assert.equal(events.length, 1, `${stage}/${reason}`);
    event(events[0], stage, 'core_call', reason);
  }
});

test('diagnostics: throwing and rejecting observers preserve byte-identical public failures', async (t) => {
  for (const onDiagnostic of [undefined, () => { throw new Error(secret); }, async () => { throw new Error(secret); },
    (e) => { e.reason = secret; }]) {
    const { core } = fixture(t, { select: () => ({ refs: [], extra: secret }), onDiagnostic });
    admit(core);
    assert.equal(JSON.stringify(await recall(core)), JSON.stringify(failed('invalid_model_output')));
    await setImmediate();
  }
});

test('diagnostics: core deadline emits timeout without observer interference', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  const model = { contextWindow: 8192, countTokens: () => 1, select: () => new Promise(() => {}),
    onDiagnostic: (e) => events.push(e) };
  const pending = assert.rejects(callModel(model, 'select', secret, {}), (e) => e.code === 'model_timeout');
  await setImmediate();
  t.mock.timers.tick(30000);
  await pending;
  event(events[0], 'select', 'core_call', 'model_timeout');
});
