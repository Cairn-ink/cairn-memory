import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, readdirSync } from 'node:fs';
import test from 'node:test';

import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { prepareMixedComparison } from '../longmemeval/mixed-generation.mjs';
import { prepareMixedSourceCase } from '../longmemeval/mixed-source.mjs';
import { comparisonProfile, inspectLocalizationSources,
  prepareLocalizationComparison } from './localization-prepare.mjs';
import { armOrders, sourceCases, sourceProbes } from './localization-source-cases.mjs';

const sha256 = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const fakeDescriptors = () => ({
  nativeArtifact: { sourceTreeSha256: '1'.repeat(64), dependencyLockSha256: '2'.repeat(64) },
  nativeConfiguration: { configurationSha256: '3'.repeat(64), configuration: {} },
  cairnRuntimeArtifactSha256: '4'.repeat(64),
});

const expectedQuestionIds = [
  'lme-case-a553210df0b6fe09f7563b48d9971a7aa8e07f42edef37c3e178e182c3a2a0b1',
  'lme-case-a98500a7288edb6444396bf92f6f49026a1107791dd90dd3cb245644b6d41f05',
  'lme-case-23fb62cb63275b92f1fc6d7d23e3622d5cc2a7991c227d5c6825fb54c0fbca45',
  'lme-case-1652c0214d7cc6a03308a29f7bfd855dedb959fd94a21a18415550a944d3e83d',
];
const expectedHistoryDigests = [
  '1009f6f965d0904eb5a9bbdf5e157cd917975dc8b9a8f7858929a1a62bed2318',
  '182dfe8360d2903554f8ea6add3f281aaa4415b3c4942f83da7bc52c0c9b9d3e',
  '69093e086d378353cb3a6b43372da5f306a03d0bf5b4843be83c5c73badf88e7',
  '51d337693fd6ae8cf0c643bb6922f0499f98ea4a7600121176e7a518d750df38',
];
const expectedCaseDigests = [
  'd3dca41a5db2d1ebee527460c2a13d814efec52018044ded2cfc1975fb9bb8cb',
  '60203272182bbf9031e18d0b97dae5b8bbb90bfd445a0517c9835d45d965d375',
  'cf5fa489c40b78c62429508d27d57568a103e91abec6e71dbc934a131db7b2cb',
  'bf88ff18649f26b997dda11cbb107e77c21b6bedbc9a9d2ba3c19d918fdf6ef9',
];
const expectedQuestionHashes = [
  '6dc119e09b45eeef5be3ab3e48d1bece0bf0f34dfd08f069bc5d8c637e226c61',
  'df40576d3dac50dc8fe94bde6c38b4ac44bdf61a32fcc5f35ad7e8b0f54c3a17',
  '33ae5fe3304951d1b4c2c8304e87e96863f25c992c704bd672d3f2b573aea91e',
  '7c200580ba09f9fb34f75927bb9a29657a1e1e653391d0b2a46bda8454cd1c46',
];
const expectedWindowPositions = [
  { batchIndex: 0, windowIndex: 4, messageIndex: 3, startUtf16: 800, endUtf16: 1600 },
  { batchIndex: 3, windowIndex: 4, messageIndex: 4, startUtf16: 0, endUtf16: 303 },
  { batchIndex: 2, windowIndex: 7, messageIndex: 7, startUtf16: 0, endUtf16: 290 },
  { batchIndex: 1, windowIndex: 6, messageIndex: 6, startUtf16: 0, endUtf16: 109 },
];
const intendedTurns = [[0, 3], [3, 4], [2, 7], [1, 6]];

test('F1/F2 frozen fresh histories resolve one intended canonical source window each', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-localization-source-' });
  assert.equal(comparisonProfile, 'indexed-evidence-v1');
  assert.equal(sourceCases.length, 4);
  assert.deepEqual(armOrders, [['cairn', 'mem0'], ['mem0', 'cairn'],
    ['cairn', 'mem0'], ['mem0', 'cairn']]);
  assert.deepEqual(sourceCases.map(row => row.question.question_id), expectedQuestionIds);
  assert.equal(new Set(expectedQuestionIds).size, 4);
  assert.ok(sourceCases[3].question.text.includes('哪一天已確認開幕'));
  assert.equal(sha256({ sourceCases, armOrders, sourceProbes }),
    '55d2e068008ca5a5d08071d9364ff5031d10c193c0b5e5751603195aae7810e1');
  assert.deepEqual(sourceCases.map(row => sha256(row.question)), expectedQuestionHashes);
  assert.ok(Object.isFrozen(sourceCases) && sourceCases.every(Object.isFrozen));
  assert.ok(Object.isFrozen(sourceProbes) && sourceProbes.every(Object.isFrozen));

  const inspection = inspectLocalizationSources();
  assert.ok(Object.isFrozen(inspection) && inspection.every(Object.isFrozen));
  assert.deepEqual(inspection.map(item => item.originalMessages), [60, 60, 60, 60]);
  assert.deepEqual(inspection.map(item => item.renderedMessages), [60, 60, 60, 60]);
  assert.deepEqual(inspection.map(item => item.batches), [4, 4, 4, 4]);
  assert.ok(inspection.every(item => item.batches >= 3 && item.batches <= 8));
  assert.deepEqual(inspection.map(item => item.longestOriginalMessageUtf16),
    [1798, 239, 226, 58]);
  assert.ok(inspection[0].longestOriginalMessageUtf16 > 1600);
  assert.deepEqual(inspection.map(item => item.selectedWindow), expectedWindowPositions);
  assert.deepEqual(inspection.map(item => item.originalHistoryDigest), expectedHistoryDigests);
  assert.deepEqual(inspection.map(item => item.caseDigest), expectedCaseDigests);

  for (const [caseIndex, row] of sourceCases.entries()) {
    const plan = prepareMixedSourceCase(row, comparisonProfile);
    const probe = sourceProbes[caseIndex];
    assert.equal(probe.batchIndex, expectedWindowPositions[caseIndex].batchIndex);
    assert.equal(probe.windowIndex, expectedWindowPositions[caseIndex].windowIndex);
    assert.ok(probe.routingCue.length <= 200);
    const matches = plan.cairnPlan.batches.flatMap(batch => batch.indexedWindows
      .filter(window => window.content.includes(probe.routingCue))
      .map(window => [batch.batchIndex, window.index]));
    assert.deepEqual(matches, [[probe.batchIndex, probe.windowIndex]]);
    const origin = plan.originMap.windows.find(window => window.batchIndex === probe.batchIndex
      && window.windowIndex === probe.windowIndex);
    const turn = plan.originMap.turns.find(item => item.renderedTurnId === origin.renderedTurnId);
    assert.deepEqual([turn.originalSessionIndex, turn.originalTurnIndex], intendedTurns[caseIndex]);
    assert.ok(row.history.sessions[intendedTurns[caseIndex][0]]
      .turns[intendedTurns[caseIndex][1]].content.includes(probe.routingCue));
    assert.equal(plan.cairnPlan.batches.length, plan.mem0Input.batches.length);
    assert.ok(plan.cairnPlan.batches.every(batch => batch.indexedWindows.length > 0));
  }
  const longOriginal = sourceCases[0].history.sessions[0].turns[3].content;
  assert.equal(longOriginal.indexOf(sourceProbes[0].routingCue) > 800, true);
  assert.deepEqual(readdirSync(workspace.path), []);
});

test('F2/F3 source-only preparation binds fixed probes and needs no network', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-localization-preflight-' });
  const originalFetch = globalThis.fetch;
  let attempted = 0;
  globalThis.fetch = () => { attempted++; throw new Error('unexpected_network'); };
  try {
    const first = prepareLocalizationComparison(fakeDescriptors());
    const second = prepareLocalizationComparison(fakeDescriptors());
    assert.deepEqual(first, second);
    assert.ok(Object.isFrozen(first));
    assert.equal(first.schemaVersion, 'cairn-lme-mixed-indexed-evidence-preparation-v1');
    assert.equal(first.counts.fixedN, 4);
    assert.deepEqual(first.counts.batchCounts, [4, 4, 4, 4]);
    assert.ok(first.preflight.every(row => row.status === 'ready' && row.reason === null));
    assert.deepEqual(first.roster.map(row => row.armOrder), armOrders);
    assert.deepEqual(first.preflight.map(row => row.caseDigest), expectedCaseDigests);
    assert.equal(first.manifest.cairn.comparisonProfile, comparisonProfile);
    assert.equal(first.manifest.contextProtocolSha256,
      '3367cc11483d8ac7e2d488fabbb1b3e069852c4e716bbc4920dcdb849bc44c53');
    assert.deepEqual(first.roster.map(row => row.protocolDigest), [
      '63c0d197dcdb7b493f0e19718a85864d3e25047c98c458485686ea4a1718d7e3',
      '671a7cc62f3afbff1f4e10ccb843b5008a1cb4c9c47cefbaa17345e517055d98',
      '81fc2872324bd76dadbf7ae79004059e49ceeeb94f3611c986a202332c8e2cbf',
      '22de2ba6644bc276dadbaaecd0389da79a111b6970958cd50da72c2f3160144f',
    ]);
    const moved = sourceProbes.map((probe, index) => index === 0
      ? { ...probe, routingCue: 'For the east hatch' } : probe);
    const changed = prepareMixedComparison({ sourceCases, armOrders, sourceProbes: moved,
      comparisonProfile, ...fakeDescriptors() });
    assert.notEqual(changed.roster[0].protocolDigest, first.roster[0].protocolDigest);
    assert.deepEqual(changed.preflight.map(row => row.caseDigest), expectedCaseDigests);
    assert.equal(attempted, 0);
    assert.deepEqual(readdirSync(workspace.path), []);
  } finally { globalThis.fetch = originalFetch; }
});

test('F2/F6 evaluator data and manual rubric are isolated from source-only entrypoint', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-localization-evaluator-' });
  const preflightSource = readFileSync(new URL('./localization-prepare.mjs', import.meta.url), 'utf8');
  const casesSource = readFileSync(new URL('./localization-source-cases.mjs', import.meta.url), 'utf8');
  assert.equal(preflightSource.includes('localization-evaluator.mjs'), false);
  assert.equal(casesSource.includes('localization-evaluator.mjs'), false);
  const sourceBytes = JSON.stringify({ sourceCases, armOrders, sourceProbes });
  for (const field of ['reference_answer', 'question_type', 'answer_session_ids',
    'turn_labels', 'supportedFacts', 'forbiddenInferences']) {
    assert.equal(sourceBytes.includes(field), false, field);
  }
  const { evaluatorRows, rubric } = await import('./localization-evaluator.mjs');
  assert.equal(evaluatorRows.length, 4);
  assert.equal(rubric.length, 4);
  assert.deepEqual(evaluatorRows.map(row => row.question_type),
    ['single-session-user', 'knowledge-update', 'knowledge-update', 'multi-session']);
  assert.deepEqual(evaluatorRows.map(row => row.question_id), expectedQuestionIds);
  assert.deepEqual(evaluatorRows.map(row => row.source_question_id), [
    'fresh_observatory_hatch_v1', 'fresh_bookmobile_checkin_v1',
    'fresh_field_recorder_v1', 'fresh_river_photo_show_v1',
  ]);
  assert.equal(sha256({ evaluatorRows, rubric }),
    '41ca7a6049372ef53d5a6267e7c34a567b2cb7a5e60ac8fe2bfba40140c826da');
  assert.deepEqual(rubric.map(sha256), [
    'd78d97a96e522534a65ee766537a9c73e3d646033c63f25d130827f30bd30369',
    'c63e20bde9f64e5f613d064c6f65a792f547d2c76885d3357b78932fb7f94ded',
    '9b1ffb15fb79ccb357104c22b9cb7398667fe13ed510bdedc867d48009a5dd18',
    '0e114c81359f88c98dd3c990fc1870e670bbbc4be2cbec8b9df9e98047cda62e',
  ]);
  for (const [index, row] of evaluatorRows.entries()) {
    assert.equal(typeof row.reference_answer, 'string');
    assert.ok(row.reference_answer.length > 0);
    assert.ok(row.answer_session_ids.length > 0);
    assert.ok(row.turn_labels.every(label => label.has_answer));
    assert.ok(rubric[index].supportedFacts.length > 0);
    assert.ok(rubric[index].forbiddenInferences.length > 0);
  }
  assert.deepEqual(readdirSync(workspace.path), []);
});
