import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { mkdirSync, existsSync, readFileSync } from 'node:fs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade,
  upgradeExperimentBudgetForEmbeddings, inspectEmbeddingExperimentBudgetSnapshot } from '../../experiment-budget/index.mjs';
import { createAlgorithmDevelopmentTransport, freezeObservation } from '../transport.mjs';
import { runAlgorithmDevelopmentComparison } from '../runner.mjs';

const key = 'synthetic-requested-answer-secret';
const texts = ['Billing contact handles PO-63.', 'Mural purchase order is PO-63.', 'Signed purchase note names PO-63.',
  ...Array.from({ length: 4 }, (_, index) => `Unrelated synthetic inventory item ${index}.`)];
const cases = () => freezeObservation(Array.from({ length: 24 }, (_, index) => ({ id: `D${String(index + 1).padStart(2, '0')}`,
  family: 'synthetic-source-diverse-control', question: { text: 'mural billing', date: '2026-10-10' },
  sessions: [texts.slice(0, 3), texts.slice(3, 6), texts.slice(6)].map((messages, session) => ({ id: `session-${session}`,
    eventTime: '2026-10-09T12:00:00Z', messages: messages.map(content => ({ role: 'user', content })) })) })));
function envelope(output) {
  return { object: 'response', model: 'gpt-4.1-mini-2025-04-14', status: 'completed', error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
    usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } };
}
// Scripted provider uses only the actual serialized request, never fixture IDs,
// evaluator anchors, expected answer strings or the source fixture closure.
function provider({ rankLoss = false, intercept = () => null } = {}) {
  return async (url, options) => {
    const interrupted = intercept(url, options); if (interrupted) return interrupted;
    assert.equal(options.headers.Authorization, `Bearer ${key}`);
    const body = JSON.parse(options.body); assert.equal(body.model, 'gpt-4.1-mini-2025-04-14');
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    if (url.endsWith('/chat/completions')) {
      const evidence = JSON.parse(body.messages[1].content).evidence;
      return Response.json({ object: 'chat.completion', model: body.model,
        choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: evidence.map(item => item.text).join('\n') } }],
        usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 } });
    }
    const input = JSON.parse(body.input[0].content[0].text), method = body.text.format.name;
    let output;
    if (method === 'cairn_extract') output = { items: input.messages.flatMap(message => {
      if (message.content.includes('Signed purchase')) return [];
      const base = { kind: 'context', confidence: 0.8, sourceIndices: [message.index] };
      if (message.content.includes('Billing contact')) return ['first', 'second', 'third'].map(view => ({ ...base, content: `Billing view ${view}.` }));
      if (message.content.includes('Mural purchase')) return [{ ...base, content: 'Complementary routing view.', sourceIndices: [message.index,
        ...input.messages.filter(other => other.content.includes('Signed purchase')).map(other => other.index)] }];
      return [{ ...base, content: message.content.slice(0, 600) }];
    }) };
    else if (method === 'cairn_classify') output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
    else if (method === 'cairn_select') {
      const cue = JSON.parse(input.query).question.toLowerCase().split(/\s+/).at(-1);
      output = { refs: input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled' && item.label.toLowerCase().includes(cue))
        .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))).slice(0, input.maxRefs) };
    } else {
      const terms = JSON.parse(input.query).question.toLowerCase().split(/\s+/);
      output = { refs: input.candidates.filter(candidate => candidate.receipts.some(receipt =>
        terms.some(term => receipt.excerpt.toLowerCase().includes(term)))).slice(0, rankLoss ? 1 : input.limit)
        .map(candidate => ({ namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })) };
    }
    return Response.json(envelope(output));
  };
}
async function comparison({ rankLoss = false, redOnly = false, localSelectFailure = false,
  fetchImpl = provider({ rankLoss }), treatment = 'source-diverse-v1' } = {}) {
  const workspace = createTestWorkspace(null, { prefix: 'cairn-requested-answer-runner-' }); let transport;
  workspace.defer(() => transport?.close());
  try {
    const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(), limitMicroUsd: 400_000_000, requestCap: 100_000 };
    createExperimentBudget(configuration).close(); const prior = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
    upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, expectedHistorySha256: prior.historySha256 });
    const state = inspectEmbeddingExperimentBudgetSnapshot(configuration), durable = [], records = [];
    transport = createAlgorithmDevelopmentTransport({ configuration, checkpoint: { requestCount: 0, reservedMicroUsd: 0 },
      historySha256: state.historySha256, apiKey: key, fetchImpl, onRecord: row => { records.push(row); } });
    const outputDirectory = join(workspace.path, 'output'); mkdirSync(outputDirectory);
    let localCounts = 0;
    const observedTransport = !localSelectFailure ? transport : { ...transport,
      beginArm(name) { localCounts = 0; transport.beginArm(name); },
      model: { ...transport.model, countTokens(text) {
        let value; try { value = JSON.parse(text); } catch { return transport.model.countTokens(text); }
        // packSelect and callModel each count the unchanged request before
        // the wrapper's own pre-delegation count (the third envelope).
        if (value.input?.maps && ++localCounts === 3) return 6001;
        return transport.model.countTokens(text);
      } } };
    const result = await runAlgorithmDevelopmentComparison({ cases: cases(), transport: observedTransport, treatment,
      outputDirectory, onCase: row => { durable.push(row); } });
    assert.equal(durable.length, 24); assert.equal(result.observations.length, 24); assert.equal(result.denominator, 24);
    assert.equal(result.observations.flatMap(row => Object.values(row.arms)).length, 48);
    assert.equal(records.length, result.records.length * 2); assert(Object.isFrozen(durable[0]));
    assert.equal(JSON.stringify(result).includes(key), false);
    if (result.fatal || result.observations.some(row => row.capture.status !== 'completed'
      || Object.values(row.arms).some(arm => arm.status !== 'completed'))) return result;
    const first = result.observations[0];
    for (const row of result.observations) {
      assert.equal(row.capture.receipts.length, 8);
      assert.equal(row.capture.stateSha256, row.arms.baseline.stateBefore); assert.equal(row.capture.stateSha256, row.arms.full.stateAfter);
      assert.equal(row.navigation.firstCandidateIdentityEqual, true);
      const raw = name => row.arms[name].modelCalls.find(call => call.method === 'select');
      if (treatment === 'source-diverse-v1') {
        assert.equal(row.navigation.coreInputSequenceEqual, true); assert.deepEqual(raw('baseline'), raw('full'));
      }
      assert.equal(raw('full').output.refs.length, 3);
      for (const arm of Object.values(row.arms)) {
        assert.equal(arm.modelCalls.filter(call => call.method === 'select').length, 1);
        assert.equal(arm.modelCalls.filter(call => call.method === 'rank').length, 1);
        assert.equal(arm.packed.omittedIndices.length, 0);
        const answerRequests = arm.records.filter(record => record.method === 'answer');
        assert.equal(answerRequests.length, 1);
        assert.deepEqual(JSON.parse(answerRequests[0].requestBody), arm.packed.request,
          'Observed actual answer HTTP request is the verified packed request');
      }
      if (treatment === 'source-diverse-v1') {
        const actual = row.arms.full.effectiveSelections[0], baseline = row.arms.baseline.effectiveSelections[0];
        assert.equal(actual.policy, 'source-diverse-v1'); assert.equal(actual.output.refs.length, 5);
        assert.equal(actual.publicReads.length, 16); assert.equal(baseline.publicReads.length, 0);
        assert.equal(actual.diagnostics.inspectedCards, 8); assert.equal(actual.diagnostics.removedSeeds.length, 2);
        assert.equal(actual.diagnostics.additions.length, 4); assert(actual.diagnostics.sourceMaterialBytes > 0);
        assert.deepEqual(baseline.output, raw('baseline').output);
        assert.equal(row.arms.baseline.modelCalls.find(call => call.method === 'rank').input.candidates.length, 3);
        assert.equal(row.arms.full.modelCalls.find(call => call.method === 'rank').input.candidates.length, 5);
      } else {
        assert.equal(Object.hasOwn(row.arms.full, 'effectiveSelections'), false);
        assert.equal(Object.hasOwn(result, 'treatment'), false);
      }
    }
    if (treatment === 'source-diverse-v1') {
      assert.equal(result.schemaVersion, 'source-diverse-requested-answer-comparison-v1');
      assert.deepEqual(result.armPolicies, { baseline: 'ordinary-v1', full: 'source-diverse-v1' });
      const packed = name => JSON.parse(first.arms[name].packed.request.messages[1].content).evidence;
      const actual = redOnly ? packed('baseline') : packed('full');
      const retained = ['Billing contact', 'Mural purchase'].filter(fragment => actual.some(item => item.text.includes(fragment))).length;
      assert.equal(retained, rankLoss ? 1 : 2, 'Complementary source restoration must reach the actual answer HTTP input');
      if (!rankLoss && !redOnly) assert.notDeepEqual(first.arms.baseline.packed.request, first.arms.full.packed.request);
    }
    return result;
  } finally { await workspace.cleanup(); assert.equal(existsSync(workspace.path), false, 'Owned scratch removed on success or expected assertion failure'); }
}

test('Q3 closed treatment enum rejects before provider, filesystem or observation calls', async () => {
  let calls = 0;
  for (const treatment of ['other', null, {}, () => {}]) await assert.rejects(() => runAlgorithmDevelopmentComparison({
    treatment, transport: { model: { select: () => { calls++; } } }, onCase: () => { calls++; } }), { code: 'invalid_algorithm_treatment' });
  assert.equal(calls, 0);
});
test('Q9 real core/fake HTTP restores omitted source with unchanged raw selector and changed answer input', async context => {
  const result = await comparison({ redOnly: process.env.CAIRN_REQUESTED_ANSWER_BASELINE_ONLY === '1' });
  assert.equal(result.fatal, null);
  assert(result.observations.every(row => row.capture.status === 'completed' && Object.values(row.arms)
    .every(arm => arm.status === 'completed')), JSON.stringify(result.observations[0]));
  const arm = result.observations[0].arms.full;
  context.diagnostic(JSON.stringify({ denominator: 24, arms: 48, rawRefs: 3, effectiveRefs: arm.effectiveSelections[0].output.refs.length,
    reads: arm.effectiveSelections[0].publicReads.length, materialBytes: arm.effectiveSelections[0].diagnostics.sourceMaterialBytes,
    httpAttempts: result.records.length, finalReservedMicroUsd: result.finalBudget.reservedMicroUsd }));
});
test('Q9 unchanged later ranker can still lose the restored source', async () => {
  const result = await comparison({ rankLoss: true });
  const arms = result.observations[0].arms;
  assert.equal(arms.full.effectiveSelections[0].output.refs.length, 5);
  assert.deepEqual([arms.baseline.evidence.units.length, arms.full.evidence.units.length], [1, 1]);
});
test('Q9/Q10 baseline restoration is red with owned cleanup', async () => {
  await assert.rejects(() => comparison({ redOnly: true }), error => error.code === 'ERR_ASSERTION' && error.actual === 1 && error.expected === 2);
});
test('Q3 default full-label shape remains schema-compatible and has no effective-selection extension', async () => {
  const result = await comparison({ treatment: 'full-label-v1' });
  assert.equal(result.schemaVersion, 'algorithm-development-comparison-v1');
  assert(result.observations.every(row => row.capture.status === 'completed'
    && Object.values(row.arms).every(arm => arm.status === 'completed')), JSON.stringify(result.observations[0]));
  assert.equal(Object.hasOwn(result, 'armPolicies'), false);
});
test('Q7 opt-in normal and fatal failures retain all cases/arm slots without retries', async () => {
  let answers = 0;
  const ordinary = await comparison({ fetchImpl: provider({ intercept: url => url.endsWith('/chat/completions') && ++answers === 1
    ? Response.json({ error: 'temporary' }, { status: 503 }) : null }) });
  assert.equal(ordinary.fatal, null); assert.equal(ordinary.observations[0].arms.baseline.status, 'unresolved');
  assert.equal(ordinary.observations[0].arms.full.status, 'completed'); assert.equal(answers, 48);
  let dispatches = 0;
  const fatal = await comparison({ fetchImpl: () => { dispatches++; return Response.json({ error: 'denied' }, { status: 401 }); } });
  assert.equal(fatal.fatal, 'algorithm_auth_transport_failure'); assert.equal(dispatches, 1);
  assert(fatal.observations.every(row => Object.values(row.arms).every(arm => arm.status === 'unresolved' && Array.isArray(arm.effectiveSelections))));
});
test('Q4 real wrapper-local failure before raw delegation retains a failed effective trace, not a fabricated raw call', async () => {
  let extracts = 0;
  const result = await comparison({ localSelectFailure: true, fetchImpl: provider({ intercept: (url, options) => {
    const body = JSON.parse(options.body);
    return url.endsWith('/responses') && body.text.format.name === 'cairn_extract' && ++extracts > 3
      ? Response.json(envelope({ items: [{ invalid: true }] })) : null;
  } }) });
  assert.equal(result.fatal, null);
  const arm = result.observations[0].arms.full;
  assert.equal(result.observations[0].capture.status, 'completed'); assert.equal(arm.status, 'unresolved');
  assert.equal(arm.modelCalls.filter(call => call.method === 'select').length, 0);
  assert.equal(arm.coreInputs.length, 1); assert.equal(arm.effectiveSelections.length, 1);
  assert.equal(arm.effectiveSelections[0].output, null);
  assert.equal(arm.effectiveSelections[0].failure, 'context_budget_exceeded');
  assert.equal(arm.effectiveSelections[0].publicReads.length, 0);
});
test('Q2 runner keeps evaluator gold/calibration imports out of model execution', () => {
  const runtime = readFileSync(new URL('../runner.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(runtime, /from ['"].*(?:rubric|requested-answer|evaluator|judging|coverage)/);
});
