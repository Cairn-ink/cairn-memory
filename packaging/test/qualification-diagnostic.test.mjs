import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { before } from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';
import { createExperimentBudget, reopenExperimentBudget } from '../../evaluation/experiment-budget/index.mjs';
import { createExperimentRequestGuard, authorizeQualificationExtension } from '../../evaluation/experiment-budget/request-guard.mjs';
import { experimentPolicy } from '../../evaluation/live/session.mjs';
import { getQualificationDiagnosticPins, runQualificationDiagnostic } from '../../evaluation/live/qualification-diagnostic.mjs';

// Actual installed MCP and adapter through guarded proxy, synthetic ledger and
// fake upstream only. These outcomes do not measure semantic quality.
let artifact; let executable;
const hash = (filename) => createHash('sha256').update(readFileSync(filename)).digest('hex');
const source = 'For my personal reading notes, use short numbered lists.';
before(() => {
  artifact = buildArtifact(); const directory = mkdtempSync(join(tmpdir(), 'cairn-diagnostic-install-'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'synthetic-diagnostic-install', private: true, version: '0.0.0' }), { flag: 'wx' });
  command('npm', ['install', '--prefix', directory, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], directory, artifact.userconfig);
  executable = realpathSync(join(directory, 'node_modules', '.bin', 'cairn-memory'));
  assert.ok(executable.startsWith(join(directory, 'node_modules', packageName)));
});
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cairn-installed-diagnostic-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50000000, requestCap: 1000 };
  createExperimentBudget(ledger).close(); const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('No setup transport') }).close();
  const qualificationExtension = authorizeQualificationExtension({ ledger, policy, authorizationId: 'synthetic-diagnostic-capability' });
  const privateDirectory = join(root, 'evidence'); mkdirSync(privateDirectory, { mode: 0o700 });
  const apiKey = 'synthetic-diagnostic-parent-secret';
  return { root, ledger, privateDirectory, apiKey, options: { ledger, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 },
    qualificationExtension, apiKey, nodePath: realpathSync(process.execPath), cairnExecutable: executable,
    cairnArtifact: artifact.artifactPath, cairnArtifactSha256: hash(artifact.artifactPath), privateDirectory,
    pins: getQualificationDiagnosticPins() } };
}
function upstream(f, mode, calls) {
  return async (url, options) => {
    assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${f.apiKey}`);
    const payload = JSON.parse(options.body); calls.push({ url, method: payload.text.format.name });
    assert.ok(calls.length <= 6, 'No seventh request or retry');
    if (mode === 'transport') throw new Error('synthetic-private-transport-error');
    if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
    const input = JSON.parse(payload.input[0].content[0].text); let output;
    if (payload.text.format.name === 'cairn_extract') {
      assert.deepEqual(input, { messages: [{ index: 0, role: 'user', content: source }] });
      output = { items: [{ content: source, kind: 'preference', confidence: 0.9, sourceIndices: [0] }] };
    } else if (payload.text.format.name === 'cairn_qualify') {
      assert.deepEqual(input.items[0].sources, [{ receiptIndex: 0, role: 'user', excerpt: source }]);
      output = { qualifications: [{ itemIndex: 0, qualification: { version: 1,
        slot: { subject: null, property: null, scope: null, applies: null }, value: null,
        attribution: 'unknown', commitment: 'unknown', anchors: [{ receiptIndex: 0, start: 0,
          end: source.length, text: mode === 'anchor' ? 'Invented evidence' : source, fields: ['value'] }] } }] };
    } else {
      assert.equal(payload.text.format.name, 'cairn_classify');
      output = { items: input.memories.map((memory) => ({ memoryId: memory.id, parentIds: [] })) };
    }
    const response = { object: 'response', model: payload.model, status: 'completed', error: null,
      incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
        content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
      usage: { input_tokens: 120, output_tokens: 100, total_tokens: 220 } };
    if (payload.text.format.name === 'cairn_qualify') {
      if (mode === 'envelope') response.status = 'incomplete';
      if (mode === 'usage-overflow') response.usage = { input_tokens: 7025, output_tokens: 100, total_tokens: 7125 };
      if (mode === 'bounded-drift') response.usage = { input_tokens: 119, output_tokens: 100, total_tokens: 219 };
      if (mode === 'token-bounds') response.output[0].content[0].text = JSON.stringify({ payload: ' word'.repeat(1800) });
      if (mode === 'json') response.output[0].content[0].text = '{malformed-json';
    }
    return Response.json(response);
  };
}
function privateFiles(directory, key) {
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  for (const name of readdirSync(directory)) {
    const filename = join(directory, name); const stat = statSync(filename);
    if (stat.isDirectory()) { privateFiles(filename, key); continue; }
    assert.equal(stat.mode & 0o777, 0o600, filename);
    const bytes = readFileSync(filename);
    assert.equal(bytes.includes(Buffer.from(key)), false, filename);
    assert.equal(bytes.includes(Buffer.from('synthetic-private-transport-error')), false, filename);
  }
}

for (const [mode, reason, layer] of [['success', null, null], ['bounded-drift', null, null], ['envelope', 'response_envelope', 'adapter'],
  ['usage-overflow', 'transport_failure', 'adapter'], ['token-bounds', 'output_bounds', 'adapter'],
  ['json', 'output_json', 'adapter'], ['anchor', 'invalid_qualification', 'core_validation'], ['transport', 'transport_failure', 'adapter']]) {
  test(`installed diagnostic preserves ${mode} and exact actual collector layer without retry`, { timeout: 120000 }, async () => {
    const f = fixture(); const calls = [];
    const capabilityPath = join(f.ledger.directory, 'experiment-qualification-extension.json');
    const capability = readFileSync(capabilityPath);
    const report = await runQualificationDiagnostic({ ...f.options, fetchImpl: upstream(f, mode, calls) });
    const succeeds = mode === 'success' || mode === 'bounded-drift';
    const halted = mode === 'transport' || mode === 'usage-overflow';
    const expected = succeeds ? 6 : mode === 'transport' ? 1 : 4;
    assert.equal(calls.length, expected, JSON.stringify(report));
    assert.equal(report.status, succeeds ? 'completed' : halted ? 'halted' : 'failed', JSON.stringify(report));
    assert.equal(report.budgetBefore.requestCount, 0); assert.equal(report.budgetAfter.requestCount, expected);
    assert.equal(report.budgetAfter.reservedMicroUsd, expected * 5000);
    assert.equal(report.budgetAfter.unknownCostRequests, mode === 'transport' ? 1 : expected / 2);
    if (mode === 'transport') assert.equal(report.budgetAfter.knownUsageMicroUsd, 0);
    else assert.ok(report.budgetAfter.knownUsageMicroUsd > 0);
    assert.equal(report.attempt.requests, expected); assert.equal(report.attempt.reservedMicroUsd, expected * 5000);
    // The unchanged request guard rejects observed overflow before the adapter
    // can inspect its body. Do not mislabel this as adapter response_usage.
    if (mode === 'usage-overflow') assert.equal(report.attempt.halted, 'guard_pin_or_persistence_failed');
    assert.deepEqual(readFileSync(capabilityPath), capability, 'Diagnostic must not reauthorize or rewrite capability');
    assert.equal(report.capture.ok, succeeds);
    if (succeeds) {
      assert.equal(report.inspections.length, 1);
      const record = report.inspections[0].value;
      assert.equal(record.qualification.anchors[0].text, source); assert.equal(record.memory.state, 'active');
      assert.equal(record.receipts[0].excerpt, source);
      assert.deepEqual(report.diagnostics.events, []);
    } else {
      assert.equal(report.inspections.length, 0);
      assert.ok(report.diagnostics.events.some((event) => event.stage === (mode === 'transport' ? 'extract' : 'qualify')
        && event.layer === layer && event.reason === reason), JSON.stringify(report.diagnostics));
      assert.ok(!report.diagnostics.events.some((event) => event.reason === (mode === 'anchor' ? 'output_json' : 'invalid_qualification')));
    }
    assert.equal(report.diagnostics.collection.corrupted, false);
    assert.equal(report.diagnostics.collection.writeFailed, false);
    assert.equal(report.diagnostics.collection.deliveryGuaranteed, false);
    assert.equal(report.traces.length, expected);
    assert.deepEqual(report.traces.map((trace) => trace.method), calls.map((call) => call.method));
    assert.equal(JSON.stringify(report).includes(f.apiKey), false);
    for (const trace of report.traces) {
      assert.equal(Object.hasOwn(trace, 'headers'), false);
      assert.equal(Object.hasOwn(trace, 'requestHeaders'), false);
      assert.ok(Buffer.byteLength(JSON.stringify(trace.requestBody)) <= 131072);
      assert.equal(trace.responseAvailable, mode !== 'transport' && !(mode === 'usage-overflow' && trace.sequence === 4));
      if (trace.responseAvailable) assert.ok(Buffer.byteLength(JSON.stringify(trace.providerResponse)) <= 262144);
      else assert.equal(trace.providerResponse, null);
    }
    privateFiles(f.privateDirectory, f.apiKey);
    const intent = join(f.ledger.directory, 'qualification-diagnostic-v1-intent.json'); const original = readFileSync(intent);
    const another = join(f.root, 'retry-evidence'); mkdirSync(another, { mode: 0o700 });
    const checkpoint = { requestCount: expected, reservedMicroUsd: expected * 5000 };
    const repeated = await runQualificationDiagnostic({ ...f.options, privateDirectory: another, expectedCheckpoint: checkpoint,
      fetchImpl: () => assert.fail('A different evidence directory cannot rerun diagnostic') });
    assert.equal(repeated.status, 'halted'); assert.deepEqual(readFileSync(intent), original);
    const ledger = reopenExperimentBudget(f.ledger); try { assert.equal(ledger.getState().requestCount, expected); } finally { ledger.close(); }
  });
}

test('installed diagnostic preserves partial global intent and rejects missing key or changed pins before HTTP', { timeout: 120000 }, async () => {
  const f = fixture(); const fetchImpl = () => assert.fail('No preflight HTTP');
  for (const apiKey of ['', undefined, 'bad key']) await assert.rejects(runQualificationDiagnostic({ ...f.options, apiKey, fetchImpl }));
  const pins = { ...f.options.pins }; pins[Object.keys(pins)[0]] = 'a'.repeat(64);
  await assert.rejects(runQualificationDiagnostic({ ...f.options, pins, fetchImpl }));
  const intent = join(f.ledger.directory, 'qualification-diagnostic-v1-intent.json');
  writeFileSync(intent, '{partial', { mode: 0o600 });
  const report = await runQualificationDiagnostic({ ...f.options, fetchImpl });
  assert.equal(report.status, 'halted'); assert.equal(readFileSync(intent, 'utf8'), '{partial');
  assert.equal(report.budgetAfter.requestCount, 0);
});
