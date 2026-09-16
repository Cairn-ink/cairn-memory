import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createExperimentBudget } from '../index.mjs';
import { createExperimentRequestGuard, authorizeRationaleExtension, createRationaleExperimentRequestGuard,
  authorizeRationaleModelsExtension, createRationaleModelsExperimentRequestGuard } from '../request-guard.mjs';
import { experimentPolicy } from '../../live/session.mjs';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';

const models = ['gpt-4.1-mini-2025-04-14', 'gpt-5.6-luna', 'gpt-5.6-sol'];
const request = () => ({ system: 'Synthetic only.', input: {
  memories: [{ index: 0, receipts: [{ index: 0, role: 'user', excerpt: 'I have not decided.' }] }],
}, maxOutputTokens: 1024, signal: new AbortController().signal });
function setup(fetchImpl, limitMicroUsd = 50000000) {
  const directory = join(mkdtempSync(join(tmpdir(), 'cairn-rationale-model-guard-')), 'ledger');
  const ledger = { directory, runId: randomUUID(), limitMicroUsd, requestCap: 5000 };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl }).close();
  const options = { ledger, policy, authorizationId: 'synthetic-model-control' };
  authorizeRationaleExtension({ ...options, authorizationId: 'old-rationale' });
  const oldPath = join(directory, 'experiment-rationale-extension.json');
  const old = readFileSync(oldPath);
  const rationaleModelsExtension = authorizeRationaleModelsExtension(options);
  assert.deepEqual(readFileSync(oldPath), old);
  const guard = createRationaleModelsExperimentRequestGuard({ ledger, policy, rationaleModelsExtension, fetchImpl });
  return { guard, options, rationaleModelsExtension, oldPath, old };
}
const success = async (url, options) => {
  const body = JSON.parse(options.body);
  return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 100 } : {
    object: 'response', model: body.model, status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: '{"edges":[]}' }] }],
    usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
  });
};
test('RMG1 all three relation models settle exact conservative prices without modifying old grants', async () => {
  let calls = 0;
  const state = setup(async (...args) => { calls++; return success(...args); });
  try {
    for (const rationaleModel of models) {
      await createOpenAIModel({ apiKey: 'synthetic', rationaleModel, fetchImpl: state.guard.cairnFetch }).relate(request());
    }
    const ledger = state.guard.getState();
    assert.equal(calls, 6); assert.equal(ledger.requestCount, 6);
    assert.equal(ledger.reservedMicroUsd, 128000);
    assert.equal(ledger.attempts.reduce((sum, item) => sum + (item.actualMicroUsd ?? 0), 0), 56 + 37 + 700);
    assert.equal(ledger.attempts.filter(item => item.actualMicroUsd === null).length, 3);
    assert.ok(ledger.attempts.every(attempt => attempt.outcome !== null));
    assert.deepEqual(readFileSync(state.oldPath), state.old);
    assert.deepEqual(authorizeRationaleModelsExtension(state.options), state.rationaleModelsExtension);
    assert.throws(() => authorizeRationaleModelsExtension({ ...state.options, authorizationId: 'different' }), /policy_mismatch/);
  } finally { state.guard.close(); }
});
test('RMG2 closed method/model/reasoning/schema/route validation denies before reservations', async () => {
  const state = setup(() => assert.fail('No upstream calls'));
  let captured;
  const capture = createOpenAIModel({ apiKey: 'synthetic', rationaleModel: models[1], fetchImpl: async (url, options) => {
    captured = { url, options }; throw new Error('capture-only');
  } });
  await assert.rejects(capture.relate(request()));
  try {
    for (const mutate of [
      b => { b.model = 'gpt-5.6'; }, b => { b.reasoning.effort = 'high'; },
      b => { delete b.reasoning; }, b => { b.text.format.name = 'cairn_extract'; },
      b => { b.text.format.name = 'cairn_reviewRationaleDispositions'; },
      b => { b.text.format.schema = {}; }, b => { b.store = true; },
    ]) {
      const body = JSON.parse(captured.options.body); mutate(body);
      await assert.rejects(state.guard.cairnFetch(captured.url, { ...captured.options, body: JSON.stringify(body) }));
    }
    await assert.rejects(state.guard.hostFetch('https://api.openai.com/v1/chat/completions', captured.options));
    for (const rationaleModel of models) {
      await assert.rejects(createOpenAIModel({ apiKey: 'synthetic', rationaleModel,
        fetchImpl: state.guard.cairnFetch }).extract({ ...request(), input: { messages: [] } }));
    }
    assert.equal(state.guard.getState().requestCount, 0);
  } finally { state.guard.close(); }
});
test('RMG3 exhausted budget and tampered grant fail closed, transport failure reserves once without retry', async () => {
  let calls = 0;
  const limited = setup(() => { calls++; throw new Error('unexpected'); }, 55000);
  try {
    await assert.rejects(createOpenAIModel({ apiKey: 'synthetic', rationaleModel: models[2],
      fetchImpl: limited.guard.cairnFetch }).relate(request()));
    assert.equal(calls, 0); assert.equal(limited.guard.getState().requestCount, 0);
  } finally { limited.guard.close(); }
  const failed = setup(() => { calls++; throw new Error('synthetic transport'); });
  try {
    await assert.rejects(createOpenAIModel({ apiKey: 'synthetic', rationaleModel: models[2],
      fetchImpl: failed.guard.cairnFetch }).relate(request()));
    assert.equal(calls, 1); assert.equal(failed.guard.getState().reservedMicroUsd, 56000);
    assert.equal(failed.guard.getState().attempts[0].actualMicroUsd, null);
    assert.equal(failed.guard.getState().attempts[0].outcome, 'unknown');
    writeFileSync(join(failed.options.ledger.directory, 'experiment-rationale-models-extension.json'), '{}');
    await assert.rejects(createOpenAIModel({ apiKey: 'synthetic', rationaleModel: models[0],
      fetchImpl: failed.guard.cairnFetch }).relate(request()));
    assert.equal(calls, 1); assert.equal(failed.guard.getState().requestCount, 1);
  } finally { failed.guard.close(); }
});
test('RMG4 new capability presence never upgrades the older rationale pipeline guard', async () => {
  const state = setup(() => assert.fail('No upstream calls'));
  const rationaleExtension = JSON.parse(state.old.toString());
  const oldGuard = createRationaleExperimentRequestGuard({ ledger: state.options.ledger,
    policy: state.options.policy, rationaleExtension, fetchImpl: () => assert.fail('No upstream calls') });
  try {
    for (const rationaleModel of models.slice(1)) {
      await assert.rejects(createOpenAIModel({ apiKey: 'synthetic', rationaleModel,
        fetchImpl: oldGuard.cairnFetch }).relate(request()));
    }
    assert.equal(oldGuard.getState().requestCount, 0);
    assert.throws(() => createRationaleModelsExperimentRequestGuard({ ledger: state.options.ledger,
      policy: state.options.policy, rationaleModelsExtension: rationaleExtension,
      fetchImpl: () => assert.fail('No upstream calls') }), /invalid_extension/);
  } finally { oldGuard.close(); state.guard.close(); }
});
