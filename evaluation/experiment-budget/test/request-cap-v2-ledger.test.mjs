import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createExperimentBudget, inspectEmbeddingExperimentBudgetSnapshot,
  inspectExperimentBudgetForEmbeddingUpgrade, openBoundEmbeddingExperimentBudget,
  projectEmbeddingBudgetCapPrefix, reopenExperimentBudget,
  transitionEmbeddingExperimentBudgetRequestCap, upgradeExperimentBudgetForEmbeddings,
} from '../index.mjs';

const denied = code => error => error?.code === code && error.message === code;
const database = config => path.join(config.directory, 'experiment-budget.sqlite');
const rows = config => {
  const db = new DatabaseSync(database(config), { readOnly: true });
  try { return db.prepare(`SELECT rowid, attempt_id, channel, reserved_micro_usd,
    outcome, actual_micro_usd FROM attempts ORDER BY rowid`).all(); }
  finally { db.close(); }
};

function fixture(t) {
  const root = mkdtempSync(path.join(tmpdir(), 'cairn-request-cap-v2-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const oldConfiguration = { directory: path.join(root, 'budget'), runId: randomUUID(),
    limitMicroUsd: 200_000_000, requestCap: 5 };
  createExperimentBudget(oldConfiguration).close();
  const old = reopenExperimentBudget(oldConfiguration);
  for (const [reservedMicroUsd, outcome, actualMicroUsd] of [[13, 'unknown', null],
    [17, 'succeeded', 5]]) {
    const attemptId = randomUUID();
    old.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd });
    old.recordOutcome(actualMicroUsd === null ? { attemptId, outcome }
      : { attemptId, outcome, actualMicroUsd });
  }
  old.close();
  const db = new DatabaseSync(database(oldConfiguration));
  db.exec('UPDATE attempts SET rowid = 9 WHERE rowid = 2');
  db.close();
  const before = inspectExperimentBudgetForEmbeddingUpgrade(oldConfiguration);
  upgradeExperimentBudgetForEmbeddings({ ...oldConfiguration,
    expectedCheckpoint: { requestCount: 2, reservedMicroUsd: 30 },
    expectedHistorySha256: before.historySha256 });
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(oldConfiguration);
  return { oldConfiguration, newConfiguration: { ...oldConfiguration, requestCap: 8 },
    checkpoint: { requestCount: 2, reservedMicroUsd: 30 }, snapshot,
    beforeRows: rows(oldConfiguration) };
}

const transition = (f, overrides = {}) => transitionEmbeddingExperimentBudgetRequestCap({
  oldConfiguration: f.oldConfiguration, newConfiguration: f.newConfiguration,
  expectedCheckpoint: f.checkpoint, expectedOldHistorySha256: f.snapshot.historySha256,
  authorize() {}, ...overrides });

test('C1-C3 rowid-aware same-dollar transition changes full hash, not rows or reserve', t => {
  const f = fixture(t);
  const witness = projectEmbeddingBudgetCapPrefix({ snapshot: f.snapshot, oldRequestCap: 5,
    newRequestCap: 8, checkpoint: f.checkpoint });
  assert.equal(witness.oldPrefixHistorySha256, f.snapshot.historySha256);
  assert.notEqual(witness.newPrefixHistorySha256, witness.oldPrefixHistorySha256);
  assert.throws(() => projectEmbeddingBudgetCapPrefix({ snapshot: structuredClone(f.snapshot),
    oldRequestCap: 5, newRequestCap: 8, checkpoint: f.checkpoint }), denied('invalid_options'));
  let calls = 0;
  const after = transition(f, { authorize({ mode, state, checkpointAttempts, witness: seen }) {
    calls += 1;
    assert.equal(mode, 'transition');
    assert.equal(state.historySha256, f.snapshot.historySha256);
    assert.equal(checkpointAttempts.length, 2);
    assert.deepEqual(seen, witness);
  } });
  assert.equal(calls, 1);
  assert.equal(after.historySha256, witness.newPrefixHistorySha256);
  assert.deepEqual(rows(f.newConfiguration), f.beforeRows);
  assert.equal(after.reservedMicroUsd, 30);
  assert.equal(after.requestCount, 2);
  assert.equal(after.limitMicroUsd, 200_000_000);
  assert.deepEqual(transition(f).attempts, after.attempts);
  const bound = openBoundEmbeddingExperimentBudget({ configuration: f.newConfiguration,
    authorize() {} });
  assert.throws(() => bound.reserve({ attemptId: randomUUID(), channel: 'host-embedding',
    reservedMicroUsd: 200_000_000 - 30 + 1 }), denied('budget_exceeded'));
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.newConfiguration).requestCount, 2);
  assert.deepEqual(rows(f.newConfiguration), f.beforeRows);
  const continued = openBoundEmbeddingExperimentBudget({ configuration: f.newConfiguration,
    authorize() {} });
  const id = randomUUID();
  continued.reserve({ attemptId: id, channel: 'host-embedding', reservedMicroUsd: 7 });
  continued.recordOutcome({ attemptId: id, outcome: 'failed' });
  continued.close();
  const suffix = inspectEmbeddingExperimentBudgetSnapshot(f.newConfiguration);
  assert.notEqual(suffix.historySha256, witness.newPrefixHistorySha256);
  assert.deepEqual(projectEmbeddingBudgetCapPrefix({ snapshot: suffix, oldRequestCap: 5,
    newRequestCap: 8, checkpoint: f.checkpoint }), witness);
  assert.equal(transition(f).historySha256, suffix.historySha256);
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.newConfiguration).reservedMicroUsd, 37);
});

test('C2/C7 an already-migrated embedding suffix is in the old-cap witness', t => {
  const f = fixture(t);
  const bound = openBoundEmbeddingExperimentBudget({ configuration: f.oldConfiguration,
    authorize() {} });
  const id = randomUUID();
  bound.reserve({ attemptId: id, channel: 'host-embedding', reservedMicroUsd: 7 });
  bound.recordOutcome({ attemptId: id, outcome: 'failed' });
  bound.close();
  const checkpoint = { requestCount: 3, reservedMicroUsd: 37 };
  const before = inspectEmbeddingExperimentBudgetSnapshot(f.oldConfiguration);
  const beforeRows = rows(f.oldConfiguration);
  const after = transition(f, { expectedCheckpoint: checkpoint,
    expectedOldHistorySha256: before.historySha256 });
  assert.equal(after.requestCount, 3);
  assert.equal(after.historySha256, projectEmbeddingBudgetCapPrefix({ snapshot: before,
    oldRequestCap: 5, newRequestCap: 8, checkpoint }).newPrefixHistorySha256);
  assert.deepEqual(rows(f.newConfiguration), beforeRows);
  assert.deepEqual(after.attempts.map(row => row.channel),
    ['host-completion', 'host-completion', 'host-embedding']);
});

test('C1/C5 stale, wrong cap, monetary mutation and callback failure deny without CAS', t => {
  const f = fixture(t);
  const wrong = [
    { expectedCheckpoint: { requestCount: 1, reservedMicroUsd: 13 } },
    { expectedCheckpoint: { requestCount: 2, reservedMicroUsd: 31 } },
    { expectedOldHistorySha256: '0'.repeat(64) },
    { newConfiguration: { ...f.newConfiguration, limitMicroUsd: 200_000_001 } },
    { newConfiguration: { ...f.newConfiguration, requestCap: 5 } },
  ];
  for (const override of wrong) assert.throws(() => transition(f, override));
  assert.throws(() => transition(f, { authorize() { throw new Error('private sentinel'); } }),
    denied('ledger_failed'));
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.oldConfiguration).requestCap, 5);
  assert.deepEqual(rows(f.oldConfiguration), f.beforeRows);
});

test('C5 pending and overrun block before callback; reserves never refund', t => {
  const pending = fixture(t);
  const old = openBoundEmbeddingExperimentBudget({ configuration: pending.oldConfiguration,
    authorize() {} });
  const id = randomUUID();
  old.reserve({ attemptId: id, channel: 'host-embedding', reservedMicroUsd: 9 });
  old.close();
  assert.throws(() => transition(pending, { expectedCheckpoint: { requestCount: 3,
    reservedMicroUsd: 39 } }), denied('budget_blocked'));
  const overrun = fixture(t);
  const handle = openBoundEmbeddingExperimentBudget({ configuration: overrun.oldConfiguration,
    authorize() {} });
  const secondId = randomUUID();
  handle.reserve({ attemptId: secondId, channel: 'host-embedding', reservedMicroUsd: 3 });
  handle.recordOutcome({ attemptId: secondId, outcome: 'succeeded', actualMicroUsd: 4 });
  handle.close();
  assert.throws(() => transition(overrun, { expectedCheckpoint: { requestCount: 3,
    reservedMicroUsd: 33 } }), denied('budget_blocked'));
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(overrun.oldConfiguration).reservedMicroUsd, 33);
});
