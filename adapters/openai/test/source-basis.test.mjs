import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createOpenAIModel } from '../index.mjs';
import { modelProfile, DEFAULT_MODEL } from '../profiles.mjs';
import { createExperimentBudget } from '../../../evaluation/experiment-budget/index.mjs';
import * as guards from '../../../evaluation/experiment-budget/request-guard.mjs';
import { experimentPolicy } from '../../../evaluation/live/session.mjs';
import { sourceParts } from '../../../core/source-addresses.mjs';

const models = [DEFAULT_MODEL, 'gpt-5.6-luna', 'gpt-5.6-sol'];
const input = { memories: [{ index: 0, receipts: [{ index: 0, role: 'user', excerpt: 'I have not decided.' }] }] };
const request = () => ({ system: 'Synthetic source review.', input, maxOutputTokens: 1024, signal: new AbortController().signal });
const fake = calls => async (url, options) => {
  const body = JSON.parse(options.body); calls.push({ url, options, body });
  return Response.json(url.endsWith('/input_tokens') ? { object: 'response.input_tokens', input_tokens: 100 } : {
    object: 'response', model: body.model, status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: '{"units":[],"links":[]}' }] }],
    usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 },
  });
};
test('SBA3 context mode has strict nullable citation fields, unchanged routing/budget and pre-transport mode denial', async () => {
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: fake(calls) });
  const contextRequest = { ...request(), input: { ...input, inputMode: 'source-context-v1' } };
  await model.reviewBasis(contextRequest);
  assert.equal(calls.length, 2);
  const properties = calls[1].body.text.format.schema.properties.units.items.anyOf[0].properties;
  assert.equal(properties.context.additionalProperties, false);
  assert.deepEqual(properties.context.required, ['subject', 'applies', 'scope', 'commitment']);
  for (const field of properties.context.required) {
    assert.deepEqual(properties.context.properties[field].anyOf,
      [{ type: 'string', minLength: 1, maxLength: 200 }, { type: 'null' }]);
  }
  const { max_output_tokens, store, stream, ...counted } = calls[1].body;
  assert.deepEqual(calls[0].body, counted); assert.equal(max_output_tokens, 1024);
  assert.equal(calls[1].body.model, DEFAULT_MODEL);
  // The adapter validates its JSON snapshot (undefined is omitted by JSON);
  // the embedded core separately rejects an explicitly undefined mode.
  for (const inputMode of [null, 'other', 7]) {
    await assert.rejects(model.reviewBasis({ ...request(), input: { ...input, inputMode } }));
  }
  assert.equal(calls.length, 2);
  await model.reviewBasis(request());
  assert.equal(Object.hasOwn(calls[3].body.text.format.schema.properties.units.items.anyOf[0].properties, 'context'), false);
});
test('SBA4 addressed schema correlates part bounds with receipts and explicitly permits dual role only in that mode', async () => {
  const calls = [];
  const model = createOpenAIModel({ apiKey: 'synthetic', fetchImpl: fake(calls) });
  const addressedInput = { inputMode: 'source-addressed-v1', memories: [{ index: 0, receipts: [
    { index: 0, role: 'user', excerpt: 'I chose A.', parts: sourceParts('I chose A.') },
    { index: 1, role: 'user', excerpt: '🙂我', parts: sourceParts('🙂我') },
  ] }] };
  await model.reviewBasis({ ...request(), input: addressedInput });
  const variants = calls[1].body.text.format.schema.properties.units.items.anyOf;
  assert.equal(variants.length, 2);
  assert.deepEqual(variants[1].properties.receipt.enum, [1]);
  assert.equal(variants[1].properties.endPart.maximum, 2);
  assert.equal(variants[0].properties.endPart.maximum, 6);
  assert.equal(variants[1].properties.startPart.maximum, 1);
  assert.equal(variants[0].additionalProperties, false);
  assert.equal(Object.hasOwn(variants[0].properties, 'quote'), false);
  assert.ok(variants[0].properties.role.enum.includes('premise-update'));
  assert.equal(variants[1].properties.context.properties.subject.anyOf[0].properties.endPart.maximum, 2);
  for (const mutate of [
    x => { x.memories[0].receipts[1].parts[1].index = 2; },
    x => { x.memories[0].receipts[1].parts = []; },
    x => { x.memories[0].receipts[1].parts[0].text = ''; },
  ]) {
    const bad = structuredClone(addressedInput); mutate(bad);
    await assert.rejects(model.reviewBasis({ ...request(), input: bad }));
  }
  assert.equal(calls.length, 2);
  await model.reviewBasis({ ...request(), input: { ...input, inputMode: 'source-context-v1' } });
  assert.equal(calls[3].body.text.format.schema.properties.units.items.anyOf[0].properties.role.enum.includes('premise-update'), false);
});
test('SBA1 basis model selection is independent and exact count/generate schema remains bounded', async () => {
  for (const basisModel of models) for (const rationaleModel of models) {
    const calls = [];
    const model = createOpenAIModel({ apiKey: 'synthetic', basisModel, rationaleModel, fetchImpl: fake(calls) });
    assert.deepEqual(await model.reviewBasis(request()), { units: [], links: [] });
    assert.equal(calls.length, 2); assert.equal(calls[0].body.model, basisModel);
    const { max_output_tokens, store, stream, ...counted } = calls[1].body;
    assert.deepEqual(counted, calls[0].body); assert.equal(max_output_tokens, 1024); assert.equal(store, false); assert.equal(stream, false);
    assert.equal(counted.text.format.name, 'cairn_reviewBasis');
    assert.deepEqual(counted.reasoning, basisModel === DEFAULT_MODEL ? undefined : { effort: 'none' });
    assert.equal(counted.text.format.schema.properties.units.maxItems, 8);
    assert.equal(counted.text.format.schema.properties.links.maxItems, 10);
    const profile = modelProfile(DEFAULT_MODEL, rationaleModel, basisModel);
    assert.equal(profile.relate.model, rationaleModel); assert.equal(profile.extract.model, DEFAULT_MODEL);
    for (const method of ['qualify', 'qualifyCandidates', 'classify', 'select', 'rank', 'reconcile']) assert.equal(profile[method].model, DEFAULT_MODEL);
  }
  for (const basisModel of [null, 'gpt-5.6', 'invented', 1]) assert.throws(() => createOpenAIModel({ apiKey: 'synthetic', basisModel }));
  assert.equal(modelProfile(DEFAULT_MODEL, 'gpt-5.6-sol').reviewBasis.model, DEFAULT_MODEL);
});
test('SBA2 every existing paid guard denies the new method for all three models on both routes', async () => {
  const ledger = { directory: join(mkdtempSync(join(tmpdir(), 'cairn-basis-denial-')), 'ledger'),
    runId: randomUUID(), limitMicroUsd: 50000000, requestCap: 5000 };
  createExperimentBudget(ledger).close(); const policy = experimentPolicy();
  const base = { ledger, policy, fetchImpl: () => assert.fail('No HTTP') };
  guards.createExperimentRequestGuard(base).close();
  const auth = { ledger, policy, authorizationId: 'synthetic' };
  const extension = guards.authorizeExtractionModelExtension(auth);
  const reconciliationExtension = guards.authorizeReconciliationExtension({ ...auth, extension });
  const qualificationExtension = guards.authorizeQualificationExtension(auth);
  const candidateQualificationExtension = guards.authorizeCandidateQualificationExtension(auth);
  const rationaleExtension = guards.authorizeRationaleExtension(auth);
  const rationaleModelsExtension = guards.authorizeRationaleModelsExtension(auth);
  // Merely adding a new grant must not upgrade any already existing factory.
  guards.authorizeBasisModelsExtension(auth);
  const handles = [guards.createExperimentRequestGuard(base), guards.createExtendedExperimentRequestGuard({ ...base, extension }),
    guards.createReconciliationExperimentRequestGuard({ ...base, extension, reconciliationExtension }),
    guards.createQualificationExperimentRequestGuard({ ...base, qualificationExtension }),
    guards.createCandidateQualificationExperimentRequestGuard({ ...base, candidateQualificationExtension }),
    guards.createRationaleExperimentRequestGuard({ ...base, rationaleExtension }),
    guards.createRationaleModelsExperimentRequestGuard({ ...base, rationaleModelsExtension })];
  try {
    for (const basisModel of models) {
      const calls = []; await createOpenAIModel({ apiKey: 'synthetic', basisModel, fetchImpl: fake(calls) }).reviewBasis(request());
      for (const guard of handles) for (const { url, options } of calls) {
        await assert.rejects(guard.cairnFetch(url, options), { code: 'unsupported_request' });
        assert.equal(guard.getState().requestCount, 0);
      }
    }
  } finally { handles.forEach(guard => guard.close()); }
});
