import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { buildArtifact, command, packageName, runtimeFiles } from '../build.mjs';
import { qualificationPoolWire } from '../../adapters/openai/test/qualification-pool-wire.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../../evaluation/experiment-budget/index.mjs';
import { authorizeAdaptiveQualifiedSourcePairCapability, authorizeBenchmarkBudgetExtension,
  authorizeBenchmarkExtension, authorizeBenchmarkRequestAllowance,
  createAdaptiveQualifiedSourcePairExperimentRequestGuard, createExperimentRequestGuard,
  deriveAdaptiveQualifiedSourcePairExperimentDigest } from '../../evaluation/experiment-budget/request-guard.mjs';
import { experimentPolicy } from '../../evaluation/live/session.mjs';
import { benchmarkStagePolicy } from '../../evaluation/live/public-pilot.mjs';

const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const questionId = `lme-case-${'a'.repeat(64)}`;
const names = ['qualified-prefix', 'indexed-windows'];
const roster = [{ questionId, protocolDigest: 'b'.repeat(64), armOrder: names,
  arms: names.map((name) => ({ name, scopeId: `lme-case-${hash(JSON.stringify([
    'cairn.lme.source-pair.scope.v1', [questionId, name]]))}` })) }];
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const source = Array.from({ length: 13 }, (_, index) => hash(`installed-shared-${index}`)).join('').slice(0, 800);

test('G6 installed archive retains F sources and qualifies exact anchors through G', async (t) => {
  const artifact = buildArtifact();
  const installRoot = mkdtempSync(join(tmpdir(), 'cairn-adaptive-install-'));
  t.after(() => { rmSync(installRoot, { recursive: true, force: true });
    rmSync(dirname(artifact.artifactPath), { recursive: true, force: true }); });
  writeFileSync(join(installRoot, 'package.json'), JSON.stringify({ name: 'synthetic-install',
    version: '0.0.0', private: true }), { flag: 'wx' });
  command('npm', ['install', '--prefix', installRoot, '--offline', '--ignore-scripts', '--no-audit',
    '--no-fund', artifact.artifactPath], installRoot, artifact.userconfig);
  const installed = join(installRoot, 'node_modules', packageName);
  const checkout = fileURLToPath(new URL('../../', import.meta.url));
  assert.equal(hash(readFileSync(artifact.artifactPath)), artifact.sha256);
  for (const name of runtimeFiles) {
    assert.equal(artifact.files.includes(name), true, name);
    assert.equal(artifact.sourceHashes[name], hash(readFileSync(join(checkout, name))), name);
    assert.equal(hash(readFileSync(join(installed, name))), artifact.sourceHashes[name], name);
  }
  const { createOpenAIModel } = await import(pathToFileURL(join(installed, 'adapters/openai/index.mjs')));
  const { createQualificationCandidateSnapshot, qualifyCandidateItems } = await import(pathToFileURL(join(installed,
    'core/qualification-candidates.mjs')));
  const root = mkdtempSync(join(tmpdir(), 'cairn-adaptive-installed-ledger-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const first = { directory: join(root, 'ledger'), runId: randomUUID(),
    limitMicroUsd: 50_000_000, requestCap: 5 };
  createExperimentBudget(first).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger: first, policy,
    fetchImpl: () => assert.fail('setup transport') }).close();
  const original = authorizeBenchmarkExtension({ ledger: first, policy,
    authorizationId: 'benchmark', stages: benchmarkStagePolicy() });
  const allowance = authorizeBenchmarkRequestAllowance({ oldLedger: first, policy,
    benchmarkExtension: original, authorizationId: 'allowance', newRequestCap: 20,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const second = { ...first, requestCap: 20 };
  const parent = authorizeBenchmarkBudgetExtension({ oldLedger: second, policy,
    requestAllowance: allowance, authorizationId: 'parent', newLimitMicroUsd: 100_000_000,
    newRequestCap: 40, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 } });
  const ledger = { ...second, limitMicroUsd: 100_000_000, requestCap: 40 };
  const adaptiveContext = { qualificationInputProfile: 'adaptive-text-catalog-v1',
    runtimeArtifactSha256: artifact.sha256,
    adapterConfigurationSha256: hash(JSON.stringify({ model: policy.cairnGeneration.model,
      qualificationInputMode: 'adaptive-text-catalog-v1' })) };
  adaptiveContext.experimentDigest = deriveAdaptiveQualifiedSourcePairExperimentDigest({
    ...adaptiveContext, roster });
  const capability = authorizeAdaptiveQualifiedSourcePairCapability({ ledger, policy,
    benchmarkExtension: parent, authorizationId: 'installed-adaptive', executionId: 'installed-adaptive',
    checkpoint: { requestCount: 0, reservedMicroUsd: 0 }, roster, adaptiveContext });
  const inlineInputs = [{ content: 'Synthetic installed inline claim', kind: 'fact', confidence: 0.8,
    receipts: [{ client: 'synthetic', sessionId: 'installed', eventId: 'inline-event',
      role: 'assistant', excerpt: 'short installed source' }] }];
  const catalogInputs = Array.from({ length: 5 }, (_, index) => ({ content: `Synthetic installed claim ${index}`,
    kind: 'fact', confidence: 0.8, receipts: Array.from({ length: 4 }, (_, receipt) => ({
      client: 'synthetic', sessionId: 'installed', eventId: `event-${index}-${receipt}`,
      role: receipt % 2 ? 'assistant' : 'user', excerpt: source })) }));
  const snapshots = [inlineInputs, catalogInputs].map(createQualificationCandidateSnapshot);
  const unknown = { value: 'unknown', evidenceIndices: [] };
  const empty = { value: null, evidenceIndices: [] };
  const outputs = snapshots.map((snapshot) => qualificationPoolWire(snapshot.input,
    { qualifications: snapshot.input.items.map((item) => ({
    itemIndex: item.itemIndex, ...Object.fromEntries(fields.map((field) => [field,
      field === 'subject' ? { value: null, evidenceIndices: [item.candidates[0].candidateIndex] }
        : ['attribution', 'commitment'].includes(field) ? unknown : empty])) })) }));
  const sends = [];
  const guard = createAdaptiveQualifiedSourcePairExperimentRequestGuard({ ledger, policy,
    benchmarkExtension: parent, adaptiveQualifiedSourcePairCapability: capability,
    fetchImpl(url, options) {
      sends.push({ url, body: JSON.parse(options.body) });
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
      const body = JSON.parse(options.body);
      return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(outputs[Math.floor((sends.length - 1) / 2)]) }] }],
        usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
    } });
  t.after(() => guard.close());
  const model = createOpenAIModel({ apiKey: 'synthetic', qualificationInputMode: 'adaptive-text-catalog-v1',
    fetchImpl: guard.cairnFetch });
  const results = [];
  for (const [index, input] of [inlineInputs, catalogInputs].entries()) {
    await guard.withCaseScope(capability.schedule[index], async () => {
      results.push(await qualifyCandidateItems(model, input));
    });
  }
  assert.equal(sends.length, 4);
  assert.equal(JSON.parse(sends[0].body.input[0].content[0].text).inputMode, undefined);
  assert.equal(JSON.parse(sends[2].body.input[0].content[0].text).inputMode, 'text-catalog-v1');
  for (const [setIndex, result] of results.entries()) {
    const snapshot = snapshots[setIndex];
    assert.equal(result.length, setIndex === 0 ? 1 : 5);
    for (const [index, item] of result.entries()) {
      const anchor = item.qualification.anchors[0];
      assert.equal(anchor.text, snapshot.candidates[index][0].text);
      assert.equal(anchor.start, 0);
      assert.equal(anchor.end, snapshot.candidates[index][0].end);
      assert.equal(item.receipts[anchor.receiptIndex].eventId,
        setIndex === 0 ? 'inline-event' : `event-${index}-0`);
      assert.equal(item.receipts[anchor.receiptIndex].role,
        setIndex === 0 ? 'assistant' : 'user');
    }
  }
  const observer = reopenExperimentBudget(ledger);
  try {
    const state = observer.getState();
    assert.equal(state.requestCount, 4);
    assert.equal(state.reservedMicroUsd, 20_000);
    assert.ok(state.attempts.every((attempt) => attempt.outcome === 'succeeded'));
  } finally { observer.close(); }
  assert.equal(existsSync(join(installed, 'core/qualification-text-catalog.mjs')), true);
});
