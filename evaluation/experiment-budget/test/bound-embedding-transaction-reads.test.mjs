import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createExperimentBudget, inspectEmbeddingExperimentBudgetSnapshot,
  inspectExperimentBudgetForEmbeddingUpgrade, openBoundEmbeddingExperimentBudget,
  openBoundExperimentBudget, reopenEmbeddingExperimentBudget, reopenExperimentBudget,
  upgradeExperimentBudgetForEmbeddings } from '../index.mjs';

const denied = code => error => error?.code === code;
const counts = n => ({ quickChecks: n, runReads: n, orderedHistoryReads: n });

function fixture(t, { embedding = true, bound = true, ...caps } = {}) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-bound-read-count-' });
  const configuration = { directory: join(workspace.path, 'budget'), runId: randomUUID(),
    limitMicroUsd: 1000, requestCap: 8, ...caps };
  const own = handle => { workspace.defer(() => handle.close()); return handle; };
  const seed = own(createExperimentBudget(configuration));
  const firstId = randomUUID(), secondId = randomUUID();
  seed.reserve({ attemptId: firstId, channel: 'host-completion', reservedMicroUsd: 13 });
  seed.recordOutcome({ attemptId: firstId, outcome: 'unknown' });
  seed.reserve({ attemptId: secondId, channel: 'cairn-count', reservedMicroUsd: 17 });
  seed.recordOutcome({ attemptId: secondId, outcome: 'succeeded', actualMicroUsd: 5 });
  seed.close();
  if (embedding) {
    const inspection = inspectExperimentBudgetForEmbeddingUpgrade(configuration);
    upgradeExperimentBudgetForEmbeddings({ ...configuration,
      expectedCheckpoint: { requestCount: 2, reservedMicroUsd: 30 },
      expectedHistorySha256: inspection.historySha256 });
  }
  const handle = own(bound ? (embedding ? openBoundEmbeddingExperimentBudget : openBoundExperimentBudget)
    ({ configuration, authorize() {} })
    : (embedding ? reopenEmbeddingExperimentBudget : reopenExperimentBudget)(configuration));
  const expected = [
    { attemptId: firstId, channel: 'host-completion', reservedMicroUsd: 13,
      outcome: 'unknown', actualMicroUsd: null },
    { attemptId: secondId, channel: 'cairn-count', reservedMicroUsd: 17,
      outcome: 'succeeded', actualMicroUsd: 5 },
  ];
  return { workspace, configuration, handle, expected, firstId, secondId,
    filename: join(configuration.directory, 'experiment-budget.sqlite') };
}

// Wrap only prepare, preserving the real statements and execution. The hook is
// installed after fixture construction/seeding and removed before inspections.
function measured(operation, onPrepare = () => {}) {
  const original = DatabaseSync.prototype.prepare;
  const observed = counts(0);
  DatabaseSync.prototype.prepare = function(sql) {
    const normalized = sql.trim().replace(/\s+/gu, ' ');
    if (normalized === 'PRAGMA quick_check') observed.quickChecks++;
    if (normalized === 'SELECT * FROM run_config') observed.runReads++;
    if (/^SELECT (?:rowid, )?attempt_id, channel, reserved_micro_usd, outcome, actual_micro_usd FROM attempts ORDER BY rowid$/u
      .test(normalized)) observed.orderedHistoryReads++;
    onPrepare(this, normalized, observed, original);
    return original.call(this, sql);
  };
  try { return { value: operation(), observed }; }
  finally { DatabaseSync.prototype.prepare = original; }
}

function assertSnapshot(f, expected, state = 'open') {
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(f.configuration);
  const reserved = expected.reduce((sum, row) => sum + row.reservedMicroUsd, 0);
  const history = ['cairn.embedding-budget-history.v1',
    [f.configuration.runId, f.configuration.limitMicroUsd, f.configuration.requestCap,
      reserved, expected.length, state],
    expected.map((row, index) => [index + 1, row.attemptId, row.channel,
      row.reservedMicroUsd, row.outcome, row.actualMicroUsd])];
  assert.deepEqual(snapshot, { schemaVersion: 2, runId: f.configuration.runId,
    limitMicroUsd: f.configuration.limitMicroUsd, requestCap: f.configuration.requestCap,
    reservedMicroUsd: reserved, requestCount: expected.length, state, attempts: expected,
    historySha256: createHash('sha256').update(JSON.stringify(history), 'utf8').digest('hex') });
  assert.equal(Object.isFrozen(snapshot.attempts[0]), true);
  return snapshot;
}

test('BO1/BO4 bound-v2 reserve and settlement each retain exactly two complete validations', t => {
  const f = fixture(t);
  assertSnapshot(f, f.expected);
  const attempt = { attemptId: randomUUID(), channel: 'host-embedding',
    reservedMicroUsd: 40, outcome: null, actualMicroUsd: null };
  const reservation = measured(() => f.handle.reserve({ attemptId: attempt.attemptId,
    channel: attempt.channel, reservedMicroUsd: attempt.reservedMicroUsd }));
  assert.deepEqual(reservation.value, attempt);
  assertSnapshot(f, [...f.expected, attempt]);
  const settled = { ...attempt, outcome: 'succeeded', actualMicroUsd: 7 };
  const settlement = measured(() => f.handle.recordOutcome({ attemptId: attempt.attemptId,
    outcome: 'succeeded', actualMicroUsd: 7 }));
  assert.deepEqual(settlement.value, settled);
  assertSnapshot(f, [...f.expected, settled]);
  t.diagnostic(JSON.stringify({ reserve: reservation.observed, recordOutcome: settlement.observed }));
  assert.deepEqual({ reserve: reservation.observed, recordOutcome: settlement.observed },
    { reserve: counts(2), recordOutcome: counts(2) });
});

for (const [name, embedding, bound, writeCount, readCount] of [
  ['unbound-v1', false, false, 2, 1], ['bound-v1', false, true, 3, 2],
  ['unbound-v2', true, false, 2, 1],
]) test(`BO3 ${name} validation counts and public behavior remain unchanged`, t => {
  const f = fixture(t, { embedding, bound });
  const attemptId = randomUUID();
  const reservation = measured(() => f.handle.reserve({ attemptId,
    channel: 'host-completion', reservedMicroUsd: 40 }));
  const settlement = measured(() => f.handle.recordOutcome({ attemptId, outcome: 'unknown' }));
  const read = measured(() => f.handle.getState());
  t.diagnostic(JSON.stringify({ name, reserve: reservation.observed,
    recordOutcome: settlement.observed, getState: read.observed }));
  assert.deepEqual(reservation.observed, counts(writeCount));
  assert.deepEqual(settlement.observed, counts(writeCount));
  assert.deepEqual(read.observed, counts(readCount));
  assert.equal(read.value.requestCount, 3);
  assert.equal(read.value.reservedMicroUsd, 70);
  assert.deepEqual(read.value.attempts, [...f.expected,
    { attemptId, channel: 'host-completion', reservedMicroUsd: 40,
      outcome: 'unknown', actualMicroUsd: null }]);
});

test('BO3 bound-v2 getState still performs two complete validations without changing history', t => {
  const f = fixture(t), before = assertSnapshot(f, f.expected);
  const read = measured(() => f.handle.getState());
  assert.deepEqual(read.observed, counts(2));
  assert.deepEqual(read.value, before);
});

test('BO4 unknown reservation remains fully charged and overrun blocks later work', t => {
  for (const outcome of ['unknown', 'overrun']) {
    const f = fixture(t), attemptId = randomUUID();
    f.handle.reserve({ attemptId, channel: 'host-embedding', reservedMicroUsd: 40 });
    f.handle.recordOutcome(outcome === 'unknown' ? { attemptId, outcome }
      : { attemptId, outcome: 'succeeded', actualMicroUsd: 41 });
    const expected = [...f.expected, { attemptId, channel: 'host-embedding', reservedMicroUsd: 40,
      outcome: outcome === 'unknown' ? 'unknown' : 'succeeded',
      actualMicroUsd: outcome === 'unknown' ? null : 41 }];
    assertSnapshot(f, expected, outcome === 'unknown' ? 'open' : 'overrun');
    if (outcome === 'overrun') {
      assert.throws(() => f.handle.reserve({ attemptId: randomUUID(),
        channel: 'host-embedding', reservedMicroUsd: 0 }), denied('budget_blocked'));
      assert.throws(() => f.handle.getState(), denied('ledger_closed'));
      assertSnapshot(f, expected, 'overrun');
    }
  }
});

for (const [name, caps, action, code] of [
  ['duplicate', {}, f => f.handle.reserve({ attemptId: f.firstId,
    channel: 'host-embedding', reservedMicroUsd: 0 }), 'attempt_exists'],
  ['terminal', {}, f => f.handle.recordOutcome({ attemptId: f.secondId, outcome: 'unknown' }), 'attempt_terminal'],
  ['missing', {}, f => f.handle.recordOutcome({ attemptId: randomUUID(), outcome: 'failed' }), 'attempt_not_found'],
  ['money ceiling', { limitMicroUsd: 50 }, f => f.handle.reserve({ attemptId: randomUUID(),
    channel: 'host-embedding', reservedMicroUsd: 21 }), 'budget_exceeded'],
  ['request ceiling', { requestCap: 2 }, f => f.handle.reserve({ attemptId: randomUUID(),
    channel: 'host-embedding', reservedMicroUsd: 0 }), 'request_cap_exceeded'],
]) test(`BO4 ${name} refuses without mutation and permanently fences the bound handle`, t => {
  const f = fixture(t, caps), before = assertSnapshot(f, f.expected);
  assert.throws(() => action(f), denied(code));
  assert.throws(() => f.handle.getState(), denied('ledger_closed'));
  assert.deepEqual(assertSnapshot(f, f.expected), before);
});

function corrupt(f, sql, ...parameters) {
  const db = new DatabaseSync(f.filename);
  let closed = false;
  f.workspace.defer(() => { if (!closed) db.close(); });
  try { db.prepare(sql).run(...parameters); }
  finally { db.close(); closed = true; }
}

for (const [name, change, code] of [
  ['rowid/order', f => corrupt(f, 'UPDATE attempts SET rowid = 20 WHERE attempt_id = ?', f.firstId), 'invalid_ledger'],
  ['history', f => corrupt(f, "UPDATE attempts SET channel = 'cairn-generation' WHERE attempt_id = ?", f.firstId), 'invalid_ledger'],
  ['configuration', f => corrupt(f, 'UPDATE run_config SET limit_micro_usd = 2000'), 'configuration_mismatch'],
  ['schema', f => corrupt(f, 'PRAGMA user_version = 3'), 'invalid_ledger'],
]) test(`BO4 foreign ${name} is rejected before mutation and closes the handle`, t => {
  const f = fixture(t);
  change(f);
  const db = new DatabaseSync(f.filename, { readOnly: true });
  let closed = false;
  f.workspace.defer(() => { if (!closed) db.close(); });
  const rows = () => db.prepare('SELECT rowid, * FROM attempts ORDER BY rowid').all();
  const before = rows();
  try {
    assert.throws(() => f.handle.reserve({ attemptId: randomUUID(),
      channel: 'host-embedding', reservedMicroUsd: 1 }), denied(code));
    assert.throws(() => f.handle.getState(), denied('ledger_closed'));
    assert.deepEqual(rows(), before);
  } finally { db.close(); closed = true; }
});

for (const operation of ['reserve', 'recordOutcome']) test(
  `BO2/BO4 ${operation} post-write check rejects foreign history and rolls back`, t => {
  const f = fixture(t), attemptId = randomUUID();
  const expected = [...f.expected];
  if (operation === 'recordOutcome') {
    // Establish pending settlement preconditions outside measured instrumentation.
    f.handle.reserve({ attemptId, channel: 'host-embedding', reservedMicroUsd: 40 });
    expected.push({ attemptId, channel: 'host-embedding', reservedMicroUsd: 40,
      outcome: null, actualMicroUsd: null });
  }
  const before = assertSnapshot(f, expected);
  let challenged = false;
  const write = () => operation === 'reserve'
    ? f.handle.reserve({ attemptId, channel: 'host-embedding', reservedMicroUsd: 40 })
    : f.handle.recordOutcome({ attemptId, outcome: 'succeeded', actualMicroUsd: 7 });
  assert.throws(() => measured(write, (db, sql, observed, prepare) => {
    if (sql === 'PRAGMA quick_check' && observed.quickChecks === 2) {
      challenged = true;
      // Deliberately change valid history after the write, inside its transaction.
      prepare.call(db, "UPDATE attempts SET channel = 'cairn-generation' WHERE attempt_id = ?")
        .run(f.firstId);
    }
  }), denied('invalid_ledger'));
  assert.equal(challenged, true);
  assert.throws(() => f.handle.getState(), denied('ledger_closed'));
  assert.deepEqual(assertSnapshot(f, expected), before);
});
