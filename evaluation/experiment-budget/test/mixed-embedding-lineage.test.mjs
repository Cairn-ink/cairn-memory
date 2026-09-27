import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createExperimentBudget, inspectEmbeddingExperimentBudgetSnapshot,
  inspectExperimentBudgetForEmbeddingUpgrade, openBoundEmbeddingExperimentBudget,
  reopenExperimentBudget, upgradeExperimentBudgetForEmbeddings } from '../index.mjs';
import { assertChainedBenchmarkParentForEmbeddingSnapshot,
  authorizeBenchmarkBudgetExtension, authorizeBenchmarkExtension,
  authorizeBenchmarkRequestAllowance, authorizeChainedBenchmarkBudgetExtension,
  createExperimentRequestGuard, inspectQualifiedSourcePairParent } from '../request-guard.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { experimentPolicy } from '../../live/session.mjs';

const denied = (name, code) => error => error?.name === name && error.code === code
  && error.message === code;
const budget = code => denied('ExperimentBudgetError', code);
const guard = code => denied('ExperimentRequestGuardError', code);
const noTransport = () => assert.fail('synthetic lineage must not send HTTP');
const clone = value => structuredClone(value);

function add(configuration, reservedMicroUsd, outcome, actualMicroUsd) {
  const handle = reopenExperimentBudget(configuration);
  try {
    const attemptId = randomUUID();
    handle.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd });
    handle.recordOutcome(actualMicroUsd === undefined ? { attemptId, outcome }
      : { attemptId, outcome, actualMicroUsd });
  } finally { handle.close(); }
}

function fixture(t, targetCap = 80) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-mixed-lineage-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = { directory: join(root, 'budget space #'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  createExperimentBudget(first).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: first, policy, fetchImpl: noTransport }).close();
  const original = authorizeBenchmarkExtension({ ledger: first, policy,
    authorizationId: 'synthetic-original', stages: benchmarkStagePolicy() });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: first, policy,
    benchmarkExtension: original, authorizationId: 'synthetic-allowance', newRequestCap: 20,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const second = { ...first, requestCap: 20 };
  add(second, 13, 'unknown');
  add(second, 17, 'succeeded', 9);
  const parent = authorizeBenchmarkBudgetExtension({ oldLedger: second, policy,
    requestAllowance: allowance, authorizationId: 'synthetic-parent100',
    newLimitMicroUsd: 100_000_000, newRequestCap: 40,
    expectedCheckpoint: { requestCount: 2, reservedMicroUsd: 30 } });
  const prior = { ...second, limitMicroUsd: 100_000_000, requestCap: 40 };
  add(prior, 19, 'failed');
  const ledger = { ...prior, limitMicroUsd: 200_000_000, requestCap: targetCap };
  const benchmarkExtension = authorizeChainedBenchmarkBudgetExtension({ oldLedger: prior,
    policy, parentBudgetExtension: parent, authorizationId: 'synthetic-parent200',
    newLimitMicroUsd: ledger.limitMicroUsd, newRequestCap: ledger.requestCap,
    expectedCheckpoint: { requestCount: 3, reservedMicroUsd: 49 } });
  add(ledger, 23, 'unknown'); // A terminal suffix after the inherited checkpoint.
  const before = inspectExperimentBudgetForEmbeddingUpgrade(ledger);
  upgradeExperimentBudgetForEmbeddings({ ...ledger,
    expectedCheckpoint: { requestCount: before.requestCount,
      reservedMicroUsd: before.reservedMicroUsd }, expectedHistorySha256: before.historySha256 });
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(ledger);
  return { root, ledger, policy, benchmarkExtension, parent, snapshot, before };
}

const options = (f, overrides = {}) => ({ ledger: f.ledger, policy: f.policy,
  benchmarkExtension: f.benchmarkExtension, snapshot: f.snapshot, ...overrides });
const fileBytes = directory => Object.fromEntries(readdirSync(directory).sort().map(name =>
  [name, readFileSync(join(directory, name))]));

test('M1/M4/M7 real 50→100→200 chain and migrated v2 B3/B4 paths remain read-only', t => {
  const f = fixture(t);
  const before = fileBytes(f.ledger.directory);
  assert.equal(f.snapshot.schemaVersion, 2);
  assert.equal(f.snapshot.requestCount, 4);
  assert.deepEqual(f.snapshot.attempts.map(row => row.outcome),
    ['unknown', 'succeeded', 'failed', 'unknown']);
  assert.equal(assertChainedBenchmarkParentForEmbeddingSnapshot(options(f)), undefined);
  assert.deepEqual(fileBytes(f.ledger.directory), before);
  let called = 0;
  const handle = openBoundEmbeddingExperimentBudget({ configuration: f.ledger,
    authorize(snapshot) {
      called += 1;
      assert.equal(snapshot.historySha256, f.snapshot.historySha256);
      assert.equal(assertChainedBenchmarkParentForEmbeddingSnapshot(options(f, { snapshot })), undefined);
    } });
  handle.close();
  assert.equal(called, 1);
  assert.deepEqual(fileBytes(f.ledger.directory), before);
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(f.ledger), f.snapshot);
  assert.throws(() => reopenExperimentBudget(f.ledger), budget('invalid_ledger'));
  assert.throws(() => inspectQualifiedSourcePairParent({ ledger: f.ledger,
    policy: f.policy, benchmarkExtension: f.benchmarkExtension }), budget('invalid_ledger'));
  assert.throws(() => createExperimentRequestGuard({ ledger: f.ledger,
    policy: f.policy, fetchImpl: noTransport }), budget('invalid_ledger'));
});

test('M4/M5 original prefix is bound; a claimed suffix and digest are not authenticated', t => {
  const f = fixture(t);
  const changedSuffix = clone(f.snapshot);
  changedSuffix.attempts.at(-1).outcome = 'failed';
  changedSuffix.historySha256 = 'a'.repeat(64);
  assert.notDeepEqual(changedSuffix, f.snapshot);
  assert.equal(assertChainedBenchmarkParentForEmbeddingSnapshot(options(f,
    { snapshot: changedSuffix })), undefined);
  assert.deepEqual(inspectEmbeddingExperimentBudgetSnapshot(f.ledger), f.snapshot);
  const changedPrefix = clone(f.snapshot);
  changedPrefix.attempts[0].outcome = 'failed';
  changedPrefix.historySha256 = 'b'.repeat(64);
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(options(f,
    { snapshot: changedPrefix })), guard('policy_mismatch'));
});

test('M4/M6 inherited file binding, policy and 200M parent restrictions refuse', t => {
  const f = fixture(t);
  const before = fileBytes(f.ledger.directory);
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(options(f,
    { ledger: { ...f.ledger, runId: randomUUID() } })), budget('invalid_ledger'));
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(options(f,
    { ledger: { ...f.ledger, requestCap: 81 } })), budget('invalid_ledger'));
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(options(f,
    { ledger: { ...f.ledger, directory: '/' } })), guard('invalid_options'));
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(options(f,
    { ledger: { ...f.ledger, directory: 'bad\0path' } })), guard('invalid_options'));
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(options(f,
    { policy: { ...f.policy, hostCompletion: { ...f.policy.hostCompletion,
      reservedMicroUsd: f.policy.hostCompletion.reservedMicroUsd + 1 } } })),
  guard('invalid_extension'));
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(options(f,
    { benchmarkExtension: f.parent })), guard('invalid_capability'));
  const chainFile = join(f.ledger.directory,
    `experiment-benchmark-budget-chain-${f.parent.authorizationId}.json`);
  renameSync(chainFile, `${chainFile}.moved`);
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(options(f)),
    guard('unsafe_policy_binding'));
  renameSync(`${chainFile}.moved`, chainFile);
  const modified = clone(f.benchmarkExtension);
  modified.historicalDigest = '0'.repeat(64);
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(options(f,
    { benchmarkExtension: modified })), guard('policy_mismatch'));
  assert.deepEqual(fileBytes(f.ledger.directory), before);
});

test('M3/M6 supplied B snapshot shape and accounting fail before binding reads', t => {
  const f = fixture(t);
  const changes = [
    snapshot => { snapshot.schemaVersion = 1; },
    snapshot => { snapshot.extra = true; },
    snapshot => { snapshot.attempts[0].channel = 'unlisted'; },
    snapshot => { snapshot.attempts[1].attemptId = snapshot.attempts[0].attemptId; },
    snapshot => { snapshot.attempts[0].actualMicroUsd = 1; snapshot.attempts[0].outcome = null; },
    snapshot => { snapshot.attempts[0].reservedMicroUsd += 1; },
    snapshot => { snapshot.state = 'overrun'; },
    snapshot => { snapshot.attempts[1].actualMicroUsd = 18; },
    snapshot => { snapshot.historySha256 = 'ABC'; },
    snapshot => { snapshot.requestCount = f.ledger.requestCap + 1; },
  ];
  for (const change of changes) {
    const snapshot = clone(f.snapshot);
    change(snapshot);
    assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(options(f,
      { snapshot })), budget('invalid_ledger'));
  }
  const pending = clone(f.snapshot);
  pending.attempts.at(-1).outcome = null;
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(options(f,
    { snapshot: pending })), guard('extension_busy'));
  const overrun = clone(f.snapshot);
  overrun.state = 'overrun';
  overrun.attempts.at(-1).actualMicroUsd = 24;
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(options(f,
    { snapshot: overrun })), guard('extension_busy'));
  assert.equal(f.snapshot.attempts[0].actualMicroUsd, null); // Terminal unknown stays valid.
});

test('M2/M6 descriptors and traversal limits reject without invoking getters', t => {
  const f = fixture(t);
  let getters = 0;
  const outer = options(f);
  Object.defineProperty(outer, 'snapshot', { enumerable: true,
    get() { getters += 1; return f.snapshot; } });
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(outer),
    guard('invalid_options'));
  const nested = clone(f.snapshot);
  Object.defineProperty(nested.attempts[0], 'channel', { enumerable: true,
    get() { getters += 1; return 'host-completion'; } });
  assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(options(f,
    { snapshot: nested })), guard('invalid_options'));
  assert.equal(getters, 0);
  const nonEnumerable = clone(f.snapshot);
  Object.defineProperty(nonEnumerable.attempts[0], 'hidden', { value: true });
  const sparse = clone(f.snapshot); sparse.attempts = new Array(2);
  const extraArray = clone(f.snapshot); extraArray.attempts.extra = true;
  const symbol = clone(f.snapshot); symbol[Symbol('extra')] = true;
  const cycle = clone(f.snapshot); cycle.self = cycle;
  const deep = clone(f.snapshot); let cursor = deep;
  for (let index = 0; index < 33; index += 1) { cursor.extra = {}; cursor = cursor.extra; }
  const oversized = clone(f.snapshot); oversized.extra = 'x'.repeat(16 * 1024 * 1024 + 1);
  const tooMany = clone(f.snapshot); tooMany.extra = Array(1_000_001).fill(null);
  for (const snapshot of [nonEnumerable, sparse, extraArray, symbol, cycle,
    deep, oversized, tooMany]) {
    assert.throws(() => assertChainedBenchmarkParentForEmbeddingSnapshot(options(f,
      { snapshot })), guard('invalid_options'));
  }
});

test('M2/M7 valid 50,000-attempt in-memory suffix fits traversal without SQLite writes', t => {
  const f = fixture(t, 50_100);
  const before = fileBytes(f.ledger.directory);
  const snapshot = clone(f.snapshot);
  for (let index = snapshot.attempts.length; index < 50_000; index += 1) {
    snapshot.attempts.push({ attemptId: `00000000-0000-4000-8000-${index.toString(16).padStart(12, '0')}`,
      channel: 'host-embedding', reservedMicroUsd: 0, outcome: 'unknown', actualMicroUsd: null });
  }
  snapshot.requestCount = snapshot.attempts.length;
  snapshot.historySha256 = 'c'.repeat(64); // Shape only; this suffix is not authenticated.
  assert.equal(assertChainedBenchmarkParentForEmbeddingSnapshot(options(f, { snapshot })), undefined);
  assert.deepEqual(fileBytes(f.ledger.directory), before);
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.ledger).requestCount, 4);
});
