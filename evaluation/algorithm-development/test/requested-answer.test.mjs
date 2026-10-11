import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, mkdirSync, copyFileSync, cpSync, chmodSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash, randomUUID } from 'node:crypto';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { loadDevelopmentFreeze } from '../corpus.mjs';
import { loadRequestedAnswerFreeze, compileRequestedAnswerRubric, REQUESTED_ANSWER_PROTOCOL,
  buildBlindRequestedAnswerPacket, aggregateRequestedAnswerJudgments } from '../requested-answer.mjs';
import { scoreRequestedAnswerCoverage, scoreDevelopmentCoverage } from '../coverage.mjs';
import { prepareAlgorithmDevelopmentCase } from '../runner.mjs';
import { launchAlgorithmDevelopment, launchRequestedAnswerComparison } from '../launch.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade,
  upgradeExperimentBudgetForEmbeddings } from '../../experiment-budget/index.mjs';
import { verifiedEvidence } from '../../longmemeval/mixed-evidence.mjs';
import { packMixedAnswer } from '../../longmemeval/mixed-answer.mjs';

const original = await loadDevelopmentFreeze(), prospective = await loadRequestedAnswerFreeze();
const identity = { schemaVersion: 'source-diverse-requested-answer-comparison-v1', treatment: 'source-diverse-v1',
  armPolicies: { baseline: 'ordinary-v1', full: 'source-diverse-v1' }, fatal: null };

test('QA rubric has 24 detached immutable calibration sets and exactly original 42 anchors/safety/source sets', async () => {
  assert.equal(prospective.version, 'algorithm-development-requested-answer-v2');
  assert.equal(prospective.hashes.modelInputs, original.hashes.modelInputs);
  assert.equal(prospective.hashes.originalRubric, original.hashes.evaluatorRubric);
  let anchors = 0;
  for (const { id } of original.modelInputs) {
    const old = original.evaluatorRubric.cases[id], compiled = prospective.evaluatorRubric.cases[id], qa = prospective.qaRubric.cases[id];
    for (const field of Object.keys(old).filter(field => field !== 'requiredPropositions')) assert.deepEqual(compiled[field], old[field]);
    assert.deepEqual(compiled.requiredPropositions, qa.requiredPropositions);
    assert.equal(Object.keys(qa.examples).length, 3); assert.equal(new Set(Object.values(qa.examples)).size, 3);
    assert(!Object.hasOwn(compiled, 'examples') && !Object.hasOwn(compiled, 'optionalBackground'));
    anchors += compiled.anchors.length;
  }
  assert.equal(anchors, 42); assert(Object.isFrozen(prospective.qaRubric.cases.D01.examples));
  assert.throws(() => { prospective.qaRubric.cases.D01.examples.conciseCorrect = 'mutated'; }, TypeError);
  const qaRubric = structuredClone(prospective.qaRubric), compiled = compileRequestedAnswerRubric({
    modelInputs: original.modelInputs, originalRubric: original.evaluatorRubric, qaRubric });
  qaRubric.cases.D01.requiredPropositions[0] = 'Caller mutation';
  assert.deepEqual(compiled.hashes, prospective.hashes);
  for (const mutate of [qa => { qa.version = 'old'; }, qa => { delete qa.cases.D24; },
    qa => { qa.cases.D01.anchors = []; }, qa => { qa.cases.D01.requiredPropositions = []; },
    qa => { qa.cases.D01.examples.incorrect = qa.cases.D01.examples.conciseCorrect; }]) {
    const value = structuredClone(prospective.qaRubric); mutate(value);
    assert.throws(() => compileRequestedAnswerRubric({ modelInputs: original.modelInputs,
      originalRubric: original.evaluatorRubric, qaRubric: value }));
  }
  assert.deepEqual((await loadDevelopmentFreeze()).hashes, original.hashes);
});

test('requested propositions keep both D20 clauses and qualifications, without mandatory unasked explanations', () => {
  assert.match(original.modelInputs[19].question.text, /and did the reminder change it/);
  assert.deepEqual(prospective.evaluatorRubric.cases.D20.requiredPropositions,
    ['Orientation starts at 09:30.', 'The reminder did not change the start time.']);
  assert.match(prospective.qaRubric.cases.D20.examples.conciseCorrect, /reminder did not change/);
  assert.match(prospective.qaRubric.cases.D06.requiredPropositions[0], /positive instruction suffices/);
  assert.match(prospective.qaRubric.cases.D22.requiredPropositions[0], /competing reports are 48 and 52/);
  for (const id of ['D01', 'D09', 'D10', 'D11', 'D13', 'D14', 'D18']) assert.equal(prospective.qaRubric.cases[id].requiredPropositions.length, 1);
  assert.match(prospective.qaRubric.cases.D02.examples.conciseCorrect, /Only after Jo checks and signs/);
  assert.match(prospective.qaRubric.cases.D04.examples.conciseCorrect, /assistant/);
  assert.match(REQUESTED_ANSWER_PROTOCOL.instructions.join('\n'), /same correctness verdict/);
  assert.match(REQUESTED_ANSWER_PROTOCOL.instructions.join('\n'), /actual packed evidence separately/);
});

function coverageFixture() {
  const source = original.modelInputs[10], { namespace, plan } = prepareAlgorithmDevelopmentCase(source);
  const details = plan.cairnPlan.batches.map((batch, index) => {
    const window = batch.indexedWindows.find(item => item.messageIndex === 0);
    return { memory: { id: `D11-source-${index}`, revision: 1, state: 'active', namespace, receiptCount: 1 },
      receipts: [{ id: `D11-receipt-${index}`, client: batch.captureInput.client, sessionId: batch.captureInput.sessionId,
        eventId: window.id, role: window.role, excerpt: window.content }], exhausted: true, nextReceiptCursor: null };
  });
  const refs = details.map(detail => ({ namespaceIndex: 0, memoryId: detail.memory.id, revision: 1 }));
  const selectInput = { query: plan.mem0Input.query, maxRefs: 24, maps: [{ namespaceIndex: 0, exhausted: true,
    items: refs.map(ref => ({ type: 'unfiled', ref: { memoryId: ref.memoryId, revision: 1 }, label: 'Original label' })) }] };
  const row = { id: source.id, family: source.family, capture: { status: 'completed', receipts: details }, arms: {} };
  for (const name of ['baseline', 'full']) {
    const chosen = name === 'full' ? details : details.slice(1);
    const recalled = { memories: chosen.map(detail => ({ memory: { id: detail.memory.id, revision: 1, currentness: 'current' },
      receipts: detail.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })), receiptCount: 1,
      interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' })) };
    const evidence = verifiedEvidence(recalled, ({ memoryId }) => ({ ok: true,
      value: details.find(detail => detail.memory.id === memoryId) }), plan, namespace);
    row.arms[name] = { name, status: 'completed', answer: 'Synthetic fixture answer only.', recalled, evidence,
      packed: packMixedAnswer({ question: source.question, units: evidence.units, countTokens: () => 0 }),
      coreInputs: [{ input: structuredClone(selectInput) }], modelCalls: [{ method: 'select', input: structuredClone(selectInput), output: { refs: [refs[1]] }, failure: null }],
      effectiveSelections: [{ input: structuredClone(selectInput), output: { refs: name === 'full' ? refs : [refs[1]] }, failure: null,
        policy: name === 'full' ? 'source-diverse-v1' : 'ordinary-v1', publicReads: [], diagnostics: null }] };
  }
  return { ...identity, observations: [row] };
}

test('new coverage uses effective refs; legacy keeps raw refs and missing successful traces reject', () => {
  const report = coverageFixture(), options = { modelInputs: original.modelInputs, evaluatorRubric: prospective.evaluatorRubric };
  const next = scoreRequestedAnswerCoverage({ report, ...options });
  const old = scoreDevelopmentCoverage({ observations: report.observations, ...options });
  const nextD11 = next.cases.find(row => row.id === 'D11'), oldD11 = old.cases.find(row => row.id === 'D11');
  assert.equal(nextD11.anchors[0].statuses.full.selected, 'present');
  assert.equal(oldD11.anchors[0].statuses.full.selected, 'absent');
  assert.equal(next.anchorDenominator, 42); assert.equal(next.gain, 1);
  for (const mutate of [value => { delete value.observations[0].arms.full.effectiveSelections; },
    value => { value.observations[0].arms.full.effectiveSelections = []; }, value => { value.treatment = 'full-label-v1'; },
    value => { value.observations[0].arms.full.effectiveSelections[0].input.query = 'altered'; }]) {
    const value = structuredClone(report); mutate(value);
    assert.throws(() => scoreRequestedAnswerCoverage({ report: value, ...options }));
  }
  const failed = structuredClone(report), arm = failed.observations[0].arms.full;
  arm.status = 'unresolved'; arm.modelCalls = []; arm.recalled = null; arm.evidence = null; arm.packed = null;
  arm.effectiveSelections[0].output = null; arm.effectiveSelections[0].failure = 'context_budget_exceeded';
  const result = scoreRequestedAnswerCoverage({ report: failed, ...options });
  assert.equal(result.cases.find(row => row.id === 'D11').anchors[0].statuses.full.selected, 'unknown');
  assert.equal(result.aggregates.full.selected.denominator, 42);
});

test('blind packet separates non-scoring calibration; old reports cannot use new protocol or gate', () => {
  const report = coverageFixture(), { packet, mapping } = buildBlindRequestedAnswerPacket({ report, freeze: prospective });
  assert.equal(packet.items.length, 2); assert.equal(packet.protocol.version, REQUESTED_ANSWER_PROTOCOL.version);
  for (const item of packet.items) {
    assert(!Object.hasOwn(item, 'arm') && !Object.hasOwn(item, 'id'));
    assert.deepEqual(Object.keys(item.nonScoringCalibration).sort(), ['examples', 'optionalBackground']);
    assert.deepEqual(item.nonScoringCalibration.examples, prospective.qaRubric.cases.D11.examples);
    assert.deepEqual(item.rubric.anchors, original.evaluatorRubric.cases.D11.anchors);
    assert.equal(item.nonScoringCalibration.optionalBackground.length, 1);
  }
  assert.equal(mapping.length, 2);
  const coverage = scoreRequestedAnswerCoverage({ report, modelInputs: original.modelInputs, evaluatorRubric: prospective.evaluatorRubric });
  const result = aggregateRequestedAnswerJudgments({ report, judgmentsA: [], judgmentsB: [], coverage, resourcesWithinLimits: true });
  assert.equal(result.denominator, 24); assert.equal(result.outcomesDenominator, 48); assert.equal(result.advances, false);
  assert.equal(result.safety.unknown, true);
  assert.throws(() => buildBlindRequestedAnswerPacket({ report: { ...report, schemaVersion: 'algorithm-development-comparison-v1' }, freeze: prospective }));
});

test('prospective development gate requires paired QA gain, packed gain, clean safety and explicit resource acceptance', () => {
  // Handcrafted aggregation controls, not semantic judgments of model answers.
  const report = { ...identity, observations: original.modelInputs.map(source => ({ id: source.id, family: source.family,
    capture: { status: 'completed' }, arms: Object.fromEntries(['baseline', 'full'].map(name => [name,
      { name, status: 'completed', answer: 'Synthetic aggregate control.' }])) })) };
  const judgments = original.modelInputs.flatMap((source, index) => ['baseline', 'full'].map(arm => ({ id: source.id, arm,
    verdict: arm === 'baseline' && index < 3 ? 'incorrect' : 'correct', reviewedClaims: 1, unsupportedClaims: 0,
    staleClaims: 0, severeError: false, rationale: 'Handcrafted agreement-only gate control.' })));
  const coverage = { schemaVersion: 'source-diverse-requested-answer-coverage-v1', gain: 1 };
  const options = { report, judgmentsA: judgments, judgmentsB: structuredClone(judgments), coverage, resourcesWithinLimits: true };
  const passed = aggregateRequestedAnswerJudgments(options);
  assert.equal(passed.advances, true); assert.equal(passed.paired.netCorrect, 3);
  assert.equal(passed.families['detail-retention'].baseline.denominator, 4);
  assert.equal(aggregateRequestedAnswerJudgments({ ...options, resourcesWithinLimits: false }).advances, false);
  assert.equal(aggregateRequestedAnswerJudgments({ ...options, coverage: { ...coverage, gain: 0 } }).advances, false);
  for (const mutation of [rows => { rows[1].severeError = true; }, rows => { rows[1].unsupportedClaims = 1; },
    rows => { rows[1].staleClaims = 1; }, rows => { rows[1].severeError = null; }]) {
    const rows = structuredClone(judgments); mutation(rows);
    assert.equal(aggregateRequestedAnswerJudgments({ ...options, judgmentsA: rows, judgmentsB: structuredClone(rows) }).advances, false);
  }
  const disagree = structuredClone(judgments); disagree[1].verdict = 'incorrect';
  const unresolved = aggregateRequestedAnswerJudgments({ ...options, judgmentsB: disagree });
  assert.equal(unresolved.preAdjudication.disagreements, 1); assert.equal(unresolved.advances, false);
});

test('wrong launch/rubric/treatment versions reject before key lookup or budget access', async () => {
  let keys = 0;
  for (const manifest of [{ version: 'algorithm-development-launch-v1' },
    { version: 'source-diverse-requested-answer-launch-v1', treatment: 'full-label-v1', rubricVersion: prospective.version },
    { version: 'source-diverse-requested-answer-launch-v1', treatment: 'source-diverse-v1', rubricVersion: 'old' }]) {
    await assert.rejects(() => launchRequestedAnswerComparison({ configuration: {}, manifest,
      keyProvider: () => { keys++; }, fetchImpl: () => assert.fail('No HTTP') }), { code: 'manifest_mismatch' });
  }
  await assert.rejects(() => launchAlgorithmDevelopment({ manifest: { version: 'algorithm-development-launch-v1', treatment: 'source-diverse-v1' },
    keyProvider: () => { keys++; }, fetchImpl: () => assert.fail('No HTTP') }), { code: 'manifest_mismatch' });
  assert.equal(keys, 0);
});

test('owned clean synthetic checkout freezes distinct manifests and retains one-shot closure on key failure', async context => {
  const workspace = createTestWorkspace(null, { prefix: 'cairn-requested-answer-launch-' });
  try {
    const root = fileURLToPath(new URL('../../../', import.meta.url)), checkout = join(workspace.path, 'runtime'); mkdirSync(checkout);
    const archive = execFileSync('/usr/bin/git', ['archive', 'HEAD'], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
    execFileSync('/usr/bin/tar', ['-x', '-C', checkout], { input: archive });
    assert.equal(existsSync(join(checkout, 'node_modules')), false, 'Source-only checkout has no root dependency install');
    const overlay = ['runner.mjs', 'launch.mjs', 'coverage.mjs', 'requested-answer.mjs', 'qa-rubric-v2.json',
      'test/requested-answer.test.mjs', 'test/requested-answer-runner.test.mjs'];
    for (const file of overlay) copyFileSync(new URL(`../${file}`, import.meta.url), join(checkout, 'evaluation/algorithm-development', file));
    copyFileSync(join(root, 'docs/plans/source-diverse-qa24.md'), join(checkout, 'docs/plans/source-diverse-qa24.md'));
    cpSync(join(root, 'adapters/openai/node_modules'), join(checkout, 'adapters/openai/node_modules'), { recursive: true });
    const git = args => execFileSync('/usr/bin/git', ['-C', checkout, ...args], { stdio: 'ignore',
      env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Synthetic fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Synthetic fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
    git(['init']); git(['add', '--all']); git(['commit', '-m', 'Synthetic owned launch fixture']);
    const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(), limitMicroUsd: 400_000_000, requestCap: 100_000 };
    createExperimentBudget(configuration).close();
    const before = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
    upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, expectedHistorySha256: before.historySha256 });
    const module = await import(pathToFileURL(join(checkout, 'evaluation/algorithm-development/launch.mjs')));
    const old = await module.prepareAlgorithmDevelopment({ configuration }), next = await module.prepareRequestedAnswerComparison({ configuration });
    assert.equal(old.version, 'algorithm-development-launch-v1'); assert.equal(Object.hasOwn(old, 'treatment'), false);
    assert.equal(next.treatment, 'source-diverse-v1'); assert.equal(next.corpusHashes.qaRubric, prospective.hashes.qaRubric);
    assert.equal(next.requestMaximum, 1968); assert.equal(next.reservationMaximumMicroUsd, 10_000_000);
    assert.equal(next.protectedMicroUsd, 30_000_000); assert.equal(next.checkpoint.requestCount, 0);
    assert.equal(next.campaign.runId, configuration.runId); assert.equal(next.campaign.schemaVersion, 2);
    assert.equal(next.campaign.requestCap, configuration.requestCap);
    assert.equal(next.campaign.configurationSha256, createHash('sha256').update(JSON.stringify(configuration)).digest('hex'));
    assert(next.artifactHashes['test/requested-answer-runner.test.mjs']);
    let keys = 0;
    for (const [manifest, launch] of [[old, module.launchAlgorithmDevelopment], [next, module.launchRequestedAnswerComparison]]) {
      const directory = join(workspace.path, `output-${manifest.version}`); mkdirSync(directory, { mode: 0o700 });
      const options = { configuration, manifest, outputDirectory: directory,
        keyProvider: () => { keys++; throw new Error('Synthetic key lookup failure'); }, fetchImpl: () => assert.fail('No HTTP') };
      const wrong = structuredClone(manifest); wrong.nodeSha256 = '0'.repeat(64);
      await assert.rejects(() => launch({ ...options, manifest: wrong }), { code: 'manifest_mismatch' });
      if (manifest === next) {
        const foreign = structuredClone(manifest); foreign.campaign.runId = randomUUID();
        await assert.rejects(() => launch({ ...options, manifest: foreign }), { code: 'manifest_mismatch' });
        const otherDirectory = join(workspace.path, 'copied-synthetic-ledger');
        cpSync(configuration.directory, otherDirectory, { recursive: true });
        chmodSync(otherDirectory, 0o700);
        await assert.rejects(() => launch({ ...options, configuration: { ...configuration, directory: otherDirectory } }), { code: 'manifest_mismatch' });
      }
      assert.equal(existsSync(join(directory, 'started.json')), false);
      await assert.rejects(() => launch(options), /Synthetic key lookup failure/);
      assert.equal(existsSync(join(directory, 'started.json')), true);
      assert.equal(JSON.parse(readFileSync(join(directory, 'closed.json'))).completed, false);
      await assert.rejects(() => launch(options), { code: 'EEXIST' });
    }
    assert.equal(keys, 2); context.diagnostic('Only fresh owned fixture Git/checkpoint/output; no operational artifacts or credential lookup.');
  } finally { await workspace.cleanup(); assert.equal(existsSync(workspace.path), false); }
});
