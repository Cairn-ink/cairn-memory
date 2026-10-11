import assert from 'node:assert/strict';
import test from 'node:test';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { countOpenAITokens } from '../../../adapters/openai/index.mjs';
import { assembleSourceDiverseSelection } from '../../architecture/source-diverse-selection-model.mjs';
import { assembleSourceLinkedEvidence } from '../../architecture/source-linked-evidence-model.mjs';
import { verifiedRoleEvidence } from '../../longmemeval/mixed-evidence.mjs';
import { packMixedAnswer } from '../../longmemeval/mixed-answer.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade,
  upgradeExperimentBudgetForEmbeddings } from '../../experiment-budget/index.mjs';
import { hashCanonicalValue } from '../corpus.mjs';
import { prepareAlgorithmDevelopmentCase, runEvidenceBundleComparison } from '../runner.mjs';
import { loadRequestedAnswerFreeze, loadEvidenceBundleFreeze, REQUESTED_ANSWER_PROTOCOL,
  EVIDENCE_BUNDLE_PROTOCOL, buildBlindRequestedAnswerPacket, buildBlindEvidenceBundlePacket,
  aggregateRequestedAnswerJudgments, aggregateEvidenceBundleJudgments } from '../requested-answer.mjs';
import { scoreEvidenceBundleCoverage, scoreRequestedAnswerCoverage } from '../coverage.mjs';
import { launchRequestedAnswerComparison, launchEvidenceBundleComparison } from '../launch.mjs';

const original = await loadRequestedAnswerFreeze(), bundled = await loadEvidenceBundleFreeze();
const identity = { schemaVersion: 'source-diverse-linked-requested-answer-comparison-v1',
  treatment: 'source-diverse-linked-v1', evidenceFormat: 'source-role-evidence-v1',
  armPolicies: { baseline: 'ordinary-v1', full: 'source-diverse-linked-v1' }, fatal: null };

function fixture() {
  const source = original.modelInputs[10], { plan, namespace } = prepareAlgorithmDevelopmentCase(source);
  const details = plan.cairnPlan.batches.map((batch, index) => {
    const window = batch.indexedWindows[0];
    return { memory: { id: `bundle-memory-${index}`, revision: 1, state: 'active',
      content: 'Synthetic interpretation.', namespace, receiptCount: 1 }, receipts: [{
      id: `bundle-receipt-${index}`, client: batch.captureInput.client,
      sessionId: batch.captureInput.sessionId, eventId: window.id, role: window.role, excerpt: window.content,
    }], exhausted: true, nextReceiptCursor: null };
  });
  const refs = details.map(detail => ({ namespaceIndex: 0, memoryId: detail.memory.id, revision: 1 }));
  const selectInput = { query: plan.mem0Input.query, maxRefs: 24, maps: [{ namespaceIndex: 0, exhausted: true,
    items: refs.map(({ memoryId, revision }) => ({ type: 'unfiled', ref: { memoryId, revision }, label: 'Routing only.' })) }] };
  const reads = [1, 0].map(index => ({ input: { namespace, memoryId: refs[index].memoryId, receiptLimit: 8 },
    response: { ok: true, value: details[index] } }));
  const rawSelect = { refs: [refs[1]] };
  const compiled = assembleSourceDiverseSelection(selectInput, rawSelect, { readSet: [namespace],
    inspections: reads.map(read => ({ ref: { namespaceIndex: 0, memoryId: read.input.memoryId, revision: 1 }, response: read.response })) });
  const candidate = ref => {
    const detail = details.find(item => item.memory.id === ref.memoryId);
    return { namespaceIndex: 0, memory: { id: ref.memoryId, revision: 1, currentness: 'current' },
      receiptCount: 1, receipts: detail.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })),
      interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' };
  };
  const row = { id: source.id, family: source.family, source,
    capture: { status: 'completed', receipts: details }, arms: {} };
  for (const name of ['baseline', 'full']) {
    const policy = name === 'full' ? identity.treatment : 'ordinary-v1';
    const selected = name === 'full' ? compiled.output : rawSelect;
    const rankInput = { query: plan.mem0Input.query, limit: 6, candidates: selected.refs.map(candidate) };
    const rawRank = { refs: [refs[1]] };
    const ranked = name === 'full' ? assembleSourceLinkedEvidence(rankInput, rawRank) : { output: rawRank, diagnostics: null };
    const recalled = { memories: ranked.output.refs.map(ref => {
      const { namespaceIndex, ...item } = candidate(ref); return item;
    }) };
    const evidence = verifiedRoleEvidence(recalled, ({ memoryId }) => ({ ok: true,
      value: details.find(detail => detail.memory.id === memoryId) }), plan, namespace);
    row.arms[name] = { name, status: 'completed', answer: 'Synthetic answer control.', recalled, evidence,
      packed: packMixedAnswer({ question: source.question, units: evidence.units, countTokens: countOpenAITokens }),
      coreInputs: [{ input: selectInput, system: 'original select instruction', maxOutputTokens: 1024 }],
      modelCalls: [{ method: 'select', input: selectInput, system: 'original select instruction', maxOutputTokens: 1024,
        output: rawSelect, failure: null }, { method: 'rank', input: rankInput, system: 'original rank instruction',
        maxOutputTokens: 1024, output: rawRank, failure: null }],
      effectiveSelections: [{ policy, input: selectInput, system: 'original select instruction', maxOutputTokens: 1024,
        output: selected, failure: null, publicReads: name === 'full' ? [...reads, ...reads] : [],
        diagnostics: name === 'full' ? compiled.diagnostics : null }],
      effectiveRanks: [{ policy, input: rankInput, system: 'original rank instruction', maxOutputTokens: 1024,
        output: ranked.output, failure: null, diagnostics: ranked.diagnostics,
        addedRefs: ranked.output.refs.filter(ref => ref.memoryId !== refs[1].memoryId), displacedRefs: [] }] };
  }
  return JSON.parse(JSON.stringify({ ...identity, observations: [row] }));
}
const coverage = report => scoreEvidenceBundleCoverage({ report, modelInputs: original.modelInputs, evaluatorRubric: original.evaluatorRubric });

test('B1/B2/B8 new protocol differs only in version; all original rubric/hash identities remain frozen', () => {
  assert.deepEqual({ ...EVIDENCE_BUNDLE_PROTOCOL, version: REQUESTED_ANSWER_PROTOCOL.version }, REQUESTED_ANSWER_PROTOCOL);
  assert.deepEqual(bundled.originalHashes, original.hashes);
  for (const key of ['modelInputs', 'originalRubric', 'qaRubric', 'compiledRubric']) assert.equal(bundled.hashes[key], original.hashes[key]);
  assert.equal(bundled.originalHashes.judgingProtocol, hashCanonicalValue(REQUESTED_ANSWER_PROTOCOL));
  const { freeze: ignored, ...fields } = bundled.hashes;
  assert.equal(bundled.hashes.freeze, hashCanonicalValue({ version: bundled.version, ...fields, originalHashes: original.hashes }));
  assert.deepEqual(bundled.qaRubric, original.qaRubric); assert.deepEqual(bundled.evaluatorRubric, original.evaluatorRubric);
  assert.equal(typeof runEvidenceBundleComparison, 'function');
});

test('B6/B7 pure compiler reconstruction, common role evidence and exact packed request drive independent coverage', () => {
  const report = fixture(), result = coverage(report);
  assert.equal(result.schemaVersion, 'source-diverse-linked-requested-answer-coverage-v1');
  assert.equal(result.anchorDenominator, 42); assert.equal(result.gain, 1);
  const row = result.cases.find(row => row.id === 'D11');
  assert.equal(row.anchors[0].statuses.full.selected, 'present');
  assert.equal(row.anchors[0].statuses.full.recalled, 'present');
  assert.equal(row.anchors[0].statuses.full.packed, 'present');
  assert.equal(row.anchors[0].statuses.baseline.packed, 'absent');
  for (const mutate of [
    value => { delete value.observations[0].arms.full.effectiveRanks; },
    value => { delete value.observations[0].arms.full.effectiveSelections; },
    value => { value.observations[0].arms.full.effectiveRanks[0].output.refs.reverse(); },
    value => { value.observations[0].arms.full.effectiveRanks[0].addedRefs = []; },
    value => { value.observations[0].arms.full.effectiveRanks[0].input.query = 'forged'; },
    value => { value.observations[0].arms.full.effectiveSelections[0].publicReads.pop(); },
    value => { value.observations[0].arms.full.effectiveSelections[0].diagnostics = null; },
    value => { value.observations[0].arms.full.modelCalls.pop(); },
    value => { value.observations[0].arms.full.recalled.memories.reverse(); },
  ]) {
    const value = structuredClone(report); mutate(value); assert.throws(() => coverage(value));
  }
  const impossible = structuredClone(report), rawRow = impossible.observations[0], baseline = rawRow.arms.baseline;
  const unseen = rawRow.arms.full.effectiveRanks[0].input.candidates.find(candidate =>
    !baseline.effectiveRanks[0].input.candidates.some(shown => shown.memory.id === candidate.memory.id));
  const ref = { namespaceIndex: 0, memoryId: unseen.memory.id, revision: unseen.memory.revision };
  baseline.modelCalls.find(call => call.method === 'rank').output = { refs: [ref] };
  baseline.effectiveRanks[0].output = { refs: [ref] };
  const { namespaceIndex, ...memory } = unseen;
  baseline.recalled = { memories: [memory] };
  const { plan, namespace } = prepareAlgorithmDevelopmentCase(rawRow.source);
  baseline.evidence = verifiedRoleEvidence(baseline.recalled, ({ memoryId }) => ({ ok: true,
    value: rawRow.capture.receipts.find(detail => detail.memory.id === memoryId) }), plan, namespace);
  baseline.packed = packMixedAnswer({ question: rawRow.source.question, units: baseline.evidence.units, countTokens: countOpenAITokens });
  assert.throws(() => coverage(impossible), 'A consistent forged trace cannot rank a captured but nonvisible source');
  const bad = structuredClone(report), arm = bad.observations[0].arms.full;
  arm.packed.request.messages[0].content = 'forged answer instruction';
  assert.equal(coverage(bad).cases.find(row => row.id === 'D11').anchors[0].statuses.full.packed, 'unknown');
  const forged = structuredClone(report), packed = forged.observations[0].arms.full.packed;
  const body = JSON.parse(packed.request.messages[1].content); body.evidence[0].text = 'forged receipt projection';
  packed.request.messages[1].content = JSON.stringify(body);
  assert.equal(coverage(forged).cases.find(row => row.id === 'D11').anchors[0].statuses.full.packed, 'unknown');
});

test('B3/B6/B7 valid zero-memory success and pre-delegation failures remain honest coverage slots', () => {
  const report = fixture();
  report.observations[0].capture.receipts = [];
  const { namespace, plan } = prepareAlgorithmDevelopmentCase(report.observations[0].source);
  for (const [name, arm] of Object.entries(report.observations[0].arms)) {
    arm.recalled = { memories: [] }; arm.evidence = { units: [], provenance: [] };
    arm.packed = packMixedAnswer({ question: report.observations[0].source.question, units: [], countTokens: countOpenAITokens });
    const input = { query: plan.mem0Input.query, maxRefs: 24, maps: [{ namespaceIndex: 0, items: [], exhausted: true }] };
    const call = { input, system: 'original select instruction', maxOutputTokens: 1024 };
    arm.coreInputs = [structuredClone(call)];
    arm.modelCalls = [{ ...structuredClone(call), method: 'select', output: { refs: [] }, failure: null }];
    arm.effectiveRanks = [];
    arm.effectiveSelections = [{ ...structuredClone(call), policy: name === 'full' ? identity.treatment : 'ordinary-v1',
      output: { refs: [] }, failure: null, publicReads: [], diagnostics: name === 'full'
        ? assembleSourceDiverseSelection(input, { refs: [] }, { readSet: [namespace], inspections: [] }).diagnostics : null }];
  }
  assert.equal(coverage(report).aggregates.full['capture-retained'].absent, 2);
  const fabricated = structuredClone(report);
  Object.assign(fabricated.observations[0].arms.full, { coreInputs: [], modelCalls: [], effectiveSelections: [] });
  assert.throws(() => coverage(fabricated), /completed bundle/);
  const failed = fixture(), arm = failed.observations[0].arms.full;
  arm.status = 'unresolved'; arm.recalled = null; arm.evidence = null; arm.packed = null;
  arm.modelCalls = arm.modelCalls.filter(call => call.method !== 'rank');
  Object.assign(arm.effectiveRanks[0], { output: null, failure: 'context_budget_exceeded', diagnostics: null, addedRefs: [], displacedRefs: [] });
  const result = coverage(failed); assert.equal(result.aggregates.full.recalled.denominator, 42);
  assert.equal(result.cases.find(row => row.id === 'D11').anchors[0].statuses.full.recalled, 'unknown');
});

test('B2/B8 blind packet preserves calibration and rejects cross-profile report/freeze/coverage substitutions', () => {
  const report = fixture(), { packet, mapping } = buildBlindEvidenceBundlePacket({ report, freeze: bundled });
  assert.equal(packet.items.length, 2); assert.equal(mapping.length, 2);
  assert.equal(packet.protocol.version, EVIDENCE_BUNDLE_PROTOCOL.version);
  assert.deepEqual(packet.rubricIdentity, { version: original.version, hashes: original.hashes });
  for (const item of packet.items) {
    assert.equal(Object.hasOwn(item, 'id'), false); assert.equal(Object.hasOwn(item, 'arm'), false);
    assert.deepEqual(item.nonScoringCalibration.examples, original.qaRubric.cases.D11.examples);
  }
  assert.throws(() => buildBlindEvidenceBundlePacket({ report, freeze: original }));
  for (const mutate of [value => { value.hashes.compiledRubric = original.hashes.qaRubric; },
    value => { value.originalHashes.judgingProtocol = value.hashes.judgingProtocol; },
    value => { value.qaRubric.cases.D11.examples.conciseCorrect = 'altered calibration'; },
    value => { value.protocol.instructions.push('changed judgment criterion'); }]) {
    const value = structuredClone(bundled); mutate(value);
    assert.throws(() => buildBlindEvidenceBundlePacket({ report, freeze: value }));
  }
  assert.throws(() => buildBlindRequestedAnswerPacket({ report, freeze: bundled }));
  assert.throws(() => scoreRequestedAnswerCoverage({ report, modelInputs: original.modelInputs, evaluatorRubric: original.evaluatorRubric }));
  const oldReport = { ...report, schemaVersion: 'source-diverse-requested-answer-comparison-v1', treatment: 'source-diverse-v1',
    armPolicies: { baseline: 'ordinary-v1', full: 'source-diverse-v1' } };
  assert.throws(() => buildBlindEvidenceBundlePacket({ report: oldReport, freeze: bundled })); assert.throws(() => coverage(oldReport));
  assert.throws(() => aggregateEvidenceBundleJudgments({ report, judgmentsA: [], judgmentsB: [],
    coverage: { schemaVersion: 'source-diverse-requested-answer-coverage-v1', gain: 1 }, resourcesWithinLimits: true }));
  assert.throws(() => aggregateRequestedAnswerJudgments({ report, judgmentsA: [], judgmentsB: [],
    coverage: coverage(report), resourcesWithinLimits: true }));
});

test('B8 unchanged paired/safety/resource gate retains disagreements and all 24/48 slots', () => {
  const report = { ...identity, observations: original.modelInputs.map(source => ({ id: source.id, family: source.family,
    capture: { status: 'completed' }, arms: Object.fromEntries(['baseline', 'full'].map(name => [name,
      { name, status: 'completed', answer: 'Handcrafted aggregate control.' }])) })) };
  const rows = original.modelInputs.flatMap((source, index) => ['baseline', 'full'].map(arm => ({ id: source.id, arm,
    verdict: arm === 'baseline' && index < 3 ? 'incorrect' : 'correct', reviewedClaims: 1, unsupportedClaims: 0,
    staleClaims: 0, severeError: false, rationale: 'Synthetic gate agreement control, not semantic evaluation.' })));
  const options = { report, judgmentsA: rows, judgmentsB: structuredClone(rows),
    coverage: { schemaVersion: 'source-diverse-linked-requested-answer-coverage-v1', gain: 1 }, resourcesWithinLimits: true };
  const passed = aggregateEvidenceBundleJudgments(options);
  assert.equal(passed.advances, true); assert.equal(passed.denominator, 24); assert.equal(passed.outcomesDenominator, 48);
  assert.equal(passed.schemaVersion, 'source-diverse-linked-requested-answer-judgments-v1');
  assert.equal(aggregateEvidenceBundleJudgments({ ...options, resourcesWithinLimits: false }).advances, false);
  assert.equal(aggregateEvidenceBundleJudgments({ ...options, coverage: { ...options.coverage, gain: 0 } }).advances, false);
  for (const field of ['unsupportedClaims', 'staleClaims', 'severeError']) {
    const bad = structuredClone(rows); bad[1][field] = field === 'severeError' ? true : 1;
    assert.equal(aggregateEvidenceBundleJudgments({ ...options, judgmentsA: bad, judgmentsB: bad }).advances, false);
  }
  const disagreement = structuredClone(rows); disagreement[1].unsupportedClaims = 1;
  assert.equal(aggregateEvidenceBundleJudgments({ ...options, judgmentsB: disagreement }).safety.unknown, true);
});

test('B2/B9 cross-profile manifests reject before explicit key lookup or budget access', async () => {
  let keys = 0;
  const manifest = { version: 'source-diverse-linked-requested-answer-launch-v1', treatment: identity.treatment,
    rubricVersion: original.version, evidenceFormat: identity.evidenceFormat };
  const options = { configuration: {}, keyProvider: () => { keys++; }, fetchImpl: () => assert.fail('No HTTP') };
  await assert.rejects(launchRequestedAnswerComparison({ ...options, manifest }), { code: 'manifest_mismatch' });
  for (const wrong of [{ ...manifest, version: 'source-diverse-requested-answer-launch-v1' },
    { ...manifest, treatment: 'source-diverse-v1' }, { ...manifest, rubricVersion: 'changed' },
    { ...manifest, evidenceFormat: 'legacy' }]) {
    await assert.rejects(launchEvidenceBundleComparison({ ...options, manifest: wrong }), { code: 'manifest_mismatch' });
  }
  assert.equal(keys, 0);
});

test('B9 clean owned fixture binds wrappers/projection/protocol/Node and preserves one-shot closure', async () => {
  const workspace = createTestWorkspace(null, { prefix: 'cairn-evidence-bundle-launch-' });
  try {
    const root = fileURLToPath(new URL('../../../', import.meta.url)), checkout = join(workspace.path, 'runtime'); mkdirSync(checkout);
    const archive = execFileSync('/usr/bin/git', ['archive', 'HEAD'], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
    execFileSync('/usr/bin/tar', ['-x', '-C', checkout], { input: archive });
    for (const file of ['runner.mjs', 'launch.mjs', 'coverage.mjs', 'requested-answer.mjs',
      'test/evidence-bundle.test.mjs', 'test/evidence-bundle-runner.test.mjs']) {
      copyFileSync(new URL(`../${file}`, import.meta.url), join(checkout, 'evaluation/algorithm-development', file));
    }
    copyFileSync(join(root, 'docs/plans/evidence-bundle-qa24.md'), join(checkout, 'docs/plans/evidence-bundle-qa24.md'));
    cpSync(join(root, 'adapters/openai/node_modules'), join(checkout, 'adapters/openai/node_modules'), { recursive: true });
    const git = args => execFileSync('/usr/bin/git', ['-C', checkout, ...args], { stdio: 'ignore',
      env: { PATH: '/usr/bin:/bin', GIT_CONFIG_NOSYSTEM: '1', GIT_AUTHOR_NAME: 'Synthetic fixture', GIT_AUTHOR_EMAIL: 'fixture@example.invalid',
        GIT_COMMITTER_NAME: 'Synthetic fixture', GIT_COMMITTER_EMAIL: 'fixture@example.invalid' } });
    git(['init']); git(['add', '--all']); git(['commit', '-m', 'Owned synthetic manifest fixture']);
    const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(), limitMicroUsd: 400_000_000, requestCap: 100_000 };
    createExperimentBudget(configuration).close(); const before = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
    upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, expectedHistorySha256: before.historySha256 });
    const module = await import(pathToFileURL(join(checkout, 'evaluation/algorithm-development/launch.mjs')));
    const manifest = await module.prepareEvidenceBundleComparison({ configuration });
    assert.equal(manifest.version, 'source-diverse-linked-requested-answer-launch-v1');
    assert.equal(manifest.requestMaximum, 1968); assert.equal(manifest.reservationMaximumMicroUsd, 10_000_000);
    assert.equal(manifest.protectedMicroUsd, 30_000_000); assert.deepEqual(manifest.originalCorpusHashes, original.hashes);
    assert.deepEqual(manifest.corpusHashes, bundled.hashes);
    for (const file of ['evaluation/architecture/source-linked-evidence-model.mjs',
      'evaluation/architecture/source-diverse-selection-model.mjs', 'evaluation/longmemeval/mixed-evidence.mjs',
      'evaluation/longmemeval/mixed-answer.mjs', 'evaluation/algorithm-development/test/evidence-bundle-runner.test.mjs']) {
      assert.equal(manifest.artifactHashes[file], createHash('sha256').update(readFileSync(join(checkout, file))).digest('hex'));
    }
    let keys = 0; const outputDirectory = join(workspace.path, 'output'); mkdirSync(outputDirectory, { mode: 0o700 });
    const options = { configuration, manifest, outputDirectory, keyProvider: () => { keys++; throw new Error('Synthetic key failure'); },
      fetchImpl: () => assert.fail('No HTTP') };
    const wrong = structuredClone(manifest); wrong.nodeSha256 = '0'.repeat(64);
    await assert.rejects(module.launchEvidenceBundleComparison({ ...options, manifest: wrong }), { code: 'manifest_mismatch' });
    assert.equal(keys, 0); assert.equal(existsSync(join(outputDirectory, 'started.json')), false);
    await assert.rejects(module.launchEvidenceBundleComparison(options), /Synthetic key failure/);
    assert.equal(JSON.parse(readFileSync(join(outputDirectory, 'closed.json'))).completed, false);
    await assert.rejects(module.launchEvidenceBundleComparison(options), { code: 'EEXIST' }); assert.equal(keys, 1);
  } finally { await workspace.cleanup(); assert.equal(existsSync(workspace.path), false); }
});
