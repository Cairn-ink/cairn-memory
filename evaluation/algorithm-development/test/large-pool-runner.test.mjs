import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade, upgradeExperimentBudgetForEmbeddings,
  inspectEmbeddingExperimentBudgetSnapshot } from '../../experiment-budget/index.mjs';
import { createLargePoolTransport, freezeObservation, algorithmLimits } from '../transport.mjs';
import { runLargePoolComparison, createLargePoolReplayModel } from '../runner.mjs';
import { largePoolRoster, largePoolLimits, largePoolOrders, LARGE_POOL_VERSION } from '../large-pool-profile.mjs';
import { scoreLargePoolCoverage } from '../coverage.mjs';
import { auditLargePoolComparison, buildBlindLargePoolPacket, aggregateLargePoolJudgments, LARGE_POOL_PROTOCOL } from '../large-pool.mjs';
import { unblindDevelopmentJudgments } from '../judging.mjs';
import { hashCanonicalValue } from '../corpus.mjs';

const secret = 'large-pool-synthetic-key', model = 'gpt-4.1-mini-2025-04-14';
export const cases = freezeObservation(largePoolRoster.map(item => ({ ...item,
  question: { text: 'Who handles the mural billing?', date: '2026-10-10' },
  sessions: Array.from({ length: 6 }, (_, index) => ({ id: `session-${index}`, eventTime: '2026-10-09T12:00:00Z', messages: [
    { role: 'user', content: index === 0 ? 'Billing contact for mural uses velvet.' : `Inventory control alpha ${index}.` },
    { role: 'assistant', content: 'Thanks for the update.' },
    { role: 'user', content: index === 0 ? 'The velvet arrangement names Mina.' : `Booking detail gamma ${index}.` },
  ] })) })));
export const rubric = { version: LARGE_POOL_VERSION, spanOffsetUnit: 'utf16-code-unit', cases: Object.fromEntries(cases.map(source => [source.id,
  { variant: source.family, requiredPropositions: ['Mina handles mural billing.'], acceptableQualifications: [],
    anchors: [{ sessionId: 'session-0', messageIndex: 2, start: 0, end: source.sessions[0].messages[2].content.length,
      text: source.sessions[0].messages[2].content }], requiredMultiSourceSets: [], unsupportedClaims: ['Invent another holder.'],
    staleUseCriteria: [], severeErrors: ['Invent another holder.'], optionalBackground: [],
    examples: { conciseCorrect: 'Mina.', explainedCorrect: 'Mina handles the mural billing.', incorrect: 'Unknown.' } }])) };
const response = output => Response.json({ object: 'response', model, status: 'completed', error: null, incomplete_details: null,
  output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
  usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
const ref = item => ({ namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision });
export function provider(intercept = () => null, empty = false) {
  return async (url, options) => {
    assert.equal(options.headers.Authorization, `Bearer ${secret}`);
    const intercepted = intercept(url, options); if (intercepted) return intercepted;
    const body = JSON.parse(options.body);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    if (url.endsWith('/chat/completions')) return Response.json({ object: 'chat.completion', model,
      choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Mina.' } }],
      usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 } });
    const input = JSON.parse(body.input[0].content[0].text), method = body.text.format.name;
    if (method === 'cairn_extract') return response({ items: input.messages.filter(message => message.role === 'user').map(message => ({
      content: message.content.slice(0, 600), kind: 'context', confidence: 0.8, sourceIndices: [message.index] })) });
    if (method === 'cairn_classify') return response({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) });
    if (method === 'cairn_select') return response({ refs: empty ? [] : input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled'
      && /Billing contact|velvet arrangement|Inventory control alpha 1/u.test(item.label)).map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) });
    return response({ refs: input.candidates.filter(item => item.receipts.some(receipt => receipt.excerpt.includes('Billing contact'))).slice(0, 1).map(ref) });
  };
}
export function fixture(t, fetchImpl = provider()) {
  const workspace = createTestWorkspace(t, { prefix: 'large-pool-caller-' });
  const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(), limitMicroUsd: 400_000_000, requestCap: 100_000 };
  createExperimentBudget(configuration).close();
  const old = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, expectedHistorySha256: old.historySha256 });
  const state = inspectEmbeddingExperimentBudgetSnapshot(configuration);
  const transport = createLargePoolTransport({ configuration, checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, historySha256: state.historySha256,
    apiKey: secret, fetchImpl }); workspace.defer(() => transport.close());
  const outputDirectory = join(workspace.path, 'output'); mkdirSync(outputDirectory);
  return { configuration, transport, outputDirectory };
}

test('L1–L8 real capture/core with one natural >6 raw pool and coupled compilers, coverage and blind judgments', async t => {
  const f = fixture(t), report = await runLargePoolComparison({ cases, ...f });
  assert.equal(report.fatal, null); assert.equal(report.denominator, 6);
  assert.equal(report.records.filter(row => row.method === 'answer').length, 12);
  for (const [index, row] of report.observations.entries()) {
    assert.deepEqual(row.order, largePoolOrders[index % 2]); assert.equal(row.capture.inputs.length, 6);
    assert.equal(row.capture.receipts.length, 12); assert.equal(row.capture.modelCalls.length, 12);
    assert.equal(row.pairing.integrity, true); assert.equal(row.mechanism.eligible, true);
    assert.equal(row.mechanism.rankCandidateCount, 7); assert.equal(row.mechanism.reason, 'lexical_bridges');
    assert.equal(row.arms.linked.recalled.memories.length, 1); assert.equal(row.arms.complementary.recalled.memories.length, 2);
    for (const name of row.order) {
      const arm = row.arms[name]; assert.equal(arm.status, 'completed', JSON.stringify(arm));
      assert.equal(arm.stateBefore, row.capture.stateSha256); assert.equal(arm.stateAfter, row.capture.stateSha256);
      assert.equal(arm.modelCalls.length, 2); assert.ok(arm.modelCalls.every(call => call.origin === (name === row.order[0] ? 'natural-model' : 'replay')));
      assert.equal(arm.records.length, name === row.order[0] ? 5 : 1);
    }
  }
  assert.equal(report.records.length, 180); assert.equal(JSON.stringify(report).includes(secret), false);
  const coverage = scoreLargePoolCoverage({ report, modelInputs: cases, evaluatorRubric: rubric });
  assert.equal(coverage.anchorDenominator, 6); assert.equal(coverage.gain, 6); assert.equal(coverage.lexicalPackedGain, 6);
  const hashes = { modelInputs: hashCanonicalValue(cases), evaluatorRubric: hashCanonicalValue(rubric), judgingProtocol: hashCanonicalValue(LARGE_POOL_PROTOCOL) };
  hashes.freeze = hashCanonicalValue({ version: LARGE_POOL_VERSION, ...hashes });
  const frozen = freezeObservation({ version: LARGE_POOL_VERSION, modelInputs: cases, evaluatorRubric: structuredClone(rubric), protocol: LARGE_POOL_PROTOCOL, hashes });
  const blind = buildBlindLargePoolPacket({ report, freeze: frozen });
  assert.equal(blind.packet.items.length, 12); assert.ok(blind.packet.items.every(item => !('examples' in item.rubric)));
  assert.ok('examples' in frozen.evaluatorRubric.cases.L01);
  const judged = blind.mapping.map(item => ({ label: item.label, verdict: item.arm === 'complementary' ? 'correct' : 'incorrect', reviewedClaims: 1,
    unsupportedClaims: 0, staleClaims: 0, severeError: false, rationale: 'Scripted gate control, not semantic quality.' }));
  const judgments = unblindDevelopmentJudgments(blind.mapping, judged);
  const result = aggregateLargePoolJudgments({ report, coverage, judgmentsA: judgments, judgmentsB: judgments, resourcesWithinLimits: true });
  assert.equal(result.supportsFurtherDevelopment, true); assert.equal(result.productPromotion, false);
  assert.equal(result.paired.complementaryLinked.wins, 6);
  const imperfect = judgments.map(row => row.id === 'L01' ? { ...row, verdict: row.arm === 'linked' ? 'correct' : 'incorrect' } : row);
  const loss = aggregateLargePoolJudgments({ report, coverage, judgmentsA: imperfect, judgmentsB: imperfect, resourcesWithinLimits: true });
  assert.equal(loss.paired.complementaryLinked.losses, 1); assert.equal(loss.supportsFurtherDevelopment, true, 'no new perfect-accuracy gate');
  const disagreement = judgments.map(row => row.id === 'L01' && row.arm === 'linked' ? { ...row, verdict: 'correct' } : row);
  assert.equal(aggregateLargePoolJudgments({ report, coverage, judgmentsA: judgments, judgmentsB: disagreement, resourcesWithinLimits: true }).supportsFurtherDevelopment, false);
  const harm = judgments.map(row => row.id === 'L01' && row.arm === 'complementary' ? { ...row, unsupportedClaims: 1, severeError: true } : row);
  assert.equal(aggregateLargePoolJudgments({ report, coverage, judgmentsA: harm, judgmentsB: harm, resourcesWithinLimits: true }).supportsFurtherDevelopment, false);
  const abstain = judgments.map(row => ({ ...row, verdict: 'incorrect' }));
  assert.equal(aggregateLargePoolJudgments({ report, coverage, judgmentsA: abstain, judgmentsB: abstain, resourcesWithinLimits: true }).supportsFurtherDevelopment, false);
  const tampered = structuredClone(report); tampered.observations[0].arms.complementary.modelCalls[0].input.query = 'different';
  assert.equal(auditLargePoolComparison(tampered)[0].integrity, false);
  tampered.observations[0].mechanism.eligible = true; tampered.observations[0].pairing.integrity = true;
  assert.equal(auditLargePoolComparison(tampered)[0].eligible, false);
  const foreign = structuredClone(report); foreign.observations[0].arms.linked.effectiveRanks[0].input.candidates[0].namespaceIndex = 1;
  assert.throws(() => scoreLargePoolCoverage({ report: foreign, modelInputs: cases, evaluatorRubric: rubric }));
});

test('L3 replay rejects changed, extra and underconsumed calls, detaches outputs and honors cancellation', async () => {
  const raw = { method: 'select', system: 's', input: { query: 'q' }, maxOutputTokens: 1024, output: { refs: [] }, failure: null };
  const base = { contextWindow: 8192, countTokens: () => 1 }, request = { system: raw.system, input: raw.input, maxOutputTokens: 1024, signal: new AbortController().signal };
  const under = createLargePoolReplayModel(base, [raw]); assert.throws(() => under.assertConsumed(), { code: 'large_pool_pairing_integrity' });
  const changed = createLargePoolReplayModel(base, [raw]);
  await assert.rejects(changed.model.select({ ...request, input: { query: 'other' } }), { code: 'large_pool_pairing_integrity' });
  const good = createLargePoolReplayModel(base, [raw]); raw.output.refs.push('mutation');
  const output = await good.model.select(request); assert.deepEqual(output, { refs: [] }); assert.ok(Object.isFrozen(output.refs)); good.assertConsumed();
  await assert.rejects(good.model.select(request), { code: 'large_pool_pairing_integrity' });
  const cancelled = new AbortController(); cancelled.abort();
  await assert.rejects(createLargePoolReplayModel(base, [raw]).model.select({ ...request, signal: cancelled.signal }), { name: 'AbortError' });
});

test('L5 fixed caps deny paid replay and preserve old literals', async t => {
  assert.equal(largePoolLimits.httpRequests, 6 * (2 * (12 + 8) + 2)); assert.equal(252 * 5000, 1_260_000); assert.equal(algorithmLimits.httpRequests, 1968);
  const f = fixture(t); f.transport.beginCase({ id: 'L01', ordinal: 1 });
  const request = (file, input) => ({ system: readFileSync(new URL(`../../../core/prompts/${file}.md`, import.meta.url), 'utf8'), input,
    maxOutputTokens: 1024, signal: new AbortController().signal });
  const extract = request('extract-source-windows', { messages: [] });
  for (let n = 0; n < 12; n++) await f.transport.model.extract(extract);
  await assert.rejects(f.transport.model.extract(extract), { code: 'algorithm_phase_call_cap' });
  f.transport.beginArm('linked'); const select = request('recall-select', { maps: [], query: 'test', maxRefs: 24 });
  for (let n = 0; n < 8; n++) await f.transport.model.select(select);
  await assert.rejects(f.transport.model.select(select), { code: 'algorithm_case_call_cap' });
  f.transport.beginArm('complementary'); await assert.rejects(f.transport.model.select(select), error => ['algorithm_case_call_cap', 'algorithm_phase_call_cap'].includes(error.code));
  assert.equal(f.transport.records().length, 40);
  const fresh = fixture(t); fresh.transport.beginCase({ id: 'L01', ordinal: 1 }); fresh.transport.beginArm('linked'); fresh.transport.beginArm('complementary');
  const before = inspectEmbeddingExperimentBudgetSnapshot(fresh.configuration);
  await assert.rejects(fresh.transport.model.select(select), { code: 'algorithm_phase_call_cap' });
  assert.equal(fresh.transport.records().length, 0); assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(fresh.configuration), before);
});

test('L3 actual core wraps replay mismatch, runner marks pairing fatal and retains all six/twelve slots without fallback', async t => {
  const f = fixture(t); let replaying = false;
  const originalCounter = f.transport.model.countTokens;
  const transport = { ...f.transport, model: { ...f.transport.model, countTokens(text) {
    if (replaying) {
      try { const value = JSON.parse(text); if (value.input?.candidates?.length > 6) return 7000; } catch { /* counter input can be plain text */ }
    }
    return originalCounter(text);
  } }, beginArm(name) { if (name === 'complementary') replaying = true; f.transport.beginArm(name); } };
  const report = await runLargePoolComparison({ cases, ...f, transport });
  assert.equal(report.fatal, 'large_pool_pairing_integrity');
  assert.equal(report.observations[0].arms.complementary.failure, 'large_pool_pairing_integrity');
  assert.ok(report.observations[0].arms.complementary.modelCalls.some(call => call.failure === 'large_pool_pairing_integrity'));
  assert.equal(report.observations.length, 6); assert.equal(report.observations.flatMap(row => Object.values(row.arms)).length, 12);
  assert.ok(report.observations.slice(1).every(row => row.capture.failure === 'large_pool_pairing_integrity'));
  assert.equal(report.records.filter(row => row.arm === 'complementary').length, 0);
  assert.equal(report.records.filter(row => row.method === 'answer').length, 1);
});

test('L3/L5 empty raw selection is a valid coupled ineligible result', async t => {
  const f = fixture(t, provider(() => null, true)), report = await runLargePoolComparison({ cases, ...f });
  assert.equal(report.fatal, null); assert.equal(report.records.filter(row => row.method === 'answer').length, 12);
  assert.ok(report.observations.every(row => row.pairing.integrity && !row.mechanism.eligible));
  assert.ok(auditLargePoolComparison(report).every(row => row.integrity && !row.eligible));
  const empty = fixture(t, provider((url, options) => url.endsWith('/responses') && JSON.parse(options.body).text.format.name === 'cairn_extract'
    ? response({ items: [] }) : null));
  const noCards = await runLargePoolComparison({ cases, ...empty });
  assert.equal(noCards.fatal, null); assert.equal(noCards.records.filter(row => row.method === 'answer').length, 12);
  assert.ok(auditLargePoolComparison(noCards).every(row => row.integrity && !row.eligible));
  assert.equal(scoreLargePoolCoverage({ report: noCards, modelInputs: cases, evaluatorRubric: rubric }).gain, 0);
});

test('L6 larger pool with no lexical addition stays eligible; saturated seeds are ineligible', async t => {
  const unlinked = structuredClone(cases);
  for (const source of unlinked) source.sessions[0].messages[2].content = 'The approved holder is Mina.';
  // Preserve three natural navigation seeds without forcing live extraction.
  const f = fixture(t, provider((url, options) => {
    if (!url.endsWith('/responses')) return null;
    const body = JSON.parse(options.body);
    if (body.text.format.name !== 'cairn_select') return null;
    const input = JSON.parse(body.input[0].content[0].text);
    return response({ refs: input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled'
      && /Billing contact|approved holder|Inventory control alpha 1/u.test(item.label)).map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) });
  }));
  const zero = await runLargePoolComparison({ cases: freezeObservation(unlinked), ...f });
  assert.equal(zero.fatal, null); assert.ok(zero.observations.every(row => row.mechanism.eligible && row.mechanism.addedRefs.length === 0));
  const saturated = fixture(t, provider((url, options) => {
    if (!url.endsWith('/responses')) return null;
    const body = JSON.parse(options.body); if (body.text.format.name !== 'cairn_rank') return null;
    const input = JSON.parse(body.input[0].content[0].text); return response({ refs: input.candidates.slice(0, 6).map(ref) });
  }));
  const full = await runLargePoolComparison({ cases, ...saturated });
  assert.equal(full.fatal, null); assert.ok(full.observations.every(row => row.mechanism.rankCandidateCount === 7
    && row.mechanism.reason === 'limit_exhausted' && !row.mechanism.eligible));
});

test('L5 first recall failure leaves replay unavailable; answer failure still permits raw replay; auth retains all slots', async t => {
  let ranks = 0;
  const recall = fixture(t, provider((url, options) => url.endsWith('/responses') && JSON.parse(options.body).text.format.name === 'cairn_rank' && ++ranks === 1
    ? Response.json({ error: 'synthetic failure' }, { status: 500 }) : null));
  const failed = await runLargePoolComparison({ cases, ...recall }); assert.equal(failed.fatal, null);
  assert.equal(failed.observations[0].arms.complementary.failure, 'large_pool_replay_unavailable'); assert.equal(failed.observations.length, 6);
  let answers = 0;
  const answer = fixture(t, provider(url => url.endsWith('/chat/completions') && ++answers === 1 ? Response.json({ error: 'answer failure' }, { status: 500 }) : null));
  const partial = await runLargePoolComparison({ cases, ...answer }); assert.equal(partial.fatal, null);
  assert.equal(partial.observations[0].arms.linked.status, 'unresolved'); assert.equal(partial.observations[0].arms.complementary.status, 'completed');
  assert.equal(partial.observations[0].pairing.integrity, true); assert.equal(answers, 12);
  const auth = fixture(t, provider(() => Response.json({ error: 'auth' }, { status: 401 })));
  const fatal = await runLargePoolComparison({ cases, ...auth }); assert.equal(fatal.fatal, 'algorithm_auth_transport_failure');
  assert.equal(fatal.observations.flatMap(row => Object.values(row.arms)).filter(arm => arm.status === 'unresolved').length, 12);
});
