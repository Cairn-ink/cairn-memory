// Fresh synthetic 50 -> 100 -> 200 -> v2 accounting chain for Y tests only.
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createExperimentBudget, inspectEmbeddingExperimentBudgetSnapshot,
  inspectExperimentBudgetForEmbeddingUpgrade, reopenExperimentBudget,
  upgradeExperimentBudgetForEmbeddings } from '../index.mjs';
import { authorizeBenchmarkBudgetExtension, authorizeBenchmarkExtension,
  authorizeBenchmarkRequestAllowance, authorizeChainedBenchmarkBudgetExtension,
  authorizeMixedSourcePairCapability, createExperimentRequestGuard,
  createMixedSourcePairExperimentRequestGuard } from '../request-guard.mjs';
import { mem0WireProfile } from '../mem0-wire.mjs';
import { benchmarkStagePolicy } from '../../live/public-pilot.mjs';
import { experimentPolicy } from '../../live/session.mjs';

const sha = value => createHash('sha256').update(value).digest('hex');
const questionId = `lme-case-${'c'.repeat(64)}`;
const scopeId = name => `lme-case-${sha(JSON.stringify([
  'cairn.lme.mixed-source-pair.scope.v1', [questionId, name]]))}`;
const roster = [{ questionId, protocolDigest: 'd'.repeat(64),
  armOrder: ['mem0', 'cairn'], arms: ['cairn', 'mem0'].map(name => ({ name, scopeId: scopeId(name) })) }];
const caps = (requests, reservedMicroUsd) => ({ requests, reservedMicroUsd });
const limits = httpTimeoutMs => ({ phaseCaps: { generation: caps(55, 1_000_000),
  scoring: caps(20, 100_000) }, caseCaps: {
  cairn: { generation: caps(20, 200_000), scoring: caps(5, 20_000) },
  mem0: { generation: caps(55, 800_000), scoring: caps(5, 20_000) },
}, mem0TimeoutMs: httpTimeoutMs });

function add(configuration, amount, outcome, actual) {
  const handle = reopenExperimentBudget(configuration);
  try {
    const attemptId = randomUUID();
    handle.reserve({ attemptId, channel: 'host-completion', reservedMicroUsd: amount });
    handle.recordOutcome(actual === undefined ? { attemptId, outcome }
      : { attemptId, outcome, actualMicroUsd: actual });
  } finally { handle.close(); }
}

export function nativeFixture(t, { artifact, configuration, httpTimeoutMs, fetchImpl }) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-y-fixture-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = { directory: join(root, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  createExperimentBudget(first).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: first, policy,
    fetchImpl: () => assert.fail('fixture setup cannot dispatch') }).close();
  const original = authorizeBenchmarkExtension({ ledger: first, policy,
    authorizationId: 'native-original', stages: benchmarkStagePolicy() });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: first, policy,
    benchmarkExtension: original, authorizationId: 'native-allowance', newRequestCap: 20,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const second = { ...first, requestCap: 20 };
  add(second, 13, 'unknown');
  add(second, 17, 'succeeded', 9);
  const parent = authorizeBenchmarkBudgetExtension({ oldLedger: second, policy,
    requestAllowance: allowance, authorizationId: 'native-parent100',
    newLimitMicroUsd: 100_000_000, newRequestCap: 40,
    expectedCheckpoint: { requestCount: 2, reservedMicroUsd: 30 } });
  const prior = { ...second, limitMicroUsd: 100_000_000, requestCap: 40 };
  add(prior, 19, 'failed');
  const ledger = { ...prior, limitMicroUsd: 200_000_000, requestCap: 80 };
  const benchmarkExtension = authorizeChainedBenchmarkBudgetExtension({ oldLedger: prior,
    policy, parentBudgetExtension: parent, authorizationId: 'native-parent200',
    newLimitMicroUsd: 200_000_000, newRequestCap: 80,
    expectedCheckpoint: { requestCount: 3, reservedMicroUsd: 49 } });
  add(ledger, 23, 'unknown');
  const before = inspectExperimentBudgetForEmbeddingUpgrade(ledger);
  upgradeExperimentBudgetForEmbeddings({ ...ledger,
    expectedCheckpoint: { requestCount: before.requestCount,
      reservedMicroUsd: before.reservedMicroUsd }, expectedHistorySha256: before.historySha256 });
  const snapshot = inspectEmbeddingExperimentBudgetSnapshot(ledger);
  const manifest = { sourceProtocolSha256: '1'.repeat(64),
    contextProtocolSha256: '2'.repeat(64), answerProtocolSha256: '3'.repeat(64),
    scorerProtocolSha256: '4'.repeat(64), cairn: { runtimeArtifactSha256: '5'.repeat(64),
      adapterConfigurationSha256: '6'.repeat(64), qualificationInputProfile: 'adaptive-text-catalog-v1',
      captureSourcePolicy: 'indexed-windows-v1' }, mem0: { version: '2.2.0',
      sourceTreeSha256: artifact.sourceTreeSha256,
      dependencyLockSha256: artifact.dependencyLockSha256,
      configurationSha256: configuration.configurationSha256,
      wireProfile: structuredClone(mem0WireProfile()) } };
  const capability = authorizeMixedSourcePairCapability({ ledger, policy, benchmarkExtension,
    authorizationId: 'native-authorization', executionId: 'native-execution',
    checkpoint: { requestCount: snapshot.requestCount,
      reservedMicroUsd: snapshot.reservedMicroUsd,
      historySha256: snapshot.historySha256 }, manifest, roster,
    limits: limits(httpTimeoutMs) });
  const guard = createMixedSourcePairExperimentRequestGuard({ ledger, policy,
    benchmarkExtension, mixedSourcePairCapability: capability, fetchImpl });
  return { root, ledger, guard, capability, snapshot };
}

export function nativeFakeProvider() {
  const requests = [];
  const fetchImpl = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ route: url.endsWith('/embeddings') ? 'embedding' : 'chat', body });
    if (url.endsWith('/embeddings')) {
      return Response.json({ object: 'list', model: 'text-embedding-3-small',
        usage: { prompt_tokens: 1, total_tokens: 1 },
        data: body.input.map((_, index) => ({ object: 'embedding', index,
          embedding: Array.from({ length: 1536 }, (_, dimension) => dimension === 0 ? 1 : 0) })) });
    }
    return Response.json({ object: 'chat.completion', model: 'gpt-4.1-mini-2025-04-14',
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant',
        content: JSON.stringify({ memory: [{ text: 'Synthetic memory fact.' }] }) } }] });
  };
  return { requests, fetchImpl };
}
