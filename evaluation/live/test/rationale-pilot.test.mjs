import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { buildArtifact, command, packageName } from '../../../packaging/build.mjs';
import { createExperimentBudget } from '../../experiment-budget/index.mjs';
import { createExperimentRequestGuard, authorizeRationaleExtension } from '../../experiment-budget/request-guard.mjs';
import { experimentPolicy } from '../session.mjs';
import { getRationalePilotPins, runRationalePilot } from '../rationale-pilot.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { qualificationPoolWire } from '../../../adapters/openai/test/qualification-pool-wire.mjs';

// Installed tests require explicit cache preparation; the ordinary suite keeps
// preflight coverage without downloading or installing a package implicitly.
const enabled = process.env.CAIRN_RATIONALE_INSTALLED_OFFLINE === '1';
let installed;
function artifact() {
  if (installed) return installed;
  const archive = buildArtifact(); const root = mkdtempSync(join(tmpdir(), 'cairn-rationale-pilot-install-'));
  writeFileSync(join(root, 'package.json'), JSON.stringify({ name: 'synthetic-pilot', private: true, version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', root, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', archive.artifactPath], root, archive.userconfig);
  installed = { cairnExecutable: join(root, 'node_modules', packageName, 'bin/cairn-memory.mjs'),
    cairnArtifact: archive.artifactPath, cairnArtifactSha256: archive.sha256 };
  return installed;
}
function setup(mode = 'success') {
  const root = mkdtempSync(join(tmpdir(), 'cairn-rationale-pilot-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50000000, requestCap: 1000 };
  createExperimentBudget(ledger).close();
  const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('No setup HTTP') }).close();
  const rationaleExtension = authorizeRationaleExtension({ ledger, policy, authorizationId: 'rationale-pilot-v1' });
  const directory = join(root, 'evidence'); mkdirSync(directory, { mode: 0o700 });
  let calls = 0;
  const mock = rationaleModel();
  mock.select = ({ input }) => ({ refs: input.maps.flatMap(map => map.items.map(item => ({ namespaceIndex: map.namespaceIndex,
    ...(item.type === 'unfiled' ? item.ref : { memoryId: item.ref.childId, revision: item.ref.childRevision }) }))) });
  // Deliberately semantic-blind self links; only transport/evidence mechanics.
  mock.relate = ({ input }) => ({ edges: input.memories.slice(0, 1).map(memory => ({ from: memory.index, to: memory.index,
    fromReceipt: memory.receipts[0].index, toReceipt: memory.receipts[0].index, relation: 'supports-decision' })) });
  const fetchImpl = async (url, options) => {
    calls++;
    if (mode === 'transport') throw new Error('synthetic-provider-key');
    const payload = JSON.parse(options.body);
    assert.equal(new Headers(options.headers).get('authorization'), 'Bearer synthetic-provider-key');
    const input = JSON.parse(payload.input[0].content[0].text);
    assert.equal(/"rubric"|"forbidden"|"expected"/.test(JSON.stringify(input)), false);
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    const method = payload.text.format.name.slice(6);
    let output = mode === 'invalid-output' && calls === 2 ? { items: 'invalid' } : await mock[method]({ input });
    if (method === 'qualifyCandidates') output = qualificationPoolWire(input, output);
    return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null, incomplete_details: null,
      output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 120, output_tokens: 80, total_tokens: 200 } });
  };
  return { root, calls: () => calls, options: { ledger, rationaleExtension, apiKey: 'synthetic-provider-key', fetchImpl,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, nodePath: realpathSync(process.execPath),
    ...artifact(), privateDirectory: directory, pins: getRationalePilotPins() } };
}

test('RP1 exact options and source pins fail without key discovery, model calls or writes', async () => {
  await assert.rejects(runRationalePilot());
  const directory = mkdtempSync(join(tmpdir(), 'cairn-rationale-preflight-'));
  const options = { ledger: {}, rationaleExtension: { authorizationId: 'rationale-pilot-v1' }, apiKey: 'synthetic',
    fetchImpl: () => assert.fail('No preflight HTTP'), expectedCheckpoint: {}, nodePath: 'node',
    cairnExecutable: 'missing', cairnArtifact: 'missing', cairnArtifactSha256: 'a'.repeat(64),
    privateDirectory: directory, pins: getRationalePilotPins() };
  for (const key of Object.keys(options)) { const bad = { ...options }; delete bad[key]; await assert.rejects(runRationalePilot(bad)); }
  for (const patch of [{ extra: true }, { apiKey: '' }, { pins: {} }, { nodePath: 'relative' },
    { rationaleExtension: { authorizationId: 'other' } }]) await assert.rejects(runRationalePilot({ ...options, ...patch }));
  assert.deepEqual(readdirSync(directory), []);
  assert.equal(options.pins['evaluation/live/rationale-fixture.json'], 'a7d3042027bf8dee46df16ef99bbe5be9a86beb622139a2795efe79fc0d73409');
});

test('RP2 installed sixteen-arm schedule retains evidence, cold replay, forgetting and immutable intent', { skip: !enabled, timeout: 180000 }, async () => {
  const f = setup(); const report = await runRationalePilot(f.options);
  assert.equal(report.status, 'completed', JSON.stringify(report));
  assert.equal(report.cases.length, 16); assert.equal(report.semanticReviewRequired, true);
  assert.equal(report.cases.filter(record => record.arm === 'candidate').length, 8);
  for (const record of report.cases) {
    assert.equal(record.captures.length, 2); assert.equal(record.coldStatus, 'completed'); assert.equal(record.replays.length, 2);
    assert.deepEqual(record.warmRecords, record.coldRecords); assert.deepEqual(record.warmGraphs, record.coldGraphs);
    assert.equal(record.forgotten.length, record.coldRecords.length);
  }
  assert.equal(report.budgetAfter.requestCount, f.calls()); assert.ok(f.calls() <= 288);
  assert.equal(report.attempt.reservedMicroUsd, f.calls() * 5000);
  assert.equal(report.budgetAfter.unsettled, 0);
  assert.equal(JSON.stringify(report).includes('synthetic-provider-key'), false);
  const intent = join(f.options.ledger.directory, 'rationale-pilot-v1-intent.json'), bytes = readFileSync(intent);
  const before = f.calls();
  await assert.rejects(runRationalePilot(f.options));
  const next = join(f.root, 'new-empty'); mkdirSync(next, { mode: 0o700 });
  const repeat = await runRationalePilot({ ...f.options, privateDirectory: next,
    expectedCheckpoint: { requestCount: report.budgetAfter.requestCount, reservedMicroUsd: report.budgetAfter.reservedMicroUsd } });
  assert.equal(repeat.status, 'halted'); assert.equal(f.calls(), before); assert.deepEqual(readFileSync(intent), bytes);
});

test('RP3 installed malformed model output is retained once, not retried or silently scored successful', { skip: !enabled, timeout: 180000 }, async () => {
  const f = setup('invalid-output'); const report = await runRationalePilot(f.options);
  assert.equal(report.status, 'completed_with_failures', JSON.stringify(report));
  assert.equal(report.cases.length, 16); assert.equal(report.cases[0].captures[0].ok, false);
  assert.equal(report.cases[0].status, 'completed_with_failures');
  assert.equal(report.cases[0].traces.filter(trace => trace.phase === 'capture-0').length, 2);
  assert.equal(report.cases[0].replays.length, 1);
});

test('RP4 installed transport failure halts all later arms and retains unknown reserved cost', { skip: !enabled, timeout: 30000 }, async () => {
  const f = setup('transport'); const report = await runRationalePilot(f.options);
  assert.equal(report.status, 'halted'); assert.equal(f.calls(), 1);
  assert.equal(report.cases.filter(record => record.status === 'not_run').length, 15);
  assert.equal(report.budgetAfter.reservedMicroUsd, 5000); assert.equal(report.budgetAfter.unknownCostRequests, 1);
  assert.equal(report.budgetAfter.unsettled, 0); assert.equal(JSON.stringify(report).includes('synthetic-provider-key'), false);
});
