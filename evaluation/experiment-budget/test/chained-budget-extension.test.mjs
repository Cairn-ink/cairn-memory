import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { randomUUID, createHash } from 'node:crypto';
import { chmodSync, lstatSync, linkSync, mkdtempSync, readFileSync, renameSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';

import { createOpenAIModel } from '../../../adapters/openai/index.mjs';
import { createExperimentBudget, inspectExperimentBudgetSnapshot,
  reopenExperimentBudget, transitionExperimentBudgetCaps } from '../index.mjs';
import { authorizeBenchmarkBudgetExtension, authorizeBenchmarkExtension,
  authorizeBenchmarkRequestAllowance, authorizeCaseDeadlineCapability,
  authorizeChainedBenchmarkBudgetExtension, createCaseDeadlineExperimentRequestGuard,
  createBenchmarkExperimentRequestGuard, createExperimentRequestGuard,
  loadChainedBenchmarkBudgetExtension } from '../request-guard.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { experimentPolicy } from '../../live/session.mjs';

const error = (code) => (value) => value?.code === code && value?.message === code;
const digest = (bytes) => createHash('sha256').update(bytes).digest('hex');
const noTransport = () => assert.fail('transport must not run');
const guardModule = new URL('../request-guard.mjs', import.meta.url).href;
const answerBody = () => ({ model: benchmarkStagePolicy().answer.model,
  messages: [{ role: 'user', content: 'Synthetic question.' }], n: 1,
  temperature: 0, max_tokens: 1, store: false, stream: false });
const request = (body) => ({ method: 'POST', redirect: 'error',
  signal: new AbortController().signal,
  headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
  body: JSON.stringify(body) });

function state(configuration) {
  const handle = reopenExperimentBudget(configuration);
  try { return handle.getState(); } finally { handle.close(); }
}

function addAttempt(configuration, reservedMicroUsd, outcome, actualMicroUsd = null) {
  const handle = reopenExperimentBudget(configuration);
  try {
    const attemptId = randomUUID();
    handle.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd });
    handle.recordOutcome(actualMicroUsd === null ? { attemptId, outcome }
      : { attemptId, outcome, actualMicroUsd });
  } finally { handle.close(); }
}

function fixture(t, name = 'ledger') {
  const root = mkdtempSync(join(tmpdir(), 'cairn-chain-budget-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = { directory: join(root, name), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  createExperimentBudget(first).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: first, policy, fetchImpl: noTransport }).close();
  const original = authorizeBenchmarkExtension({ ledger: first, policy,
    authorizationId: 'original-benchmark', stages: benchmarkStagePolicy() });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: first, policy,
    benchmarkExtension: original, authorizationId: 'request-allowance', newRequestCap: 20,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const second = { ...first, requestCap: 20 };
  addAttempt(second, 13, 'unknown');
  addAttempt(second, 17, 'succeeded', 9);
  const beforeParent = state(second);
  const parent = authorizeBenchmarkBudgetExtension({ oldLedger: second, policy,
    requestAllowance: allowance, authorizationId: 'budget-parent',
    newLimitMicroUsd: 100_000_000, newRequestCap: 40,
    expectedCheckpoint: { requestCount: beforeParent.requestCount,
      reservedMicroUsd: beforeParent.reservedMicroUsd } });
  const prior = { ...second, limitMicroUsd: 100_000_000, requestCap: 40 };
  addAttempt(prior, 19, 'failed');
  const before = state(prior);
  const target = { ...prior, limitMicroUsd: 200_000_000, requestCap: 80 };
  const authorization = { oldLedger: prior, policy, parentBudgetExtension: parent,
    authorizationId: 'budget-chain', newLimitMicroUsd: target.limitMicroUsd,
    newRequestCap: target.requestCap, expectedCheckpoint: {
      requestCount: before.requestCount, reservedMicroUsd: before.reservedMicroUsd,
    } };
  const filename = join(first.directory, `experiment-benchmark-budget-chain-${parent.authorizationId}.json`);
  const database = join(first.directory, 'experiment-budget.sqlite');
  return { root, first, second, prior, target, policy, original, allowance,
    parent, before, authorization, filename, database };
}

function load(f, overrides = {}) {
  return loadChainedBenchmarkBudgetExtension({ ledger: f.target, policy: f.policy,
    parentBudgetAuthorizationId: f.parent.authorizationId,
    authorizationId: f.authorization.authorizationId, stages: benchmarkStagePolicy(), ...overrides });
}

test('B1/B2 50→100→200 preserves rows, files and exact replay', (t) => {
  const f = fixture(t, 'ledger space #1');
  const originalFiles = ['experiment-request-policy.json', 'experiment-benchmark-extension.json',
    `experiment-benchmark-request-allowance-${f.original.authorizationId}.json`,
    `experiment-benchmark-budget-extension-${f.allowance.authorizationId}.json`];
  const hashes = originalFiles.map((name) => digest(readFileSync(join(f.first.directory, name))));
  const extension = authorizeChainedBenchmarkBudgetExtension(f.authorization);
  assert.equal(extension.version, 'benchmark-budget-chain-v1');
  assert.equal(extension.priorLedger.limitMicroUsd, 100_000_000);
  assert.equal(extension.ledger.limitMicroUsd, 200_000_000);
  assert.equal(lstatSync(f.filename).mode & 0o777, 0o600);
  assert.equal(lstatSync(f.database).nlink, 1);
  const after = state(f.target);
  assert.deepEqual(after.attempts, f.before.attempts);
  assert.equal(after.requestCount, f.before.requestCount);
  assert.equal(after.reservedMicroUsd, f.before.reservedMicroUsd);
  assert.equal(after.attempts[0].outcome, 'unknown');
  assert.equal(after.attempts[0].actualMicroUsd, null);
  assert.deepEqual(originalFiles.map((name) => digest(readFileSync(join(f.first.directory, name)))), hashes);
  assert.deepEqual(authorizeChainedBenchmarkBudgetExtension(f.authorization), extension);
  assert.deepEqual(load(f), extension);
  addAttempt(f.target, 29, 'unknown');
  const later = state(f.target);
  assert.equal(later.requestCount, f.before.requestCount + 1);
  assert.deepEqual(authorizeChainedBenchmarkBudgetExtension(f.authorization), extension);
  assert.deepEqual(load(f), extension);
  assert.deepEqual(state(f.target).attempts, later.attempts);
  assert.throws(() => reopenExperimentBudget(f.prior), error('configuration_mismatch'));
});

test('B2 snapshot is read-only and transition callback receives frozen ordered prefix', (t) => {
  const f = fixture(t);
  const bytes = readFileSync(f.database);
  const files = lstatSync(f.database);
  assert.deepEqual(inspectExperimentBudgetSnapshot(f.prior), f.before);
  assert.deepEqual(readFileSync(f.database), bytes);
  assert.equal(lstatSync(f.database).ino, files.ino);
  let calls = 0;
  const result = transitionExperimentBudgetCaps({ oldConfiguration: f.prior,
    newConfiguration: f.target, expectedCheckpoint: f.authorization.expectedCheckpoint,
    authorize({ mode, state: current, checkpointAttempts }) {
      calls += 1;
      assert.equal(mode, 'transition');
      assert.deepEqual(current, f.before);
      assert.deepEqual(checkpointAttempts, f.before.attempts);
      assert.equal(Object.isFrozen(current.attempts[0]), true);
      assert.equal(Object.isFrozen(checkpointAttempts), true);
    } });
  assert.equal(calls, 1);
  assert.deepEqual(result.attempts, f.before.attempts);
  assert.equal(result.limitMicroUsd, 200_000_000);
  assert.throws(() => transitionExperimentBudgetCaps({ oldConfiguration: f.prior,
    newConfiguration: f.target, expectedCheckpoint: f.authorization.expectedCheckpoint,
    authorize: () => Promise.resolve() }), error('ledger_failed'));
  assert.deepEqual(state(f.target).attempts, f.before.attempts);
});

test('B1/B3 mismatched bindings and unsettled ledger refuse chain', (t) => {
  const f = fixture(t);
  assert.throws(() => authorizeChainedBenchmarkBudgetExtension({ ...f.authorization,
    newLimitMicroUsd: 201_000_000 }), error('invalid_extension'));
  assert.throws(() => authorizeChainedBenchmarkBudgetExtension({ ...f.authorization,
    newRequestCap: f.prior.requestCap }), error('invalid_extension'));
  assert.throws(() => authorizeChainedBenchmarkBudgetExtension({ ...f.authorization,
    expectedCheckpoint: { ...f.authorization.expectedCheckpoint, reservedMicroUsd: 0 } }),
  error('invalid_extension'));
  const chain = authorizeChainedBenchmarkBudgetExtension(f.authorization);
  assert.throws(() => load(f, { authorizationId: 'different' }), error('invalid_extension'));
  assert.throws(() => authorizeChainedBenchmarkBudgetExtension({ ...f.authorization,
    authorizationId: 'different' }), error('policy_mismatch'));
  const pending = randomUUID();
  const handle = reopenExperimentBudget(f.target);
  handle.reserve({ attemptId: pending, channel: 'host-completion', reservedMicroUsd: 2 });
  handle.close();
  assert.throws(() => load(f), error('extension_busy'));
  assert.throws(() => authorizeChainedBenchmarkBudgetExtension(f.authorization), error('budget_blocked'));
  assert.equal(chain.authorizationId, 'budget-chain');
});

test('B3 old grants reject chain while explicit target baseline keeps only old routes', async (t) => {
  const f = fixture(t);
  const stale = reopenExperimentBudget(f.prior);
  t.after(() => stale.close());
  const chain = authorizeChainedBenchmarkBudgetExtension(f.authorization);
  let forwards = 0;
  const fetchImpl = () => { forwards += 1; throw new Error('unexpected_provider_forward'); };
  assert.throws(() => stale.getState(), error('configuration_mismatch'));
  assert.throws(() => createBenchmarkExperimentRequestGuard({ ledger: f.target, policy: f.policy,
    benchmarkExtension: f.parent, fetchImpl }), error('invalid_extension'));
  assert.throws(() => createBenchmarkExperimentRequestGuard({ ledger: f.target, policy: f.policy,
    benchmarkExtension: chain, fetchImpl }), error('invalid_extension'));
  const generic = createExperimentRequestGuard({ ledger: f.target, policy: f.policy, fetchImpl });
  const captured = [];
  const adapter = createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: async (url, options) => {
    const body = JSON.parse(options.body);
    captured.push({ url, body });
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
    const unknown = { value: 'unknown', evidenceIndices: [] };
    const empty = { value: null, evidenceIndices: [] };
    const output = body.text.format.name === 'cairn_qualifyCandidates'
      ? { qualifications: { item_0: { itemIndex: 0, subject: empty, property: empty,
        scope: empty, applies: empty, value: empty, attribution: unknown,
        commitment: unknown } } }
      : { items: [] };
    return Response.json({ id: 'resp_synthetic', object: 'response',
      model: f.policy.cairnGeneration.model, status: 'completed', error: null,
      incomplete_details: null, output: [{ id: 'msg_synthetic', type: 'message', role: 'assistant',
        status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output), annotations: [] }] }],
      usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
  } });
  const indexed = { inputMode: 'indexed-windows-v1', messages: [
    { index: 0, messageIndex: 0, role: 'user', content: 'Synthetic indexed source.' }] };
  await adapter.extract({ system: 'Synthetic system.', input: indexed, maxOutputTokens: 1024,
    signal: new AbortController().signal });
  const candidate = { items: [{ itemIndex: 0, content: 'Synthetic preference', kind: 'preference',
    candidates: [{ candidateIndex: 0, role: 'user', text: 'Synthetic preference' }] }] };
  await adapter.qualifyCandidates({ system: 'Synthetic system.', input: candidate,
    maxOutputTokens: 1024, signal: new AbortController().signal });
  assert.deepEqual(captured.map((item) => item.url), [f.policy.cairnCount.endpoint,
    f.policy.cairnGeneration.endpoint, f.policy.cairnCount.endpoint,
    f.policy.cairnGeneration.endpoint]);
  for (const item of captured) {
    await assert.rejects(generic.cairnFetch(item.url, { method: 'POST', redirect: 'error',
      signal: new AbortController().signal,
      headers: { Authorization: 'Bearer synthetic-denied', 'Content-Type': 'application/json' },
      body: JSON.stringify(item.body) }), error('unsupported_request'));
  }
  assert.deepEqual(generic.getState().attempts, f.before.attempts);
  generic.close();
  assert.equal(forwards, 0);
});

test('B3 full bound prefix detects edited later-parent history without repair', (t) => {
  const f = fixture(t);
  authorizeChainedBenchmarkBudgetExtension(f.authorization);
  const db = new DatabaseSync(f.database);
  db.prepare(`UPDATE attempts SET actual_micro_usd = 1
    WHERE outcome = 'failed' AND reserved_micro_usd = 19`).run();
  db.close();
  assert.throws(() => load(f), error('policy_mismatch'));
  assert.throws(() => authorizeChainedBenchmarkBudgetExtension(f.authorization),
    error('policy_mismatch'));
});

test('B1/B3 caller getters are single-read and metadata mismatches remain closed', (t) => {
  const f = fixture(t);
  const reads = {};
  const options = {};
  for (const [key, value] of Object.entries(f.authorization)) {
    Object.defineProperty(options, key, { enumerable: true,
      get() { reads[key] = (reads[key] ?? 0) + 1; return value; } });
  }
  const extension = authorizeChainedBenchmarkBudgetExtension(options);
  assert.ok(Object.values(reads).every((count) => count === 1));
  assert.equal(Object.keys(reads).length, 7);
  assert.equal(Object.isFrozen(extension.parentBudgetExtension), true);
  assert.equal(Object.isFrozen(extension.stages.answer), true);
  assert.throws(() => authorizeChainedBenchmarkBudgetExtension({ ...f.authorization,
    policy: { ...f.policy, hostCompletion: { ...f.policy.hostCompletion, maxInputTokens: 999 } } }),
  error('invalid_extension'));
  assert.throws(() => authorizeChainedBenchmarkBudgetExtension({ ...f.authorization,
    parentBudgetExtension: { ...f.parent, authorizationId: 'different-parent' } }),
  error('policy_mismatch'));
  assert.throws(() => load(f, { parentBudgetAuthorizationId: 'different-parent' }),
    error('unsafe_policy_binding'));
  assert.throws(() => load(f, { ledger: { ...f.target, runId: randomUUID() } }),
    error('invalid_extension'));
  assert.throws(() => load(f, { ledger: { ...f.target, requestCap: 81 } }),
    error('invalid_extension'));
  const stages = benchmarkStagePolicy();
  stages.answer.timeoutMs += 1;
  assert.throws(() => load(f, { stages }), error('policy_mismatch'));
});

test('B3 overrun and conflicting or unsafe existing chain record cannot authorize', (t) => {
  const overrun = fixture(t);
  const handle = reopenExperimentBudget(overrun.prior);
  const attemptId = randomUUID();
  handle.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: 1 });
  handle.recordOutcome({ attemptId, outcome: 'succeeded', actualMicroUsd: 2 });
  handle.close();
  assert.equal(state(overrun.prior).state, 'overrun');
  assert.throws(() => authorizeChainedBenchmarkBudgetExtension({ ...overrun.authorization,
    expectedCheckpoint: { requestCount: overrun.before.requestCount + 1,
      reservedMicroUsd: overrun.before.reservedMicroUsd + 1 } }), error('budget_blocked'));
  const conflict = fixture(t);
  const extension = authorizeChainedBenchmarkBudgetExtension(conflict.authorization);
  const stored = JSON.parse(readFileSync(conflict.filename, 'utf8'));
  writeFileSync(conflict.filename, `${JSON.stringify({ ...stored, authorizationId: 'forged' })}\n`,
    { mode: 0o600 });
  assert.throws(() => authorizeChainedBenchmarkBudgetExtension(conflict.authorization),
    error('policy_mismatch'));
  assert.throws(() => load(conflict), error('invalid_extension'));
  assert.equal(extension.authorizationId, 'budget-chain');
  const unsafe = fixture(t);
  const outside = join(unsafe.root, 'outside');
  writeFileSync(outside, '{}', { mode: 0o600 });
  symlinkSync(outside, unsafe.filename);
  assert.throws(() => authorizeChainedBenchmarkBudgetExtension(unsafe.authorization),
    error('unsafe_policy_binding'));
  assert.deepEqual(state(unsafe.prior).attempts, unsafe.before.attempts);
});

test('B3 old consumed and unused scoped grants remain fenced after the chain', async (t) => {
  const f = fixture(t);
  const schedule = [{ phase: 'generation', caseId: 'old' },
    { phase: 'scoring', caseId: 'old' }];
  const issue = (authorizationId, executionId) => authorizeCaseDeadlineCapability({
    ledger: f.prior, policy: f.policy, benchmarkExtension: f.parent,
    authorizationId, executionId, checkpoint: f.authorization.expectedCheckpoint,
    schedule });
  const unused = issue('unused-scope', 'unused-execution');
  const consumed = issue('consumed-scope', 'consumed-execution');
  createCaseDeadlineExperimentRequestGuard({ ledger: f.prior, policy: f.policy,
    benchmarkExtension: f.parent, caseDeadlineCapability: consumed,
    fetchImpl: noTransport }).close();
  const priorGuard = createBenchmarkExperimentRequestGuard({ ledger: f.prior,
    policy: f.policy, benchmarkExtension: f.parent, fetchImpl: noTransport });
  authorizeChainedBenchmarkBudgetExtension(f.authorization);
  await assert.rejects(priorGuard.answerFetch(benchmarkStagePolicy().answer.endpoint,
    request(answerBody())), error('configuration_mismatch'));
  priorGuard.close();
  for (const capability of [unused, consumed]) {
    assert.throws(() => createCaseDeadlineExperimentRequestGuard({ ledger: f.target,
      policy: f.policy, benchmarkExtension: f.parent, caseDeadlineCapability: capability,
      fetchImpl: noTransport }), error('invalid_capability'));
  }
  assert.deepEqual(state(f.target).attempts, f.before.attempts);
});

function faultedAuthorization(f, mode) {
  const source = `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import * as sqlite from 'node:sqlite';
    const options = JSON.parse(process.argv[1]);
    const filename = process.argv[2];
    const database = process.argv[3];
    const mode = process.argv[4];
    const originalWrite = fs.writeFileSync.bind(fs);
    const originalFsync = fs.fsyncSync.bind(fs);
    const originalStat = fs.lstatSync.bind(fs);
    const originalRename = fs.renameSync.bind(fs);
    const originalCopy = fs.copyFileSync.bind(fs);
    const originalChmod = fs.chmodSync.bind(fs);
    const originalLink = fs.linkSync.bind(fs);
    let syncCount = 0;
    let statCount = 0;
    fs.writeFileSync = (...args) => {
      if (mode === 'file_write' && typeof args[0] === 'number') {
        originalWrite(args[0], '{', { encoding: 'utf8' });
        throw new Error('synthetic_partial_write');
      }
      return originalWrite(...args);
    };
    fs.fsyncSync = (...args) => {
      syncCount += 1;
      if ((mode === 'file_fsync' && syncCount === 1)
        || (mode === 'directory_fsync' && syncCount === 2)) {
        throw new Error('synthetic_fsync_failure');
      }
      return originalFsync(...args);
    };
    fs.lstatSync = (...args) => {
      const result = originalStat(...args);
      if (args[0] === database && ++statCount === 2 && mode === 'missing_at_open') {
        originalRename(database, database + '.moved');
      }
      return result;
    };
    syncBuiltinESMExports();
    let sawUpdate = false;
    const originalPrepare = sqlite.DatabaseSync.prototype.prepare;
    sqlite.DatabaseSync.prototype.prepare = function (sql) {
      const statement = originalPrepare.call(this, sql);
      if (/UPDATE run_config SET limit_micro_usd = \\?, request_cap = \\?/u.test(sql)) {
        sawUpdate = true;
        if (mode === 'update') return { run() { throw new Error('synthetic_update_failure'); } };
      }
      return statement;
    };
    const originalExec = sqlite.DatabaseSync.prototype.exec;
    sqlite.DatabaseSync.prototype.exec = function (sql) {
      if (sql === 'BEGIN IMMEDIATE' && ['chmod_after_begin', 'hardlink_after_begin',
        'replace_after_begin'].includes(mode)) {
        originalExec.call(this, sql);
        if (mode === 'chmod_after_begin') originalChmod(database, 0o644);
        if (mode === 'hardlink_after_begin') originalLink(database, database + '.linked');
        if (mode === 'replace_after_begin') {
          originalCopy(database, database + '.replacement');
          originalRename(database + '.replacement', database);
        }
        return;
      }
      if (sawUpdate && sql === 'COMMIT') {
        if (mode === 'commit_before') throw new Error('synthetic_commit_failure');
        if (mode === 'kill_before') process.kill(process.pid, 'SIGKILL');
        if (mode === 'commit_after' || mode === 'kill_after') {
          originalExec.call(this, sql);
          if (mode === 'kill_after') process.kill(process.pid, 'SIGKILL');
          throw new Error('synthetic_commit_return_failure');
        }
      }
      return originalExec.call(this, sql);
    };
    const { authorizeChainedBenchmarkBudgetExtension } = await import(${JSON.stringify(guardModule)});
    try { authorizeChainedBenchmarkBudgetExtension(options); console.log(JSON.stringify({ code: null })); }
    catch (caught) { console.log(JSON.stringify({ code: caught?.code ?? 'raw' })); }
  `;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', source,
    JSON.stringify(f.authorization), f.filename, f.database, mode],
  { encoding: 'utf8', timeout: 10_000, env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  assert.equal(child.error, undefined, child.error?.message);
  if (mode.startsWith('kill_')) {
    assert.equal(child.signal, 'SIGKILL', child.stderr);
    return null;
  }
  assert.equal(child.status, 0, child.stderr);
  return JSON.parse(child.stdout.trim());
}

for (const mode of ['file_fsync', 'directory_fsync', 'update', 'commit_before',
  'commit_after', 'kill_before', 'kill_after']) {
  test(`B4 ${mode} leaves exact durable recovery and original history`, (t) => {
    const f = fixture(t);
    const result = faultedAuthorization(f, mode);
    if (result) assert.notEqual(result.code, null);
    const committed = mode === 'commit_after' || mode === 'kill_after';
    const afterFault = state(committed ? f.target : f.prior);
    assert.deepEqual(afterFault.attempts, f.before.attempts);
    assert.equal(afterFault.reservedMicroUsd, f.before.reservedMicroUsd);
    assert.equal(afterFault.requestCount, f.before.requestCount);
    assert.deepEqual(authorizeChainedBenchmarkBudgetExtension(f.authorization), load(f));
    assert.deepEqual(state(f.target).attempts, f.before.attempts);
  });
}

test('B4 partial binding remains and cannot be repaired', (t) => {
  const f = fixture(t);
  assert.notEqual(faultedAuthorization(f, 'file_write').code, null);
  assert.equal(readFileSync(f.filename, 'utf8'), '{');
  assert.deepEqual(state(f.prior).attempts, f.before.attempts);
  assert.throws(() => authorizeChainedBenchmarkBudgetExtension(f.authorization),
    error('unsafe_policy_binding'));
});

test('B2/B4 removed database at existing-only open never creates a replacement', (t) => {
  const f = fixture(t, 'ledger space #race');
  const beforeBytes = readFileSync(f.database);
  const result = faultedAuthorization(f, 'missing_at_open');
  assert.notEqual(result.code, null);
  assert.throws(() => lstatSync(f.database), { code: 'ENOENT' });
  assert.deepEqual(readFileSync(`${f.database}.moved`), beforeBytes);
  renameSync(`${f.database}.moved`, f.database);
  assert.deepEqual(state(f.prior).attempts, f.before.attempts);
});

test('B2/B4 private mode, hard link and identity changes under lock are rejected', (t) => {
  const f = fixture(t);
  const hardLink = join(f.root, 'linked.sqlite');
  linkSync(f.database, hardLink);
  assert.throws(() => inspectExperimentBudgetSnapshot(f.prior), error('unsafe_database_file'));
  assert.throws(() => authorizeChainedBenchmarkBudgetExtension(f.authorization),
    error('unsafe_database_file'));
  unlinkSync(hardLink);
  chmodSync(f.database, 0o644);
  assert.throws(() => inspectExperimentBudgetSnapshot(f.prior), error('unsafe_database_file'));
  chmodSync(f.database, 0o600);
  const replacement = join(f.root, 'replacement');
  writeFileSync(replacement, readFileSync(f.database), { mode: 0o600 });
  renameSync(replacement, f.database);
  assert.deepEqual(state(f.prior).attempts, f.before.attempts);
  const alternate = join(f.root, 'symlink');
  symlinkSync(f.first.directory, alternate, 'dir');
  assert.throws(() => inspectExperimentBudgetSnapshot({ ...f.prior, directory: alternate }),
    error('unsafe_path'));
});

for (const mode of ['chmod_after_begin', 'hardlink_after_begin', 'replace_after_begin']) {
  test(`B2/B4 ${mode} is rejected after write lock without a cap update`, (t) => {
    const f = fixture(t);
    assert.deepEqual(faultedAuthorization(f, mode), { code: 'unsafe_database_file' });
    if (mode === 'chmod_after_begin') chmodSync(f.database, 0o600);
    if (mode === 'hardlink_after_begin') unlinkSync(`${f.database}.linked`);
    assert.deepEqual(state(f.prior).attempts, f.before.attempts);
    assert.throws(() => reopenExperimentBudget(f.target), error('configuration_mismatch'));
  });
}

test('B4 competing writers cannot issue different chain authorizations', async (t) => {
  const f = fixture(t);
  const code = `
    const { authorizeChainedBenchmarkBudgetExtension } = await import(${JSON.stringify(guardModule)});
    const authorization = JSON.parse(process.argv[1]);
    console.log('ready');
    process.stdin.once('data', () => {
      try {
        const record = authorizeChainedBenchmarkBudgetExtension(authorization);
        console.log(JSON.stringify({ code: null, authorizationId: record.authorizationId }));
      } catch (caught) { console.log(JSON.stringify({ code: caught?.code ?? 'raw' })); }
    });
  `;
  const worker = (authorization) => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', code,
      JSON.stringify(authorization)], { stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env, NODE_NO_WARNINGS: '1' } });
    let stdout = '';
    let stderr = '';
    let readyResolve;
    let readyReject;
    let readySeen = false;
    const ready = new Promise((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
      if (!readySeen && stdout.includes('ready\n')) { readySeen = true; readyResolve(); }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk; });
    const finished = new Promise((resolve, reject) => {
      const timer = setTimeout(() => child.kill('SIGKILL'), 10_000);
      child.on('error', (caught) => {
        clearTimeout(timer);
        if (!readySeen) readyReject(caught);
        reject(caught);
      });
      child.on('close', (status) => {
        clearTimeout(timer);
        if (!readySeen) readyReject(new Error(`race worker never ready: ${stderr}`));
        if (status !== 0) reject(new Error(`race worker failed: ${stderr}`));
        else {
          try { resolve(JSON.parse(stdout.trim().split('\n').at(-1))); }
          catch (caught) { reject(caught); }
        }
      });
    });
    return { ready, finished, start: () => child.stdin.end('go\n') };
  };
  const first = worker(f.authorization);
  const second = worker({ ...f.authorization, authorizationId: 'racing-other-id' });
  await Promise.all([first.ready, second.ready]);
  first.start();
  second.start();
  const outcomes = await Promise.all([first.finished, second.finished]);
  assert.equal(outcomes.filter((outcome) => outcome.code === null).length, 1);
  assert.equal(outcomes.filter((outcome) => outcome.code !== null).length, 1);
  assert.ok(['policy_mismatch', 'ledger_busy'].includes(outcomes.find((outcome) => outcome.code !== null).code));
  assert.deepEqual(state(f.target).attempts, f.before.attempts);
  const winningId = outcomes.find((outcome) => outcome.code === null).authorizationId;
  assert.equal(load(f, { authorizationId: winningId }).authorizationId, winningId);
});
