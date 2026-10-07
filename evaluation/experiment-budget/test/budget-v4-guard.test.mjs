import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { chmodSync, copyFileSync, existsSync, linkSync, mkdirSync, readFileSync, readdirSync, renameSync,
  symlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createOpenAIModel } from '../../../adapters/openai/index.mjs';

import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createExperimentBudget, inspectEmbeddingExperimentBudgetSnapshot,
  inspectExperimentBudgetForEmbeddingUpgrade, openBoundEmbeddingExperimentBudget,
  projectEmbeddingBudgetLimitV4Prefix, reopenExperimentBudget,
  transitionEmbeddingExperimentBudgetLimitV4, upgradeExperimentBudgetForEmbeddings } from '../index.mjs';
import { assertChainedBenchmarkParentForEmbeddingSnapshot,
  authorizeBenchmarkBudgetExtension, authorizeBenchmarkExtension,
  authorizeBenchmarkRequestAllowance, authorizeChainedBenchmarkBudgetExtension,
  authorizeChainedBenchmarkRequestCapV2, authorizeChainedBenchmarkBudgetV3, authorizeChainedBenchmarkBudgetV4,
  authorizeMixedSourcePairCapability, createExperimentRequestGuard,
  createMixedSourcePairExperimentRequestGuard, inspectMixedSourcePairParent,
  loadChainedBenchmarkBudgetV4 } from '../request-guard.mjs';
import { mem0WireProfile } from '../mem0-wire.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { experimentPolicy } from '../../live/session.mjs';

const denied = code => error => error?.code === code && error.message === code;
const noHttp = () => assert.fail('unexpected HTTP');
const database = ledger => path.join(ledger.directory, 'experiment-budget.sqlite');
const plain = value => JSON.parse(JSON.stringify(value));
const hash = value => createHash('sha256').update(value).digest('hex');
const binding = f => path.join(f.ledger.directory,
  `experiment-benchmark-budget-v4-${f.parent.authorizationId}.json`);
function sql(ledger, work) {
  const db = new DatabaseSync(database(ledger));
  try { return work(db); } finally { db.close(); }
}
const rows = ledger => sql(ledger, db => db.prepare('SELECT rowid, * FROM attempts ORDER BY rowid').all());
function settle(ledger, amount, embedding = false, actual = null) {
  const handle = embedding ? openBoundEmbeddingExperimentBudget({ configuration: ledger, authorize() {} })
    : reopenExperimentBudget(ledger);
  try {
    const attemptId = randomUUID();
    handle.reserve({ attemptId, channel: embedding ? 'host-embedding' : 'host-completion',
      reservedMicroUsd: amount });
    handle.recordOutcome(actual === null ? { attemptId, outcome: 'unknown' }
      : { attemptId, outcome: 'succeeded', actualMicroUsd: actual });
  } finally { handle.close(); }
}
function fixture(t, workspace = createTestWorkspace(t, { prefix: 'cairn-budget-v4-' })) {
  const first = { directory: path.join(workspace.path, 'budget'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 1 };
  createExperimentBudget(first).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: first, policy, fetchImpl: noHttp }).close();
  const original = authorizeBenchmarkExtension({ ledger: first, policy,
    authorizationId: 'v3-original', stages: benchmarkStagePolicy() });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: first, policy,
    benchmarkExtension: original, authorizationId: 'v3-allowance', newRequestCap: 2,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const second = { ...first, requestCap: 2 };
  settle(second, 13); settle(second, 17, false, 5);
  const parent100 = authorizeBenchmarkBudgetExtension({ oldLedger: second, policy,
    requestAllowance: allowance, authorizationId: 'v3-parent100',
    newLimitMicroUsd: 100_000_000, newRequestCap: 3,
    expectedCheckpoint: { requestCount: 2, reservedMicroUsd: 30 } });
  const third = { ...second, limitMicroUsd: 100_000_000, requestCap: 3 };
  settle(third, 19);
  const parent200 = authorizeChainedBenchmarkBudgetExtension({ oldLedger: third, policy,
    parentBudgetExtension: parent100, authorizationId: 'v3-parent200',
    newLimitMicroUsd: 200_000_000, newRequestCap: 4,
    expectedCheckpoint: { requestCount: 3, reservedMicroUsd: 49 } });
  const fourth = { ...third, limitMicroUsd: 200_000_000, requestCap: 4 };
  settle(fourth, 23);
  const inspection = inspectExperimentBudgetForEmbeddingUpgrade(fourth);
  upgradeExperimentBudgetForEmbeddings({ ...fourth,
    expectedCheckpoint: { requestCount: 4, reservedMicroUsd: 72 },
    expectedHistorySha256: inspection.historySha256 });
  const beforeV2 = inspectEmbeddingExperimentBudgetSnapshot(fourth);
  const parent = authorizeChainedBenchmarkRequestCapV2({ oldLedger: fourth, policy,
    parentBudgetExtension: parent200, authorizationId: 'v3-parent-v2', newRequestCap: 12,
    expectedCheckpoint: { requestCount: 4, reservedMicroUsd: 72 },
    expectedOldHistorySha256: beforeV2.historySha256 });
  const preV3Ledger = { ...fourth, requestCap: 12 };
  settle(preV3Ledger, 29, true);
  const preV3Snapshot = inspectEmbeddingExperimentBudgetSnapshot(preV3Ledger);
  const oldLedger = { ...preV3Ledger, limitMicroUsd: 300_000_000, requestCap: 20 };
  const v3 = authorizeChainedBenchmarkBudgetV3({ oldLedger: preV3Ledger, policy,
    parentBudgetExtension: parent, authorizationId: 'v4-parent-v3',
    newLimitMicroUsd: 300_000_000, newRequestCap: 20,
    expectedCheckpoint: { requestCount: 5, reservedMicroUsd: 101 },
    expectedOldHistorySha256: preV3Snapshot.historySha256 });
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(oldLedger);
  const ledger = { ...oldLedger, limitMicroUsd: 400_000_000 };
  const files = new Map(readdirSync(oldLedger.directory).filter(name => name.endsWith('.json'))
    .map(name => [name, readFileSync(path.join(oldLedger.directory, name))]));
  return { workspace, oldLedger, ledger, policy, parent: v3, snapshot, files,
    beforeRows: rows(oldLedger), authorization: { oldLedger, policy, parentBudgetExtension: v3,
      authorizationId: 'v4-budget400', newLimitMicroUsd: 400_000_000, newRequestCap: 20,
      expectedCheckpoint: { requestCount: 5, reservedMicroUsd: 101 },
      expectedOldHistorySha256: snapshot.historySha256 } };
}
const load = f => loadChainedBenchmarkBudgetV4({ ledger: f.ledger, policy: f.policy,
  parentBudgetAuthorizationId: f.parent.authorizationId,
  authorizationId: f.authorization.authorizationId, stages: f.parent.stages });
const transition = (f, overrides = {}) => transitionEmbeddingExperimentBudgetLimitV4({
  oldConfiguration: f.oldLedger, newConfiguration: f.ledger,
  expectedCheckpoint: f.authorization.expectedCheckpoint,
  expectedOldHistorySha256: f.snapshot.historySha256, authorize() {}, ...overrides });
const project = (f, snapshot) => projectEmbeddingBudgetLimitV4Prefix({ snapshot,
  oldConfiguration: f.oldLedger, newConfiguration: f.ledger,
  checkpoint: f.authorization.expectedCheckpoint });
const assertOldFiles = f => {
  for (const [name, bytes] of f.files) assert.deepEqual(readFileSync(path.join(f.ledger.directory, name)), bytes);
};

test('B401–B403 exact v4 preserves every row, cost and file; authentic prefix and settled suffix replay', t => {
  const f = fixture(t);
  const projected = project(f, f.snapshot);
  assert.equal(projected.oldPrefixHistorySha256, f.snapshot.historySha256);
  assert.notEqual(projected.newPrefixHistorySha256, projected.oldPrefixHistorySha256);
  const stale = openBoundEmbeddingExperimentBudget({ configuration: f.oldLedger, authorize() {} });
  f.workspace.defer(() => stale.close());
  const record = authorizeChainedBenchmarkBudgetV4(f.authorization);
  assert.equal(record.version, 'benchmark-budget-v4');
  assert.equal(record.newPrefixHistorySha256, projected.newPrefixHistorySha256);
  assert.deepEqual(rows(f.ledger), f.beforeRows);
  assertOldFiles(f);
  assert.deepEqual(plain(load(f)), plain(record));
  assert.deepEqual(plain(authorizeChainedBenchmarkBudgetV4(f.authorization)), plain(record));
  assert.throws(() => stale.reserve({ attemptId: randomUUID(), channel: 'host-embedding',
    reservedMicroUsd: 1 }), denied('configuration_mismatch'));
  assert.throws(() => stale.getState(), denied('ledger_closed'));
  assert.throws(() => inspectEmbeddingExperimentBudgetSnapshot(f.oldLedger), denied('configuration_mismatch'));
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(f.ledger);
  assert.equal(snapshot.reservedMicroUsd, 101);
  assert.equal(snapshot.attempts.filter(row => row.outcome === 'unknown').length, 4);
  assert.throws(() => project(f, structuredClone(snapshot)), denied('invalid_options'));
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: record, snapshot: structuredClone(snapshot) }),
  denied('policy_mismatch'));
  settle(f.ledger, 31, true, 7);
  const suffix = inspectEmbeddingExperimentBudgetSnapshot(f.ledger);
  assert.equal(suffix.requestCount, 6);
  assert.equal(project(f, suffix).oldPrefixSnapshot.requestCount, 5);
  assert.deepEqual(plain(authorizeChainedBenchmarkBudgetV4(f.authorization)), plain(record));
  assert.deepEqual(plain(load(f)), plain(record));
  assert.deepEqual(rows(f.ledger).slice(0, 5), f.beforeRows);
  assertOldFiles(f);
});

test('B401–B403 bad targets, checkpoints, policy, run, stages and forged parents deny without transition', t => {
  const f = fixture(t);
  for (const [override, code] of [
    [{ newLimitMicroUsd: 300_000_001 }, 'invalid_extension'],
    [{ newLimitMicroUsd: 300_000_000 }, 'invalid_extension'],
    [{ newRequestCap: 19 }, 'invalid_extension'], [{ newRequestCap: 21 }, 'invalid_extension'],
    [{ newRequestCap: Infinity }, 'invalid_options'],
    [{ newRequestCap: Number.MAX_SAFE_INTEGER + 1 }, 'invalid_extension'],
    [{ parentBudgetExtension: f.parent.parentBudgetExtension }, 'invalid_extension'],
    [{ parentBudgetExtension: { ...f.parent, authorizationId: 'fabricated' } }, 'policy_mismatch'],
    [{ expectedCheckpoint: { requestCount: 4, reservedMicroUsd: 72 } }, 'invalid_extension'],
    [{ expectedOldHistorySha256: '0'.repeat(64) }, 'configuration_mismatch'],
    [{ oldLedger: { ...f.oldLedger, runId: randomUUID() } }, 'invalid_extension'],
    [{ oldLedger: { ...f.oldLedger, requestCap: 11 } }, 'invalid_extension'],
    [{ policy: { ...f.policy, requestTimeoutMs: 1 } }, 'invalid_policy'],
  ]) {
    assert.throws(() => authorizeChainedBenchmarkBudgetV4({ ...f.authorization, ...override }),
      denied(code), Object.keys(override).join(','));
    assert.equal(existsSync(binding(f)), false);
  }
  let calls = 0;
  const getter = { ...f.authorization };
  Object.defineProperty(getter, 'newLimitMicroUsd', { enumerable: true, get() { calls++; return 300_000_000; } });
  assert.throws(() => authorizeChainedBenchmarkBudgetV4(getter), denied('invalid_options'));
  assert.equal(calls, 0);
  assert.deepEqual(rows(f.oldLedger), f.beforeRows);
  const record = authorizeChainedBenchmarkBudgetV4(f.authorization);
  assert.throws(() => authorizeChainedBenchmarkBudgetV4({ ...f.authorization, authorizationId: 'conflict' }),
    denied('policy_mismatch'));
  for (const [override, code] of [[{ authorizationId: 'bad' }, 'invalid_extension'],
    [{ parentBudgetAuthorizationId: '../bad' }, 'invalid_extension'],
    [{ ledger: { ...f.ledger, requestCap: 21 } }, 'invalid_extension'],
    [{ stages: { ...record.stages, extra: {} } }, 'policy_mismatch']]) {
    assert.throws(() => loadChainedBenchmarkBudgetV4({ ledger: f.ledger, policy: f.policy,
      parentBudgetAuthorizationId: f.parent.authorizationId, authorizationId: record.authorizationId,
      stages: record.stages, ...override }), denied(code));
  }
});

test('B402–B404 an authentic snapshot of a copied ledger cannot witness another directory', t => {
  const f = fixture(t);
  const record = authorizeChainedBenchmarkBudgetV4(f.authorization);
  const directory = path.join(f.workspace.path, 'copy');
  mkdirSync(directory, { mode: 0o700 });
  const copied = { ...f.ledger, directory };
  copyFileSync(database(f.ledger), database(copied)); chmodSync(database(copied), 0o600);
  const genuine = inspectEmbeddingExperimentBudgetSnapshot(f.ledger);
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(copied);
  assert.deepEqual(snapshot, genuine);
  assert.throws(() => project(f, snapshot), denied('invalid_options'));
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: record, snapshot }), denied('policy_mismatch'));
  assert.equal(project(f, genuine).newPrefixHistorySha256, record.newPrefixHistorySha256);
  const handle = openBoundEmbeddingExperimentBudget({ configuration: f.ledger, authorize(state) {
    assert.equal(project(f, state).oldPrefixHistorySha256, record.oldPrefixHistorySha256);
  } });
  try { assert.equal(project(f, handle.getState()).newPrefixHistorySha256, record.newPrefixHistorySha256); }
  finally { handle.close(); }
});

test('B402 cumulative exhausted 300M unknown reservations leave exactly 100M available after v4', t => {
  const f = fixture(t);
  settle(f.oldLedger, 300_000_000 - 101, true);
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(f.oldLedger);
  const authorization = { ...f.authorization, expectedCheckpoint: { requestCount: 6, reservedMicroUsd: 300_000_000 },
    expectedOldHistorySha256: snapshot.historySha256 };
  const before = rows(f.oldLedger);
  authorizeChainedBenchmarkBudgetV4(authorization);
  const handle = openBoundEmbeddingExperimentBudget({ configuration: f.ledger, authorize() {} });
  f.workspace.defer(() => handle.close());
  const attemptId = randomUUID();
  handle.reserve({ attemptId, channel: 'host-embedding', reservedMicroUsd: 100_000_000 });
  handle.recordOutcome({ attemptId, outcome: 'unknown' });
  const after = handle.getState();
  assert.equal(after.reservedMicroUsd, 400_000_000); assert.equal(after.requestCount, 7);
  assert.throws(() => handle.reserve({ attemptId: randomUUID(), channel: 'host-embedding', reservedMicroUsd: 1 }),
    denied('budget_exceeded'));
  assert.deepEqual(rows(f.ledger).slice(0, 6), before); assertOldFiles(f);
});

test('B401 finite request ceiling is not extended by the new money allowance', t => {
  const f = fixture(t);
  const record = authorizeChainedBenchmarkBudgetV4(f.authorization);
  for (let count = 5; count < 20; count++) settle(f.ledger, 1, true);
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(f.ledger);
  assert.equal(snapshot.requestCap, 20);
  assert.equal(snapshot.requestCount, 20);
  assert.equal(snapshot.reservedMicroUsd, 116);
  assert.equal(snapshot.attempts.filter(row => row.outcome === 'unknown').length, 19);
  assertChainedBenchmarkParentForEmbeddingSnapshot({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: record, snapshot });
  assert.deepEqual(plain(load(f)), plain(record));
  const handle = openBoundEmbeddingExperimentBudget({ configuration: f.ledger, authorize() {} });
  try { assert.throws(() => handle.reserve({ attemptId: randomUUID(), channel: 'host-embedding',
    reservedMicroUsd: 1 }), denied('request_cap_exceeded')); }
  finally { handle.close(); }
  assert.deepEqual(rows(f.ledger).slice(0, 5), f.beforeRows); assertOldFiles(f);
});

test('B402–B403 pending and overrun rows, callbacks, locks, and close failures preserve fixed errors', t => {
  const f = fixture(t);
  assert.throws(() => transition(f, { authorize() { throw new Error('private error'); } }), denied('ledger_failed'));
  assert.throws(() => transition(f, { authorize() { return true; } }), denied('ledger_failed'));
  sql(f.oldLedger, db => {
    db.exec('BEGIN IMMEDIATE');
    assert.throws(() => transition(f), denied('ledger_busy'));
    db.exec('ROLLBACK');
  });
  const close = DatabaseSync.prototype.close;
  try {
    DatabaseSync.prototype.close = function() { close.call(this); throw new Error('private close'); };
    assert.throws(() => transition(f, { authorize() { throw new Error('private callback'); } }), denied('ledger_failed'));
    assert.throws(() => transition(f), denied('ledger_failed'));
  } finally { DatabaseSync.prototype.close = close; }
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.ledger).requestCount, 5);
  const pending = fixture(t);
  const handle = openBoundEmbeddingExperimentBudget({ configuration: pending.oldLedger, authorize() {} });
  const attemptId = randomUUID();
  handle.reserve({ attemptId, channel: 'host-embedding', reservedMicroUsd: 9 }); handle.close();
  assert.throws(() => authorizeChainedBenchmarkBudgetV4(pending.authorization), denied('budget_blocked'));
  const overrun = fixture(t);
  settle(overrun.oldLedger, 2, true, 3);
  assert.throws(() => authorizeChainedBenchmarkBudgetV4(overrun.authorization), denied('budget_blocked'));
  assert.equal(existsSync(binding(overrun)), false);
});

test('B402–B403 callback row/cap mutation rolls back; path drift refuses without repairing modes', t => {
  const f = fixture(t);
  const original = DatabaseSync.prototype.exec;
  let active;
  try {
    DatabaseSync.prototype.exec = function(statement) {
      if (statement === 'BEGIN IMMEDIATE') active = this;
      return original.call(this, statement);
    };
    for (const mutation of ['UPDATE attempts SET rowid = 19 WHERE rowid = 5',
      'UPDATE run_config SET request_cap = 19 WHERE singleton = 1']) {
      assert.throws(() => transition(f, { authorize() { active.exec(mutation); } }), denied('invalid_ledger'));
      assert.deepEqual(rows(f.oldLedger), f.beforeRows);
    }
  } finally { DatabaseSync.prototype.exec = original; }
  assert.throws(() => transition(f, { authorize() { chmodSync(database(f.oldLedger), 0o644); } }),
    denied('unsafe_database_file'));
  chmodSync(database(f.oldLedger), 0o600);
  assert.deepEqual(rows(f.oldLedger), f.beforeRows);
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.oldLedger).limitMicroUsd, 300_000_000);
});

test('B403 every ancestor binding and rowid history is checked; missing and unsafe files stay unrepaired', t => {
  const f = fixture(t);
  authorizeChainedBenchmarkBudgetV4(f.authorization);
  for (const [name, bytes] of f.files) {
    const file = path.join(f.ledger.directory, name);
    renameSync(file, `${file}.held`);
    assert.throws(() => load(f), denied('unsafe_policy_binding'));
    assert.equal(existsSync(file), false);
    renameSync(`${file}.held`, file);
    chmodSync(file, 0o644); assert.throws(() => load(f), denied('unsafe_policy_binding')); chmodSync(file, 0o600);
    const changed = JSON.parse(bytes); changed.unexpected = true;
    writeFileSync(file, JSON.stringify(changed)); assert.throws(() => load(f), denied('policy_mismatch')); writeFileSync(file, bytes);
  }
  const file = binding(f), bytes = readFileSync(file);
  for (const field of ['oldPrefixHistorySha256', 'newPrefixHistorySha256', 'historicalDigest']) {
    const changed = JSON.parse(bytes); changed[field] = '0'.repeat(64);
    writeFileSync(file, JSON.stringify(changed)); assert.throws(() => load(f), denied('policy_mismatch')); writeFileSync(file, bytes);
  }
  renameSync(file, `${file}.held`);
  assert.throws(() => authorizeChainedBenchmarkBudgetV4(f.authorization), denied('policy_mismatch'));
  symlinkSync(`${file}.held`, file); assert.throws(() => load(f), denied('unsafe_policy_binding'));
  renameSync(file, `${file}.link`); renameSync(`${file}.held`, file);
  const dbfile = database(f.ledger);
  renameSync(dbfile, `${dbfile}.held`);
  assert.throws(() => authorizeChainedBenchmarkBudgetV4(f.authorization), denied('ledger_missing'));
  assert.equal(existsSync(dbfile), false);
  renameSync(`${dbfile}.held`, dbfile);
  chmodSync(dbfile, 0o644); assert.throws(() => load(f), denied('unsafe_database_file')); chmodSync(dbfile, 0o600);
  chmodSync(f.ledger.directory, 0o755); assert.throws(() => load(f), denied('unsafe_path')); chmodSync(f.ledger.directory, 0o700);
  sql(f.ledger, db => db.exec('UPDATE attempts SET rowid = 19 WHERE rowid = 5'));
  assert.throws(() => load(f), denied('policy_mismatch'));
  assert.throws(() => authorizeChainedBenchmarkBudgetV4(f.authorization), denied('configuration_mismatch'));
  assertOldFiles(f);
  const linked = fixture(t);
  linkSync(database(linked.oldLedger), path.join(linked.workspace.path, 'database-hardlink'));
  assert.throws(() => authorizeChainedBenchmarkBudgetV4(linked.authorization), denied('unsafe_database_file'));
});

function childAuthorization(f, fault = '') {
  const source = `import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    import { DatabaseSync } from 'node:sqlite';
    const fault = ${JSON.stringify(fault)};
    const write = fs.writeFileSync.bind(fs), sync = fs.fsyncSync.bind(fs);
    let syncCount = 0;
    fs.writeFileSync = (...args) => {
      if (fault === 'file_write' && typeof args[0] === 'number') {
        write(args[0], '{'); throw new Error('private write');
      }
      return write(...args);
    };
    fs.fsyncSync = (...args) => {
      syncCount++;
      if ((fault === 'file_fsync' && syncCount === 1)
        || (fault === 'directory_fsync' && syncCount === 2)) throw new Error('private fsync');
      return sync(...args);
    };
    syncBuiltinESMExports();
    const prepare = DatabaseSync.prototype.prepare;
    DatabaseSync.prototype.prepare = function(sql) {
      if (fault === 'update' && sql.startsWith('UPDATE run_config SET limit_micro_usd')) {
        return { run() { throw new Error('private update'); } };
      }
      return prepare.call(this, sql);
    };
    const original = DatabaseSync.prototype.exec;
    DatabaseSync.prototype.exec = function(sql) {
      if (sql === 'COMMIT' && fault === 'kill_before') process.kill(process.pid, 'SIGKILL');
      if (sql === 'COMMIT' && fault === 'commit_before') throw new Error('private commit');
      const result = original.call(this, sql);
      if (sql === 'COMMIT' && fault === 'kill_after') process.kill(process.pid, 'SIGKILL');
      if (sql === 'COMMIT' && fault === 'commit_after') throw new Error('private commit return');
      return result;
    };
    const { authorizeChainedBenchmarkBudgetV4 } = await import(${JSON.stringify(new URL('../request-guard.mjs', import.meta.url).href)});
    try { authorizeChainedBenchmarkBudgetV4(JSON.parse(process.argv[1])); process.stdout.write('ok'); }
    catch(error) { process.stdout.write(error?.code ?? 'unfixed'); }`;
  return { source, args: ['--input-type=module', '-e', source, JSON.stringify(f.authorization)] };
}
for (const fault of ['kill_before', 'kill_after']) {
  test(`B403 real process ${fault} leaves durable binding and exact recoverable caps`, t => {
    const f = fixture(t);
    const result = spawnSync(process.execPath, childAuthorization(f, fault).args,
      { env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.signal, 'SIGKILL');
    assert.equal(existsSync(binding(f)), true);
    const config = fault === 'kill_before' ? f.oldLedger : f.ledger;
    assert.equal(inspectEmbeddingExperimentBudgetSnapshot(config).requestCount, 5);
    const bytes = readFileSync(binding(f));
    const recovered = authorizeChainedBenchmarkBudgetV4(f.authorization);
    assert.deepEqual(plain(load(f)), plain(recovered));
    assert.deepEqual(readFileSync(binding(f)), bytes);
    assert.deepEqual(rows(f.ledger), f.beforeRows); assertOldFiles(f);
  });
}
for (const fault of ['file_fsync', 'directory_fsync', 'update', 'commit_before', 'commit_after']) {
  test(`B403 ${fault} failure maps its error and permits exact recovery`, t => {
    const f = fixture(t);
    const result = spawnSync(process.execPath, childAuthorization(f, fault).args,
      { env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 10_000 });
    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.stdout, 'ledger_failed');
    assert.deepEqual(rows(fault === 'commit_after' ? f.ledger : f.oldLedger), f.beforeRows);
    const bytes = readFileSync(binding(f));
    assert.deepEqual(plain(authorizeChainedBenchmarkBudgetV4(f.authorization)), plain(load(f)));
    assert.deepEqual(readFileSync(binding(f)), bytes); assertOldFiles(f);
  });
}
test('B403 partial authorization remains immutable and is never repaired', t => {
  const f = fixture(t);
  const result = spawnSync(process.execPath, childAuthorization(f, 'file_write').args,
    { env: { PATH: process.env.PATH ?? '' }, encoding: 'utf8', timeout: 10_000 });
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, 'ledger_failed');
  assert.equal(readFileSync(binding(f), 'utf8'), '{');
  assert.throws(() => authorizeChainedBenchmarkBudgetV4(f.authorization), denied('unsafe_policy_binding'));
  assert.equal(readFileSync(binding(f), 'utf8'), '{');
  assert.deepEqual(rows(f.oldLedger), f.beforeRows); assertOldFiles(f);
});
function boundedChild(f, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args,
      { env: { PATH: process.env.PATH ?? '' }, stdio: ['ignore', 'pipe', 'pipe'] });
    let closed = false, timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true; child.kill('SIGKILL');
    }, 10_000);
    f.workspace.defer(async () => {
      if (closed) return;
      await new Promise(done => { child.once('close', done); child.kill('SIGKILL'); });
    });
    let output = ''; child.stdout.setEncoding('utf8').on('data', value => { output += value; });
    child.stderr.resume();
    child.on('error', error => { clearTimeout(timer); reject(error); });
    child.on('close', (code, signal) => {
      closed = true; clearTimeout(timer);
      if (timedOut) reject(new Error('synthetic_child_timeout'));
      else resolve({ code, signal, output });
    });
  });
}
test('B403 concurrent operators converge without duplicate reservations or conflicting record overwrite', async t => {
  const f = fixture(t);
  const results = await Promise.all([boundedChild(f, childAuthorization(f).args),
    boundedChild(f, childAuthorization(f).args)]);
  for (const result of results) {
    assert.equal(result.code, 0);
    assert.equal(result.signal, null);
    assert.ok(['ok', 'ledger_busy'].includes(result.output), result.output);
  }
  assert.ok(results.some(result => result.output === 'ok'));
  assert.deepEqual(plain(authorizeChainedBenchmarkBudgetV4(f.authorization)), plain(load(f)));
  assert.deepEqual(rows(f.ledger), f.beforeRows); assertOldFiles(f);
});

test('B403 concurrent old-ledger reservation cannot bypass the exact settled transition checkpoint', async t => {
  const f = fixture(t);
  const source = `const {openBoundEmbeddingExperimentBudget} = await import(${JSON.stringify(new URL('../index.mjs', import.meta.url).href)});
    let handle; try {
      handle = openBoundEmbeddingExperimentBudget({configuration: JSON.parse(process.argv[1]), authorize() {}});
      handle.reserve({attemptId: ${JSON.stringify(randomUUID())}, channel:'host-embedding', reservedMicroUsd:7});
      handle.recordOutcome({attemptId: handle.getState().attempts.at(-1).attemptId, outcome:'unknown'});
      process.stdout.write('reserved');
    } catch(error) {process.stdout.write(error?.code ?? 'unfixed');} finally {handle?.close();}`;
  const [operator, writer] = await Promise.all([boundedChild(f, childAuthorization(f).args),
    boundedChild(f, ['--input-type=module', '-e', source, JSON.stringify(f.oldLedger)])]);
  assert.equal(operator.code, 0); assert.equal(writer.code, 0);
  assert.equal(operator.signal, null); assert.equal(writer.signal, null);
  assert.ok(['ok', 'configuration_mismatch', 'budget_blocked', 'ledger_busy'].includes(operator.output));
  assert.ok(['reserved', 'configuration_mismatch', 'ledger_busy'].includes(writer.output));
  const cap = sql(f.oldLedger, db => db.prepare('SELECT limit_micro_usd FROM run_config').get().limit_micro_usd);
  const state = inspectEmbeddingExperimentBudgetSnapshot(cap === 400_000_000 ? f.ledger : f.oldLedger);
  assert.deepEqual(rows(f.oldLedger).slice(0, 5), f.beforeRows);
  if (cap === 400_000_000) { assert.equal(state.requestCount, 5); assert.deepEqual(plain(load(f)).version, 'benchmark-budget-v4'); }
  else { assert.equal(state.requestCount, 6); assert.equal(state.reservedMicroUsd, 108);
    assert.throws(() => authorizeChainedBenchmarkBudgetV4(f.authorization), denied('configuration_mismatch')); }
  assertOldFiles(f);
});

function mixedOptions(f, parent, ledger = f.ledger, executionId = 'fresh-v4') {
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(ledger);
  const questionId = `lme-case-${'a'.repeat(64)}`;
  const cap = (requests, reservedMicroUsd) => ({ requests, reservedMicroUsd });
  return { ledger, policy: f.policy, benchmarkExtension: parent, authorizationId: executionId, executionId,
    checkpoint: { requestCount: snapshot.requestCount, reservedMicroUsd: snapshot.reservedMicroUsd,
      historySha256: snapshot.historySha256 }, manifest: { sourceProtocolSha256: '1'.repeat(64),
      contextProtocolSha256: '2'.repeat(64), answerProtocolSha256: '3'.repeat(64), scorerProtocolSha256: '4'.repeat(64),
      cairn: { runtimeArtifactSha256: '5'.repeat(64), adapterConfigurationSha256: '6'.repeat(64),
        qualificationInputProfile: 'not-requested', captureSourcePolicy: 'indexed-evidence-v1',
        comparisonProfile: 'indexed-evidence-v1', navigationLabelPolicy: 'rare-query-window-v1' },
      mem0: { version: '2.2.0', sourceTreeSha256: '7'.repeat(64), dependencyLockSha256: '8'.repeat(64),
        configurationSha256: '9'.repeat(64), wireProfile: structuredClone(mem0WireProfile()) } },
    roster: [{ questionId, protocolDigest: 'b'.repeat(64), armOrder: ['cairn', 'mem0'],
      arms: ['cairn', 'mem0'].map(name => ({ name, scopeId: `lme-case-${hash(JSON.stringify([
        'cairn.lme.mixed-source-pair.scope.v1', [questionId, name]]))}` })) }],
    limits: { phaseCaps: { generation: cap(4, 100_000), scoring: cap(2, 100_000) },
      caseCaps: { cairn: { generation: cap(2, 50_000), scoring: cap(1, 50_000) },
        mem0: { generation: cap(2, 50_000), scoring: cap(1, 50_000) } }, mem0TimeoutMs: 1000 } };
}
const guardOptions = (options, capability, fetchImpl = noHttp) => ({ ledger: options.ledger,
  policy: options.policy, benchmarkExtension: options.benchmarkExtension,
  mixedSourcePairCapability: capability, fetchImpl });
test('B404 old consumed/unused/live grants deny after transition; fresh v4 mixed embedding uses cumulative reserves', async t => {
  const f = fixture(t);
  const unused = mixedOptions(f, f.parent, f.oldLedger, 'unused-old');
  const unusedCapability = authorizeMixedSourcePairCapability(unused);
  const live = mixedOptions(f, f.parent, f.oldLedger, 'consumed-old');
  const liveCapability = authorizeMixedSourcePairCapability(live);
  let oldCalls = 0;
  const stale = createMixedSourcePairExperimentRequestGuard(guardOptions(live, liveCapability,
    () => { oldCalls++; assert.fail('stale dispatch'); }));
  f.workspace.defer(() => stale.close());
  const record = authorizeChainedBenchmarkBudgetV4(f.authorization);
  const newOptions = mixedOptions(f, record);
  assert.throws(() => authorizeMixedSourcePairCapability({ ...newOptions, benchmarkExtension: f.parent }),
    denied('invalid_capability'));
  assert.throws(() => createMixedSourcePairExperimentRequestGuard(guardOptions(unused, unusedCapability)),
    denied('configuration_mismatch'));
  assert.throws(() => createMixedSourcePairExperimentRequestGuard(guardOptions(live, liveCapability)),
    denied('capability_consumed'));
  await assert.rejects(() => stale.withCaseScope(liveCapability.schedule[0], async () => 'attempt'),
    denied('configuration_mismatch'));
  assert.equal(oldCalls, 0);
  const snapshot = inspectMixedSourcePairParent({ ledger: f.ledger, policy: f.policy,
    benchmarkExtension: record, checkpoint: newOptions.checkpoint });
  assert.equal(snapshot.limitMicroUsd, 400_000_000);
  const capability = authorizeMixedSourcePairCapability(newOptions);
  assert.equal(capability.methodProfile, 'cairn-mem0-indexed-evidence-rare-query-navigation-source-pair-v1');
  let calls = 0;
  const guard = createMixedSourcePairExperimentRequestGuard(guardOptions(newOptions, capability,
    async (url, options) => {
      calls++;
      const body = JSON.parse(options.body);
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      if (url.endsWith('/responses')) return Response.json({ object: 'response', model: body.model,
        status: 'completed', error: null, incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: '{"items":[]}' }] }],
        usage: { input_tokens: 100, output_tokens: 5, total_tokens: 105 } });
      return Response.json({ object: 'list', model: 'text-embedding-3-small',
      usage: { prompt_tokens: 1, total_tokens: 1 }, data: [{ object: 'embedding', index: 0,
        embedding: Array(1536).fill(0) }] }); }));
  f.workspace.defer(() => guard.close());
  const model = createOpenAIModel({ apiKey: 'synthetic-only', fetchImpl: guard.cairnFetch });
  assert.equal((await guard.withCaseScope(capability.schedule[0], async () => {
    const extracted = await model.extract({ system: 'Synthetic source.', input: { inputMode: 'indexed-windows-v1',
      messages: [{ index: 0, messageIndex: 0, role: 'user', content: 'Synthetic indexed source.' }] },
      maxOutputTokens: 1024, signal: new AbortController().signal });
    assert.deepEqual(extracted.items, []);
  })).status, 'completed');
  const result = await guard.withCaseScope(capability.schedule[1], async () => {
    const response = await guard.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      { method: 'POST', redirect: 'error', signal: new AbortController().signal,
        headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: ['synthetic'],
          dimensions: 1536, encoding_format: 'float' }) });
    assert.equal(response.status, 200);
  });
  assert.equal(result.status, 'completed'); assert.equal(calls, 3);
  const after = guard.getState();
  assert.equal(after.limitMicroUsd, 400_000_000); assert.equal(after.requestCount, 8);
  assert.deepEqual(after.attempts.slice(-3).map(row => row.channel),
    ['cairn-count', 'cairn-generation', 'host-embedding']);
  assert.ok(after.reservedMicroUsd > 101); assert.deepEqual(after.attempts.slice(0, 5), f.snapshot.attempts);
  assertOldFiles(f);
});

test('B404 owned pending suffix preserves single-flight guard_busy; cap transition remains blocked', async t => {
  const f = fixture(t);
  const record = authorizeChainedBenchmarkBudgetV4(f.authorization);
  const options = mixedOptions(f, record, f.ledger, 'overlapping-v4');
  const capability = authorizeMixedSourcePairCapability(options);
  let entered = 0, firstEntered, secondEntered, release;
  const first = new Promise(resolve => { firstEntered = resolve; });
  const second = new Promise(resolve => { secondEntered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const guard = createMixedSourcePairExperimentRequestGuard(guardOptions(options, capability,
    async () => {
      entered++;
      if (entered === 1) firstEntered(); else secondEntered();
      await held;
      return Response.json({ object: 'list', model: 'text-embedding-3-small',
        usage: { prompt_tokens: 1, total_tokens: 1 }, data: [{ object: 'embedding', index: 0,
          embedding: Array(1536).fill(0) }] });
    }));
  f.workspace.defer(() => guard.close());
  await guard.withCaseScope(capability.schedule[0], async () => {});
  let transitionError, responses, pendingProjectionError, pendingWitness;
  const result = await guard.withCaseScope(capability.schedule[1], async () => {
    const send = () => guard.mem0EmbeddingFetch(mem0WireProfile().embedding.endpoint,
      { method: 'POST', redirect: 'error', signal: new AbortController().signal,
        headers: { Authorization: 'Bearer synthetic', 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: 'text-embedding-3-small', input: ['synthetic'],
          dimensions: 1536, encoding_format: 'float' }) });
    const one = send();
    await first;
    try { pendingWitness = project(f, guard.getState()); }
    catch (error) { pendingProjectionError = error.code; }
    try { authorizeChainedBenchmarkBudgetV4(f.authorization); }
    catch (error) { transitionError = error.code; }
    const two = send();
    try { await Promise.race([second, two.then(() => {}, () => {})]); }
    finally { release(); }
    responses = (await Promise.allSettled([one, two])).map(response => ({ status: response.status,
      ...(response.status === 'rejected' ? { code: response.reason?.code } : {}) }));
    await send();
  });
  assert.equal(pendingProjectionError, undefined);
  assert.equal(pendingWitness?.oldPrefixHistorySha256, record.oldPrefixHistorySha256);
  assert.equal(transitionError, 'budget_blocked');
  assert.deepEqual(responses, [{ status: 'fulfilled' }, { status: 'rejected', code: 'guard_busy' }]);
  assert.equal(result.status, 'completed');
  assert.equal(entered, 2);
  assert.equal(guard.isHalted(), false);
  assert.equal(guard.getState().attempts.filter(row => row.outcome === null).length, 0);
});

test('B405 owned workspaces remove all fixture files after success and failure', async () => {
  for (const fail of [false, true]) {
    const workspace = createTestWorkspace(null, { prefix: 'cairn-budget-v4-cleanup-' });
    const directory = workspace.path;
    try {
      const f = fixture(null, workspace);
      if (fail) assert.throws(() => authorizeChainedBenchmarkBudgetV4({ ...f.authorization,
        expectedOldHistorySha256: '0'.repeat(64) }), denied('configuration_mismatch'));
      else authorizeChainedBenchmarkBudgetV4(f.authorization);
    } finally { await workspace.cleanup(); }
    assert.equal(existsSync(directory), false);
  }
});

test('B404 unowned pending suffix is never admitted as guard-owned work', async t => {
  const f = fixture(t);
  const parent = authorizeChainedBenchmarkBudgetV4(f.authorization);
  const options = mixedOptions(f, parent, f.ledger, 'unowned-pending-v4');
  const capability = authorizeMixedSourcePairCapability(options);
  const guard = createMixedSourcePairExperimentRequestGuard(guardOptions(options, capability));
  f.workspace.defer(() => guard.close());
  const writer = openBoundEmbeddingExperimentBudget({ configuration: f.ledger, authorize() {} });
  try { writer.reserve({ attemptId: randomUUID(), channel: 'host-embedding', reservedMicroUsd: 1 }); }
  finally { writer.close(); }
  await assert.rejects(() => guard.withCaseScope(capability.schedule[0], async () => assert.fail('dispatch')),
    denied('invalid_ledger'));
  assert.equal(guard.isHalted(), true);
  assert.throws(() => load(f), denied('extension_busy'));
});
