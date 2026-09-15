import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createFullLabelSelectionModel } from '../full-label-model.mjs';

const namespace = projectId => ({ ownerId: 'full-label-test', scope: 'project', projectId });
const personalNamespace = { ownerId: 'full-label-test', scope: 'personal', projectId: null };
const ref = (memoryId = 'a', namespaceIndex = 0) => ({ namespaceIndex, memoryId, revision: 1 });
const item = id => ({ type: 'unfiled', ref: { memoryId: id, revision: 1 }, label: 'Clipped' });
const request = () => ({ system: 'Original selection instructions', input: { query: 'Which synthetic display?', maxRefs: 12,
  maps: [{ namespaceIndex: 0, exhausted: true, items: [item('a'), item('b')] }] },
  maxOutputTokens: 1024, signal: new AbortController().signal });
const code = expected => error => error.code === expected;
function setup(overrides = {}, options = {}) {
  const records = new Map(['one', 'two'].flatMap(project => ['a', 'b'].map(id => [`${project}/${id}`, {
    id, revision: 1, state: 'active', namespace: project === 'two' ? { ...personalNamespace } : namespace(project),
    content: `${project}/${id}: 完整的合成說明 🧵; the last clause is still present.`,
  }])));
  const calls = [], counts = [], reads = [];
  const model = { contextWindow: 8192, countTokens(text) { counts.push(text); return 1; },
    async select(value) { calls.push(value); return { refs: [ref()] }; },
    rank: async value => value, extract: async value => value, classify: async value => value, ...overrides };
  const readSet = [namespace('one'), { ...personalNamespace }];
  const getMemory = async query => {
    reads.push(query); const memory = records.get(`${query.namespace.projectId ?? 'two'}/${query.memoryId}`);
    return memory ? { ok: true, value: { memory: structuredClone(memory), receipts: [{ excerpt: 'PRIVATE RECEIPT NOT LABEL' }] } }
      : { ok: false, error: { code: 'not_found' } };
  };
  const wrapped = createFullLabelSelectionModel(model, { readSet, getMemory, ...options });
  return { records, calls, counts, reads, model, readSet, wrapped };
}

test('all visible labels expand without changing groups, identities, ordering, instructions or other ports', async () => {
  const f = setup(), incoming = request();
  incoming.input.maps[0].items.push({ type: 'moc', moc: { id: 'group', level: 'L1', title: 'Original group', revision: 1 } },
    { type: 'ref', ref: { parentId: 'group', parentRevision: 1, childType: 'memory', childId: 'a', childRevision: 1, relation: 'contains' }, label: 'Other clipped label' },
    { type: 'ref', ref: { parentId: 'group', parentRevision: 1, childType: 'moc', childId: 'nested', childRevision: 1, relation: 'contains' }, label: 'Nested group' });
  incoming.input.maps.push({ namespaceIndex: 1, exhausted: false, items: [item('a')] });
  const expected = structuredClone(incoming.input);
  expected.maps[0].items[0].label = expected.maps[0].items[3].label = f.records.get('one/a').content;
  expected.maps[0].items[1].label = f.records.get('one/b').content;
  expected.maps[1].items[0].label = f.records.get('two/a').content;
  assert.deepEqual(await f.wrapped.select(incoming), { refs: [ref()] });
  assert.equal(f.calls.length, 1); assert.deepEqual(f.calls[0].input, expected);
  assert.equal(f.calls[0].system, incoming.system); assert.equal(f.calls[0].signal, incoming.signal);
  assert.equal(f.calls[0].maxOutputTokens, 1024); assert.equal(incoming.input.maps[0].items[0].label, 'Clipped');
  assert.ok(Object.isFrozen(f.wrapped)); assert.ok(Object.isFrozen(f.calls[0].input.maps[0].items[0].ref));
  assert.ok(!JSON.stringify(f.calls[0]).includes('PRIVATE RECEIPT'));
  assert.ok(f.counts.includes(JSON.stringify({ system: incoming.system, input: expected, maxOutputTokens: 1024 })));
  for (const port of ['rank', 'extract', 'classify']) assert.equal(f.wrapped[port], f.model[port]);
  assert.ok(f.reads.every(q => Object.isFrozen(q) && Object.isFrozen(q.namespace)));
  assert.deepEqual(new Set(f.reads.map(q => `${q.namespace.projectId ?? 'two'}/${q.memoryId}`)), new Set(['one/a', 'one/b', 'two/a']));
});

test('empty output stays empty and maxRefs caps reject instead of padding or repairing selection', async () => {
  assert.deepEqual(await setup({ select: async () => ({ refs: [] }) }).wrapped.select(request()), { refs: [] });
  for (const refs of [[ref('missing')], [ref('a', 1)], [{ ...ref(), revision: 2 }], [ref(), ref()], [ref(), ref('b')]]) {
    const f = setup({ select: async () => { f.calls.push(true); return { refs }; } });
    const incoming = request(); incoming.input.maxRefs = 1;
    await assert.rejects(() => f.wrapped.select(incoming), code('invalid_model_output')); assert.equal(f.calls.length, 1);
  }
});

test('missing, stale, deleted and foreign public get records fail before selector invocation', async () => {
  for (const mutate of [f => f.records.delete('one/b'), f => { f.records.get('one/b').revision = 2; },
    f => { f.records.get('one/b').state = 'deleted'; }, f => { f.records.get('one/b').id = 'foreign'; },
    f => { f.records.get('one/b').namespace = { ...personalNamespace }; },
    f => { f.records.get('one/b').namespace.ownerId = 'foreign-owner'; }]) {
    const f = setup(); mutate(f);
    await assert.rejects(() => f.wrapped.select(request()), code('revision_conflict')); assert.equal(f.calls.length, 0);
  }
});

test('immutable read-set binding and detached caller data survive asynchronous caller mutation', async () => {
  let finish, started; const ready = new Promise(resolve => { started = resolve; });
  const f = setup({ select: value => {
    f.calls.push(value); assert.throws(() => { value.input.maps[0].items[0].label = 'Changed'; });
    started(); return new Promise(resolve => { finish = resolve; });
  } });
  f.readSet[0].projectId = 'two'; f.model.select = () => assert.fail('Replacement selector');
  f.model.countTokens = () => assert.fail('Replacement counter');
  const incoming = request(), pending = f.wrapped.select(incoming); await ready;
  incoming.input.maps[0].items[0].ref.memoryId = 'foreign'; incoming.input.query = 'Changed';
  finish({ refs: [ref()] }); assert.deepEqual(await pending, { refs: [ref()] });
  assert.ok(f.reads.every(q => q.namespace.projectId === 'one')); assert.equal(f.calls.length, 1);
});

test('changes to unselected exposed content during input count, model or output count always reject', async () => {
  for (const stage of ['input', 'model', 'output']) {
    let mutated = false;
    const change = () => { mutated = true; f.records.get('one/b').content = 'Changed without a revision bump'; };
    const f = setup({ countTokens: text => {
      if (!mutated && (stage === 'input' && JSON.parse(text).system || stage === 'output' && !JSON.parse(text).system)) change();
      return 1;
    }, select: async () => { f.calls.push(true); if (stage === 'model') change(); return { refs: [ref()] }; } });
    await assert.rejects(() => f.wrapped.select(request()), code('revision_conflict'));
    assert.ok(mutated); assert.equal(f.calls.length, stage === 'input' ? 0 : 1);
  }
});

test('malformed requests and accessor-bearing structures reject without executing hooks', async () => {
  let hooks = 0;
  for (const mutate of [r => { r.signal = {}; }, r => { r.maxOutputTokens = 1025; },
    r => { r.input.maxRefs = -1; }, r => { r.input.maps[0].namespaceIndex = 2; },
    r => { r.input.maps[0].items[0].ref.revision = 0; },
    r => Object.defineProperty(r, 'input', { get() { hooks++; return {}; } }),
    r => Object.defineProperty(r.input.maps[0].items[0], 'label', { get() { hooks++; return ''; } }),
    r => Object.setPrototypeOf(r.input.maps[0].items, { toJSON() { hooks++; return []; } })]) {
    const f = setup(), incoming = request(); mutate(incoming);
    await assert.rejects(() => f.wrapped.select(incoming)); assert.equal(f.calls.length, 0);
  }
  assert.equal(hooks, 0);
  const raw = { refs: [ref()] }; Object.defineProperty(raw.refs[0], 'memoryId', { get() { hooks++; return 'a'; } });
  await assert.rejects(() => setup({ select: async () => raw }).wrapped.select(request()), code('invalid_model_output'));
  assert.equal(hooks, 0);
});

test('independent token and byte ceilings fail closed, inclusive token boundaries succeed', async () => {
  for (const [counter, expected, calls] of [[() => 6001, 'context_budget_exceeded', 0],
    [() => NaN, 'token_count_unavailable', 0], [() => -1, 'token_count_unavailable', 0],
    [() => 1.5, 'token_count_unavailable', 0], [() => { throw new Error('Synthetic counter'); }, 'token_count_unavailable', 0],
    [text => JSON.parse(text).system ? 1 : 1025, 'invalid_model_output', 1]]) {
    const f = setup({ countTokens: counter }); await assert.rejects(() => f.wrapped.select(request()), code(expected));
    assert.equal(f.calls.length, calls);
  }
  assert.deepEqual(await setup({ countTokens: text => JSON.parse(text).system ? 6000 : 1024 }).wrapped.select(request()), { refs: [ref()] });
  const f = setup(), incoming = request(); incoming.system = 'x'.repeat(24001);
  await assert.rejects(() => f.wrapped.select(incoming)); assert.equal(f.calls.length, 0);
  const large = setup(), expanded = request();
  expanded.input.maps[0].items = Array.from({ length: 20 }, (_, i) => item(`m${i}`));
  for (let i = 0; i < 20; i++) large.records.set(`one/m${i}`, { ...large.records.get('one/a'), id: `m${i}`, content: '界'.repeat(600) });
  await assert.rejects(() => large.wrapped.select(expanded)); assert.equal(large.calls.length, 0);
});

test('aborts before and across callbacks propagate, and provider errors are never retried', async () => {
  for (const stage of ['before', 'input', 'model', 'output']) {
    const controller = new AbortController(); if (stage === 'before') controller.abort();
    const f = setup({ countTokens: text => {
      if (stage === 'input' && JSON.parse(text).system || stage === 'output' && !JSON.parse(text).system) controller.abort(); return 1;
    }, select: async ({ signal }) => { f.calls.push(true); assert.equal(signal, controller.signal); if (stage === 'model') controller.abort(); return { refs: [ref()] }; } });
    await assert.rejects(() => f.wrapped.select({ ...request(), signal: controller.signal }), error => error.name === 'AbortError');
    assert.equal(f.calls.length, ['model', 'output'].includes(stage) ? 1 : 0);
  }
  const failure = new Error('Synthetic provider failure'); let calls = 0;
  await assert.rejects(() => setup({ select: async () => { calls++; throw failure; } }).wrapped.select(request()), e => e === failure);
  assert.equal(calls, 1);
});

test('constructor rejects missing capabilities and unsafe read bindings without evaluating accessors', () => {
  for (const [overrides, expected] of [[{ select: null }, 'model_not_configured'], [{ countTokens: null }, 'token_count_unavailable'],
    [{ contextWindow: 8191 }, 'context_budget_exceeded']]) assert.throws(() => setup(overrides), code(expected));
  for (const readSet of [[], [namespace('one'), namespace('one')], [namespace('one'), { ...personalNamespace, ownerId: 'other' }],
    [{ ownerId: 'full-label-test', projectId: 'one' }]]) assert.throws(() => setup({}, { readSet }));
  let hooks = 0;
  const readSet = [namespace('one')]; Object.defineProperty(readSet[0], 'ownerId', { get() { hooks++; return 'full-label-test'; } });
  assert.throws(() => setup({}, { readSet })); assert.equal(hooks, 0);
});

test('output counter cannot swap selected refs or introduce inherited serialization hooks', async () => {
  let hooks = 0;
  for (const mutate of [raw => { raw.refs[0].memoryId = 'b'; }, raw => {
    Object.setPrototypeOf(raw.refs, { toJSON() { hooks++; return []; } });
  }]) {
    const raw = { refs: [ref()] };
    const f = setup({ select: async () => { f.calls.push(true); return raw; }, countTokens: text => {
      if (!JSON.parse(text).system) mutate(raw); return 1;
    } });
    await assert.rejects(() => f.wrapped.select(request()), code('invalid_model_output'));
    assert.equal(f.calls.length, 1); assert.equal(hooks, 0);
  }
});

const [major, minor] = process.versions.node.split('.').map(Number);
test('actual core expands current labels and rejects correction or forgetting of any exposed unselected memory', {
  skip: major < 22 || major === 22 && minor < 16 ? 'SQLite integration requires Node >=22.16; pure tests stay enabled.' : false,
}, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const ns = namespace('integration');
  const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
  for (const action of ['none', 'correct', 'forget']) for (const stage of action === 'none' ? ['model'] : ['input', 'model', 'output']) {
    let core, unselected, selected, changed = false, selecting = false, ranks = 0;
    const contents = ['A fresh synthetic museum stand is proposed, not booked.', 'A different display remains unapproved.'];
    const change = () => {
      changed = true;
      if (action === 'forget') ok(core.forget({ namespace: ns, memoryId: unselected.id, expectedRevision: unselected.revision }));
      else ok(core.correct({ namespace: ns, memoryId: unselected.id, expectedRevision: unselected.revision, content: 'Corrected synthetic display.', kind: 'fact',
        receipt: { client: 'test', sessionId: 's', eventId: 'correction', role: 'user', excerpt: 'Corrected synthetic display.' } }));
    };
    const model = { contextWindow: 8192, countTokens: text => {
      if (selecting && !changed && action !== 'none' && (stage === 'input' && text.includes('Original selection instructions') || stage === 'output' && text.startsWith('{"refs":'))) change();
      return 1;
    }, select: async ({ input }) => {
      assert.deepEqual(input.maps[0].items.map(i => i.label), contents);
      if (action !== 'none' && stage === 'model') change();
      return { refs: [{ namespaceIndex: 0, memoryId: selected.id, revision: selected.revision }] };
    }, rank: async () => { ranks++; return { refs: [] }; } };
    const wrapped = createFullLabelSelectionModel(model, { readSet: [ns], getMemory: query => core.get(query) });
    core = openMemoryCore({ path: join(mkdtempSync(join(tmpdir(), 'cairn-full-label-')), 'memory.sqlite'), model: wrapped });
    t.after(() => core.close());
    const records = contents.map((content, i) => ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' },
      receipts: [{ client: 'test', sessionId: 's', eventId: `source-${i}`, role: 'user', excerpt: content }] })).memory);
    [selected, unselected] = records;
    const incoming = request(); incoming.input.maps[0].items = records.map(memory => ({ type: 'unfiled', ref: { memoryId: memory.id, revision: memory.revision }, label: 'Clipped' }));
    selecting = true;
    if (action === 'none') assert.deepEqual(await wrapped.select(incoming), { refs: [{ namespaceIndex: 0, memoryId: selected.id, revision: selected.revision }] });
    else { await assert.rejects(() => wrapped.select(incoming), code('revision_conflict')); assert.ok(changed); }
    assert.equal(ranks, 0);
  }
});

test('actual recall uses expanded labels but unchanged ranking and current source receipts', {
  skip: major < 22 || major === 22 && minor < 16 ? 'SQLite integration requires Node >=22.16; pure tests stay enabled.' : false,
}, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const ns = namespace('recall'), contents = ['The synthetic archive display has a carefully recorded proposal. '.repeat(3) + 'Approval is still unknown.',
    'A separate synthetic visitor chooses a different board.'];
  const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
  for (const action of ['none', 'correct', 'forget']) {
    let core, memories, originalSystem, selections = 0, ranks = 0;
    const model = { contextWindow: 8192, countTokens: () => 1, select: async ({ input, system }) => {
      selections++;
      assert.equal(system, originalSystem);
      assert.deepEqual(new Set(input.maps[0].items.map(i => i.label)), new Set(contents));
      const unselected = memories[1];
      if (action === 'forget') ok(core.forget({ namespace: ns, memoryId: unselected.id, expectedRevision: unselected.revision }));
      if (action === 'correct') ok(core.correct({ namespace: ns, memoryId: unselected.id, expectedRevision: unselected.revision,
        kind: 'fact', content: 'Changed second synthetic record.',
        receipt: { client: 't', sessionId: 's', eventId: 'change', role: 'user', excerpt: 'Changed second synthetic record.' } }));
      return { refs: [{ namespaceIndex: 0, memoryId: memories[0].id, revision: memories[0].revision }] };
    }, rank: async ({ input }) => {
      ranks++; assert.equal(input.candidates.length, 1);
      assert.equal(input.candidates[0].receipts[0].excerpt, contents[0]);
      return { refs: [{ namespaceIndex: 0, memoryId: memories[0].id, revision: memories[0].revision }] };
    } };
    const wrapped = createFullLabelSelectionModel(model, { readSet: [ns], getMemory: query => core.get(query) });
    core = openMemoryCore({ path: join(mkdtempSync(join(tmpdir(), 'cairn-full-label-recall-')), 'memory.sqlite'),
      model: { ...wrapped, select: incoming => {
        originalSystem = incoming.system;
        assert.ok(incoming.input.maps[0].items.every(i => i.label.length <= 120));
        assert.ok(!incoming.input.maps[0].items.some(i => i.label === contents[0]));
        return wrapped.select(incoming);
      } } });
    t.after(() => core.close());
    memories = contents.map((content, i) => ok(core.admit({ namespace: ns, memory: { content, kind: 'fact' },
      receipts: [{ client: 't', sessionId: 's', eventId: `record-${i}`, role: 'user', excerpt: content }] })).memory);
    const result = await core.recall({ readSet: [ns], query: 'Synthetic archive display', contextMode: 'source-evidence' });
    assert.equal(selections, 1); assert.equal(ranks, action === 'none' ? 1 : 0);
    if (action === 'none') assert.equal(ok(result).memories[0].receipts[0].excerpt, contents[0]);
    else assert.equal(result.ok, false);
  }
});
