import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createChecklistSelectionModel } from '../checklist-model.mjs';
import { prepareSelectionChecklist } from '../query-evidence-checklist.mjs';

const ref = { namespaceIndex: 0, memoryId: 'visible', revision: 1 };
const input = () => ({ query: 'Why now?', maxRefs: 24, maps: [{ namespaceIndex: 0, exhausted: true,
  items: [{ type: 'unfiled', ref: { memoryId: 'visible', revision: 1 }, label: 'Synthetic note' }] }] });
const output = () => ({ requests: [{ start: 0, end: 3, refs: [{ ...ref }] }] });
const request = () => ({ system: 'Unchanged outer selector prompt', input: input(), maxOutputTokens: 1024,
  signal: new AbortController().signal });
const hasCode = code => error => error?.name === 'MemoryStoreError' && error.code === code;
function fixture(overrides = {}) {
  const calls = [], counts = [];
  const model = { contextWindow: 8192, countTokens: text => { counts.push(text); return 1; },
    select: () => { throw new Error('Baseline selector must not run'); },
    selectChecklist: async value => { calls.push(value); return output(); },
    rank: async value => value, extract: async value => value, diagnostics: () => {}, ...overrides };
  return { model, calls, counts, wrapped: createChecklistSelectionModel(model) };
}

test('one checklist call replaces only selection and counts the actual replacement request', async () => {
  const { model, calls, counts, wrapped } = fixture();
  assert.ok(Object.isFrozen(wrapped));
  for (const field of ['rank', 'extract', 'countTokens', 'diagnostics', 'contextWindow']) assert.equal(wrapped[field], model[field]);
  const incoming = request();
  assert.deepEqual(await wrapped.select(incoming), { refs: [ref] });
  assert.equal(calls.length, 1);
  const expected = prepareSelectionChecklist(incoming.input).request;
  assert.equal(calls[0].system, expected.system);
  assert.deepEqual(calls[0].input, expected.input);
  assert.equal(calls[0].maxOutputTokens, 1024);
  assert.equal(calls[0].signal, incoming.signal);
  assert.deepEqual(Object.keys(calls[0]).sort(), ['input', 'maxOutputTokens', 'signal', 'system']);
  assert.ok(counts.includes(JSON.stringify({ ...expected, maxOutputTokens: 1024 })));
  assert.ok(counts.includes(JSON.stringify(output())));
  const ranked = { candidates: [] };
  assert.equal(await wrapped.rank(ranked), ranked);
});

test('replacement instruction budget and counter failures reject before candidate invocation', async () => {
  for (const [countTokens, code] of [[() => 6001, 'context_budget_exceeded'],
    [() => { throw new Error('private counter failure'); }, 'token_count_unavailable'],
    [() => NaN, 'token_count_unavailable'], [() => -1, 'token_count_unavailable'],
    [() => 1.5, 'token_count_unavailable']]) {
    const { wrapped, calls } = fixture({ countTokens });
    await assert.rejects(() => wrapped.select(request()), hasCode(code));
    assert.equal(calls.length, 0);
  }
});

test('constructor and incoming request contract fail closed without invoking an adapter', async () => {
  for (const [change, code] of [[{ selectChecklist: undefined }, 'model_not_configured'],
    [{ countTokens: undefined }, 'token_count_unavailable'], [{ contextWindow: 8191 }, 'context_budget_exceeded'],
    [{ contextWindow: 8192.5 }, 'context_budget_exceeded']]) {
    assert.throws(() => fixture(change), hasCode(code));
  }
  const { wrapped, calls } = fixture();
  for (const change of [{ maxOutputTokens: 1025 }, { maxOutputTokens: undefined }, { signal: null }, { signal: {} }]) {
    await assert.rejects(() => wrapped.select({ ...request(), ...change }));
  }
  const controller = new AbortController(); controller.abort();
  await assert.rejects(() => wrapped.select({ ...request(), signal: controller.signal }), error => error.name === 'AbortError');
  assert.equal(calls.length, 0);
});

test('token ceilings are inclusive and raw-output counter failures remain errors', async () => {
  const raw = JSON.stringify(output());
  const { wrapped } = fixture({ countTokens: text => text === raw ? 1024 : 6000 });
  assert.deepEqual(await wrapped.select(request()), { refs: [ref] });
  let calls = 0;
  const broken = fixture({ selectChecklist: async () => { calls++; return output(); }, countTokens: text => {
    if (text === raw) throw new Error('Counter failed after transport');
    return 1;
  } });
  await assert.rejects(() => broken.wrapped.select(request()), hasCode('token_count_unavailable'));
  assert.equal(calls, 1);
});

test('construction snapshots trusted methods and provider rejection propagates without fallback', async () => {
  const { model, wrapped, calls } = fixture();
  model.selectChecklist = () => { throw new Error('Replaced after construction'); };
  model.countTokens = () => { throw new Error('Replaced counter'); };
  assert.deepEqual(await wrapped.select(request()), { refs: [ref] });
  assert.equal(calls.length, 1);
  const failure = new Error('Synthetic provider rejection');
  let failures = 0;
  const failed = fixture({ selectChecklist: async () => { failures++; throw failure; } });
  await assert.rejects(() => failed.wrapped.select(request()), error => error === failure);
  assert.equal(failures, 1);
});

test('raw proposal token overflow fails despite a tiny valid compiled union', async () => {
  const raw = { requests: Array.from({ length: 4 }, (_, start) => ({ start, end: start + 1, refs: [{ ...ref }] })) };
  assert.deepEqual(prepareSelectionChecklist(input()).compile(raw).selection, { refs: [ref] });
  let calls = 0;
  const { wrapped } = fixture({ selectChecklist: async () => { calls++; return raw; },
    countTokens: text => text === JSON.stringify(raw) ? 1025 : 1 });
  await assert.rejects(() => wrapped.select(request()), hasCode('invalid_model_output'));
  assert.equal(calls, 1);
});

test('counter mutation cannot replace the raw proposal after its serialized tokens were counted', async () => {
  for (const mutate of [raw => { raw.requests[0].start = 4; raw.requests[0].end = 7; },
    raw => { raw.requests[0].refs = []; }, raw => { raw.extra = 'x'.repeat(40001); }]) {
    const raw = output();
    const serialized = JSON.stringify(raw);
    let calls = 0, outputCounts = 0;
    const { wrapped } = fixture({ selectChecklist: async () => { calls++; return raw; }, countTokens: text => {
      if (text === serialized) { outputCounts++; mutate(raw); }
      return 1;
    } });
    await assert.rejects(() => wrapped.select(request()), hasCode('invalid_model_output'));
    assert.equal(calls, 1);
    assert.equal(outputCounts, 1);
  }
});

test('raw serialization, character and compiler byte bounds fail without repair or retry', async () => {
  const circular = {}; circular.self = circular;
  const values = [undefined, circular, { requests: [], extra: 'x'.repeat(40001) },
    { requests: [], reason: 'invented coverage' }, { requests: Array(1) },
    { requests: [{ start: 0, end: 3, refs: [{ ...ref, revision: 2 }] }] }];
  for (const raw of values) {
    let calls = 0;
    const { wrapped } = fixture({ selectChecklist: async () => { calls++; return raw; } });
    await assert.rejects(() => wrapped.select(request()), hasCode('invalid_model_output'));
    assert.equal(calls, 1);
  }
  const incoming = request();
  const ids = Array.from({ length: 12 }, (_, i) => `${i}${'界'.repeat(190)}`);
  incoming.input.maps[0].items = ids.map(memoryId => ({ type: 'unfiled', ref: { memoryId, revision: 1 }, label: '' }));
  const raw = { requests: Array.from({ length: 4 }, (_, start) => ({ start, end: start + 1,
    refs: ids.map(memoryId => ({ ...ref, memoryId })) })) };
  assert.ok(JSON.stringify(raw).length < 40000);
  assert.ok(Buffer.byteLength(JSON.stringify(raw)) > 16000);
  await assert.rejects(() => fixture({ selectChecklist: async () => raw }).wrapped.select(incoming), hasCode('invalid_model_output'));
});

test('snapshot authority survives caller and adapter mutation across the asynchronous boundary', async () => {
  let finish, started;
  const ready = new Promise(resolve => { started = resolve; });
  const incoming = request();
  const { wrapped } = fixture({ selectChecklist: value => {
    assert.throws(() => { value.input.maps[0].items[0].ref.memoryId = 'foreign'; });
    started(); return new Promise(resolve => { finish = resolve; });
  } });
  const pending = wrapped.select(incoming);
  await ready;
  incoming.input.maps[0].items[0].ref.memoryId = 'foreign';
  incoming.input.query = 'Changed question';
  finish(output());
  assert.deepEqual(await pending, { refs: [ref] });
});

test('incoming abort signal reaches the sole adapter call and its rejection is not retried', async () => {
  const controller = new AbortController();
  let started;
  const ready = new Promise(resolve => { started = resolve; });
  let calls = 0;
  const { wrapped } = fixture({ selectChecklist: ({ signal }) => {
    calls++; assert.equal(signal, controller.signal); started();
    return new Promise((resolve, reject) => signal.addEventListener('abort', () => reject(new DOMException('Cancelled', 'AbortError')), { once: true }));
  } });
  const pending = wrapped.select({ ...request(), signal: controller.signal });
  await ready; controller.abort();
  await assert.rejects(() => pending, error => error.name === 'AbortError');
  assert.equal(calls, 1);
});

const [major, minor] = process.versions.node.split('.').map(Number);
test('actual core keeps ranking and correction/forget freshness fences around wrapped selection', {
  skip: major < 22 || (major === 22 && minor < 16) ? 'SQLite integration requires Node >=22.16; pure wrapper tests remain enabled.' : false,
}, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
  const namespace = { ownerId: 'checklist-wrapper', scope: 'personal', projectId: null };
  for (const action of ['none', 'correct', 'forget']) {
    let core, memory;
    const methods = [];
    const { wrapped } = fixture({ selectChecklist: async ({ input }) => {
      methods.push('checklist');
      return { requests: [{ start: 0, end: 3, refs: input.maps.flatMap(map => map.items.map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }] };
    }, rank: async ({ input }) => {
      methods.push('rank'); assert.equal(input.candidates.length, 1);
      if (action === 'forget') ok(core.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }));
      if (action === 'correct') ok(core.correct({ namespace, memoryId: memory.id, expectedRevision: memory.revision,
        content: 'New note', kind: 'fact', receipt: { client: 't', sessionId: 's', eventId: 'new', role: 'user', excerpt: 'New note' } }));
      return { refs: input.candidates.map(candidate => ({ namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })) };
    } });
    core = openMemoryCore({ path: join(mkdtempSync(join(tmpdir(), 'cairn-checklist-wrapper-')), 'memory.sqlite'), model: wrapped });
    t.after(() => core.close());
    memory = ok(core.admit({ namespace, memory: { content: 'Original note', kind: 'fact' },
      receipts: [{ client: 't', sessionId: 's', eventId: 'old', role: 'user', excerpt: 'Original note' }] })).memory;
    const result = await core.recall({ readSet: [namespace], query: 'Why now?', contextMode: 'source-evidence' });
    assert.deepEqual(methods, ['checklist', 'rank']);
    if (action === 'none') assert.equal(ok(result).memories[0].receipts[0].excerpt, 'Original note');
    else { assert.equal(result.ok, false); assert.equal(result.error.code, 'revision_conflict'); }
  }
});
