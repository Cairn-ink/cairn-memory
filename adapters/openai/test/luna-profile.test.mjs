import assert from 'node:assert/strict';
import test, { after, mock } from 'node:test';
import { createOpenAIModel } from '../index.mjs';
import { createBudgetedFetch } from '../live-harness.mjs';
import { DEFAULT_MODEL, LUNA_EXTRACTION_MODEL as candidate, modelProfile } from '../profiles.mjs';
import { runEvaluation } from '../../../evaluations/semantic-runner.mjs';

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

test('Luna is explicit extraction-only with identical count/generation inputs and unchanged baseline bytes', async () => {
  const baseline = [], selected = [];
  const old = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: transport(baseline) });
  const next = createOpenAIModel({ apiKey: 'synthetic', extractionModel: candidate, fetchImpl: transport(selected) });
  for (const method of ['extract', 'classify', 'select', 'rank']) {
    await old[method](request(method)); await next[method](request(method));
  }
  assert.equal(modelProfile(candidate).extract.contextWindow, 1050000);
  // Shared orchestration remains limited by the smaller baseline context.
  assert.equal(next.contextWindow, old.contextWindow);
  assert.deepEqual(selected.slice(2), baseline.slice(2));
  for (let index = 0; index < 2; index++) {
    assert.equal(selected[index].payload.model, 'gpt-5.6-luna');
    assert.deepEqual(selected[index].payload.reasoning, { effort: 'none' });
    const { reasoning, ...body } = selected[index].payload;
    assert.deepEqual({ ...body, model: DEFAULT_MODEL }, baseline[index].payload);
  }
  const { max_output_tokens, store, stream, ...generation } = selected[1].payload;
  assert.deepEqual(generation, selected[0].payload);
  assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
  assert.ok(Object.isFrozen(modelProfile(candidate).extract));
  assert.ok(Object.isFrozen(modelProfile(candidate).extract.reasoning));
});

test('Luna rejects invented snapshots/configurations and mismatched returned models without fallback', async () => {
  for (const extractionModel of ['gpt-5.6-luna-2026-09-11', 'luna', 'other', null, {}, 5]) {
    assert.throws(() => createOpenAIModel({ apiKey: 'synthetic', extractionModel }), /invalid_openai_configuration/);
    assert.throws(() => createBudgetedFetch({ budgetUsd: 1, extractionModel }), /invalid_openai_configuration/);
  }
  for (const returned of [DEFAULT_MODEL, 'gpt-5.6-luna-2026-09-11', undefined]) {
    const calls = [];
    const adapter = createOpenAIModel({ apiKey: 'synthetic', extractionModel: candidate,
      fetchImpl: transport(calls, (payload) => response(payload, { model: returned })) });
    await assert.rejects(adapter.extract(request()), (err) => err.code === 'invalid_model_output');
    assert.equal(calls.length, 2);
  }
});

test('Luna reserves ceiling-priced integer units before I/O and conservatively prices all input at cache-write rate', async () => {
  const entry = modelProfile(candidate).extract;
  assert.equal(entry.inputRate, 0.20 * 1.25);
  assert.equal(entry.outputRate, 1.20);
  assert.equal(entry.reservationUnits, Math.ceil(7024 * entry.inputRate + 1024 * entry.outputRate));
  let guard;
  const observations = [];
  guard = createBudgetedFetch({ budgetUsd: 0.1, extractionModel: candidate,
    fetchImpl: async (url, options) => {
      observations.push(guard.snapshot().reservedUnits);
      return transport([])(url, options);
    } });
  const adapter = createOpenAIModel({ apiKey: 'synthetic', extractionModel: candidate, fetchImpl: guard.fetchImpl });
  await adapter.extract(request()); await adapter.classify(request('classify'));
  assert.deepEqual(observations, [2985, 5970, 10418, 14866]);
  const summary = guard.snapshot();
  assert.equal(summary.reservedUsd, 0.014866);
  assert.equal(summary.observedUsageEstimateUsd, (50 * .25 + 5 * 1.2 + 50 * .4 + 5 * 1.6) / 1e6);
  assert.deepEqual(summary.requests.map(({ model }) => model), [candidate, candidate, DEFAULT_MODEL, DEFAULT_MODEL]);
  assert.equal(summary.requests.reduce((sum, item) => sum + item.reservationUnits, 0), summary.reservedUnits);
});

test('Luna guard rejects missing opt-in, wrong routing and altered reasoning before any reservation or I/O', async () => {
  const calls = [];
  const adapter = createOpenAIModel({ apiKey: 'synthetic', extractionModel: candidate, fetchImpl: transport(calls) });
  await adapter.extract(request()); await adapter.classify(request('classify'));
  const count = calls[0];
  for (const [extractionModel, payload] of [[DEFAULT_MODEL, count.payload],
    [candidate, { ...count.payload, reasoning: { effort: 'low' } }],
    [candidate, { ...count.payload, reasoning: undefined }],
    [candidate, { ...count.payload, model: DEFAULT_MODEL }],
    [candidate, { ...calls[2].payload, model: candidate, reasoning: { effort: 'none' } }]]) {
    const guard = createBudgetedFetch({ budgetUsd: 1, extractionModel, fetchImpl: () => assert.fail('No I/O') });
    await assert.rejects(guard.fetchImpl(count.url, { method: 'POST', redirect: 'error',
      signal: new AbortController().signal, body: JSON.stringify(payload) }));
    assert.equal(guard.snapshot().reservedUnits, 0);
  }
});

test('Luna failed, interrupted and unknown attempts stay reserved; limits prevent the next attempt', async () => {
  for (const mode of ['http', 'throw', 'wrong_model', 'budget', 'request_limit', 'abort']) {
    let calls = 0;
    const req = request();
    const controller = new AbortController(); req.signal = controller.signal;
    const guard = createBudgetedFetch({ budgetUsd: mode === 'budget' ? 0.002985 : 0.03,
      maxRequests: mode === 'request_limit' ? 1 : 2, extractionModel: candidate,
      fetchImpl: async (url, options) => {
        calls++;
        if (mode === 'http') return json({ error: 'private-error' }, 401);
        if (mode === 'throw') throw new Error('private-error');
        if (mode === 'abort') controller.abort();
        return transport([], (p) => response(p, { model: DEFAULT_MODEL }))(url, options);
      } });
    const adapter = createOpenAIModel({ apiKey: 'synthetic-secret', extractionModel: candidate, fetchImpl: guard.fetchImpl });
    await assert.rejects(adapter.extract(req));
    assert.equal(calls, mode === 'wrong_model' ? 2 : 1);
    assert.equal(guard.snapshot().reservedUnits, calls * 2985);
    assert.doesNotMatch(JSON.stringify(guard.snapshot()), /private-error|synthetic-secret/);
  }
});

test('Luna retains count/input/output/body bounds and preflight cancellation', async () => {
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

test('Luna evaluation preserves the frozen denominator and records mixed routing under exhaustion', async () => {
  let calls = 0;
  const report = await runEvaluation({ apiKey: 'synthetic', extractionModel: candidate, budgetUsd: 0.005970,
    fetchImpl: async () => { calls++; return json({}, 401); } });
  assert.equal(calls, 2);
  assert.equal(report.reservedUsd, 0.005970);
  assert.equal(report.results.length, 36);
  assert.equal(report.results.filter((run) => run.status === 'unrun').length, 34);
  assert.equal(report.summary.captureRecovery.expected, 24);
  assert.equal(report.summary.status, 'incomplete');
  assert.equal(report.model, 'mixed');
  assert.equal(report.models.extract.model, candidate);
  assert.equal(report.models.rank.model, DEFAULT_MODEL);
  assert.equal(report.results.reduce((sum, run) => sum + (run.accounting?.reservedUnits ?? 0), 0), 5970);
});
