import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import * as budget from '../index.mjs';

const denied = code => error => error?.code === code && error.message === code;
function rows(ledger) {
  const db = new DatabaseSync(path.join(ledger.directory, 'experiment-budget.sqlite'));
  try { return db.prepare('SELECT rowid, * FROM attempts ORDER BY rowid').all(); }
  finally { db.close(); }
}
function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-budget-v4-ledger-' });
  const oldConfiguration = { directory: path.join(workspace.path, 'budget'), runId: randomUUID(),
    limitMicroUsd: 300_000_000, requestCap: 8 };
  const handle = budget.createExperimentBudget(oldConfiguration);
  try {
    for (const [reservedMicroUsd, actualMicroUsd] of [[13, null], [17, 5]]) {
      const attemptId = randomUUID();
      handle.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd });
      handle.recordOutcome(actualMicroUsd === null ? { attemptId, outcome: 'unknown' }
        : { attemptId, outcome: 'succeeded', actualMicroUsd });
    }
  } finally { handle.close(); }
  const inspection = budget.inspectExperimentBudgetForEmbeddingUpgrade(oldConfiguration);
  const checkpoint = { requestCount: 2, reservedMicroUsd: 30 };
  budget.upgradeExperimentBudgetForEmbeddings({ ...oldConfiguration,
    expectedCheckpoint: checkpoint, expectedHistorySha256: inspection.historySha256 });
  return { workspace, oldConfiguration, newConfiguration: { ...oldConfiguration,
    limitMicroUsd: 400_000_000 }, checkpoint,
  snapshot: budget.inspectEmbeddingExperimentBudgetSnapshot(oldConfiguration), beforeRows: rows(oldConfiguration) };
}

test('B402 v4 exact 300M to 400M keeps finite cap and every cost/row', t => {
  assert.equal(typeof budget.projectEmbeddingBudgetLimitV4Prefix, 'function');
  assert.equal(typeof budget.transitionEmbeddingExperimentBudgetLimitV4, 'function');
  const f = fixture(t);
  const witness = budget.projectEmbeddingBudgetLimitV4Prefix({ snapshot: f.snapshot,
    oldConfiguration: f.oldConfiguration, newConfiguration: f.newConfiguration, checkpoint: f.checkpoint });
  assert.equal(witness.oldPrefixHistorySha256, f.snapshot.historySha256);
  let mode;
  const result = budget.transitionEmbeddingExperimentBudgetLimitV4({
    oldConfiguration: f.oldConfiguration, newConfiguration: f.newConfiguration,
    expectedCheckpoint: f.checkpoint, expectedOldHistorySha256: f.snapshot.historySha256,
    authorize(value) { mode = value.mode; } });
  assert.equal(mode, 'transition');
  assert.equal(result.limitMicroUsd, 400_000_000);
  assert.equal(result.requestCap, 8);
  assert.equal(result.reservedMicroUsd, 30);
  assert.deepEqual(rows(f.newConfiguration), f.beforeRows);
  assert.throws(() => budget.projectEmbeddingBudgetLimitV4Prefix({
    snapshot: f.snapshot, oldConfiguration: f.oldConfiguration,
    newConfiguration: { ...f.newConfiguration, requestCap: 9 }, checkpoint: f.checkpoint }),
  denied('invalid_options'));
});

test('B402 exact limit/cap/run/path and own-data validation refuse before authorization', t => {
  const f = fixture(t);
  for (const newConfiguration of [
    { ...f.newConfiguration, limitMicroUsd: 400_000_001 },
    { ...f.newConfiguration, requestCap: 7 }, { ...f.newConfiguration, requestCap: 9 },
    { ...f.newConfiguration, runId: randomUUID() },
    { ...f.newConfiguration, directory: path.join(f.workspace.path, 'other') },
  ]) {
    let calls = 0;
    assert.throws(() => budget.transitionEmbeddingExperimentBudgetLimitV4({
      oldConfiguration: f.oldConfiguration, newConfiguration,
      expectedCheckpoint: f.checkpoint, expectedOldHistorySha256: f.snapshot.historySha256,
      authorize() { calls++; } }), denied('invalid_options'));
    assert.equal(calls, 0);
  }
  let getters = 0;
  const config = { ...f.newConfiguration };
  Object.defineProperty(config, 'requestCap', { enumerable: true, get() { getters++; return 8; } });
  assert.throws(() => budget.projectEmbeddingBudgetLimitV4Prefix({ snapshot: f.snapshot,
    oldConfiguration: f.oldConfiguration, newConfiguration: config, checkpoint: f.checkpoint }),
  denied('invalid_options'));
  assert.equal(getters, 0);
  assert.throws(() => budget.projectEmbeddingBudgetLimitV4Prefix({ snapshot: structuredClone(f.snapshot),
    oldConfiguration: f.oldConfiguration, newConfiguration: f.newConfiguration, checkpoint: f.checkpoint }),
  denied('invalid_options'));
  assert.deepEqual(rows(f.oldConfiguration), f.beforeRows);
});
