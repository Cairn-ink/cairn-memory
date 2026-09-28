import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import test from 'node:test';

import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { prepareMixedSourceCase } from '../longmemeval/mixed-source.mjs';
import { evaluatorRows, rubric } from './evaluator.mjs';
import { inspectLongHistorySources, prepareLongHistoryLive } from './prepare.mjs';
import { armOrders, sourceCases } from './source-cases.mjs';

const fakeDescriptors = () => ({
  nativeArtifact: { sourceTreeSha256: '1'.repeat(64), dependencyLockSha256: '2'.repeat(64) },
  nativeConfiguration: { configurationSha256: '3'.repeat(64), configuration: {} },
  cairnRuntimeArtifactSha256: '4'.repeat(64),
});

test('L1/L2 four authored histories make four real indexed-evidence batches each', t => {
  createTestWorkspace(t, { prefix: 'cairn-long-history-fixture-' });
  assert.equal(sourceCases.length, 4);
  assert.deepEqual(armOrders, [['cairn', 'mem0'], ['mem0', 'cairn'],
    ['cairn', 'mem0'], ['mem0', 'cairn']]);
  const result = inspectLongHistorySources();
  assert.deepEqual(result.map(item => item.batches), [4, 4, 4, 4]);
  assert.deepEqual(result.map(item => item.originalMessages), [60, 60, 60, 60]);
  assert.deepEqual(result.map(item => item.renderedMessages), [60, 60, 60, 60]);
  assert.deepEqual(result.map(item => item.longestOriginalMessageUtf16),
    [2690, 226, 189, 73]);
  assert.equal(new Set(result.map(item => item.questionId)).size, 4);
  assert.equal(sourceCases[0].history.sessions[0].turns[0].content.length, 2690);
  const longMessage = sourceCases[0].history.sessions[0].turns[0].content;
  const positions = ['moss-green ceramic key', 'brass spiral clip', 'violet wax seal']
    .map(marker => longMessage.indexOf(marker));
  assert.ok(positions[0] < longMessage.length / 4);
  assert.ok(positions[1] > longMessage.length / 3
    && positions[1] < longMessage.length * 2 / 3);
  assert.ok(positions[2] > longMessage.length * 3 / 4);
  for (const row of sourceCases) {
    assert.ok(Object.isFrozen(row));
    const actual = prepareMixedSourceCase(row, 'indexed-evidence-v1');
    assert.equal(actual.counts.batches, 4);
    assert.equal(actual.cairnPlan.batches.length, actual.mem0Input.batches.length);
    assert.ok(actual.cairnPlan.batches.every(batch => batch.indexedWindows.length > 0));
  }
});

test('L1/L6 evaluator records and manual rubric stay outside source-only preflight', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-long-history-separation-' });
  const sourceBytes = JSON.stringify({ sourceCases, armOrders });
  for (const field of ['reference_answer', 'question_type', 'answer_session_ids',
    'turn_labels', 'supportedFacts', 'forbiddenInferences']) {
    assert.equal(sourceBytes.includes(field), false, field);
  }
  assert.equal(evaluatorRows.length, 4);
  assert.equal(rubric.length, 4);
  assert.deepEqual(evaluatorRows.map(row => row.question_type),
    ['single-session-user', 'knowledge-update', 'knowledge-update', 'multi-session']);
  for (const [index, row] of evaluatorRows.entries()) {
    assert.equal(row.question_id, sourceCases[index].question.question_id);
    assert.equal(typeof row.reference_answer, 'string');
    assert.ok(row.reference_answer.length > 0);
    assert.ok(row.answer_session_ids.length > 0);
    assert.ok(row.turn_labels.every(label => label.has_answer));
    assert.ok(rubric[index].supportedFacts.length > 0);
    assert.ok(rubric[index].forbiddenInferences.length > 0);
  }
  assert.deepEqual(readdirSync(workspace.path), []);
});

test('L2/L6 source-only preparation has fixed N, ready plans, correct profile and zero network', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-long-history-preflight-' });
  const oldFetch = globalThis.fetch;
  let attempted = 0;
  globalThis.fetch = () => { attempted++; throw new Error('unexpected_network'); };
  try {
    const prepared = prepareLongHistoryLive(fakeDescriptors());
    assert.equal(prepared.schemaVersion, 'cairn-lme-mixed-indexed-evidence-preparation-v1');
    assert.equal(prepared.counts.fixedN, 4);
    assert.deepEqual(prepared.counts.batchCounts, [4, 4, 4, 4]);
    assert.ok(prepared.preflight.every(item => item.status === 'ready' && item.reason === null));
    assert.deepEqual(prepared.roster.map(item => item.armOrder), armOrders);
    assert.equal(prepared.manifest.cairn.comparisonProfile, 'indexed-evidence-v1');
    assert.equal(attempted, 0);
    assert.deepEqual(readdirSync(workspace.path), []);
  } finally { globalThis.fetch = oldFetch; }
});
