import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { chmodSync, lstatSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { CHANNELS, createExperimentBudget, inspectExperimentBudgetForEmbeddingUpgrade,
  reopenEmbeddingExperimentBudget, reopenExperimentBudget,
  upgradeExperimentBudgetForEmbeddings } from '../index.mjs';

const child = fileURLToPath(new URL('../testing/embedding-ledger-child.mjs', import.meta.url));
const error = code => value => value?.code === code;
const rows = file => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare(`SELECT rowid, attempt_id, channel, reserved_micro_usd,
    outcome, actual_micro_usd FROM attempts ORDER BY rowid`).all(); }
  finally { db.close(); }
};
const version = file => {
  const db = new DatabaseSync(file, { readOnly: true });
  try { return db.prepare('PRAGMA user_version').get().user_version; }
  finally { db.close(); }
};
function fixture(t, overrides = {}) {
  const parent = mkdtempSync(path.join(tmpdir(), 'cairn-embedding-ledger-'));
  t.after(() => rmSync(parent, { recursive: true, force: true }));
  const config = { directory: path.join(parent, 'budget'), runId: randomUUID(),
    limitMicroUsd: 100, requestCap: 5, ...overrides };
  createExperimentBudget(config).close();
  return { config, file: path.join(config.directory, 'experiment-budget.sqlite'), parent };
}
const bound = config => {
  const before = inspectExperimentBudgetForEmbeddingUpgrade(config);
  return { ...config, expectedCheckpoint: { requestCount: before.requestCount,
    reservedMicroUsd: before.reservedMicroUsd }, expectedHistorySha256: before.historySha256 };
};
const reserve = (ledger, channel, cost, outcome, actual) => {
  const attemptId = randomUUID();
  ledger.reserve({ attemptId, channel, reservedMicroUsd: cost });
  if (outcome) ledger.recordOutcome(actual === undefined ? { attemptId, outcome }
    : { attemptId, outcome, actualMicroUsd: actual });
  return attemptId;
};

test('L1/L2 legacy bytes, outputs and closed channels remain unchanged; new inspection is read-only', t => {
  const f = fixture(t);
  const beforeBytes = readFileSync(f.file);
  const beforeHandle = reopenExperimentBudget(f.config);
  const beforeState = beforeHandle.getState();
  beforeHandle.close();
  const inspected = inspectExperimentBudgetForEmbeddingUpgrade(f.config);
  assert.deepEqual(Object.keys(inspected), ['schemaVersion', 'runId', 'limitMicroUsd', 'requestCap',
    'reservedMicroUsd', 'requestCount', 'state', 'historySha256']);
  assert.equal(inspected.schemaVersion, 1);
  assert.equal(inspected.runId, f.config.runId);
  assert.match(inspected.historySha256, /^[a-f0-9]{64}$/u);
  assert.deepEqual(CHANNELS, ['host-completion', 'cairn-count', 'cairn-generation']);
  const legacy = reopenExperimentBudget(f.config);
  assert.throws(() => legacy.reserve({ attemptId: randomUUID(), channel: 'host-embedding',
    reservedMicroUsd: 1 }), error('invalid_options'));
  assert.deepEqual(legacy.getState(), beforeState);
  legacy.close();
  assert.deepEqual(readFileSync(f.file), beforeBytes);
  assert.equal(version(f.file), 1);
  assert.throws(() => reopenEmbeddingExperimentBudget(f.config), error('invalid_ledger'));
});

test('L3/L4 mixed settled history, rowid gaps and exact limits survive one atomic transition', t => {
  const f = fixture(t, { requestCap: 4 });
  const ledger = reopenExperimentBudget(f.config);
  reserve(ledger, 'cairn-count', 0, 'succeeded');
  reserve(ledger, 'host-completion', 20, 'succeeded', 5);
  reserve(ledger, 'cairn-generation', 30, 'failed');
  reserve(ledger, 'host-completion', 50, 'unknown');
  const original = ledger.getState();
  ledger.close();
  const db = new DatabaseSync(f.file);
  db.prepare('UPDATE attempts SET rowid = rowid + 10 WHERE rowid = 4').run();
  db.close();
  const beforeRows = rows(f.file);
  assert.deepEqual(beforeRows.map(row => row.rowid), [1, 2, 3, 14]);
  const request = bound(f.config);
  const first = upgradeExperimentBudgetForEmbeddings(request);
  assert.equal(first.status, 'upgraded');
  assert.equal(first.schemaVersion, 2);
  assert.equal(first.requestCount, 4);
  assert.equal(first.reservedMicroUsd, 100);
  assert.equal(first.historySha256, request.expectedHistorySha256);
  assert.deepEqual(Object.keys(first), ['status', 'schemaVersion', 'runId', 'limitMicroUsd',
    'requestCap', 'reservedMicroUsd', 'requestCount', 'state', 'historySha256']);
  assert.deepEqual(rows(f.file), beforeRows);
  assert.equal(version(f.file), 2);
  const migrated = reopenEmbeddingExperimentBudget(f.config);
  assert.deepEqual(migrated.getState(), original);
  migrated.close();
  assert.throws(() => reopenExperimentBudget(f.config), error('invalid_ledger'));
  const again = upgradeExperimentBudgetForEmbeddings(request);
  assert.equal(again.status, 'already-upgraded');
  assert.deepEqual(rows(f.file), beforeRows);
});

test('L5/L6 new channel shares original counters, cap, overrun, terminality and stale binding', t => {
  const f = fixture(t, { requestCap: 3 });
  const request = bound(f.config);
  upgradeExperimentBudgetForEmbeddings(request);
  const v2 = reopenEmbeddingExperimentBudget(f.config);
  const first = reserve(v2, 'host-embedding', 40, 'unknown');
  assert.throws(() => v2.recordOutcome({ attemptId: first, outcome: 'failed' }), error('attempt_terminal'));
  reserve(v2, 'host-completion', 60, 'succeeded', 60);
  assert.equal(v2.getState().requestCount, 2);
  assert.equal(v2.getState().reservedMicroUsd, 100);
  assert.throws(() => v2.reserve({ attemptId: randomUUID(), channel: 'host-embedding',
    reservedMicroUsd: 1 }), error('budget_exceeded'));
  assert.throws(() => v2.reserve({ attemptId: randomUUID(), channel: 'not-embedding',
    reservedMicroUsd: 0 }), error('invalid_options'));
  reserve(v2, 'cairn-count', 0, 'failed');
  assert.throws(() => v2.reserve({ attemptId: randomUUID(), channel: 'host-embedding',
    reservedMicroUsd: 0 }), error('request_cap_exceeded'));
  v2.close();
  assert.throws(() => upgradeExperimentBudgetForEmbeddings(request), error('configuration_mismatch'));
  const reopened = reopenEmbeddingExperimentBudget(f.config);
  assert.deepEqual(reopened.getState().attempts.map(a => [a.channel, a.reservedMicroUsd,
    a.outcome, a.actualMicroUsd]), [
    ['host-embedding', 40, 'unknown', null],
    ['host-completion', 60, 'succeeded', 60],
    ['cairn-count', 0, 'failed', null],
  ]);
  reopened.close();
});

test('L2/L3 malformed own-data and stale digest/checkpoint fail without touching the database', t => {
  const f = fixture(t);
  let getterCalls = 0;
  const accessor = { ...f.config };
  Object.defineProperty(accessor, 'runId', { enumerable: true, get() { getterCalls++; return f.config.runId; } });
  for (const action of [inspectExperimentBudgetForEmbeddingUpgrade,
    reopenEmbeddingExperimentBudget]) assert.throws(() => action(accessor), error('invalid_options'));
  const request = bound(f.config);
  assert.throws(() => upgradeExperimentBudgetForEmbeddings({ ...request, extra: true }), error('invalid_options'));
  assert.throws(() => upgradeExperimentBudgetForEmbeddings({ ...request,
    expectedCheckpoint: { get requestCount() { getterCalls++; return 0; }, reservedMicroUsd: 0 } }),
  error('invalid_options'));
  const deceptiveDigest = { toString() { getterCalls++; return request.expectedHistorySha256; } };
  for (const digest of [deceptiveDigest, new String(request.expectedHistorySha256), Symbol('digest')]) {
    assert.throws(() => upgradeExperimentBudgetForEmbeddings({ ...request,
      expectedHistorySha256: digest }), error('invalid_options'));
  }
  assert.equal(getterCalls, 0);
  for (const patch of [{ expectedHistorySha256: 'A'.repeat(64) },
    { expectedHistorySha256: '0'.repeat(64) },
    { expectedCheckpoint: { requestCount: 1, reservedMicroUsd: 0 } },
    { runId: randomUUID() }, { limitMicroUsd: 101 }, { requestCap: 6 }]) {
    assert.throws(() => upgradeExperimentBudgetForEmbeddings({ ...request, ...patch }));
  }
  assert.equal(version(f.file), 1);
  assert.equal(inspectExperimentBudgetForEmbeddingUpgrade(f.config).historySha256, request.expectedHistorySha256);
});

test('L1 legacy safe-number behavior survives a legal SQLite rowid outside JS safe range', t => {
  const f = fixture(t);
  const ledger = reopenExperimentBudget(f.config);
  reserve(ledger, 'host-completion', 1, 'succeeded', 1);
  ledger.close();
  const db = new DatabaseSync(f.file);
  db.exec('UPDATE attempts SET rowid = 9223372036854775807');
  db.close();
  const reopened = reopenExperimentBudget(f.config);
  assert.equal(reopened.getState().requestCount, 1);
  reopened.close();
  assert.throws(() => inspectExperimentBudgetForEmbeddingUpgrade(f.config), error('ledger_failed'));
  assert.equal(version(f.file), 1);
});

test('L4/L7 altered rows, schema, application ID and overrun/unsettled state fail closed', t => {
  const f = fixture(t);
  const ledger = reopenExperimentBudget(f.config);
  reserve(ledger, 'host-completion', 5, 'succeeded', 3);
  reserve(ledger, 'cairn-count', 0, 'unknown');
  ledger.close();
  const request = bound(f.config);
  const db = new DatabaseSync(f.file);
  db.prepare('UPDATE attempts SET rowid = rowid + 10 WHERE rowid = 1').run();
  db.close();
  assert.throws(() => upgradeExperimentBudgetForEmbeddings(request), error('configuration_mismatch'));
  const changed = fixture(t);
  const changedLedger = reopenExperimentBudget(changed.config);
  reserve(changedLedger, 'host-completion', 1, 'succeeded', 1);
  changedLedger.close();
  const changedRequest = bound(changed.config);
  const changedDb = new DatabaseSync(changed.file);
  changedDb.exec("UPDATE attempts SET channel = 'cairn-count'");
  changedDb.close();
  assert.throws(() => upgradeExperimentBudgetForEmbeddings(changedRequest), error('configuration_mismatch'));
  const unsettled = reopenExperimentBudget(f.config);
  reserve(unsettled, 'cairn-count', 0);
  unsettled.close();
  assert.throws(() => upgradeExperimentBudgetForEmbeddings(bound(f.config)), error('budget_blocked'));
  assert.equal(version(f.file), 1);

  const over = fixture(t);
  const handle = reopenExperimentBudget(over.config);
  reserve(handle, 'host-completion', 1, 'succeeded', 2);
  handle.close();
  assert.throws(() => upgradeExperimentBudgetForEmbeddings(bound(over.config)), error('budget_blocked'));

  const wrongSchema = fixture(t);
  const schemaDb = new DatabaseSync(wrongSchema.file);
  schemaDb.exec('CREATE TABLE extra (x INTEGER) STRICT');
  schemaDb.close();
  assert.throws(() => inspectExperimentBudgetForEmbeddingUpgrade(wrongSchema.config), error('invalid_ledger'));

  const wrongApp = fixture(t);
  const appDb = new DatabaseSync(wrongApp.file);
  appDb.exec('PRAGMA application_id = 12');
  appDb.close();
  assert.throws(() => inspectExperimentBudgetForEmbeddingUpgrade(wrongApp.config), error('invalid_ledger'));
});

test('L6/L7 safe-integer boundary and V2 overrun block future work', t => {
  const f = fixture(t, { limitMicroUsd: Number.MAX_SAFE_INTEGER,
    requestCap: Number.MAX_SAFE_INTEGER });
  upgradeExperimentBudgetForEmbeddings(bound(f.config));
  const ledger = reopenEmbeddingExperimentBudget(f.config);
  const attempt = reserve(ledger, 'host-embedding', Number.MAX_SAFE_INTEGER,
    'succeeded', Number.MAX_SAFE_INTEGER);
  assert.equal(ledger.getState().reservedMicroUsd, Number.MAX_SAFE_INTEGER);
  assert.equal(ledger.getState().attempts[0].attemptId, attempt);
  assert.throws(() => ledger.reserve({ attemptId: randomUUID(), channel: 'host-completion',
    reservedMicroUsd: 1 }), error('budget_exceeded'));
  ledger.close();

  const over = fixture(t);
  upgradeExperimentBudgetForEmbeddings(bound(over.config));
  const overLedger = reopenEmbeddingExperimentBudget(over.config);
  reserve(overLedger, 'host-embedding', 1, 'succeeded', 2);
  assert.equal(overLedger.getState().state, 'overrun');
  assert.throws(() => overLedger.reserve({ attemptId: randomUUID(), channel: 'host-embedding',
    reservedMicroUsd: 0 }), error('budget_blocked'));
  overLedger.close();
});

test('L2/L7 path privacy rejects permissive files and symlinks without repair', t => {
  const f = fixture(t);
  const request = bound(f.config);
  chmodSync(f.file, 0o644);
  assert.throws(() => inspectExperimentBudgetForEmbeddingUpgrade(f.config), error('unsafe_database_file'));
  assert.throws(() => upgradeExperimentBudgetForEmbeddings(request), error('unsafe_database_file'));
  chmodSync(f.file, 0o600);
  const linked = path.join(f.parent, 'linked');
  symlinkSync(f.config.directory, linked);
  const unsafe = { ...f.config, directory: linked };
  assert.throws(() => inspectExperimentBudgetForEmbeddingUpgrade(unsafe), error('unsafe_path'));
  assert.equal(lstatSync(f.file).mode & 0o777, 0o600);
});

test('L6 crash after embedding reservation preserves an unsettled charge', t => {
  const f = fixture(t);
  upgradeExperimentBudgetForEmbeddings(bound(f.config));
  const attemptId = randomUUID();
  const exited = spawnSync(process.execPath, [child, 'reserve-crash', JSON.stringify(f.config), attemptId],
    { encoding: 'utf8' });
  assert.equal(exited.status, 0, exited.stderr);
  const reopened = reopenEmbeddingExperimentBudget(f.config);
  assert.equal(reopened.getState().requestCount, 1);
  assert.equal(reopened.getState().reservedMicroUsd, 7);
  assert.deepEqual(reopened.getState().attempts[0], { attemptId, channel: 'host-embedding',
    reservedMicroUsd: 7, outcome: null, actualMicroUsd: null });
  reopened.close();
});

const spawned = (mode, config, request, expectedSignal = null) => new Promise((resolve, reject) => {
  const proc = spawn(process.execPath, [child, mode, JSON.stringify(config), JSON.stringify(request)],
    { stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = '', stderr = '';
  const timer = setTimeout(() => { proc.kill('SIGKILL'); reject(new Error(`child timed out: ${mode}`)); }, 10000);
  proc.stdout.setEncoding('utf8'); proc.stderr.setEncoding('utf8');
  proc.stdout.on('data', chunk => { stdout += chunk; });
  proc.stderr.on('data', chunk => { stderr += chunk; });
  proc.on('error', error => { clearTimeout(timer); reject(error); });
  proc.on('close', (code, signal) => {
    clearTimeout(timer);
    if (signal && signal !== expectedSignal) reject(new Error(`child killed by ${signal}: ${mode}`));
    else resolve({ code, signal, stdout, stderr });
  });
});

const childResult = outcome => {
  if (outcome.code === 2 && outcome.stdout === 'ledger_busy\n') return 'ledger_busy';
  assert.equal(outcome.code, 0, outcome.stderr + outcome.stdout);
  const parsed = JSON.parse(outcome.stdout);
  assert.ok(['upgraded', 'already-upgraded'].includes(parsed.status), outcome.stdout);
  assert.equal(parsed.schemaVersion, 2);
  return parsed.status;
};

test('L5/L7 actual child crashes before/after COMMIT and recovers the same bound request', async t => {
  for (const [mode, expectedVersion, exitCode] of [['crash-before-commit', 1, 66],
    ['crash-after-commit', 2, 67]]) {
    const f = fixture(t);
    const ledger = reopenExperimentBudget(f.config);
    reserve(ledger, 'host-completion', 5, 'succeeded', 3);
    reserve(ledger, 'cairn-count', 0, 'unknown');
    ledger.close();
    const beforeRows = rows(f.file);
    const request = bound(f.config);
    const exited = await spawned(mode, f.config, request);
    assert.equal(exited.code, exitCode, exited.stderr);
    assert.equal(version(f.file), expectedVersion);
    assert.deepEqual(rows(f.file), beforeRows);
    const inspected = inspectExperimentBudgetForEmbeddingUpgrade(f.config);
    assert.equal(inspected.historySha256, request.expectedHistorySha256);
    const resumed = upgradeExperimentBudgetForEmbeddings(request);
    assert.equal(resumed.status, expectedVersion === 1 ? 'upgraded' : 'already-upgraded');
    assert.equal(version(f.file), 2);
    assert.deepEqual(rows(f.file), beforeRows);
  }
});

test('L5/L7 abrupt SIGKILL at either commit seam leaves one recoverable complete history', async t => {
  for (const [mode, expectedVersion] of [['kill-before-commit', 1], ['kill-after-commit', 2]]) {
    const f = fixture(t);
    const ledger = reopenExperimentBudget(f.config);
    reserve(ledger, 'host-completion', 5, 'succeeded', 3);
    reserve(ledger, 'cairn-count', 0, 'unknown');
    ledger.close();
    const beforeRows = rows(f.file);
    const request = bound(f.config);
    const killed = await spawned(mode, f.config, request, 'SIGKILL');
    assert.equal(killed.signal, 'SIGKILL', killed.stderr);
    const recovered = upgradeExperimentBudgetForEmbeddings(request);
    assert.equal(recovered.status, expectedVersion === 1 ? 'upgraded' : 'already-upgraded');
    assert.equal(recovered.historySha256, request.expectedHistorySha256);
    assert.equal(version(f.file), 2);
    assert.deepEqual(rows(f.file), beforeRows);
  }
});

test('L4/L7 failed table-copy transition rolls back exact v1 schema and rows', async t => {
  const f = fixture(t);
  const ledger = reopenExperimentBudget(f.config);
  reserve(ledger, 'host-completion', 5, 'succeeded', 1);
  ledger.close();
  const beforeRows = rows(f.file);
  const request = bound(f.config);
  const exited = await spawned('fail-copy', f.config, request);
  assert.equal(exited.code, 2, exited.stderr);
  assert.equal(exited.stdout, 'ledger_failed\n');
  assert.equal(version(f.file), 1);
  assert.deepEqual(rows(f.file), beforeRows);
  assert.equal(inspectExperimentBudgetForEmbeddingUpgrade(f.config).historySha256, request.expectedHistorySha256);
});

test('L5/L7 concurrent actual child upgrades serialize; stale v1 handle rejects after migration', async t => {
  const f = fixture(t);
  const stale = reopenExperimentBudget(f.config);
  const request = bound(f.config);
  const [left, right] = await Promise.all([spawned('upgrade', f.config, request),
    spawned('upgrade', f.config, request)]);
  const outcomes = [left, right].map(childResult);
  assert.ok(outcomes.includes('upgraded'));
  assert.equal(version(f.file), 2);
  assert.throws(() => stale.reserve({ attemptId: randomUUID(), channel: 'host-completion',
    reservedMicroUsd: 1 }), error('invalid_ledger'));
  assert.throws(() => stale.recordOutcome({ attemptId: randomUUID(), outcome: 'failed' }), error('invalid_ledger'));
  stale.close();
});

test('L5/L7 real legacy reservation racing migration cannot bypass the binding or V2 fence', async t => {
  const f = fixture(t);
  const request = bound(f.config);
  const attemptId = randomUUID();
  const [migration, reservation] = await Promise.all([
    spawned('upgrade', f.config, request), spawned('legacy-reserve', f.config, attemptId),
  ]);
  const migrationResult = migration.code === 0 ? childResult(migration) : migration.stdout.trim();
  const reservationResult = reservation.stdout.trim();
  assert.ok(['upgraded', 'configuration_mismatch', 'budget_blocked', 'ledger_busy'].includes(migrationResult),
    migration.stderr + migration.stdout);
  if (migration.code !== 0) assert.equal(migration.code, 2);
  assert.ok(['reserved', 'invalid_ledger', 'ledger_busy'].includes(reservationResult),
    reservation.stderr + reservation.stdout);
  assert.equal(reservation.code, reservationResult === 'reserved' ? 0 : 2);
  assert.ok(migrationResult === 'upgraded' || reservationResult === 'reserved');
  if (migrationResult === 'upgraded') {
    assert.equal(version(f.file), 2);
    assert.equal(rows(f.file).length, 0);
    assert.notEqual(reservationResult, 'reserved');
  } else {
    assert.equal(version(f.file), 1);
    assert.equal(reservationResult, 'reserved');
    assert.equal(rows(f.file).length, 1);
    assert.throws(() => upgradeExperimentBudgetForEmbeddings(request), error('configuration_mismatch'));
  }
});
