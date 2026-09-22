import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync, unlinkSync,
  writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { schemasFor } from '../../../adapters/openai/schemas.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../index.mjs';
import {
  authorizeBenchmarkExtension,
  authorizeBenchmarkRequestAllowance,
  authorizeCaseDeadlineCapability,
  createBenchmarkExperimentRequestGuard,
  createCaseDeadlineExperimentRequestGuard,
  createExperimentRequestGuard,
  createQualificationExperimentRequestGuard,
  loadBenchmarkRequestAllowance,
} from '../request-guard.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { experimentPolicy } from '../../live/session.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const canonical = (value) => Array.isArray(value) ? `[${value.map(canonical).join(',')}]`
  : value !== null && typeof value === 'object'
    ? `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`
    : JSON.stringify(value);
const error = (code) => (value) => value?.code === code && value?.message === code;
const noTransport = () => assert.fail('transport must not run');
const guardModule = new URL('../request-guard.mjs', import.meta.url).href;
const extractInput = () => ({ messages: [{ index: 0, role: 'user', content: 'Synthetic source.' }] });
const countBody = () => ({ model: experimentPolicy().cairnCount.model, instructions: 'Synthetic extraction.',
  input: [{ role: 'user', content: [{ type: 'input_text', text: JSON.stringify(extractInput()) }] }],
  truncation: 'disabled', text: { format: { name: 'cairn_extract', type: 'json_schema', strict: true,
    schema: schemasFor('extract', extractInput()) } } });
const countRequest = () => ({ method: 'POST', redirect: 'error', signal: new AbortController().signal,
  headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' }, body: JSON.stringify(countBody()) });
const answerBody = () => ({ model: benchmarkStagePolicy().answer.model,
  messages: [{ role: 'user', content: 'Synthetic question.' }], n: 1, temperature: 0,
  max_tokens: 1, store: false, stream: false });
const answerRequest = () => ({ method: 'POST', redirect: 'error', signal: new AbortController().signal,
  headers: { authorization: 'Bearer synthetic', 'content-type': 'application/json' }, body: JSON.stringify(answerBody()) });

function fixture(t, { limitMicroUsd = 2_000_000, requestCap = 5 } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-request-allowance-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldLedger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd, requestCap };
  createExperimentBudget(oldLedger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: oldLedger, policy, fetchImpl: noTransport }).close();
  const benchmarkExtension = authorizeBenchmarkExtension({ ledger: oldLedger, policy,
    authorizationId: 'synthetic-original-benchmark', stages: benchmarkStagePolicy() });
  const handle = reopenExperimentBudget(oldLedger);
  for (const [channel, reservation, outcome, actual] of [
    ['cairn-count', 0, 'unknown', undefined],
    ['host-completion', 17, 'succeeded', 9],
  ]) {
    const attemptId = randomUUID();
    handle.reserve({ attemptId, channel, reservedMicroUsd: reservation });
    handle.recordOutcome(actual === undefined ? { attemptId, outcome } : { attemptId, outcome, actualMicroUsd: actual });
  }
  const before = handle.getState();
  const stale = reopenExperimentBudget(oldLedger);
  let staleSends = 0;
  const staleGuard = createBenchmarkExperimentRequestGuard({ ledger: oldLedger, policy,
    benchmarkExtension, fetchImpl: () => { staleSends += 1; return Response.json({}); } });
  handle.close();
  t.after(() => { try { stale.close(); } catch {} });
  t.after(() => { try { staleGuard.close(); } catch {} });
  const expectedCheckpoint = { requestCount: before.requestCount, reservedMicroUsd: before.reservedMicroUsd };
  const authorization = { oldLedger, policy, benchmarkExtension, authorizationId: 'synthetic-request-allowance',
    newRequestCap: 20, expectedCheckpoint };
  const filename = join(oldLedger.directory,
    `experiment-benchmark-request-allowance-${benchmarkExtension.authorizationId}.json`);
  return { root, oldLedger, ledger: { ...oldLedger, requestCap: 20 }, policy, benchmarkExtension,
    before, stale, staleGuard, staleSends: () => staleSends, authorization, filename };
}

function state(ledger) {
  const handle = reopenExperimentBudget(ledger);
  try { return handle.getState(); } finally { handle.close(); }
}

function load(f, overrides = {}) {
  return loadBenchmarkRequestAllowance({ ledger: f.ledger, policy: f.policy,
    benchmarkAuthorizationId: f.benchmarkExtension.authorizationId,
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
    let sawAllowanceUpdate = false;
    const originalPrepare = actualSqlite.DatabaseSync.prototype.prepare;
    actualSqlite.DatabaseSync.prototype.prepare = function (sql) {
      const statement = originalPrepare.call(this, sql);
      if (/UPDATE run_config SET request_cap/u.test(sql)) sawAllowanceUpdate = true;
      if (mode === 'update' && /UPDATE run_config SET request_cap/u.test(sql)) {
        return { run() { throw new Error('synthetic_update_failure'); } };
      }
      return statement;
    };
    const originalExec = actualSqlite.DatabaseSync.prototype.exec;
    actualSqlite.DatabaseSync.prototype.exec = function (sql) {
      if (mode === 'commit_before' && sawAllowanceUpdate && sql === 'COMMIT') {
        throw new Error('synthetic_commit_failure');
      }
      if (mode === 'commit_after' && sawAllowanceUpdate && sql === 'COMMIT') {
        originalExec.call(this, sql);
        throw new Error('synthetic_commit_return_failure');
      }
      return originalExec.call(this, sql);
    };
    const { authorizeBenchmarkRequestAllowance } = await import(${JSON.stringify(guardModule)});
    try { authorizeBenchmarkRequestAllowance(authorization); console.log(JSON.stringify({ code: null })); }
    catch (error) { console.log(JSON.stringify({ code: error?.code ?? 'raw' })); }
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source,
    JSON.stringify(authorization), mode], { encoding: 'utf8', env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim());
}

test('A1/A2 cap-only transition preserves history, money and original bindings and fences stale handles', async (t) => {
  const f = fixture(t);
  const originals = ['experiment-request-policy.json', 'experiment-benchmark-extension.json'];
  const hashes = Object.fromEntries(originals.map((name) => [name,
    digest(readFileSync(join(f.oldLedger.directory, name)))]));
  const extension = authorizeBenchmarkRequestAllowance(f.authorization);
  assert.equal(extension.version, 'benchmark-request-allowance-v1');
  assert.equal(extension.priorLedger.requestCap, 5);
  assert.equal(extension.ledger.requestCap, 20);
  assert.deepEqual(extension.stages, f.benchmarkExtension.stages);
  assert.deepEqual(extension.originalBenchmarkExtension, f.benchmarkExtension);
  assert.equal(extension.historicalDigest, digest(canonical(f.before.attempts.map((attempt) => ({
    attemptId: attempt.attemptId, channel: attempt.channel, reservedMicroUsd: attempt.reservedMicroUsd,
    outcome: attempt.outcome, actualMicroUsd: attempt.actualMicroUsd,
  })))));
  assert.equal(Object.isFrozen(extension), true);
  assert.equal(lstatSync(f.filename).mode & 0o777, 0o600);
  const after = state(f.ledger);
  assert.deepEqual({ ...after, requestCap: f.before.requestCap }, f.before);
  assert.deepEqual(after.attempts, f.before.attempts);
  assert.equal(after.limitMicroUsd, f.before.limitMicroUsd);
  for (const name of originals) assert.equal(digest(readFileSync(join(f.oldLedger.directory, name))), hashes[name]);
  assert.throws(() => f.stale.getState(), error('configuration_mismatch'));
  await assert.rejects(f.staleGuard.cairnFetch(f.policy.cairnCount.endpoint, countRequest()),
    error('configuration_mismatch'));
  assert.equal(f.staleSends(), 0);
  assert.throws(() => reopenExperimentBudget(f.oldLedger), error('configuration_mismatch'));
  assert.deepEqual(load(f), extension);
  assert.deepEqual(authorizeBenchmarkRequestAllowance(f.authorization), extension);
  assert.deepEqual(state(f.ledger), after);
});

test('A3 exact durable-file/old-cap state recovers, while partial intent and a different transition fail closed', (t) => {
  const recovered = fixture(t);
  const extension = authorizeBenchmarkRequestAllowance(recovered.authorization);
  const db = new DatabaseSync(join(recovered.ledger.directory, 'experiment-budget.sqlite'));
  db.prepare('UPDATE run_config SET request_cap = ? WHERE singleton = 1').run(recovered.oldLedger.requestCap);
  db.close();
  assert.deepEqual(authorizeBenchmarkRequestAllowance(recovered.authorization), extension);
  assert.equal(state(recovered.ledger).requestCap, recovered.ledger.requestCap);
  assert.throws(() => authorizeBenchmarkRequestAllowance({ ...recovered.authorization,
    authorizationId: 'different-authorization' }), error('policy_mismatch'));
  assert.throws(() => authorizeBenchmarkRequestAllowance({ ...recovered.authorization,
    newRequestCap: recovered.ledger.requestCap + 1 }), error('configuration_mismatch'));

  const partial = fixture(t);
  writeFileSync(partial.filename, '{', { mode: 0o600, flag: 'wx' });
  assert.throws(() => authorizeBenchmarkRequestAllowance(partial.authorization), error('unsafe_policy_binding'));
  assert.equal(state(partial.oldLedger).requestCap, partial.oldLedger.requestCap);
  assert.equal(readFileSync(partial.filename, 'utf8'), '{');

  const unsafe = fixture(t);
  const target = join(unsafe.root, 'target');
  writeFileSync(target, '{}', { mode: 0o600 });
  symlinkSync(target, unsafe.filename);
  assert.throws(() => authorizeBenchmarkRequestAllowance(unsafe.authorization), error('unsafe_policy_binding'));
  assert.equal(state(unsafe.oldLedger).requestCap, unsafe.oldLedger.requestCap);
});

for (const mode of ['file_fsync', 'directory_fsync', 'update', 'commit_before', 'commit_after']) {
  test(`A3 ${mode} failure retains an exact recoverable state without replaying history`, (t) => {
    const f = fixture(t);
    assert.deepEqual(faultedAuthorization(f.authorization, mode), { code: 'unsafe_policy_binding' });
    const committed = mode === 'commit_after';
    assert.equal(state(committed ? f.ledger : f.oldLedger).requestCap,
      committed ? f.ledger.requestCap : f.oldLedger.requestCap);
    assert.deepEqual(state(committed ? f.ledger : f.oldLedger).attempts, f.before.attempts);
    assert.ok(lstatSync(f.filename).isFile());
    const recovered = authorizeBenchmarkRequestAllowance(f.authorization);
    assert.equal(recovered.authorizationId, f.authorization.authorizationId);
    assert.deepEqual(state(f.ledger).attempts, f.before.attempts);
  });
}

test('A3 partial file-write failure is retained and cannot be repaired or replayed', (t) => {
  const f = fixture(t);
  assert.deepEqual(faultedAuthorization(f.authorization, 'file_write'), { code: 'unsafe_policy_binding' });
  assert.equal(readFileSync(f.filename, 'utf8'), '{');
  assert.equal(state(f.oldLedger).requestCap, f.oldLedger.requestCap);
  assert.throws(() => authorizeBenchmarkRequestAllowance(f.authorization), error('unsafe_policy_binding'));
  assert.equal(readFileSync(f.filename, 'utf8'), '{');
  assert.deepEqual(state(f.oldLedger).attempts, f.before.attempts);
});

test('A3 recovery re-fsyncs an existing complete binding before updating the cap', (t) => {
  const f = fixture(t);
  assert.deepEqual(faultedAuthorization(f.authorization, 'update'), { code: 'unsafe_policy_binding' });
  assert.equal(state(f.oldLedger).requestCap, f.oldLedger.requestCap);
  assert.deepEqual(faultedAuthorization(f.authorization, 'file_fsync'), { code: 'unsafe_policy_binding' });
  assert.equal(state(f.oldLedger).requestCap, f.oldLedger.requestCap);
  assert.equal(authorizeBenchmarkRequestAllowance(f.authorization).authorizationId,
    f.authorization.authorizationId);
  assert.deepEqual(state(f.ledger).attempts, f.before.attempts);
});

test('A1/A3 malformed, equal, unsettled, overrun and locked transitions mutate no allowance', (t) => {
  const equal = fixture(t);
  assert.throws(() => authorizeBenchmarkRequestAllowance({ ...equal.authorization,
    newRequestCap: equal.oldLedger.requestCap }), error('invalid_extension'));
  assert.throws(() => lstatSync(equal.filename), { code: 'ENOENT' });

  const unsettled = fixture(t);
  const open = reopenExperimentBudget(unsettled.oldLedger);
  open.reserve({ attemptId: randomUUID(), channel: 'cairn-count', reservedMicroUsd: 0 });
  open.close();
  assert.throws(() => authorizeBenchmarkRequestAllowance({ ...unsettled.authorization,
    expectedCheckpoint: { requestCount: 3, reservedMicroUsd: 17 } }), error('extension_busy'));
  assert.equal(state(unsettled.oldLedger).requestCap, unsettled.oldLedger.requestCap);

  const overrun = fixture(t);
  const over = reopenExperimentBudget(overrun.oldLedger);
  const overId = randomUUID();
  over.reserve({ attemptId: overId, channel: 'host-completion', reservedMicroUsd: 1 });
  over.recordOutcome({ attemptId: overId, outcome: 'succeeded', actualMicroUsd: 2 });
  over.close();
  assert.throws(() => authorizeBenchmarkRequestAllowance({ ...overrun.authorization,
    expectedCheckpoint: { requestCount: 3, reservedMicroUsd: 18 } }), error('extension_busy'));

  const locked = fixture(t);
  const lock = new DatabaseSync(join(locked.oldLedger.directory, 'experiment-budget.sqlite'));
  lock.exec('BEGIN IMMEDIATE');
  assert.throws(() => authorizeBenchmarkRequestAllowance(locked.authorization), error('extension_busy'));
  lock.exec('ROLLBACK');
  lock.close();
  assert.equal(state(locked.oldLedger).requestCap, locked.oldLedger.requestCap);
  assert.throws(() => lstatSync(locked.filename), { code: 'ENOENT' });
});

test('A2 missing or unsafe original bindings deny the transition without creating derived authority', (t) => {
  for (const mode of ['missing', 'unsafe']) {
    const f = fixture(t);
    const original = join(f.oldLedger.directory, 'experiment-benchmark-extension.json');
    if (mode === 'missing') unlinkSync(original);
    else chmodSync(original, 0o644);
    assert.throws(() => authorizeBenchmarkRequestAllowance(f.authorization), error('unsafe_policy_binding'));
    assert.equal(state(f.oldLedger).requestCap, f.oldLedger.requestCap);
    assert.throws(() => lstatSync(f.filename), { code: 'ENOENT' });
  }
});

test('A4 derived grant is explicit, rejects tampering and other constructors, and verifies prefix before send', async (t) => {
  const f = fixture(t);
  const extension = authorizeBenchmarkRequestAllowance(f.authorization);
  assert.throws(() => createBenchmarkExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: f.benchmarkExtension, fetchImpl: noTransport }), error('invalid_extension'));
  assert.throws(() => createQualificationExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    qualificationExtension: extension, fetchImpl: noTransport }), error('invalid_extension'));
  const sends = [];
  const guard = createBenchmarkExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: extension, fetchImpl: async (url) => {
      sends.push(url);
      return Response.json({ object: 'response.input_tokens', input_tokens: 1 });
    } });
  const channel = f.policy.cairnCount;
  await guard.cairnFetch(channel.endpoint, countRequest());
  assert.equal(sends.length, 1);
  const db = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
  db.prepare('UPDATE attempts SET actual_micro_usd = 8 WHERE actual_micro_usd = 9').run();
  db.close();
  await assert.rejects(guard.cairnFetch(channel.endpoint, countRequest()), error('policy_mismatch'));
  assert.equal(sends.length, 1);
  guard.close();

  const stored = JSON.parse(readFileSync(f.filename, 'utf8'));
  writeFileSync(f.filename, `${JSON.stringify({ ...stored, historicalDigest: '0'.repeat(64) })}\n`, { mode: 0o600 });
  assert.throws(() => load(f), error('policy_mismatch'));
  assert.equal(sends.length, 1);
});

test('A4 a fresh case capability uses the derived grant and old cap capabilities cannot revive', async (t) => {
  const f = fixture(t);
  const oldSchedule = [{ phase: 'generation', caseId: 'old' }, { phase: 'scoring', caseId: 'old' }];
  const oldCapability = authorizeCaseDeadlineCapability({ ledger: f.oldLedger, policy: f.policy,
    benchmarkExtension: f.benchmarkExtension, authorizationId: 'old-case-auth', executionId: 'old-execution',
    checkpoint: f.authorization.expectedCheckpoint, schedule: oldSchedule });
  const oldGuard = createCaseDeadlineExperimentRequestGuard({ ledger: f.oldLedger, policy: f.policy,
    benchmarkExtension: f.benchmarkExtension, caseDeadlineCapability: oldCapability, fetchImpl: noTransport });
  oldGuard.close();
  const oldClaim = join(f.oldLedger.directory, 'experiment-case-deadline-old-execution.claim.json');
  const oldClaimHash = digest(readFileSync(oldClaim));
  const extension = authorizeBenchmarkRequestAllowance(f.authorization);
  assert.throws(() => createCaseDeadlineExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: f.benchmarkExtension, caseDeadlineCapability: oldCapability, fetchImpl: noTransport }),
  error('invalid_capability'));
  assert.equal(digest(readFileSync(oldClaim)), oldClaimHash);
  const schedule = [{ phase: 'generation', caseId: 'new' }, { phase: 'scoring', caseId: 'new' }];
  const checkpoint = state(f.ledger);
  const capability = authorizeCaseDeadlineCapability({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: extension, authorizationId: 'new-case-auth', executionId: 'new-execution',
    checkpoint: { requestCount: checkpoint.requestCount, reservedMicroUsd: checkpoint.reservedMicroUsd }, schedule });
  let sends = 0;
  const guard = createCaseDeadlineExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: extension, caseDeadlineCapability: capability, fetchImpl: async () => {
      sends += 1;
      return Response.json({ object: 'response.input_tokens', input_tokens: 1 });
    } });
  await guard.withCaseScope(schedule[0], () => guard.cairnFetch(f.policy.cairnCount.endpoint, countRequest()));
  assert.equal(sends, 1);
  guard.close();
});

test('A2/A4 loader rejects identity, policy, stages and history tampering', (t) => {
  const f = fixture(t);
  authorizeBenchmarkRequestAllowance(f.authorization);
  assert.throws(() => load(f, { authorizationId: 'wrong' }), error('invalid_extension'));
  assert.throws(() => load(f, { benchmarkAuthorizationId: 'wrong' }), error('unsafe_policy_binding'));
  assert.throws(() => load(f, { stages: { ...benchmarkStagePolicy(), answer: {
    ...benchmarkStagePolicy().answer, maxOutputTokens: 1 } } }), error('policy_mismatch'));
  const db = new DatabaseSync(join(f.ledger.directory, 'experiment-budget.sqlite'));
  db.prepare(`UPDATE attempts SET actual_micro_usd = 8 WHERE rowid =
    (SELECT rowid FROM attempts WHERE actual_micro_usd = 9 LIMIT 1)`).run();
  db.close();
  assert.throws(() => load(f), error('policy_mismatch'));
});

test('A2 original benchmark checkpoint is revalidated before a derived grant is minted', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'cairn-request-allowance-prefix-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldLedger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 1_000,
    requestCap: 5 };
  createExperimentBudget(oldLedger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: oldLedger, policy, fetchImpl: noTransport }).close();
  const handle = reopenExperimentBudget(oldLedger);
  const attemptId = randomUUID();
  handle.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 4 });
  handle.recordOutcome({ attemptId, outcome: 'succeeded', actualMicroUsd: 3 });
  handle.close();
  const benchmarkExtension = authorizeBenchmarkExtension({ ledger: oldLedger, policy,
    authorizationId: 'checkpointed-original', stages: benchmarkStagePolicy() });
  const db = new DatabaseSync(join(oldLedger.directory, 'experiment-budget.sqlite'));
  db.prepare('UPDATE attempts SET reserved_micro_usd = 5 WHERE attempt_id = ?').run(attemptId);
  db.prepare('UPDATE run_config SET reserved_micro_usd = 5 WHERE singleton = 1').run();
  db.close();
  assert.throws(() => authorizeBenchmarkRequestAllowance({ oldLedger, policy, benchmarkExtension,
    authorizationId: 'must-not-mint', newRequestCap: 20,
    expectedCheckpoint: { requestCount: 1, reservedMicroUsd: 5 } }), error('policy_mismatch'));
  assert.equal(state(oldLedger).requestCap, 5);
});

test('A3/A4 malformed nested configs fail with fixed errors before send or mutation', (t) => {
  const f = fixture(t);
  const extension = authorizeBenchmarkRequestAllowance(f.authorization);
  const malformed = { ...extension, priorLedger: null };
  assert.throws(() => createBenchmarkExperimentRequestGuard({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: malformed, fetchImpl: noTransport }), error('invalid_extension'));
  const stored = JSON.parse(readFileSync(f.filename, 'utf8'));
  writeFileSync(f.filename, `${JSON.stringify({ ...stored, ledger: { requestCap: 20 } })}\n`, { mode: 0o600 });
  assert.throws(() => load(f), error('invalid_extension'));
  assert.deepEqual(state(f.ledger).attempts, f.before.attempts);
});

test('A1 operator inputs are detached and each caller-owned field is read once', (t) => {
  const f = fixture(t);
  const reads = {};
  const options = {};
  for (const [key, value] of Object.entries(f.authorization)) {
    Object.defineProperty(options, key, { enumerable: true, get() { reads[key] = (reads[key] ?? 0) + 1; return value; } });
  }
  const extension = authorizeBenchmarkRequestAllowance(options);
  assert.deepEqual(reads, { oldLedger: 1, policy: 1, benchmarkExtension: 1, authorizationId: 1,
    newRequestCap: 1, expectedCheckpoint: 1 });
  assert.notEqual(extension.ledger, f.ledger);
  assert.equal(Object.isFrozen(extension.originalBenchmarkExtension), true);
});

test('A4 derived guards retain money exhaustion and unknown-outcome global halt', async (t) => {
  const money = fixture(t, { limitMicroUsd: 18 });
  const moneyExtension = authorizeBenchmarkRequestAllowance(money.authorization);
  let moneySends = 0;
  const moneyGuard = createBenchmarkExperimentRequestGuard({ ledger: money.ledger, policy: money.policy,
    benchmarkExtension: moneyExtension, fetchImpl: () => { moneySends += 1; return Response.json({}); } });
  await assert.rejects(moneyGuard.answerFetch(benchmarkStagePolicy().answer.endpoint, answerRequest()),
    error('budget_exceeded'));
  assert.equal(moneySends, 0);
  moneyGuard.close();

  const unknown = fixture(t);
  const unknownExtension = authorizeBenchmarkRequestAllowance(unknown.authorization);
  let unknownSends = 0;
  const unknownGuard = createBenchmarkExperimentRequestGuard({ ledger: unknown.ledger, policy: unknown.policy,
    benchmarkExtension: unknownExtension, fetchImpl: async () => { unknownSends += 1; throw new Error('synthetic'); } });
  await assert.rejects(unknownGuard.answerFetch(benchmarkStagePolicy().answer.endpoint, answerRequest()),
    error('transport_failed'));
  assert.equal(unknownGuard.isHalted(), true);
  await assert.rejects(unknownGuard.answerFetch(benchmarkStagePolicy().answer.endpoint, answerRequest()),
    error('paid_work_halted'));
  assert.equal(unknownSends, 1);
  unknownGuard.close();
});
