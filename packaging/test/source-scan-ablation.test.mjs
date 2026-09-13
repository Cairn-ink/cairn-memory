import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';
import { createExperimentBudget } from '../../evaluation/experiment-budget/index.mjs';
import { createExperimentRequestGuard } from '../../evaluation/experiment-budget/request-guard.mjs';
import { experimentPolicy } from '../../evaluation/live/session.mjs';
import { getSourceScanPins, runSourceScanAblation } from '../../evaluation/live/source-scan-ablation.mjs';

const sdk = createRequire(new URL('../../adapters/mcp/package.json', import.meta.url));
const { Client } = await import(pathToFileURL(sdk.resolve('@modelcontextprotocol/client')).href);

let installed;
function artifact() {
  if (installed) return installed;
  const archive = buildArtifact(), root = mkdtempSync(join(tmpdir(), 'cairn-source-scan-install-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-scan', private: true, version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive.artifactPath], root, archive.userconfig);
  return installed = { cairnExecutable: join(root, 'node_modules', packageName, 'bin/cairn-memory.mjs'),
    cairnArtifact: archive.artifactPath, cairnArtifactSha256: archive.sha256 };
}
function setup(mode = 'success') {
  const root = mkdtempSync(join(tmpdir(), 'cairn-source-scan-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50000000, requestCap: 5000 };
  createExperimentBudget(ledger).close();
  createExperimentRequestGuard({ ledger, policy: experimentPolicy(), fetchImpl: () => assert.fail('no setup HTTP') }).close();
  const directory = join(root, 'evidence'); mkdirSync(directory, { mode: 0o700 });
  let calls = 0;
  const fetchImpl = async (url, options) => {
    calls++;
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-source-scan-key');
    if (mode === 'transport') throw new Error('synthetic-source-scan-key');
    const payload = JSON.parse(options.body), input = JSON.parse(payload.input[0].content[0].text);
    assert.equal(/requiredSources|irrelevantSources|retainedRequired|"evaluation"/.test(JSON.stringify(input)), false);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    // Deliberately relevance-blind: returning every source proves mechanics only.
    const output = mode === 'invalid' && calls === 2 ? { refs: 'bad' }
      : { refs: payload.text.format.name === 'cairn_select'
        ? input.maps.flatMap(map => map.items.map(item => ({ namespaceIndex: map.namespaceIndex,
          ...(item.type === 'unfiled' ? item.ref : { memoryId: item.ref.childId, revision: item.ref.childRevision }) })))
        : input.candidates.map(item => ({ namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) };
    return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  };
  return { root, calls: () => calls, options: { ledger, apiKey: 'synthetic-source-scan-key', fetchImpl,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, nodePath: realpathSync(process.execPath),
    ...artifact(), privateDirectory: directory, pins: getSourceScanPins() } };
}

test('installed source-scan ablation retains all sixteen arms and wrong-source evidence, with immutable repeat denial', { timeout: 90000 }, async t => {
  const original = Client.prototype.callTool; let toolCalls = 0;
  Client.prototype.callTool = function (...args) {
    toolCalls++; assert.equal(args.length, 2);
    assert.deepEqual(args[1], { timeout: 180000 });
    return original.apply(this, args);
  };
  t.after(() => { Client.prototype.callTool = original; });
  const f = setup(), report = await runSourceScanAblation(f.options);
  assert.equal(report.status, 'completed', JSON.stringify(report)); assert.equal(report.cases.length, 16);
  assert.equal(report.ingestion, 'manual-oracle'); assert.equal(report.semanticReviewRequired, true);
  assert.equal(f.calls(), 48); assert.equal(report.budgetAfter.requestCount, 48);
  assert.equal(toolCalls, 16);
  assert.equal(report.attempt.reservedMicroUsd, 240000); assert.equal(report.budgetAfter.unsettled, 0);
  for (const record of report.cases) {
    assert.equal(record.traces.length, record.arm === 'baseline' ? 4 : 2);
    assert.equal(record.records.length, record.returnedSourceIndices.length);
    assert.equal(record.recall.value.selection?.strategy, record.arm === 'baseline' ? undefined : 'complete-map');
  }
  assert.equal(report.cases.find(c => c.caseId === 'absent-choice').sourceCoverage.retainedIrrelevant, 2);
  assert.equal(JSON.stringify(report).includes('synthetic-source-scan-key'), false);
  const intent = join(f.options.ledger.directory, 'source-scan-ablation-v1-intent.json'), bytes = readFileSync(intent);
  const next = join(f.root, 'next-empty'); mkdirSync(next, { mode: 0o700 });
  await assert.rejects(runSourceScanAblation({ ...f.options, privateDirectory: next,
    expectedCheckpoint: { requestCount: 48, reservedMicroUsd: 240000 } }));
  assert.equal(f.calls(), 48); assert.deepEqual(readFileSync(intent), bytes);
});

test('installed source-scan transport failure retains all slots, one unknown reservation and no retry', { timeout: 30000 }, async () => {
  const f = setup('transport'), report = await runSourceScanAblation(f.options);
  assert.equal(report.status, 'incomplete'); assert.equal(report.cases.length, 16);
  assert.equal(report.cases.filter(c => c.status === 'not_run').length, 15);
  assert.equal(f.calls(), 1); assert.equal(report.budgetAfter.reservedMicroUsd, 5000);
  assert.equal(report.budgetAfter.unknownCostRequests, 1); assert.equal(report.budgetAfter.unsettled, 0);
  assert.equal(JSON.stringify(report).includes('synthetic-source-scan-key'), false);
});

test('installed source-scan malformed output is kept once; pin/checkpoint/empty-key failures send nothing', { timeout: 90000 }, async () => {
  const f = setup('invalid');
  for (const patch of [{ pins: {} }, { expectedCheckpoint: { requestCount: 1, reservedMicroUsd: 5000 } }, { apiKey: '' }]) {
    const directory = join(f.root, `preflight-${randomUUID()}`); mkdirSync(directory, { mode: 0o700 });
    await assert.rejects(runSourceScanAblation({ ...f.options, privateDirectory: directory, ...patch }));
    assert.equal(f.calls(), 0);
  }
  const report = await runSourceScanAblation(f.options);
  assert.equal(report.status, 'incomplete'); assert.equal(report.cases[0].status, 'recall_failed');
  assert.equal(report.cases[0].traces.length, 2); assert.equal(report.cases.length, 16);
  assert.equal(f.calls(), 46);
});
