// Synthetic-only genuine 50/100/200 -> embedding/v2 -> 300/v3 lineage.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { join } from 'node:path';
import http from 'node:http';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { createExperimentBudget, inspectEmbeddingExperimentBudgetSnapshot,
  inspectExperimentBudgetForEmbeddingUpgrade, openBoundEmbeddingExperimentBudget,
  reopenExperimentBudget, upgradeExperimentBudgetForEmbeddings } from '../index.mjs';
import { authorizeBenchmarkBudgetExtension, authorizeBenchmarkExtension,
  authorizeBenchmarkRequestAllowance, authorizeChainedBenchmarkBudgetExtension,
  authorizeChainedBenchmarkRequestCapV2, authorizeChainedBenchmarkBudgetV3,
  authorizeMixedSourcePairCapability, createExperimentRequestGuard,
  createMixedSourcePairExperimentRequestGuard } from '../request-guard.mjs';
import { mem0WireProfile } from '../mem0-wire.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { experimentPolicy } from '../../live/session.mjs';

function settle(ledger, amount, embedding = false) {
  const budget = embedding
    ? openBoundEmbeddingExperimentBudget({ configuration: ledger, authorize() {} })
    : reopenExperimentBudget(ledger);
  try {
    const attemptId = randomUUID();
    budget.reserve({ attemptId, channel: embedding ? 'host-embedding' : 'host-completion',
      reservedMicroUsd: amount });
    budget.recordOutcome({ attemptId, outcome: 'succeeded', actualMicroUsd: 1 });
  } finally { budget.close(); }
}

export function nativeHttpTimeoutFixture(t, { artifact, configuration, fetchImpl,
  generationBatchCount = 1 }) {
  // Bounded synthetic diagnosis allowance; existing one-batch tests stay identical.
  assert.ok(Number.isSafeInteger(generationBatchCount)
    && generationBatchCount >= 1 && generationBatchCount <= 54);
  const workspace = createTestWorkspace(t, { prefix: 'cairn-nht-v3-' });
  const policy = experimentPolicy();
  const first = { directory: join(workspace.path, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 1 };
  createExperimentBudget(first).close();
  createExperimentRequestGuard({ ledger: first, policy,
    fetchImpl: () => assert.fail('setup cannot dispatch') }).close();
  const original = authorizeBenchmarkExtension({ ledger: first, policy,
    authorizationId: 'nht-original', stages: benchmarkStagePolicy() });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: first, policy,
    benchmarkExtension: original, authorizationId: 'nht-allowance', newRequestCap: 2,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const second = { ...first, requestCap: 2 };
  settle(second, 13); settle(second, 17);
  const parent100 = authorizeBenchmarkBudgetExtension({ oldLedger: second, policy,
    requestAllowance: allowance, authorizationId: 'nht-parent100',
    newLimitMicroUsd: 100_000_000, newRequestCap: 3,
    expectedCheckpoint: { requestCount: 2, reservedMicroUsd: 30 } });
  const third = { ...second, limitMicroUsd: 100_000_000, requestCap: 3 };
  settle(third, 19);
  const parent200 = authorizeChainedBenchmarkBudgetExtension({ oldLedger: third, policy,
    parentBudgetExtension: parent100, authorizationId: 'nht-parent200',
    newLimitMicroUsd: 200_000_000, newRequestCap: 4,
    expectedCheckpoint: { requestCount: 3, reservedMicroUsd: 49 } });
  const fourth = { ...third, limitMicroUsd: 200_000_000, requestCap: 4 };
  settle(fourth, 23);
  const inspection = inspectExperimentBudgetForEmbeddingUpgrade(fourth);
  upgradeExperimentBudgetForEmbeddings({ ...fourth,
    expectedCheckpoint: { requestCount: 4, reservedMicroUsd: 72 },
    expectedHistorySha256: inspection.historySha256 });
  const beforeV2 = inspectEmbeddingExperimentBudgetSnapshot(fourth);
  const parentV2 = authorizeChainedBenchmarkRequestCapV2({ oldLedger: fourth, policy,
    parentBudgetExtension: parent200, authorizationId: 'nht-parent-v2', newRequestCap: 80,
    expectedCheckpoint: { requestCount: 4, reservedMicroUsd: 72 },
    expectedOldHistorySha256: beforeV2.historySha256 });
  const oldLedger = { ...fourth, requestCap: 80 };
  settle(oldLedger, 29, true);
  const beforeV3 = inspectEmbeddingExperimentBudgetSnapshot(oldLedger);
  const requestCap = 100 * generationBatchCount;
  const ledger = { ...oldLedger, limitMicroUsd: 300_000_000, requestCap };
  const benchmarkExtension = authorizeChainedBenchmarkBudgetV3({ oldLedger, policy,
    parentBudgetExtension: parentV2, authorizationId: 'nht-budget300',
    newLimitMicroUsd: 300_000_000, newRequestCap: requestCap,
    expectedCheckpoint: { requestCount: 5, reservedMicroUsd: 101 },
    expectedOldHistorySha256: beforeV3.historySha256 });
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(ledger);
  const questionId = `lme-case-${'c'.repeat(64)}`;
  const scopeId = name => `lme-case-${createHash('sha256').update(JSON.stringify([
    'cairn.lme.mixed-source-pair.scope.v1', [questionId, name]])).digest('hex')}`;
  const caps = (requests, reservedMicroUsd) => ({ requests, reservedMicroUsd });
  const capability = authorizeMixedSourcePairCapability({ ledger, policy, benchmarkExtension,
    authorizationId: 'nht-authorization', executionId: 'nht-execution',
    checkpoint: { requestCount: snapshot.requestCount, reservedMicroUsd: snapshot.reservedMicroUsd,
      historySha256: snapshot.historySha256 },
    manifest: { sourceProtocolSha256: '1'.repeat(64), contextProtocolSha256: '2'.repeat(64),
      answerProtocolSha256: '3'.repeat(64), scorerProtocolSha256: '4'.repeat(64),
      cairn: { runtimeArtifactSha256: '5'.repeat(64), adapterConfigurationSha256: '6'.repeat(64),
        qualificationInputProfile: 'adaptive-text-catalog-v1', captureSourcePolicy: 'indexed-windows-v1' },
      mem0: { version: '2.2.0', sourceTreeSha256: artifact.sourceTreeSha256,
        dependencyLockSha256: artifact.dependencyLockSha256,
        configurationSha256: configuration.configurationSha256,
        wireProfile: structuredClone(mem0WireProfile()) } },
    roster: [{ questionId, protocolDigest: 'd'.repeat(64), armOrder: ['mem0', 'cairn'],
      arms: ['cairn', 'mem0'].map(name => ({ name, scopeId: scopeId(name) })) }],
    limits: { phaseCaps: { generation: caps(55 * generationBatchCount,
      1_000_000 * generationBatchCount), scoring: caps(20, 100_000) },
      caseCaps: { cairn: { generation: caps(20, 200_000), scoring: caps(5, 20_000) },
        mem0: { generation: caps(55 * generationBatchCount,
          800_000 * generationBatchCount), scoring: caps(5, 20_000) } },
      mem0TimeoutMs: configuration.configuration.httpTimeoutMs } });
  const guard = createMixedSourcePairExperimentRequestGuard({ ledger, policy, benchmarkExtension,
    mixedSourcePairCapability: capability, fetchImpl });
  workspace.defer(() => guard.close());
  return { workspace, guard, capability, snapshot, benchmarkExtension };
}

// Test-only negative control reproduces the prior persistent-socket behavior.
// Production close responses are always exercised without a positive shim.
export function keepAliveReplyProbe(t, socketPath) {
  let applied = 0;
  const original = http.ServerResponse.prototype.writeHead;
  const mocked = t.mock.method(http.ServerResponse.prototype, 'writeHead', function(status, headers) {
    const ownedSocket = socketPath();
    if (typeof ownedSocket === 'string' && ownedSocket.length > 0
      && this.socket?.server?.address() === ownedSocket) {
      assert.equal(status, 200);
      assert.equal(headers['content-type'], 'application/json');
      assert.ok(Number.isSafeInteger(headers['content-length']));
      applied += 1;
      const persistentHeaders = { ...headers };
      delete persistentHeaders.connection;
      return original.call(this, status, persistentHeaders);
    }
    return original.apply(this, arguments);
  });
  return { applied: () => applied, restore: () => mocked.mock.restore() };
}
