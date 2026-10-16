import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { setImmediate } from 'node:timers/promises';
import nodeTest from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsCore = major > 22 || major === 22 && minor >= 16;
const skip = supportsCore ? false : 'Requires Node >=22.16: the evaluation helper reuses SQLite-bound core modules.';
const test = (name, run) => nodeTest(name, { skip }, run);
// Even pure preparation imports core/capture, whose transitive dependencies
// require node:sqlite. Keep that boundary explicit in the generic Node 20 suite.
const [{ DatabaseSync }, { openMemoryCore }, { captureSnapshot }, { sourceWindowCatalog },
  { extractionRequest }, { modelRequestText }, { prepareRoleStratifiedExtraction,
    roleStratifiedExtractionSchema, compileRoleStratifiedExtraction, createRoleStratifiedModel }] = supportsCore
  ? await Promise.all([import('node:sqlite'), import('../../../core/contract.mjs'),
    import('../../../core/capture-input.mjs'), import('../../../core/source-windows.mjs'),
    import('../../../core/capture.mjs'), import('../../../core/model-call.mjs'),
    import('../role-stratified-extraction.mjs')]) : Array.from({ length: 7 }, () => ({}));

const namespace = { ownerId: 'role-test', scope: 'personal', projectId: null };
const options = { captureSourcePolicy: 'indexed-evidence-v1' };
const input = (texts = ['2026-09-01: I planted the oak.', 'Use mulch around the oak.'], patch = {}) => ({
  namespace, client: 'synthetic', sessionId: 'session', eventId: 'batch',
  messages: texts.map((content, index) => ({ id: `message-${index}`, role: index % 2 ? 'assistant' : 'user', content })), ...patch,
});
const item = (sourceIndices, content = 'A synthetic supported claim', kind = 'context') => ({
  content, kind, confidence: 0.8, sourceIndices,
});
const proposal = (userItems = [item([0])], assistantItems = []) => ({ userItems, assistantItems });
const prepare = value => prepareRoleStratifiedExtraction(value, options);
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const denied = (result, code) => { assert.equal(result.ok, false); assert.equal(result.error.code, code); };
const code = expected => error => error.code === expected && error.message === expected;
const classify = ({ input: wire }) => ({ items: wire.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) });
const frozen = value => { if (value && typeof value === 'object') {
  assert.equal(Object.isFrozen(value), true); for (const child of Object.values(value)) frozen(child);
} };

function fixture(t, value = input(), overrides = {}, coreOptions = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-role-extraction-' });
  const path = join(workspace.path, 'store.sqlite');
  const prepared = prepare(value), calls = [];
  const port = { contextWindow: 8192, countTokens: () => 1,
    extractRoleStratified(request) { calls.push('extractRoleStratified');
      return overrides.extractRoleStratified ? overrides.extractRoleStratified.call(this, request) : proposal(); },
    classify(request) { calls.push('classify'); return overrides.classify ? overrides.classify.call(this, request) : classify(request); },
    ...(overrides.countTokens ? { countTokens: overrides.countTokens } : {}),
    ...(Object.hasOwn(overrides, 'contextWindow') ? { contextWindow: overrides.contextWindow } : {}) };
  const model = createRoleStratifiedModel(prepared, port);
  const core = openMemoryCore({ path, model, ...options, ...coreOptions });
  workspace.defer(() => core.close());
  const db = new DatabaseSync(path); workspace.defer(() => db.close());
  const rows = table => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  return { workspace, path, prepared, port, model, core, calls, rows };
}

const invoke = (model, prepared, signal = new AbortController().signal, patch = {}) => model.extract({
  ...structuredClone(prepared.baselineRequest), signal, ...patch,
});

test('R1/R2 canonical catalog and ordinary baseline request remain identical, complete and source-only', () => {
  const value = input([' Ａ 😀 ' + 'b'.repeat(3990), 'Assistant context.']);
  const prepared = prepare(value);
  const snapshot = captureSnapshot(value, undefined, options.captureSourcePolicy);
  const baseline = extractionRequest(snapshot, options);
  assert.equal(JSON.stringify(prepared.baselineRequest), JSON.stringify({ system: baseline.system, input: baseline.input, maxOutputTokens: 1024 }));
  assert.deepEqual(prepared.request.input, sourceWindowCatalog(snapshot).input);
  assert.deepEqual(prepared.request.input, prepared.baselineRequest.input);
  assert.deepEqual(Object.keys(prepared.request).sort(), ['input', 'maxOutputTokens', 'system']);
  assert.deepEqual(Object.keys(prepared.request.input).sort(), ['inputMode', 'messages']);
  for (const row of prepared.request.input.messages) assert.deepEqual(Object.keys(row).sort(), ['content', 'index', 'messageIndex', 'role']);
  assert.equal(prepared.request.input.messages.length, 6);
  assert.equal(prepared.request.input.messages[0].content.startsWith('A 😀'), true);
  for (const row of prepared.request.input.messages) { assert.equal(row.content.isWellFormed(), true); assert.ok(row.content.length <= 800); }
  assert.equal(prepared.request.input.messages.map(row => row.content).join('').includes('synthetic'), false);
  frozen(prepared);
  value.messages[0].content = 'caller changed';
  assert.notEqual(prepared.capture.messages[0].content, value.messages[0].content);
});

test('R1 omitted/incompatible modes, malformed identity and all source bounds fail before callbacks', () => {
  for (const config of [undefined, {}, null, { captureSourcePolicy: 'indexed-windows-v1' },
    { captureSourcePolicy: 'indexed-evidence-v1', captureQualification: 'source-bound-v2' },
    ...['captureEvidence', 'captureRationale', 'sessionEpisodes', 'causal'].map(name => ({ ...options, [name]: null }))]) {
    assert.throws(() => prepareRoleStratifiedExtraction(input(), config), code('invalid_input'));
  }
  for (const value of [input([], {}), input(Array(25).fill('x')), input(['x'.repeat(4001)]),
    input(Array(6).fill('x'.repeat(4000))), input(['\ud800']),
    input(['x'], { causal: null }), input(['x'], { episodeContext: {} }),
    input(['x'], { namespace: { ...namespace, scope: 'project', projectId: null } }),
    input(['x'], { namespace: { ...namespace, ownerId: '' } }),
    input(['x'], { namespace: { ...namespace, projectId: 'invalid' } })]) assert.throws(() => prepare(value), code('invalid_input'));
  const max = input(Array(24).fill('x'));
  assert.equal(prepare(max).request.input.messages.length, 24);
  assert.equal(prepare(input(Array(5).fill('x'.repeat(4000)))).request.input.messages.length, 25);
  assert.equal(prepare(input(Array(24).fill('x' + ' '.repeat(19999)))).request.input.messages.length, 24);
  const duplicate = input(); duplicate.messages[1].id = duplicate.messages[0].id;
  assert.throws(() => prepare(duplicate), code('invalid_input'));
});

test('R1/R4 strict snapshots reject getters, hooks, custom objects, symbols, holes, cycles and nonfinite data without executing them', () => {
  let reads = 0;
  const accessor = input(); Object.defineProperty(accessor.messages[0], 'content', { enumerable: true, get() { reads++; return 'unsafe'; } });
  const optionsAccessor = {}; Object.defineProperty(optionsAccessor, 'captureSourcePolicy', { enumerable: true, get() { reads++; return options.captureSourcePolicy; } });
  assert.throws(() => prepare(accessor), code('invalid_input'));
  assert.throws(() => prepareRoleStratifiedExtraction(input(), optionsAccessor), code('invalid_input'));
  const hook = input(); hook.toJSON = () => { reads++; return {}; };
  const cycle = input(); cycle.messages.push(cycle);
  const symbol = input(); symbol[Symbol('private')] = 1;
  const hidden = input(); Object.defineProperty(hidden, 'hidden', { value: 1 });
  const exotic = input(); exotic.messages[0] = new Date();
  const arrayPrototype = input(); Object.setPrototypeOf(arrayPrototype.messages, null);
  const proxy = new Proxy(input(), { ownKeys() { reads++; return []; } });
  for (const value of [hook, cycle, symbol, hidden, exotic, arrayPrototype, proxy,
    input(['x'], { messages: Array(1) }), input(['x'], { eventId: Infinity })]) assert.throws(() => prepare(value), code('invalid_input'));
  const prepared = prepare(input());
  const outputAccessor = proposal(); Object.defineProperty(outputAccessor.userItems[0], 'content', { enumerable: true, get() { reads++; return 'unsafe'; } });
  const outputHook = proposal(); outputHook.toJSON = () => { reads++; return {}; };
  const outputCycle = proposal(); outputCycle.userItems[0].sourceIndices.push(outputCycle);
  for (const value of [outputAccessor, outputHook, outputCycle, proposal([item([0], '\ud800')]),
    proposal([Object.assign(item([0]), { confidence: NaN })]), proposal(Array(1)),
    proposal([Object.assign(item([0]), { sourceIndices: Object.assign([0], { extra: true }) })])]) {
    assert.throws(() => compileRoleStratifiedExtraction(prepared, value), code('invalid_model_output'));
  }
  assert.equal(reads, 0);
});

test('R3/R4 exact quotas, legal empty groups, cross-role support and detached original groups compile atomically', () => {
  const prepared = prepare(input());
  const source = proposal([item([0], '  Ａ  '), item([0, 1], 'Cross-role context'), item([0], 'Third')],
    [item([1, 0], 'First assistant'), item([1], 'Second assistant')]);
  const result = compileRoleStratifiedExtraction(prepared, source);
  assert.equal(result.output.items.length, 5);
  assert.equal(result.output.items[0].content, 'A');
  assert.equal(result.observation.proposal.userItems[0].content, '  Ａ  ');
  assert.deepEqual(result.observation.groups, { userItems: { start: 0, count: 3 }, assistantItems: { start: 3, count: 2 } });
  source.userItems[0].sourceIndices[0] = 99;
  assert.deepEqual(result.output.items[0].sourceIndices, [0]); frozen(result);
  for (const output of [proposal([], []), proposal([], [item([1])]), proposal([item([0])], [])]) {
    assert.equal(compileRoleStratifiedExtraction(prepared, output).output.items.length,
      output.userItems.length + output.assistantItems.length);
  }
  const invalid = [proposal(Array.from({ length: 4 }, () => item([0]))), proposal([], Array.from({ length: 3 }, () => item([1]))),
    { userItems: [] }, { assistantItems: [] }, { ...proposal(), extra: true }, { items: [item([0])] },
    proposal([item([1])]), proposal([], [item([0])]), proposal([item([0, 0])]),
    proposal([item([0]), item([99])]), proposal([item([0]), item([0], 'bad', 'invented')]),
    proposal([item([0]), item([0], 'x'.repeat(601))]), proposal([item([0, 1, 2, 3, 4])]),
    proposal([item([0.5])]), proposal([item([-1])]), proposal([item([])])];
  for (const value of invalid) assert.throws(() => compileRoleStratifiedExtraction(prepared, value), code('invalid_model_output'));
  for (const fake of [{ ...prepared }, structuredClone(prepared), null, prepare(input(['Other', 'Source'])).request]) {
    assert.throws(() => compileRoleStratifiedExtraction(fake, proposal()), code('invalid_input'));
    assert.throws(() => createRoleStratifiedModel(fake, {}), code('invalid_input'));
  }
});

test('R2/R3 provider schema is exact JSON with legal empty arrays and private catalog index bounds', () => {
  const prepared = prepare(input(['a'.repeat(801), 'Assistant']));
  const schema = roleStratifiedExtractionSchema(prepared);
  frozen(schema); assert.deepEqual(JSON.parse(JSON.stringify(schema)), schema);
  assert.equal(schema.type, 'object'); assert.equal(schema.additionalProperties, false);
  assert.deepEqual(schema.required, ['userItems', 'assistantItems']);
  assert.deepEqual(Object.keys(schema.properties), ['userItems', 'assistantItems']);
  for (const [name, maximum] of [['userItems', 3], ['assistantItems', 2]]) {
    const group = schema.properties[name];
    assert.equal(group.type, 'array'); assert.equal(group.minItems, 0); assert.equal(group.maxItems, maximum);
    const entry = group.items;
    assert.equal(entry.additionalProperties, false);
    assert.deepEqual(entry.required, ['content', 'kind', 'confidence', 'sourceIndices']);
    assert.deepEqual(Object.keys(entry.properties), entry.required);
    assert.deepEqual(entry.properties.kind.enum, ['fact', 'preference', 'decision', 'instruction', 'context']);
    assert.equal(entry.properties.content.minLength, 1); assert.equal(entry.properties.content.maxLength, 600);
    assert.deepEqual(entry.properties.confidence, { type: 'number', minimum: 0, maximum: 1 });
    const indices = entry.properties.sourceIndices;
    assert.equal(indices.minItems, 1); assert.equal(indices.maxItems, 4);
    assert.equal(Object.hasOwn(indices, 'uniqueItems'), false);
    assert.match(indices.description, /distinct indices/);
    assert.deepEqual(indices.items, { type: 'integer', minimum: 0, maximum: 2 });
  }
  assert.deepEqual(compileRoleStratifiedExtraction(prepared, proposal([], [])).output, { items: [] });
  assert.throws(() => compileRoleStratifiedExtraction(prepared, proposal([item([0, 0])])), code('invalid_model_output'));
  assert.equal(roleStratifiedExtractionSchema(prepare(input(['Only user']))).properties.userItems.items.properties.sourceIndices.items.maximum, 0);
  for (const fake of [null, {}, { ...prepared }, structuredClone(prepared), prepared.request]) {
    assert.throws(() => roleStratifiedExtractionSchema(fake), code('invalid_input'));
  }
});

test('R3 duplicate receipt identities fail even when mixed distinct window indices look valid', () => {
  const prepared = prepare(input(['x'.repeat(1600), 'Assistant']));
  assert.throws(() => compileRoleStratifiedExtraction(prepared, proposal([item([0, 1])])), code('invalid_model_output'));
  const mixed = prepare(input(['x'.repeat(800) + 'y'.repeat(800), 'Assistant']));
  assert.deepEqual(compileRoleStratifiedExtraction(mixed, proposal([item([0, 1, 2])])).output.items[0].sourceIndices, [0, 1, 2]);
});

test('R1/R3 astral boundary and redaction reuse core canonical slices, including four exact receipts', () => {
  const secret = 'sk-' + 'a'.repeat(48);
  const value = input(['x'.repeat(799) + '😀' + 'y'.repeat(798) + 'z'.repeat(800) + `Private ${secret} tail`, 'Assistant']);
  const prepared = prepare(value);
  const windows = prepared.request.input.messages;
  assert.equal(windows[0].content.length, 799); assert.equal(windows[1].content.startsWith('😀'), true);
  assert.equal(windows[1].content.length, 800);
  assert.equal(windows.slice(0, 4).map(row => row.content).join('').includes(secret), false);
  assert.equal(windows[3].content.includes('Private [REDACTED] tail'), true);
  assert.equal(windows.every(row => row.content.isWellFormed()), true);
  assert.deepEqual(compileRoleStratifiedExtraction(prepared, proposal([item([0, 1, 2, 3])])).output.items[0].sourceIndices, [0, 1, 2, 3]);
});

test('R4/R6 counter and caller output mutations cannot rewrite trusted preparation or compiled observations', async t => {
  const value = input(); let altered = false;
  const returned = proposal([item([0], 'Original proposal')], [item([1], 'Assistant information')]);
  const f = fixture(t, value, {
    countTokens(text) {
      value.messages[0].content = 'counter changed caller source';
      if (text.startsWith('{"userItems":') && !altered) {
        altered = true; returned.userItems[0].content = 'counter changed returned proposal';
        returned.userItems[0].sourceIndices[0] = 1;
      }
      return 1;
    }, extractRoleStratified: () => returned,
  });
  const result = ok(await f.core.capture(f.prepared.capture)); assert.equal(result.admission.memories.length, 2);
  const observed = f.model.observe(); assert.equal(observed.proposal.userItems[0].content, 'Original proposal');
  assert.deepEqual(observed.output.items[0].sourceIndices, [0]);
  const user = result.admission.memories.map(row => ok(f.core.get({ namespace, memoryId: row.id })))
    .find(row => row.memory.content === 'Original proposal');
  assert.equal(user.receipts[0].excerpt, '2026-09-01: I planted the oak.');
  assert.throws(() => { observed.groups.userItems.count = 99; });
  assert.throws(() => { f.prepared.request.input.messages[0].role = 'assistant'; });
});

test('R6 exact three/two cap admits five ordinary claims and overflow never borrows an empty group slot', async t => {
  const full = proposal(Array.from({ length: 3 }, (_, i) => item([0], `User claim ${i}`)),
    Array.from({ length: 2 }, (_, i) => item([1], `Assistant claim ${i}`)));
  const f = fixture(t, input(), { extractRoleStratified: () => full });
  assert.equal(ok(await f.core.capture(f.prepared.capture)).admission.memories.length, 5);
  for (const output of [proposal(Array.from({ length: 4 }, (_, i) => item([0], `User claim ${i}`)), []),
    proposal([], Array.from({ length: 3 }, (_, i) => item([1], `Assistant claim ${i}`)))]) {
    const overflow = fixture(t, input(), { extractRoleStratified: () => output });
    denied(await overflow.core.capture(overflow.prepared.capture), 'invalid_model_output');
    assert.equal(overflow.rows('memories'), 0); assert.deepEqual(overflow.calls, ['extractRoleStratified']);
  }
});

test('R5 actual replacement full-wire preflight, both output budgets, port binding and captured counter are enforced', async t => {
  const counts = [];
  const f = fixture(t, input(), {
    countTokens(text) { assert.equal(this, f.port); counts.push(text); return 1; },
    extractRoleStratified(request) { assert.equal(this, f.port); assert.equal(request.system, f.prepared.request.system);
      assert.deepEqual(request.input, f.prepared.request.input); return proposal(); },
    classify(request) { assert.equal(this, f.port); return classify(request); },
  });
  const captured = f.port.countTokens;
  f.port.countTokens = () => { assert.fail('counter replaced after binding'); };
  f.port.extractRoleStratified = () => { assert.fail('port replaced after binding'); };
  f.port.contextWindow = 1;
  assert.equal(typeof captured, 'function');
  const result = ok(await f.core.capture(f.prepared.capture));
  assert.equal(result.classification.status, 'applied');
  assert.deepEqual(f.calls, ['extractRoleStratified', 'classify']);
  const replacement = modelRequestText(f.prepared.request.system, f.prepared.request.input);
  assert.ok(counts.filter(text => text === replacement).length >= 3);
  assert.equal(counts.includes(modelRequestText(f.prepared.baselineRequest.system, f.prepared.baselineRequest.input)), false);
  assert.ok(counts.includes(JSON.stringify(proposal())));
  assert.ok(counts.includes(JSON.stringify(f.model.observe().output)));
  frozen(f.model.observe());
  assert.deepEqual(f.model.observe().actualRequest, f.prepared.request);
  assert.deepEqual(f.model.observe().proposal, proposal());
  const oversized = fixture(t, input(), { countTokens: text => text.startsWith('{"system":') ? 6001 : 1 });
  denied(await oversized.core.capture(oversized.prepared.capture), 'context_budget_exceeded');
  assert.equal(oversized.rows('admission_claims'), 0); assert.deepEqual(oversized.calls, []);
  const outputHeavy = fixture(t, input(), { countTokens: text => text.startsWith('{"items":') ? 1025 : 1 });
  denied(await outputHeavy.core.capture(outputHeavy.prepared.capture), 'invalid_model_output');
  assert.equal(outputHeavy.rows('memories'), 0); assert.deepEqual(outputHeavy.calls, ['extractRoleStratified']);
  const groupedHeavy = fixture(t, input(), { countTokens: text => text.startsWith('{"userItems":') ? 1025 : 1 });
  denied(await groupedHeavy.core.capture(groupedHeavy.prepared.capture), 'invalid_model_output');
  assert.equal(groupedHeavy.rows('memories'), 0);
  for (const countTokens of [() => -1, () => 0.5, () => NaN, () => { throw new Error('source-free-counter'); }]) {
    const badCounter = fixture(t, input(), { countTokens });
    denied(await badCounter.core.capture(badCounter.prepared.capture), 'token_count_unavailable'); assert.deepEqual(badCounter.calls, []);
  }
  const small = fixture(t, input(), { contextWindow: 8191 });
  denied(await small.core.capture(small.prepared.capture), 'context_budget_exceeded'); assert.deepEqual(small.calls, []);
});

test('R5 exact request and one-invocation fences fail closed, including accessor request fields', async () => {
  const prepared = prepare(input()); let calls = 0, reads = 0;
  const port = { contextWindow: 8192, countTokens: () => 1, extractRoleStratified() { calls++; return proposal(); } };
  for (const patch of [{ system: 'stale' }, { input: { ...prepared.baselineRequest.input, question: 'forbidden' } },
    { input: { ...prepared.baselineRequest.input, messages: [] } }, { maxOutputTokens: 1025 }]) {
    const model = createRoleStratifiedModel(prepared, port);
    await assert.rejects(invoke(model, prepared, undefined, patch), code('invalid_input'));
    await assert.rejects(invoke(model, prepared), code('invalid_input'));
  }
  const model = createRoleStratifiedModel(prepared, port);
  const request = { ...prepared.baselineRequest, signal: new AbortController().signal };
  Object.defineProperty(request, 'input', { enumerable: true, get() { reads++; return {}; } });
  await assert.rejects(model.extract(request), code('invalid_input'));
  assert.equal(reads, 0); assert.equal(calls, 0);
  const once = createRoleStratifiedModel(prepared, port);
  await invoke(once, prepared); await assert.rejects(invoke(once, prepared), code('invalid_input'));
  assert.equal(calls, 1);
});

test('R5/R6 short user event survives long assistant reply, classify/reopen/source reads use ordinary trusted binding', async t => {
  const value = input(['2026-09-01: I planted an oak.', 'An assistant recommendation. ' + 'Details. '.repeat(410)]);
  const f = fixture(t, value, { extractRoleStratified({ input: wire }) {
    assert.equal(wire.messages.length, 6);
    assert.throws(() => { wire.messages[0].content = 'forged'; });
    value.messages[0].content = 'caller changed during extraction';
    return proposal([item([0], 'The user reported planting an oak on 2026-09-01.', 'fact')],
      [item([1], 'The assistant offered a recommendation.', 'context')]);
  } });
  const captured = ok(await f.core.capture(f.prepared.capture));
  assert.equal(captured.admission.memories.length, 2); assert.equal(captured.classification.status, 'applied');
  f.core.close();
  const reopened = openMemoryCore({ path: f.path, ...options, model: { countTokens: () => 1 } });
  f.workspace.defer(() => reopened.close());
  const sources = ok(reopened.sourceSnapshot({ readSet: [namespace], limit: 5 }));
  assert.equal(sources.memories.length, 2);
  const receipts = sources.memories.flatMap(row => row.receipts);
  assert.equal(receipts.find(receipt => receipt.role === 'user').excerpt, '2026-09-01: I planted an oak.');
  assert.equal(receipts.some(receipt => receipt.excerpt.includes('forged') || receipt.excerpt.includes('caller changed')), false);
  assert.deepEqual(f.calls, ['extractRoleStratified', 'classify']);
});

test('R6 scripted attribution, rejected proposal, assistant-only utility and cross-role context retain source attribution', async t => {
  const cases = [
    { value: input(['My sister said, "I moved on 2026-09-02."', 'That is your sister\'s event.']),
      output: proposal([item([0], 'The user reported their sister said she moved on 2026-09-02.')]) },
    { value: input(['I need a schedule.', 'I suggest switching to Monday.', 'I reject Monday; keep Friday.']),
      output: proposal([item([1, 2], 'The user rejected the assistant\'s Monday proposal and kept Friday.', 'decision')],
        [item([1, 2], 'The assistant proposed Monday; the user rejected it.')]) },
    { value: input(['The library closes at 18:00.'], { messages: [{ id: 'assistant-source', role: 'assistant', content: 'The library closes at 18:00.' }] }),
      output: proposal([], [item([0], 'The assistant said the library closes at 18:00.')]) },
    { value: input(['On 2026-09-03, I will plant it tomorrow if it rains.', 'Here "tomorrow" means 2026-09-04.']),
      output: proposal([item([0, 1], 'On 2026-09-03 the user planned planting for the next day if it rained.')]) },
  ];
  for (const { value, output } of cases) {
    const f = fixture(t, value, { extractRoleStratified: () => output });
    const result = ok(await f.core.capture(f.prepared.capture));
    assert.equal(result.admission.memories.length, output.userItems.length + output.assistantItems.length);
    for (const row of result.admission.memories) {
      const saved = ok(f.core.get({ namespace, memoryId: row.id }));
      const expected = [...output.userItems, ...output.assistantItems].find(entry => entry.content === saved.memory.content);
      assert.ok(expected); assert.equal(saved.receipts.length, expected.sourceIndices.length);
      const identities = saved.receipts.map(receipt => JSON.stringify([receipt.role, receipt.excerpt])).sort();
      assert.deepEqual(identities, expected.sourceIndices.map(index => {
        const source = f.prepared.request.input.messages[index]; return JSON.stringify([source.role, source.content]);
      }).sort());
    }
  }
});

test('R6 empty groups never force claims or classification and later invalid item rejects the entire admission', async t => {
  const empty = fixture(t, input(), { extractRoleStratified: () => proposal([], []) });
  const result = ok(await empty.core.capture(empty.prepared.capture));
  assert.deepEqual(result.admission.memories, []); assert.equal(result.classification.reason, 'empty');
  assert.deepEqual(empty.calls, ['extractRoleStratified']);
  assert.deepEqual(empty.model.observe().output, { items: [] });
  for (const output of [proposal([item([0]), item([99])]), proposal([item([0])], [item([1]), item([99])])]) {
    const f = fixture(t, input(), { extractRoleStratified: () => output });
    denied(await f.core.capture(f.prepared.capture), 'invalid_model_output');
    assert.equal(f.rows('memories'), 0); assert.equal(f.rows('receipts'), 0);
    assert.deepEqual(f.calls, ['extractRoleStratified']);
    assert.deepEqual(f.model.observe().proposal, output); assert.equal(f.model.observe().output, null);
  }
});

test('R5/R6 model-returned accessors and toJSON are rejected before core serialization with source-free errors', async t => {
  let reads = 0;
  const accessor = proposal(); Object.defineProperty(accessor.userItems[0], 'content', { enumerable: true, get() { reads++; return 'PRIVATE_SOURCE'; } });
  const hook = proposal(); hook.toJSON = () => { reads++; return proposal(); };
  const thenAccessor = proposal(); Object.defineProperty(thenAccessor, 'then', { enumerable: true,
    get() { reads++; return undefined; } });
  for (const output of [accessor, hook, thenAccessor]) {
    const f = fixture(t, input(['PRIVATE_SOURCE', 'Assistant']), { extractRoleStratified: () => output });
    const result = await f.core.capture(f.prepared.capture); denied(result, 'invalid_model_output');
    assert.equal(JSON.stringify(result).includes('PRIVATE_SOURCE'), false); assert.equal(f.rows('memories'), 0);
  }
  const failed = fixture(t, input(), { extractRoleStratified() { throw new Error('PRIVATE_SOURCE'); } });
  const result = await failed.core.capture(failed.prepared.capture); denied(result, 'extraction_failed');
  assert.equal(JSON.stringify(result).includes('PRIVATE_SOURCE'), false); assert.equal(reads, 0);
  assert.deepEqual(failed.calls, ['extractRoleStratified']);
  const asyncPort = fixture(t, input(), { async extractRoleStratified() { return proposal(); } });
  assert.equal(ok(await asyncPort.core.capture(asyncPort.prepared.capture)).admission.memories.length, 1);
});

test('R5/R6 a pre-dispatch timeout settles without waiting for a provider readiness event', async t => {
  const timed = fixture(t, input(), { countTokens() {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 60); return 1;
  } }, { captureDeadlineMs: 40 });
  denied(await timed.core.capture(timed.prepared.capture), 'model_timeout');
  assert.deepEqual(timed.calls, []); assert.equal(timed.model.observe().actualRequest, null);
  assert.equal(timed.rows('memories'), 0); assert.equal(timed.rows('receipts'), 0);
});

test('R5/R6 timeout, explicit cancellation and provider AbortError propagate with no retry or partial admission', async t => {
  let seenSignal, started;
  const ready = new Promise(resolve => { started = resolve; });
  const timed = fixture(t, input(), { extractRoleStratified({ signal }) { seenSignal = signal; started(); return new Promise(() => {}); } });
  // Keep the real core's default deadline, but advance its timer only after
  // dispatch. SQLite/startup scheduling cannot consume a short readiness budget.
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const pending = timed.core.capture(timed.prepared.capture);
  try {
    const first = await Promise.race([ready.then(() => 'ready'), pending.then(() => 'capture-settled'),
      setImmediate().then(() => 'not-ready')]);
    assert.equal(first, 'ready', 'provider must start before the test drives its deadline');
    t.mock.timers.tick(29_999); assert.equal(seenSignal.aborted, false);
    t.mock.timers.tick(1);
    denied(await pending, 'model_timeout'); assert.equal(seenSignal.aborted, true);
  } finally {
    // A failed readiness assertion still releases the owned pending capture.
    t.mock.timers.tick(30_000); await pending; t.mock.timers.reset();
  }
  assert.equal(timed.rows('memories'), 0); assert.deepEqual(timed.calls, ['extractRoleStratified']);
  const prepared = prepare(input()), controller = new AbortController(); let reached;
  const entered = new Promise(resolve => { reached = resolve; });
  let signal;
  const model = createRoleStratifiedModel(prepared, { contextWindow: 8192, countTokens: () => 1,
    extractRoleStratified(request) { signal = request.signal; reached(); return new Promise(() => {}); } });
  const cancelled = invoke(model, prepared, controller.signal); await entered; controller.abort();
  await assert.rejects(cancelled, code('model_cancelled')); assert.equal(signal.aborted, true);
  await assert.rejects(invoke(model, prepared), code('invalid_input'));
  const preAborted = new AbortController(); preAborted.abort(); let calls = 0;
  const stopped = createRoleStratifiedModel(prepared, { contextWindow: 8192, countTokens: () => 1,
    extractRoleStratified() { calls++; return proposal(); } });
  await assert.rejects(invoke(stopped, prepared, preAborted.signal), error => error.name === 'AbortError'); assert.equal(calls, 0);
  const aborted = fixture(t, input(), { extractRoleStratified() { const error = new Error('source-free'); error.name = 'AbortError'; throw error; } });
  denied(await aborted.core.capture(aborted.prepared.capture), 'model_cancelled'); assert.deepEqual(aborted.calls, ['extractRoleStratified']);
  const duringCount = new AbortController(); let counterCalls = 0, providerCalls = 0;
  const countCancelled = createRoleStratifiedModel(prepared, { contextWindow: 8192,
    countTokens() { counterCalls++; duringCount.abort(); return 1; },
    extractRoleStratified() { providerCalls++; return proposal(); } });
  await assert.rejects(invoke(countCancelled, prepared, duringCount.signal), code('model_cancelled'));
  assert.equal(counterCalls, 1); assert.equal(providerCalls, 0);
});

test('R6 unchanged baseline accepts assistant-heavy five items and candidate shape rejection alone claims no improvement', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-role-control-' });
  const value = input(); const requests = [];
  const ordinary = { items: Array.from({ length: 5 }, (_, index) => item([1], `Assistant information ${index}`)) };
  const core = openMemoryCore({ path: join(workspace.path, 'control.sqlite'), ...options,
    model: { contextWindow: 8192, countTokens: () => 1, extract(request) { requests.push(request); return ordinary; }, classify } });
  workspace.defer(() => core.close());
  const control = ok(await core.capture(value)); assert.equal(control.admission.memories.length, 5);
  const expected = extractionRequest(captureSnapshot(value, undefined, options.captureSourcePolicy), options);
  assert.equal(requests[0].system, expected.system);
  assert.equal(JSON.stringify(requests[0].input), JSON.stringify(expected.input));
  const candidate = fixture(t, value, { extractRoleStratified: () => ordinary });
  denied(await candidate.core.capture(candidate.prepared.capture), 'invalid_model_output'); assert.equal(candidate.rows('memories'), 0);
});

test('R6 namespace, duplicate, correction and forgetting fences remain under ordinary core authority', async t => {
  const f = fixture(t); const first = ok(await f.core.capture(f.prepared.capture)); const memoryId = first.admission.memories[0].id;
  const foreign = { ...namespace, ownerId: 'other-owner' };
  denied(f.core.get({ namespace: foreign, memoryId }), 'memory_not_found');
  const saved = ok(f.core.get({ namespace, memoryId }));
  const corrected = ok(f.core.correct({ namespace, memoryId, expectedRevision: saved.memory.revision,
    content: 'Manual corrected claim', kind: 'context', receipt: { client: 'manual', sessionId: 'manual', eventId: 'manual', role: 'user', excerpt: 'Manual corrected claim' } }));
  assert.equal(ok(await f.core.capture(f.prepared.capture)).duplicate, true);
  assert.equal(ok(f.core.get({ namespace, memoryId })).memory.content, 'Manual corrected claim');
  ok(f.core.forget({ namespace, memoryId, expectedRevision: corrected.memory.revision }));
  assert.equal(ok(await f.core.capture(f.prepared.capture)).duplicate, true); denied(f.core.get({ namespace, memoryId }), 'memory_not_found');
  const nextInput = input(undefined, { eventId: 'new-event' }); const nextPrepared = prepare(nextInput);
  const next = openMemoryCore({ path: f.path, ...options, model: createRoleStratifiedModel(nextPrepared,
    { contextWindow: 8192, countTokens: () => 1, extractRoleStratified: () => proposal(), classify }) });
  f.workspace.defer(() => next.close());
  assert.equal(ok(await next.capture(nextPrepared.capture)).admission.suppressedCount, 1);
  const foreignPrepared = prepare(input(undefined, { namespace: foreign, eventId: 'foreign-event' }));
  const other = openMemoryCore({ path: f.path, ...options, model: createRoleStratifiedModel(foreignPrepared,
    { contextWindow: 8192, countTokens: () => 1, extractRoleStratified: () => proposal(), classify }) });
  f.workspace.defer(() => other.close());
  assert.equal(ok(await other.capture(foreignPrepared.capture)).admission.memories.length, 1);
});

test('R7 runner removes fresh synthetic store scratch after both success and assertion failure', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-role-runner-probe-' });
  const script = join(workspace.path, 'probe.mjs');
  const coreURL = pathToFileURL(fileURLToPath(new URL('../../../core/contract.mjs', import.meta.url))).href;
  const workspaceURL = new URL('../../../tools/testing/workspace.mjs', import.meta.url).href;
  writeFileSync(script, `import assert from 'node:assert/strict';\nimport { join } from 'node:path';\nimport { openMemoryCore } from ${JSON.stringify(coreURL)};\nimport { createTestWorkspace } from ${JSON.stringify(workspaceURL)};\nconst workspace = createTestWorkspace(null, { prefix: 'cairn-role-child-' });\nconst core = openMemoryCore({ path: join(workspace.path, 'synthetic.sqlite') });\nconsole.log(JSON.stringify({ path: workspace.path }));\ntry { assert.equal(process.argv[2], 'success'); } finally { core.close(); }\n`);
  const runner = fileURLToPath(new URL('../../../tools/testing/run.mjs', import.meta.url));
  for (const outcome of ['success', 'failure']) {
    const result = spawnSync(process.execPath, [runner, '--script', script, outcome], { encoding: 'utf8' });
    assert.equal(result.status, outcome === 'success' ? 0 : 1, result.stderr);
    const line = result.stdout.split('\n').find(line => line.startsWith('{"path":'));
    assert.ok(line); const child = JSON.parse(line).path;
    assert.equal(existsSync(child), false); assert.equal(existsSync(join(child, 'synthetic.sqlite')), false);
  }
});
