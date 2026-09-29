import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { mem0WireProfile } from '../experiment-budget/mem0-wire.mjs';
import { benchmarkStagePolicy } from '../live/public-pilot.mjs';
import { experimentPolicy } from '../live/session.mjs';
import { prepareMixedComparison } from '../longmemeval/mixed-generation.mjs';
import { NATIVE_PROFILE, projectMixedResources } from '../longmemeval/mixed-resource.mjs';
import { evaluatorRows, rubric } from './evaluator.mjs';
import { inspectInstalledPhaseSources } from './prepare.mjs';
import { armOrders, sourceCases } from './source-cases.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const sourceHash = '5f3848b45cb2d2c34f8d090ceba02b18903e77bcde17e2141ccf01e2836e1d63';
const evaluatorHash = '766ddf71593d67a8e98abe6071035ab73dc060567e0cec6bdc6106135a78e52b';

test('I01: fresh separated source and evaluation fixtures freeze two 512-turn histories', async t => {
  createTestWorkspace(t, { prefix: 'cairn-installed-phase-fixture-' });
  assert.equal(sourceCases.length, 2);
  assert.deepEqual(armOrders, [['cairn', 'mem0'], ['mem0', 'cairn']]);
  assert.equal(evaluatorRows.length, 2);
  assert.equal(rubric.length, 2);
  assert.equal(hash(JSON.stringify(sourceCases)), sourceHash);
  assert.equal(hash(JSON.stringify({ evaluatorRows, rubric })), evaluatorHash);
  assert.equal(Object.isFrozen(sourceCases), true);
  assert.equal(Object.isFrozen(evaluatorRows), true);
  assert.match(sourceCases[1].history.sessions[0].turns[0].content, /[\u4e00-\u9fff]/u);
  const ids = new Set();
  for (const [index, row] of sourceCases.entries()) {
    const evaluator = evaluatorRows[index];
    assert.equal(row.history.question_id, row.question.question_id);
    assert.equal(row.question.question_id, evaluator.question_id);
    assert.equal(row.namespace.projectId, row.question.question_id);
    assert.equal(row.history.sessions.length, 16);
    assert.equal(ids.has(row.question.question_id), false);
    ids.add(row.question.question_id);
    const turns = row.history.sessions.flatMap(session => session.turns);
    assert.equal(turns.length, 512);
    assert.equal(turns.every(turn => turn.role === 'user'), true);
    assert.equal(turns.some(turn => turn.content.includes(row.question.text)), false);
    assert.equal(turns.some(turn => turn.content.includes(evaluator.reference_answer)), false);
    const turnIds = new Set(turns.map(turn => turn.turn_id));
    const sessionIds = new Set(row.history.sessions.map(session => session.session_id));
    assert.equal(turnIds.size, 512);
    assert.equal(evaluator.answer_session_ids.every(id => sessionIds.has(id)), true);
    assert.equal(evaluator.turn_labels.every(label => turnIds.has(label.turn_id)
      && label.has_answer === true), true);
    assert.equal(rubric[index].question_id, row.question.question_id);
    assert.ok(rubric[index].required.length >= 4);
    assert.ok(rubric[index].disallow.length >= 2);
  }
  // The evaluator can be loaded after generation without importing source history.
  const evaluatorModule = await readFile(new URL('./evaluator.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(evaluatorModule, /from ['"]\.\/source-cases\.mjs['"]/u);
});

test('I01/I02: actual indexed planner and mixed preparation agree on 32 ready batches per case', t => {
  createTestWorkspace(t, { prefix: 'cairn-installed-phase-plan-' });
  const inspection = inspectInstalledPhaseSources();
  assert.equal(inspection.comparisonProfile, 'indexed-evidence-v1');
  assert.equal(inspection.sourceJsonSha256, sourceHash);
  assert.equal(inspection.sourceJsonBytes, Buffer.byteLength(JSON.stringify(sourceCases)));
  assert.deepEqual(inspection.cases.map(row => row.counts.originalTurns), [512, 512]);
  assert.deepEqual(inspection.cases.map(row => row.counts.batches), [32, 32]);
  assert.deepEqual(inspection.cases.map(row => row.counts.windows), [512, 512]);
  assert.equal(inspection.cases.every(row => row.perSessionBatches.every(count => count === 2)), true);
  // Synthetic descriptors are deliberately unlaunchable. This calls the real preparation/static
  // native-fit path only; the private coordinator supplies checked installed descriptors later.
  const prepared = prepareMixedComparison({ sourceCases, armOrders,
    nativeArtifact: { sourceTreeSha256: '0'.repeat(64), dependencyLockSha256: '1'.repeat(64) },
    nativeConfiguration: { configurationSha256: '2'.repeat(64), configuration: {} },
    cairnRuntimeArtifactSha256: '3'.repeat(64), comparisonProfile: 'indexed-evidence-v1' });
  assert.deepEqual(prepared.counts, { fixedN: 2, batchCounts: [32, 32] });
  assert.deepEqual(prepared.preflight.map(row => row.status), ['ready', 'ready']);
  assert.equal(prepared.manifest.cairn.captureSourcePolicy, 'indexed-evidence-v1');
  assert.equal(prepared.manifest.cairn.qualificationInputProfile, 'not-requested');
  assert.equal(prepared.manifest.cairn.comparisonProfile, 'indexed-evidence-v1');
  assert.deepEqual(prepared.roster.map(row => row.armOrder), armOrders);
  assert.deepEqual(prepared.preflight.map(row => row.caseDigest),
    inspection.cases.map(row => row.caseDigest));
});

test('I06: pure resource projection stays under the predeclared two-case ceiling', t => {
  createTestWorkspace(t, { prefix: 'cairn-installed-phase-resource-' });
  const projected = projectMixedResources({ batchCounts: [32, 32],
    policy: experimentPolicy(), stages: benchmarkStagePolicy(),
    wireProfile: mem0WireProfile(), nativeProfile: NATIVE_PROFILE,
    remainingMicroUsd: 50_000_000, protectedMicroUsd: 30_000_000,
    comparisonProfile: 'indexed-evidence-v1' });
  assert.equal(projected.plannedCaseCount, 2);
  assert.equal(projected.plannedBatchCount, 64);
  assert.equal(projected.conditionalCeilings.joint.requests, 16_982);
  assert.equal(projected.conditionalCeilings.joint.reservedMicroUsd, 3_326_968);
  assert.equal(projected.conditionalCeilings.joint.reservedMicroUsd <= 4_000_000, true);
  assert.equal(projected.budget.upperBoundFits, true);
  // This is a synthetic arithmetic check, never an operational-ledger checkpoint.
});

test('I01/I05: fresh source-only inspection never loads evaluation or dispatches', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-installed-phase-isolation-' });
  const child = String.raw`
    import fs from 'node:fs';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';

    let evaluatorReads = 0;
    const evaluatorPath = target => String(target).endsWith('/evaluator.mjs');
    const block = (object, name) => {
      const original = object[name];
      object[name] = function (...args) {
        if (evaluatorPath(args[0])) {
          evaluatorReads++;
          throw new Error('evaluator_read_forbidden');
        }
        return original.apply(this, args);
      };
    };
    for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream']) {
      block(fs, name);
    }
    for (const name of ['readFile', 'open']) block(fs.promises, name);
    syncBuiltinESMExports();
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier.includes('evaluator.mjs')) throw new Error('evaluator_import_forbidden');
      return nextResolve(specifier, context);
    } });
    let fetchCalls = 0;
    globalThis.fetch = () => { fetchCalls++; throw new Error('network_forbidden'); };
    const { inspectInstalledPhaseSources } = await import(process.argv[1]);
    const result = inspectInstalledPhaseSources();
    const observed = { batches: result.cases.map(row => row.counts.batches),
      evaluatorReads, fetchCalls };
    const evaluatorUrl = new URL('./evaluator.mjs', process.argv[1]);
    let importTrapArmed = false, readTrapArmed = false, fetchTrapArmed = false;
    try { await import(evaluatorUrl.href); }
    catch (error) { importTrapArmed = error.message === 'evaluator_import_forbidden'; }
    try { fs.readFileSync(evaluatorUrl); }
    catch (error) { readTrapArmed = error.message === 'evaluator_read_forbidden'; }
    try { await globalThis.fetch('https://invalid.example.test'); }
    catch (error) { fetchTrapArmed = error.message === 'network_forbidden'; }
    process.stdout.write(JSON.stringify({ ...observed,
      importTrapArmed, readTrapArmed, fetchTrapArmed }));
  `;
  const result = execFileSync(process.execPath,
    ['--input-type=module', '-e', child, new URL('./prepare.mjs', import.meta.url).href],
    { cwd: workspace.path, timeout: 10_000, maxBuffer: 64 * 1024,
      env: { PATH: process.env.PATH ?? '', TMPDIR: workspace.path, TMP: workspace.path,
        TEMP: workspace.path, NODE_DISABLE_COMPILE_CACHE: '1' }, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(result), { batches: [32, 32], evaluatorReads: 0, fetchCalls: 0,
    importTrapArmed: true, readTrapArmed: true, fetchTrapArmed: true });
});
