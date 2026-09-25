import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, existsSync, linkSync, lstatSync, mkdtempSync, readFileSync,
  renameSync, rmSync, symlinkSync, unlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

import { createExperimentBudget, inspectEmbeddingExperimentBudgetSnapshot,
  inspectExperimentBudgetForEmbeddingUpgrade, openBoundEmbeddingExperimentBudget,
  reopenEmbeddingExperimentBudget, reopenExperimentBudget,
  upgradeExperimentBudgetForEmbeddings } from '../index.mjs';

const denied = code => error => error?.code === code;
const filename = config => path.join(config.directory, 'experiment-budget.sqlite');
const child = fileURLToPath(new URL('../testing/bound-embedding-ledger-child.mjs', import.meta.url));

function runChild(mode, config, attemptId = randomUUID()) {
  const result = spawnSync(process.execPath, [child, mode, JSON.stringify(config), attemptId],
    { encoding: 'utf8', timeout: 10_000,
    env: { ...process.env, NODE_NO_WARNINGS: '1' } });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function fixture(t, overrides = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'cairn-bound-embedding-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = { directory: path.join(root, 'budget #v2'), runId: randomUUID(),
    limitMicroUsd: 1000, requestCap: 8, ...overrides };
  const handle = createExperimentBudget(config);
  const firstId = randomUUID();
  handle.reserve({ attemptId: firstId, channel: 'host-completion', reservedMicroUsd: 13 });
  handle.recordOutcome({ attemptId: firstId, outcome: 'unknown' });
  const secondId = randomUUID();
  handle.reserve({ attemptId: secondId, channel: 'cairn-count', reservedMicroUsd: 17 });
  handle.recordOutcome({ attemptId: secondId, outcome: 'succeeded', actualMicroUsd: 5 });
  handle.close();
  const db = new DatabaseSync(filename(config));
  db.prepare('UPDATE attempts SET rowid = 9 WHERE attempt_id = ?').run(secondId);
  db.close();
  const beforeRows = rawRows(config);
  const inspection = inspectExperimentBudgetForEmbeddingUpgrade(config);
  const migrated = upgradeExperimentBudgetForEmbeddings({ ...config,
    expectedCheckpoint: { requestCount: inspection.requestCount,
      reservedMicroUsd: inspection.reservedMicroUsd },
    expectedHistorySha256: inspection.historySha256 });
  assert.equal(migrated.status, 'upgraded');
  assert.equal(migrated.historySha256, inspection.historySha256);
  assert.deepEqual(rawRows(config), beforeRows);
  return { root, config, firstId, secondId, beforeRows, inspection };
}

function rawRows(config) {
  const db = new DatabaseSync(filename(config), { readOnly: true });
  try { return db.prepare(`SELECT rowid, attempt_id, channel, reserved_micro_usd,
    outcome, actual_micro_usd FROM attempts ORDER BY rowid`).all(); }
  finally { db.close(); }
}

function bound(config, authorize = () => {}) {
  return openBoundEmbeddingExperimentBudget({ configuration: config, authorize });
}

test('B3 exact-v2 read-only snapshot preserves rowids and detached frozen history', t => {
  const f = fixture(t);
  const beforeBytes = readFileSync(filename(f.config));
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(f.config);
  assert.deepEqual(Object.keys(snapshot), ['schemaVersion', 'runId', 'limitMicroUsd',
    'requestCap', 'reservedMicroUsd', 'requestCount', 'state', 'attempts', 'historySha256']);
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.historySha256, f.inspection.historySha256);
  assert.equal(snapshot.attempts[0].outcome, 'unknown');
  assert.equal(snapshot.attempts[0].actualMicroUsd, null);
  assert.deepEqual(f.beforeRows.map(row => row.rowid), [1, 9]);
  assert.equal(Object.isFrozen(snapshot), true);
  assert.equal(Object.isFrozen(snapshot.attempts), true);
  assert.equal(Object.isFrozen(snapshot.attempts[0]), true);
  assert.deepEqual(readFileSync(filename(f.config)), beforeBytes);
  assert.deepEqual(rawRows(f.config), f.beforeRows);
  assert.equal(existsSync(`${filename(f.config)}-journal`), false);
  const old = reopenEmbeddingExperimentBudget(f.config);
  assert.equal(Object.hasOwn(old.getState(), 'schemaVersion'), false);
  old.close();
  assert.throws(() => reopenExperimentBudget(f.config), denied('invalid_ledger'));
});

test('B4/B6 bound v2 reserves exact next rowid and witnesses mixed shared channels', t => {
  const f = fixture(t);
  let received;
  const handle = bound(f.config, snapshot => { received = snapshot;
    assert.equal(Object.isFrozen(snapshot.attempts[0]), true); });
  t.after(() => handle.close());
  assert.equal(received.historySha256, f.inspection.historySha256);
  const embeddingId = randomUUID();
  assert.deepEqual(handle.reserve({ attemptId: embeddingId, channel: 'host-embedding',
    reservedMicroUsd: 40 }), { attemptId: embeddingId, channel: 'host-embedding',
    reservedMicroUsd: 40, outcome: null, actualMicroUsd: null });
  assert.equal(handle.getState().requestCount, 3);
  assert.deepEqual(rawRows(f.config).map(row => row.rowid), [1, 9, 10]);
  assert.equal(handle.getState().historySha256,
    inspectEmbeddingExperimentBudgetSnapshot(f.config).historySha256);
  assert.deepEqual(handle.recordOutcome({ attemptId: embeddingId, outcome: 'failed' }),
    { attemptId: embeddingId, channel: 'host-embedding', reservedMicroUsd: 40,
      outcome: 'failed', actualMicroUsd: null });
  const otherId = randomUUID();
  handle.reserve({ attemptId: otherId, channel: 'cairn-generation', reservedMicroUsd: 0 });
  handle.recordOutcome({ attemptId: otherId, outcome: 'succeeded', actualMicroUsd: 0 });
  const after = handle.getState();
  assert.equal(after.reservedMicroUsd, 70);
  assert.equal(after.requestCount, 4);
  assert.deepEqual(after.attempts.map(attempt => attempt.channel),
    ['host-completion', 'cairn-count', 'host-embedding', 'cairn-generation']);
  assert.equal(after.historySha256, inspectEmbeddingExperimentBudgetSnapshot(f.config).historySha256);
});

test('B3 diagnostic snapshot permits pending and overrun; bound open rejects both', t => {
  const pending = fixture(t);
  const ordinary = reopenEmbeddingExperimentBudget(pending.config);
  const pendingId = randomUUID();
  ordinary.reserve({ attemptId: pendingId, channel: 'host-embedding', reservedMicroUsd: 10 });
  ordinary.close();
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(pending.config).attempts.at(-1).outcome, null);
  assert.throws(() => bound(pending.config), denied('budget_blocked'));
  const overrun = fixture(t);
  const second = reopenEmbeddingExperimentBudget(overrun.config);
  const overrunId = randomUUID();
  second.reserve({ attemptId: overrunId, channel: 'host-embedding', reservedMicroUsd: 5 });
  second.recordOutcome({ attemptId: overrunId, outcome: 'succeeded', actualMicroUsd: 6 });
  second.close();
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(overrun.config).state, 'overrun');
  assert.throws(() => bound(overrun.config), denied('budget_blocked'));
});

test('B5 exact descriptor snapshot refuses getters before filesystem and bound mutation', t => {
  const f = fixture(t);
  let calls = 0;
  const getter = { ...f.config };
  Object.defineProperty(getter, 'runId', { enumerable: true,
    get() { calls += 1; return f.config.runId; } });
  const outer = { configuration: f.config, authorize() {} };
  Object.defineProperty(outer, 'configuration', { enumerable: true,
    get() { calls += 1; return f.config; } });
  for (const action of [() => inspectEmbeddingExperimentBudgetSnapshot(getter),
    () => openBoundEmbeddingExperimentBudget(outer),
    () => bound(getter)]) assert.throws(action, denied('invalid_options'));
  assert.equal(calls, 0);
  const handle = bound(f.config);
  t.after(() => handle.close());
  const reserveOptions = { attemptId: randomUUID(), channel: 'host-embedding', reservedMicroUsd: 1 };
  Object.defineProperty(reserveOptions, 'channel', { enumerable: true,
    get() { calls += 1; return 'host-embedding'; } });
  assert.throws(() => handle.reserve(reserveOptions), denied('invalid_options'));
  const outcomeOptions = { attemptId: f.firstId, outcome: 'failed' };
  Object.defineProperty(outcomeOptions, 'outcome', { enumerable: true,
    get() { calls += 1; return 'failed'; } });
  assert.throws(() => handle.recordOutcome(outcomeOptions), denied('invalid_options'));
  assert.equal(calls, 0);
  assert.equal(handle.getState().requestCount, 2);
});

test('B4 callback wrong return, promise and throw refuse without changing state', t => {
  const f = fixture(t);
  const before = inspectEmbeddingExperimentBudgetSnapshot(f.config);
  assert.throws(() => bound(f.config, () => 1), denied('ledger_failed'));
  assert.throws(() => bound(f.config, () => Promise.resolve()), denied('ledger_failed'));
  assert.throws(() => bound(f.config, () => { throw new Error('synthetic callback'); }),
    denied('ledger_failed'));
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(f.config), before);
});

test('B4 in-transaction callback rowid mutation refuses and rolls back', t => {
  const f = fixture(t);
  const before = readFileSync(filename(f.config));
  const rows = rawRows(f.config);
  assert.equal(runChild('callback-sql-mutation', f.config), 'invalid_ledger');
  assert.deepEqual(rawRows(f.config), rows);
  assert.deepEqual(readFileSync(filename(f.config)), before);
});

test('B6 foreign rowid-only edit, settlement and append each fence a bound handle', t => {
  for (const edit of ['rowid', 'settlement', 'append']) {
    const f = fixture(t);
    const handle = bound(f.config);
    t.after(() => handle.close());
    const ownId = randomUUID();
    if (edit === 'settlement') handle.reserve({ attemptId: ownId, channel: 'host-embedding',
      reservedMicroUsd: 2 });
    if (edit === 'rowid') {
      const db = new DatabaseSync(filename(f.config));
      db.prepare('UPDATE attempts SET rowid = 20 WHERE attempt_id = ?').run(f.secondId);
      db.close();
    } else {
      const foreign = reopenEmbeddingExperimentBudget(f.config);
      if (edit === 'settlement') foreign.recordOutcome({ attemptId: ownId, outcome: 'unknown' });
      else { const id = randomUUID();
        foreign.reserve({ attemptId: id, channel: 'host-embedding', reservedMicroUsd: 3 });
        foreign.recordOutcome({ attemptId: id, outcome: 'unknown' }); }
      foreign.close();
    }
    assert.throws(() => handle.reserve({ attemptId: randomUUID(), channel: 'host-embedding',
      reservedMicroUsd: 1 }), denied('invalid_ledger'));
    assert.throws(() => handle.getState(), denied('ledger_closed'));
  }
});

test('B6 path, hardlink and mode drift fence before any bound write', t => {
  for (const edit of ['missing', 'symlink', 'hardlink', 'mode']) {
    const f = fixture(t);
    const handle = bound(f.config);
    t.after(() => handle.close());
    const original = filename(f.config);
    const moved = `${original}.moved`;
    const linked = `${original}.linked`;
    if (edit === 'missing') renameSync(original, moved);
    if (edit === 'symlink') { renameSync(original, moved); symlinkSync(moved, original); }
    if (edit === 'hardlink') linkSync(original, linked);
    if (edit === 'mode') chmodSync(original, 0o644);
    assert.throws(() => handle.reserve({ attemptId: randomUUID(), channel: 'host-embedding',
      reservedMicroUsd: 1 }));
    assert.throws(() => handle.getState(), denied('ledger_closed'));
    if (edit === 'mode') chmodSync(original, 0o600);
    if (edit === 'hardlink') unlinkSync(linked);
  }
});

test('B3/B4 v1, wrong schema and missing v2 file reject without creation', t => {
  const root = mkdtempSync(path.join(tmpdir(), 'cairn-bound-embedding-v1-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const v1 = { directory: path.join(root, 'budget'), runId: randomUUID(),
    limitMicroUsd: 100, requestCap: 3 };
  createExperimentBudget(v1).close();
  const before = readFileSync(filename(v1));
  assert.throws(() => inspectEmbeddingExperimentBudgetSnapshot(v1), denied('invalid_ledger'));
  assert.throws(() => bound(v1), denied('invalid_ledger'));
  assert.deepEqual(readFileSync(filename(v1)), before);
  const f = fixture(t);
  const db = new DatabaseSync(filename(f.config));
  db.exec('PRAGMA user_version = 3');
  db.close();
  assert.throws(() => inspectEmbeddingExperimentBudgetSnapshot(f.config), denied('invalid_ledger'));
  assert.throws(() => bound(f.config), denied('invalid_ledger'));
  const moved = `${filename(f.config)}.moved`;
  renameSync(filename(f.config), moved);
  assert.throws(() => bound(f.config), denied('ledger_missing'));
  assert.equal(existsSync(filename(f.config)), false);
  assert.equal(lstatSync(moved).isFile(), true);
});

test('B4/B6 constructor race, post-work foreign rowid and commit failures fence without retry', t => {
  const raced = fixture(t);
  const original = readFileSync(filename(raced.config));
  assert.equal(runChild('rename-open', raced.config), 'ledger_failed');
  assert.equal(existsSync(filename(raced.config)), false);
  assert.deepEqual(readFileSync(`${filename(raced.config)}.moved`), original);
  assert.equal(existsSync(`${filename(raced.config)}-journal`), false);
  for (const mode of ['foreign-post-work', 'fail-before-commit', 'fail-after-commit']) {
    const f = fixture(t);
    const ownId = randomUUID();
    assert.deepEqual(JSON.parse(runChild(mode, f.config, ownId)),
      { first: mode === 'foreign-post-work' ? 'invalid_ledger' : 'ledger_failed',
        second: 'ledger_closed' });
    const state = inspectEmbeddingExperimentBudgetSnapshot(f.config);
    const committed = mode === 'fail-after-commit';
    assert.equal(state.requestCount, committed ? 3 : 2);
    assert.equal(state.reservedMicroUsd, committed ? 37 : 30);
    assert.deepEqual(rawRows(f.config).map(row => row.rowid), committed ? [1, 9, 10] : [1, 9]);
    assert.equal(state.attempts.some(row => row.attemptId === ownId), committed);
    if (committed) assert.equal(state.attempts.at(-1).outcome, null);
  }
});

test('B9 fake batch failure and individual fallback reserve before every physical dispatch', t => {
  const f = fixture(t, { requestCap: 5 });
  const handle = bound(f.config);
  t.after(() => handle.close());
  const physical = [];
  const dispatch = (channel, reservation, outcome, actual) => {
    const attemptId = randomUUID();
    handle.reserve({ attemptId, channel, reservedMicroUsd: reservation });
    const snapshot = inspectEmbeddingExperimentBudgetSnapshot(f.config);
    assert.equal(snapshot.attempts.at(-1).attemptId, attemptId);
    assert.equal(snapshot.attempts.at(-1).outcome, null);
    physical.push({ attemptId, channel }); // Synthetic transport begins only here.
    handle.recordOutcome(actual === undefined ? { attemptId, outcome }
      : { attemptId, outcome, actualMicroUsd: actual });
  };
  dispatch('host-embedding', 70, 'unknown'); // failed batch, unknown cost charged
  dispatch('host-embedding', 30, 'succeeded', 11); // first individual fallback
  dispatch('host-embedding', 30, 'failed'); // second individual fallback
  assert.equal(physical.length, 3);
  const state = handle.getState();
  assert.equal(state.requestCount, 5);
  assert.equal(state.reservedMicroUsd, 160);
  assert.equal(state.attempts[2].actualMicroUsd, null);
  assert.equal(state.attempts[3].actualMicroUsd, 11);
  assert.throws(() => handle.reserve({ attemptId: randomUUID(), channel: 'host-embedding',
    reservedMicroUsd: 0 }), denied('request_cap_exceeded'));
  assert.equal(physical.length, 3);
});

test('B9 every existing G guard factory rejects migrated v2 before claim or transport', t => {
  const f = fixture(t);
  const result = JSON.parse(runChild('old-guards-v2', f.config));
  assert.deepEqual(Object.keys(result.observed), ['baseline', 'extended', 'reconciliation',
    'qualification', 'candidate', 'checklist', 'rationale', 'rationale-models',
    'basis-models', 'benchmark', 'case-deadline', 'qualified-pair', 'adaptive-pair']);
  assert.equal(Object.values(result.observed).every(code => code === 'invalid_ledger'), true,
    JSON.stringify(result.observed));
  assert.equal(result.claimsAbsent, true);
  assert.equal(result.physical, 0);
  assert.deepEqual([result.normalCount, result.pairCount], [0, 0]);
});

test('B6 callback filesystem mutation is refused, without pretending it was undone', t => {
  const f = fixture(t);
  const moved = `${filename(f.config)}.moved`;
  const before = readFileSync(filename(f.config));
  assert.throws(() => bound(f.config, () => renameSync(filename(f.config), moved)),
    denied('ledger_missing'));
  assert.equal(existsSync(filename(f.config)), false);
  assert.equal(lstatSync(moved).isFile(), true);
  assert.deepEqual(readFileSync(moved), before);
});
