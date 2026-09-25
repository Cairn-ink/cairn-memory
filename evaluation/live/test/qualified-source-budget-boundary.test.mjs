import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { countOpenAITokens, createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { qualificationPoolWire } from '../../../adapters/openai/test/qualification-pool-wire.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { qualifyCandidateItems } from '../../../core/qualification-candidates.mjs';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { authorizeBenchmarkExtension, authorizeBenchmarkRequestAllowance,
  authorizeBenchmarkBudgetExtension, authorizeQualifiedSourcePairCapability,
  createExperimentRequestGuard, createQualifiedSourcePairExperimentRequestGuard } from '../../experiment-budget/request-guard.mjs';
import { planIndexedWindowLongMemEvalCase } from '../../longmemeval/ingestion.mjs';
import { opaqueQuestionId, opaqueSessionId, stableTurnIdV2 } from '../../longmemeval/prepare.mjs';
import { qualifiedSourcePairProtocol } from '../../longmemeval/public-comparison.mjs';
import { benchmarkStagePolicy } from '../public-pilot.mjs';
import { experimentPolicy } from '../session.mjs';

const LIMITS = { contextWindow: 123_000, outputTokens: 512,
  answerTimeoutMs: 200_000, recallLimit: 6 };

function sourceCase(size, turnCount = 12, sourceId = 'synthetic-budget-case') {
  const questionId = opaqueQuestionId(sourceId);
  const turns = Array.from({ length: turnCount }, (_, index) => ({
    turn_id: stableTurnIdV2(sourceId, 0, index), role: index % 2 ? 'assistant' : 'user',
    content: Array.from({ length: size }, (_, letter) =>
      String.fromCharCode(97 + (letter * 17 + index * 13) % 26)).join(''),
  }));
  const history = { question_id: questionId, sessions: [{ session_index: 0,
    session_id: opaqueSessionId(sourceId, 0), date: 'source date', turns }] };
  const question = { question_id: questionId, text: 'What was recorded?', date: 'question date' };
  const namespace = { ownerId: 'synthetic-budget-boundary', scope: 'project', projectId: questionId };
  return { history, question, namespace, answerModel: 'gpt-4.1-mini-2025-04-14',
    limits: LIMITS, armOrder: ['indexed-windows', 'qualified-prefix'] };
}

function uniqueExcerpt(itemIndex, receiptIndex) {
  return Array.from({ length: 13 }, (_, chunkIndex) => createHash('sha256')
    .update(`synthetic-${itemIndex}-${receiptIndex}-${chunkIndex}`).digest('hex')).join('').slice(0, 800);
}

function capacityItems(itemCount) {
  return Array.from({ length: itemCount }, (_, itemIndex) => ({
    content: `Synthetic capacity item ${itemIndex}.`, kind: 'context', confidence: 0.8,
    receipts: Array.from({ length: 4 }, (_, receiptIndex) => ({ client: 'synthetic',
      sessionId: 'capacity', eventId: `event-${itemIndex}-${receiptIndex}`,
      role: 'user', excerpt: uniqueExcerpt(itemIndex, receiptIndex) })),
  }));
}

function ledger(t, root, data) {
  const initial = { directory: join(root, 'budget'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  createExperimentBudget(initial).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: initial, policy,
    fetchImpl: () => assert.fail('no provider') }).close();
  const stages = benchmarkStagePolicy();
  const original = authorizeBenchmarkExtension({ ledger: initial, policy,
    authorizationId: 'original', stages });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: initial, policy,
    benchmarkExtension: original, authorizationId: 'allowance', newRequestCap: 40,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const allowed = { ...initial, requestCap: 40 };
  const parent = authorizeBenchmarkBudgetExtension({ oldLedger: allowed, policy,
    requestAllowance: allowance, authorizationId: 'parent',
    newLimitMicroUsd: 100_000_000, newRequestCap: 100,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const config = { ...allowed, limitMicroUsd: 100_000_000, requestCap: 100 };
  const protocol = qualifiedSourcePairProtocol(data);
  const roster = [{ questionId: protocol.questionId, protocolDigest: protocol.digest,
    armOrder: [...data.armOrder], arms: protocol.arms.map(({ name, scopeId }) => ({ name, scopeId })) }];
  const capability = authorizeQualifiedSourcePairCapability({ ledger: config, policy,
    benchmarkExtension: parent, authorizationId: 'pair', executionId: 'boundary-case',
    checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, roster });
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { config, policy, parent, capability,
    scopeId: protocol.arms.find((arm) => arm.name === 'indexed-windows').scopeId };
}

function modelOutput(body, extractionItems, candidateSources, citedCandidates) {
  const method = body.text.format.name.replace(/^cairn_/u, '');
  if (method === 'extract') {
    const input = JSON.parse(body.input[0].content[0].text);
    const last = input.inputMode === 'indexed-windows-v1' ? input.messages.length - 1 : 0;
    return { items: Array.from({ length: extractionItems }, (_, index) => ({
      content: `Synthetic attributed observation ${index}: ${'recorded context '.repeat(10)}`,
      kind: 'context', confidence: 0.9,
      sourceIndices: Array.from({ length: Math.min(candidateSources, last + 1) },
        (_, offset) => offset),
    })) };
  }
  if (method === 'qualifyCandidates') {
    const input = JSON.parse(body.input[0].content[0].text);
    const empty = { value: null, evidenceIndices: [] };
    const unknown = { value: 'unknown', evidenceIndices: [] };
    return qualificationPoolWire(input, { qualifications: input.items.map((entry) => ({
      itemIndex: entry.itemIndex,
        subject: empty, property: empty, scope: empty, applies: empty,
        value: { value: null, evidenceIndices: entry.candidates.slice(0, citedCandidates)
          .map(candidate => candidate.candidateIndex) },
        attribution: unknown, commitment: unknown,
    })) });
  }
  if (method === 'classify') {
    const input = JSON.parse(body.input[0].content[0].text);
    return { items: input.memories.map((memory) => ({ memoryId: memory.id,
      parentIds: [], newL1: { title: 'Synthetic evidence', parentL2Ids: [] } })) };
  }
  assert.fail(`unexpected method ${method}`);
}

async function capture(t, { size, turnCount, extractionItems, candidateSources = 4,
  citedCandidates = 1, followupSize = null }) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-qualified-budget-boundary-'));
  const data = sourceCase(size, turnCount);
  const f = ledger(t, root, data);
  const calls = [];
  const counts = new Map();
  const diagnostics = [];
  const guard = createQualifiedSourcePairExperimentRequestGuard({ ledger: f.config,
    policy: f.policy, benchmarkExtension: f.parent,
    qualifiedSourcePairCapability: f.capability,
    fetchImpl: (url, options) => {
      const body = JSON.parse(options.body);
      const method = body.text?.format?.name ?? 'unknown';
      if (url.endsWith('/input_tokens')) {
        // A deterministic provider-like count of the complete request, including
        // strict schema. No method-specific canned count or guard bypass.
        const inputTokens = countOpenAITokens(JSON.stringify(body));
        const input = JSON.parse(body.input[0].content[0].text);
        const localTokens = countOpenAITokens(JSON.stringify({ system: body.instructions,
          input, maxOutputTokens: 1024 }));
        let qualification;
        if (method === 'cairn_qualifyCandidates') {
          const withoutSchema = { ...body, text: { format: { ...body.text.format, schema: null } } };
          const withoutEvidence = { ...body, input: [{ role: 'user', content: [{ type: 'input_text',
            text: JSON.stringify({ items: input.items.map((item) => ({ ...item, content: '',
              candidates: item.candidates.map((candidate) => ({ ...candidate, text: '' })) })) }),
          }] }] };
          qualification = { itemCount: input.items.length,
            candidateCount: input.items.reduce((sum, item) => sum + item.candidates.length, 0),
            candidateTextUnits: input.items.reduce((sum, item) => sum + item.candidates.reduce(
              (sub, candidate) => sub + candidate.text.length, 0), 0),
            schemaTokens: countOpenAITokens(JSON.stringify(body.text.format.schema)),
            schemaContributionTokens: inputTokens - countOpenAITokens(JSON.stringify(withoutSchema)),
            evidenceContributionTokens: inputTokens - countOpenAITokens(JSON.stringify(withoutEvidence)) };
        }
        counts.set(method, inputTokens);
        calls.push({ route: 'count', method, inputTokens, localTokens,
          serializedBytes: Buffer.byteLength(options.body), ...(qualification ? { qualification } : {}) });
        return Response.json({ object: 'response.input_tokens', input_tokens: inputTokens });
      }
      calls.push({ route: 'generation', method, inputTokens: counts.get(method) });
      const output = modelOutput(body, extractionItems, candidateSources, citedCandidates);
      return Response.json({ id: 'resp_synthetic', object: 'response',
        model: body.model, status: 'completed', error: null, incomplete_details: null,
        output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
        usage: { input_tokens: counts.get(method), output_tokens: 100,
          total_tokens: counts.get(method) + 100 } });
    } });
  t.after(() => guard.close());
  const baseModel = createOpenAIModel({ apiKey: 'synthetic-only',
    fetchImpl: (url, options) => guard.cairnFetch(url, options),
    onDiagnostic: (entry) => diagnostics.push({ stage: entry.stage, reason: entry.reason }) });
  const qualificationRequests = [];
  const model = Object.freeze({ ...baseModel, qualifyCandidates: async (request) => {
    qualificationRequests.push({ system: request.system, input: request.input });
    return baseModel.qualifyCandidates(request);
  } });
  const corePath = join(root, 'indexed.sqlite');
  const coreOptions = { path: corePath, model,
    captureQualification: 'source-bound-v2', captureSourcePolicy: 'indexed-windows-v1' };
  const core = openMemoryCore(coreOptions);
  let coreClosed = false;
  t.after(() => { if (!coreClosed) core.close(); });
  const plan = planIndexedWindowLongMemEvalCase({ history: data.history,
    namespace: data.namespace });
  assert.equal(plan.executable, true);
  assert.equal(plan.batches.length, 1);
  let result, followupResult, scopeError, failedMemoryCount;
  try {
    await guard.withCaseScope({ phase: 'generation', caseId: f.scopeId }, async () => {
      result = await core.capture(plan.batches[0].captureInput);
      if (followupSize !== null) {
        const listing = core.list({ namespace: data.namespace });
        assert.equal(listing.ok, true, JSON.stringify(listing));
        failedMemoryCount = listing.value.memories.length;
        const followup = sourceCase(followupSize, 4, 'synthetic-budget-followup');
        const followupPlan = planIndexedWindowLongMemEvalCase({ history: followup.history,
          namespace: followup.namespace });
        assert.equal(followupPlan.executable, true);
        assert.equal(followupPlan.batches.length, 1);
        followupResult = await core.capture(followupPlan.batches[0].captureInput);
      }
    });
  } catch (error) { scopeError = error.code; }
  let stored = [];
  if (result?.ok) {
    core.close(); coreClosed = true;
    const reopened = openMemoryCore(coreOptions);
    t.after(() => reopened.close());
    stored = result.value.admission.memories.map(({ id }) => {
      const found = reopened.get({ namespace: data.namespace, memoryId: id,
        includeQualification: true });
      assert.equal(found.ok, true, JSON.stringify(found));
      return found.value;
    });
  }
  return { calls, diagnostics, result, followupResult, qualificationRequests,
    scopeError, failedMemoryCount, halted: guard.isHalted(),
    stored,
    expectedSources: plan.batches[0].captureInput.messages.map(({ role, content }) => ({ role, content })),
    bounds: { coreAndAdapterLocalTokens: 6_000,
      guardCountMaxInputTokens: f.policy.cairnCount.maxInputTokens,
      guardGenerationMaxInputTokens: f.policy.cairnGeneration.maxInputTokens,
      guardInputTokenFraming: f.policy.cairnCount.inputTokenFraming,
      modelContextWindow: model.contextWindow },
    attempts: guard.attempts().map((attempt) => ({ stage: attempt.stage,
      outcome: attempt.outcome, actualMicroUsd: attempt.actualMicroUsd })) };
}

function assertColdStoredEvidence(trace) {
  assert.equal(trace.stored.length, 4);
  assert.deepEqual(trace.stored.map((item) => item.memory.id),
    trace.result.value.admission.memories.map((item) => item.id));
  const sorted = (entries) => entries.map((entry) => JSON.stringify(entry)).sort();
  const expected = sorted(trace.expectedSources.map(({ role, content }) => ({ role, excerpt: content })));
  for (const item of trace.stored) {
    assert.deepEqual(sorted(item.receipts.map(({ role, excerpt }) => ({ role, excerpt }))), expected);
    assert.ok(item.qualification.anchors.length > 0);
    for (const anchor of item.qualification.anchors) {
      const receipt = item.receipts.find((row) => row.id === anchor.receiptId);
      assert.ok(receipt);
      assert.equal(anchor.text, receipt.excerpt.slice(anchor.start, anchor.end));
      assert.deepEqual(anchor.fields, ['value']);
    }
  }
}

function assertThreeMethodPairs(trace) {
  assert.equal(trace.result?.value?.classification?.status, 'applied', JSON.stringify(trace));
  assert.deepEqual(trace.calls.map(({ route, method }) => [route, method]), [
    ['count', 'cairn_extract'], ['generation', 'cairn_extract'],
    ['count', 'cairn_qualifyCandidates'], ['generation', 'cairn_qualifyCandidates'],
    ['count', 'cairn_classify'], ['generation', 'cairn_classify'],
  ]);
}

test('D1 within-limit indexed source-qualified capture reaches normal guarded generation', async (t) => {
  const trace = await capture(t, { size: 113, turnCount: 4, extractionItems: 4 });
  assert.equal(trace.result?.ok, true, JSON.stringify(trace));
  assert.equal(trace.halted, false, JSON.stringify(trace));
  assert.equal(trace.calls[2]?.inputTokens, 3_905);
  assert.equal(trace.calls[2]?.qualification.schemaContributionTokens, 1_366);
  assertThreeMethodPairs(trace);
  assertColdStoredEvidence(trace);
});

test('D1 prompt-shaped indexed qualification does not globally halt on a valid source batch', async (t) => {
  const trace = await capture(t, { size: 114, turnCount: 4, extractionItems: 4 });
  assert.equal(trace.calls[0]?.method, 'cairn_extract', JSON.stringify(trace));
  assert.equal(trace.calls[2]?.method, 'cairn_qualifyCandidates', JSON.stringify(trace));
  assert.equal(trace.calls[2].inputTokens, 3_913);
  assert.equal(trace.halted, false, JSON.stringify(trace));
  assert.equal(trace.result?.ok, true, JSON.stringify(trace));
  assertThreeMethodPairs(trace);
  assertColdStoredEvidence(trace);
});

test('D2 item, candidate, and evidence dimensions isolate qualification request growth', async (t) => {
  const threeItems = await capture(t, { size: 114, turnCount: 4, extractionItems: 3 });
  const oneSource = await capture(t, { size: 114, turnCount: 4,
    extractionItems: 4, candidateSources: 1 });
  const full = await capture(t, { size: 114, turnCount: 4, extractionItems: 4 });
  const localRefusal = await capture(t, { size: 800, turnCount: 4, extractionItems: 5 });
  const qualification = (trace) => trace.calls.find((call) =>
    call.route === 'count' && call.method === 'cairn_qualifyCandidates');
  assert.equal(qualification(threeItems).qualification.itemCount, 3);
  assert.equal(qualification(full).qualification.itemCount, 4);
  assert.equal(qualification(oneSource).qualification.candidateCount, 4);
  assert.equal(qualification(full).qualification.candidateCount, 16);
  assert.ok(qualification(threeItems).inputTokens < qualification(full).inputTokens);
  assert.ok(qualification(oneSource).inputTokens < qualification(full).inputTokens);
  assert.equal(qualification(full).inputTokens, 3_913);
  assert.ok(qualification(full).localTokens < 6_000);
  assert.ok(qualification(full).qualification.schemaTokens < 1_500);
  assert.equal(qualification(full).qualification.schemaContributionTokens, 1_366);
  assert.equal(qualification(full).qualification.evidenceContributionTokens, 1_016);
  assert.ok(qualification(threeItems).qualification.schemaContributionTokens
    < qualification(full).qualification.schemaContributionTokens);
  assert.equal(qualification(oneSource).qualification.evidenceContributionTokens, 332);
  assert.deepEqual(full.bounds, { coreAndAdapterLocalTokens: 6_000,
    guardCountMaxInputTokens: 7_024, guardGenerationMaxInputTokens: 7_024,
    guardInputTokenFraming: 1_024, modelContextWindow: 1_047_576 });
  assert.equal(qualification(localRefusal), undefined);
  assert.equal(localRefusal.qualificationRequests.length, 0);
  assert.equal(localRefusal.result?.error.code, 'context_budget_exceeded');
  assert.equal(localRefusal.halted, false);
});

test('D2 oversized indexed extraction still refuses without admission or guard halt', async (t) => {
  const trace = await capture(t, { size: 600, turnCount: 4, extractionItems: 4,
    followupSize: 40 });
  assert.equal(trace.result?.error.code, 'context_budget_exceeded', JSON.stringify(trace));
  assert.equal(trace.halted, false, JSON.stringify(trace));
  assert.equal(trace.followupResult?.ok, true, JSON.stringify(trace));
  assert.equal(trace.failedMemoryCount, 0);
  assert.deepEqual(trace.calls.map((call) => call.method), [
    'cairn_extract', 'cairn_extract',
    'cairn_extract', 'cairn_extract', 'cairn_qualifyCandidates', 'cairn_qualifyCandidates',
    'cairn_classify', 'cairn_classify',
  ]);
  assert.equal(trace.qualificationRequests.length, 1);
  assert.equal(trace.stored.length, 0);
});

test('E4 maximum 5×4×800 qualifier refuses before any HTTP', async () => {
  let requests = 0;
  const model = createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: () => {
    requests++; return assert.fail('Maximum source qualification must refuse locally');
  } });
  await assert.rejects(qualifyCandidateItems(model, capacityItems(5)), { code: 'context_budget_exceeded' });
  assert.equal(requests, 0);
});

test('E4 full qualifier wire refuses locally when partial core request still fits', async () => {
  let requests = 0; let seen; const events = [];
  const base = createOpenAIModel({ apiKey: 'synthetic-only', onDiagnostic: event => events.push(event),
    fetchImpl: () => { requests++; return assert.fail('Complete wire must refuse before HTTP'); } });
  const model = Object.freeze({ ...base, qualifyCandidates: request => {
    seen = request; return base.qualifyCandidates(request);
  } });
  await assert.rejects(qualifyCandidateItems(model, capacityItems(2)), { code: 'context_budget_exceeded' });
  assert.ok(seen);
  assert.ok(countOpenAITokens(JSON.stringify({ system: seen.system, input: seen.input,
    maxOutputTokens: 1024 })) <= 6_000);
  assert.equal(requests, 0);
  assert.ok(events.some(event => event.stage === 'qualifyCandidates' && event.layer === 'adapter'
    && event.reason === 'request_bounds'));
});

test('E4 four cited candidates compile and cold-store exact source receipts', async (t) => {
  const trace = await capture(t, { size: 113, turnCount: 4, extractionItems: 4,
    citedCandidates: 4 });
  assert.equal(trace.result?.ok, true);
  assert.equal(trace.halted, false);
  assertThreeMethodPairs(trace);
  assert.equal(trace.stored.length, 4);
  for (const item of trace.stored) {
    assert.equal(item.qualification.anchors.length, 4);
    for (const anchor of item.qualification.anchors) {
      const receipt = item.receipts.find(row => row.id === anchor.receiptId);
      assert.ok(receipt);
      assert.equal(anchor.text, receipt.excerpt.slice(anchor.start, anchor.end));
      assert.deepEqual(anchor.fields, ['value']);
    }
  }
});
