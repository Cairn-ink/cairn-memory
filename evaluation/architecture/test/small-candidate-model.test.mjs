import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSmallCandidateRetentionModel } from '../small-candidate-model.mjs';

const candidate = (id, namespaceIndex = 0) => ({ namespaceIndex, memory: { id, revision: 1 },
  receipts: [{ id: `${id}-receipt`, role: 'user', excerpt: 'Complete synthetic source, not a summary.' }] });
const refs = candidates => candidates.map(c => ({ namespaceIndex: c.namespaceIndex, memoryId: c.memory.id, revision: c.memory.revision }));
const request = (count = 2, limit = 2) => ({ system: 'Original rank instructions', input: { query: 'Why now?', limit,
  candidates: Array.from({ length: count }, (_, i) => candidate(`m${i}`, i % 2)) }, maxOutputTokens: 1024, signal: new AbortController().signal });
const code = expected => error => error.code === expected;
function fixture(overrides = {}) {
  const calls = [], counts = [];
  const model = { contextWindow: 8192, countTokens(text) { counts.push(text); return 1; },
    async rank(value) { assert.equal(this, model); calls.push(value); return { refs: refs(value.input.candidates).slice(0, 1) }; },
    select: async value => value, extract: async value => value, classify: async value => value, ...overrides };
  return { model, calls, counts, wrapped: createSmallCandidateRetentionModel(model) };
}

test('empty, below and equal limits preserve exact ordered identities without calling rank', async () => {
  for (const [count, limit] of [[0, 1], [1, 2], [2, 2], [12, 12]]) {
    const { wrapped, calls, counts, model } = fixture(), incoming = request(count, limit);
    assert.ok(Object.isFrozen(wrapped));
    for (const field of ['select', 'extract', 'classify', 'contextWindow']) assert.equal(wrapped[field], model[field]);
    assert.equal(wrapped.countTokens('Synthetic counter probe'), 1);
    assert.deepEqual(await wrapped.rank(incoming), { refs: refs(incoming.input.candidates) });
    assert.equal(calls.length, 0);
    assert.ok(counts.includes(JSON.stringify({ system: incoming.system, input: incoming.input, maxOutputTokens: 1024 })));
  }
});

test('larger set delegates once to captured bound rank with every candidate field unchanged', async () => {
  const { wrapped, model, calls } = fixture(), incoming = request(3, 2);
  model.rank = () => assert.fail('Replacement must not run'); model.countTokens = () => assert.fail('Replacement counter');
  const expected = structuredClone(incoming.input);
  assert.deepEqual(await wrapped.rank(incoming), { refs: refs(incoming.input.candidates).slice(0, 1) });
  assert.equal(calls.length, 1); assert.deepEqual(calls[0].input, expected);
  assert.notEqual(calls[0].input, incoming.input); assert.ok(Object.isFrozen(calls[0].input.candidates[0].receipts));
  assert.equal(calls[0].signal, incoming.signal); assert.equal(calls[0].system, incoming.system); assert.equal(calls[0].maxOutputTokens, 1024);
  const failure = new Error('Synthetic rank failure'); let invocations = 0;
  await assert.rejects(() => fixture({ rank: async () => { invocations++; throw failure; } }).wrapped.rank(request(3)), e => e === failure);
  assert.equal(invocations, 1);
});

test('constructor and malformed request identities fail before rank without invoking accessors', async () => {
  for (const [change, error] of [[{ rank: null }, 'model_not_configured'], [{ countTokens: null }, 'token_count_unavailable'],
    [{ contextWindow: 8191 }, 'context_budget_exceeded']]) assert.throws(() => fixture(change), code(error));
  const mutations = [r => { r.input.limit = 0; }, r => { r.input.limit = 13; }, r => { r.input.limit = 1.5; },
    r => { r.input.query = ''; }, r => { r.input.query = '\ud800'; }, r => { r.input.candidates = Array(1); },
    r => { r.input.candidates = request(37).input.candidates; }, r => { r.input.candidates[1] = r.input.candidates[0]; },
    r => { r.input.candidates[0].namespaceIndex = -1; }, r => { r.input.candidates[0].memory.revision = 0; },
    r => { r.input.candidates[0].memory.revision = Number.MAX_SAFE_INTEGER + 1; }, r => { r.input.candidates[0].memory.id = ' invalid'; },
    r => { r.signal = {}; }, r => { r.maxOutputTokens = 1025; }];
  for (const mutate of mutations) {
    const incoming = request(), { wrapped, calls } = fixture(); mutate(incoming);
    await assert.rejects(() => wrapped.rank(incoming)); assert.equal(calls.length, 0);
  }
  let getters = 0;
  for (const mutate of [r => Object.defineProperty(r, 'input', { get() { getters++; return {}; } }),
    r => Object.defineProperty(r.input.candidates[0].memory, 'id', { get() { getters++; return 'm'; } })]) {
    const incoming = request(); mutate(incoming); await assert.rejects(() => fixture().wrapped.rank(incoming));
  }
  assert.equal(getters, 0);
});

test('independent input and synthetic-output ceilings reject without invoking original rank', async () => {
  for (const [counter, expected] of [[() => 6001, 'context_budget_exceeded'], [() => NaN, 'token_count_unavailable'],
    [() => -1, 'token_count_unavailable'], [() => 1.5, 'token_count_unavailable'], [() => { throw new Error('Synthetic'); }, 'token_count_unavailable'],
    [text => JSON.parse(text).system ? 1 : 1025, 'invalid_model_output']]) {
    const { wrapped, calls } = fixture({ countTokens: counter });
    await assert.rejects(() => wrapped.rank(request()), code(expected)); assert.equal(calls.length, 0);
  }
  const { wrapped } = fixture({ countTokens: text => JSON.parse(text).system ? 6000 : 1024 });
  assert.equal((await wrapped.rank(request())).refs.length, 2);
});

test('frozen snapshots survive counter and asynchronous caller mutation', async () => {
  const incoming = request();
  const { wrapped } = fixture({ countTokens: () => { incoming.input.candidates[0].memory.id = 'foreign'; return 1; } });
  assert.equal((await wrapped.rank(incoming)).refs[0].memoryId, 'm0');
  let finish, start;
  const ready = new Promise(resolve => { start = resolve; });
  const pendingInput = request(3);
  const delayed = fixture({ rank: value => {
    assert.throws(() => { value.input.candidates[0].memory.id = 'foreign'; });
    start(); return new Promise(resolve => { finish = () => resolve({ refs: refs(value.input.candidates).slice(0, 1) }); });
  } });
  const pending = delayed.wrapped.rank(pendingInput); await ready;
  pendingInput.input.candidates[0].receipts[0].excerpt = 'Changed'; pendingInput.input.candidates[0].memory.id = 'changed';
  finish(); assert.deepEqual(await pending, { refs: [{ namespaceIndex: 0, memoryId: 'm0', revision: 1 }] });
});

test('preabort and cancellation during counters or delegated completion never return references', async () => {
  for (const stage of ['before', 'input', 'output', 'delegate']) {
    const controller = new AbortController(); let calls = 0;
    if (stage === 'before') controller.abort();
    const { wrapped } = fixture({ countTokens: text => { if ((stage === 'input' && JSON.parse(text).system) || (stage === 'output' && !JSON.parse(text).system)) controller.abort(); return 1; },
      rank: async () => { calls++; await Promise.resolve(); controller.abort(); return { refs: [] }; } });
    await assert.rejects(() => wrapped.rank({ ...request(stage === 'delegate' ? 3 : 2), signal: controller.signal }), e => e.name === 'AbortError');
    assert.equal(calls, stage === 'delegate' ? 1 : 0);
  }
});

const [major, minor] = process.versions.node.split('.').map(Number);
test('real core retains a selected update, exposes negative cases, delegates large sets and fences mutations', {
  skip: major < 22 || (major === 22 && minor < 16) ? 'SQLite integration requires Node >=22.16; pure tests remain enabled.' : false,
}, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const namespace = { ownerId: 'small-candidate-test', scope: 'personal', projectId: null };
  const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
  for (const mode of ['baseline', 'retained', 'none-baseline', 'none-retained', 'large', 'correct', 'forget']) {
    let core, stored, rankCalls = 0, mutated = false;
    const model = { contextWindow: 8192, countTokens: text => {
      if (!mutated && ['correct', 'forget'].includes(mode) && text.includes('"refs"') && !text.includes('"system"')) {
        mutated = true;
        if (mode === 'forget') ok(core.forget({ namespace, memoryId: stored.id, expectedRevision: stored.revision }));
        else ok(core.correct({ namespace, memoryId: stored.id, expectedRevision: stored.revision, content: 'Corrected source', kind: 'fact',
          receipt: { client: 'test', sessionId: 's', eventId: 'correct', role: 'user', excerpt: 'Corrected source' } }));
      }
      return 1;
    }, select: async ({ input }) => ({ refs: input.maps.flatMap(map => map.items.map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }),
      rank: async ({ input }) => {
        rankCalls++;
        const original = input.candidates.find(item => item.receipts.some(receipt => receipt.excerpt === 'Original reason: cheap.'));
        return { refs: mode.startsWith('none-') ? [] : refs([original]) };
      } };
    core = openMemoryCore({ path: join(mkdtempSync(join(tmpdir(), 'cairn-small-candidates-')), 'memory.sqlite'),
      model: ['baseline', 'none-baseline'].includes(mode) ? model : createSmallCandidateRetentionModel(model) }); t.after(() => core.close());
    const contents = mode.startsWith('none-') ? ['Other actor chose wood.', 'Unadopted suggestion: use cloth.'] : ['Original reason: cheap.', 'Later price is higher.'];
    for (const content of contents) stored = ok(core.admit({ namespace, memory: { content, kind: 'fact' },
      receipts: [{ client: 'test', sessionId: 's', eventId: content, role: 'user', excerpt: content }] })).memory;
    const result = await core.recall({ readSet: [namespace], query: 'Original reason', limit: mode === 'large' ? 1 : 2, contextMode: 'source-evidence' });
    if (['correct', 'forget'].includes(mode)) { assert.ok(mutated); assert.equal(result.ok, false); }
    else {
      const memories = ok(result).memories;
      assert.equal(memories.length, mode === 'none-baseline' ? 0 : ['baseline', 'large'].includes(mode) ? 1 : 2);
      if (['baseline', 'large'].includes(mode)) assert.deepEqual(memories.flatMap(m => m.receipts.map(r => r.excerpt)), ['Original reason: cheap.']);
      if (['retained', 'none-retained'].includes(mode)) assert.deepEqual(new Set(memories.flatMap(m => m.receipts.map(r => r.excerpt))), new Set(contents));
      assert.equal(rankCalls, ['baseline', 'none-baseline', 'large'].includes(mode) ? 1 : 0);
    }
  }
  // The none-retained case documents unwanted exposure, not relevance or quality.
});
