import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash, randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createOwnedGitFixture } from '../../../tools/testing/owned-git-fixture.mjs';
import { countOpenAITokens } from '../../../adapters/openai/index.mjs';
import { createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade, upgradeExperimentBudgetForEmbeddings, inspectEmbeddingExperimentBudgetSnapshot } from '../../experiment-budget/index.mjs';
import { verifiedRoleEvidence } from '../../longmemeval/mixed-evidence.mjs';
import { packMixedAnswer } from '../../longmemeval/mixed-answer.mjs';
import { assembleSourceDiverseSelection } from '../../architecture/source-diverse-selection-model.mjs';
import { assembleSourceLinkedEvidence } from '../../architecture/source-linked-evidence-model.mjs';
import { assembleComplementarySourceSet } from '../../experiments/cloud-retrieval-v1/candidate.mjs';
import { prepareAlgorithmDevelopmentCase } from '../runner.mjs';
import { loadRequestedAnswerFreeze, loadEvidenceBundleFreeze, REQUESTED_ANSWER_PROTOCOL, buildBlindEvidenceBundlePacket } from '../requested-answer.mjs';
import { loadComplementarySourceFreeze, COMPLEMENTARY_PROTOCOL, buildBlindComplementarySourcePacket, aggregateComplementarySourceJudgments } from '../complementary.mjs';
import { scoreComplementarySourceCoverage, scoreEvidenceBundleCoverage } from '../coverage.mjs';
import { launchComplementarySourceComparison, launchEvidenceBundleComparison } from '../launch.mjs';
import { complementaryArms, complementaryPolicies, complementaryLimits, COMPLEMENTARY_VERSION } from '../complementary-profile.mjs';

const original = await loadRequestedAnswerFreeze(), frozen = await loadComplementarySourceFreeze(), awaitableBundle = await loadEvidenceBundleFreeze();
const identity = { schemaVersion: `${COMPLEMENTARY_VERSION}-comparison-v1`, treatment: complementaryPolicies.complementary,
  evidenceFormat: 'source-role-evidence-v1', armPolicies: complementaryPolicies, fatal: null };
const empty = name => ({ name, status: 'unresolved', answer: null, recalled: null, packed: null, evidence: null,
  modelCalls: [], coreInputs: [], effectiveSelections: [], effectiveRanks: [] });
function reportFixture() {
  const observations = original.modelInputs.map(source => ({ id: source.id, family: source.family, source,
    capture: { status: 'unresolved', receipts: [] }, arms: Object.fromEntries(complementaryArms.map(name => [name, empty(name)])) }));
  const row = observations[10], { plan, namespace } = prepareAlgorithmDevelopmentCase(row.source);
  const details = plan.cairnPlan.batches.map((batch, index) => {
    const window = batch.indexedWindows[0];
    return { memory: { id: `control-memory-${index}`, revision: 1, state: 'active', content: 'Synthetic interpretation.', namespace, receiptCount: 1 },
      receipts: [{ id: `control-receipt-${index}`, client: batch.captureInput.client, sessionId: batch.captureInput.sessionId,
        eventId: window.id, role: window.role, excerpt: window.content }], exhausted: true, nextReceiptCursor: null };
  });
  const refs = details.map(detail => ({ namespaceIndex: 0, memoryId: detail.memory.id, revision: 1 }));
  const selectInput = { query: plan.mem0Input.query, maxRefs: 24, maps: [{ namespaceIndex: 0, exhausted: true,
    items: refs.map(({ memoryId, revision }) => ({ type: 'unfiled', ref: { memoryId, revision }, label: 'Routing only.' })) }] };
  const rawSelect = { refs: [refs[1]] }, reads = [1, 0].map(index => ({ input: { namespace, memoryId: refs[index].memoryId, receiptLimit: 8 }, response: { ok: true, value: details[index] } }));
  const selected = assembleSourceDiverseSelection(selectInput, rawSelect, { readSet: [namespace], inspections: reads.map(read => ({ ref: { namespaceIndex: 0,
    memoryId: read.input.memoryId, revision: 1 }, response: read.response })) });
  const candidate = ref => {
    const detail = details.find(item => item.memory.id === ref.memoryId);
    return { namespaceIndex: 0, memory: { id: ref.memoryId, revision: 1, currentness: 'current' }, receiptCount: 1,
      receipts: detail.receipts.map(({ id, role, excerpt }) => ({ id, role, excerpt })), interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed' };
  };
  row.capture = { status: 'completed', receipts: details };
  for (const name of complementaryArms) {
    const selection = name === 'baseline' ? { output: rawSelect, diagnostics: null } : selected;
    const rankInput = { query: plan.mem0Input.query, limit: 6, candidates: selection.output.refs.map(candidate) }, rawRank = { refs: [refs[1]] };
    const ranked = name === 'baseline' ? { output: rawRank, diagnostics: null } : name === 'linked'
      ? assembleSourceLinkedEvidence(rankInput, rawRank) : assembleComplementarySourceSet(rankInput, rawRank);
    const recalled = { memories: ranked.output.refs.map(ref => { const { namespaceIndex, ...item } = candidate(ref); return item; }) };
    const evidence = verifiedRoleEvidence(recalled, ({ memoryId }) => ({ ok: true, value: details.find(detail => detail.memory.id === memoryId) }), plan, namespace);
    const selectCall = { input: selectInput, system: 'control select instruction', maxOutputTokens: 1024 };
    const rankCall = { input: rankInput, system: 'control rank instruction', maxOutputTokens: 1024 };
    row.arms[name] = { name, status: 'completed', answer: 'Synthetic answer.', recalled, evidence,
      packed: packMixedAnswer({ question: row.source.question, units: evidence.units, countTokens: countOpenAITokens }), coreInputs: [selectCall],
      modelCalls: [{ ...selectCall, method: 'select', output: rawSelect, failure: null }, { ...rankCall, method: 'rank', output: rawRank, failure: null }],
      effectiveSelections: [{ ...selectCall, policy: complementaryPolicies[name], output: selection.output, failure: null,
        publicReads: name === 'baseline' ? [] : [...reads, ...reads], diagnostics: selection.diagnostics }],
      effectiveRanks: [{ ...rankCall, policy: complementaryPolicies[name], output: ranked.output, failure: null, diagnostics: ranked.diagnostics,
        addedRefs: ranked.output.refs.filter(ref => ref.memoryId !== refs[1].memoryId), displacedRefs: [] }] };
  }
  // Formal observations are serialized JSON; raw and effective inputs are
  // independent records rather than shared references in this fixture.
  return JSON.parse(JSON.stringify({ ...identity, observations }));
}
const coverage = report => scoreComplementarySourceCoverage({ report, modelInputs: original.modelInputs, evaluatorRubric: original.evaluatorRubric });

function resolvedJudgmentFixture() {
  const report = { ...identity, observations: original.modelInputs.map(source => ({ id: source.id, family: source.family,
    capture: { status: 'completed' }, arms: Object.fromEntries(complementaryArms.map(name => [name,
      { name, status: 'completed', answer: 'Synthetic verdict control.' }])) })) };
  const rows = original.modelInputs.flatMap((source, index) => complementaryArms.map(arm => ({ id: source.id, arm,
    verdict: index === 23 || arm === 'baseline' && index < 3 || arm === 'linked' && index < 1 ? 'incorrect' : 'correct',
    reviewedClaims: 1, unsupportedClaims: 0, staleClaims: 0, severeError: false, rationale: 'Synthetic clean-harm verdict control.' })));
  return { report, judgmentsA: rows, judgmentsB: structuredClone(rows), resourcesWithinLimits: true,
    coverage: { schemaVersion: `${COMPLEMENTARY_VERSION}-coverage-v1`, anchorDenominator: 42,
      paired: { complementaryBaseline: { denominator: 42, gain: 1 }, complementaryLinked: { denominator: 42, gain: 0 } } } };
}

function assertPairedDenominators(result) {
  for (const pair of Object.values(result.paired)) {
    assert.equal(pair.denominator, 24);
    assert.equal(pair.wins + pair.losses + pair.bothCorrect + pair.neitherCorrect + pair.unresolvedPairs, 24);
  }
}

test('Q5 verdict-only disagreement with agreed clean harms blocks advancement, not counted as control wrong', () => {
  const options = resolvedJudgmentFixture();
  options.judgmentsB.find(row => row.id === 'D01' && row.arm === 'baseline').verdict = 'correct';
  const result = aggregateComplementarySourceJudgments(options);
  assert.equal(result.safety.unknown, false); assert.equal(result.safety.blocksAdvancement, false);
  assert.equal(result.paired.complementaryBaseline.netCorrect, 3, 'certified correct counts alone retain the apparent +3');
  assert.equal(result.advances, false); assert.equal(result.incrementalSuperiority, false);
  assert.equal(result.gates.correctnessResolved, false); assert.equal(result.arms.baseline.unresolved, 1);
  assert.equal(result.outcomesDenominator, 72); assert.equal(result.arms.baseline.denominator, 24);
  assert.deepEqual(result.paired.complementaryBaseline, { denominator: 24, wins: 2, losses: 0,
    bothCorrect: 20, neitherCorrect: 1, unresolvedPairs: 1, netCorrect: 3 });
  assertPairedDenominators(result);
  options.judgmentsA.find(row => row.id === 'D01' && row.arm === 'baseline').verdict = 'correct';
  const resolved = aggregateComplementarySourceJudgments(options);
  assert.equal(resolved.gates.correctnessResolved, true);
  assert.equal(resolved.paired.complementaryBaseline.netCorrect, 2); assert.equal(resolved.gates.primaryQA, false);
});

test('Q5 unknown-verdict controls keep clean harms and all24 denominators while skipping unresolved pairs', () => {
  for (const name of complementaryArms) {
    const options = resolvedJudgmentFixture();
    for (const rows of [options.judgmentsA, options.judgmentsB]) rows.find(row => row.id === 'D01' && row.arm === name).verdict = 'unresolved';
    const result = aggregateComplementarySourceJudgments(options);
    assert.equal(result.safety.unknown, false); assert.equal(result.safety.blocksAdvancement, false);
    assert.equal(result.advances, false); assert.equal(result.incrementalSuperiority, false);
    assert.equal(result.gates.correctnessResolved, false); assert.equal(result.arms[name].unresolved, 1);
    assert.equal(result.arms[name].denominator, 24); assert.equal(result.outcomesDenominator, 72);
    for (const [pairName, pair] of Object.entries(result.paired))
      assert.equal(pair.unresolvedPairs, name === 'complementary' || pairName.endsWith(name === 'baseline' ? 'Baseline' : 'Linked') ? 1 : 0);
    assertPairedDenominators(result);
  }
  const options = resolvedJudgmentFixture();
  for (const rows of [options.judgmentsA, options.judgmentsB])
    for (const row of rows.filter(row => row.id === 'D01')) row.verdict = 'unresolved';
  const result = aggregateComplementarySourceJudgments(options);
  assert.equal(result.paired.complementaryBaseline.unresolvedPairs, 1, 'both unresolved outcomes form one unresolved pair');
  assert.equal(result.paired.complementaryLinked.unresolvedPairs, 1); assertPairedDenominators(result);
});

test('Q5 resolved-pair positive control permits incorrect answers and passes without requiring perfect accuracy', () => {
  const result = aggregateComplementarySourceJudgments(resolvedJudgmentFixture());
  assert.equal(result.advances, true); assert.equal(result.incrementalSuperiority, true);
  assert.equal(result.gates.correctnessResolved, true);
  for (const name of complementaryArms) { assert.ok(result.arms[name].incorrect > 0); assert.equal(result.arms[name].unresolved, 0); }
  assert.equal(result.paired.complementaryBaseline.netCorrect, 3); assert.equal(result.paired.complementaryLinked.netCorrect, 1);
  for (const pair of Object.values(result.paired)) { assert.equal(pair.unresolvedPairs, 0); assert.equal(pair.neitherCorrect, 1); }
  assertPairedDenominators(result);
});

test('Q1/Q5 separate freeze preserves requested v2 and all42 anchors; blind identity/cross-profile guards', async () => {
  assert.deepEqual(frozen.originalHashes, original.hashes); assert.deepEqual(frozen.evaluatorRubric, original.evaluatorRubric);
  assert.deepEqual(frozen.qaRubric, original.qaRubric);
  assert.deepEqual({ ...COMPLEMENTARY_PROTOCOL, version: REQUESTED_ANSWER_PROTOCOL.version }, REQUESTED_ANSWER_PROTOCOL);
  const report = reportFixture(), result = buildBlindComplementarySourcePacket({ report, freeze: frozen });
  assert.equal(result.packet.items.length, 3);
  for (const item of result.packet.items) {
    assert.equal(Object.hasOwn(item, 'arm'), false); assert.equal(Object.hasOwn(item, 'id'), false);
    assert.deepEqual(item.nonScoringCalibration.examples, original.qaRubric.cases.D11.examples);
  }
  assert.throws(() => buildBlindComplementarySourcePacket({ report, freeze: original }));
  assert.throws(() => buildBlindEvidenceBundlePacket({ report, freeze: awaitableBundle }));
  const changed = structuredClone(frozen); changed.protocol.instructions.push('changed');
  assert.throws(() => buildBlindComplementarySourcePacket({ report, freeze: changed }));
});

test('Q6 actual selected/recalled/packed coverage reconstructs both compilers and rejects missing/raw fallback/forged traces', () => {
  const report = reportFixture(), result = coverage(report);
  assert.equal(result.anchorDenominator, 42); assert.equal(result.paired.complementaryBaseline.gain, 1);
  assert.equal(result.paired.complementaryLinked.gain, 0);
  for (const name of complementaryArms) {
    for (const mutate of [arm => { delete arm.effectiveRanks; }, arm => { delete arm.effectiveSelections; },
      arm => { arm.effectiveRanks[0].input.query = 'forged'; }, arm => { arm.modelCalls.pop(); },
      arm => { arm.effectiveRanks[0].diagnostics = {}; }, arm => { arm.effectiveRanks[0].addedRefs = [{ memoryId: 'forged' }]; }]) {
      const changed = structuredClone(report); mutate(changed.observations[10].arms[name]); assert.throws(() => coverage(changed));
    }
  }
  const changed = structuredClone(report); changed.observations[10].arms.complementary.packed.request.messages[0].content = 'forged';
  assert.equal(coverage(changed).cases[10].anchors[0].statuses.complementary.packed, 'unknown');
  assert.throws(() => scoreEvidenceBundleCoverage({ report, modelInputs: original.modelInputs, evaluatorRubric: original.evaluatorRubric }));
});

test('Q5 72 blind answers, all arm safety, disagreement/missing/unknown and samebatch incremental superiority gates', () => {
  const report = { ...identity, observations: original.modelInputs.map(source => ({ id: source.id, family: source.family,
    capture: { status: 'completed' }, arms: Object.fromEntries(complementaryArms.map(name => [name, { name, status: 'completed', answer: 'Control.',
      packed: { request: { messages: [{ role: 'system', content: 'control' }, { role: 'user', content: '{"evidence":[]}' }] } } }])) })) };
  assert.equal(buildBlindComplementarySourcePacket({ report, freeze: frozen }).packet.items.length, 72);
  const rows = original.modelInputs.flatMap((source, index) => complementaryArms.map(arm => ({ id: source.id, arm,
    verdict: arm === 'baseline' && index < 3 || arm === 'linked' && index < 1 ? 'incorrect' : 'correct', reviewedClaims: 1,
    unsupportedClaims: 0, staleClaims: 0, severeError: false, rationale: 'Synthetic gate control.' })));
  const options = { report, judgmentsA: rows, judgmentsB: structuredClone(rows), resourcesWithinLimits: true,
    coverage: { schemaVersion: `${COMPLEMENTARY_VERSION}-coverage-v1`, anchorDenominator: 42,
      paired: { complementaryBaseline: { denominator: 42, gain: 1 }, complementaryLinked: { denominator: 42, gain: 0 } } } };
  const passed = aggregateComplementarySourceJudgments(options);
  assert.equal(passed.advances, true); assert.equal(passed.incrementalSuperiority, true); assert.equal(passed.outcomesDenominator, 72);
  assert.equal(passed.paired.complementaryBaseline.netCorrect, 3); assert.equal(passed.paired.complementaryLinked.netCorrect, 1);
  assert.equal(aggregateComplementarySourceJudgments({ ...options, resourcesWithinLimits: false }).incrementalSuperiority, false);
  assert.throws(() => aggregateComplementarySourceJudgments({ ...options, resourcesWithinLimits: null }));
  for (const name of complementaryArms) for (const field of ['unsupportedClaims', 'staleClaims', 'severeError']) {
    const bad = structuredClone(rows), item = bad.find(item => item.arm === name); item[field] = field === 'severeError' ? true : 1;
    assert.equal(aggregateComplementarySourceJudgments({ ...options, judgmentsA: bad, judgmentsB: bad }).advances, name !== 'complementary');
    assert.equal(aggregateComplementarySourceJudgments({ ...options, judgmentsB: bad }).safety.unknown, true);
  }
  const sharedHarm = structuredClone(rows);
  for (const item of sharedHarm.filter(item => item.id === 'D01')) Object.assign(item, { unsupportedClaims: 1, staleClaims: 1, severeError: true });
  assert.equal(aggregateComplementarySourceJudgments({ ...options, judgmentsA: sharedHarm, judgmentsB: sharedHarm }).advances, true,
    'known preexisting shared harm does not introduce a new zero-harm gate');
  const missing = aggregateComplementarySourceJudgments({ ...options, judgmentsB: rows.slice(1) });
  assert.equal(missing.outcomesDenominator, 72); assert.equal(missing.advances, false);
  const unknown = structuredClone(rows); unknown[0].verdict = 'unresolved'; unknown[0].severeError = null;
  assert.equal(aggregateComplementarySourceJudgments({ ...options, judgmentsA: unknown, judgmentsB: unknown }).advances, false);
  const regression = structuredClone(rows); regression.find(item => item.id === 'D01' && item.arm === 'complementary').verdict = 'incorrect';
  regression.find(item => item.id === 'D02' && item.arm === 'complementary').verdict = 'incorrect';
  assert.equal(aggregateComplementarySourceJudgments({ ...options, judgmentsA: regression, judgmentsB: regression }).advances, false);
});

test('Q4 crossprofile launch rejects before key lookup', async () => {
  let keys = 0;
  const options = { configuration: {}, keyProvider: () => { keys++; }, fetchImpl: () => assert.fail('No HTTP') };
  await assert.rejects(launchComplementarySourceComparison({ ...options, manifest: { version: 'source-diverse-linked-requested-answer-launch-v1' } }), { code: 'manifest_mismatch' });
  await assert.rejects(launchEvidenceBundleComparison({ ...options, manifest: { version: `${COMPLEMENTARY_VERSION}-launch-v1` } }), { code: 'manifest_mismatch' });
  assert.equal(keys, 0);
});

test('Q3/Q4 clean reviewed manifest binds candidate/helpers/Node, mutation fails beforekey; keyfailure closes all24 and never resumes', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'complementary-manifest-' });
  const root = fileURLToPath(new URL('../../../', import.meta.url)), fixture = createOwnedGitFixture(workspace), checkout = fixture.path;
  const archive = execFileSync('/usr/bin/git', ['archive', 'HEAD'], { cwd: root, maxBuffer: 128 * 1024 * 1024 });
  execFileSync('/usr/bin/tar', ['-x', '-C', checkout], { input: archive });
  // Use the exact current packet while HEAD may still be the preimplementation base.
  cpSync(join(root, 'evaluation/algorithm-development'), join(checkout, 'evaluation/algorithm-development'), { recursive: true });
  cpSync(join(root, 'docs/plans/complementary-qa24.md'), join(checkout, 'docs/plans/complementary-qa24.md'));
  cpSync(join(root, 'adapters/openai/node_modules'), join(checkout, 'adapters/openai/node_modules'), { recursive: true });
  fixture.commit('Owned complementary manifest fixture');
  const configuration = { directory: join(workspace.path, 'ledger'), runId: randomUUID(), limitMicroUsd: 400_000_000, requestCap: 100_000 };
  createExperimentBudget(configuration).close(); const old = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
  upgradeExperimentBudgetForEmbeddings({ ...configuration, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, expectedHistorySha256: old.historySha256 });
  const module = await import(pathToFileURL(join(checkout, 'evaluation/algorithm-development/launch.mjs')));
  const manifest = await module.prepareComplementarySourceComparison({ configuration });
  assert.deepEqual(manifest.limits, complementaryLimits); assert.equal(manifest.requestMaximum, 1992);
  for (const path of ['evaluation/experiments/cloud-retrieval-v1/candidate.mjs', 'evaluation/algorithm-development/complementary.mjs',
    'evaluation/algorithm-development/complementary-profile.mjs', 'evaluation/algorithm-development/judging.mjs',
    'evaluation/algorithm-development/evaluator.mjs', 'docs/plans/complementary-qa24.md'])
    assert.equal(manifest.artifactHashes[path], createHash('sha256').update(readFileSync(join(checkout, path))).digest('hex'));
  let keys = 0; const outputDirectory = join(workspace.path, 'output'); mkdirSync(outputDirectory, { mode: 0o700 });
  const options = { configuration, manifest, outputDirectory, keyProvider: () => { keys++; throw new Error('Synthetic key failure'); }, fetchImpl: () => assert.fail('No HTTP') };
  for (const mutate of [value => { value.limits.httpRequests++; }, value => { value.requestMaximum++; },
    value => { value.nodeSha256 = '0'.repeat(64); }, value => { value.artifactHashes['evaluation/algorithm-development/complementary.mjs'] = '0'.repeat(64); }]) {
    const changed = structuredClone(manifest); mutate(changed);
    await assert.rejects(module.launchComplementarySourceComparison({ ...options, manifest: changed }), { code: 'manifest_mismatch' });
  }
  assert.equal(keys, 0); assert.equal(existsSync(join(outputDirectory, 'started.json')), false);
  const dirty = join(checkout, 'evaluation/algorithm-development/complementary-profile.mjs'), bytes = readFileSync(dirty);
  writeFileSync(dirty, Buffer.concat([bytes, Buffer.from('\n// synthetic dirty runtime\n')]));
  await assert.rejects(module.prepareComplementarySourceComparison({ configuration }), { code: 'runtime_not_clean' });
  writeFileSync(dirty, bytes);
  await assert.rejects(module.launchComplementarySourceComparison(options), /Synthetic key failure/);
  const retained = JSON.parse(readFileSync(join(outputDirectory, 'report.json')));
  assert.equal(retained.observations.length, 24); assert.equal(retained.denominator, 24);
  assert.equal(retained.observations.flatMap(row => Object.values(row.arms)).filter(arm => arm.status === 'unresolved').length, 72);
  assert.equal(JSON.parse(readFileSync(join(outputDirectory, 'closed.json'))).completed, false);
  await assert.rejects(module.launchComplementarySourceComparison(options), { code: 'EEXIST' }); assert.equal(keys, 1);

  const corruptionDirectory = join(workspace.path, 'post-key-corruption'); mkdirSync(corruptionDirectory, { mode: 0o700 });
  const casesFile = join(checkout, 'evaluation/algorithm-development/cases.json'), originalCases = readFileSync(casesFile);
  const ledgerBeforeCorruption = inspectEmbeddingExperimentBudgetSnapshot(configuration);
  let providerCalls = 0;
  try {
    await assert.rejects(module.launchComplementarySourceComparison({ configuration, manifest, outputDirectory: corruptionDirectory,
      keyProvider: () => { writeFileSync(casesFile, '{'); return 'synthetic-complementary-secret'; },
      fetchImpl: () => { providerCalls++; assert.fail('No HTTP after corpus mutation'); } }), { code: 'runtime_not_clean' });
  } finally { writeFileSync(casesFile, originalCases); }
  assert.equal(providerCalls, 0);
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(configuration), ledgerBeforeCorruption);
  const corruptReport = JSON.parse(readFileSync(join(corruptionDirectory, 'report.json')));
  assert.equal(corruptReport.fatal, 'runtime_not_clean'); assert.equal(corruptReport.observations.length, 24);
  assert.deepEqual(corruptReport.observations.map(row => row.source), original.modelInputs,
    'pre-key detached source-only snapshot, not corrupted on-disk sources or evaluator gold');
  assert.equal(corruptReport.observations.flatMap(row => Object.values(row.arms)).filter(arm => arm.status === 'unresolved').length, 72);
  const corruptionClosure = JSON.parse(readFileSync(join(corruptionDirectory, 'closed.json')));
  assert.equal(corruptionClosure.runnerStarted, false); assert.equal(corruptionClosure.reportAvailable, true);
  assert.equal(corruptionClosure.failure, 'runtime_not_clean'); assert.equal(corruptionClosure.completed, false);

  // A real post-dispatch case persistence failure must preserve actual case1
  // and request records, never rerun the runner or replace them with unrun rows.
  const failedDirectory = join(workspace.path, 'post-dispatch'); mkdirSync(failedDirectory, { mode: 0o700 });
  let answers = 0;
  const fetchImpl = async (url, request) => {
    const body = JSON.parse(request.body), model = 'gpt-4.1-mini-2025-04-14';
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    if (url.endsWith('/chat/completions')) {
      if (++answers === 4) writeFileSync(join(failedDirectory, 'case-D02.json'), '{"syntheticCollision":true}\n', { flag: 'wx' });
      return Response.json({ object: 'chat.completion', model, choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic answer.' } }],
        usage: { prompt_tokens: 120, completion_tokens: 80, total_tokens: 200 } });
    }
    const output = body.text.format.name === 'cairn_extract' ? { items: [] } : { refs: [] };
    return Response.json({ object: 'response', model, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  };
  await assert.rejects(module.launchComplementarySourceComparison({ configuration, manifest, outputDirectory: failedDirectory,
    keyProvider: () => 'synthetic-complementary-secret', fetchImpl }), { code: 'algorithm_persistence_failure' });
  assert.equal(answers, 6, 'two actual cases, no retry or fabricated runner restart');
  assert.equal(JSON.parse(readFileSync(join(failedDirectory, 'case-D01.json'))).arms.complementary.status, 'completed');
  assert.equal(JSON.parse(readFileSync(join(failedDirectory, 'case-D02.json'))).syntheticCollision, true);
  assert.equal(existsSync(join(failedDirectory, 'case-D03.json')), false);
  assert.equal(existsSync(join(failedDirectory, 'report.json')), false);
  const closure = JSON.parse(readFileSync(join(failedDirectory, 'closed.json')));
  assert.equal(closure.runnerStarted, true); assert.equal(closure.reportAvailable, false);
  assert.equal(closure.failure, 'algorithm_persistence_failure'); assert.equal(closure.completed, false);
  assert.ok(closure.records > 0);
  assert.ok(inspectEmbeddingExperimentBudgetSnapshot(configuration).requestCount > 0);

  const reportDirectory = join(workspace.path, 'report-collision'); mkdirSync(reportDirectory, { mode: 0o700 });
  const currentManifest = await module.prepareComplementarySourceComparison({ configuration });
  let reportAnswers = 0;
  await assert.rejects(module.launchComplementarySourceComparison({ configuration, manifest: currentManifest, outputDirectory: reportDirectory,
    keyProvider: () => 'synthetic-complementary-secret', fetchImpl: async (url, request) => {
      if (url.endsWith('/chat/completions') && ++reportAnswers === 1)
        writeFileSync(join(reportDirectory, 'report.json'), '{"syntheticReportCollision":true}\n', { flag: 'wx' });
      return fetchImpl(url, request);
    } }), { code: 'EEXIST' });
  assert.equal(reportAnswers, 72, 'one complete batch, no retries when durable report persistence fails');
  assert.equal(JSON.parse(readFileSync(join(reportDirectory, 'report.json'))).syntheticReportCollision, true);
  assert.equal(JSON.parse(readFileSync(join(reportDirectory, 'case-D24.json'))).arms.complementary.status, 'completed');
  const reportClosure = JSON.parse(readFileSync(join(reportDirectory, 'closed.json')));
  assert.equal(reportClosure.runnerStarted, true); assert.equal(reportClosure.reportAvailable, false);
  assert.equal(reportClosure.completed, false); assert.equal(reportClosure.failure, 'EEXIST');
});
