// Synthetic-only X grant and fake HTTP for mixed runner tests. No live keys or corpus.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

import { createExperimentBudget, inspectEmbeddingExperimentBudgetSnapshot,
  inspectExperimentBudgetForEmbeddingUpgrade, reopenExperimentBudget,
  upgradeExperimentBudgetForEmbeddings } from '../../experiment-budget/index.mjs';
import { authorizeBenchmarkBudgetExtension, authorizeBenchmarkExtension,
  authorizeBenchmarkRequestAllowance, authorizeChainedBenchmarkBudgetExtension,
  authorizeMixedSourcePairCapability, createExperimentRequestGuard,
  createMixedSourcePairExperimentRequestGuard } from '../../experiment-budget/request-guard.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { experimentPolicy } from '../../live/session.mjs';
import { prepareMixedComparison } from '../mixed-generation.mjs';
import { opaqueQuestionId } from '../prepare.mjs';

const caps = (requests, reservedMicroUsd) => ({ requests, reservedMicroUsd });

export function sourceRow(sourceQuestionId = 'synthetic_source_1') {
  const id = opaqueQuestionId(sourceQuestionId);
  return { history: { question_id: id, sessions: [{ session_index: 0,
    session_id: `lme-session-${'b'.repeat(64)}`, date: '2024/01/01 (Mon) 09:00',
    turns: [{ turn_id: `lme-turn-${'c'.repeat(64)}`, role: 'user',
      content: 'Synthetic memory fact.' }] }] },
  question: { question_id: id, text: 'What synthetic fact?', date: '2024/01/02 (Tue) 10:00' },
  namespace: { ownerId: 'mixed-synthetic', scope: 'project', projectId: id } };
}

export function evaluatorRow(sourceQuestionId = 'synthetic_source_1') {
  return { question_id: opaqueQuestionId(sourceQuestionId), source_question_id: sourceQuestionId,
    question_type: 'single-session-user', reference_answer: 'Synthetic memory fact.',
    answer_session_ids: [`lme-session-${'b'.repeat(64)}`],
    turn_labels: [{ turn_id: `lme-turn-${'c'.repeat(64)}`, has_answer: true }] };
}

export function fakeMixedHttp(override = () => undefined, { cairnMemory = false } = {}) {
  const calls = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    calls.push({ route: new URL(url).pathname, body });
    const replacement = await override(url, body, options, calls);
    if (replacement !== undefined) return replacement;
    if (url.endsWith('/responses/input_tokens')) {
      return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    }
    if (url.endsWith('/responses')) {
      const input = JSON.parse(body.input[0].content[0].text);
      let output = { items: [] };
      if (cairnMemory && body.text.format.name === 'cairn_extract') {
        output = { items: [{ content: 'GENERATED_SUMMARY_POISON', kind: 'context',
          confidence: 0.9, sourceIndices: [0] }] };
      } else if (cairnMemory && body.text.format.name === 'cairn_qualifyCandidates') {
        output = { wireVersion: 'evidence-pool-v1',
          qualifications: Object.fromEntries(input.items.map(item => {
            const candidateIndex = item.candidates[0].candidateIndex;
            const empty = { value: null, evidenceSlots: [] };
            return [`item_${item.itemIndex}`, { itemIndex: item.itemIndex,
              pool: [candidateIndex], subject: empty, property: empty, scope: empty,
              applies: empty, value: { value: null, evidenceSlots: [0] },
              attribution: { value: 'unknown', evidenceSlots: [] },
              commitment: { value: 'unknown', evidenceSlots: [] } }];
          })) };
      } else if (cairnMemory && body.text.format.name === 'cairn_classify') {
        output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
      } else if (cairnMemory && body.text.format.name === 'cairn_select') {
        output = { refs: input.maps.flatMap(page => page.items.flatMap(item =>
          item.type === 'unfiled' ? [{ namespaceIndex: page.namespaceIndex, ...item.ref }]
            : item.type === 'ref' && item.ref.childType === 'memory'
              ? [{ namespaceIndex: page.namespaceIndex, memoryId: item.ref.childId,
                revision: item.ref.childRevision }] : [])) };
      } else if (cairnMemory && body.text.format.name === 'cairn_rank') {
        output = { refs: input.candidates.slice(0, input.limit).map(candidate =>
          ({ namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id,
            revision: candidate.memory.revision })) };
      }
      return Response.json({ object: 'response', model: body.model, status: 'completed',
        error: null, incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
    }
    if (url.endsWith('/embeddings')) {
      return Response.json({ object: 'list', model: 'text-embedding-3-small',
        usage: { prompt_tokens: 1, total_tokens: 1 },
        data: body.input.map((_, index) => ({ object: 'embedding', index,
          embedding: Array.from({ length: 1536 }, (_, dimension) => dimension === 0 ? 1 : 0) })) });
    }
    const content = body.response_format?.type === 'json_object'
      ? JSON.stringify({ memory: [{ text: 'Synthetic memory fact.' }] })
      : body.model === 'gpt-4o-2024-08-06' ? 'yes' : 'Synthetic memory fact.';
    return Response.json({ object: 'chat.completion', model: body.model,
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content } }] });
  };
  return { calls, fetchImpl };
}

function add(configuration, amount, outcome, actual) {
  const budget = reopenExperimentBudget(configuration);
  try {
    const attemptId = randomUUID();
    budget.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: amount });
    budget.recordOutcome(actual === undefined ? { attemptId, outcome }
      : { attemptId, outcome, actualMicroUsd: actual });
  } finally { budget.close(); }
}

export function syntheticMixedFixture(t, { artifact, configuration, sourceCases,
  armOrders, fetchImpl, httpTimeoutMs = 10_000, comparisonProfile }) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-mixed-runner-' });
  const root = workspace.path;
  const prepared = prepareMixedComparison({ sourceCases, armOrders,
    nativeArtifact: artifact, nativeConfiguration: configuration,
    cairnRuntimeArtifactSha256: '5'.repeat(64),
    ...(comparisonProfile === undefined ? {} : { comparisonProfile }) });
  const first = { directory: join(root, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  createExperimentBudget(first).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: first, policy,
    fetchImpl: () => assert.fail('setup cannot dispatch') }).close();
  const original = authorizeBenchmarkExtension({ ledger: first, policy,
    authorizationId: 'mixed-runner-original', stages: benchmarkStagePolicy() });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: first, policy,
    benchmarkExtension: original, authorizationId: 'mixed-runner-allowance', newRequestCap: 20,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const second = { ...first, requestCap: 20 };
  add(second, 13, 'unknown'); add(second, 17, 'succeeded', 9);
  const parent = authorizeBenchmarkBudgetExtension({ oldLedger: second, policy,
    requestAllowance: allowance, authorizationId: 'mixed-runner-parent100',
    newLimitMicroUsd: 100_000_000, newRequestCap: 40,
    expectedCheckpoint: { requestCount: 2, reservedMicroUsd: 30 } });
  const prior = { ...second, limitMicroUsd: 100_000_000, requestCap: 40 };
  add(prior, 19, 'failed');
  const ledger = { ...prior, limitMicroUsd: 200_000_000, requestCap: 80 };
  const benchmarkExtension = authorizeChainedBenchmarkBudgetExtension({ oldLedger: prior,
    policy, parentBudgetExtension: parent, authorizationId: 'mixed-runner-parent200',
    newLimitMicroUsd: 200_000_000, newRequestCap: 80,
    expectedCheckpoint: { requestCount: 3, reservedMicroUsd: 49 } });
  add(ledger, 23, 'unknown');
  const before = inspectExperimentBudgetForEmbeddingUpgrade(ledger);
  upgradeExperimentBudgetForEmbeddings({ ...ledger,
    expectedCheckpoint: { requestCount: before.requestCount,
      reservedMicroUsd: before.reservedMicroUsd }, expectedHistorySha256: before.historySha256 });
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(ledger);
  const limits = { phaseCaps: { generation: caps(55, 1_000_000), scoring: caps(20, 100_000) },
    caseCaps: { cairn: { generation: caps(20, 200_000), scoring: caps(5, 20_000) },
      mem0: { generation: caps(55, 800_000), scoring: caps(5, 20_000) } },
    mem0TimeoutMs: httpTimeoutMs };
  const capability = authorizeMixedSourcePairCapability({ ledger, policy, benchmarkExtension,
    authorizationId: 'mixed-runner-authorization', executionId: 'mixed-runner-execution',
    checkpoint: { requestCount: snapshot.requestCount,
      reservedMicroUsd: snapshot.reservedMicroUsd, historySha256: snapshot.historySha256 },
    manifest: prepared.manifest, roster: prepared.roster, limits });
  const guard = createMixedSourcePairExperimentRequestGuard({ ledger, policy,
    benchmarkExtension, mixedSourcePairCapability: capability, fetchImpl });
  workspace.defer(() => guard.close());
  return { root, guard, capability, prepared, snapshot };
}
