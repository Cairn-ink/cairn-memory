import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOpenAIModel } from '../index.mjs';
import { schemas, schemasFor } from '../schemas.mjs';

const native = mock.method(globalThis, 'fetch', () => assert.fail('No native network in checklist tests'));
after(() => native.mock.restore());
const input = () => ({ query: 'Why 😀 now?', maxRefs: 24, maps: [{ namespaceIndex: 1, exhausted: true,
  items: [{ type: 'unfiled', ref: { memoryId: 'visible', revision: 2 }, label: 'Synthetic note' },
    { type: 'moc', moc: { id: 'group', revision: 1, level: 'L1', title: 'Synthetic group' } }] }] });
const request = () => ({ system: 'Synthetic checklist instructions', input: input(), maxOutputTokens: 1024,
  signal: new AbortController().signal });
const proposal = () => ({ requests: [{ start: 0, end: 3, refs: [{ namespaceIndex: 1, memoryId: 'visible', revision: 2 }] }] });
const json = value => new Response(JSON.stringify(value));
const response = value => ({ object: 'response', model: 'gpt-4.1-mini-2025-04-14', status: 'completed',
  error: null, incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
  usage: { input_tokens: 100, output_tokens: 40, total_tokens: 140 } });
function harness(output = proposal(), onCount = () => {}) {
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-checklist-key', extractionModel: 'gpt-5.6-luna',
    fetchImpl: async (url, options) => {
      calls.push({ url, options, body: JSON.parse(options.body) });
      assert.ok(calls.length <= 2, 'No retries');
      if (calls.length === 1) { onCount(); return json({ object: 'response.input_tokens', input_tokens: 100 }); }
      return json(response(output));
    } });
  return { model, calls };
}

test('checklist count and generation use unchanged select profile and return the raw proposal', async () => {
  const original = request();
  const frozenInput = structuredClone(original.input);
  const { model, calls } = harness(proposal(), () => { original.input.maps[0].items[0].ref.memoryId = 'mutated'; });
  assert.deepEqual(await model.selectChecklist(original), proposal());
  assert.deepEqual(calls.map(call => call.url), ['https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
  for (const { body, options } of calls) {
    assert.equal(body.model, 'gpt-4.1-mini-2025-04-14');
    assert.equal(body.reasoning, undefined);
    assert.equal(body.instructions, original.system);
    assert.equal(body.truncation, 'disabled');
    assert.equal(body.text.format.name, 'cairn_selectChecklist');
    assert.equal(body.text.format.strict, true);
    assert.deepEqual(JSON.parse(body.input[0].content[0].text), frozenInput);
    assert.equal(options.redirect, 'error'); assert.equal(options.signal, original.signal);
  }
  const { max_output_tokens, store, stream, ...generation } = calls[1].body;
  assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
  assert.deepEqual(generation, calls[0].body);
});

test('checklist schema has exact fields, bounded offsets, and only visible memory values', () => {
  const schema = schemasFor('selectChecklist', input());
  const strict = node => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual(node.required, Object.keys(node.properties));
    }
    Object.values(node).forEach(strict);
  };
  strict(schema);
  assert.deepEqual(schema.required, ['requests']);
  assert.equal(schema.properties.requests.maxItems, 4);
  const group = schema.properties.requests.items.properties;
  assert.deepEqual(group.start, { type: 'integer', minimum: 0, maximum: input().query.length - 1 });
  assert.deepEqual(group.end, { type: 'integer', minimum: 1, maximum: input().query.length });
  assert.equal(group.refs.maxItems, 1);
  assert.deepEqual(group.refs.items.properties.namespaceIndex.enum, [1]);
  assert.deepEqual(group.refs.items.properties.memoryId.enum, ['visible']);
  assert.deepEqual(group.refs.items.properties.revision.enum, [2]);
  for (const maps of [[], [{ namespaceIndex: 0, items: [], exhausted: false }]]) {
    assert.equal(schemasFor('selectChecklist', { ...input(), maps }).properties.requests.items.properties.refs.maxItems, 0);
  }
});

test('checklist malformed inputs reject before fake HTTP, including fields erased by JSON', async () => {
  const changes = [v => { v.extra = undefined; }, v => { v.query = '\ud800'; }, v => { v.query = 'x'.repeat(4001); },
    v => { v.maxRefs = 25; }, v => { v.maps = Array(1); }, v => { v.maps.extra = true; },
    v => { v.maps[Symbol('extra')] = true; }, v => { v.maps[0].items = Array(1); },
    v => { v.maps[0].items[0].ref.revision = 0; }, v => { v.maps[0].items[0].ref.memoryId = ' bad'; },
    v => { v.maps[0].items[0].label = '界'.repeat(8001); },
    v => { v.maps[0].items[0].ref.extra = undefined; }];
  for (const mutate of changes) {
    const { model, calls } = harness(); const req = request(); mutate(req.input);
    await assert.rejects(model.selectChecklist(req), /invalid_openai_request/);
    assert.equal(calls.length, 0);
  }
});

test('malformed envelopes fail and malformed raw proposals are not silently compiled or repaired', async () => {
  const bad = harness([]);
  await assert.rejects(bad.model.selectChecklist(request()), /invalid_model_output/);
  assert.equal(bad.calls.length, 2);
  const raw = { requests: [], inventedCoverage: 'complete' };
  const unchanged = harness(raw);
  assert.deepEqual(await unchanged.model.selectChecklist(request()), raw);
  // Final shape/correlation validation belongs to the bounded wrapper compiler.
});

test('checklist cancellation before count and between count/generation does not retry', async () => {
  for (const immediate of [true, false]) {
    const controller = new AbortController();
    const { model, calls } = harness(proposal(), () => controller.abort());
    if (immediate) controller.abort();
    await assert.rejects(model.selectChecklist({ ...request(), signal: controller.signal }), { name: 'AbortError' });
    assert.equal(calls.length, immediate ? 0 : 1);
  }
});

test('baseline select and its exported guard allowlist stay unchanged', async () => {
  assert.deepEqual(Object.keys(schemas).sort(), ['classify', 'extract', 'rank', 'select']);
  assert.equal(Object.hasOwn(schemas, 'selectChecklist'), false);
  const baseline = harness({ refs: [] });
  assert.deepEqual(await baseline.model.select(request()), { refs: [] });
  assert.equal(baseline.calls[0].body.text.format.name, 'cairn_select');
  assert.deepEqual(baseline.calls[0].body.text.format.schema, schemasFor('select', input()));
});

const [major, minor] = process.versions.node.split('.').map(Number);
test('old budget guard denies checklist before transport', {
  skip: major < 22 || (major === 22 && minor < 16) ? 'Guard harness imports SQLite core; requires Node >=22.16.' : false,
}, async () => {
  const { createBudgetedFetch } = await import('../live-harness.mjs');
  const candidate = harness(); await candidate.model.selectChecklist(request());
  const guard = createBudgetedFetch({ budgetUsd: 0.1, fetchImpl: () => assert.fail('No guarded I/O') });
  await assert.rejects(guard.fetchImpl(candidate.calls[0].url, candidate.calls[0].options), /request_rejected/);
  assert.deepEqual(guard.snapshot().requests, []);
});

test('existing durable experiment guard denies count and generation without reservations', {
  skip: major < 22 || (major === 22 && minor < 16) ? 'Durable SQLite ledger requires Node >=22.16.' : false,
}, async t => {
  const { createExperimentBudget } = await import('../../../evaluation/experiment-budget/index.mjs');
  const { createExperimentRequestGuard } = await import('../../../evaluation/experiment-budget/request-guard.mjs');
  const { experimentPolicy } = await import('../../../evaluation/live/session.mjs');
  const ledger = { directory: join(mkdtempSync(join(tmpdir(), 'cairn-checklist-guard-')), 'ledger'),
    runId: randomUUID(), limitMicroUsd: 100000, requestCap: 10 };
  createExperimentBudget(ledger).close();
  const guard = createExperimentRequestGuard({ ledger, policy: experimentPolicy(),
    fetchImpl: () => assert.fail('No provider I/O') });
  t.after(() => guard.close());
  const before = guard.getState();
  const candidate = harness(); await candidate.model.selectChecklist(request());
  for (const call of candidate.calls) {
    await assert.rejects(guard.cairnFetch(call.url, call.options), error => error.code === 'unsupported_request');
    assert.deepEqual(guard.getState(), before);
  }
});
