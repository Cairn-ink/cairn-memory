import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync,
  unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createExperimentBudget, reopenExperimentBudget } from '../index.mjs';
import {
  authorizeBenchmarkBudgetExtension,
  authorizeBenchmarkExtension,
  authorizeBenchmarkRequestAllowance,
  authorizeCaseDeadlineCapability,
  createBenchmarkExperimentRequestGuard,
  createCaseDeadlineExperimentRequestGuard,
  createExperimentRequestGuard,
  loadBenchmarkBudgetExtension,
} from '../request-guard.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { experimentPolicy } from '../../live/session.mjs';

const error = (code) => (value) => value?.code === code && value?.message === code;
const digest = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const noTransport = () => assert.fail('transport must not run');
const guardModule = new URL('../request-guard.mjs', import.meta.url).href;
const request = (body) => ({ method: 'POST', redirect: 'error', signal: new AbortController().signal,
  headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' }, body: JSON.stringify(body) });
const answerBody = () => ({ model: benchmarkStagePolicy().answer.model,
  messages: [{ role: 'user', content: 'Synthetic question.' }], n: 1, temperature: 0,
  max_tokens: 1, store: false, stream: false });
const judgeBody = () => ({ model: benchmarkStagePolicy().judge.model,
  messages: [{ role: 'user', content: 'Synthetic score request.' }], n: 1, temperature: 0,
  max_tokens: 1, store: false, stream: false });
const response = (model) => Response.json({ id: 'synthetic', object: 'chat.completion', model,
  choices: [{ index: 0, message: { role: 'assistant', content: 'ok' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } });

function getState(ledger) {
  const handle = reopenExperimentBudget(ledger);
  try { return handle.getState(); } finally { handle.close(); }
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-budget-extension-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const baseLedger = { directory: join(root, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  createExperimentBudget(baseLedger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: baseLedger, policy, fetchImpl: noTransport }).close();
  const benchmarkExtension = authorizeBenchmarkExtension({ ledger: baseLedger, policy,
    authorizationId: 'synthetic-original-benchmark', stages: benchmarkStagePolicy() });
  const requestAllowance = authorizeBenchmarkRequestAllowance({ oldLedger: baseLedger, policy,
    benchmarkExtension, authorizationId: 'synthetic-request-allowance', newRequestCap: 20,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const oldLedger = { ...baseLedger, requestCap: 20 };
  const handle = reopenExperimentBudget(oldLedger);
  for (const [reservedMicroUsd, outcome, actualMicroUsd] of [
    [0, 'unknown', undefined], [17, 'succeeded', 9], [23, 'failed', undefined],
  ]) {
    const attemptId = randomUUID();
    handle.reserve({ attemptId, channel: reservedMicroUsd === 0 ? 'cairn-count' : 'host-completion',
      reservedMicroUsd });
    handle.recordOutcome(actualMicroUsd === undefined ? { attemptId, outcome }
      : { attemptId, outcome, actualMicroUsd });
  }
  const before = handle.getState();
  handle.close();
  const ledger = { ...oldLedger, limitMicroUsd: 100_000_000, requestCap: 40 };
  const authorization = { oldLedger, policy, requestAllowance,
    authorizationId: 'synthetic-budget-extension', newLimitMicroUsd: 100_000_000,
    newRequestCap: 40, expectedCheckpoint: {
      requestCount: before.requestCount, reservedMicroUsd: before.reservedMicroUsd,
    } };
  const filename = join(oldLedger.directory,
    `experiment-benchmark-budget-extension-${requestAllowance.authorizationId}.json`);
  return { root, baseLedger, oldLedger, ledger, policy, benchmarkExtension, requestAllowance,
    before, authorization, filename };
}

function load(f, overrides = {}) {
  return loadBenchmarkBudgetExtension({ ledger: f.ledger, policy: f.policy,
    benchmarkAuthorizationId: f.benchmarkExtension.authorizationId,
    requestAllowanceAuthorizationId: f.requestAllowance.authorizationId,
    authorizationId: f.authorization.authorizationId, stages: benchmarkStagePolicy(), ...overrides });
}

function faultedAuthorization(authorization, mode) {
  const source = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import * as actualSqlite from 'node:sqlite';
    const authorization = JSON.parse(process.argv[1]);
    const mode = process.argv[2];
    let syncCount = 0;
    const originalWriteFileSync = fs.writeFileSync.bind(fs);
    const originalFsyncSync = fs.fsyncSync.bind(fs);
    fs.writeFileSync = (...args) => {
      if (mode === 'file_write') {
        originalWriteFileSync(args[0], '{', { encoding: 'utf8' });
        throw new Error('synthetic_file_write_failure');
      }
      return originalWriteFileSync(...args);
    };
    fs.fsyncSync = (...args) => {
      syncCount += 1;
      if ((mode === 'file_fsync' && syncCount === 1) || (mode === 'directory_fsync' && syncCount === 2)) {
        throw new Error('synthetic_fsync_failure');
      }
      return originalFsyncSync(...args);
    };
    syncBuiltinESMExports();
    let sawUpdate = false;
    const originalPrepare = actualSqlite.DatabaseSync.prototype.prepare;
    actualSqlite.DatabaseSync.prototype.prepare = function (sql) {
      const statement = originalPrepare.call(this, sql);
      if (/UPDATE run_config SET limit_micro_usd/u.test(sql)) sawUpdate = true;
      if (mode === 'update' && /UPDATE run_config SET limit_micro_usd/u.test(sql)) {
        return { run() { throw new Error('synthetic_update_failure'); } };
      }
      return statement;
    };
    const originalExec = actualSqlite.DatabaseSync.prototype.exec;
    actualSqlite.DatabaseSync.prototype.exec = function (sql) {
      if (mode === 'commit_before' && sawUpdate && sql === 'COMMIT') throw new Error('synthetic_commit_failure');
      if (mode === 'commit_after' && sawUpdate && sql === 'COMMIT') {
        originalExec.call(this, sql);
        throw new Error('synthetic_commit_return_failure');
      }
      return originalExec.call(this, sql);
    };
    const { authorizeBenchmarkBudgetExtension } = await import(${JSON.stringify(guardModule)});
    try { authorizeBenchmarkBudgetExtension(authorization); console.log(JSON.stringify({ code: null })); }
    catch (caught) { console.log(JSON.stringify({ code: caught?.code ?? 'raw' })); }
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source,
    JSON.stringify(authorization), mode], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim());
}

test('B1/B2 fixed US$50 to US$100 transition preserves all history and original files', (t) => {
  const f = fixture(t);
  const originals = ['experiment-request-policy.json', 'experiment-benchmark-extension.json',
    `experiment-benchmark-request-allowance-${f.benchmarkExtension.authorizationId}.json`];
  const hashes = Object.fromEntries(originals.map((name) => [name,
    digest(readFileSync(join(f.oldLedger.directory, name)))]));
  const stale = reopenExperimentBudget(f.oldLedger);
  t.after(() => { try { stale.close(); } catch {} });
  const extension = authorizeBenchmarkBudgetExtension(f.authorization);
  assert.equal(extension.version, 'benchmark-budget-extension-v1');
  assert.equal(extension.priorLedger.limitMicroUsd, 50_000_000);
  assert.equal(extension.ledger.limitMicroUsd, 100_000_000);
  assert.equal(extension.priorLedger.requestCap, 20);
  assert.equal(extension.ledger.requestCap, 40);
  assert.deepEqual(extension.originalRequestAllowance, f.requestAllowance);
  assert.equal(extension.historicalDigest, digest(canonical(f.before.attempts)));
  assert.equal(lstatSync(f.filename).mode & 0o777, 0o600);
  const after = getState(f.ledger);
  assert.deepEqual({ ...after, limitMicroUsd: f.before.limitMicroUsd,
    requestCap: f.before.requestCap }, f.before);
  for (const name of originals) assert.equal(digest(readFileSync(join(f.oldLedger.directory, name))), hashes[name]);
  assert.throws(() => stale.getState(), error('configuration_mismatch'));
  assert.throws(() => reopenExperimentBudget(f.oldLedger), error('configuration_mismatch'));
  assert.deepEqual(load(f), extension);
  assert.deepEqual(authorizeBenchmarkBudgetExtension(f.authorization), extension);
});

test('B1/B3 fixed bounds, exact checkpoint, settled state and writer exclusion fail closed', (t) => {
  for (const mutation of [
    (authorization) => ({ ...authorization, newLimitMicroUsd: authorization.oldLedger.limitMicroUsd }),
    (authorization) => ({ ...authorization, newLimitMicroUsd: Number.MAX_SAFE_INTEGER + 1 }),
    (authorization) => ({ ...authorization, newRequestCap: authorization.oldLedger.requestCap }),
    (authorization) => ({ ...authorization, expectedCheckpoint: {
      ...authorization.expectedCheckpoint, reservedMicroUsd: authorization.expectedCheckpoint.reservedMicroUsd - 1 } }),
  ]) {
    const f = fixture(t);
    assert.throws(() => authorizeBenchmarkBudgetExtension(mutation(f.authorization)),
      (caught) => ['invalid_extension', 'policy_mismatch'].includes(caught?.code));
    assert.equal(getState(f.oldLedger).limitMicroUsd, 50_000_000);
  }
  const unsettled = fixture(t);
  const handle = reopenExperimentBudget(unsettled.oldLedger);
  handle.reserve({ attemptId: randomUUID(), channel: 'cairn-count', reservedMicroUsd: 0 });
  handle.close();
  assert.throws(() => authorizeBenchmarkBudgetExtension({ ...unsettled.authorization,
    expectedCheckpoint: { requestCount: 4, reservedMicroUsd: 40 } }), error('extension_busy'));
  const overrun = fixture(t);
  const overrunHandle = reopenExperimentBudget(overrun.oldLedger);
  const overrunId = randomUUID();
  overrunHandle.reserve({ attemptId: overrunId, channel: 'host-completion', reservedMicroUsd: 1 });
  overrunHandle.recordOutcome({ attemptId: overrunId, outcome: 'succeeded', actualMicroUsd: 2 });
  overrunHandle.close();
  assert.throws(() => authorizeBenchmarkBudgetExtension({ ...overrun.authorization,
    expectedCheckpoint: { requestCount: 4, reservedMicroUsd: 41 } }), error('extension_busy'));
  const locked = fixture(t);
  const db = new DatabaseSync(join(locked.oldLedger.directory, 'experiment-budget.sqlite'));
  db.exec('BEGIN IMMEDIATE');
  assert.throws(() => authorizeBenchmarkBudgetExtension(locked.authorization), error('extension_busy'));
  db.exec('ROLLBACK');
  db.close();
  assert.equal(getState(locked.oldLedger).limitMicroUsd, 50_000_000);
});

test('B1 operator inputs are detached and each caller-owned field is read once', (t) => {
  const f = fixture(t);
  const reads = {};
  const options = {};
  for (const [key, value] of Object.entries(f.authorization)) {
    Object.defineProperty(options, key, { enumerable: true,
      get() { reads[key] = (reads[key] ?? 0) + 1; return value; } });
  }
  const extension = authorizeBenchmarkBudgetExtension(options);
  assert.deepEqual(reads, { oldLedger: 1, policy: 1, requestAllowance: 1, authorizationId: 1,
    newLimitMicroUsd: 1, newRequestCap: 1, expectedCheckpoint: 1 });
  assert.notEqual(extension.ledger, f.ledger);
  assert.equal(Object.isFrozen(extension.originalRequestAllowance), true);
});

test('B3 exact metadata recovery succeeds; partial, unsafe and second transitions fail closed', (t) => {
  const recovered = fixture(t);
  const extension = authorizeBenchmarkBudgetExtension(recovered.authorization);
  const db = new DatabaseSync(join(recovered.ledger.directory, 'experiment-budget.sqlite'));
  db.prepare('UPDATE run_config SET limit_micro_usd = ?, request_cap = ? WHERE singleton = 1')
    .run(recovered.oldLedger.limitMicroUsd, recovered.oldLedger.requestCap);
  db.close();
  assert.deepEqual(authorizeBenchmarkBudgetExtension(recovered.authorization), extension);
  assert.equal(getState(recovered.ledger).limitMicroUsd, 100_000_000);
  assert.throws(() => authorizeBenchmarkBudgetExtension({ ...recovered.authorization,
    authorizationId: 'different-budget-extension' }), error('policy_mismatch'));
  assert.throws(() => authorizeBenchmarkBudgetExtension({ ...recovered.authorization,
    newRequestCap: 41 }), error('configuration_mismatch'));

  const partial = fixture(t);
  writeFileSync(partial.filename, '{', { mode: 0o600, flag: 'wx' });
  assert.throws(() => authorizeBenchmarkBudgetExtension(partial.authorization), error('unsafe_policy_binding'));
  assert.equal(getState(partial.oldLedger).limitMicroUsd, 50_000_000);

  const unsafe = fixture(t);
  const target = join(unsafe.root, 'target');
  writeFileSync(target, '{}', { mode: 0o600 });
  symlinkSync(target, unsafe.filename);
  assert.throws(() => authorizeBenchmarkBudgetExtension(unsafe.authorization), error('unsafe_policy_binding'));
  assert.equal(getState(unsafe.oldLedger).limitMicroUsd, 50_000_000);
});

for (const mode of ['file_fsync', 'directory_fsync', 'update', 'commit_before', 'commit_after']) {
  test(`B3 ${mode} failure is exact-recoverable and never rewrites history`, (t) => {
    const f = fixture(t);
    assert.deepEqual(faultedAuthorization(f.authorization, mode), { code: 'unsafe_policy_binding' });
    const committed = mode === 'commit_after';
    assert.deepEqual(getState(committed ? f.ledger : f.oldLedger).attempts, f.before.attempts);
    const extension = authorizeBenchmarkBudgetExtension(f.authorization);
    assert.equal(extension.authorizationId, f.authorization.authorizationId);
    assert.deepEqual(getState(f.ledger).attempts, f.before.attempts);
  });
}

test('B3 partial file write is retained and cannot be repaired', (t) => {
  const f = fixture(t);
  assert.deepEqual(faultedAuthorization(f.authorization, 'file_write'), { code: 'unsafe_policy_binding' });
  assert.equal(readFileSync(f.filename, 'utf8'), '{');
  assert.equal(getState(f.oldLedger).limitMicroUsd, 50_000_000);
  assert.throws(() => authorizeBenchmarkBudgetExtension(f.authorization), error('unsafe_policy_binding'));
});

test('B2/B4 tampering, unsafe original bindings and per-send history changes deny transport', async (t) => {
  const f = fixture(t);
  const extension = authorizeBenchmarkBudgetExtension(f.authorization);
  assert.throws(() => load(f, { authorizationId: 'wrong' }), error('invalid_extension'));
  const stored = JSON.parse(readFileSync(f.filename, 'utf8'));
  writeFileSync(f.filename, `${JSON.stringify({ ...stored, historicalDigest: '0'.repeat(64) })}\n`, { mode: 0o600 });
  assert.throws(() => load(f), error('policy_mismatch'));

  writeFileSync(f.filename, `${canonical(stored)}\n`, { mode: 0o600 });
  let sends = 0;
  const guard = createBenchmarkExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: extension, fetchImpl: async (_url, options) => {
      sends += 1;
      return response(JSON.parse(options.body).model);
    } });
  const db = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
  db.prepare('UPDATE attempts SET actual_micro_usd = 8 WHERE actual_micro_usd = 9').run();
  db.close();
  await assert.rejects(guard.answerFetch(benchmarkStagePolicy().answer.endpoint,
    request(answerBody())), error('policy_mismatch'));
  assert.equal(sends, 0);
  guard.close();

  const missing = fixture(t);
  unlinkSync(join(missing.oldLedger.directory,
    `experiment-benchmark-request-allowance-${missing.benchmarkExtension.authorizationId}.json`));
  assert.throws(() => authorizeBenchmarkBudgetExtension(missing.authorization), error('unsafe_policy_binding'));
  const loose = fixture(t);
  chmodSync(join(loose.oldLedger.directory,
    `experiment-benchmark-request-allowance-${loose.benchmarkExtension.authorizationId}.json`), 0o644);
  assert.throws(() => authorizeBenchmarkBudgetExtension(loose.authorization), error('unsafe_policy_binding'));
});

test('B4 old v1 guards and old consumed/unconsumed capabilities stay fenced; a fresh capability runs', async (t) => {
  const f = fixture(t);
  const oldSchedule = [{ phase: 'generation', caseId: 'old' }, { phase: 'scoring', caseId: 'old' }];
  const checkpoint = f.authorization.expectedCheckpoint;
  const unconsumed = authorizeCaseDeadlineCapability({ ledger: f.oldLedger, policy: f.policy,
    benchmarkExtension: f.requestAllowance, authorizationId: 'old-unconsumed-auth',
    executionId: 'old-unconsumed-execution', checkpoint, schedule: oldSchedule });
  const consumed = authorizeCaseDeadlineCapability({ ledger: f.oldLedger, policy: f.policy,
    benchmarkExtension: f.requestAllowance, authorizationId: 'old-consumed-auth',
    executionId: 'old-consumed-execution', checkpoint, schedule: oldSchedule });
  createCaseDeadlineExperimentRequestGuard({ ledger: f.oldLedger, policy: f.policy,
    benchmarkExtension: f.requestAllowance, caseDeadlineCapability: consumed, fetchImpl: noTransport }).close();
  const oldGuard = createBenchmarkExperimentRequestGuard({ ledger: f.oldLedger, policy: f.policy,
    benchmarkExtension: f.requestAllowance, fetchImpl: noTransport });
  const extension = authorizeBenchmarkBudgetExtension(f.authorization);
  await assert.rejects(oldGuard.answerFetch(benchmarkStagePolicy().answer.endpoint,
    request(answerBody())), error('configuration_mismatch'));
  oldGuard.close();
  for (const capability of [unconsumed, consumed]) {
    assert.throws(() => createCaseDeadlineExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
      benchmarkExtension: extension, caseDeadlineCapability: capability, fetchImpl: noTransport }),
    error('invalid_capability'));
  }
  const schedule = [{ phase: 'generation', caseId: 'fresh' }, { phase: 'scoring', caseId: 'fresh' }];
  const fresh = authorizeCaseDeadlineCapability({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: extension, authorizationId: 'fresh-auth', executionId: 'fresh-execution',
    checkpoint, schedule });
  let sends = 0;
  const guard = createCaseDeadlineExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: extension, caseDeadlineCapability: fresh, fetchImpl: async (_url, options) => {
      sends += 1;
      return response(JSON.parse(options.body).model);
    } });
  await guard.withCaseScope(schedule[0], () => guard.answerFetch(benchmarkStagePolicy().answer.endpoint,
    request(answerBody())));
  await guard.withCaseScope(schedule[1], () => guard.judgeFetch(benchmarkStagePolicy().judge.endpoint,
    request(judgeBody())));
  assert.equal(sends, 2);
  guard.close();
});

test('B4 monetary exhaustion remains the final authority after extension', async (t) => {
  const f = fixture(t);
  const extension = authorizeBenchmarkBudgetExtension(f.authorization);
  const db = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
  db.prepare('UPDATE run_config SET reserved_micro_usd = ? WHERE singleton = 1').run(99_999_999);
  db.prepare(`INSERT INTO attempts
    (attempt_id, channel, reserved_micro_usd, outcome, actual_micro_usd)
    VALUES (?, 'host-completion', ?, 'unknown', NULL)`).run(randomUUID(), 99_999_959);
  db.prepare('UPDATE run_config SET request_count = request_count + 1 WHERE singleton = 1').run();
  db.close();
  let sends = 0;
  const guard = createBenchmarkExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: extension, fetchImpl: () => { sends += 1; return response('nope'); } });
  await assert.rejects(guard.answerFetch(benchmarkStagePolicy().answer.endpoint,
    request(answerBody())), error('budget_exceeded'));
  assert.equal(sends, 0);
  guard.close();
});
