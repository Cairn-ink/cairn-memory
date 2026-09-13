import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { randomUUID } from 'node:crypto';
import { createExperimentBudget } from '../index.mjs';
import { createExperimentRequestGuard, authorizeRationaleModelsExtension,
  authorizeBasisModelsExtension, createBasisModelsExperimentRequestGuard } from '../request-guard.mjs';
import { createBasisModelLiveSession, createRationaleModelLiveSession } from '../../live/qualification-session.mjs';
import { experimentPolicy } from '../../live/session.mjs';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';

const models = ['gpt-4.1-mini-2025-04-14', 'gpt-5.6-luna', 'gpt-5.6-sol'];
const request = () => ({ system: 'Synthetic.', input: { memories: [{ index: 0,
  receipts: [{ index: 0, role: 'user', excerpt: 'I have not decided.' }] }] },
maxOutputTokens: 1024, signal: new AbortController().signal });
function setup(t, fetchImpl, limitMicroUsd = 50000000) {
  const ledger = { directory: join(mkdtempSync(join(tmpdir(), 'cairn-basis-guard-')), 'ledger'),
    runId: randomUUID(), limitMicroUsd, requestCap: 5000 };
  createExperimentBudget(ledger).close(); const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl }).close();
  const auth = { ledger, policy, authorizationId: 'synthetic' };
  const rationaleModelsExtension = authorizeRationaleModelsExtension(auth);
  const oldPath = join(ledger.directory, 'experiment-rationale-models-extension.json');
  const oldBytes = readFileSync(oldPath);
  const basisModelsExtension = authorizeBasisModelsExtension(auth);
  assert.deepEqual(readFileSync(oldPath), oldBytes);
  const guard = createBasisModelsExperimentRequestGuard({ ledger, policy, basisModelsExtension, fetchImpl });
  t.after(() => guard.close());
  return { ledger, policy, auth, guard, basisModelsExtension, rationaleModelsExtension, oldPath, oldBytes };
}
const fake = async (url, options) => {
  const body = JSON.parse(options.body);
  return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 100 } : {
    object: 'response', model: body.model, status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: '{"units":[],"links":[]}' }] }],
    usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
  });
};
test('BMG1 explicit basis session routes exact three-model framing and conservative accounting', async t => {
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++; assert.equal(options.headers.get('authorization'), 'Bearer synthetic-parent');
    return fake(url, options);
  };
  const f = setup(t, fetchImpl);
  const config = { ledger: f.ledger, basisModelsExtension: f.basisModelsExtension, apiKey: 'synthetic-parent', fetchImpl };
  for (const patch of [{ basisModelsExtension: undefined }, { apiKey: '' }, { fetchImpl: undefined }, { extra: true }]) {
    assert.throws(() => createBasisModelLiveSession({ ...config, ...patch }));
  }
  const session = createBasisModelLiveSession(config); t.after(() => session.close());
  for (const basisModel of models) {
    const adapter = createOpenAIModel({ apiKey: 'synthetic-consumer', basisModel,
      fetchImpl: (url, options) => session.request(url.endsWith('/input_tokens') ? '/responses/input_tokens'
        : '/responses', options.body, { signal: options.signal }) });
    assert.deepEqual(await adapter.reviewBasis(request()), { units: [], links: [] });
  }
  const state = session.getState(); assert.equal(calls, 6); assert.equal(state.requestCount, 6);
  assert.equal(state.reservedMicroUsd, 128000);
  assert.equal(state.attempts.reduce((sum, a) => sum + (a.actualMicroUsd ?? 0), 0), 56 + 37 + 700);
  assert.equal(state.attempts.filter(a => a.actualMicroUsd === null).length, 3);
  assert.ok(state.attempts.every(a => a.outcome !== null));
  assert.deepEqual(readFileSync(f.oldPath), f.oldBytes);
  assert.deepEqual(authorizeBasisModelsExtension(f.auth), f.basisModelsExtension);
  assert.throws(() => authorizeBasisModelsExtension({ ...f.auth, authorizationId: 'different' }));
});
test('BMG2 closed schema/method/model/route and cross-grant denial precede any reservation', async t => {
  const f = setup(t, () => assert.fail('No HTTP'));
  const calls = [];
  await createOpenAIModel({ apiKey: 'synthetic', basisModel: models[1], fetchImpl: async (url, options) => {
    calls.push({ url, options }); return fake(url, options);
  } }).reviewBasis(request());
  const old = createRationaleModelLiveSession({ ledger: f.ledger, rationaleModelsExtension: f.rationaleModelsExtension,
    apiKey: 'synthetic', fetchImpl: () => assert.fail('No HTTP') }); t.after(() => old.close());
  const session = createBasisModelLiveSession({ ledger: f.ledger, basisModelsExtension: f.basisModelsExtension,
    apiKey: 'synthetic', fetchImpl: () => assert.fail('No HTTP') }); t.after(() => session.close());
  for (const { url, options } of calls) {
    for (const mutate of [b => { b.model = 'gpt-5.6'; }, b => { b.text.format.name = 'cairn_relate'; },
      b => { b.reasoning.effort = 'high'; }, b => { delete b.reasoning; },
      b => { b.text.format.schema = {}; }, b => { b.truncation = 'auto'; }]) {
      const body = JSON.parse(options.body); mutate(body);
      await assert.rejects(f.guard.cairnFetch(url, { ...options, body: JSON.stringify(body) }));
    }
    await assert.rejects(old.request(url.endsWith('/input_tokens') ? '/responses/input_tokens' : '/responses', options.body));
    await assert.rejects(f.guard.hostFetch('https://api.openai.com/v1/chat/completions', options));
    await assert.rejects(session.request('/chat/completions', options.body));
  }
  for (const basisModel of models) {
    await assert.rejects(createOpenAIModel({ apiKey: 'synthetic', basisModel, rationaleModel: basisModel,
      fetchImpl: f.guard.cairnFetch }).relate(request()));
  }
  assert.throws(() => createBasisModelsExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    basisModelsExtension: f.rationaleModelsExtension, fetchImpl: () => assert.fail('No HTTP') }));
  assert.equal(f.guard.getState().requestCount, 0);
});
test('BMG3 no budget overrun, failed transport settles once, callback-time grant corruption denies', async t => {
  let calls = 0;
  const fetchImpl = () => { calls++; throw new Error('synthetic transport'); };
  const limited = setup(t, fetchImpl, 55000);
  await assert.rejects(createOpenAIModel({ apiKey: 'synthetic', basisModel: models[2],
    fetchImpl: limited.guard.cairnFetch }).reviewBasis(request()));
  assert.equal(calls, 0); assert.equal(limited.guard.getState().requestCount, 0);
  const f = setup(t, fetchImpl);
  await assert.rejects(createOpenAIModel({ apiKey: 'synthetic', basisModel: models[2],
    fetchImpl: f.guard.cairnFetch }).reviewBasis(request()));
  assert.equal(calls, 1); assert.equal(f.guard.getState().reservedMicroUsd, 56000);
  assert.equal(f.guard.getState().attempts[0].outcome, 'unknown');
  assert.equal(f.guard.getState().attempts[0].actualMicroUsd, null);
  let captured;
  await assert.rejects(createOpenAIModel({ apiKey: 'synthetic', fetchImpl: async (url, options) => {
    captured = { url, options }; throw new Error('capture');
  } }).reviewBasis(request()));
  await assert.rejects(f.guard.cairnFetch(captured.url, { ...captured.options, get headers() {
    writeFileSync(join(f.ledger.directory, 'experiment-basis-models-extension.json'), '{}');
    return captured.options.headers;
  } }));
  assert.equal(calls, 1); assert.equal(f.guard.getState().requestCount, 1);
});
