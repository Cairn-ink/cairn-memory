import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { prepareMixedComparison } from '../longmemeval/mixed-generation.mjs';
import { prepareMixedSourceCase } from '../longmemeval/mixed-source.mjs';
import { comparisonProfile, sourceObservationMode,
  inspectSelectionLocalizationSources,
  prepareSelectionLocalizationComparison } from './selection-localization-prepare.mjs';
import { armOrders, sourceCases, sourceProbes } from './selection-localization-source-cases.mjs';

const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fakeDescriptors = () => ({
  nativeArtifact: { sourceTreeSha256: '1'.repeat(64), dependencyLockSha256: '2'.repeat(64) },
  nativeConfiguration: { configurationSha256: '3'.repeat(64), configuration: {} },
  cairnRuntimeArtifactSha256: '4'.repeat(64),
});

const expectedQuestionIds = [
  'lme-case-e24d95fe5cd503ae2067a69a51b166884ac94adb293fb20e380c15009b89c48f',
  'lme-case-af7c2e2af279eb973e8d5f06336c81a4626d7019a271731c4d5a6bf9fa2d7d12',
  'lme-case-83d02c5c7c33eb26501f7693b6c361ee80498fca5a83173833fbd5b519328833',
];
const expectedHistoryDigests = [
  '5d9c0be142239459f69bfdb702234691b19a8826e0a41fbbc0e2eecd822c5773',
  '6be8956d6cd5bdb99f7ead48b5a6d731e50c4c6618da87688dfc4d18962a697f',
  'e51d2b441709c6b91c0848e916b418f0027e234779878f6df55569906d2266b0',
];
const expectedCaseDigests = [
  'f2b1c138114b547ac692e1908106957952c9d0261c81ad3f78d76ad5c961a5d2',
  'fb07b09cd87164ee013ade901397d4a0ccc199a2fe453acfc3ec4cae99d43be6',
  '9b575c24b30454f577f8c70be40d6642489c99e6b453e29dca47e1f46827a9f3',
];
const expectedQuestionHashes = [
  '35531d6b5935b5ebf5a8adfee1dd312c1ccfb273f9525a2b62b8f721bd0f16e3',
  '3cbc5f78abf9b076cf7c9c3de55d32426b1ffc1ed4cc24b69bec79fe35c48cee',
  '489644d7a5d74179c84f38a3a12f23d6a2d02ec5751f2923f26bae2e02643f11',
];
const expectedWindowPositions = [
  { batchIndex: 3, windowIndex: 0, messageIndex: 0, startUtf16: 0, endUtf16: 196 },
  { batchIndex: 2, windowIndex: 1, messageIndex: 1, startUtf16: 0, endUtf16: 97 },
  { batchIndex: 4, windowIndex: 0, messageIndex: 0, startUtf16: 0, endUtf16: 222 },
];
const intendedTurns = [[3, 0], [2, 1], [4, 0]];
const originalReasonStatements = [
  'For Beacon H7, the team adopted uploads at 06:00 and 18:00 because the shore gateway was available only during those patrol windows.',
  '青禾食物站採用紙本號碼牌作為領取憑證，因為領取室當時沒有可用網路。',
  'The transport planner proposed a 20:30 Ridge Shuttle last departure because the festival was expected to end at 20:00; the board had not adopted the proposal.',
];
const laterStatusStatements = [
  'No replacement H7 upload cadence has been approved; the adopted 06:00 and 18:00 schedule remains in use pending review.',
  '主管正式改採 QR 碼作為青禾食物站的主要領取憑證，因本地終端能離線掃碼並在恢復連線後同步；紙本號碼牌保留作為故障備援。',
  'The board deferred the 20:30 last-departure proposal; it has not adopted a later last departure or changed the current shuttle timetable.',
];

test('L1/L2 frozen sources use 16 distinct sessions and one original-reason window per case', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-selection-localization-source-' });
  assert.equal(comparisonProfile, 'indexed-evidence-v1');
  assert.equal(sourceObservationMode, 'shared-source-v2');
  assert.equal(sourceCases.length, 3);
  assert.deepEqual(armOrders, [['cairn', 'mem0'], ['mem0', 'cairn'], ['cairn', 'mem0']]);
  assert.deepEqual(sourceCases.map(row => row.question.question_id), expectedQuestionIds);
  assert.equal(new Set(expectedQuestionIds).size, 3);
  assert.deepEqual(sourceCases.map(row => sha256(row.question)), expectedQuestionHashes);
  assert.equal(sha256({ sourceCases, armOrders, sourceProbes }),
    '0be6b0ec7997b7d65d466a3cfcf8a4c631585ef76139b58c51cec8fdda74f1a4');
  assert.equal(sha256(sourceProbes),
    '2eaac35da7175df144334d22786c9a3f2763f4ad2160304ce5f1deaa325a80e9');
  assert.ok(sourceCases.every(Object.isFrozen) && Object.isFrozen(sourceProbes));
  assert.ok(sourceCases[1].question.text.includes('最初為何選紙本號碼牌'));

  const inspection = inspectSelectionLocalizationSources();
  assert.ok(Object.isFrozen(inspection) && inspection.every(Object.isFrozen));
  assert.deepEqual(inspection.map(item => item.originalMessages), [32, 32, 32]);
  assert.deepEqual(inspection.map(item => item.renderedMessages), [32, 32, 32]);
  assert.deepEqual(inspection.map(item => item.batches), [16, 16, 16]);
  assert.deepEqual(inspection.map(item => item.longestOriginalMessageUtf16), [132, 60, 158]);
  assert.ok(inspection.every(item => item.longestOriginalMessageUtf16 < 500));
  assert.deepEqual(inspection.map(item => item.selectedWindow), expectedWindowPositions);
  assert.deepEqual(inspection.map(item => item.originalHistoryDigest), expectedHistoryDigests);
  assert.deepEqual(inspection.map(item => item.caseDigest), expectedCaseDigests);

  for (const [caseIndex, row] of sourceCases.entries()) {
    const plan = prepareMixedSourceCase(row, comparisonProfile);
    const probe = sourceProbes[caseIndex];
    assert.equal(row.history.sessions.length, 16);
    assert.ok(row.history.sessions.every(session => session.turns.length === 2));
    assert.equal(row.history.sessions[0].date, '2025/01/06 (Mon) 09:00');
    assert.equal(row.history.sessions[15].date, '2025/04/21 (Mon) 09:00');
    assert.equal(row.question.date, '2025/04/22 (Tue) 10:00');
    assert.equal(row.history.sessions[intendedTurns[caseIndex][0]]
      .turns[intendedTurns[caseIndex][1]].content, originalReasonStatements[caseIndex]);
    assert.ok(row.history.sessions.flatMap(session => session.turns)
      .some(turn => turn.content === laterStatusStatements[caseIndex]));
    assert.ok(probe.routingCue.length <= 200);
    const matches = plan.cairnPlan.batches.flatMap(batch => batch.indexedWindows
      .filter(window => window.content.includes(probe.routingCue))
      .map(window => [batch.batchIndex, window.index]));
    assert.deepEqual(matches, [[probe.batchIndex, probe.windowIndex]]);
    const origin = plan.originMap.windows.find(window => window.batchIndex === probe.batchIndex
      && window.windowIndex === probe.windowIndex);
    const turn = plan.originMap.turns.find(item => item.renderedTurnId === origin.renderedTurnId);
    assert.deepEqual([turn.originalSessionIndex, turn.originalTurnIndex], intendedTurns[caseIndex]);
    assert.deepEqual(plan.cairnPlan.batches.map(batch => batch.indexedWindows.length),
      Array(16).fill(2));
    assert.equal(plan.mem0Input.batches.length, 16);
    assert.ok(row.history.sessions.flatMap(session => session.turns)
      .every(item => item.content.length < 500));
  }
  assert.deepEqual(readdirSync(workspace.path), []);
});

test('L2/L6 source-only preflight binds shared-source-v2 and dispatches nothing', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-selection-localization-preflight-' });
  const originalFetch = globalThis.fetch;
  let attempted = 0;
  globalThis.fetch = () => { attempted++; throw new Error('unexpected_network'); };
  try {
    const sourceImport = await import('./selection-localization-source-cases.mjs?offline=1');
    assert.equal(sourceImport.sourceCases.length, 3);
    const imported = await import('./selection-localization-prepare.mjs?offline=1');
    assert.equal(imported.sourceObservationMode, 'shared-source-v2');
    const first = prepareSelectionLocalizationComparison(fakeDescriptors());
    const second = prepareSelectionLocalizationComparison(fakeDescriptors());
    assert.deepEqual(first, second);
    assert.ok(Object.isFrozen(first));
    assert.equal(first.schemaVersion, 'cairn-lme-mixed-indexed-evidence-preparation-v1');
    assert.equal(first.counts.fixedN, 3);
    assert.deepEqual(first.counts.batchCounts, [16, 16, 16]);
    assert.ok(first.preflight.every(row => row.status === 'ready' && row.reason === null));
    assert.deepEqual(first.roster.map(row => row.armOrder), armOrders);
    assert.deepEqual(first.preflight.map(row => row.caseDigest), expectedCaseDigests);
    assert.equal(first.manifest.cairn.comparisonProfile, comparisonProfile);
    assert.equal(first.manifest.contextProtocolSha256,
      '0ce8dec010e1dcade893f6fcacb5db7d736e806241bd7afbc9fb5026135ab56b');
    assert.deepEqual(first.roster.map(row => row.protocolDigest), [
      '17a0132f7c65f359abd8e0156dab555488e9e7fd3d789564d844a1ce5ed87b9b',
      '7a4822aa1a7e78421251fa3d8f5ee0b7450b73e523cd278decb7a9beba024227',
      'dc09c23b1c2aebf219fc310432ea3ae9278fd1c0f278a6a5cffe4be1e3b556a4',
    ]);
    const v1 = prepareMixedComparison({ sourceCases, armOrders, sourceProbes,
      comparisonProfile, ...fakeDescriptors() });
    assert.notEqual(v1.manifest.contextProtocolSha256, first.manifest.contextProtocolSha256);
    assert.notEqual(v1.roster[0].protocolDigest, first.roster[0].protocolDigest);
    const moved = sourceProbes.map((probe, index) => index === 0
      ? { ...probe, routingCue: 'For Beacon H7' } : probe);
    const changed = prepareMixedComparison({ sourceCases, armOrders, sourceProbes: moved,
      comparisonProfile, sourceObservationMode, ...fakeDescriptors() });
    assert.notEqual(changed.roster[0].protocolDigest, first.roster[0].protocolDigest);
    assert.deepEqual(changed.preflight.map(row => row.caseDigest), expectedCaseDigests);
    assert.equal(attempted, 0);
    assert.deepEqual(readdirSync(workspace.path), []);
  } finally { globalThis.fetch = originalFetch; }
});

test('L2/L6 evaluator rows and manual rubric stay outside source-only preparation', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-selection-localization-evaluator-' });
  const preflightSource = readFileSync(new URL('./selection-localization-prepare.mjs', import.meta.url), 'utf8');
  const casesSource = readFileSync(new URL('./selection-localization-source-cases.mjs', import.meta.url), 'utf8');
  assert.equal(preflightSource.includes('selection-localization-evaluator.mjs'), false);
  assert.equal(casesSource.includes('selection-localization-evaluator.mjs'), false);
  const sourceBytes = JSON.stringify({ sourceCases, armOrders, sourceProbes });
  for (const field of ['reference_answer', 'question_type', 'answer_session_ids',
    'turn_labels', 'supportedFacts', 'forbiddenInferences']) {
    assert.equal(sourceBytes.includes(field), false, field);
  }
  const { evaluatorRows, rubric } = await import('./selection-localization-evaluator.mjs');
  assert.equal(evaluatorRows.length, 3);
  assert.equal(rubric.length, 3);
  assert.deepEqual(evaluatorRows.map(row => row.question_type),
    ['knowledge-update', 'knowledge-update', 'knowledge-update']);
  assert.deepEqual(evaluatorRows.map(row => row.question_id), expectedQuestionIds);
  assert.deepEqual(evaluatorRows.map(row => row.source_question_id), [
    'fresh_harbor_beacon_h7_v1', 'fresh_community_pantry_tokens_v1',
    'fresh_ridge_shuttle_last_trip_v1',
  ]);
  assert.equal(sha256({ evaluatorRows, rubric }),
    'fbefa9ed3e06adc1d3ec677ebba0ae637e6899c9a20679e85a61b540ca5ac868');
  assert.deepEqual(rubric.map(sha256), [
    'cd460c3ff95fecbacb0d049dcfa51daf01db52484158a68c0f8c849ee14796d2',
    '04ac93d576f15b04d3b9af27d44f84442a66d99c32881ace4484ba064b5ce735',
    '0d150a59e1060c98dbd2a40838abeb1cc8bfda7f4122da12b30564ac51873351',
  ]);
  for (const [index, row] of evaluatorRows.entries()) {
    assert.ok(row.reference_answer.length > 0);
    assert.equal(row.turn_labels.length, 3);
    assert.ok(row.turn_labels.every(label => label.has_answer));
    assert.equal(row.answer_session_ids.length, 3);
    assert.ok(rubric[index].supportedFacts.length > 0);
    assert.ok(rubric[index].forbiddenInferences.length > 0);
    const knownTurnIds = new Set(sourceCases[index].history.sessions
      .flatMap(session => session.turns.map(turn => turn.turn_id)));
    assert.ok(row.turn_labels.every(label => knownTurnIds.has(label.turn_id)));
  }
  assert.deepEqual(readdirSync(workspace.path), []);
});
