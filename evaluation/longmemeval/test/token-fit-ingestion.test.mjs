import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { captureSnapshot } from '../../../core/capture-input.mjs';
import { checkExtractionFits, extractionRequest } from '../../../core/capture.mjs';
import { modelRequestText } from '../../../core/model-call.mjs';
import { countOpenAITokens } from '../../../adapters/openai/index.mjs';
import { openMemoryCore } from '../../../core/contract.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { planIndexedEvidenceLongMemEvalCase, planIndexedWindowLongMemEvalCase,
  planLongMemEvalCase, planQualifiedPrefixLongMemEvalCase, ingestionSourceProjection,
  ingestIndexedEvidenceLongMemEvalCase } from '../ingestion.mjs';
import { prepareMixedSourceCase, mixedSourcePolicy } from '../mixed-source.mjs';
import { verifyMixedCapturePlan } from '../mixed-plan.mjs';
import { projectMixedResources, NATIVE_PROFILE } from '../mixed-resource.mjs';
import { experimentPolicy } from '../../live/session.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { mem0WireProfile } from '../../experiment-budget/mem0-wire.mjs';

const namespace = { ownerId: 'token-fit-synthetic', scope: 'project', projectId: 'project' };
const model = { contextWindow: 1047576, countTokens: countOpenAITokens,
  extract: () => assert.fail('planning must not generate') };
const history = (lengths = [3200, 3200]) => ({
  question_id: `lme-case-${'0'.repeat(64)}`,
  sessions: [{ session_index: 0, session_id: 'synthetic-session', date: 'synthetic-date',
    turns: lengths.map((length, index) => ({ turn_id: `lme-turn-${String(index).padStart(64, '0')}`,
      role: index % 2 ? 'assistant' : 'user', content: '中'.repeat(length) })) }],
});

test('TFI3/TFI4 token-fit partition retains source coordinates, dense catalogs, sessions and new identities', () => {
  const source = history([3200, 3200, 200]);
  source.sessions.push({ ...structuredClone(source.sessions[0]), session_index: 1,
    turns: [{ turn_id: `lme-turn-${'9'.repeat(64)}`, role: 'user', content: '  Alpha Å  ' }] });
  const before = structuredClone(source);
  const legacy = planLongMemEvalCase({ history: source, namespace });
  const evidence = planIndexedEvidenceLongMemEvalCase({ history: source, namespace });
  const indexed = planIndexedWindowLongMemEvalCase({ history: source, namespace });
  assert.deepEqual(evidence, planIndexedEvidenceLongMemEvalCase({ history: source, namespace }));
  assert.equal(evidence.schemaVersion, 'cairn-longmemeval-indexed-evidence-ingestion-plan-v2');
  assert.equal(indexed.schemaVersion, 'cairn-longmemeval-indexed-window-ingestion-plan-v2');
  assert.equal(evidence.summary.modelContextFitEstablished, true);
  assert.equal(evidence.summary.plannedBatchCount, evidence.batches.length);
  assert.deepEqual(indexed.batches.map(b => b.captureInput), evidence.batches.map(b => b.captureInput));
  assert.deepEqual(evidence.batches.flatMap(b => b.captureInput.messages), legacy.batches.flatMap(b => b.captureInput.messages));
  const sourceCoordinates = plan => plan.batches.flatMap(b => b.sourceMap.map(({ messageIndex, ...coordinates }) => coordinates));
  assert.deepEqual(sourceCoordinates(evidence), sourceCoordinates(legacy));
  for (const [index, batch] of evidence.batches.entries()) {
    assert.equal(batch.batchIndex, index);
    assert.deepEqual(batch.sourceMap.map(row => row.messageIndex), batch.captureInput.messages.map((_, i) => i));
    assert.ok(batch.sourceMap.every(row => row.sessionIndex === batch.source.sessionIndex));
    assert.equal(batch.sessionBatchIndex, evidence.batches.slice(0, index).filter(b =>
      b.source.sessionIndex === batch.source.sessionIndex).length);
    assert.equal(batch.normalizedCapture.payloadDigest,
      captureSnapshot(batch.captureInput, undefined, 'indexed-evidence-v1').payloadDigest);
    assert.deepEqual(batch.indexedWindows.map(w => w.index), batch.indexedWindows.map((_, i) => i));
    for (const window of batch.indexedWindows) {
      const message = batch.normalizedCapture.messages[window.messageIndex];
      assert.equal(window.id, message.id);
      assert.equal(window.content, message.content.slice(window.start, window.end));
    }
    checkExtractionFits(model, requestFor(batch));
    assert.ok(!legacy.batches.some(old => old.captureInput.eventId === batch.captureInput.eventId));
  }
  assert.equal(new Set(evidence.batches.map(b => b.captureInput.eventId)).size, evidence.batches.length);
  assert.deepEqual(source, before);
});

test('TFI3 an oversized singleton blocks without omitting source or invoking capture', async t => {
  const source = history([100, 4000, 100]);
  source.sessions[0].turns[1].content = '㐀'.repeat(4000);
  const plan = planIndexedEvidenceLongMemEvalCase({ history: source, namespace });
  assert.equal(plan.executable, false);
  assert.equal(plan.summary.modelContextFitEstablished, false);
  assert.deepEqual(plan.blockers.map(b => b.code), ['extraction_message_oversized']);
  assert.deepEqual(plan.batches.map(b => b.captureInput.messages.length), [1, 1, 1]);
  assert.deepEqual(plan.batches.flatMap(b => b.sourceMap.map(m => m.rawContent)), source.sessions[0].turns.map(t => t.content));
  assert.throws(() => checkExtractionFits(model, requestFor(plan.batches[1])), { code: 'context_budget_exceeded' });
  const workspace = createTestWorkspace(t, { prefix: 'token-fit-blocked-' });
  const core = openMemoryCore({ path: join(workspace.path, 'memory.db'), model,
    captureSourcePolicy: 'indexed-evidence-v1' });
  workspace.defer(() => core.close());
  const result = await ingestIndexedEvidenceLongMemEvalCase({ history: source, namespace,
    capture: () => assert.fail('blocked case must not capture') });
  assert.deepEqual(result.outcomes.map(o => o.status), ['not_run', 'not_run', 'not_run']);
  assert.equal(core.list({ namespace }).value.memories.length, 0);
});

test('TFI5 token-fit mixed preparation gives both arms the same partition and recomputes resource bounds', () => {
  const source = history();
  source.sessions[0].date = '2024/01/01 (Mon) 09:00';
  source.sessions[0].session_id = `lme-session-${'b'.repeat(64)}`;
  const mixedNamespace = { ...namespace, projectId: source.question_id };
  const row = { history: source, namespace: mixedNamespace, question: { question_id: source.question_id,
    text: 'What synthetic fact?', date: '2024/01/02 (Tue) 10:00' } };
  const plan = prepareMixedSourceCase(row, 'indexed-evidence-v1');
  assert.equal(plan.version, 'cairn-lme-mixed-source-v3');
  assert.equal(plan.policy, mixedSourcePolicy());
  assert.equal(plan.counts.batches, 2);
  assert.deepEqual(plan.mem0Input.batches, plan.cairnPlan.batches.map(b =>
    b.captureInput.messages.map(({ role, content }) => ({ role, content }))));
  assert.equal(verifyMixedCapturePlan({ history: plan.renderedHistory, namespace: mixedNamespace,
    expectedPlan: plan.cairnPlan, comparisonProfile: 'indexed-evidence-v1' }).schemaVersion,
  'cairn-longmemeval-indexed-evidence-ingestion-plan-v2');
  const stale = structuredClone(plan.cairnPlan);
  stale.schemaVersion = 'cairn-longmemeval-indexed-evidence-ingestion-plan-v1';
  assert.throws(() => verifyMixedCapturePlan({ history: plan.renderedHistory, namespace: mixedNamespace,
    expectedPlan: stale, comparisonProfile: 'indexed-evidence-v1' }), { code: 'planner_mismatch' });
  const options = { comparisonProfile: 'indexed-evidence-v1', policy: experimentPolicy(),
    stages: benchmarkStagePolicy(), wireProfile: mem0WireProfile(), nativeProfile: NATIVE_PROFILE,
    remainingMicroUsd: 30000000, protectedMicroUsd: 0 };
  const before = projectMixedResources({ ...options, batchCounts: [1] });
  const after = projectMixedResources({ ...options, batchCounts: [plan.counts.batches] });
  assert.equal(after.plannedBatchCount, 2);
  assert.ok(after.conditionalCeilings.joint.requests > before.conditionalCeilings.joint.requests);
  assert.ok(after.conditionalCeilings.joint.reservedMicroUsd > before.conditionalCeilings.joint.reservedMicroUsd);
});

test('TFI6 real core captures every frozen token-fit batch in an owned workspace', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'token-fit-capture-' });
  let extractions = 0;
  const core = openMemoryCore({ path: join(workspace.path, 'memory.db'),
    model: { ...model, extract: () => { extractions++; return { items: [] }; } },
    captureSourcePolicy: 'indexed-evidence-v1' });
  workspace.defer(() => core.close());
  const result = await ingestIndexedEvidenceLongMemEvalCase({ history: history(), namespace,
    capture: input => core.capture(input) });
  assert.deepEqual(result.outcomes.map(o => o.status), ['completed', 'completed']);
  assert.equal(extractions, 2);
});
const requestFor = batch => extractionRequest(captureSnapshot(batch.captureInput, undefined,
  'indexed-evidence-v1'), { captureSourcePolicy: 'indexed-evidence-v1' });

test('TFI1 two individually fitting messages are planned into extraction-fitting batches', () => {
  const one = planIndexedEvidenceLongMemEvalCase({ history: history([3200]), namespace });
  assert.equal(one.executable, true);
  assert.equal(one.batches.length, 1);
  checkExtractionFits(model, requestFor(one.batches[0]));
  const source = history(), before = structuredClone(source);
  const plan = planIndexedEvidenceLongMemEvalCase({ history: source, namespace });
  assert.equal(plan.executable, true);
  const tokens = plan.batches.map(batch => {
    const request = requestFor(batch);
    return countOpenAITokens(modelRequestText(request.system, request.input));
  });
  console.log(JSON.stringify({ synthetic: true, batches: plan.batches.length, logicalTokens: tokens }));
  for (const batch of plan.batches) assert.doesNotThrow(() => checkExtractionFits(model, requestFor(batch)));
  assert.equal(plan.batches.length, 2);
  assert.deepEqual(source, before, 'planning does not mutate source');
});

test('TFI3 legacy and qualified-prefix keep their original structural partition and event identities', () => {
  const source = history();
  const legacy = planLongMemEvalCase({ history: source, namespace });
  const prefix = planQualifiedPrefixLongMemEvalCase({ history: source, namespace });
  assert.equal(legacy.schemaVersion, 'cairn-longmemeval-ingestion-plan-v1');
  assert.equal(prefix.schemaVersion, 'cairn-longmemeval-qualified-prefix-ingestion-plan-v1');
  assert.equal(legacy.batches.length, 1);
  assert.deepEqual(prefix.batches.map(b => b.captureInput), legacy.batches.map(b => b.captureInput));
  assert.deepEqual(prefix.batches.map(b => b.sourceMap), legacy.batches.map(b => b.sourceMap));
  assert.equal(legacy.summary.modelContextFitEstablished, false);
  assert.equal(prefix.summary.modelContextFitEstablished, false);
});

test('TFI4 shared source projection permits only batching/index identity differences', () => {
  const options = { history: history(), namespace };
  const prefix = planQualifiedPrefixLongMemEvalCase(options);
  const indexed = planIndexedWindowLongMemEvalCase(options);
  assert.deepEqual([prefix.batches.length, indexed.batches.length], [1, 2]);
  const expected = ingestionSourceProjection(prefix);
  assert.deepEqual(ingestionSourceProjection(indexed), expected);
  for (const mutate of [
    plan => { plan.sourceTurns[0].rawContent += 'changed'; },
    plan => { plan.batches[0].captureInput.messages[0].content += 'changed'; },
    plan => { plan.batches[0].captureInput.messages[0].role = 'assistant'; },
    plan => { plan.batches[0].captureInput.messages[0].id += '-changed'; },
    plan => { plan.batches[0].captureInput.namespace.ownerId += '-changed'; },
    plan => { plan.batches[0].captureInput.client += '-changed'; },
    plan => { plan.batches[0].captureInput.sessionId += '-changed'; },
    plan => { plan.batches[0].sourceMap[0].rawStartUtf16 += 1; },
    plan => { plan.batches.reverse(); },
    plan => { plan.batches.pop(); },
  ]) {
    const changed = structuredClone(indexed);
    mutate(changed);
    assert.notDeepEqual(ingestionSourceProjection(changed), expected);
  }
});
