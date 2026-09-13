import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOpenAIModel } from '../index.mjs';
import { DEFAULT_MODEL, LUNA_EXTRACTION_MODEL, EXPERIMENTAL_EXTRACTION_MODEL, modelProfile } from '../profiles.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../../../evaluation/experiment-budget/index.mjs';
import { createExperimentRequestGuard, authorizeRationaleExtension } from '../../../evaluation/experiment-budget/request-guard.mjs';
import { createRationaleLiveSession } from '../../../evaluation/live/qualification-session.mjs';
import { experimentPolicy } from '../../../evaluation/live/session.mjs';

const models = [DEFAULT_MODEL, LUNA_EXTRACTION_MODEL, 'gpt-5.6-sol'];
const request = (method = 'relate') => ({ system: 'Synthetic.', input: method === 'relate'
  ? { memories: [{ index: 0, receipts: [{ index: 0, role: 'user', excerpt: 'I have not chosen.' }] }] }
  : method === 'extract' ? { messages: [] } : { maps: [], query: 'Synthetic', maxRefs: 24 },
  maxOutputTokens: 1024, signal: new AbortController().signal });
function transport(calls, wrongModel = false) {
  return async (url, options) => {
    const body = JSON.parse(options.body); calls.push(body);
    const output = body.text.format.name === 'cairn_relate' ? { edges: [] }
      : body.text.format.name === 'cairn_extract' ? { items: [] } : { refs: [] };
    return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 100 } : {
      object: 'response', model: wrongModel ? 'wrong-model' : body.model, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
    });
  };
}
test('RM1 relation model selection is independent from extraction and preserves exact framing', async () => {
  for (const rationaleModel of models) for (const extractionModel of [DEFAULT_MODEL, LUNA_EXTRACTION_MODEL, EXPERIMENTAL_EXTRACTION_MODEL]) {
    const calls = []; const model = createOpenAIModel({ apiKey: 'synthetic', rationaleModel, extractionModel, fetchImpl: transport(calls) });
    await model.relate(request()); await model.extract(request('extract')); await model.select(request('select'));
    assert.equal(calls[0].model, rationaleModel); assert.equal(calls[2].model, extractionModel); assert.equal(calls[4].model, DEFAULT_MODEL);
    assert.deepEqual(calls[0].reasoning, rationaleModel === DEFAULT_MODEL ? undefined : { effort: 'none' });
    const { max_output_tokens, store, stream, ...counted } = calls[1];
    assert.deepEqual(counted, calls[0]); assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
    assert.equal(calls[0].text.format.name, 'cairn_relate'); assert.equal(calls[0].truncation, 'disabled');
    for (const method of ['qualify', 'qualifyCandidates', 'classify', 'select', 'rank', 'reconcile']) {
      assert.equal(modelProfile(extractionModel, rationaleModel)[method].model, DEFAULT_MODEL);
    }
  }
  const absent = [], explicit = [];
  await createOpenAIModel({ apiKey: 'synthetic', fetchImpl: transport(absent) }).relate(request());
  await createOpenAIModel({ apiKey: 'synthetic', rationaleModel: DEFAULT_MODEL, fetchImpl: transport(explicit) }).relate(request());
  assert.deepEqual(absent, explicit);
});
test('RM2 closed names, immutable conservative profiles and exact response model prevent fallback', async () => {
  for (const rationaleModel of [null, 'gpt-5.6', 'gpt-5.6-luna-2026-09-11', 'other', 1, {}]) {
    assert.throws(() => createOpenAIModel({ apiKey: 'synthetic', rationaleModel }), /invalid_openai_configuration/);
  }
  assert.throws(() => createOpenAIModel({ apiKey: 'synthetic', extractionModel: 'gpt-5.6-sol' }), /invalid_openai_configuration/);
  for (const rationaleModel of models) {
    const entry = modelProfile(DEFAULT_MODEL, rationaleModel).relate;
    assert.ok(Object.isFrozen(entry));
    const calls = []; const model = createOpenAIModel({ apiKey: 'synthetic', rationaleModel, fetchImpl: transport(calls, true) });
    await assert.rejects(model.relate(request()), { code: 'invalid_model_output' }); assert.equal(calls.length, 2);
  }
  const sol = modelProfile(DEFAULT_MODEL, 'gpt-5.6-sol').relate;
  assert.equal(sol.reservationUnits, 55600); assert.equal(sol.inputRate, 5); assert.equal(sol.outputRate, 20);
  assert.equal(sol.reservationUnits, Math.ceil(7024 * sol.inputRate + 1024 * sol.outputRate));
  assert.strictEqual(modelProfile(LUNA_EXTRACTION_MODEL).extract, modelProfile(DEFAULT_MODEL, LUNA_EXTRACTION_MODEL).relate);
});
test('RM3 existing paid rationale guard rejects new model routing without upstream calls or reservations', async () => {
  for (const rationaleModel of models.slice(1)) {
    const root = mkdtempSync(join(tmpdir(), 'cairn-rationale-model-denial-'));
    const config = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50000000, requestCap: 5000 };
    createExperimentBudget(config).close();
    await createExperimentRequestGuard({ ledger: config, policy: experimentPolicy(), fetchImpl: () => assert.fail('No HTTP') }).close();
    const rationaleExtension = authorizeRationaleExtension({ ledger: config, policy: experimentPolicy(), authorizationId: 'synthetic' });
    const session = createRationaleLiveSession({ ledger: config, apiKey: 'synthetic', rationaleExtension, fetchImpl: () => assert.fail('No HTTP') });
    try {
      const model = createOpenAIModel({ apiKey: 'synthetic', rationaleModel, fetchImpl: (url, options) =>
        session.request(url.endsWith('/input_tokens') ? '/responses/input_tokens' : '/responses', options.body, { signal: options.signal }) });
      await assert.rejects(model.relate(request()));
      const ledger = reopenExperimentBudget(config);
      try { assert.equal(ledger.getState().requestCount, 0); } finally { ledger.close(); }
    } finally { await session.close(); }
  }
});
