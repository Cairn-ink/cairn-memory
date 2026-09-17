import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { compileSourceContextUnits, openMemoryCore, prepareSourceContextUnits } from '../../../core/index.mjs';
import { createExperimentBudget } from '../../../evaluation/experiment-budget/index.mjs';
import { experimentPolicy } from '../../../evaluation/live/session.mjs';
import * as guards from '../../../evaluation/experiment-budget/request-guard.mjs';
import { createOpenAIModel, countOpenAITokens } from '../index.mjs';
import { schemas, schemasFor } from '../schemas.mjs';
import { DEFAULT_MODEL, LUNA_EXTRACTION_MODEL, SOL_RATIONALE_MODEL } from '../profiles.mjs';

const excerpt = 'The team considered A; adoption is still pending.';
const raw = () => ({ sources: [{ receipts: [{ role: 'user', excerpt }] }] });
const field = (value, evidence = []) => ({ value, evidence });
const proposal = () => ({ units: [{ source: 0, receipt: 0, kind: 'decision_state',
  subject: field(null, [0]), property: field(null), scope: field(null), applies: field(null),
  value: field(null), attribution: field('unknown'), polarity: field('unknown'),
  quantifier: field('unknown'), state: field('considered', [0]),
  eventTimeContext: [], reporterContext: [] }] });
const request = () => ({ system: 'Synthetic source-only assessment.',
  ...prepareSourceContextUnits(raw()), maxOutputTokens: 3072,
  signal: new AbortController().signal });
const response = (body, output = proposal(), usage = {}) => Response.json({
  object: 'response', model: body.model, status: 'completed', error: null,
  incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
    content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 100, output_tokens: 100, total_tokens: 200, ...usage },
});
function harness({ output = proposal(), count = 100, usage, basisModel = DEFAULT_MODEL,
  onDiagnostic, onCount, onGenerate } = {}) {
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic-only', basisModel, onDiagnostic,
    fetchImpl: async (url, options) => {
      const body = JSON.parse(options.body);
      calls.push({ url, options, body });
      if (url.endsWith('/input_tokens')) {
        onCount?.(body);
        return Response.json({ object: 'response.input_tokens', input_tokens: count });
      }
      onGenerate?.(body);
      return response(body, output, usage);
    } });
  return { model, calls };
}

test('SCA1–4 exact source-only count/generation bodies use basisModel and CU schema', async () => {
  for (const basisModel of [DEFAULT_MODEL, LUNA_EXTRACTION_MODEL, SOL_RATIONALE_MODEL]) {
    const h = harness({ basisModel }); const input = request();
    assert.deepEqual(await h.model.reviewSourceContext(input), proposal());
    assert.equal(h.calls.length, 2);
    const [counted, generated] = h.calls.map(call => call.body);
    assert.deepEqual(h.calls.map(call => call.url), [
      'https://api.openai.com/v1/responses/input_tokens', 'https://api.openai.com/v1/responses']);
    assert.equal(counted.model, basisModel);
    assert.deepEqual(counted.text.format, { type: 'json_schema', name: 'cairn_reviewSourceContext',
      strict: true, schema: input.responseSchema });
    assert.deepEqual(JSON.parse(counted.input[0].content[0].text), input.input);
    assert.equal(counted.instructions, input.system);
    assert.equal(counted.truncation, 'disabled');
    assert.deepEqual(generated, { ...counted, max_output_tokens: 3072,
      store: false, stream: false });
    assert.equal(countOpenAITokens(JSON.stringify({ system: input.system, input: input.input,
      maxOutputTokens: 3072, responseSchema: input.responseSchema })) <= 6000, true);
    assert.equal(JSON.stringify(counted).includes('synthetic-client'), false);
    assert.equal(Object.hasOwn(schemas, 'reviewSourceContext'), false);
    assert.deepEqual(schemasFor('reviewSourceContext', input.input), input.responseSchema);
  }
});

test('SCA2 malformed options, source input and schema reject before HTTP', async () => {
  const h = harness();
  const mutations = [
    value => { value.extra = true; },
    value => { value.maxOutputTokens = 1024; },
    value => { value.responseSchema = undefined; },
    value => { value.responseSchema.properties.units.maxItems = 9; },
    value => { value.input.sources[0].receipts[0].passages[0].index = 1; },
    value => { value.input.sources[0].receipts[0].role = 'system'; },
    value => { value.input.sources[0].receipts[0].client = 'private'; },
    value => { value.input.sources[0].receipts[0].passages = [, value.input.sources[0].receipts[0].passages[0]]; },
    value => { value.input.sources[0].receipts[0].passages.push(value.input.sources[0].receipts[0].passages[0]); },
    value => { value.input.sources[0].receipts[0].passages[0].text += '\ud800'; },
    value => { value.input.sources[0].receipts[0].passages[0].text += 'x'.repeat(6001); },
    value => { value.responseSchema.self = value.responseSchema; },
    value => { Object.defineProperty(value.responseSchema, 'type', {
      get: () => 'object', enumerable: true }); },
    value => { Object.setPrototypeOf(value.input.sources[0], null); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const value = structuredClone(request());
    value.signal = new AbortController().signal;
    mutate(value);
    await assert.rejects(h.model.reviewSourceContext(value), /invalid_openai_request/,
      `mutation ${index} must reject`);
  }
  assert.equal(h.calls.length, 0);
});

test('SCA2 caller mutations during count cannot change snapshotted schema or source text', async () => {
  const originalRequest = request();
  const value = { ...originalRequest, input: structuredClone(originalRequest.input),
    responseSchema: structuredClone(originalRequest.responseSchema) };
  const original = structuredClone({ input: value.input, responseSchema: value.responseSchema });
  const h = harness({ onCount: () => {
    value.input.sources[0].receipts[0].passages[0].text = 'changed';
    value.responseSchema.properties.units.maxItems = 99;
  } });
  assert.deepEqual(await h.model.reviewSourceContext(value), proposal());
  assert.deepEqual(JSON.parse(h.calls[1].body.input[0].content[0].text), original.input);
  assert.deepEqual(h.calls[1].body.text.format.schema, original.responseSchema);
});

test('SCA3 local request budget includes the canonical schema before HTTP', async () => {
  const value = request();
  value.system = 'x '.repeat(5000);
  const tokens = system => countOpenAITokens(JSON.stringify({ system, input: value.input,
    maxOutputTokens: 3072, responseSchema: value.responseSchema }));
  assert.ok(countOpenAITokens(JSON.stringify({ system: value.system, input: value.input,
    maxOutputTokens: 3072 })) <= 6000);
  assert.ok(tokens(value.system) > 6000);
  const h = harness();
  await assert.rejects(h.model.reviewSourceContext(value), { code: 'context_budget_exceeded' });
  assert.equal(h.calls.length, 0);
});

test('SCA1 old reviewBasis and relate preserve fixed-base serialized bytes and 1024 boundary', async () => {
  const oldHashes = {
    reviewBasis: ['5832abb7c9c93dd17c3cca9ff1abd4254942a80320151489a157a588da599215',
      '3c9b7d720abc79cdfb23b5b0e019859665fe2f4c8771bcdbe332817ccbb8a4db'],
    relate: ['2b856c83f3adb67203861b66776733d0b6da17a896f9d9eaeaa22783cac80d09',
      '0c66a2b11d6b60c46f35ca7be204a7a7bf5c0c6f8e426191595426dbf93dfe4c'],
  };
  for (const method of ['reviewBasis', 'relate']) {
    const calls = [];
    const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
      calls.push(options.body);
      const body = JSON.parse(options.body);
      return Response.json(url.endsWith('/input_tokens')
        ? { object: 'response.input_tokens', input_tokens: 100 }
        : { object: 'response', model: body.model, status: 'completed', error: null,
          incomplete_details: null, output: [{ type: 'message', role: 'assistant',
            status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(
              method === 'relate' ? { edges: [] } : { units: [], links: [] }) }] }],
          usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } });
    } });
    const input = { memories: [{ index: 0, receipts: [
      { index: 0, role: 'user', excerpt: 'I chose A.' }] }] };
    const oldRequest = { system: 'Fixed old wire.', input, maxOutputTokens: 1024,
      signal: new AbortController().signal };
    await model[method](oldRequest);
    assert.deepEqual(calls.map(body => createHash('sha256').update(body).digest('hex')),
      oldHashes[method]); // Frozen from the unmodified 7e212ec1 adapter.
    await assert.rejects(model[method]({ ...oldRequest, maxOutputTokens: 1025 }),
      /invalid_openai_request/);
    assert.equal(calls.length, 2);
  }
});

test('SCA3/4 count, provider usage and output ceilings fail without retries', async () => {
  for (const count of [6000, 6001]) {
    const h = harness({ count });
    const result = h.model.reviewSourceContext(request());
    if (count === 6000) assert.deepEqual(await result, proposal());
    else await assert.rejects(result, { code: 'context_budget_exceeded' });
    assert.equal(h.calls.length, count === 6000 ? 2 : 1);
  }
  for (const usage of [
    { input_tokens: 6001, output_tokens: 1, total_tokens: 6002 },
    { input_tokens: 100, output_tokens: 3073, total_tokens: 3173 },
    { input_tokens: 100, output_tokens: 100, total_tokens: 201 },
  ]) {
    const h = harness({ usage });
    await assert.rejects(h.model.reviewSourceContext(request()), { code: 'invalid_model_output' });
    assert.equal(h.calls.length, 2);
  }
  const inclusive = harness({ usage: { input_tokens: 6000, output_tokens: 3072,
    total_tokens: 9072 } });
  assert.deepEqual(await inclusive.model.reviewSourceContext(request()), proposal());
});

test('SCA4 structural compiler rejects malformed or wrong-receipt output, including nullable union', async () => {
  const valid = harness(); assert.deepEqual(await valid.model.reviewSourceContext(request()), proposal());
  for (const mutate of [
    value => { value.units[0].subject.evidence = [1]; },
    value => { value.units[0].state.value = 'adopted'; value.units[0].state.evidence = []; },
    value => { value.units[0].kind = 'permission'; },
    value => { value.units[0].extra = true; },
    value => { value.units.push(value.units[0]); },
  ]) {
    const output = proposal(); mutate(output);
    const h = harness({ output });
    await assert.rejects(h.model.reviewSourceContext(request()), { code: 'invalid_model_output' });
  }
});

test('SCA3/4 cancellation and malformed count/envelope fail closed', async () => {
  let calls = 0;
  const h = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'wrong', input_tokens: 100 });
    return response(body);
  } });
  await assert.rejects(h.reviewSourceContext(request()), { code: 'token_count_unavailable' });
  assert.equal(calls, 1);
  const aborted = request(); const controller = new AbortController(); controller.abort();
  aborted.signal = controller.signal;
  await assert.rejects(h.reviewSourceContext(aborted), { name: 'AbortError' });
  assert.equal(calls, 1);
  for (const mutation of [
    body => { body.status = 'incomplete'; },
    body => { body.model = 'wrong-model'; },
    body => { body.output[0].content[0] = { type: 'refusal', refusal: 'synthetic' }; },
    body => { body.output[0].status = 'incomplete'; },
    body => { body.output[0].content[0].text = '{'; },
    body => { body.output[0].content[0].text = 'x'.repeat(40001); },
  ]) {
    let sends = 0;
    const invalid = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
      sends++;
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      const body = JSON.parse(options.body);
      const result = await response(body).json(); mutation(result);
      return Response.json(result);
    } });
    await assert.rejects(invalid.reviewSourceContext(request()), { code: 'invalid_model_output' });
    assert.equal(sends, 2);
  }
  let oversizedSends = 0;
  const oversized = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async url => {
    oversizedSends++;
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    return Response.json({ padding: 'x'.repeat(262144) });
  } });
  await assert.rejects(oversized.reviewSourceContext(request()), /openai_request_failed/);
  assert.equal(oversizedSends, 2);
});

test('SCA4 local output accepts 3072 and rejects 3073 tokens before CU parsing', async () => {
  const longProposal = suffix => {
    const variants = ['a1b2c3d4e5f6g7h8', 'x9y8z7w6v5u4t3s2', 'm1n2o3p4q5r6s7t8',
      'u9v8w7x6y5z4a3b2', 'c1d2e3f4g5h6i7j8'];
    return { units: Array.from({ length: 5 }, (_, index) => {
      const unit = { ...proposal().units[0], kind: 'factual_claim' };
      delete unit.state;
      for (const [position, name] of ['subject', 'property', 'scope', 'applies', 'value'].entries()) {
        unit[name] = field(variants[position].repeat(10).slice(index, 99 + index), [0]);
      }
      if (index === 4) unit.subject.value += 'a1b2c3d4e5f6g7h8'.slice(0, suffix);
      return unit;
    }) };
  };
  const exact = longProposal(13), over = longProposal(14);
  assert.equal(countOpenAITokens(JSON.stringify(exact)), 3072);
  assert.equal(countOpenAITokens(JSON.stringify(over)), 3073);
  assert.equal(compileSourceContextUnits(raw(), exact).units.length, 5);
  assert.equal(compileSourceContextUnits(raw(), over).units.length, 5);
  for (const [output, accepted] of [[exact, true], [over, false]]) {
    let sends = 0;
    const model = createOpenAIModel({ apiKey: 'synthetic',
      fetchImpl: async (url, options) => {
        sends++;
        if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
        const body = JSON.parse(options.body);
        return Response.json({ ...await response(body).json(),
          output: [{ type: 'message', role: 'assistant', status: 'completed',
            content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
          usage: { input_tokens: 100, output_tokens: 3072, total_tokens: 3172 } });
      } });
    if (accepted) assert.deepEqual(await model.reviewSourceContext(request()), exact);
    else await assert.rejects(model.reviewSourceContext(request()), { code: 'invalid_model_output' });
    assert.equal(sends, 2);
  }
});

test('SCA5 actual core binds adapter output and rejects correction during provider count', async t => {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-context-adapter-')), 'store.sqlite');
  const namespace = { ownerId: 'synthetic-owner', scope: 'personal', projectId: null };
  const admitWith = core => {
    const admitted = core.admit({ namespace, memory: { content: 'Generated interpretation', kind: 'context' },
      receipts: [{ client: 'synthetic-client', sessionId: 'synthetic-session', eventId: 'synthetic-event',
        role: 'user', excerpt }] });
    assert.equal(admitted.ok, true, JSON.stringify(admitted));
    return { memoryId: admitted.value.memory.id, revision: admitted.value.memory.revision };
  };
  const h = harness(); const core = openMemoryCore({ path, model: h.model }); t.after(() => core.close());
  const ref = admitWith(core);
  const review = await core.reviewSourceContext({ namespace, refs: [ref] });
  assert.equal(review.ok, true, JSON.stringify(review));
  assert.equal(review.value.units[0].memoryId, ref.memoryId);
  assert.equal(review.value.units[0].receiptId, review.value.sources[0].receipts[0].id);
  assert.equal(review.value.units[0].state.value, 'considered');
  assert.equal(review.value.persistence, 'not-stored');
  assert.equal(JSON.stringify(h.calls[0].body).includes('Generated interpretation'), false);
  core.close();
  let changed = false;
  const stale = harness({ onCount: () => { if (changed) return; changed = true;
    const corrected = cold.correct({ namespace, memoryId: ref.memoryId,
      expectedRevision: ref.revision, content: 'Corrected', kind: 'context',
      receipt: { client: 'synthetic-client', sessionId: 'synthetic-session',
        eventId: 'correction', role: 'user', excerpt: 'Corrected source' } });
    assert.equal(corrected.ok, true, JSON.stringify(corrected));
  } });
  const cold = openMemoryCore({ path, model: stale.model }); t.after(() => cold.close());
  assert.equal(cold.getRationale({ namespace, ...ref }).value.edges.length, 0);
  const result = await cold.reviewSourceContext({ namespace, refs: [ref] });
  assert.equal(result.ok, false, JSON.stringify(result));
  assert.equal(result.error.code, 'revision_conflict');
  assert.equal(stale.calls.length, 2);
});

test('SCA5 old paid guard allowlists reject both new HTTP requests without reserving', async () => {
  const h = harness(); await h.model.reviewSourceContext(request());
  const ledger = { directory: join(mkdtempSync(join(tmpdir(), 'cairn-context-denial-')), 'ledger'),
    runId: randomUUID(), limitMicroUsd: 50000000, requestCap: 5000 };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy();
  const auth = { ledger, policy, authorizationId: 'synthetic' };
  guards.createExperimentRequestGuard({ ledger, policy,
    fetchImpl: () => assert.fail('HTTP') }).close();
  const basisModelsExtension = guards.authorizeBasisModelsExtension(auth);
  const factories = [
    guards.createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('HTTP') }),
    guards.createBasisModelsExperimentRequestGuard({ ledger, policy, basisModelsExtension,
      fetchImpl: () => assert.fail('HTTP') }),
  ];
  try {
    for (const guard of factories) for (const call of h.calls) {
      await assert.rejects(guard.cairnFetch(call.url, call.options), { code: 'unsupported_request' });
      assert.equal(guard.getState().requestCount, 0);
      assert.equal(guard.getState().reservedMicroUsd, 0);
    }
  } finally { factories.forEach(guard => guard.close()); }
});
