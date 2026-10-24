import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { setImmediate } from 'node:timers/promises';
import nodeTest from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const [major, minor] = process.versions.node.split('.').map(Number);
const supportsCore = major > 22 || major === 22 && minor >= 16;
const test = (name, fn) => nodeTest(name, { skip: supportsCore ? false : 'Requires Node >=22.16 (core SQLite).' }, fn);
const [{ openMemoryCore }, { captureSnapshot }, { extractionRequest }, { extractedWindowItems },
  { modelRequestText }, { prepareSourceSelectionMemory, sourceSelectionMemorySchema,
    compileSourceSelectionMemory, createSourceSelectionModel }] = supportsCore ? await Promise.all([
  import('../../../core/contract.mjs'), import('../../../core/capture-input.mjs'),
  import('../../../core/capture.mjs'), import('../../../core/source-windows.mjs'),
  import('../../../core/model-call.mjs'), import('../source-selection-memory.mjs'),
]) : Array.from({ length: 6 }, () => ({}));

const namespace = { ownerId: 'source-selection-synthetic', scope: 'personal', projectId: null };
const policy = { captureSourcePolicy: 'indexed-evidence-v1' };
const input = (texts = ['The Lumen hatch needs inspection.', 'Use the amber inspection card.'], patch = {}) => ({
  namespace, client: 'synthetic', sessionId: 'session', eventId: 'batch',
  messages: texts.map((content, index) => ({ id: `source-${index}`, role: index % 2 ? 'assistant' : 'user', content })), ...patch,
});
const prepare = value => prepareSourceSelectionMemory(JSON.stringify(value));
const selection = (...groups) => JSON.stringify({ groups: groups.map(sourceIndices => ({ sourceIndices })) });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const denied = (result, code) => { assert.equal(result.ok, false, JSON.stringify(result)); assert.equal(result.error.code, code); };
const code = expected => error => error.code === expected && error.message === expected;
const deepFrozen = value => { if (value && typeof value === 'object') {
  assert.equal(Object.isFrozen(value), true); for (const child of Object.values(value)) deepFrozen(child);
} };
const emptyPlacement = ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) });
const topicPlacement = ({ input }) => ({ items: input.memories.map(memory => {
  const existing = input.map.find(row => row.type === 'moc' && row.moc.level === 'L1');
  return { memoryId: memory.id, parentIds: existing ? [existing.moc.id] : [],
    ...(!existing ? { newL1: { title: 'Lumen hatch inspections', parentL2Ids: [] } } : {}) };
}) });
// These scripts choose only from actual model inputs, never closure memory IDs.
const recallSelect = ({ input }) => ({ refs: input.maps.flatMap(map => map.items.flatMap(row => {
  const ref = row.type === 'unfiled' ? row.ref : row.type === 'ref' && row.ref.childType === 'memory'
    ? { memoryId: row.ref.childId, revision: row.ref.childRevision } : null;
  return ref ? [{ namespaceIndex: map.namespaceIndex, ...ref }] : [];
})).slice(0, input.maxRefs) });
const recallRank = ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map(row => ({
  namespaceIndex: row.namespaceIndex, memoryId: row.memory.id, revision: row.memory.revision,
})) });
const port = (overrides = {}) => ({ contextWindow: 8192, countTokens: () => 1,
  selectSources: ({ input }) => selection([input.messages[0].index]), classify: emptyPlacement, ...overrides });
const invoke = (model, prepared, signal = new AbortController().signal, patch = {}) =>
  model.extract({ ...structuredClone(prepared.baselineRequest), signal, ...patch });
const inspect = (core, id, ns = namespace) => ok(core.get({ namespace: ns, memoryId: id, includeQualification: true }));

function fixture(t, value = input(), overrides = {}, options = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-source-selection-' });
  const path = join(workspace.path, 'synthetic.sqlite');
  const prepared = prepare(value), calls = [];
  const injected = port(overrides);
  const model = createSourceSelectionModel(prepared, injected);
  // Recall is an existing independent core port, not a new wrapper operation.
  const coreModel = { ...model, select(request) { calls.push({ method: 'select', input: structuredClone(request.input) });
    return recallSelect(request); },
  rank(request) { calls.push({ method: 'rank', input: structuredClone(request.input), system: request.system });
    return recallRank(request); } };
  let core = openMemoryCore({ path, model: coreModel, ...policy, ...options });
  workspace.defer(() => core?.close());
  return { workspace, path, prepared, model, injected, calls, core,
    reopen() { core.close(); core = openMemoryCore({ path, model: coreModel, ...policy }); return core; } };
}

async function bounded(promise, milliseconds = 4000) {
  let timer;
  try { return await Promise.race([promise, new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('synthetic_test_watchdog')), milliseconds);
  })]); } finally { clearTimeout(timer); }
}

test('T1/T2 preparation reuses the complete canonical query-blind indexed catalog and baseline', () => {
  const value = input([' Ａ 🚋 ' + 'q'.repeat(3990), 'Reported: Ivo said the draft was not adopted.']);
  const prepared = prepare(value);
  const snapshot = captureSnapshot(value, undefined, policy.captureSourcePolicy);
  const baseline = extractionRequest(snapshot, policy);
  assert.deepEqual(prepared.baselineRequest, { system: baseline.system, input: baseline.input, maxOutputTokens: 1024 });
  assert.deepEqual(prepared.request.input, baseline.catalog.input);
  assert.deepEqual(Object.keys(prepared.request.input), ['inputMode', 'messages']);
  assert.equal(prepared.request.input.messages.length, 6);
  for (const row of prepared.request.input.messages) {
    assert.deepEqual(Object.keys(row), ['index', 'messageIndex', 'role', 'content']);
    assert.ok(row.content.length <= 800); assert.equal(row.content.isWellFormed(), true);
  }
  assert.ok(prepared.request.input.messages[0].content.startsWith('A 🚋'));
  assert.ok(!JSON.stringify(prepared.request).includes(namespace.ownerId));
  deepFrozen(prepared);
  value.messages[0].content = 'changed outside';
  assert.notEqual(prepared.capture.messages[0].content, value.messages[0].content);
  assert.throws(() => { prepared.request.input.messages[0].content = 'changed'; }, TypeError);
  assert.throws(() => { prepared.capture.namespace.ownerId = 'foreign'; }, TypeError);
});

test('T1 JSON-text boundary refuses coercion, malformed identities, Unicode, unknown fields and source bounds', () => {
  let reads = 0;
  const hostile = { get toJSON() { reads++; throw new Error('private'); }, get then() { reads++; throw new Error('private'); } };
  const proxy = new Proxy({}, { get() { reads++; throw new Error('private'); } });
  for (const value of [undefined, null, {}, hostile, proxy, [], 3, '', '{', 'null', '[]', ' '.repeat(600001), '\ud800']) {
    assert.throws(() => prepareSourceSelectionMemory(value), code('invalid_input'));
  }
  const malformed = [input([]), input(Array(25).fill('x')), input(['x'.repeat(4001)]), input(Array(6).fill('x'.repeat(4000))),
    input(['\ud800']), input(['\udc00']), input(['x'], { causal: null }), input(['x'], { question: 'future' }),
    input(['x'], { namespace: { ...namespace, extra: true } }), input(['x'], { namespace: { ...namespace, scope: 'shared' } }),
    input(['x'], { namespace: { ...namespace, projectId: 'wrong' } }),
    input(['x'], { namespace: { ...namespace, scope: 'project', projectId: null } }),
    ...['', ' padded', 'bad\n', 'x\ud800', 'i'.repeat(201)].map(client => input(['x'], { client }))];
  const duplicate = input(); duplicate.messages[1].id = duplicate.messages[0].id; malformed.push(duplicate);
  const extra = input(); extra.messages[0].extra = true; malformed.push(extra);
  for (const value of malformed) assert.throws(() => prepare(value), code('invalid_input'));
  assert.equal(reads, 0);
  assert.equal(prepare(input(Array(24).fill('x'))).request.input.messages.length, 24);
  assert.equal(prepare(input(Array(5).fill('q'.repeat(4000)))).request.input.messages.length, 25);
  assert.equal(prepare(input(['x'], { namespace: { ...namespace, scope: 'project', projectId: 'project' } })).capture.namespace.projectId, 'project');
});

test('T2 schema allows zero/five groups and one/four distinct indices without semantic fields', () => {
  const prepared = prepare(input(['x'.repeat(801), 'assistant']));
  const schema = sourceSelectionMemorySchema(prepared); deepFrozen(schema);
  assert.equal(schema.additionalProperties, false); assert.deepEqual(schema.required, ['groups']);
  assert.equal(schema.properties.groups.minItems, 0); assert.equal(schema.properties.groups.maxItems, 5);
  const group = schema.properties.groups.items;
  assert.deepEqual(group.required, ['sourceIndices']); assert.equal(group.additionalProperties, false);
  assert.equal(group.properties.sourceIndices.minItems, 1); assert.equal(group.properties.sourceIndices.maxItems, 4);
  assert.deepEqual(Object.keys(group.properties.sourceIndices), ['type', 'minItems', 'maxItems', 'items']);
  assert.equal(Object.hasOwn(group.properties.sourceIndices, 'uniqueItems'), false);
  assert.deepEqual(group.properties.sourceIndices.items, { type: 'integer', minimum: 0, maximum: 2 });
  assert.deepEqual(compileSourceSelectionMemory(prepared, selection()).output, { items: [] });
});

test('T2/T3 five groups/four receipts preserve index order, cross-group reuse, roles and exact text', () => {
  const prepared = prepare(input(['First original.', 'Second proposed.', 'Third reported.', 'Fourth condition.']));
  const groups = [[3, 1, 0, 2], [0], [1], [2, 0], [3]];
  const result = compileSourceSelectionMemory(prepared, selection(...groups)); deepFrozen(result);
  const snapshot = captureSnapshot(prepared.capture, undefined, policy.captureSourcePolicy);
  const bound = extractedWindowItems(result.output, snapshot, extractionRequest(snapshot, policy).catalog);
  assert.equal(bound.length, 5); assert.equal(bound[0].receipts.length, 4);
  assert.deepEqual(result.output.items.map(row => row.sourceIndices), groups);
  assert.deepEqual(bound[0].receipts.map(row => row.excerpt), ['Fourth condition.', 'Second proposed.', 'First original.', 'Third reported.']);
  assert.deepEqual(bound[0].receipts.map(row => row.role), ['assistant', 'assistant', 'user', 'user']);
  for (const [index, row] of result.output.items.entries()) {
    assert.equal(row.kind, 'context'); assert.equal(row.confidence, 0);
    assert.match(row.content, /^\[Untrusted source excerpt; claimed role: (user|assistant); not a verified\/current fact\] /);
    assert.equal(result.observation.groups[index].previewClipped, false);
    assert.equal(result.observation.groups[index].copiedUnits, prepared.request.input.messages[groups[index][0]].content.length);
    assert.deepEqual(Object.keys(row), ['content', 'kind', 'confidence', 'sourceIndices']);
  }
});

test('T2/T6 invalid later groups fail atomically; no sorting, repair or duplicate receipt identities', () => {
  const prepared = prepare(input());
  const bad = [selection([0], [99]), selection([0, 0]), selection([-1]), selection([0.5]), selection(['0']), selection([]),
    selection([0, 1, 2, 3, 4]), selection(...Array(6).fill([0])), '{"groups":[{"sourceIndices":[1e999]}]}',
    '{"groups":[{"sourceIndices":[0],"content":"invented"}]}', '{"groups":[],"confidence":1}',
    '{"groups":[null]}', '{"groups":{}}', '{}', 'null', '[]', '{', '\ud800', ' '.repeat(40001)];
  for (const text of bad) assert.throws(() => compileSourceSelectionMemory(prepared, text), code('invalid_model_output'));
  let reads = 0;
  const resultObject = { get groups() { reads++; return []; }, get then() { reads++; return undefined; } };
  for (const value of [resultObject, new Proxy({}, { get() { reads++; } }), undefined, 1, null]) {
    assert.throws(() => compileSourceSelectionMemory(prepared, value), code('invalid_model_output'));
  }
  assert.equal(reads, 0);
  const repeated = prepare(input(['x'.repeat(1600)]));
  assert.throws(() => compileSourceSelectionMemory(repeated, selection([0, 1])), code('invalid_model_output'));
  assert.deepEqual(compileSourceSelectionMemory(prepared, selection([1, 0])).output.items[0].sourceIndices, [1, 0]);
  for (const fake of [{ ...prepared }, structuredClone(prepared), prepared.request, {}, null]) {
    assert.throws(() => compileSourceSelectionMemory(fake, selection([0])), code('invalid_input'));
    assert.throws(() => sourceSelectionMemorySchema(fake), code('invalid_input'));
    assert.throws(() => createSourceSelectionModel(fake, port()), code('invalid_input'));
  }
});

test('T3 previews clip at whole code points within 600 units while canonical receipts remain full', () => {
  const secret = 'sk-' + 'a'.repeat(48);
  const prepared = prepare(input([' Ａ ' + '😀'.repeat(350) + ` Private ${secret} 未採用。`, '助理提案，尚未採用。']));
  const result = compileSourceSelectionMemory(prepared, selection([0, 1]));
  const first = prepared.request.input.messages[0].content, row = result.output.items[0];
  assert.ok(first.includes('[REDACTED]')); assert.ok(!first.includes(secret));
  assert.ok(row.content.length <= 600); assert.equal(row.content.isWellFormed(), true);
  assert.ok(row.content.endsWith(' [incomplete preview]')); assert.equal(result.observation.groups[0].previewClipped, true);
  const label = '[Untrusted source excerpt; claimed role: user; not a verified/current fact] ';
  const copied = row.content.slice(label.length, -' [incomplete preview]'.length);
  assert.equal(copied, first.slice(0, result.observation.groups[0].copiedUnits));
  const snapshot = captureSnapshot(prepared.capture, undefined, policy.captureSourcePolicy);
  const bound = extractedWindowItems(result.output, snapshot, extractionRequest(snapshot, policy).catalog);
  assert.equal(bound[0].receipts[0].excerpt, first); assert.ok(bound[0].receipts[0].excerpt.length > copied.length);
  assert.ok(bound[0].receipts[0].excerpt.includes('未採用'));
});

test('T3 clipping at a source space preserves the exact compiled preview through core normalization', () => {
  const label = '[Untrusted source excerpt; claimed role: user; not a verified/current fact] ';
  const room = 600 - label.length - ' [incomplete preview]'.length;
  const prepared = prepare(input(['x'.repeat(room - 1) + ' ' + 'y'.repeat(200)]));
  const compiled = compileSourceSelectionMemory(prepared, selection([0]));
  assert.equal(compiled.observation.groups[0].copiedUnits, room - 1);
  assert.equal(compiled.output.items[0].content, label + 'x'.repeat(room - 1) + ' [incomplete preview]');
  const snapshot = captureSnapshot(prepared.capture, undefined, policy.captureSourcePolicy);
  assert.equal(extractedWindowItems(compiled.output, snapshot, extractionRequest(snapshot, policy).catalog)[0].content,
    compiled.output.items[0].content);
});

test('T4 actual wire, raw selection text and compiled output are counted; classification binding is unchanged', async () => {
  const prepared = prepare(input()), counts = [], selected = [], classified = [];
  const injected = port({ countTokens(text) { assert.equal(this, injected); counts.push(text); return 1; },
    selectSources(request) { assert.equal(this, injected); selected.push(request);
      assert.throws(() => { request.input.messages[0].content = 'mutation'; }, TypeError);
      return selection([request.input.messages[0].index, request.input.messages[1].index]); },
    classify(request) { assert.equal(this, injected); classified.push(request); return emptyPlacement(request); } });
  const model = createSourceSelectionModel(prepared, injected);
  assert.equal(model.countTokens(modelRequestText(prepared.baselineRequest.system, prepared.baselineRequest.input)), 1);
  const output = await invoke(model, prepared);
  assert.equal(selected.length, 1); assert.deepEqual(model.observe().output, output); deepFrozen(model.observe());
  assert.ok(counts.includes(modelRequestText(prepared.request.system, prepared.request.input)));
  assert.ok(!counts.includes(modelRequestText(prepared.baselineRequest.system, prepared.baselineRequest.input)));
  assert.ok(counts.includes(selection([0, 1]))); assert.ok(counts.includes(JSON.stringify(output)));
  const request = { input: { memories: [] }, signal: new AbortController().signal };
  assert.deepEqual(model.classify(request), { items: [] }); assert.equal(classified[0], request);
  await assert.rejects(invoke(model, prepared), code('invalid_input'));
});

test('T4 malformed calls, nested accessors and stale baseline consume the one-shot wrapper without executing getters', async () => {
  const prepared = prepare(input()); let reads = 0, calls = 0;
  for (const change of [value => { value.maxOutputTokens = 2048; }, value => { value.input.messages[0].content = 'foreign'; },
    value => { value.system += ' '; }, value => { value.extra = true; }, value => { delete value.signal; },
    value => Object.defineProperty(value.input.messages[0], 'content', { enumerable: true, get() { reads++; return 'hostile'; } }),
    value => Object.defineProperty(value, 'input', { enumerable: true, get() { reads++; return {}; } })]) {
    const model = createSourceSelectionModel(prepared, port({ selectSources() { calls++; return selection(); } }));
    const value = { ...structuredClone(prepared.baselineRequest), signal: new AbortController().signal }; change(value);
    await assert.rejects(model.extract(value), code('invalid_input'));
    await assert.rejects(invoke(model, prepared), code('invalid_input'));
  }
  assert.equal(reads, 0); assert.equal(calls, 0);
});

test('T4/T6 nonstring selector output with accessors is refused without then/toJSON execution', async () => {
  const prepared = prepare(input()); let reads = 0;
  const hostile = { get then() { reads++; return undefined; }, get groups() { reads++; return []; },
    get toJSON() { reads++; return () => ({}); } };
  const decorated = Promise.resolve(selection([0]));
  Object.defineProperty(decorated, 'constructor', { get() { reads++; return Promise; } });
  for (const output of [hostile, new Proxy({}, { get() { reads++; } }), decorated, {}, [], 4, null, undefined]) {
    const model = createSourceSelectionModel(prepared, port({ selectSources: () => output }));
    await assert.rejects(invoke(model, prepared), code('invalid_model_output'));
    await assert.rejects(invoke(model, prepared), code('invalid_input'));
  }
  assert.equal(reads, 0);
  const asynchronous = createSourceSelectionModel(prepared, port({ selectSources: async () => selection([1]) }));
  assert.deepEqual((await invoke(asynchronous, prepared)).items[0].sourceIndices, [1]);
});

test('T4 missing/accessor ports, context/counter/input/raw-output/compiled-output bounds fail closed', async t => {
  const prepared = prepare(input()); let reads = 0;
  for (const missing of ['selectSources', 'countTokens']) {
    const injected = port(); delete injected[missing];
    assert.throws(() => createSourceSelectionModel(prepared, injected), code('invalid_input'));
  }
  for (const name of ['selectSources', 'countTokens', 'classify', 'contextWindow']) {
    const injected = port(); Object.defineProperty(injected, name, { get() { reads++; return undefined; } });
    assert.throws(() => createSourceSelectionModel(prepared, injected), code('invalid_input'));
  }
  assert.equal(reads, 0);
  const variants = [
    [{ contextWindow: 8191 }, 'context_budget_exceeded'],
    [{ contextWindow: undefined }, 'context_budget_exceeded'],
    [{ countTokens: () => NaN }, 'token_count_unavailable'],
    [{ countTokens: () => { throw new Error('source secret'); } }, 'token_count_unavailable'],
    [{ countTokens: text => text.includes('"system"') ? 6001 : 1 }, 'context_budget_exceeded'],
    [{ countTokens: text => text.startsWith('{"groups"') ? 1025 : 1 }, 'invalid_model_output'],
    [{ countTokens: text => text.startsWith('{"items"') ? 1025 : 1 }, 'invalid_model_output'],
    [{ selectSources: () => ' '.repeat(40001) }, 'invalid_model_output'],
    [{ selectSources: () => { throw new Error('private source, key and path'); } }, 'extraction_failed'],
  ];
  for (const [overrides, expected] of variants) {
    const model = createSourceSelectionModel(prepared, port(overrides));
    await assert.rejects(invoke(model, prepared), code(expected));
    assert.equal(model.observe().output, null); assert.equal(model.observe().groups, null);
    await assert.rejects(invoke(model, prepared), code('invalid_input'));
  }
  let calls = 0;
  // This token counter recognizes the actual JSON envelope, not unescaped prose.
  const guarded = fixture(t, input(), { countTokens: text => {
    try { return JSON.parse(text).system === prepared.request.system ? 6001 : 1; } catch { return 1; }
  }, selectSources() { calls++; return selection([0]); } });
  denied(await guarded.core.capture(guarded.prepared.capture), 'context_budget_exceeded');
  assert.equal(calls, 0); assert.deepEqual(ok(guarded.core.list({ namespace })).memories, []);
});

test('T4 exact 6000-input/1024-output bounds are inclusive for selection text and compiled output', async () => {
  const prepared = prepare(input());
  const counted = [];
  const model = createSourceSelectionModel(prepared, port({ countTokens(text) {
    counted.push(text);
    return text.startsWith('{"system"') ? 6000 : 1024;
  } }));
  const output = await invoke(model, prepared);
  assert.equal(output.items.length, 1);
  assert.ok(counted.includes(selection([0]))); assert.ok(counted.includes(JSON.stringify(output)));
  const fullText = selection() + ' '.repeat(40000 - selection().length);
  const textBound = createSourceSelectionModel(prepared, port({ selectSources: () => fullText }));
  assert.deepEqual(await invoke(textBound, prepared), { items: [] });
});

test('T4 cancellation settles an uncooperative selector, consumes wrapper and suppresses late output', async () => {
  const prepared = prepare(input()); let entered, release, seenSignal;
  const started = new Promise(resolve => { entered = resolve; });
  const model = createSourceSelectionModel(prepared, port({ selectSources({ signal }) {
    seenSignal = signal; entered(); return new Promise(resolve => { release = resolve; });
  } }));
  const controller = new AbortController(), pending = invoke(model, prepared, controller.signal);
  await bounded(started); controller.abort();
  await assert.rejects(bounded(pending), error => error.code === 'model_cancelled' && error.name === 'AbortError');
  assert.equal(seenSignal.aborted, true); assert.equal(model.observe().output, null);
  release(selection([0])); await setImmediate(); assert.equal(model.observe().output, null);
  await assert.rejects(invoke(model, prepared), code('invalid_input'));
  const already = new AbortController(); already.abort();
  const preAborted = createSourceSelectionModel(prepared, port({ selectSources() { assert.fail('already aborted'); } }));
  await assert.rejects(invoke(preAborted, prepared, already.signal), error => error.name === 'AbortError');
  await assert.rejects(invoke(preAborted, prepared), code('invalid_input'));
});

test('T4 abort during compiled-output counting cannot publish a completed observation or return output', async () => {
  const prepared = prepare(input()), controller = new AbortController();
  const model = createSourceSelectionModel(prepared, port({ countTokens(text) {
    if (text.startsWith('{"items"')) controller.abort();
    return 1;
  } }));
  await assert.rejects(invoke(model, prepared, controller.signal), error => error.name === 'AbortError');
  assert.equal(model.observe().output, null); assert.equal(model.observe().groups, null);
});

test('T9 explicit preview tiers preserve all indices/full receipts; invalid tiers are not silently repaired', () => {
  const prepared = prepare(input(['始'.repeat(790), '😀'.repeat(390)]));
  const text = selection([1, 0]);
  const snapshot = captureSnapshot(prepared.capture, undefined, policy.captureSourcePolicy);
  const catalog = extractionRequest(snapshot, policy).catalog;
  const normal = compileSourceSelectionMemory(prepared, text);
  assert.equal(normal.observation.previewUnits, 600);
  assert.deepEqual(normal, compileSourceSelectionMemory(prepared, text, 600));
  const expected = extractedWindowItems(normal.output, snapshot, catalog)[0].receipts;
  for (const tier of [600, 400, 256, 160, 128]) {
    const compiled = compileSourceSelectionMemory(prepared, text, tier); deepFrozen(compiled);
    assert.equal(compiled.observation.previewUnits, tier);
    assert.ok(compiled.output.items[0].content.length <= tier);
    assert.equal(compiled.output.items[0].content.isWellFormed(), true);
    assert.ok(compiled.output.items[0].content.endsWith(' [incomplete preview]'));
    assert.deepEqual(compiled.output.items[0].sourceIndices, [1, 0]);
    assert.equal(compiled.output.items[0].kind, 'context'); assert.equal(compiled.output.items[0].confidence, 0);
    assert.deepEqual(extractedWindowItems(compiled.output, snapshot, catalog)[0].receipts, expected);
  }
  for (const tier of [0, 127, 129, 601, '400', null, {}]) {
    assert.throws(() => compileSourceSelectionMemory(prepared, text, tier), code('invalid_model_output'));
  }
});

test('T9 wrapper keeps fitting default output and takes first fitting complete tier without monotonic assumptions or new calls', async () => {
  const prepared = prepare(input(['x'.repeat(800), '界😀'.repeat(260)]));
  const text = selection([0, 1], [1, 0]);
  const tiers = [], calls = [];
  const model = createSourceSelectionModel(prepared, port({ selectSources({ input }) {
    calls.push('selectSources'); return selection([input.messages[0].index, input.messages[1].index], [input.messages[1].index, input.messages[0].index]);
  }, countTokens(wire) {
    const value = JSON.parse(wire);
    if (!value.items) return 1;
    const tier = Math.max(...value.items.map(row => row.content.length)); tiers.push(tier);
    // Deliberately nonmonotonic. A binary search/floor assumption is invalid.
    return ({ 600: 1600, 400: 1900, 256: 900, 160: 1800, 128: 800 })[tier] ?? 1;
  } }));
  const output = await invoke(model, prepared);
  assert.deepEqual(calls, ['selectSources']); assert.deepEqual(tiers, [600, 400, 256]);
  assert.equal(model.observe().previewUnits, 256);
  assert.deepEqual(output, compileSourceSelectionMemory(prepared, text, 256).output);
  const snapshot = captureSnapshot(prepared.capture, undefined, policy.captureSourcePolicy);
  assert.deepEqual(extractedWindowItems(output, snapshot, extractionRequest(snapshot, policy).catalog).map(row => row.receipts),
    extractedWindowItems(compileSourceSelectionMemory(prepared, text).output, snapshot, extractionRequest(snapshot, policy).catalog).map(row => row.receipts));
  const defaultModel = createSourceSelectionModel(prepared, port({ selectSources: () => text }));
  assert.deepEqual(await invoke(defaultModel, prepared), compileSourceSelectionMemory(prepared, text).output);
  assert.equal(defaultModel.observe().previewUnits, 600);
});

test('T9 all-tier overflow, invalid counters and allocation abort are atomic without fallback or completed observation', async () => {
  const prepared = prepare(input(['x'.repeat(800)]));
  for (const failure of ['all-overflow', 'counter-invalid', 'counter-throws', 'abort']) {
    const controller = new AbortController(), measured = []; let calls = 0;
    const model = createSourceSelectionModel(prepared, port({ selectSources: ({ input }) => {
      calls++; return selection([input.messages[0].index]);
    }, countTokens(wire) {
      const value = JSON.parse(wire); if (!value.items) return 1;
      const tier = value.items[0].content.length; measured.push(tier);
      if (failure === 'all-overflow') return 1025;
      if (tier === 600) return 1025;
      if (failure === 'counter-invalid') return NaN;
      if (failure === 'counter-throws') throw new Error('private source');
      controller.abort(); return 1;
    } }));
    await assert.rejects(invoke(model, prepared, controller.signal), error => failure === 'abort'
      ? error.name === 'AbortError' : code(failure === 'all-overflow' ? 'invalid_model_output' : 'token_count_unavailable')(error));
    assert.deepEqual(measured, failure === 'all-overflow' ? [600, 400, 256, 160, 128] : [600, 400]);
    assert.equal(calls, 1); assert.equal(model.observe().output, null); assert.equal(model.observe().previewUnits, null);
    await assert.rejects(invoke(model, prepared), code('invalid_input'));
  }
  let compiledCounts = 0;
  const invalid = createSourceSelectionModel(prepared, port({ selectSources: () => selection([0], [99]),
    countTokens(wire) { if (JSON.parse(wire).items) compiledCounts++; return 1; } }));
  await assert.rejects(invoke(invalid, prepared), code('invalid_model_output'));
  assert.equal(compiledCounts, 0); assert.equal(invalid.observe().previewUnits, null);
});

test('T4 real core capture deadline cancels replacement work and leaves no admitted memory', async t => {
  let entered, seenSignal;
  const started = new Promise(resolve => { entered = resolve; });
  const f = fixture(t, input(), { selectSources({ signal }) {
    seenSignal = signal; entered(); return new Promise(() => {});
  } }, { captureDeadlineMs: 1000 });
  const pending = f.core.capture(f.prepared.capture);
  await bounded(Promise.race([started, pending.then(result => { throw new Error(`selector_not_entered:${result.error?.code}`); })]));
  denied(await bounded(pending), 'model_timeout');
  assert.equal(seenSignal.aborted, true); assert.equal(f.model.observe().output, null);
  assert.deepEqual(ok(f.core.list({ namespace })).memories, []);
  await assert.rejects(invoke(f.model, f.prepared), code('invalid_input'));
});

test('T5 normal new-L1 filing revision survives cold exact-source reads and source-only recall', async t => {
  const qualifier = 'Inspection is allowed only when the amber tag is signed.';
  const source = 'The Lumen hatch needs inspection. ' + '背景'.repeat(300) + qualifier;
  const f = fixture(t, input([source, 'Neri proposed blue tags; nobody adopted that proposal.']), {
    selectSources: ({ input }) => selection(input.messages.map(row => row.index)), classify: topicPlacement,
    countTokens(text) {
      try {
        const value = JSON.parse(text);
        return value.items?.some(row => typeof row.content === 'string' && row.content.length > 400) ? 1025 : 1;
      } catch { return 1; } // Core also counts plain navigation labels.
    },
  });
  const captured = ok(await f.core.capture(f.prepared.capture));
  assert.equal(f.model.observe().previewUnits, 400);
  assert.equal(captured.qualificationStatus, 'not-requested'); assert.equal(captured.classification.status, 'applied');
  const admitted = captured.admission.memories[0];
  const classified = captured.classification.memoryRevisions.find(row => row.memoryId === admitted.id);
  assert.ok(classified); assert.ok(classified.revision > admitted.revision);
  const warm = inspect(f.core, admitted.id);
  assert.equal(warm.memory.revision, classified.revision); assert.equal(warm.memory.filing.status, 'filed');
  assert.equal(warm.memory.kind, 'context'); assert.equal(warm.memory.origin, 'agent-inferred'); assert.equal(warm.memory.confidence, 0);
  assert.equal(warm.qualification, null); assert.equal(warm.placements.length, 1);
  assert.ok(!warm.memory.content.includes(qualifier)); assert.ok(warm.memory.content.endsWith(' [incomplete preview]'));
  assert.ok(warm.receipts.some(row => row.excerpt.includes(qualifier)));
  assert.deepEqual(warm.receipts.map(row => row.excerpt).sort(), f.prepared.request.input.messages.map(row => row.content).sort());
  const cold = f.reopen(); assert.deepEqual(inspect(cold, admitted.id), warm);
  const fetched = ok(cold.fetch({ namespace, contextMode: 'source-evidence', refs: [{ memoryId: admitted.id, revision: classified.revision }] }));
  assert.equal(fetched.items.length, 1); assert.ok(fetched.items[0].receipts.some(row => row.excerpt.includes(qualifier)));
  const recalled = ok(await cold.recall({ readSet: [namespace], query: 'What conditions apply to Lumen inspection?', contextMode: 'source-evidence' }));
  assert.equal(recalled.memories.length, 1); assert.deepEqual(recalled.memories[0].receipts, fetched.items[0].receipts);
  assert.equal(recalled.memories[0].memory.revision, classified.revision);
  assert.equal(Object.hasOwn(recalled.memories[0].memory, 'content'), false);
  const rank = f.calls.find(row => row.method === 'rank'); assert.ok(rank);
  assert.ok(rank.input.candidates[0].receipts.some(row => row.excerpt.includes(qualifier)));
  assert.equal(Object.hasOwn(rank.input.candidates[0].memory, 'content'), false);
  assert.deepEqual(Object.keys(rank.input.candidates[0].receipts[0]).sort(), ['excerpt', 'id', 'role']);
  // This establishes input/output occurrence and ordinary filing, not semantic QA.
});

test('T5 shared-source groups and ordinary dedup keep receipts/metadata; namespace/correction/forget stay authoritative', async t => {
  const value = input(['The Lumen hatch needs inspection.', 'The amber tag must be signed.', 'Record the inspection count.']);
  const f = fixture(t, value, { selectSources: ({ input }) => selection(
    [input.messages[0].index, input.messages[1].index], [input.messages[2].index, input.messages[1].index], [input.messages[0].index]),
  classify: topicPlacement });
  const captured = ok(await f.core.capture(f.prepared.capture));
  const listed = ok(f.core.list({ namespace })).memories;
  assert.equal(listed.length, 2); // Same deterministic first-window preview deduplicates normally.
  const details = listed.map(row => inspect(f.core, row.id));
  assert.ok(details.every(row => row.receipts.some(receipt => receipt.excerpt === value.messages[1].content)));
  assert.ok(details.every(row => row.memory.confidence === 0 && row.memory.kind === 'context' && row.qualification === null));
  const first = details.find(row => row.receipts.some(receipt => receipt.excerpt === value.messages[0].content));
  const foreign = { ...namespace, ownerId: 'different-owner' };
  denied(f.core.get({ namespace: foreign, memoryId: first.memory.id }), 'memory_not_found');
  assert.deepEqual(ok(f.core.fetch({ namespace: foreign, contextMode: 'source-evidence', refs: [{ memoryId: first.memory.id,
    revision: first.memory.revision }] })).items, []);
  const corrected = ok(f.core.correct({ namespace, memoryId: first.memory.id, expectedRevision: first.memory.revision,
    content: 'Manual Lumen instruction.', kind: 'instruction', receipt: { client: 'manual', sessionId: 'manual', eventId: 'correction',
      role: 'user', excerpt: 'Manual correction requires a silver tag.' } }));
  assert.equal(inspect(f.core, first.memory.id).memory.content, 'Manual Lumen instruction.');
  assert.ok(inspect(f.core, first.memory.id).receipts.some(row => row.excerpt.includes('silver tag')));
  ok(f.core.forget({ namespace, memoryId: first.memory.id, expectedRevision: corrected.memory.revision }));
  denied(f.core.get({ namespace, memoryId: first.memory.id }), 'memory_not_found');
  assert.equal(ok(await f.core.capture(f.prepared.capture)).duplicate, true);
  assert.equal(ok(f.core.list({ namespace })).memories.length, 1);
  assert.equal(captured.classification.status, 'applied');
});

test('T5/T6 invalid later-group core capture is atomic and empty selection is a normal empty admission', async t => {
  const malformed = fixture(t, input(), { selectSources: ({ input }) => selection([input.messages[0].index], [99]),
    classify() { assert.fail('no classification after failed extraction'); } });
  denied(await malformed.core.capture(malformed.prepared.capture), 'invalid_model_output');
  assert.deepEqual(ok(malformed.core.list({ namespace })).memories, []);
  const empty = fixture(t, input(), { selectSources: () => selection(), classify() { assert.fail('empty admission skips classification'); } });
  const result = ok(await empty.core.capture(empty.prepared.capture));
  assert.deepEqual(result.admission.memories, []); assert.equal(result.classification.status, 'skipped');
  const unconfigured = fixture(t, input(), { classify: undefined });
  const retained = ok(await unconfigured.core.capture(unconfigured.prepared.capture));
  assert.equal(retained.admission.memories.length, 1); assert.equal(retained.classification.status, 'failed');
  assert.equal(retained.classification.error.code, 'model_not_configured');
  assert.equal(inspect(unconfigured.core, retained.admission.memories[0].id).memory.filing.status, 'unfiled');
});

test('T6 reported speech/proposal/adoption/old condition/relative dates stay copied without inferred semantic metadata', async t => {
  const texts = [
    'Lena said: "I prefer the ochre card." This reports Lena, not the operator.',
    'I propose the violet card; nobody has adopted it.',
    'Old note: inspect after the bell. Later condition: also require a signed amber tag.',
    'Tomorrow might be better; the calendar date is unknown.',
  ];
  const f = fixture(t, input(texts), { selectSources: ({ input }) => selection(...input.messages.map(row => [row.index])) });
  ok(await f.core.capture(f.prepared.capture));
  const details = ok(f.core.list({ namespace })).memories.map(row => inspect(f.core, row.id));
  assert.equal(details.length, 4);
  for (const [index, text] of texts.entries()) {
    const detail = details.find(row => row.receipts.some(receipt => receipt.excerpt === text)); assert.ok(detail);
    assert.ok(detail.memory.content.endsWith(text)); assert.equal(detail.qualification, null);
    assert.equal(detail.receipts[0].role, index % 2 ? 'assistant' : 'user');
    assert.equal(Object.hasOwn(detail.memory, 'adoption'), false); assert.equal(Object.hasOwn(detail.memory, 'eventTime'), false);
  }
});

test('T7 limitation: perfect receipt copying cannot restore an unselected later qualifying window', async t => {
  const omitted = 'Later addition: require the signed amber tag as well.';
  const f = fixture(t, input(['Old Lumen rule: inspect after the bell. ' + 'x'.repeat(800) + omitted]), {
    selectSources: ({ input }) => selection([input.messages[0].index]), classify: topicPlacement,
  });
  const captured = ok(await f.core.capture(f.prepared.capture));
  assert.ok(f.prepared.request.input.messages.some(row => row.content.includes(omitted)));
  const detail = inspect(f.core, captured.admission.memories[0].id);
  assert.equal(detail.receipts[0].excerpt, f.prepared.request.input.messages[0].content);
  assert.ok(!JSON.stringify(detail.receipts).includes(omitted));
  const result = ok(await f.core.recall({ readSet: [namespace], query: 'Lumen conditions', contextMode: 'source-evidence' }));
  assert.equal(result.memories.length, 1); assert.ok(!JSON.stringify(result.memories).includes(omitted));
});

test('T7 limitation: clipped decisive words survive in receipts but preview-driven filing can leave memory unfiled', async t => {
  const decisive = 'This inspection applies only to the Lumen hatch.';
  let classificationSawSubject = false;
  const f = fixture(t, input(['背景'.repeat(310) + decisive]), {
    selectSources: ({ input }) => selection([input.messages[0].index]),
    classify(request) {
      classificationSawSubject = request.input.memories.some(row => row.content.includes('Lumen'));
      return classificationSawSubject ? topicPlacement(request) : emptyPlacement(request);
    },
  });
  const result = ok(await f.core.capture(f.prepared.capture)); const detail = inspect(f.core, result.admission.memories[0].id);
  assert.equal(classificationSawSubject, false); assert.equal(detail.memory.filing.status, 'unfiled');
  assert.ok(detail.receipts[0].excerpt.includes(decisive)); assert.ok(!detail.memory.content.includes(decisive));
  assert.equal(result.classification.status, 'applied'); // Applied empty placement is not successful topic filing.
});

test('T8 owned workspace cleanup removes only its own store after success and assertion failure', async () => {
  for (const failAssertion of [false, true]) {
    const workspace = createTestWorkspace(null, { prefix: 'cairn-source-selection-cleanup-' });
    const path = join(workspace.path, 'synthetic.sqlite');
    let core;
    try {
      core = openMemoryCore({ path }); workspace.defer(() => core.close());
      assert.equal(existsSync(path), true);
      if (failAssertion) assert.fail('deliberate synthetic assertion failure');
    } catch (error) {
      assert.equal(failAssertion, true); assert.equal(error.code, 'ERR_ASSERTION');
    } finally { await workspace.cleanup(); }
    assert.equal(existsSync(workspace.path), false);
  }
});
