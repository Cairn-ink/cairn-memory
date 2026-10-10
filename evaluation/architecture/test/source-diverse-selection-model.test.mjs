import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assembleSourceDiverseSelection, createSourceDiverseSelectionModel } from '../source-diverse-selection-model.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const project = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'synthetic-project' };
const personal = { ownerId: project.ownerId, scope: 'personal', projectId: null };
const code = expected => error => error.name === 'MemoryStoreError' && error.code === expected;
const ref = (memoryId, namespaceIndex = 0) => ({ namespaceIndex, memoryId, revision: 1 });
const receipt = (eventId, excerpt = `Retained synthetic source ${eventId}.`, overrides = {}) => ({
  id: `receipt-${eventId}`, client: 'synthetic-client', sessionId: 'synthetic-session', eventId,
  role: 'user', excerpt, ...overrides });
const card = (reference, receipts, namespace = reference.namespaceIndex ? personal : project) => ({ ref: reference,
  response: { ok: true, value: { memory: { id: reference.memoryId, revision: reference.revision,
    state: 'active', namespace: structuredClone(namespace), content: 'Unused generated interpretation.', receiptCount: receipts.length },
    receipts, exhausted: true, nextReceiptCursor: null } } });
function input(cards, maxRefs = 24) {
  return { query: 'Which retained sources support the request?', maxRefs,
    maps: [...new Set(cards.map(item => item.ref.namespaceIndex))].map(namespaceIndex => ({
      namespaceIndex, exhausted: true, items: cards.filter(item => item.ref.namespaceIndex === namespaceIndex)
        .map(item => ({ type: 'unfiled', ref: { memoryId: item.ref.memoryId, revision: item.ref.revision }, label: 'Untrusted label' })) })) };
}
const request = value => ({ system: 'Unchanged original selector instructions.', input: value,
  maxOutputTokens: 1024, signal: new AbortController().signal });
const identity = item => JSON.stringify([item.namespaceIndex, item.memoryId, item.revision]);
function observations(cards, seeds) {
  if (seeds.length === 0) return [];
  const ordered = [...new Map([...seeds, ...cards.map(item => item.ref)].map(item => [identity(item), item])).values()];
  let bytes = 0;
  const result = [];
  for (const reference of ordered.slice(0, 24)) {
    const observation = cards.find(item => identity(item.ref) === identity(reference)); result.push(observation);
    bytes += observation.response.value.receipts.reduce((sum, source) => sum + Buffer.byteLength(JSON.stringify([
      observation.response.value.memory.namespace, source.client, source.sessionId, source.eventId, source.role, source.excerpt])), 0);
    if (bytes > 65_536) break;
  }
  return result;
}
function compile(cards, seeds = [cards[0].ref], maxRefs = 24) {
  return assembleSourceDiverseSelection(input(cards, maxRefs), { refs: seeds }, {
    readSet: cards.some(item => item.ref.namespaceIndex === 1) ? [project, personal] : [project],
    inspections: observations(cards, seeds) });
}
function fixture(cards, seeds = [cards[0].ref], overrides = {}) {
  const calls = [], reads = [], counts = [], readSet = [structuredClone(project)];
  if (cards.some(item => item.ref.namespaceIndex === 1)) readSet.push(structuredClone(personal));
  const model = { contextWindow: 8192,
    countTokens(text) { assert.equal(this, model); counts.push(text); return 1; },
    async select(value) { assert.equal(this, model); calls.push(value); return { refs: structuredClone(seeds) }; },
    rank: value => value, extract: value => value, classify: value => value, ...overrides };
  const options = { readSet, async getMemory(query) {
    reads.push(query); assert(Object.isFrozen(query) && Object.isFrozen(query.namespace));
    assert.deepEqual(Object.keys(query).sort(), ['memoryId', 'namespace', 'receiptLimit']);
    assert.equal(query.receiptLimit, 8);
    const found = cards.find(item => item.ref.memoryId === query.memoryId
      && item.response.value.memory.namespace.scope === query.namespace.scope);
    return found?.response ?? { ok: false, error: { code: 'memory_not_found' } };
  } };
  return { model, options, calls, reads, counts, wrapped: createSourceDiverseSelectionModel(model, options) };
}
function repeated() {
  return [card(ref('seed-a'), [receipt('billing')]), card(ref('seed-b'), [receipt('billing', undefined, { id: 'other-uuid' })]),
    card(ref('bridge'), [receipt('bridge'), receipt('support')]), ...Array.from({ length: 7 }, (_, index) =>
      card(ref(`decoy-${index}`), [receipt(`decoy-${index}`)]))];
}

test('S1 unchanged original selector is captured, bound and called once; only selection changes', async () => {
  const cards = repeated(), seeds = cards.slice(0, 2).map(item => item.ref), f = fixture(cards, seeds);
  const incoming = request(input(cards)), expected = structuredClone(incoming.input);
  f.model.select = () => assert.fail('Captured selector required');
  f.model.countTokens = () => assert.fail('Captured bound counter required');
  f.options.getMemory = () => assert.fail('Captured public read required'); f.options.readSet[0].projectId = 'mutated';
  assert.equal(f.wrapped.countTokens('Binding probe'), 1);
  const output = await f.wrapped.select(incoming);
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].input, expected);
  assert.notEqual(f.calls[0].input, incoming.input);
  assert(Object.isFrozen(f.calls[0]) && Object.isFrozen(f.calls[0].input.maps[0].items[0].ref));
  assert.equal(f.calls[0].signal, incoming.signal); assert.equal(f.calls[0].system, incoming.system);
  assert.equal(f.calls[0].maxOutputTokens, 1024);
  assert.deepEqual(output, compile(cards, seeds).output); assert(Object.isFrozen(output.refs[0]));
  assert.equal(f.reads.length, cards.length * 2);
  assert.deepEqual(f.reads.slice(0, cards.length), f.reads.slice(cards.length));
  for (const port of ['rank', 'extract', 'classify', 'contextWindow']) assert.equal(f.wrapped[port], f.model[port]);
  assert(f.counts.includes(JSON.stringify({ system: incoming.system, input: expected, maxOutputTokens: 1024 })));
});

test('S3 exact origin, namespace, role and excerpt differ; UUID, memory and summary do not identify a source', () => {
  const base = receipt('PO-63', 'The mural names PO-63.');
  const cards = [card(ref('one'), [base]), card(ref('duplicate'), [{ ...base, id: 'new-receipt-uuid' }]),
    card(ref('origin'), [{ ...base, id: 'origin-uuid', eventId: 'another-origin' }]),
    card(ref('excerpt'), [{ ...base, id: 'excerpt-uuid', excerpt: 'Unrelated clinic contradicts PO-63.' }]),
    card(ref('role'), [{ ...base, id: 'role-uuid', role: 'assistant' }]),
    card(ref('namespace', 1), [{ ...base, id: 'namespace-uuid' }])];
  const result = compile(cards, cards.map(item => item.ref));
  assert.deepEqual(result.output.refs, cards.filter((_, index) => index !== 1).map(item => item.ref));
  assert.deepEqual(result.diagnostics.removedSeeds, [cards[1].ref]);
  assert.equal(result.diagnostics.representedSourceCount, 5);
  assert.equal(result.diagnostics.inspections[1].receipts[0].receiptId, 'new-receipt-uuid');
  assert.equal(result.diagnostics.semanticCoverage, 'unassessed');
  assert(Object.isFrozen(result.diagnostics.inspections[0].receipts[0]));
  cards[1].response.value.memory.content = 'Entirely different generated interpretation.';
  assert.deepEqual(compile(cards, cards.map(item => item.ref)).output, result.output);
  const union = [card(ref('first'), [receipt('A'), receipt('B')]), card(ref('second'), [receipt('C')]),
    card(ref('subset'), [receipt('B'), receipt('C')])];
  assert.deepEqual(compile(union, union.map(item => item.ref)).diagnostics.removedSeeds, [union[2].ref]);
});

test('S5 novelty is recomputed, ties use visible order, additions are capped and empty selection stays empty', async () => {
  const cards = [card(ref('seed'), [receipt('A')]), card(ref('first-tie'), [receipt('B'), receipt('C')]),
    card(ref('second-tie'), [receipt('B'), receipt('D')]), card(ref('zero'), [receipt('A')]),
    ...Array.from({ length: 5 }, (_, i) => card(ref(`unique-${i}`), [receipt(`unique-${i}`)]))];
  const result = compile(cards);
  assert.deepEqual(result.diagnostics.additions.map(item => [item.ref.memoryId, item.novelSources]),
    [['first-tie', 2], ['second-tie', 1], ['unique-0', 1], ['unique-1', 1]]);
  assert.equal(compile(cards, [cards[0].ref], 2).output.refs.length, 2);
  const twelve = Array.from({ length: 14 }, (_, i) => card(ref(`limit-${i}`), [receipt(`limit-${i}`)]));
  assert.equal(compile(twelve, twelve.slice(0, 12).map(item => item.ref)).output.refs.length, 12);
  const empty = fixture(cards, []); assert.deepEqual(await empty.wrapped.select(request(input(cards))), { refs: [] });
  assert.equal(empty.calls.length, 1); assert.equal(empty.reads.length, 0);
  assert.deepEqual(compile(cards, []).diagnostics.inspections, []);
  // The read port really contains this complementary card, but the page does not.
  const hidden = card(ref('unseen-bridge'), [receipt('hidden-bridge'), receipt('hidden-support')]);
  const stored = fixture([...cards, hidden]);
  const visibleOutput = await stored.wrapped.select(request(input(cards)));
  assert(!visibleOutput.refs.some(item => item.memoryId === hidden.ref.memoryId));
  assert(!stored.reads.some(query => query.memoryId === hidden.ref.memoryId));
  assert.equal(stored.reads.length, cards.length * 2);
});

test('S4 partial/empty source sets are unassessed and preserved only as original seeds', () => {
  const cards = repeated();
  for (const index of [0, 1, 2]) {
    cards[index].response.value.exhausted = false; cards[index].response.value.nextReceiptCursor = 'opaque-cursor';
    cards[index].response.value.memory.receiptCount = 9;
  }
  cards.push(card(ref('empty'), []));
  const result = compile(cards, cards.slice(0, 2).map(item => item.ref));
  assert.deepEqual(result.output.refs.slice(0, 2), cards.slice(0, 2).map(item => item.ref));
  assert(!result.output.refs.some(item => ['bridge', 'empty'].includes(item.memoryId)));
  assert.equal(result.diagnostics.removedSeeds.length, 0);
  assert(result.diagnostics.inspections.slice(0, 3).every(item => item.assessment === 'unassessed' && item.reason === 'partial_source_set'));
});

test('S2/S4 first pass stops at 24 cards or 64KiB crossing, including crossing reread but excluding crossing material', async () => {
  const many = Array.from({ length: 30 }, (_, i) => card(ref(`many-${i}`), [receipt(`many-${i}`)]));
  const f = fixture(many, [many[29].ref]), output = await f.wrapped.select(request(input(many)));
  assert.equal(f.reads.length, 48); assert.equal(f.reads[0].memoryId, 'many-29');
  assert.equal(f.reads[23].memoryId, 'many-22'); assert(!output.refs.some(item => item.memoryId === 'many-23'));
  assert.equal(compile(many, [many[29].ref]).diagnostics.cardLimitReached, true);
  const large = Array.from({ length: 24 }, (_, i) => card(ref(`large-${i}`), Array.from({ length: 8 }, (_, j) =>
    receipt(`large-${i}-${j}`, `${i}-${j} ${'x'.repeat(700)}`))));
  const g = fixture(large, large.slice(0, 12).map(item => item.ref)), result = compile(large, large.slice(0, 12).map(item => item.ref));
  const actual = await g.wrapped.select(request(input(large)));
  assert.deepEqual(actual, result.output); assert.equal(result.diagnostics.sourceMaterialLimitReached, true);
  assert(result.diagnostics.sourceMaterialBytes <= 65_536);
  assert.equal(g.reads.length, result.diagnostics.inspectedCards * 2); assert(g.reads.length < 48);
  assert.equal(result.diagnostics.inspections.at(-1).reason, 'source_material_limit');
  assert.deepEqual(result.diagnostics.inspections.at(-1).receipts, []);
  assert.deepEqual(actual.refs, large.slice(0, 12).map(item => item.ref));
});

test('S1/S6 malformed inputs and pure inspection accessors/custom array prototypes never execute hooks', async () => {
  let hooks = 0; const cards = repeated(), seeds = [cards[0].ref];
  for (const root of [null, undefined, 1, true, 'input', []]) {
    const f = fixture(cards); await assert.rejects(() => f.wrapped.select(request(root)), code('invalid_input'));
    assert.equal(f.calls.length, 0);
  }
  const badArrays = [Array(1), Object.assign([], { extra: true })];
  const accessor = [cards[0]];
  Object.defineProperty(accessor, '0', { enumerable: true, get() { hooks++; return cards[0]; } }); badArrays.push(accessor);
  const custom = observations(cards, seeds); Object.setPrototypeOf(custom, { get 0() { hooks++; return cards[0]; } }); badArrays.push(custom);
  const symbol = observations(cards, seeds); symbol[Symbol('hidden')] = true; badArrays.push(symbol);
  const nested = observations(cards, seeds);
  Object.defineProperty(nested[0], 'response', { enumerable: true, get() { hooks++; return cards[0].response; } }); badArrays.push(nested);
  for (const inspections of badArrays) assert.throws(() => assembleSourceDiverseSelection(input(cards), { refs: seeds },
    { readSet: [project], inspections }), code('invalid_input'));
  const malformed = [value => { value.input.maps = Array(1); }, value => { value.input.query = '\ud800'; },
    value => { value.input.maxRefs = 25; }, value => { value.maxOutputTokens = 1025; }, value => { value.signal = {}; },
    value => Object.defineProperty(value.input, 'query', { get() { hooks++; return ''; } }),
    value => { value.input.toJSON = () => { hooks++; return {}; }; }];
  for (const mutate of malformed) {
    const f = fixture(repeated()), incoming = request(input(repeated())); mutate(incoming);
    await assert.rejects(() => f.wrapped.select(incoming), code('invalid_input')); assert.equal(f.calls.length, 0);
  }
  assert.equal(hooks, 0);
});

test('S1 invalid raw refs fail before lookup rather than being repaired', async () => {
  const cards = repeated(); let hooks = 0;
  const outputs = [null, [], {}, { refs: null }, { refs: [cards[0].ref, cards[0].ref] },
    { refs: [{ ...cards[0].ref, memoryId: 'hidden' }] }, { refs: [{ ...cards[0].ref, revision: 2 }] },
    { refs: [{ ...cards[0].ref, namespaceIndex: 1 }] }, { refs: [cards[0].ref], extra: true }, { refs: Array(1) }];
  const accessor = { refs: [structuredClone(cards[0].ref)] };
  Object.defineProperty(accessor.refs[0], 'memoryId', { get() { hooks++; return 'seed-a'; } }); outputs.push(accessor);
  for (const output of outputs) {
    let calls = 0; const f = fixture(cards, undefined, { select: async () => { calls++; return output; } });
    await assert.rejects(() => f.wrapped.select(request(input(cards))), code('invalid_model_output'));
    assert.equal(calls, 1); assert.equal(f.reads.length, 0);
  }
  assert.equal(hooks, 0);
});

test('S1 configuration errors are typed and memory-child refs remain visible without reading group IDs', async () => {
  const cards = repeated();
  for (const [changes, expected] of [[{ select: null }, 'model_not_configured'], [{ countTokens: null }, 'token_count_unavailable'],
    [{ contextWindow: 8191 }, 'context_budget_exceeded']]) assert.throws(() => fixture(cards, undefined, changes), code(expected));
  const f = fixture(cards), incoming = request(input(cards));
  incoming.input.maps[0].items[2] = { type: 'ref', label: 'Original memory child label', ref: {
    parentId: 'visible-group', parentRevision: 1, childType: 'memory', childId: cards[2].ref.memoryId,
    childRevision: 1, relation: 'contains' } };
  incoming.input.maps[0].items.push({ type: 'moc', moc: { id: 'visible-group', level: 'L1', title: 'Navigation only', revision: 1 } });
  const output = await f.wrapped.select(incoming);
  assert(output.refs.some(item => item.memoryId === 'bridge'));
  assert(!f.reads.some(query => query.memoryId === 'visible-group'));
  assert.equal(f.reads.length, cards.length * 2);
});

test('S4 failed, foreign, stale, historical, awaiting and malformed public records reject', async () => {
  for (const mutate of [value => { value.ok = false; }, value => { value.value.memory.revision = 2; },
    value => { value.value.memory.namespace.projectId = 'foreign'; }, value => { value.value.memory.state = 'historical'; },
    value => { value.value.memory.reviewState = 'awaiting'; }, value => { value.value.memory.currentness = 'historical'; },
    value => { value.value.memory.receiptCount++; }, value => { value.value.receipts[0].role = 'system'; },
    value => { value.value.receipts[0].excerpt = 'x'.repeat(801); }, value => { value.value.receipts[0].eventId = ''; },
    value => { value.value.oversized = 'x'.repeat(65_536); }]) {
    const cards = repeated(); mutate(cards[0].response);
    const f = fixture(cards); await assert.rejects(() => f.wrapped.select(request(input(cards))), code('revision_conflict'));
    assert.equal(f.calls.length, 1);
  }
});

test('S6 final reread rejects source/receipt-set state changes, not UUID-only copies of exact sources', async () => {
  for (const mutate of [value => { value.value.receipts[0].excerpt = 'Corrected source.'; },
    value => { value.value.receipts[0].role = 'assistant'; }, value => { value.value.receipts[0].eventId = 'changed-event'; },
    value => { value.value.memory.state = 'historical'; }, value => { value.value.memory.revision++; },
    value => { value.ok = false; }]) {
    const cards = repeated(), f = fixture(cards); let pass = 0;
    const g = createSourceDiverseSelectionModel(f.model, { readSet: [project], getMemory: async query => {
      const found = structuredClone(cards.find(item => item.ref.memoryId === query.memoryId).response);
      if (++pass > cards.length && query.memoryId === cards[0].ref.memoryId) mutate(found);
      return found;
    } });
    await assert.rejects(() => g.select(request(input(cards))), code('revision_conflict'));
    assert.equal(pass, cards.length + 1);
  }
  const cards = repeated(), f = fixture(cards); let reads = 0;
  const g = createSourceDiverseSelectionModel(f.model, { readSet: [project], getMemory: async query => {
    const found = structuredClone(cards.find(item => item.ref.memoryId === query.memoryId).response);
    if (++reads > cards.length) found.value.receipts.forEach(item => { item.id += '-uuid-copy'; });
    return found;
  } });
  assert.deepEqual(await g.select(request(input(cards))), compile(cards).output);
  assert.equal(reads, cards.length * 2);
});

test('S1/S6 input/raw/compiled output budgets and mutation checks remain independent', async () => {
  const cards = repeated();
  for (const [counter, expected, reads] of [[() => 6001, 'context_budget_exceeded', 0],
    [() => NaN, 'token_count_unavailable', 0], [text => JSON.parse(text).refs ? 1025 : 1, 'invalid_model_output', 0],
    [text => JSON.parse(text).refs?.length === 5 ? 1025 : 1, 'invalid_model_output', cards.length]]) {
    const f = fixture(cards, undefined, { countTokens: counter });
    await assert.rejects(() => f.wrapped.select(request(input(cards))), code(expected)); assert.equal(f.reads.length, reads);
  }
  const inclusive = fixture(cards, undefined, { countTokens: text => JSON.parse(text).system ? 6000 : 1024 });
  assert.equal((await inclusive.wrapped.select(request(input(cards)))).refs.length, 5);
  for (const stage of [1, 2]) {
    const raw = { refs: [structuredClone(cards[0].ref)] }; let outputs = 0;
    const f = fixture(cards, undefined, { select: async () => raw, countTokens: text => {
      if (JSON.parse(text).refs && ++outputs === stage) raw.refs[0].memoryId = 'changed'; return 1;
    } });
    await assert.rejects(() => f.wrapped.select(request(input(cards))), code('invalid_model_output'));
    assert.equal(f.reads.length, stage === 1 ? 0 : cards.length);
  }
});

test('S6 caller mutation, provider failures and cancellation preserve detached requests and do not retry', async () => {
  const cards = repeated(); let start, finish;
  const ready = new Promise(resolve => { start = resolve; });
  const f = fixture(cards, undefined, { select: value => { f.calls.push(value); start(); return new Promise(resolve => { finish = resolve; }); } });
  const incoming = request(input(cards)), pending = f.wrapped.select(incoming); await ready;
  incoming.input.maps[0].items[0].ref.memoryId = 'mutated';
  assert.throws(() => { f.calls[0].input.maps[0].items[0].ref.memoryId = 'mutated'; });
  finish({ refs: [cards[0].ref] }); assert.deepEqual(await pending, compile(cards).output);
  const failure = new Error('Synthetic original failure'); let calls = 0;
  await assert.rejects(() => fixture(cards, undefined, { select: async () => { calls++; throw failure; } }).wrapped.select(request(input(cards))), error => error === failure);
  assert.equal(calls, 1);
  const failing = fixture(cards); let gets = 0;
  const g = createSourceDiverseSelectionModel(failing.model, { readSet: [project], getMemory: () => { gets++; throw failure; } });
  await assert.rejects(() => g.select(request(input(cards))), error => error === failure); assert.equal(gets, 1);
  for (const stage of ['before', 'input', 'select', 'raw', 'get', 'compiled', 'reread']) {
    const controller = new AbortController(); let outputs = 0, reads = 0, selects = 0;
    if (stage === 'before') controller.abort();
    const model = { contextWindow: 8192, countTokens: text => {
      const parsed = JSON.parse(text);
      if (parsed.system && stage === 'input' || parsed.refs && ++outputs === (stage === 'raw' ? 1 : stage === 'compiled' ? 2 : -1)) controller.abort();
      return 1;
    }, select: async () => { selects++; if (stage === 'select') controller.abort(); return { refs: [cards[0].ref] }; } };
    const wrapped = createSourceDiverseSelectionModel(model, { readSet: [project], getMemory: query => {
      reads++; if (stage === 'get' && reads === 1 || stage === 'reread' && reads > cards.length) controller.abort();
      return cards.find(item => item.ref.memoryId === query.memoryId).response;
    } });
    await assert.rejects(() => wrapped.select({ ...request(input(cards)), signal: controller.signal }), error => error.name === 'AbortError');
    assert.equal(selects, ['before', 'input'].includes(stage) ? 0 : 1);
    assert(reads <= cards.length * 2);
  }
});

const [major, minor] = process.versions.node.split('.').map(Number);
const sqlite = { skip: major < 22 || major === 22 && minor < 16 ? 'SQLite integration requires Node >=22.16.' : false };
const baselineOnly = process.env.CAIRN_SOURCE_DIVERSE_BASELINE_ONLY === '1';
const ok = result => { assert.equal(result.ok, true, result.error?.code); return result.value; };
// Deterministic mechanical counter: not a provider tokenizer or cost measurement.
const mechanicalCounter = text => Math.ceil(text.length / 4);

async function coreComparison({ redOnly = false, loseBridge = false, mutation = null } = {}) {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const { prepareMixedSourceCase } = await import('../../longmemeval/mixed-source.mjs');
  const { verifiedEvidence } = await import('../../longmemeval/mixed-evidence.mjs');
  const { packMixedAnswer } = await import('../../longmemeval/mixed-answer.mjs');
  const texts = ['Billing contact handles PO-63.', 'Mural purchase order is PO-63.', 'The signed purchase note names PO-63.',
    ...Array.from({ length: 7 }, (_, index) => `Unrelated synthetic inventory item ${index}.`)];
  const syntheticId = (kind, name) => `lme-${kind}-${createHash('sha256').update(name).digest('hex')}`;
  const caseId = syntheticId('case', 'source-diverse-integration'), namespace = { ...project, projectId: caseId };
  const question = { text: 'mural billing', date: '2026-10-10' };
  const plan = prepareMixedSourceCase({ namespace,
    history: { question_id: caseId, sessions: [{ session_index: 0,
      session_id: syntheticId('session', 'source-diverse-session'), date: '2026/10/09 (Fri) 12:00',
      turns: texts.map((content, index) => ({ turn_id: syntheticId('turn', `source-diverse-${index}`), role: 'user', content })) }] },
    question: { question_id: caseId, text: question.text, date: '2026/10/10 (Sat) 23:59' } }, 'indexed-evidence-v1');
  const workspace = createTestWorkspace(null, { prefix: 'cairn-source-diverse-' }); let core = null;
  workspace.defer(() => { core?.close(); core = null; });
  const snapshotPath = join(workspace.path, 'captured.sqlite'), memoryIds = [];
  try {
    core = openMemoryCore({ path: snapshotPath });
    const sources = plan.cairnPlan.batches.flatMap(batch => batch.indexedWindows.map(window => ({
      client: batch.captureInput.client, sessionId: batch.captureInput.sessionId, eventId: window.id, role: window.role, excerpt: window.content })));
    const sets = [[sources[0]], [sources[0]], [sources[0]], [sources[1], sources[2]], ...sources.slice(3).map(source => [source])];
    for (const [index, receipts] of sets.entries()) memoryIds.push(ok(core.admit({ namespace,
      memory: { content: index < 3 ? `Billing synthetic view ${index}.` : `Synthetic routing view ${index}.`, kind: 'context' }, receipts })).memory.id);
    assert.equal(memoryIds.length, 11); core.close(); core = null;
    const originalHash = createHash('sha256').update(readFileSync(snapshotPath)).digest('hex'), runs = [];
    for (const treatment of redOnly ? [false] : [false, true]) {
      const path = join(workspace.path, treatment ? 'treatment.sqlite' : 'baseline.sqlite'); copyFileSync(snapshotPath, path);
      const selectCalls = [], rankCalls = [], reads = [], actualOutputs = [];
      let mutated = false;
      const model = { contextWindow: 8192, countTokens: text => {
        if (mutation && treatment && !mutated) {
          let parsed; try { parsed = JSON.parse(text); } catch { return mechanicalCounter(text); }
          if (parsed.refs?.length === 5) {
            mutated = true; const target = memoryIds[mutation.target === 'added' ? 3 : 0];
            if (mutation.action === 'forget') ok(core.forget({ namespace, memoryId: target, expectedRevision: 1 }));
            else ok(core.correct({ namespace, memoryId: target, expectedRevision: 1, content: 'Corrected synthetic view.', kind: 'context',
              receipt: { client: 'synthetic-change', sessionId: 'change', eventId: 'change', role: 'user', excerpt: 'Corrected retained source.' } }));
          }
        }
        return mechanicalCounter(text);
      }, select: async incoming => {
        const selection = incoming.input, terms = JSON.parse(selection.query).question.toLowerCase().split(/\s+/);
        const refs = selection.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled'
          && item.label.toLowerCase().includes(terms.at(-1))).map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref })));
        const output = { refs }; selectCalls.push({ system: incoming.system, input: structuredClone(selection), maxOutputTokens: incoming.maxOutputTokens, output: structuredClone(output) });
        return output;
      }, rank: async incoming => {
        rankCalls.push(structuredClone({ system: incoming.system, input: incoming.input, maxOutputTokens: incoming.maxOutputTokens }));
        const terms = JSON.parse(incoming.input.query).question.toLowerCase().split(/\s+/);
        const selected = incoming.input.candidates.filter(item => item.receipts.some(source =>
          terms.some(term => source.excerpt.toLowerCase().includes(term))));
        return { refs: selected.slice(0, loseBridge ? 1 : incoming.input.limit).map(item => ({
          namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) };
      } };
      const wrapped = treatment ? createSourceDiverseSelectionModel(model, { readSet: [namespace], getMemory: query => {
        const response = core.get(query); reads.push({ query: structuredClone(query), response: structuredClone(response) }); return response;
      } }) : model;
      const observed = { ...wrapped, select: async incoming => {
        const output = await wrapped.select(incoming); actualOutputs.push(structuredClone(output)); return output;
      } };
      core = openMemoryCore({ path, model: observed, sourceCandidatePolicy: 'bounded-keyset-v1' });
      const result = await core.recall({ readSet: [namespace], query: plan.mem0Input.query, limit: 6, contextMode: 'source-evidence' });
      assert.equal(selectCalls.length, 1); assert.equal(selectCalls[0].output.refs.length, 3);
      assert.equal(selectCalls[0].input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')).length, 11);
      if (mutation && treatment) {
        assert(mutated); assert.equal(result.ok, false); assert(['recall_failed', 'revision_conflict'].includes(result.error.code));
        assert.equal(rankCalls.length, 0); runs.push({ selectCalls });
      } else {
        const recalled = ok(result); assert.equal(rankCalls.length, 1); assert.equal(rankCalls[0].input.limit, 6);
        assert.equal(rankCalls[0].input.candidates.length, treatment ? 5 : 3);
        const selectedSources = new Set(actualOutputs[0].refs.flatMap(reference => ok(core.get({ namespace,
          memoryId: reference.memoryId, receiptLimit: 8 })).receipts.map(source => JSON.stringify([
          namespace, source.client, source.sessionId, source.eventId, source.role, source.excerpt]))));
        assert.equal(selectedSources.size, treatment ? 6 : 1);
        const evidence = verifiedEvidence(recalled, query => core.get(query), plan, namespace);
        const packed = packMixedAnswer({ question, units: evidence.units, countTokens: mechanicalCounter });
        const packedCoordinates = new Set(packed.selectedIndices.flatMap(index => evidence.provenance
          .filter(item => item.memoryId === recalled.memories[index].memory.id)
          .flatMap(item => item.coordinates.map(coord => coord.originalTurnIndex))));
        const packedRequired = [0, 1].filter(index => packedCoordinates.has(index)).length;
        assert.equal(packedRequired, treatment && !loseBridge ? 2 : 1);
        const actualSources = JSON.parse(packed.request.messages[1].content).evidence;
        assert.deepEqual(actualSources, packed.selectedIndices.map(index => evidence.units[index]));
        assert.equal(reads.length, treatment ? 22 : 0);
        let diagnostics = null;
        if (treatment) {
          const inspections = reads.slice(0, 11).map(item => ({ ref: { namespaceIndex: 0, memoryId: item.query.memoryId, revision: 1 }, response: item.response }));
          const compiled = assembleSourceDiverseSelection(selectCalls[0].input, selectCalls[0].output, { readSet: [namespace], inspections });
          assert.deepEqual(compiled.output, actualOutputs[0]); diagnostics = compiled.diagnostics;
          assert.equal(diagnostics.removedSeeds.length, 2); assert.equal(diagnostics.additions.length, 4);
          assert.equal(diagnostics.inspectedCards, 11); assert(diagnostics.sourceMaterialBytes > 0 && diagnostics.sourceMaterialBytes < 65_536);
          assert.deepEqual(reads.slice(0, 11).map(item => item.query), reads.slice(11).map(item => item.query));
          assert(actualOutputs[0].refs.some(reference => reference.memoryId === memoryIds[3]));
        }
        runs.push({ selectCalls, rankCalls, packedRequired, selectedSources: selectedSources.size,
          selectedRefs: actualOutputs[0].refs.length, publicReads: reads.length, sourceBytes: diagnostics?.sourceMaterialBytes ?? 0,
          rankCandidates: rankCalls[0].input.candidates.length, packedUnits: packed.selectedIndices.length,
          mechanicalAnswerInputTokens: packed.inputTokens });
      }
      core.close(); core = null;
    }
    assert.equal(createHash('sha256').update(readFileSync(snapshotPath)).digest('hex'), originalHash, 'Closed captured snapshot stays unchanged');
    if (!mutation) {
      if (!loseBridge) assert.equal(runs.at(-1).packedRequired, 2, 'Complementary source must reach actual packed evidence');
      if (!redOnly) assert.deepEqual(runs[0].selectCalls, runs[1].selectCalls);
    }
    return runs;
  } finally {
    await workspace.cleanup(); assert.equal(existsSync(workspace.path), false, 'Owned scratch removed even on expected red assertion');
  }
}

test('S7 real cold-core >6 visible cards restore complementary actual packed source with unchanged selector and ranker', sqlite, async context => {
  const runs = await coreComparison({ redOnly: baselineOnly });
  context.diagnostic(JSON.stringify(runs.map(({ selectedSources, selectedRefs, publicReads, sourceBytes,
    packedRequired, rankCandidates, packedUnits, mechanicalAnswerInputTokens, selectCalls, rankCalls }) => ({
    selectCalls: selectCalls.length, rankCalls: rankCalls.length, selectedSources, selectedRefs,
    publicReads, sourceBytes, packedRequired, rankCandidates, packedUnits, mechanicalAnswerInputTokens }))));
});
test('S8 downstream rank loss stays a negative despite more distinct selected sources', sqlite, async () => {
  const runs = await coreComparison({ loseBridge: true });
  assert.deepEqual(runs.map(run => run.selectedSources), [1, 6]); assert.deepEqual(runs.map(run => run.packedRequired), [1, 1]);
});
test('S6/S8 actual seeded/added correction and forget after assembly still invalidate recall before ranking', sqlite, async () => {
  for (const target of ['seeded', 'added']) for (const action of ['correct', 'forget']) await coreComparison({ mutation: { target, action } });
});
test('S9 baseline restoration assertion is actually red and still closes/removes owned scratch', sqlite, async () => {
  await assert.rejects(() => coreComparison({ redOnly: true }), error => error.code === 'ERR_ASSERTION' && error.actual === 1 && error.expected === 2);
});
