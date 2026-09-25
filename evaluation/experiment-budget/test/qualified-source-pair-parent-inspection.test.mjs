import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { createExperimentBudget, inspectExperimentBudgetSnapshot } from '../index.mjs';
import { authorizeBenchmarkExtension, authorizeBenchmarkRequestAllowance,
  authorizeBenchmarkBudgetExtension, authorizeChainedBenchmarkBudgetExtension,
  createExperimentRequestGuard, inspectQualifiedSourcePairParent } from '../request-guard.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { experimentPolicy } from '../../live/session.mjs';

function fixture(t, target200 = false) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-pair-parent-inspect-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = { directory: join(root, 'ledger space #'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  createExperimentBudget(first).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: first, policy, fetchImpl: () => assert.fail('HTTP') }).close();
  const original = authorizeBenchmarkExtension({ ledger: first, policy,
    authorizationId: 'original', stages: benchmarkStagePolicy() });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: first, policy,
    benchmarkExtension: original, authorizationId: 'allowance', newRequestCap: 20,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const second = { ...first, requestCap: 20 };
  const parent100 = authorizeBenchmarkBudgetExtension({ oldLedger: second, policy,
    requestAllowance: allowance, authorizationId: 'parent100', newLimitMicroUsd: 100_000_000,
    newRequestCap: 40, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const ledger100 = { ...second, limitMicroUsd: 100_000_000, requestCap: 40 };
  const parent200 = target200 ? authorizeChainedBenchmarkBudgetExtension({ oldLedger: ledger100, policy,
    parentBudgetExtension: parent100, authorizationId: 'parent200', newLimitMicroUsd: 200_000_000,
    newRequestCap: 80, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } }) : null;
  const ledger200 = { ...ledger100, limitMicroUsd: 200_000_000, requestCap: 80 };
  return { first, policy, ledger100, ledger200, parent100, parent200 };
}

function files(directory) {
  return Object.fromEntries(readdirSync(directory).sort().map((name) =>
    [name, readFileSync(join(directory, name))]));
}

test('L1 inspect both complete file-bound parents without mutating ledger or bindings', (t) => {
  for (const target200 of [false, true]) {
    const f = fixture(t, target200);
    const before = files(f.first.directory);
    const ledger = target200 ? f.ledger200 : f.ledger100;
    const benchmarkExtension = target200 ? f.parent200 : f.parent100;
    const expected = inspectExperimentBudgetSnapshot(ledger);
    const state = inspectQualifiedSourcePairParent({ ledger, policy: f.policy, benchmarkExtension });
    assert.deepEqual(state, expected);
    assert.equal(Object.isFrozen(state), true);
    assert.equal(Object.isFrozen(state.attempts), true);
    assert.deepEqual(files(f.first.directory), before);
  }
});

test('L1 inspector rejects mismatched or forged parents and exact options', (t) => {
  const f = fixture(t, true);
  const before = files(f.first.directory);
  assert.throws(() => inspectQualifiedSourcePairParent({ ledger: f.ledger100,
    policy: f.policy, benchmarkExtension: f.parent200 }), /configuration_mismatch/);
  assert.throws(() => inspectQualifiedSourcePairParent({ ledger: f.ledger200,
    policy: f.policy, benchmarkExtension: { ...f.parent200, historicalDigest: '0'.repeat(64) } }),
  /policy_mismatch|invalid_extension|unsafe_policy_binding/);
  assert.throws(() => inspectQualifiedSourcePairParent({ ledger: f.ledger200,
    policy: f.policy, benchmarkExtension: f.parent200, extra: true }), /invalid_options/);
  assert.deepEqual(files(f.first.directory), before);
});
