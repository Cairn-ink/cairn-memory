import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const guard = mock.method(globalThis, 'fetch', () => assert.fail('Native network forbidden'));
after(() => guard.mock.restore());
const request = () => ({ system: 'Select synthetic visible references.', input: { query: 'Synthetic', maps: [], maxRefs: 24 },
  maxOutputTokens: 1024, signal: new AbortController().signal });
function envelope(input = 2377, output = 123) {
  return { id: 'synthetic-response', object: 'response', model: 'gpt-4.1-mini-2025-04-14', status: 'completed', error: null, incomplete_details: null,
    output: [{ id: 'synthetic-message', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"refs":[]}', annotations: [] }] }],
    usage: { input_tokens: input, output_tokens: output, total_tokens: input + output } };
}
function fixture(preflight, response) {
  const calls = [], diagnostics = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-not-a-key', onDiagnostic: event => diagnostics.push(event), fetchImpl: async (url, options) => {
    calls.push({ url: String(url), body: JSON.parse(options.body) });
    assert.ok(calls.length <= 2, 'No retry');
    return Response.json(calls.length === 1 ? { object: 'response.input_tokens', input_tokens: preflight } : response);
  } });
  return { model, calls, diagnostics };
}

test('bounded observed upward and downward usage drift is accepted without changing count/generation projection', async t => {
  for (const [preflight, observed] of [[2251, 2377], [2377, 2251]]) {
    await t.test(`${preflight} preflight to ${observed} observed`, async () => {
      const { model, calls } = fixture(preflight, envelope(observed));
      assert.deepEqual(await model.select(request()), { refs: [] });
      assert.equal(calls.length, 2);
      const { max_output_tokens, store, stream, ...projection } = calls[1].body;
      assert.deepEqual(projection, calls[0].body);
      assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
    });
  }
});

test('observed usage has independent inclusive input/output ceilings and exact totals', async () => {
  for (const [input, output] of [[7024, 1024], [0, 0], [7024, 0], [0, 1024]]) {
    const { model, calls } = fixture(100, envelope(input, output));
    assert.deepEqual(await model.select(request()), { refs: [] }); assert.equal(calls.length, 2);
  }
  const mutations = [v => { v.usage = envelope(7025, 1).usage; }, v => { v.usage = envelope(100, 1025).usage; },
    v => { v.usage.total_tokens++; }, v => { delete v.usage; },
    ...['input_tokens', 'output_tokens', 'total_tokens'].flatMap(field => [undefined, null, -1, 0.5, '100', Number.MAX_SAFE_INTEGER + 1]
      .map(value => v => { v.usage[field] = value; }))];
  for (const mutate of mutations) {
    const response = envelope(); mutate(response);
    const { model, calls, diagnostics } = fixture(100, response);
    await assert.rejects(model.select(request()), error => error.code === 'invalid_model_output');
    assert.equal(calls.length, 2);
    assert.equal(diagnostics.length, 1);
    assert.equal(diagnostics[0].reason, 'response_usage');
    assert.ok(!JSON.stringify(diagnostics).includes('synthetic-not-a-key'));
    assert.ok(!JSON.stringify(diagnostics).includes('2377'));
  }
});

test('bounded drift does not bypass model, envelope or local output validation', async () => {
  for (const mutate of [v => { v.model = 'gpt-4.1-mini'; }, v => { delete v.model; },
    v => { v.output[0].content = [{ type: 'refusal', refusal: 'Synthetic refusal' }]; },
    v => { v.output.push({ type: 'function_call', name: 'synthetic', arguments: '{}' }); },
    v => { v.output[0].content[0].text = JSON.stringify({ refs: [], text: ' x'.repeat(1100) }); },
    v => { v.output[0].content[0].text = '{"refs":[]}' + ' '.repeat(40001); }]) {
    const response = envelope(); mutate(response);
    const { model, calls } = fixture(2251, response);
    await assert.rejects(model.select(request()), error => error.code === 'invalid_model_output');
    assert.equal(calls.length, 2);
  }
  const { model, calls } = fixture(7025, envelope(100, 1));
  await assert.rejects(model.select(request()), error => error.code === 'context_budget_exceeded');
  assert.equal(calls.length, 1);
});

const [major, minor] = process.versions.node.split('.').map(Number);
test('actual core accepts bounded drift but never finalizes over-limit or foreign/stale selections', {
  skip: major < 22 || (major === 22 && minor < 16) ? 'SQLite integration requires Node >=22.16.' : false,
}, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const namespace = { ownerId: 'synthetic-usage', scope: 'personal', projectId: null };
  const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
  for (const mode of ['accepted', 'over-input', 'over-output', 'foreign', 'stale']) {
    let memory, calls = 0, ranks = 0;
    const adapter = createOpenAIModel({ apiKey: 'synthetic-not-a-key', fetchImpl: async url => {
      calls++; assert.ok(calls <= 2);
      if (String(url).endsWith('input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 2251 });
      const response = envelope(mode === 'over-input' ? 7025 : 2377, mode === 'over-output' ? 1025 : 123);
      response.output[0].content[0].text = JSON.stringify({ refs: [{ namespaceIndex: 0,
        memoryId: mode === 'foreign' ? 'foreign' : memory.id, revision: mode === 'stale' ? memory.revision + 1 : memory.revision }] });
      return Response.json(response);
    } });
    const model = { ...adapter, rank: async ({ input }) => { ranks++; return { refs: input.candidates.map(c => ({ namespaceIndex: c.namespaceIndex, memoryId: c.memory.id, revision: c.memory.revision })) }; } };
    const core = openMemoryCore({ path: join(mkdtempSync(join(tmpdir(), 'cairn-usage-bounds-')), 'memory.sqlite'), model });
    t.after(() => core.close());
    memory = ok(core.admit({ namespace, memory: { content: 'Synthetic original', kind: 'fact' },
      receipts: [{ client: 'test', sessionId: 's', eventId: 'one', role: 'user', excerpt: 'Synthetic original' }] })).memory;
    const result = await core.recall({ readSet: [namespace], query: 'Synthetic original', contextMode: 'source-evidence' });
    assert.equal(calls, 2);
    if (mode === 'accepted') { assert.equal(ok(result).memories[0].receipts[0].excerpt, 'Synthetic original'); assert.equal(ranks, 1); }
    else { assert.equal(result.ok, false); assert.equal(ranks, 0); assert.equal(Object.hasOwn(result, 'value'), false); }
  }
});
