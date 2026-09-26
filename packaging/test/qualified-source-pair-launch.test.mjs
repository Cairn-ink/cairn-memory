import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, readdirSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { installPreview } from '../install-preview.mjs';
import { command } from '../build.mjs';
import { createExperimentBudget, inspectExperimentBudgetSnapshot } from '../../evaluation/experiment-budget/index.mjs';
import { authorizeBenchmarkExtension, authorizeBenchmarkRequestAllowance,
  authorizeBenchmarkBudgetExtension, createExperimentRequestGuard } from '../../evaluation/experiment-budget/request-guard.mjs';
import { prepareLongMemEval, opaqueQuestionId } from '../../evaluation/longmemeval/prepare.mjs';
import { qualifiedSourcePairProtocol } from '../../evaluation/longmemeval/public-comparison.mjs';
import { loadPreparedPilot } from '../../evaluation/live/pilot.mjs';
import { benchmarkStagePolicy } from '../../evaluation/live/public-pilot.mjs';
import { experimentPolicy } from '../../evaluation/live/session.mjs';
import { createDiagnosticCollector, readDiagnostics } from '../../evaluation/live/diagnostics.mjs';
import { main } from '../../evaluation/live/qualified-source-pair-launch-cli.mjs';
import { qualificationPoolWire } from '../../adapters/openai/test/qualification-pool-wire.mjs';

const ROOT = path.resolve(import.meta.dirname, '../..');
const sha = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => JSON.stringify(value, (key, item) => item && !Array.isArray(item)
  && typeof item === 'object' ? Object.fromEntries(Object.keys(item).sort().map((name) =>
    [name, item[name]])) : item);
const harnessFiles = [
  'core/capture-input.mjs', 'core/model-budget.mjs', 'core/model-call.mjs',
  'core/model-diagnostics.mjs', 'core/source-windows.mjs', 'core/validation.mjs',
  'evaluation/experiment-budget/index.mjs', 'evaluation/experiment-budget/request-guard.mjs',
  'evaluation/experiment-budget/installed-core-deadline.mjs',
  'evaluation/experiment-budget/transport-diagnostics.mjs',
  'evaluation/longmemeval/comparison.mjs',
  'evaluation/longmemeval/ingestion.mjs', 'evaluation/longmemeval/public-comparison.mjs',
  'evaluation/longmemeval/official-scoring.mjs', 'evaluation/longmemeval/prepare.mjs',
  'evaluation/longmemeval/qualified-source-scoring.mjs',
  'evaluation/longmemeval/receipt-canonicalization.mjs',
  'evaluation/longmemeval/reference-rendering.mjs', 'evaluation/live/pilot.mjs',
  'evaluation/live/diagnostics.mjs',
  'evaluation/longmemeval/scoring.mjs', 'evaluation/longmemeval/validation.mjs',
  'evaluation/live/public-pilot.mjs',
  'evaluation/live/qualified-source-pair-launch.mjs',
  'evaluation/live/qualified-source-pair-launch-cli.mjs',
  'evaluation/live/qualified-source-pair-phase-quota.mjs',
  'packaging/artifact-files.json', 'packaging/build.mjs',
  'plugins/cairn-memory/lib/redact.mjs',
];
const modelName = 'gpt-4.1-mini-2025-04-14';
const limits = { contextWindow: 100_000, outputTokens: 50, answerTimeoutMs: 200_000,
  recallLimit: 6 };

function dataset() {
  return ['one', 'two'].map((suffix) => ({ question_id: `installed-pair-${suffix}`,
    question_type: 'single-session-user', question: 'Which day?', answer: 'Friday',
    question_date: 'Saturday', haystack_session_ids: [`source-${suffix}`],
    haystack_dates: ['Tuesday'], haystack_sessions: [[
      { role: 'user', content: `${'x'.repeat(800)} Friday is the day.` },
      { role: 'assistant', content: 'Understood.' },
    ]], answer_session_ids: [`source-${suffix}`] }));
}

function responseFor(url, options, observed, changeOutput = null) {
  const body = JSON.parse(options.body);
  observed.push({ url, body });
  if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  if (url.endsWith('/responses')) {
    const method = body.text.format.name.replace(/^cairn_/u, '');
    const input = JSON.parse(body.input[0].content[0].text);
    const empty = { value: null, evidenceIndices: [] };
    const unknown = { value: 'unknown', evidenceIndices: [] };
    let output;
    if (method === 'extract') output = { items: [{ content: 'GENERATED_SUMMARY_POISON',
      kind: 'context', confidence: 0.9,
      sourceIndices: input.inputMode === 'indexed-windows-v1' ? [0, 1, 2] : [0, 1] }] };
    else if (method === 'qualifyCandidates') output = qualificationPoolWire(input, { qualifications:
      input.items.map((entry) => ({ itemIndex: entry.itemIndex,
        subject: empty, property: empty, scope: empty, applies: empty,
        value: { value: null, evidenceIndices: [entry.candidates[0].candidateIndex] },
        attribution: unknown, commitment: unknown })) });
    else if (method === 'classify') output = { items: input.memories.map((memory) => ({
      memoryId: memory.id, parentIds: [], newL1: { title: 'Synthetic', parentL2Ids: [] } })) };
    else if (method === 'select') output = { refs: input.maps.flatMap((page) => page.items.map((item) =>
      item.type === 'unfiled' ? { namespaceIndex: page.namespaceIndex, ...item.ref }
        : item.type === 'ref' && item.ref.childType === 'memory'
          ? { namespaceIndex: page.namespaceIndex, memoryId: item.ref.childId,
            revision: item.ref.childRevision } : null).filter(Boolean)) };
    else if (method === 'rank') output = { refs: input.candidates.slice(0, input.limit).map((entry) => ({
      namespaceIndex: entry.namespaceIndex, memoryId: entry.memory.id,
      revision: entry.memory.revision })) };
    else assert.fail(`unknown method ${method}`);
    if (changeOutput) output = changeOutput(method, input, output);
    return Response.json({ id: 'resp_synthetic', object: 'response', model: body.model,
      status: 'completed', error: null, incomplete_details: null,
      output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
  }
  return Response.json({ id: 'chat_synthetic', object: 'chat.completion', model: body.model,
    choices: [{ index: 0, message: { role: 'assistant',
      content: body.model.includes('4o') ? 'yes' : 'Friday' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 100, completion_tokens: 5, total_tokens: 105 } });
}

async function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'cairn-pair-launch-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const source = JSON.stringify(dataset());
  const inputPath = path.join(root, 'source.json');
  writeFileSync(inputPath, source, { mode: 0o600 });
  const prepared = path.join(root, 'prepared');
  await prepareLongMemEval({ inputPath, expectedSha256: sha(source),
    datasetRevision: 'synthetic-revision', datasetVariant: 's-cleaned',
    questionIds: dataset().map((item) => item.question_id), outputDirectory: prepared });
  const installed = installPreview(['--directory', path.join(root, 'installation'), '--owner',
    'synthetic-owner', '--capture-qualification', 'source-bound-v2'], {
    runCommand(executable, args, cwd, userconfig) {
      return command(executable, executable === 'npm' ? [...args, '--offline'] : args, cwd, userconfig);
    },
  });
  const first = { directory: path.join(root, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  createExperimentBudget(first).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: first, policy,
    fetchImpl: () => assert.fail('no HTTP') }).close();
  const original = authorizeBenchmarkExtension({ ledger: first, policy,
    authorizationId: 'original', stages: benchmarkStagePolicy() });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: first, policy,
    benchmarkExtension: original, authorizationId: 'allowance', newRequestCap: 40,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const second = { ...first, requestCap: 40 };
  const parent = authorizeBenchmarkBudgetExtension({ oldLedger: second, policy,
    requestAllowance: allowance, authorizationId: 'parent', newLimitMicroUsd: 100_000_000,
    newRequestCap: 100, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const ledger = { ...second, limitMicroUsd: 100_000_000, requestCap: 100 };
  const pilot = await loadPreparedPilot({ directory: prepared, maxCases: 500 });
  const roster = pilot.cases.map((item, index) => {
    const questionId = item.question.question_id;
    const armOrder = index ? ['indexed-windows', 'qualified-prefix']
      : ['qualified-prefix', 'indexed-windows'];
    const protocol = qualifiedSourcePairProtocol({ history: item.history, question: item.question,
      namespace: { ownerId: 'longmemeval-qualified-source-pair', scope: 'project', projectId: questionId },
      answerModel: modelName, limits, armOrder });
    return { questionId, armOrder, protocolDigest: protocol.digest };
  });
  const planDir = path.join(root, 'plan');
  mkdirSync(planDir, { mode: 0o700 });
  const checkpoint = inspectExperimentBudgetSnapshot(ledger);
  const plan = {
    schemaVersion: 'cairn-qualified-source-pair-launch-plan-v1', executionId: 's'.repeat(80),
    prepared: { directory: prepared,
      manifestSha256: sha(readFileSync(path.join(prepared, 'manifest.json'))),
      historySha256: sha(readFileSync(path.join(prepared, 'history.jsonl'))),
      questionsSha256: sha(readFileSync(path.join(prepared, 'questions.jsonl'))),
      evaluatorSha256: sha(readFileSync(path.join(prepared, 'evaluator.jsonl'))) },
    installed: { receiptPath: installed.receiptPath,
      receiptSha256: sha(readFileSync(installed.receiptPath)), artifactSha256: installed.artifact.sha256 },
    harness: { commit: execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT,
      encoding: 'utf8' }).trim(), sourceHashes: Object.fromEntries(harnessFiles.map((name) =>
      [name, sha(readFileSync(path.join(ROOT, name)))])) },
    ledger, parent, checkpoint: { requestCount: checkpoint.requestCount,
      reservedMicroUsd: checkpoint.reservedMicroUsd,
      attemptsSha256: sha(canonical(checkpoint.attempts)) },
    answerModel: modelName, limits, judgeTimeoutMs: 90_000, roster,
    phaseCaps: { generation: { requests: 80, reservedMicroUsd: 1_000_000 },
      scoring: { requests: 10, reservedMicroUsd: 104_000 } },
    outputDirectory: path.join(planDir, 'output'), keyFile: path.join(planDir, 'unused-key'),
  };
  const planPath = path.join(planDir, 'plan.json');
  writeFileSync(planPath, `${JSON.stringify(plan)}\n`, { mode: 0o600 });
  chmodSync(planPath, 0o600);
  return { root, plan, planPath, planDir, ledger, roster };
}

test('L1/L3 dry-run is nonmutating; installed launch uses one claim and terminal pair report',
  { timeout: 120_000 }, async (t) => {
    const f = await fixture(t);
    const ledgerBefore = Object.fromEntries(readdirSync(f.ledger.directory).map((name) =>
      [name, readFileSync(path.join(f.ledger.directory, name))]));
    let keyReads = 0;
    const observed = [];
    const runCli = async (mode) => {
      let out = '', err = '';
      const status = await main(['--plan', f.planPath, mode], {
        stdout: { write(value) { out += value; } }, stderr: { write(value) { err += value; } },
        readKey() { keyReads++; return 'synthetic-only'; },
        fetchImpl: (url, options) => responseFor(url, options, observed),
      });
      return { status, out, err };
    };
    const dry = await runCli('--dry-run');
    assert.equal(dry.status, 0, dry.err);
    assert.equal(keyReads, 0);
    assert.equal(observed.length, 0);
    assert.deepEqual(Object.fromEntries(readdirSync(f.ledger.directory).map((name) =>
      [name, readFileSync(path.join(f.ledger.directory, name))])), ledgerBefore);
    assert.deepEqual(readdirSync(f.planDir), ['plan.json']);
    const launched = await runCli('--launch');
    assert.equal(launched.status, 0, launched.err || launched.out);
    assert.equal(keyReads, 1);
    const report = JSON.parse(readFileSync(path.join(f.plan.outputDirectory, 'report.json'), 'utf8'));
    assert.equal(report.fixedCaseCount, 2);
    assert.equal(report.generationRecordCount, 2);
    assert.equal(report.scoringRecordCount, 2);
    assert.deepEqual(report.diagnostics, { version: 1, attemptedCaseCount: 2,
      projectionWriteFailures: 0 });
    assert.equal(report.accounting.owned.requests, observed.length);
    assert.equal(report.accounting.attempts.length, observed.length);
    assert.equal(report.accounting.owned.requests <= report.accounting.shadow.used.generation.requests
      + report.accounting.shadow.used.scoring.requests, true);
    const chats = observed.filter((item) => item.url.endsWith('/chat/completions'));
    assert.deepEqual(chats.map((item) => item.body.model), [
      ...Array(4).fill(benchmarkStagePolicy().answer.model),
      ...Array(4).fill(benchmarkStagePolicy().judge.model)]);
    const evidence = chats.slice(0, 4).map((item) => JSON.parse(item.body.messages[1].content).evidence);
    assert.ok(evidence[0][0].receipts.some((receipt) => receipt.excerpt === 'x'.repeat(800)));
    assert.ok(evidence[1][0].receipts.some((receipt) => receipt.excerpt.includes('Friday is the day')));
    assert.ok(!JSON.stringify(chats).includes('GENERATED_SUMMARY_POISON'));
    for (const questionId of f.roster.map((entry) => entry.questionId)) {
      const caseDirectory = path.join(f.plan.outputDirectory, 'cases', questionId);
      const diagnostic = JSON.parse(readFileSync(path.join(caseDirectory, 'diagnostics.json'), 'utf8'));
      assert.equal(diagnostic.version, 1);
      for (const name of ['qualified-prefix', 'indexed-windows']) {
        assert.equal(diagnostic.arms[name].available, true);
        assert.deepEqual(diagnostic.arms[name].events, []);
        assert.deepEqual(diagnostic.arms[name].collection, {
          slotLimit: 64, slotBytes: 256, capacityReached: false, overflow: false,
          corrupted: false, writeFailed: false, deliveryGuaranteed: false,
        });
        assert.deepEqual(readdirSync(path.join(caseDirectory, `diagnostics-${name}`)), []);
      }
    }
    assert.ok(!launched.out.includes('Friday is the day'));
    const replay = await runCli('--launch');
    assert.equal(replay.status, 1);
    assert.match(replay.err, /launch_consumed/);
    assert.equal(keyReads, 1);
  });

test('L1 malformed, missing and reordered roster and phase headroom refuse before claim',
  { timeout: 120_000 }, async (t) => {
    const f = await fixture(t);
    const original = structuredClone(f.plan);
    let reads = 0, calls = 0;
    const run = async (changed) => {
      writeFileSync(f.planPath, `${JSON.stringify(changed)}\n`, { mode: 0o600 });
      let err = '';
      const status = await main(['--plan', f.planPath, '--dry-run'], {
        stderr: { write(value) { err += value; } }, stdout: { write() { assert.fail('no success'); } },
        readKey() { reads++; return 'synthetic-only'; },
        fetchImpl() { calls++; assert.fail('no HTTP'); },
      });
      assert.equal(status, 1);
      return err.trim();
    };
    assert.equal(await run({ ...original, unknown: true }), 'invalid_plan');
    assert.equal(await run({ ...original, executionId: 's'.repeat(81) }), 'invalid_plan');
    assert.equal(await run({ ...original, roster: original.roster.slice(0, 1) }), 'roster_mismatch');
    assert.equal(await run({ ...original, roster: [...original.roster].reverse() }), 'roster_mismatch');
    assert.equal(await run({ ...original, phaseCaps: { ...original.phaseCaps,
      generation: { requests: 101, reservedMicroUsd: 1_000_000 } } }),
    'phase_caps_exceed_headroom');
    assert.equal(await run({ ...original, roster: original.roster.map((item, index) =>
      index ? { ...item, protocolDigest: '0'.repeat(64) } : item) }), 'protocol_mismatch');
    assert.equal(await run({ ...original, harness: { ...original.harness, sourceHashes: {
      ...original.harness.sourceHashes,
      'evaluation/longmemeval/official-scoring.mjs': '0'.repeat(64),
    } } }), 'harness_mismatch');
    assert.equal(await run({ ...original, harness: { ...original.harness, sourceHashes: {
      ...original.harness.sourceHashes,
      'evaluation/live/diagnostics.mjs': '0'.repeat(64),
    } } }), 'harness_mismatch');
    assert.equal(reads, 0);
    assert.equal(calls, 0);
    assert.deepEqual(readdirSync(f.planDir), ['plan.json']);
  });

test('O2/O4 installed adapter and core qualification failures stay in their own arm and case',
  { timeout: 120_000 }, async (t) => {
    const f = await fixture(t);
    const observed = [];
    let qualifications = 0;
    let out = '', err = '';
    const status = await main(['--plan', f.planPath, '--launch'], {
      stdout: { write(value) { out += value; } }, stderr: { write(value) { err += value; } },
      readKey() { return 'synthetic-only'; },
      fetchImpl: (url, options) => responseFor(url, options, observed, (method, input, output) => {
        if (method !== 'qualifyCandidates') return output;
        qualifications++;
        if (qualifications === 1) return { qualifications: {} }; // Adapter shape rejection.
        if (qualifications === 2) {
          const entry = output.qualifications[`item_${input.items[0].itemIndex}`];
          entry.value.evidenceSlots = [];
        }
        return output; // Adapter accepts; core rejects unselected pool members as non-citations.
      }),
    });
    assert.equal(status, 0, err || out);
    assert.equal(qualifications >= 2, true);
    const report = JSON.parse(readFileSync(path.join(f.plan.outputDirectory, 'report.json'), 'utf8'));
    assert.equal(report.fixedCaseCount, 2);
    assert.equal(report.generationRecordCount, 2);
    assert.equal(report.accounting.owned.requests, observed.length);
    const first = path.join(f.plan.outputDirectory, 'cases', f.roster[0].questionId);
    const second = path.join(f.plan.outputDirectory, 'cases', f.roster[1].questionId);
    const firstDiagnostics = JSON.parse(readFileSync(path.join(first, 'diagnostics.json'), 'utf8'));
    const secondDiagnostics = JSON.parse(readFileSync(path.join(second, 'diagnostics.json'), 'utf8'));
    assert.ok(firstDiagnostics.arms['qualified-prefix'].events.some((event) =>
      event.stage === 'qualifyCandidates' && event.layer === 'adapter' && event.reason === 'output_shape'));
    assert.ok(firstDiagnostics.arms['indexed-windows'].events.some((event) =>
      event.stage === 'qualifyCandidates' && event.layer === 'core_validation'
        && event.reason === 'qualification_citation_integrity'));
    assert.ok(firstDiagnostics.arms['qualified-prefix'].events.every((event) =>
      event.layer !== 'core_validation'));
    for (const name of ['qualified-prefix', 'indexed-windows']) {
      assert.deepEqual(secondDiagnostics.arms[name].events, []);
      assert.equal(secondDiagnostics.arms[name].available, true);
    }
    assert.ok(!out.includes('Synthetic'));
  });

test('O5 failed observer and overflow are explicit without changing guarded work',
  { timeout: 120_000 }, async (t) => {
    const f = await fixture(t);
    const first = path.join(f.plan.outputDirectory, 'cases', f.roster[0].questionId);
    let corrupted = false;
    const observed = [];
    let err = '';
    const status = await main(['--plan', f.planPath, '--launch'], {
      stdout: { write() {} }, stderr: { write(value) { err += value; } },
      readKey() { return 'synthetic-only'; },
      fetchImpl(url, options) {
        const body = JSON.parse(options.body);
        if (!corrupted && url.endsWith('/responses')
          && body.text?.format?.name === 'cairn_qualifyCandidates') {
          corrupted = true;
          chmodSync(path.join(first, 'diagnostics-qualified-prefix'), 0o500);
          return responseFor(url, options, observed, (method, _input, output) =>
            method === 'qualifyCandidates' ? { qualifications: {} } : output);
        }
        return responseFor(url, options, observed);
      },
    });
    assert.equal(status, 0, err);
    assert.equal(corrupted, true);
    const report = JSON.parse(readFileSync(path.join(f.plan.outputDirectory, 'report.json'), 'utf8'));
    assert.equal(report.accounting.owned.requests, observed.length);
    const firstGeneration = JSON.parse(readFileSync(path.join(first, 'generation.json'), 'utf8'));
    assert.equal(firstGeneration.arms.find((arm) => arm.name === 'qualified-prefix').reason,
      'ingestion_incomplete');
    const projected = JSON.parse(readFileSync(path.join(first, 'diagnostics.json'), 'utf8'));
    assert.equal(projected.arms['qualified-prefix'].available, true);
    assert.equal(projected.arms['qualified-prefix'].collection.corrupted, true);
    assert.deepEqual(projected.arms['qualified-prefix'].events, []);
    assert.equal(projected.arms['indexed-windows'].collection.corrupted, false);

    const overflowFixture = await fixture(t);
    const overflowFirst = path.join(overflowFixture.plan.outputDirectory, 'cases',
      overflowFixture.roster[0].questionId);
    const overflowCalls = [];
    let flooded = false;
    const overflowStatus = await main(['--plan', overflowFixture.planPath, '--launch'], {
      stdout: { write() {} }, stderr: { write(value) { err += value; } },
      readKey() { return 'synthetic-only'; },
      fetchImpl(url, options) {
        if (!flooded) {
          flooded = true;
          const collect = createDiagnosticCollector(path.join(overflowFirst,
            'diagnostics-qualified-prefix'));
          for (let index = 0; index < 65; index++) collect({ version: 1,
            stage: 'extract', layer: 'adapter', reason: 'request_bounds' });
        }
        return responseFor(url, options, overflowCalls);
      },
    });
    assert.equal(overflowStatus, 0, err);
    const overflowReport = JSON.parse(readFileSync(path.join(overflowFixture.plan.outputDirectory,
      'report.json'), 'utf8'));
    const overflowProjection = JSON.parse(readFileSync(path.join(overflowFirst,
      'diagnostics.json'), 'utf8'));
    assert.equal(overflowProjection.arms['qualified-prefix'].events.length, 64);
    assert.equal(overflowProjection.arms['qualified-prefix'].collection.capacityReached, true);
    assert.equal(overflowProjection.arms['qualified-prefix'].collection.overflow, true);
    assert.deepEqual(overflowProjection.arms['indexed-windows'].events, []);
    assert.equal(overflowReport.accounting.owned.requests, overflowCalls.length);
    assert.equal(overflowReport.fixedCaseCount, report.fixedCaseCount);
  });

test('O5 diagnostic projection write failure stays bounded and cannot replace the result',
  { timeout: 120_000 }, async (t) => {
    const f = await fixture(t);
    const target = path.join(f.plan.outputDirectory, 'cases', f.roster[0].questionId,
      'diagnostics.json');
    let blocked = false;
    const observed = [];
    let err = '';
    const status = await main(['--plan', f.planPath, '--launch'], {
      stdout: { write() {} }, stderr: { write(value) { err += value; } },
      readKey() { return 'synthetic-only'; },
      fetchImpl(url, options) {
        if (!blocked) {
          blocked = true;
          writeFileSync(target, 'synthetic occupied output', { mode: 0o600, flag: 'wx' });
        }
        return responseFor(url, options, observed);
      },
    });
    assert.equal(status, 0, err);
    assert.equal(readFileSync(target, 'utf8'), 'synthetic occupied output');
    const report = JSON.parse(readFileSync(path.join(f.plan.outputDirectory, 'report.json'), 'utf8'));
    assert.equal(report.status, 'completed');
    assert.equal(report.accounting.owned.requests, observed.length);
    assert.deepEqual(report.diagnostics, { version: 1, attemptedCaseCount: 2,
      projectionWriteFailures: 1 });
  });

test('O4 a delayed installed-adapter diagnostic cannot write after its scope is sealed',
  { timeout: 120_000 }, async (t) => {
    const f = await fixture(t);
    const originalSetTimeout = globalThis.setTimeout;
    const projectionPath = path.join(f.plan.outputDirectory, 'cases', f.roster[0].questionId,
      'diagnostics.json');
    let shortened = false, delayed = false, releaseLate;
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (delay === 30_000 && !shortened) {
        shortened = true;
        return originalSetTimeout(callback, 40, ...args);
      }
      return originalSetTimeout(callback, delay, ...args);
    };
    let status;
    try {
      status = await main(['--plan', f.planPath, '--launch'], {
        stdout: { write() {} }, stderr: { write() {} },
        readKey() { return 'synthetic-only'; },
        fetchImpl(url, options) {
          const body = JSON.parse(options.body);
          if (!delayed && url.endsWith('/responses') && body.text?.format?.name === 'cairn_extract') {
            delayed = true;
            return new Promise((_, reject) => {
              releaseLate = () => reject(new Error('synthetic late transport failure'));
            });
          }
          return responseFor(url, options, []);
        },
      });
    } finally { globalThis.setTimeout = originalSetTimeout; }
    assert.equal(shortened, true);
    assert.equal(delayed, true);
    assert.equal(status, 0);
    assert.equal(typeof releaseLate, 'function');
    assert.equal(JSON.parse(readFileSync(projectionPath, 'utf8')).version, 1,
      'The first case must be projected after its scope closes');
    const directory = path.join(f.plan.outputDirectory, 'cases', f.roster[0].questionId,
      'diagnostics-qualified-prefix');
    const before = readDiagnostics(directory);
    assert.ok(before.events.some((event) => event.stage === 'extract'
      && event.layer === 'core_call' && event.reason === 'model_timeout'));
    releaseLate();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(readDiagnostics(directory), before);
    assert.equal(before.events.some((event) => event.layer === 'adapter'
      && event.reason === 'transport_failure'), false);
  });

test('O4 failed-arm diagnostics survive a refused generation record',
  { timeout: 120_000 }, async (t) => {
    const f = await fixture(t);
    const first = path.join(f.plan.outputDirectory, 'cases', f.roster[0].questionId);
    const generationPath = path.join(first, 'generation.json');
    let occupied = false;
    let err = '';
    const status = await main(['--plan', f.planPath, '--launch'], {
      stdout: { write() {} }, stderr: { write(value) { err += value; } },
      readKey() { return 'synthetic-only'; },
      fetchImpl(url, options) {
        if (!occupied) {
          occupied = true;
          writeFileSync(generationPath, 'synthetic occupied output', { mode: 0o600, flag: 'wx' });
        }
        return responseFor(url, options, [], (method, _input, output) =>
          method === 'qualifyCandidates' ? { qualifications: {} } : output);
      },
    });
    assert.equal(status, 1, err);
    assert.equal(occupied, true);
    assert.equal(readFileSync(generationPath, 'utf8'), 'synthetic occupied output');
    const report = JSON.parse(readFileSync(path.join(f.plan.outputDirectory, 'report.json'), 'utf8'));
    assert.equal(report.status, 'halted');
    assert.equal(report.firstFailure, 'launch_output_failed');
    assert.equal(report.generationRecordCount, 1);
    assert.equal(report.scoringRecordCount, 0);
    assert.deepEqual(report.diagnostics, { version: 1, attemptedCaseCount: 1,
      projectionWriteFailures: 0 });
    const diagnostics = JSON.parse(readFileSync(path.join(first, 'diagnostics.json'), 'utf8'));
    assert.ok(diagnostics.arms['qualified-prefix'].events.some((event) =>
      event.stage === 'qualifyCandidates' && event.layer === 'adapter'
        && event.reason === 'output_shape'));
  });

test('L3 terminal persistence failure retains the earlier global halt and consumed marker',
  { timeout: 120_000 }, async (t) => {
    for (const failureRecordUnavailable of [false, true]) {
      const f = await fixture(t);
      const reportPath = path.join(f.plan.outputDirectory, 'report.json');
      const failurePath = path.join(f.planDir,
        `qualified-source-pair-launch-${f.plan.executionId}.failure.json`);
      let judgeRequests = 0;
      let err = '';
      const status = await main(['--plan', f.planPath, '--launch'], {
        stderr: { write(value) { err += value; } }, stdout: { write() { assert.fail('no success'); } },
        readKey() { return 'synthetic-only'; },
        fetchImpl(url, options) {
          if (url.endsWith('/chat/completions')
            && options.body.includes(benchmarkStagePolicy().judge.model)) {
            judgeRequests++;
            writeFileSync(reportPath, 'incomplete', { flag: 'wx', mode: 0o600 });
            if (failureRecordUnavailable) {
              writeFileSync(failurePath, 'incomplete', { flag: 'wx', mode: 0o600 });
            }
            return Response.json({ error: { message: 'synthetic-rate-limit' } }, { status: 429 });
          }
          return responseFor(url, options, []);
        },
      });
      assert.equal(status, 1);
      assert.equal(err, 'launch_output_failed\n');
      assert.equal(judgeRequests, 1);
      assert.equal(readFileSync(reportPath, 'utf8'), 'incomplete');
      const marker = path.join(f.planDir,
        `qualified-source-pair-launch-${f.plan.executionId}.json`);
      assert.equal(JSON.parse(readFileSync(marker, 'utf8')).planSha256,
        sha(readFileSync(f.planPath)));
      if (!failureRecordUnavailable) {
        const recorded = JSON.parse(readFileSync(failurePath, 'utf8'));
        assert.equal(recorded.markerConsumed, true);
        assert.equal(recorded.firstFailure, 'global_halt');
        assert.equal(recorded.firstFailureStage, 'scoring');
        assert.deepEqual(recorded.secondaryFailures, [
          { stage: 'terminal_persistence_or_accounting', code: 'launch_output_failed' },
        ]);
      } else assert.equal(readFileSync(failurePath, 'utf8'), 'incomplete');
    }
  });

test('L1 private modes, symlink plan and output/input collision refuse before claim or key',
  { timeout: 120_000 }, async (t) => {
    const f = await fixture(t);
    const originalBytes = readFileSync(f.planPath);
    const ledgerNames = readdirSync(f.ledger.directory);
    let keyReads = 0, httpCalls = 0;
    const refuse = async (planPath = f.planPath) => {
      let err = '';
      const status = await main(['--plan', planPath, '--dry-run'], {
        stderr: { write(value) { err += value; } },
        stdout: { write() { assert.fail('unexpected successful preflight'); } },
        readKey() { keyReads++; assert.fail('key before preflight'); },
        fetchImpl() { httpCalls++; assert.fail('HTTP before preflight'); },
      });
      assert.equal(status, 1);
      assert.equal(err, 'invalid_plan\n');
      assert.deepEqual(readdirSync(f.ledger.directory), ledgerNames);
      assert.equal(keyReads, 0);
      assert.equal(httpCalls, 0);
    };
    chmodSync(f.planPath, 0o644);
    await refuse();
    chmodSync(f.planPath, 0o600);
    chmodSync(f.planDir, 0o755);
    await refuse();
    chmodSync(f.planDir, 0o700);
    const alias = path.join(f.planDir, 'alias.json');
    symlinkSync(f.planPath, alias);
    await refuse(alias);
    unlinkSync(alias);
    writeFileSync(f.planPath, `${JSON.stringify({ ...f.plan,
      outputDirectory: f.plan.prepared.directory })}\n`, { mode: 0o600 });
    await refuse();
    writeFileSync(f.planPath, originalBytes, { mode: 0o600 });
    assert.deepEqual(readdirSync(f.planDir), ['plan.json']);
  });

test('L2 actual installed core timeout remains local with later preselected slots',
  { timeout: 120_000 }, async (t) => {
    const f = await fixture(t);
    const originalSetTimeout = globalThis.setTimeout;
    let hung = false, shortened = false, out = '', err = '';
    globalThis.setTimeout = (callback, delay, ...args) => {
      if (delay === 30_000 && !shortened) {
        shortened = true;
        return originalSetTimeout(callback, 40, ...args);
      }
      return originalSetTimeout(callback, delay, ...args);
    };
    let status;
    try {
      status = await main(['--plan', f.planPath, '--launch'], {
        stdout: { write(value) { out += value; } }, stderr: { write(value) { err += value; } },
        readKey() { return 'synthetic-only'; },
        fetchImpl(url, options) {
          const body = JSON.parse(options.body);
          if (!hung && url.endsWith('/responses')
            && body.text?.format?.name === 'cairn_extract') {
            hung = true;
            return new Promise((_, reject) => options.signal.addEventListener('abort',
              () => reject(new Error('synthetic aborted fetch')), { once: true }));
          }
          return responseFor(url, options, []);
        },
      });
    } finally { globalThis.setTimeout = originalSetTimeout; }
    assert.equal(hung, true);
    assert.equal(shortened, true);
    assert.equal(status, 0, err || out);
    const report = JSON.parse(readFileSync(path.join(f.plan.outputDirectory, 'report.json'), 'utf8'));
    assert.equal(report.status, 'completed');
    assert.equal(report.fixedCaseCount, 2);
    assert.equal(report.generationRecordCount, 2);
    assert.equal(report.scoringRecordCount, 2);
    assert.ok(report.accounting.owned.requests > 2);
    assert.ok(report.accounting.owned.unknownCostRequests >= 1);
    assert.ok(report.accounting.caseTimeouts.some((entry) => entry.termination === 'core_deadline'));
  });

test('L3 post-marker key and output failures consume launch without provider forward or retry',
  { timeout: 120_000 }, async (t) => {
    for (const failure of ['key', 'output']) {
      const f = await fixture(t);
      let calls = 0, err = '';
      const status = await main(['--plan', f.planPath, '--launch'], {
        stderr: { write(value) { err += value; } }, stdout: { write() { assert.fail('no success'); } },
        readKey() {
          if (failure === 'key') throw new Error('synthetic key read failure');
          mkdirSync(f.plan.outputDirectory, { mode: 0o700 });
          return 'synthetic-only';
        },
        fetchImpl() { calls++; assert.fail('no HTTP'); },
      });
      assert.equal(status, 1);
      assert.equal(calls, 0);
      assert.equal(err, failure === 'key' ? 'launch_failed\n' : 'output_exists\n');
      const marker = path.join(f.planDir, `qualified-source-pair-launch-${f.plan.executionId}.json`);
      const failureFile = path.join(f.planDir,
        `qualified-source-pair-launch-${f.plan.executionId}.failure.json`);
      assert.equal(JSON.parse(readFileSync(marker, 'utf8')).planSha256, sha(readFileSync(f.planPath)));
      assert.equal(JSON.parse(readFileSync(failureFile, 'utf8')).markerConsumed, true);
      let replayError = '';
      const replay = await main(['--plan', f.planPath, '--launch'], {
        stderr: { write(value) { replayError += value; } }, stdout: { write() {} },
        readKey() { assert.fail('replay key read'); },
        fetchImpl() { assert.fail('replay provider'); },
      });
      assert.equal(replay, 1);
      assert.equal(replayError, 'launch_consumed\n');
    }
  });
