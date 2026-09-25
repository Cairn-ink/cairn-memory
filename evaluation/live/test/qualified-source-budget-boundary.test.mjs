import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { countOpenAITokens, createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
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

function sourceCase(size, turnCount = 12) {
  const sourceId = 'synthetic-budget-case';
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

function modelOutput(body, extractionItems, candidateSources) {
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
    return { qualifications: Object.fromEntries(input.items.map((entry) => [
      `item_${entry.itemIndex}`, { itemIndex: entry.itemIndex,
        subject: empty, property: empty, scope: empty, applies: empty,
        value: { value: null, evidenceIndices: [entry.candidates[0].candidateIndex] },
        attribution: unknown, commitment: unknown },
    ])) };
  }
  if (method === 'classify') {
    const input = JSON.parse(body.input[0].content[0].text);
    return { items: input.memories.map((memory) => ({ memoryId: memory.id,
      parentIds: [], newL1: { title: 'Synthetic evidence', parentL2Ids: [] } })) };
  }
  assert.fail(`unexpected method ${method}`);
}

async function capture(t, { size, turnCount, extractionItems, candidateSources = 4 }) {
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
      const output = modelOutput(body, extractionItems, candidateSources);
      return Response.json({ id: 'resp_synthetic', object: 'response',
        model: body.model, status: 'completed', error: null, incomplete_details: null,
        output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
        usage: { input_tokens: counts.get(method), output_tokens: 100,
          total_tokens: counts.get(method) + 100 } });
    } });
  t.after(() => guard.close());
  const model = createOpenAIModel({ apiKey: 'synthetic-only',
    fetchImpl: (url, options) => guard.cairnFetch(url, options),
    onDiagnostic: (entry) => diagnostics.push({ stage: entry.stage, reason: entry.reason }) });
  const core = openMemoryCore({ path: join(root, 'indexed.sqlite'), model,
    captureQualification: 'source-bound-v2', captureSourcePolicy: 'indexed-windows-v1' });
  t.after(() => core.close());
  const plan = planIndexedWindowLongMemEvalCase({ history: data.history,
    namespace: data.namespace });
  assert.equal(plan.executable, true);
  assert.equal(plan.batches.length, 1);
  let result, scopeError;
  try {
    await guard.withCaseScope({ phase: 'generation', caseId: f.scopeId }, async () => {
      result = await core.capture(plan.batches[0].captureInput);
    });
  } catch (error) { scopeError = error.code; }
  return { calls, diagnostics, result, scopeError, halted: guard.isHalted(),
    bounds: { coreAndAdapterLocalTokens: 6_000,
      guardCountMaxInputTokens: f.policy.cairnCount.maxInputTokens,
      guardGenerationMaxInputTokens: f.policy.cairnGeneration.maxInputTokens,
      guardInputTokenFraming: f.policy.cairnCount.inputTokenFraming,
      modelContextWindow: model.contextWindow },
    attempts: guard.attempts().map((attempt) => ({ stage: attempt.stage,
      outcome: attempt.outcome, actualMicroUsd: attempt.actualMicroUsd })) };
}

test('D1 within-limit indexed source-qualified capture reaches normal guarded generation', async (t) => {
  const trace = await capture(t, { size: 113, turnCount: 4, extractionItems: 4 });
  assert.equal(trace.result?.ok, true, JSON.stringify(trace));
  assert.equal(trace.halted, false, JSON.stringify(trace));
  assert.equal(trace.calls[2]?.inputTokens, 7_024, JSON.stringify(trace));
  assert.equal(trace.calls[2]?.qualification.schemaContributionTokens, 4_558,
    JSON.stringify(trace));
  assert.deepEqual(trace.calls.slice(0, 4).map((call) => call.route),
    ['count', 'generation', 'count', 'generation']);
});

test('D1 prompt-shaped indexed qualification does not globally halt on a valid source batch', async (t) => {
  const trace = await capture(t, { size: 114, turnCount: 4, extractionItems: 4 });
  assert.equal(trace.calls[0]?.method, 'cairn_extract', JSON.stringify(trace));
  assert.equal(trace.calls[2]?.method, 'cairn_qualifyCandidates', JSON.stringify(trace));
  assert.equal(trace.calls[2].inputTokens, 7_032, JSON.stringify(trace));
  // RED at the real adapter/guard seam until the separately scoped D2 repair.
  assert.equal(trace.halted, false, JSON.stringify(trace));
  assert.equal(trace.result?.ok, true, JSON.stringify(trace));
});

test('D2 item, candidate, and evidence dimensions isolate qualification request growth', async (t) => {
  const threeItems = await capture(t, { size: 114, turnCount: 4, extractionItems: 3 });
  const oneSource = await capture(t, { size: 114, turnCount: 4,
    extractionItems: 4, candidateSources: 1 });
  const full = await capture(t, { size: 114, turnCount: 4, extractionItems: 4 });
  const localRefusal = await capture(t, { size: 800, turnCount: 12, extractionItems: 5 });
  const qualification = (trace) => trace.calls.find((call) =>
    call.route === 'count' && call.method === 'cairn_qualifyCandidates');
  assert.equal(qualification(threeItems).qualification.itemCount, 3);
  assert.equal(qualification(full).qualification.itemCount, 4);
  assert.equal(qualification(oneSource).qualification.candidateCount, 4);
  assert.equal(qualification(full).qualification.candidateCount, 16);
  assert.equal(qualification(threeItems).inputTokens, 5_564);
  assert.equal(qualification(oneSource).inputTokens, 5_844);
  assert.equal(qualification(full).inputTokens, 7_032);
  assert.equal(qualification(full).localTokens, 2_379);
  assert.equal(qualification(full).qualification.schemaTokens, 4_561);
  assert.equal(qualification(full).qualification.schemaContributionTokens, 4_558);
  assert.equal(qualification(full).qualification.evidenceContributionTokens, 1_016);
  assert.equal(qualification(threeItems).qualification.schemaContributionTokens, 3_427);
  assert.equal(qualification(oneSource).qualification.evidenceContributionTokens, 332);
  assert.deepEqual(full.bounds, { coreAndAdapterLocalTokens: 6_000,
    guardCountMaxInputTokens: 7_024, guardGenerationMaxInputTokens: 7_024,
    guardInputTokenFraming: 1_024, modelContextWindow: 1_047_576 });
  assert.equal(qualification(localRefusal), undefined);
  assert.equal(localRefusal.result?.error.code, 'context_budget_exceeded');
  assert.equal(localRefusal.halted, false);
});
