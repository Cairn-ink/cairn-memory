import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { createOpenAIModel } from '../index.mjs';
import { createBudgetedFetch, runLiveLifecycle, matchesSeededPreference } from '../live-harness.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status });
const request = () => ({ system: 'Extract durable memories.', input: { messages: [] },
  maxOutputTokens: 1024, signal: new AbortController().signal });

test('live budget wrapper reports count/generation usage without request content', async () => {
  let calls = 0;
  const budget = createBudgetedFetch({ budgetUsd: 0.1, fetchImpl: async (url, options) => {
    calls++;
    const payload = JSON.parse(options.body);
    if (url.endsWith('/input_tokens')) return json({ object: 'response.input_tokens', input_tokens: 50 });
    return json({ object: 'response', model: payload.model, status: 'completed', error: null,
      incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: '{"items":[]}' }] }],
      usage: { input_tokens: 50, output_tokens: 5, total_tokens: 55 } });
  } });
  const model = createOpenAIModel({ apiKey: 'synthetic-secret', fetchImpl: budget.fetchImpl });
  assert.deepEqual(await model.extract(request()), { items: [] });
  assert.equal(calls, 2);
  const report = budget.snapshot();
  assert.ok(report.reservedUsd > 0 && report.reservedUsd <= 0.1);
  assert.equal(report.observedInputTokens, 50);
  assert.equal(report.observedOutputTokens, 5);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-secret|Extract durable|Bearer|"items"/);
});

test('insufficient budget prevents even the first remote request', async () => {
  let calls = 0;
  const budget = createBudgetedFetch({ budgetUsd: 0.000001, fetchImpl: async () => { calls++; } });
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: budget.fetchImpl });
  await assert.rejects(model.extract(request()));
  assert.equal(calls, 0);
  assert.equal(budget.snapshot().reservedUsd, 0);
});

test('failed requests keep reservations and request cap prevents another attempt', async () => {
  let calls = 0;
  const budget = createBudgetedFetch({ budgetUsd: 0.1, maxRequests: 1, fetchImpl: async () => {
    calls++; throw new Error('secret-from-provider-body');
  } });
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: budget.fetchImpl });
  await assert.rejects(model.extract(request()), /openai_request_failed/);
  const reserved = budget.snapshot().reservedUsd;
  assert.ok(reserved > 0);
  await assert.rejects(model.extract(request()));
  assert.equal(calls, 1);
  assert.equal(budget.snapshot().reservedUsd, reserved);
  assert.doesNotMatch(JSON.stringify(budget.snapshot()), /secret-from-provider-body/);
});

test('malformed count and rejected HTTP produce no generation request or raw error log', async () => {
  for (const response of [() => json({ object: 'wrong', sensitive: 'hidden-body' }),
    () => json({ error: 'hidden-body' }, 401)]) {
    let calls = 0;
    const budget = createBudgetedFetch({ budgetUsd: 0.1, fetchImpl: async () => { calls++; return response(); } });
    const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: budget.fetchImpl });
    await assert.rejects(model.extract(request()));
    assert.equal(calls, 1);
    assert.doesNotMatch(JSON.stringify(budget.snapshot()), /hidden-body/);
  }
});

test('aborted requests do not reach the remote fetch', async () => {
  let calls = 0;
  const budget = createBudgetedFetch({ budgetUsd: 0.1, fetchImpl: async () => { calls++; } });
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: budget.fetchImpl });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(model.extract({ ...request(), signal: controller.signal }), { name: 'AbortError' });
  assert.equal(calls, 0);
});

test('budget configuration rejects invalid or enlarged limits', () => {
  for (const budgetUsd of [0, -1, NaN, Infinity, 5.01, '1']) {
    assert.throws(() => createBudgetedFetch({ budgetUsd }));
  }
  for (const maxRequests of [0, -1, 1.5, 41, Infinity]) {
    assert.throws(() => createBudgetedFetch({ budgetUsd: 1, maxRequests }));
  }
});

test('CLI without explicit opt-in exits without printing inherited credentials', () => {
  const child = spawnSync(process.execPath, [new URL('../../../examples/openai-live.mjs', import.meta.url).pathname], {
    env: { PATH: process.env.PATH, OPENAI_API_KEY: 'synthetic-cli-secret' }, encoding: 'utf8', timeout: 5000 });
  assert.equal(child.error, undefined);
  assert.notEqual(child.status, 0);
  assert.doesNotMatch(child.stdout + child.stderr, /synthetic-cli-secret/);
});

test('full lifecycle runs against fake HTTP and reports all five acceptance stages', async () => {
  const counter = createOpenAIModel({ apiKey: 'synthetic-counter' });
  let counted;
  const report = await runLiveLifecycle({ apiKey: 'synthetic-only', budgetUsd: 0.25,
    fetchImpl: async (url, options) => {
      const payload = JSON.parse(options.body);
      const input = JSON.parse(payload.input[0].content[0].text);
      if (url.endsWith('/input_tokens')) {
        counted = counter.countTokens(JSON.stringify({ system: payload.instructions, input, maxOutputTokens: 1024 })) + 64;
        return json({ object: 'response.input_tokens', input_tokens: counted });
      }
      const method = payload.text.format.name;
      let output;
      if (method === 'cairn_extract') output = { items: [{ content: 'Use diagrams rather than long prose in code reviews.',
        kind: 'preference', confidence: 0.9, sourceIndices: [0] }] };
      else if (method === 'cairn_classify') output = { items: input.memories.map((memory) => ({
        memoryId: memory.id, parentIds: [], newL1: { title: 'Code review preferences', parentL2Ids: [] } })) };
      else if (method === 'cairn_select') output = { refs: input.maps.flatMap(({ namespaceIndex, items }) =>
        items.flatMap((item) => item.type === 'unfiled' ? [{ namespaceIndex, ...item.ref }] :
          item.type === 'ref' && item.ref.childType === 'memory' ? [{ namespaceIndex,
            memoryId: item.ref.childId, revision: item.ref.childRevision }] : [])).slice(0, 1) };
      else {
        assert.equal(method, 'cairn_rank');
        output = { refs: input.candidates.slice(0, 1).map(({ namespaceIndex, memory }) => ({
          namespaceIndex, memoryId: memory.id, revision: memory.revision })) };
      }
      const text = JSON.stringify(output);
      const outputTokens = counter.countTokens(text);
      return json({ object: 'response', model: payload.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text }] }],
        usage: { input_tokens: counted, output_tokens: outputTokens, total_tokens: counted + outputTokens } });
    } });
  assert.equal(report.ok, true, JSON.stringify(report));
  assert.equal(report.stages.length, 5);
  assert.ok(report.stages.every((stage) => stage.status === 'passed'));
  assert.ok(report.accounting.requestCount > 0);
  assert.doesNotMatch(JSON.stringify(report), /synthetic-only|Use diagrams/);
});

test('seed preference predicate rejects contradictions, unrelated overlap and unsupported paraphrases', () => {
  for (const text of ['I dislike diagrams in code reviews.', 'I prefer long prose over diagrams for code reviews.',
    'Do not use diagrams rather than long prose in code reviews.', 'Diagrams and code reviews are unrelated.',
    'I prefer diagrams over long prose for code reviews, but this is false.',
    'Someone else prefers diagrams over long prose for code reviews.', 'Use diagrams in code reviews.']) {
    assert.equal(matchesSeededPreference(text), false, text);
  }
  for (const text of ['For code reviews, I prefer diagrams rather than long prose.',
    'The user prefers diagrams over long prose for code reviews.',
    'Use diagrams instead of long prose in code reviews.']) assert.equal(matchesSeededPreference(text), true, text);
});

test('contradictory extraction cannot pass the lifecycle despite valid source bindings', async () => {
  for (const content of ['I dislike diagrams in code reviews.', 'Diagrams and code reviews are unrelated.']) {
    const report = await runLiveLifecycle({ apiKey: 'synthetic', budgetUsd: 0.25,
      fetchImpl: async (url, options) => {
        const payload = JSON.parse(options.body);
        if (url.endsWith('/input_tokens')) return json({ object: 'response.input_tokens', input_tokens: 100 });
        const input = JSON.parse(payload.input[0].content[0].text);
        const output = payload.text.format.name === 'cairn_extract'
          ? { items: [{ content, kind: 'preference', confidence: 0.9, sourceIndices: [0] }] }
          : { items: input.memories.map((memory) => ({ memoryId: memory.id, parentIds: [] })) };
        return json({ object: 'response', model: payload.model, status: 'completed', error: null,
          incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
          usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200 } });
      } });
    assert.equal(report.ok, false);
    assert.equal(report.stages.length, 1);
    assert.equal(report.stages[0].status, 'failed');
    assert.equal(report.accounting.requestCount, 4);
  }
});

test('lifecycle rejection records the failed stage without raw provider content', async () => {
  const report = await runLiveLifecycle({ apiKey: 'synthetic-only', budgetUsd: 0.25,
    fetchImpl: async () => { throw new Error('sensitive-provider-error'); } });
  assert.equal(report.ok, false);
  assert.equal(report.stages[0].status, 'failed');
  assert.ok(report.accounting.reservedUsd > 0);
  assert.doesNotMatch(JSON.stringify(report), /sensitive-provider-error|synthetic-only/);
});

test('guard rejects changed endpoint, model and enabled tools before network I/O', async () => {
  let valid;
  const spy = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    valid = { url, options }; throw new Error('stop');
  } });
  await assert.rejects(spy.extract(request()));
  for (const mutation of [
    { url: 'https://example.invalid/v1/responses/input_tokens' },
    { body: JSON.stringify({ ...JSON.parse(valid.options.body), model: 'other' }) },
    { body: JSON.stringify({ ...JSON.parse(valid.options.body), tools: [] }) },
  ]) {
    let calls = 0;
    const guard = createBudgetedFetch({ budgetUsd: 1, fetchImpl: async () => { calls++; } });
    await assert.rejects(guard.fetchImpl(mutation.url ?? valid.url,
      { ...valid.options, ...(mutation.body ? { body: mutation.body } : {}) }));
    assert.equal(calls, 0);
    assert.equal(guard.snapshot().reservedUsd, 0);
  }
});

test('timeout abort cancels a pending response stream and keeps its reservation', async () => {
  let cancelled = false;
  const controller = new AbortController();
  const guard = createBudgetedFetch({ budgetUsd: 1, fetchImpl: async () =>
    new Response(new ReadableStream({ start() { setTimeout(() => controller.abort(), 10); },
      cancel() { cancelled = true; } })) });
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: guard.fetchImpl });
  await assert.rejects(model.extract({ ...request(), signal: controller.signal }), { name: 'AbortError' });
  assert.equal(cancelled, true);
  assert.ok(guard.snapshot().reservedUsd > 0);
  assert.equal(guard.snapshot().requests[0].outcome, 'aborted');
});

test('budget exhausted between count and generation prevents generation', async () => {
  let calls = 0;
  const guard = createBudgetedFetch({ budgetUsd: 0.005, fetchImpl: async () => {
    calls++; return json({ object: 'response.input_tokens', input_tokens: 50 });
  } });
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: guard.fetchImpl });
  await assert.rejects(model.extract(request()));
  assert.equal(calls, 1);
  assert.equal(guard.snapshot().rejection, 'budget_exceeded');
});
