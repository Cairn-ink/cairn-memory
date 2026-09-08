import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { createBudgetedFetch } from '../live-harness.mjs';
import { DEFAULT_MODEL, EXPERIMENTAL_EXTRACTION_MODEL as candidate } from '../profiles.mjs';
import { runEvaluation } from '../../../evaluations/semantic-runner.mjs';
import { main } from '../../../examples/semantic-evaluation.mjs';

const native = mock.method(globalThis, 'fetch', () => assert.fail('No native HTTP in offline tests'));
after(() => native.mock.restore());
const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const request = (method = 'extract') => ({ system: 'Synthetic source-faithful operation.',
  input: { extract: { messages: [] }, classify: { memories: [], map: [], mapExhausted: true },
    select: { maps: [], query: 'Synthetic', maxRefs: 24 },
    rank: { candidates: [], query: 'Synthetic', limit: 6 } }[method],
  maxOutputTokens: 1024, signal: new AbortController().signal });
function response(payload, changes = {}) {
  const value = ['cairn_extract', 'cairn_classify'].includes(payload.text.format.name) ? { items: [] } : { refs: [] };
  return { object: 'response', model: payload.model, status: 'completed', error: null,
    incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(value) }] }],
    usage: { input_tokens: 50, output_tokens: 5, total_tokens: 55 }, ...changes };
}
function transport(calls, generation = response) {
  return async (url, options) => {
    const payload = JSON.parse(options.body);
    calls.push({ url, payload, wire: options.body });
    return json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 50 } : generation(payload));
  };
}

test('explicit extraction profile changes only extraction model/reasoning; other request bytes are unchanged', async () => {
  const baseline = [], selected = [];
  const old = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: transport(baseline) });
  const next = createOpenAIModel({ apiKey: 'synthetic', extractionModel: candidate, fetchImpl: transport(selected) });
  for (const method of ['extract', 'classify', 'select', 'rank']) {
    await old[method](request(method)); await next[method](request(method));
  }
  assert.equal(old.contextWindow, 1047576);
  assert.equal(next.contextWindow, 400000);
  assert.deepEqual(selected.slice(2), baseline.slice(2));
  for (let index = 0; index < 2; index++) {
    assert.equal(selected[index].payload.model, candidate);
    assert.deepEqual(selected[index].payload.reasoning, { effort: 'none' });
    const { reasoning, ...body } = selected[index].payload;
    assert.deepEqual({ ...body, model: DEFAULT_MODEL }, baseline[index].payload);
  }
  const { max_output_tokens, store, stream, ...generation } = selected[1].payload;
  assert.deepEqual(generation, selected[0].payload);
});

test('invalid profile/options and wrong response snapshot fail without fallback', async () => {
  for (const extractionModel of ['gpt-5.4-mini', 'other', null, {}, 5]) {
    assert.throws(() => createOpenAIModel({ apiKey: 'synthetic', extractionModel }), /invalid_openai_configuration/);
    assert.throws(() => createBudgetedFetch({ budgetUsd: 1, extractionModel }), /invalid_openai_configuration/);
    await assert.rejects(runEvaluation({ apiKey: 'synthetic', budgetUsd: 1, extractionModel }));
  }
  assert.throws(() => createOpenAIModel({ apiKey: 'synthetic', reasoning: { effort: 'high' } }));
  const calls = [];
  const adapter = createOpenAIModel({ apiKey: 'synthetic', extractionModel: candidate,
    fetchImpl: transport(calls, (payload) => response(payload, { model: DEFAULT_MODEL })) });
  await assert.rejects(adapter.extract(request()), (err) => err.code === 'invalid_model_output');
  assert.equal(calls.length, 2);
  const report = await main(['--live', '--budget-usd', '1', '--extraction-model', 'unknown'], { OPENAI_API_KEY: 'synthetic-cli' });
  assert.equal(report.error, 'evaluation_configuration_failed');
  assert.doesNotMatch(JSON.stringify(report), /synthetic-cli/);
  const accepted = await main(['--live', '--budget-usd', '0.000001', '--extraction-model', candidate],
    { OPENAI_API_KEY: 'synthetic-cli' });
  assert.equal(accepted.models.extract.model, candidate);
  assert.equal(accepted.reservedUsd, 0);
});

test('mixed guard reserves exact integer model units before I/O and computes model-priced usage', async () => {
  let guard;
  const observations = [];
  guard = createBudgetedFetch({ budgetUsd: 0.1, extractionModel: candidate,
    fetchImpl: async (url, options) => {
      observations.push(guard.snapshot().reservedUnits);
      return transport([])(url, options);
    } });
  const adapter = createOpenAIModel({ apiKey: 'synthetic', extractionModel: candidate, fetchImpl: guard.fetchImpl });
  await adapter.extract(request()); await adapter.classify(request('classify'));
  assert.deepEqual(observations, [9876, 19752, 24200, 28648]);
  const summary = guard.snapshot();
  assert.equal(summary.reservedUsd, 0.028648);
  assert.deepEqual(summary.requests.map(({ model }) => model), [candidate, candidate, DEFAULT_MODEL, DEFAULT_MODEL]);
  assert.equal(summary.observedUsageEstimateUsd, (50 * 0.75 + 5 * 4.5 + 50 * 0.4 + 5 * 1.6) / 1e6);
  assert.equal(summary.requests.reduce((sum, entry) => sum + entry.reservationUnits, 0), summary.reservedUnits);
});

test('candidate guards reject wrong reasoning or routing and require explicit opt-in before I/O', async () => {
  const calls = [];
  await createOpenAIModel({ apiKey: 'synthetic', extractionModel: candidate, fetchImpl: transport(calls) }).extract(request());
  const count = calls[0];
  for (const [extractionModel, payload] of [[DEFAULT_MODEL, count.payload],
    [candidate, { ...count.payload, reasoning: { effort: 'low' } }],
    [candidate, { ...count.payload, reasoning: undefined }],
    [candidate, { ...count.payload, model: DEFAULT_MODEL }]]) {
    let calls = 0;
    const guard = createBudgetedFetch({ budgetUsd: 1, extractionModel, fetchImpl: () => { calls++; } });
    await assert.rejects(guard.fetchImpl(count.url, { method: 'POST', redirect: 'error',
      signal: new AbortController().signal, body: JSON.stringify(payload) }));
    assert.equal(calls, 0); assert.equal(guard.snapshot().reservedUnits, 0);
  }
});

test('failed candidate requests are retained and budget stops between count and generation', async () => {
  for (const mode of ['http', 'throw', 'wrong_model', 'budget']) {
    let calls = 0;
    const guard = createBudgetedFetch({ budgetUsd: mode === 'budget' ? 0.009876 : 0.03,
      maxRequests: 2, extractionModel: candidate, fetchImpl: async (url, options) => {
        calls++;
        if (mode === 'http') return json({ error: 'private-error' }, 401);
        if (mode === 'throw') throw new Error('private-error');
        return transport([], (p) => response(p, { model: DEFAULT_MODEL }))(url, options);
      } });
    const adapter = createOpenAIModel({ apiKey: 'synthetic-secret', extractionModel: candidate, fetchImpl: guard.fetchImpl });
    await assert.rejects(adapter.extract(request()));
    assert.equal(calls, mode === 'wrong_model' ? 2 : 1);
    assert.equal(guard.snapshot().reservedUnits, calls * 9876);
    assert.doesNotMatch(JSON.stringify(guard.snapshot()), /private-error|synthetic-secret/);
  }
});

test('candidate shares input/output/response bounds and cancellation', async () => {
  for (const make of [() => json({ object: 'response.input_tokens', input_tokens: 7025 }),
    () => new Response('x'.repeat(65537))]) {
    let calls = 0;
    const adapter = createOpenAIModel({ apiKey: 'synthetic', extractionModel: candidate,
      fetchImpl: () => { calls++; return make(); } });
    await assert.rejects(adapter.extract(request())); assert.equal(calls, 1);
  }
  for (const changes of [{ usage: { input_tokens: 50, output_tokens: 1025, total_tokens: 1075 } },
    { status: 'incomplete' }, { output: [{ type: 'reasoning', summary: [] }] }]) {
    const adapter = createOpenAIModel({ apiKey: 'synthetic', extractionModel: candidate,
      fetchImpl: transport([], (p) => response(p, changes)) });
    await assert.rejects(adapter.extract(request()), (err) => err.code === 'invalid_model_output');
  }
  const adapter = createOpenAIModel({ apiKey: 'synthetic', extractionModel: candidate, fetchImpl: () => assert.fail('No I/O') });
  const req = request(); req.signal = AbortSignal.abort();
  await assert.rejects(adapter.extract(req), { name: 'AbortError' });
});

test('evaluation aggregate preserves full denominator and stops on candidate reservation, not old request rate', async () => {
  let calls = 0;
  const report = await runEvaluation({ apiKey: 'synthetic', extractionModel: candidate, budgetUsd: 0.019752,
    fetchImpl: async () => { calls++; return json({}, 401); } });
  assert.equal(calls, 2);
  assert.equal(report.reservedUsd, 0.019752);
  assert.equal(report.results.length, 36);
  assert.equal(report.results.filter((run) => run.status === 'unrun').length, 34);
  assert.equal(report.summary.captureRecovery.expected, 24);
  assert.equal(report.summary.status, 'incomplete');
  assert.equal(report.model, 'mixed');
  assert.equal(report.models.extract.model, candidate);
  assert.equal(report.models.rank.model, DEFAULT_MODEL);
  assert.equal(report.results.reduce((sum, run) => sum + (run.accounting?.reservedUnits ?? 0), 0), 19752);
});

test('all 36 fake mixed-model runs aggregate per-request units and retain pending semantic judgment', async () => {
  const report = await runEvaluation({ apiKey: 'synthetic-mixed', extractionModel: candidate, budgetUsd: 1.4,
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body);
      const method = payload.text.format.name;
      assert.equal(payload.model, method === 'cairn_extract' ? candidate : DEFAULT_MODEL);
      assert.deepEqual(payload.reasoning, method === 'cairn_extract' ? { effort: 'none' } : undefined);
      if (url.endsWith('/input_tokens')) return json({ object: 'response.input_tokens', input_tokens: 100 });
      const input = JSON.parse(payload.input[0].content[0].text);
      const outputs = {
        cairn_extract: () => ({ items: input.messages.map((message) => ({ content: message.content,
          kind: 'fact', confidence: 0.9, sourceIndices: [message.index] })) }),
        cairn_classify: () => ({ items: input.memories.map((memory) => ({ memoryId: memory.id, parentIds: [] })) }),
        cairn_select: () => ({ refs: input.maps.flatMap(({ namespaceIndex, items }) => items
          .filter((item) => item.type === 'unfiled').map((item) => ({ namespaceIndex, ...item.ref }))) }),
        cairn_rank: () => ({ refs: input.candidates.map(({ namespaceIndex, memory }) => ({
          namespaceIndex, memoryId: memory.id, revision: memory.revision })) }),
      };
      return json(response(payload, { output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(outputs[method]()) }] }],
        usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } }));
    } });
  assert.equal(report.summary.completedRuns, 36);
  assert.equal(report.summary.captureRecovery.expected, 24);
  assert.equal(report.summary.semanticReviewPending, true);
  assert.notEqual(report.summary.status, 'passed');
  const entries = report.results.flatMap((run) => run.accounting.requests);
  const units = entries.reduce((sum, entry) => sum + (entry.method === 'extract' ? 9876 : 4448), 0);
  assert.equal(report.reservedUsd, units / 1e6);
  assert.equal(report.results.reduce((sum, run) => sum + run.accounting.reservedUnits, 0), units);
  assert.ok(report.reservedUsd <= 1.4);
  assert.ok(report.results.every((run) => run.accounting.requestCount <= 40));
});
