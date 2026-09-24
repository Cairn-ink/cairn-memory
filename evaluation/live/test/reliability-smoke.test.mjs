import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { chmod, lstat, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { createExperimentBudget, reopenExperimentBudget } from '../../experiment-budget/index.mjs';
import { authorizeBenchmarkBudgetExtension, authorizeBenchmarkExtension,
  authorizeBenchmarkRequestAllowance, createExperimentRequestGuard } from '../../experiment-budget/request-guard.mjs';
import { prepareLongMemEval } from '../../longmemeval/prepare.mjs';
import { main } from '../reliability-smoke-cli.mjs';
import { FRESH_SMOKE_TYPES, selectFreshSmoke, smokeSha256 } from '../reliability-smoke.mjs';
import { benchmarkStagePolicy } from '../public-pilot.mjs';
import { experimentPolicy } from '../session.mjs';

const KEY = 'synthetic-smoke-key-never-print';
const PRIVATE_TEXT = 'synthetic-private-roster-text-never-print';
const COMMIT = 'a'.repeat(40);
const stream = () => { const chunks = []; return { write(value) { chunks.push(String(value)); return true; },
  text() { return chunks.join(''); } }; };
const canonical = (value) => JSON.stringify(value, (key, item) => item && !Array.isArray(item)
  && typeof item === 'object' ? Object.fromEntries(Object.entries(item).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0)) : item);
const fixture = (index) => {
  const id = `synthetic-${String(index).padStart(3, '0')}`;
  return { question_id: id, question_type: FRESH_SMOKE_TYPES[index % 6],
    question: `What color is item ${index}?`, answer: 'amber', question_date: 'Saturday',
    haystack_session_ids: [`${id}-session`], haystack_dates: ['Friday'],
    haystack_sessions: [[{ role: 'user', content: `Item ${index} is amber. ${PRIVATE_TEXT}`,
      has_answer: true }]], answer_session_ids: [`${id}-session`] };
};
const save = async (filename, value, mode = 0o600) => {
  const content = typeof value === 'string' ? value : `${JSON.stringify(value)}\n`;
  await writeFile(filename, content, { mode });
  return smokeSha256(content);
};
const state = (ledger) => { const handle = reopenExperimentBudget(ledger);
  try { return handle.getState(); } finally { handle.close(); } };
const checkpoint = (ledger) => {
  const value = state(ledger);
  const rows = value.attempts.map((attempt) => ({ attemptId: attempt.attemptId,
    channel: attempt.channel, reservedMicroUsd: attempt.reservedMicroUsd,
    outcome: attempt.outcome, actualMicroUsd: attempt.actualMicroUsd }));
  return { requestCount: value.requestCount, reservedMicroUsd: value.reservedMicroUsd,
    attemptsSha256: smokeSha256(canonical(rows)) };
};
const fakeHttp = (calls, variant = 'success') => async (url, options) => {
  const body = JSON.parse(options.body);
  calls.push({ url: String(url), body });
  if (variant === 'global-halt' && calls.length === 1) return Response.json({ invalid: true });
  if (variant === 'timeout-first' && calls.length === 1) return new Promise((resolve, reject) => {
    const abort = () => reject(new DOMException('synthetic timeout', 'AbortError'));
    if (options.signal.aborted) abort();
    else options.signal.addEventListener('abort', abort, { once: true });
  });
  if (url.endsWith('/responses/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  if (url.endsWith('/responses')) {
    const method = body.text.format.name.replace(/^cairn_/u, '');
    const output = method === 'extract' ? { items: [] } : method === 'classify' ? { items: [] }
      : { refs: [] };
    return Response.json({ id: 'synthetic', object: 'response', model: body.model,
      status: 'completed', error: null, incomplete_details: null,
      output: [{ id: 'synthetic-message', type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
  }
  if (url.endsWith('/chat/completions')) return Response.json({ id: 'synthetic-chat', object: 'chat.completion',
    model: body.model, choices: [{ index: 0, message: { role: 'assistant',
      content: body.model === 'gpt-4o-2024-08-06' ? 'yes' : 'amber' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 50, completion_tokens: 1, total_tokens: 51 } });
  return assert.fail('unexpected route');
};

async function setup(t, { largeSelected = false } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), 'cairn-fresh-smoke-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = Array.from({ length: 500 }, (_, index) => fixture(index));
  const exclusions = source.slice(0, 82).map((item) => item.question_id);
  const selection = selectFreshSmoke(source, exclusions);
  if (largeSelected) for (const item of source) {
    if (!selection.sourceQuestionIdsPreparedOrder.includes(item.question_id)) continue;
    item.haystack_session_ids = Array.from({ length: 100 }, (_, index) => `${item.question_id}-session-${index}`);
    item.haystack_dates = Array.from({ length: 100 }, () => 'Friday');
    item.haystack_sessions = Array.from({ length: 100 }, (_, index) => [
      { role: 'user', content: `Item ${index} is amber.`, has_answer: index === 0 }]);
    item.answer_session_ids = [item.haystack_session_ids[0]];
  }
  const sourcePath = path.join(root, 'source.json');
  const exclusionsPath = path.join(root, 'exclusions.json');
  const sourceSha256 = await save(sourcePath, source);
  const exclusionsSha256 = await save(exclusionsPath, exclusions);
  const prepared = path.join(root, 'prepared');
  await prepareLongMemEval({ inputPath: sourcePath, expectedSha256: sourceSha256,
    datasetRevision: 'synthetic-smoke', datasetVariant: 's-cleaned',
    questionIds: selection.sourceQuestionIdsPreparedOrder, outputDirectory: prepared });
  const preparedHashes = {};
  for (const name of ['manifest', 'history', 'questions', 'evaluator']) {
    preparedHashes[`${name}Sha256`] = smokeSha256(await readFile(path.join(prepared,
      `${name}.${name === 'manifest' ? 'json' : 'jsonl'}`)));
  }
  const manifest = JSON.parse(await readFile(path.join(prepared, 'manifest.json'), 'utf8'));
  const sidecarPath = path.join(root, 'sidecar.json');
  const sidecarSha256 = await save(sidecarPath, {
    schema_version: 'cairn-longmemeval-reference-rendering-v1', renderer: 'python3-json-load-str-v1',
    python_version: '3.12.0', source_sha256: sourceSha256,
    manifest_sha256: preparedHashes.manifestSha256, evaluator_sha256: preparedHashes.evaluatorSha256,
    cases: manifest.selection.source_question_ids.map((id, index) => ({
      source_question_id: id, question_id: manifest.selection.question_ids[index], reference_text: 'amber' })),
  });
  const baseLedger = { directory: path.join(root, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  createExperimentBudget(baseLedger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: baseLedger, policy, fetchImpl: () => assert.fail('transport') }).close();
  const benchmark = authorizeBenchmarkExtension({ ledger: baseLedger, policy,
    authorizationId: 'synthetic-smoke-benchmark', stages: benchmarkStagePolicy() });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: baseLedger, policy,
    benchmarkExtension: benchmark, authorizationId: 'synthetic-smoke-allowance',
    newRequestCap: 20, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const intermediate = { ...baseLedger, requestCap: 20 };
  const budget = authorizeBenchmarkBudgetExtension({ oldLedger: intermediate, policy,
    requestAllowance: allowance, authorizationId: 'synthetic-smoke-budget',
    newLimitMicroUsd: 100_000_000, newRequestCap: 5_000,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const ledger = { ...intermediate, limitMicroUsd: 100_000_000, requestCap: 5_000 };
  const ledgerPath = path.join(root, 'ledger-config.json');
  const ledgerSha256 = await save(ledgerPath, ledger);
  const keyFile = path.join(root, 'authorized.env');
  await save(keyFile, `OPENAI_API_KEY=${KEY}\n`, 0o644);
  const planPath = path.join(root, 'launch-plan.json');
  const plan = { version: 'cairn-fresh-reliability-smoke-launch-v1',
    source: { path: sourcePath, sha256: sourceSha256 },
    exclusions: { path: exclusionsPath, sha256: exclusionsSha256 },
    prepared: { directory: prepared, ...preparedHashes },
    sidecar: { path: sidecarPath, sha256: sidecarSha256 },
    ledger: { path: ledgerPath, sha256: ledgerSha256 },
    selection: { membershipSha256: selection.membershipSha256,
      preparedOrderSha256: selection.preparedOrderSha256 },
    runtimeCommit: COMMIT,
    authorizations: { benchmark: benchmark.authorizationId, requestAllowance: allowance.authorizationId,
      budgetExtension: budget.authorizationId, case: 'synthetic-smoke-case', execution: 'synthetic-smoke-execution' },
    checkpoint: checkpoint(ledger), projection: { requests: 96,
      reservedMicroUsd: 6 * ((4 + 6) * 5_000 + 3 * 50_820 + 3 * 10_400) },
    outputDirectory: path.join(root, 'output'), keyFile };
  await save(planPath, plan);
  return { root, source, exclusions, selection, plan, planPath, ledger, keyFile, sourcePath,
    writePlan: async (value) => save(planPath, value) };
}

async function run(f, mode, fetchImpl = () => assert.fail('dry-run transport')) {
  const stdout = stream(); const stderr = stream();
  const code = await main(['--plan', f.planPath, mode], { stdout, stderr, fetchImpl,
    inspectRuntime: (commit) => assert.equal(commit, COMMIT) });
  return { code, stdout: stdout.text(), stderr: stderr.text() };
}

test('selection uses only ID/type, excludes 82, and retains source order', () => {
  const source = Array.from({ length: 500 }, (_, index) => fixture(index));
  const exclusions = source.slice(0, 82).map((item) => item.question_id);
  const first = selectFreshSmoke(source, exclusions);
  const changed = source.map((item) => ({ ...item, answer: 'changed', haystack_sessions: [] }));
  assert.deepEqual(selectFreshSmoke(changed, exclusions), first);
  const reversed = selectFreshSmoke([...source].reverse(), exclusions);
  assert.equal(reversed.membershipSha256, first.membershipSha256);
  assert.notEqual(reversed.preparedOrderSha256, first.preparedOrderSha256);
  assert.equal(first.selectedByType.length, 6);
  assert.ok(first.sourceQuestionIdsPreparedOrder.every((id) => !exclusions.includes(id)));
  assert.deepEqual(first.sourceQuestionIdsPreparedOrder, source
    .filter((item) => first.selectedByType.some((selected) => selected.sourceQuestionId === item.question_id))
    .map((item) => item.question_id));
});

test('keyless dry-run is read-only, validates hashes/roster/checkpoint/runtime and redacts output', async (t) => {
  const f = await setup(t);
  const before = state(f.ledger);
  const okay = await run(f, '--dry-run');
  assert.equal(okay.code, 0, okay.stderr);
  assert.equal(JSON.parse(okay.stdout).projectedRequests, 96);
  assert.deepEqual(state(f.ledger), before);
  assert.doesNotMatch(okay.stdout, /synthetic-private|synthetic-smoke-key|lme-case-|\/tmp\//u);
  let keyReads = 0;
  assert.equal(await main(['--plan', f.planPath, '--dry-run'], { stdout: stream(), stderr: stream(),
    inspectRuntime: () => {}, fetchImpl: () => assert.fail('dry-run transport'),
    readKey: () => { keyReads += 1; throw new Error('key must remain unread'); } }), 0);
  assert.equal(keyReads, 0);
  const realRuntimeError = stream();
  assert.equal(await main(['--plan', f.planPath, '--dry-run'], { stdout: stream(),
    stderr: realRuntimeError, fetchImpl: () => assert.fail('transport') }), 1);
  assert.equal(realRuntimeError.text(), 'runtime_mismatch\n');
  await assert.rejects(lstat(path.join(f.ledger.directory,
    'experiment-case-deadline-synthetic-smoke-execution.json')), { code: 'ENOENT' });
  const wrongRuntime = await main(['--plan', f.planPath, '--dry-run'], {
    stdout: stream(), stderr: stream(), inspectRuntime: () => { throw new Error('runtime'); } });
  assert.equal(wrongRuntime, 1);
  const wrongHash = { ...f.plan, source: { ...f.plan.source, sha256: '0'.repeat(64) } };
  await f.writePlan(wrongHash);
  assert.equal((await run(f, '--dry-run')).stderr, 'source_hash_mismatch\n');
  await f.writePlan(f.plan);
  const manifestPath = path.join(f.plan.prepared.directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
  const oldManifest = await readFile(manifestPath);
  [manifest.selection.source_question_ids[0], manifest.selection.source_question_ids[1]] =
    [manifest.selection.source_question_ids[1], manifest.selection.source_question_ids[0]];
  [manifest.selection.question_ids[0], manifest.selection.question_ids[1]] =
    [manifest.selection.question_ids[1], manifest.selection.question_ids[0]];
  const alteredManifestSha256 = await save(manifestPath, `${JSON.stringify(manifest)}\n`);
  await f.writePlan({ ...f.plan, prepared: { ...f.plan.prepared,
    manifestSha256: alteredManifestSha256 } });
  assert.equal((await run(f, '--dry-run')).stderr, 'prepared_roster_mismatch\n');
  await writeFile(manifestPath, oldManifest);
  await f.writePlan(f.plan);
  await f.writePlan({ ...f.plan, sidecar: { ...f.plan.sidecar, sha256: '0'.repeat(64) } });
  assert.equal((await run(f, '--dry-run')).stderr, 'sidecar_hash_mismatch\n');
  await f.writePlan(f.plan);
  const wrongProjection = { ...f.plan, projection: { requests: 1, reservedMicroUsd: 1 } };
  await f.writePlan(wrongProjection);
  assert.equal((await run(f, '--dry-run')).stderr, 'projection_exceeds_cap\n');
  await f.writePlan(f.plan);
  const wrongCheckpoint = { ...f.plan, checkpoint: { ...f.plan.checkpoint, requestCount: 1 } };
  await f.writePlan(wrongCheckpoint);
  assert.equal((await run(f, '--dry-run')).stderr, 'checkpoint_mismatch\n');
  await f.writePlan(f.plan);
  const wrongRoster = { ...f.plan, selection: { ...f.plan.selection,
    membershipSha256: '0'.repeat(64) } };
  await f.writePlan(wrongRoster);
  assert.equal((await run(f, '--dry-run')).stderr, 'selection_mismatch\n');
});

test('private input permissions and symlinks refuse before delegation', async (t) => {
  const f = await setup(t);
  await chmod(f.sourcePath, 0o644);
  assert.equal((await run(f, '--dry-run')).stderr, 'source_invalid\n');
  await chmod(f.sourcePath, 0o600);
  const realPlan = path.join(f.root, 'real-plan.json');
  await writeFile(realPlan, await readFile(f.planPath), { mode: 0o600 });
  await rm(f.planPath);
  await symlink(realPlan, f.planPath);
  assert.equal((await run(f, '--dry-run')).stderr, 'invalid_plan\n');
});

test('full prepared projection above the phase cap refuses before delegation', async (t) => {
  const f = await setup(t, { largeSelected: true });
  const result = await run(f, '--dry-run');
  assert.equal(result.code, 1);
  assert.equal(result.stderr, 'projection_exceeds_cap\n');
  assert.equal(state(f.ledger).requestCount, 0);
});

test('delegate error text cannot escape and a post-marker key failure is terminal', async (t) => {
  const f = await setup(t);
  const stdout = stream(); const stderr = stream();
  const leaked = await main(['--plan', f.planPath, '--dry-run'], { stdout, stderr,
    inspectRuntime: () => {}, delegateMain: async (args, options) => {
      options.stderr.write(`lme-case-${'f'.repeat(64)} ${PRIVATE_TEXT} ${KEY}\n`);
      return 1;
    } });
  assert.equal(leaked, 1);
  assert.equal(stderr.text(), 'delegate_failed\n');
  assert.equal(stdout.text(), '');
  const launchError = stream();
  const code = await main(['--plan', f.planPath, '--launch'], { stdout: stream(),
    stderr: launchError, inspectRuntime: () => {},
    readKey: () => { throw new Error('synthetic missing key'); },
    fetchImpl: () => assert.fail('transport') });
  assert.equal(code, 1);
  assert.equal(launchError.text(), 'smoke_failed\n');
  assert.equal((await lstat(path.join(f.root,
    'smoke-launch-attempt-synthetic-smoke-execution.json'))).isFile(), true);
  assert.equal((await run(f, '--launch')).stderr, 'launch_consumed\n');
  assert.equal(state(f.ledger).requestCount, 0);
});

test('actual delegate runs six synthetic cases with bounded flags, one-shot marker and redacted output', async (t) => {
  const f = await setup(t);
  const calls = [];
  const result = await run(f, '--launch', fakeHttp(calls));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(JSON.parse(result.stdout).mode, 'launch');
  assert.ok(calls.length > 0);
  assert.ok(calls.length <= f.plan.projection.requests);
  assert.equal(state(f.ledger).requestCount, calls.length);
  const report = JSON.parse(await readFile(path.join(f.plan.outputDirectory, 'report.json'), 'utf8'));
  const manifest = JSON.parse(await readFile(path.join(f.plan.outputDirectory, 'manifest.json'), 'utf8'));
  assert.equal(report.summary.fixedN, 6);
  assert.equal(manifest.caseTimeoutIdentity.executionId, f.plan.authorizations.execution);
  assert.equal(manifest.operator.maxPreparedCases, 6);
  assert.equal(manifest.operator.runCommit, COMMIT);
  assert.deepEqual(manifest.caps, f.plan.projection);
  assert.equal(manifest.answerTemplateVersion, 'cairn-longmemeval-public-answer-v2');
  const capability = JSON.parse(await readFile(path.join(f.ledger.directory,
    'experiment-case-deadline-synthetic-smoke-execution.json'), 'utf8'));
  const ids = manifest.caseIds;
  assert.deepEqual(capability.schedule, [...ids.map((caseId) => ({ phase: 'generation', caseId })),
    ...ids.map((caseId) => ({ phase: 'scoring', caseId }))]);
  assert.deepEqual(capability.checkpoint, { requestCount: f.plan.checkpoint.requestCount,
    reservedMicroUsd: f.plan.checkpoint.reservedMicroUsd });
  const diagnostic = JSON.parse(await readFile(path.join(f.plan.outputDirectory, 'cases', ids[0],
    'diagnostics.json'), 'utf8'));
  assert.equal(diagnostic.transport?.schemaVersion, 'cairn-transport-phase-diagnostics-v1');
  assert.ok(calls.filter((call) => call.url.endsWith('/responses'))
    .every((call) => ['cairn_extract', 'cairn_classify', 'cairn_select', 'cairn_rank']
      .includes(call.body.text.format.name)));
  const marker = path.join(f.root, 'smoke-launch-attempt-synthetic-smoke-execution.json');
  assert.equal((await lstat(marker)).mode & 0o777, 0o600);
  assert.equal((await lstat(f.keyFile)).mode & 0o777, 0o644);
  assert.equal((await lstat(path.join(f.ledger.directory,
    'experiment-case-deadline-synthetic-smoke-execution.claim.json'))).isFile(), true);
  assert.equal((await run(f, '--launch', fakeHttp([]))).stderr, 'launch_consumed\n');
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-private|synthetic-smoke-key|lme-case-|\/tmp\//u);
});

test('global unknown guard outcome stops the round without exposing delegate data', async (t) => {
  const f = await setup(t);
  const calls = [];
  const result = await run(f, '--launch', fakeHttp(calls, 'global-halt'));
  assert.equal(result.code, 0, result.stderr);
  assert.equal(calls.length, 1);
  const report = JSON.parse(await readFile(path.join(f.plan.outputDirectory, 'report.json'), 'utf8'));
  assert.equal(report.summary.fixedN, 6);
  assert.ok(report.summary.generationBlocked > 0);
  assert.equal(report.summary.halted, true);
  assert.doesNotMatch(result.stdout + result.stderr, /synthetic-private|synthetic-smoke-key|lme-case-|\/tmp\//u);
});

test('genuine core deadline isolates one case and later cases continue', { timeout: 45_000 }, async (t) => {
  const f = await setup(t);
  const calls = [];
  const result = await run(f, '--launch', fakeHttp(calls, 'timeout-first'));
  assert.equal(result.code, 0, result.stderr);
  const report = JSON.parse(await readFile(path.join(f.plan.outputDirectory, 'report.json'), 'utf8'));
  assert.equal(report.summary.fixedN, 6);
  assert.equal(report.summary.generationTimeouts, 1);
  assert.equal(report.summary.halted, false);
  assert.ok(report.summary.generated >= 1);
  assert.ok(calls.length > 1);
  assert.ok(calls.length <= f.plan.projection.requests);
});
