import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { prepareMixedComparison } from '../longmemeval/mixed-generation.mjs';
import { evaluatorRows, rubric } from './evaluator.mjs';
import { inspectClassificationFollowupSources, projectClassificationFollowupBudget } from './prepare.mjs';
import { armOrders, sourceCases } from './source-cases.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const SOURCE_HASH = '9ad3aae8f081d3dec2acf1fb3d7a2fa58ca7c745e6cdd347be7cf6329fe86f80';
const EVALUATOR_HASH = '85b116a619f972774248bd61c14245e09a312756bbe9d2509e0deddc56f8b1f0';

test('F01/F02: two new long histories and separately frozen source windows align exactly', async t => {
  createTestWorkspace(t, { prefix: 'cairn-m1e-fixture-' });
  assert.equal(sourceCases.length, 2);
  assert.deepEqual(armOrders, [['cairn', 'mem0'], ['mem0', 'cairn']]);
  assert.equal(evaluatorRows.length, 2);
  assert.equal(rubric.length, 2);
  assert.equal(hash(JSON.stringify(sourceCases)), SOURCE_HASH);
  assert.equal(hash(JSON.stringify({ evaluatorRows, rubric })), EVALUATOR_HASH);
  assert.equal(Object.isFrozen(sourceCases), true);
  assert.equal(Object.isFrozen(sourceCases[0].history.sessions[0].turns[0]), true);
  assert.equal(Object.isFrozen(evaluatorRows), true);
  assert.match(sourceCases[1].history.sessions[0].turns[0].content, /[\u4e00-\u9fff]/u);
  const ids = new Set();
  for (const [index, row] of sourceCases.entries()) {
    const key = evaluatorRows[index];
    assert.equal(row.history.question_id, row.question.question_id);
    assert.equal(row.question.question_id, key.question_id);
    assert.equal(row.namespace.projectId, row.question.question_id);
    assert.equal(ids.has(row.question.question_id), false);
    ids.add(row.question.question_id);
    assert.equal(row.history.sessions.length, 16);
    assert.equal(row.history.sessions.every(session => session.turns.length === 32), true);
    const turns = row.history.sessions.flatMap(session => session.turns);
    assert.equal(turns.length, 512);
    assert.equal(new Set(turns.map(turn => turn.turn_id)).size, 512);
    assert.equal(new Set(turns.map(turn => turn.content)).size, 512);
    assert.equal(turns.every(turn => turn.role === 'user'), true);
    assert.equal(turns.some(turn => turn.content.includes(row.question.text)
      || turn.content.includes(key.reference_answer)), false);
    assert.equal(key.required_source_windows.length, 4);
    assert.equal(key.required_source_windows.length <= 8, true);
    assert.equal(new Set(key.required_source_windows.map(window => window.turn_id)).size, 4);
    assert.deepEqual(key.answer_session_ids,
      key.required_source_windows.map(window => window.session_id));
    assert.deepEqual(key.turn_labels,
      key.required_source_windows.map(window => ({ turn_id: window.turn_id, has_answer: true })));
    for (const window of key.required_source_windows) {
      const session = row.history.sessions.find(candidate => candidate.session_id === window.session_id);
      assert.ok(session);
      const turn = session.turns.find(candidate => candidate.turn_id === window.turn_id);
      assert.ok(turn);
      assert.equal(turn.content, window.source_text);
    }
    assert.equal(rubric[index].question_id, key.question_id);
    assert.ok(rubric[index].required.length >= 4);
    assert.ok(rubric[index].disallow.length >= 2);
  }
  const allSourceText = JSON.stringify(sourceCases);
  assert.doesNotMatch(allSourceText, /(?:sk-[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|-----BEGIN PRIVATE KEY-----)/u);
  const evaluatorModule = await readFile(new URL('./evaluator.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(evaluatorModule, /from ['"]\.\/source-cases\.mjs['"]/u);
});

test('F01/F08: source passages distinguish replacement from reconfirmation', t => {
  createTestWorkspace(t, { prefix: 'cairn-m1e-meaning-' });
  const workshop = evaluatorRows[0].required_source_windows;
  assert.match(workshop[0].source_text, /adopted the east-wall fixed rack.*reason/u);
  assert.match(workshop[2].source_text, /adopted rolling rack bay C instead/u);
  assert.match(workshop[3].source_text, /remains the adopted/u);
  const logistics = evaluatorRows[1].required_source_windows;
  assert.match(logistics[0].source_text, /決定夜間冷鏈出貨使用四號月台/u);
  assert.match(logistics[1].source_text, /前提，現在不再成立/u);
  assert.match(logistics[2].source_text, /尚未決定採用六號月台或任何替代月台/u);
  assert.match(logistics[3].source_text, /四號月台是先前已採用的安排.*需要重新確認/u);
  assert.match(logistics[3].source_text, /沒有核准新的夜間出貨月台/u);
});

test('F03: actual indexed source planning and mixed preflight agree on 32 ready batches each', t => {
  createTestWorkspace(t, { prefix: 'cairn-m1e-plan-' });
  const inspection = inspectClassificationFollowupSources();
  assert.equal(inspection.sourceJsonSha256, SOURCE_HASH);
  assert.equal(inspection.sourceJsonBytes, Buffer.byteLength(JSON.stringify(sourceCases)));
  assert.deepEqual(inspection.cases.map(row => row.counts.originalTurns), [512, 512]);
  assert.deepEqual(inspection.cases.map(row => row.counts.batches), [32, 32]);
  assert.deepEqual(inspection.cases.map(row => row.counts.windows), [512, 512]);
  assert.equal(inspection.cases.every(row => row.perSessionBatches.every(count => count === 2)), true);
  assert.doesNotMatch(JSON.stringify(inspection), /east-wall|rack|四號月台|六號月台/u);
  const prepared = prepareMixedComparison({ sourceCases, armOrders,
    nativeArtifact: { sourceTreeSha256: '0'.repeat(64), dependencyLockSha256: '1'.repeat(64) },
    nativeConfiguration: { configurationSha256: '2'.repeat(64), configuration: {} },
    cairnRuntimeArtifactSha256: '3'.repeat(64), comparisonProfile: 'indexed-evidence-v1' });
  assert.deepEqual(prepared.counts, { fixedN: 2, batchCounts: [32, 32] });
  assert.deepEqual(prepared.preflight.map(row => row.status), ['ready', 'ready']);
  assert.deepEqual(prepared.roster.map(row => row.armOrder), armOrders);
  assert.deepEqual(prepared.preflight.map(row => row.caseDigest),
    inspection.cases.map(row => row.caseDigest));
  assert.equal(prepared.manifest.cairn.captureSourcePolicy, 'indexed-evidence-v1');
  assert.equal(prepared.manifest.cairn.qualificationInputProfile, 'not-requested');
});

test('F03/F06: pure schema-2 budget proposal preserves reserve and grants nothing', t => {
  createTestWorkspace(t, { prefix: 'cairn-m1e-budget-' });
  const context = { schemaVersion: 2, originalLimitMicroUsd: 200_000_000,
    remainingMicroUsd: 50_000_000, protectedMicroUsd: 30_000_000,
    requestCount: 1_000, requestCap: 1_500 };
  const proposal = projectClassificationFollowupBudget(context);
  assert.equal(proposal.maximumNewRequests, 16_982);
  assert.equal(proposal.maximumNewReservedMicroUsd, 3_326_968);
  assert.equal(proposal.proposedRequestCap, 17_982);
  assert.ok(proposal.projectedRemainingAfterMaximumMicroUsd >= context.protectedMicroUsd);
  assert.equal(proposal.grantsBudget, false);
  assert.throws(() => projectClassificationFollowupBudget({ ...context, schemaVersion: 1 }),
    /invalid_classification_followup_run_context/u);
  assert.throws(() => projectClassificationFollowupBudget({ ...context,
    remainingMicroUsd: 33_000_000 }), /classification_followup_budget_does_not_fit/u);
});

test('F04: fresh source-only process denies evaluator import, file reads, and HTTP', t => {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-m1e-isolation-' });
  const child = String.raw`
    import fs from 'node:fs';
    import http from 'node:http';
    import https from 'node:https';
    import { registerHooks, syncBuiltinESMExports } from 'node:module';

    let evaluatorReads = 0, networkCalls = 0;
    const evaluatorPath = target => String(target).endsWith('/evaluator.mjs');
    for (const name of ['readFile', 'readFileSync', 'open', 'openSync', 'createReadStream']) {
      const original = fs[name];
      fs[name] = function (...args) {
        if (evaluatorPath(args[0])) { evaluatorReads++; throw new Error('evaluator_read_forbidden'); }
        return original.apply(this, args);
      };
    }
    for (const name of ['readFile', 'open']) {
      const original = fs.promises[name];
      fs.promises[name] = function (...args) {
        if (evaluatorPath(args[0])) { evaluatorReads++; throw new Error('evaluator_read_forbidden'); }
        return original.apply(this, args);
      };
    }
    syncBuiltinESMExports();
    registerHooks({ resolve(specifier, context, nextResolve) {
      if (specifier.includes('evaluator.mjs')) throw new Error('evaluator_import_forbidden');
      return nextResolve(specifier, context);
    } });
    const blockNetwork = () => { networkCalls++; throw new Error('network_forbidden'); };
    globalThis.fetch = blockNetwork;
    for (const module of [http, https]) {
      module.request = blockNetwork;
      module.get = blockNetwork;
    }
    const { inspectClassificationFollowupSources } = await import(process.argv[1]);
    const result = inspectClassificationFollowupSources();
    const observed = { batches: result.cases.map(row => row.counts.batches),
      evaluatorReads, networkCalls };
    const evaluatorUrl = new URL('./evaluator.mjs', process.argv[1]);
    let importTrapArmed = false, readTrapArmed = false, networkTrapArmed = false;
    try { await import(evaluatorUrl.href); }
    catch (error) { importTrapArmed = error.message === 'evaluator_import_forbidden'; }
    try { fs.readFileSync(evaluatorUrl); }
    catch (error) { readTrapArmed = error.message === 'evaluator_read_forbidden'; }
    try { await globalThis.fetch('https://invalid.example.test'); }
    catch (error) { networkTrapArmed = error.message === 'network_forbidden'; }
    process.stdout.write(JSON.stringify({ ...observed, importTrapArmed,
      readTrapArmed, networkTrapArmed }));
  `;
  const result = execFileSync(process.execPath,
    ['--input-type=module', '-e', child, new URL('./prepare.mjs', import.meta.url).href],
    { cwd: workspace.path, timeout: 15_000, maxBuffer: 64 * 1024,
      env: { PATH: process.env.PATH ?? '', TMPDIR: workspace.path, TMP: workspace.path,
        TEMP: workspace.path, NODE_DISABLE_COMPILE_CACHE: '1' }, encoding: 'utf8' });
  assert.deepEqual(JSON.parse(result), { batches: [32, 32], evaluatorReads: 0,
    networkCalls: 0, importTrapArmed: true, readTrapArmed: true, networkTrapArmed: true });
});
