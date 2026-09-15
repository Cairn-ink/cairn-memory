import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAugmentedSelectionModel } from '../augmented-model.mjs';

const ref = id => ({ namespaceIndex: 0, memoryId: id, revision: 1 });
const input = () => ({ query: 'Why now?', maxRefs: 24, maps: [{ namespaceIndex: 0, exhausted: true,
  items: ['a', 'b', 'c'].map(memoryId => ({ type: 'unfiled', ref: { memoryId, revision: 1 }, label: 'Synthetic note' })) }] });
const request = () => ({ system: 'Original selector instructions', input: input(), maxOutputTokens: 1024, signal: new AbortController().signal });
const code = expected => error => error.code === expected;
function fixture(overrides = {}) {
  const calls = [], counts = [];
  const model = { contextWindow: 8192, countTokens(text) { counts.push(text); return 1; },
    async select(value) { assert.equal(this, model); calls.push(value); return { refs: [ref('c')] }; },
    rank: async value => value, extract: async value => value, classify: async value => value, ...overrides };
  return { model, calls, counts, wrapped: createAugmentedSelectionModel(model) };
}

test('only select changes: one original call, same prompt and ceiling, exact counted union', async () => {
  const { wrapped, model, calls, counts } = fixture(), incoming = request();
  assert.ok(Object.isFrozen(wrapped));
  for (const field of ['countTokens', 'rank', 'extract', 'classify', 'contextWindow']) assert.equal(wrapped[field], model[field]);
  assert.deepEqual(await wrapped.select(incoming), { refs: [ref('c'), ref('a'), ref('b')] });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], incoming);
  assert.notEqual(calls[0].input, incoming.input);
  assert.equal(calls[0].signal, incoming.signal);
  assert.deepEqual(counts, [JSON.stringify({ system: incoming.system, input: incoming.input, maxOutputTokens: 1024 }),
    JSON.stringify({ refs: [ref('c')] }), JSON.stringify({ refs: [ref('c'), ref('a'), ref('b')] })]);
  const ranked = { candidates: [] }; assert.equal(await wrapped.rank(ranked), ranked);
});

test('constructor, request and input counter failures happen before the sole provider call', async () => {
  for (const [change, expected] of [[{ select: null }, 'model_not_configured'], [{ countTokens: null }, 'token_count_unavailable'],
    [{ contextWindow: 8191 }, 'context_budget_exceeded'], [{ contextWindow: 8192.5 }, 'context_budget_exceeded']]) assert.throws(() => fixture(change), code(expected));
  for (const countTokens of [() => NaN, () => -1, () => 1.5, () => { throw new Error('Synthetic'); }]) {
    const { wrapped, calls } = fixture({ countTokens });
    await assert.rejects(() => wrapped.select(request()), code('token_count_unavailable')); assert.equal(calls.length, 0);
  }
  const excessive = fixture({ countTokens: () => 6001 });
  await assert.rejects(() => excessive.wrapped.select(request()), code('context_budget_exceeded')); assert.equal(excessive.calls.length, 0);
  const { wrapped, calls } = fixture();
  for (const change of [{ maxOutputTokens: 1025 }, { maxOutputTokens: undefined }, { signal: {} }, { signal: null }, { system: 1 }]) {
    await assert.rejects(() => wrapped.select({ ...request(), ...change }), code('invalid_input'));
  }
  assert.equal(calls.length, 0);
});

test('raw and augmented token ceilings both apply independently and inclusively', async () => {
  for (const stage of ['raw', 'augmented', 'inclusive', 'broken']) {
    let selections = 0;
    const { wrapped } = fixture({ select: async () => { selections++; return { refs: [ref('c')] }; }, countTokens: text => {
      const parsed = JSON.parse(text);
      if (parsed.system) return 6000;
      if (stage === 'broken') throw new Error('Output counter unavailable');
      return (stage === 'raw' && parsed.refs.length === 1) || (stage === 'augmented' && parsed.refs.length === 3) ? 1025 : 1024;
    } });
    if (stage === 'inclusive') assert.equal((await wrapped.select(request())).refs.length, 3);
    else await assert.rejects(() => wrapped.select(request()), code(stage === 'broken' ? 'token_count_unavailable' : 'invalid_model_output'));
    assert.equal(selections, 1);
  }
});

test('invalid original output and output-counter mutation cannot be repaired or retried', async () => {
  let getters = 0;
  const getter = Object.defineProperty({}, 'refs', { enumerable: true, get() { getters++; return []; } });
  for (const raw of [undefined, { refs: [ref('foreign')] }, { refs: [ref('a'), ref('a')] }, getter,
    { refs: [], reason: 'Invented authority' }, { refs: [{ ...ref('a'), revision: 2 }] }]) {
    let calls = 0;
    await assert.rejects(() => fixture({ select: async () => { calls++; return raw; } }).wrapped.select(request()), code('invalid_model_output'));
    assert.equal(calls, 1);
  }
  assert.equal(getters, 0);
  const raw = { refs: [ref('c')] }; let calls = 0;
  const { wrapped } = fixture({ select: async () => { calls++; return raw; }, countTokens: text => {
    if (text === JSON.stringify({ refs: [ref('c')] })) raw.refs[0].memoryId = 'a';
    return 1;
  } });
  await assert.rejects(() => wrapped.select(request()), code('invalid_model_output')); assert.equal(calls, 1);
});

test('snapshotted bound methods and frozen authority survive asynchronous caller mutation', async () => {
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const { wrapped, model } = fixture({ select(value) {
    assert.equal(this, model); assert.ok(Object.isFrozen(value.input.maps[0].items[0].ref));
    started(); return new Promise(resolve => { finish = resolve; });
  } });
  model.select = () => { throw new Error('Replaced'); }; model.countTokens = () => { throw new Error('Replaced'); };
  const incoming = request(), pending = wrapped.select(incoming);
  await ready; incoming.input.maps[0].items[0].ref.memoryId = 'foreign'; incoming.input.query = 'Changed';
  finish({ refs: [ref('c')] });
  assert.deepEqual(await pending, { refs: [ref('c'), ref('a'), ref('b')] });
});

test('abort at entry, input count, pending selection or output count prevents return without retry', async () => {
  for (const stage of ['entry', 'input', 'select', 'output']) {
    const controller = new AbortController(); let calls = 0;
    if (stage === 'entry') controller.abort();
    const { wrapped } = fixture({ countTokens: text => {
      if ((stage === 'input' && text.includes('system')) || (stage === 'output' && !text.includes('system'))) controller.abort();
      return 1;
    }, select: async ({ signal }) => { calls++; assert.equal(signal, controller.signal); await Promise.resolve(); if (stage === 'select') controller.abort(); return { refs: [ref('a')] }; } });
    await assert.rejects(() => wrapped.select({ ...request(), signal: controller.signal }), error => error.name === 'AbortError');
    assert.equal(calls, ['entry', 'input'].includes(stage) ? 0 : 1);
  }
  const failure = new Error('Provider failed'); let calls = 0;
  await assert.rejects(() => fixture({ select: async () => { calls++; throw failure; } }).wrapped.select(request()), error => error === failure);
  assert.equal(calls, 1);
});

test('custom refs array serialization cannot run across the original-output trust boundary', async () => {
  let hooks = 0, calls = 0;
  const refs = [ref('a')];
  Object.setPrototypeOf(refs, Object.assign(Object.create(Array.prototype), {
    toJSON() { hooks++; return []; },
  }));
  const { wrapped } = fixture({ select: async () => { calls++; return { refs }; } });
  await assert.rejects(() => wrapped.select(request()), code('invalid_model_output'));
  assert.equal(hooks, 0);
  assert.equal(calls, 1);
});

test('output counter cannot introduce inherited serialization or accessors before revalidation', async () => {
  for (const mutation of ['prototype', 'accessor']) {
    let hooks = 0, calls = 0, outputCounts = 0;
    const raw = { refs: [ref('a')] }, serialized = JSON.stringify(raw);
    const { wrapped } = fixture({ select: async () => { calls++; return raw; }, countTokens: text => {
      if (text === serialized) {
        outputCounts++;
        if (mutation === 'prototype') Object.setPrototypeOf(raw.refs, Object.assign(Object.create(Array.prototype), {
          toJSON() { hooks++; return []; },
        }));
        else Object.defineProperty(raw, 'refs', { enumerable: true, get() { hooks++; return []; } });
      }
      return 1;
    } });
    await assert.rejects(() => wrapped.select(request()), code('invalid_model_output'));
    assert.equal(hooks, 0);
    assert.equal(calls, 1);
    assert.equal(outputCounts, 1);
  }
});

const [major, minor] = process.versions.node.split('.').map(Number);
const sqlite = { skip: major < 22 || (major === 22 && minor < 16) ? 'SQLite integration requires Node >=22.16; pure wrapper tests remain enabled.' : false };
test('actual core ranks the exact augmented union and retains correction/forget freshness fences', sqlite, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
  const namespace = { ownerId: 'augmentation-test', scope: 'personal', projectId: null };
  for (const action of ['none', 'select-correct', 'select-forget', 'rank-correct', 'rank-forget', 'empty', 'rank-budget']) {
    let core, stored, expected, selects = 0, ranks = 0;
    const mutate = () => action.endsWith('forget') ? ok(core.forget({ namespace, memoryId: stored.id, expectedRevision: stored.revision }))
      : ok(core.correct({ namespace, memoryId: stored.id, expectedRevision: stored.revision, content: 'New source', kind: 'fact',
        receipt: { client: 'test', sessionId: 's', eventId: 'new', role: 'user', excerpt: 'New source' } }));
    const { wrapped } = fixture({ countTokens: text => {
      let parsed; try { parsed = JSON.parse(text); } catch { return 1; }
      return action === 'rank-budget' && Array.isArray(parsed.input?.candidates) ? 6001 : 1;
    },
      select: async ({ input }) => {
        selects++;
        const visible = input.maps.flatMap(map => map.items.map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref })));
        expected = [visible.at(-1), ...visible.slice(0, -1)];
        await Promise.resolve(); if (action.startsWith('select-')) mutate();
        return { refs: action === 'empty' ? [] : [visible.at(-1)] };
      }, rank: async ({ input }) => {
        ranks++; assert.equal(input.limit, 2);
        assert.deepEqual(input.candidates.map(c => ({ namespaceIndex: c.namespaceIndex, memoryId: c.memory.id, revision: c.memory.revision })), expected);
        if (action.startsWith('rank-')) mutate();
        return { refs: expected.slice(0, 2).reverse() };
      } });
    core = openMemoryCore({ path: join(mkdtempSync(join(tmpdir(), 'cairn-augmentation-')), 'memory.sqlite'), model: wrapped }); t.after(() => core.close());
    for (const content of ['First source', 'Second source', 'Third source']) stored = ok(core.admit({ namespace,
      memory: { content, kind: 'fact' }, receipts: [{ client: 'test', sessionId: 's', eventId: content, role: 'user', excerpt: content }] })).memory;
    const result = await core.recall({ readSet: [namespace], query: 'Why now?', limit: 2, contextMode: 'source-evidence' });
    assert.equal(selects, 1);
    if (action === 'none') {
      const memories = ok(result).memories;
      assert.deepEqual(memories.map(m => m.memory.id), expected.slice(0, 2).reverse().map(r => r.memoryId));
      for (const memory of memories) assert.ok(['First source', 'Second source', 'Third source'].includes(memory.receipts[0].excerpt));
    } else if (action === 'empty') { assert.equal(ok(result).memories.length, 0); assert.equal(ranks, 0); }
    else {
      assert.equal(result.ok, false);
      const expectedCode = action === 'rank-budget' ? 'context_budget_exceeded' : action.startsWith('select-') ? 'index_revision_conflict' : 'revision_conflict';
      assert.equal(result.error.code, expectedCode, JSON.stringify(result));
    }
    if (action === 'rank-budget') assert.equal(ranks, 0);
  }
});
