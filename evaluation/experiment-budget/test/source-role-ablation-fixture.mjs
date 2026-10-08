import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import crypto from 'node:crypto';
import fs, { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createExperimentBudget, reopenExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade,
  upgradeExperimentBudgetForEmbeddings, inspectEmbeddingExperimentBudgetSnapshot,
  openBoundEmbeddingExperimentBudget } from '../index.mjs';
import { authorizeBenchmarkExtension, authorizeBenchmarkRequestAllowance,
  authorizeBenchmarkBudgetExtension, authorizeChainedBenchmarkBudgetExtension,
  authorizeChainedBenchmarkRequestCapV2, authorizeChainedBenchmarkBudgetV3,
  authorizeChainedBenchmarkBudgetV4, createExperimentRequestGuard,
  authorizeSourceRoleAblationCapability } from '../request-guard.mjs';
import { createSourceRoleAblationRequestGuard } from '../request-guard.mjs';
import { experimentPolicy } from '../../live/session.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';

export const denied = code => error => error?.code === code && error.message === code;
export const urls = { count: 'https://api.openai.com/v1/responses/input_tokens',
  generation: 'https://api.openai.com/v1/responses' };
export const noHttp = () => assert.fail('unexpected HTTP');

function withOwned(workspace, resource, operation) {
  let closed = false;
  const close = () => { if (!closed) { resource.close(); closed = true; } };
  workspace.defer(close);
  try { return operation(resource); } finally { close(); }
}

export function settleFixture(f, amount, actual = null, embedding = true) {
  const handle = embedding ? openBoundEmbeddingExperimentBudget({ configuration: f.ledger, authorize() {} })
    : reopenExperimentBudget(f.ledger);
  withOwned(f.workspace, handle, resource => {
    const attemptId = randomUUID();
    resource.reserve({ attemptId, channel: embedding ? 'host-embedding' : 'host-completion', reservedMicroUsd: amount });
    resource.recordOutcome(actual === null ? { attemptId, outcome: 'unknown' }
      : { attemptId, outcome: 'succeeded', actualMicroUsd: actual });
  });
}

export function sourceRoleFixture(t, { requestCap = 1000 } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-source-role-guard-' });
  let ledger = { directory: path.join(workspace.path, 'budget'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 1 };
  const f = { workspace, ledger, policy: experimentPolicy() };
  withOwned(workspace, createExperimentBudget(ledger), () => {});
  withOwned(workspace, createExperimentRequestGuard({ ledger, policy: f.policy, fetchImpl: noHttp }), () => {});
  const original = authorizeBenchmarkExtension({ ledger, policy: f.policy,
    authorizationId: 'source-role-original', stages: benchmarkStagePolicy() });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: ledger, policy: f.policy,
    benchmarkExtension: original, authorizationId: 'source-role-allowance', newRequestCap: 2,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  ledger = f.ledger = { ...ledger, requestCap: 2 };
  settleFixture(f, 13, null, false); settleFixture(f, 17, 5, false);
  const parent100 = authorizeBenchmarkBudgetExtension({ oldLedger: ledger, policy: f.policy,
    requestAllowance: allowance, authorizationId: 'source-role-100', newLimitMicroUsd: 100_000_000,
    newRequestCap: 3, expectedCheckpoint: { requestCount: 2, reservedMicroUsd: 30 } });
  ledger = f.ledger = { ...ledger, limitMicroUsd: 100_000_000, requestCap: 3 };
  settleFixture(f, 19, null, false);
  const parent200 = authorizeChainedBenchmarkBudgetExtension({ oldLedger: ledger, policy: f.policy,
    parentBudgetExtension: parent100, authorizationId: 'source-role-200', newLimitMicroUsd: 200_000_000,
    newRequestCap: 4, expectedCheckpoint: { requestCount: 3, reservedMicroUsd: 49 } });
  ledger = f.ledger = { ...ledger, limitMicroUsd: 200_000_000, requestCap: 4 };
  settleFixture(f, 23, null, false);
  const inspection = inspectExperimentBudgetForEmbeddingUpgrade(ledger);
  upgradeExperimentBudgetForEmbeddings({ ...ledger, expectedCheckpoint: { requestCount: 4, reservedMicroUsd: 72 },
    expectedHistorySha256: inspection.historySha256 });
  const beforeV2 = inspectEmbeddingExperimentBudgetSnapshot(ledger);
  const v2 = authorizeChainedBenchmarkRequestCapV2({ oldLedger: ledger, policy: f.policy,
    parentBudgetExtension: parent200, authorizationId: 'source-role-v2', newRequestCap: 12,
    expectedCheckpoint: { requestCount: 4, reservedMicroUsd: 72 }, expectedOldHistorySha256: beforeV2.historySha256 });
  ledger = f.ledger = { ...ledger, requestCap: 12 };
  settleFixture(f, 29);
  const beforeV3 = inspectEmbeddingExperimentBudgetSnapshot(ledger);
  const v3 = authorizeChainedBenchmarkBudgetV3({ oldLedger: ledger, policy: f.policy,
    parentBudgetExtension: v2, authorizationId: 'source-role-v3', newLimitMicroUsd: 300_000_000, newRequestCap: requestCap,
    expectedCheckpoint: { requestCount: 5, reservedMicroUsd: 101 }, expectedOldHistorySha256: beforeV3.historySha256 });
  ledger = f.ledger = { ...ledger, limitMicroUsd: 300_000_000, requestCap };
  const beforeV4 = inspectEmbeddingExperimentBudgetSnapshot(ledger);
  f.benchmarkExtension = authorizeChainedBenchmarkBudgetV4({ oldLedger: ledger, policy: f.policy,
    parentBudgetExtension: v3, authorizationId: 'source-role-v4', newLimitMicroUsd: 400_000_000, newRequestCap: requestCap,
    expectedCheckpoint: { requestCount: 5, reservedMicroUsd: 101 }, expectedOldHistorySha256: beforeV4.historySha256 });
  f.ledger = { ...ledger, limitMicroUsd: 400_000_000 };
  f.before = inspectEmbeddingExperimentBudgetSnapshot(f.ledger);
  f.options = checkpointOptions(f);
  return f;
}

export function checkpointOptions(f, changed = {}) {
  const state = inspectEmbeddingExperimentBudgetSnapshot(f.ledger);
  return { ledger: f.ledger, policy: f.policy, benchmarkExtension: f.benchmarkExtension,
    authorizationId: 'source-role-fresh-auth', executionId: 'source-role-fresh-execution',
    checkpoint: { requestCount: state.requestCount, reservedMicroUsd: state.reservedMicroUsd,
      historySha256: state.historySha256 }, ...changed };
}

export async function grantedFixture(t, changed = {}) {
  const f = sourceRoleFixture(t);
  f.capability = await authorizeSourceRoleAblationCapability({ ...f.options, ...changed });
  return f;
}

export function fakeResponse(url, output = { items: [] }) {
  if (url === urls.count) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
  return Response.json({ object: 'response', model: 'gpt-4.1-mini-2025-04-14', status: 'completed',
    error: null, incomplete_details: null,
    output: [{ type: 'message', role: 'assistant', status: 'completed',
      content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
    usage: { input_tokens: 100, output_tokens: 20, total_tokens: 120 } });
}

export function httpOptions(bodyText, changed = {}) {
  return { method: 'POST', redirect: 'error', signal: new AbortController().signal,
    headers: { Authorization: 'Bearer synthetic-private-key-never-report', 'Content-Type': 'application/json' },
    body: bodyText, ...changed };
}

export function guardOptions(f, fetchImpl = noHttp) {
  return { ledger: f.ledger, policy: f.policy, benchmarkExtension: f.benchmarkExtension,
    sourceRoleAblationCapability: f.capability, fetchImpl };
}

export async function fixtureChild(f, mode) {
  const filename = path.join(f.workspace.path, `child-${mode}-${randomUUID()}.json`);
  writeFileSync(filename, JSON.stringify({ ...guardOptions(f), fetchImpl: undefined }), { mode: 0o600 });
  const child = spawn(process.execPath, [fileURLToPath(import.meta.url), '--fixture-child', mode, filename],
    { env: { PATH: `${path.dirname(process.execPath)}:/usr/bin:/bin`, TMPDIR: f.workspace.path,
      NODE_DISABLE_COMPILE_CACHE: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
  let ended = false;
  f.workspace.defer(async () => {
    if (!ended) { child.kill('SIGTERM'); await new Promise(resolve => child.once('exit', resolve)); }
  });
  let stdout = '', stderr = '';
  child.stdout.on('data', data => { stdout += data; if (stdout.length > 4096) child.kill('SIGTERM'); });
  child.stderr.on('data', data => { stderr += data; if (stderr.length > 4096) child.kill('SIGTERM'); });
  const exit = await new Promise((resolve, reject) => {
    child.once('error', error => { ended = true; reject(error); });
    child.once('exit', (code, signal) => { ended = true; resolve({ code, signal }); });
  });
  assert.equal(exit.signal, null);
  assert.equal(exit.code, 0, `finite child failed (${mode})`);
  return JSON.parse(stdout);
}

async function childControl(mode, filename) {
  const config = JSON.parse(readFileSync(filename, 'utf8'));
  if (mode === 'claim') {
    let guard;
    try {
      guard = await createSourceRoleAblationRequestGuard({ ...config, fetchImpl: noHttp });
      return { claimed: true, code: null };
    } catch (error) {
      assert.equal(error.code, 'capability_consumed');
      return { claimed: false, code: 'capability_consumed' };
    } finally { guard?.close(); }
  }
  if (mode === 'foreign-gap') {
    const guard = await createSourceRoleAblationRequestGuard({ ...config, fetchImpl: noHttp });
    const original = crypto.randomUUID;
    let inserted = false;
    try {
      crypto.randomUUID = () => {
        if (!inserted) {
          inserted = true;
          const foreign = openBoundEmbeddingExperimentBudget({ configuration: config.ledger, authorize() {} });
          try {
            const attemptId = original();
            foreign.reserve({ attemptId, channel: 'host-embedding', reservedMicroUsd: 1 });
            foreign.recordOutcome({ attemptId, outcome: 'succeeded', actualMicroUsd: 1 });
          } finally { foreign.close(); }
        }
        return original();
      };
      syncBuiltinESMExports();
      const { compileSourceRoleArm } = await import('../../source-role-ablation/compiler.mjs');
      const wire = await compileSourceRoleArm({ caseOrdinal: 1, arm: 'baseline', scriptedOutput: { items: [] } });
      await assert.rejects(guard.withSlotScope({ slot: 1, ordinal: 1, arm: 'baseline' }, async () => {
        await guard.cairnFetch(urls.count, httpOptions(wire.httpBodies[0].bodyText));
      }), denied('invalid_ledger'));
      assert.equal(inserted, true);
      assert.equal(guard.attempts().length, 0);
      assert.equal(guard.isHalted(), true);
      return { inserted: true, ownedRequests: 0, halted: true, code: 'invalid_ledger' };
    } finally { crypto.randomUUID = original; syncBuiltinESMExports(); guard.close(); }
  }
  if (mode === 'constructor-failure') {
    const original = fs.readFileSync;
    let reads = 0;
    try {
      fs.readFileSync = (...args) => {
        if (String(args[0]).endsWith('/source-role-ablation/operator.mjs') && ++reads === 5) {
          throw new Error('synthetic-private-key-path-never-report');
        }
        return original(...args);
      };
      syncBuiltinESMExports();
      await assert.rejects(createSourceRoleAblationRequestGuard({ ...config, fetchImpl: noHttp }), denied('invalid_capability'));
    } finally { fs.readFileSync = original; syncBuiltinESMExports(); }
    assert.equal(reads, 5);
    const claim = path.join(config.ledger.directory,
      `experiment-source-role-extraction-claim-${config.sourceRoleAblationCapability.executionId}.json`);
    assert.equal(existsSync(claim), true);
    await assert.rejects(createSourceRoleAblationRequestGuard({ ...config, fetchImpl: noHttp }), denied('capability_consumed'));
    return { claimed: true, ownedRequests: 0, code: 'invalid_capability', replay: 'capability_consumed' };
  }
  if (mode === 'core-deadline') {
    const original = globalThis.setTimeout;
    let lateResolve;
    let sends = 0;
    let shortened = 0;
    let coreTimerCalls = 0;
    let report;
    try {
      globalThis.setTimeout = (callback, delay, ...args) => {
        // The 24 fixed offline serialization preparations precede the sole real invocation.
        if (delay === 30_000 && ++coreTimerCalls === 25) {
          shortened++; return original(callback, 1, ...args);
        }
        return original(callback, delay, ...args);
      };
      const { runSourceRoleAblation } = await import('../../source-role-ablation/operator.mjs');
      report = await runSourceRoleAblation({ ...config, apiKey: 'synthetic-private-key-never-report',
        fetchImpl: () => { sends++; return new Promise(resolve => { lateResolve = resolve; }); },
        persistSlot: async row => {
          assert.equal(row.attempts.length, 1);
          assert.equal(row.attempts[0].outcome, 'unknown');
        } });
    } finally { globalThis.setTimeout = original; }
    assert.equal(shortened, 1);
    assert.equal(sends, 1);
    assert.deepEqual(report.counts, { completed: 0, refused: 1, not_run: 23 });
    assert.equal(report.results[0].reason, 'model_timeout');
    assert.equal(report.reason, 'paid_work_halted');
    const before = inspectEmbeddingExperimentBudgetSnapshot(config.ledger);
    assert.equal(before.attempts.at(-1).outcome, 'unknown');
    assert.equal(before.attempts.filter(row => row.outcome === null).length, 0);
    lateResolve(fakeResponse(urls.count));
    await new Promise(resolve => original(resolve, 10));
    const after = inspectEmbeddingExperimentBudgetSnapshot(config.ledger);
    assert.deepEqual(after.attempts, before.attempts);
    assert.equal(sends, 1);
    assert.equal(JSON.stringify(report).includes('synthetic-private-key-never-report'), false);
    return { shortened, sends, pending: 0, lateChanged: false, reason: 'paid_work_halted',
      counts: report.counts, cleanup: 'closed' };
  }
  throw new Error('invalid_fixture_child');
}

if (process.argv[2] === '--fixture-child') {
  try { console.log(JSON.stringify(await childControl(process.argv[3], process.argv[4]))); }
  catch { console.log(JSON.stringify({ status: 'fixture_failed' })); process.exitCode = 1; }
}
