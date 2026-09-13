import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test, { before } from 'node:test';
import { buildArtifact, command, packageName } from '../build.mjs';
import { createExperimentBudget } from '../../evaluation/experiment-budget/index.mjs';
import { createExperimentRequestGuard, authorizeCandidateQualificationExtension } from '../../evaluation/experiment-budget/request-guard.mjs';
import { experimentPolicy } from '../../evaluation/live/session.mjs';
import { getSourceSupportPilotPins, runSourceSupportPilot } from '../../evaluation/live/source-support-pilot.mjs';

let artifact, executable;
before(() => {
  artifact = buildArtifact(); const directory = mkdtempSync(join(tmpdir(), 'cairn-source-support-install-'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'synthetic-source-support', version: '0.0.0', private: true }), { flag: 'wx' });
  command('npm', ['install', '--prefix', directory, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], directory, artifact.userconfig);
  executable = realpathSync(join(directory, 'node_modules', packageName, 'bin/cairn-memory.mjs'));
});
const hash = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');
function fixture(provision = true) {
  const root = mkdtempSync(join(tmpdir(), 'cairn-source-support-installed-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50000000, requestCap: 1000 };
  createExperimentBudget(ledger).close(); const policy = experimentPolicy();
  createExperimentRequestGuard({ ledger, policy, fetchImpl: () => assert.fail('No setup transport') }).close();
  const candidateQualificationExtension = provision ? authorizeCandidateQualificationExtension({ ledger, policy, authorizationId: 'candidate-qualification-heldout-v1' }) : undefined;
  const privateDirectory = join(root, 'evidence'); mkdirSync(privateDirectory, { mode: 0o700 });
  const apiKey = 'synthetic-source-support-parent-key';
  return { root, ledger, apiKey, privateDirectory, options: { ledger, candidateQualificationExtension,
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, apiKey, nodePath: realpathSync(process.execPath),
    cairnExecutable: executable, cairnArtifact: artifact.artifactPath, cairnArtifactSha256: hash(artifact.artifactPath),
    privateDirectory, pins: getSourceSupportPilotPins() } };
}
function verifyPrivate(directory, key) {
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  for (const name of readdirSync(directory)) {
    const filename = join(directory, name); const stat = statSync(filename);
    if (stat.isDirectory()) { verifyPrivate(filename, key); continue; }
    assert.equal(stat.mode & 0o777, 0o600); assert.equal(readFileSync(filename).includes(Buffer.from(key)), false);
  }
}
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
for (const mode of ['success', 'capture-invalid', 'recall-invalid', 'transport']) {
  test(`actual installed source-support pilot keeps all eight denominator slots: ${mode}`, { timeout: 240000 }, async () => {
    const f = fixture(); let sends = 0, qualifications = 0, ranks = 0;
    const capabilityFile = join(f.ledger.directory, 'experiment-candidate-qualification-extension.json'); const capability = readFileSync(capabilityFile);
    const report = await runSourceSupportPilot({ ...f.options, fetchImpl: async (url, options) => {
      sends++; assert.ok(sends <= 96); assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${f.apiKey}`);
      if (mode === 'transport') return new Response('synthetic unavailable', { status: 503 });
      const payload = JSON.parse(options.body); const input = JSON.parse(payload.input[0].content[0].text);
      assert.ok(!JSON.stringify(input).includes('necessary_messages')); assert.ok(!Object.hasOwn(input, 'criteria')); assert.ok(!Object.hasOwn(input, 'expected'));
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
      let output;
      if (payload.text.format.name === 'cairn_extract') {
        assert.deepEqual(Object.keys(input), ['messages']);
        output = { items: [{ content: input.messages[0].content.slice(0, 600), kind: 'context', confidence: 0.8, sourceIndices: [0] }] };
      } else if (payload.text.format.name === 'cairn_qualifyCandidates') {
        qualifications++; output = { qualifications: input.items.map(item => ({ itemIndex: item.itemIndex,
          ...Object.fromEntries(fields.map(field => [field, { value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
            evidenceIndices: field === 'value' ? [mode === 'capture-invalid' && qualifications === 1 ? 99999 : item.candidates[0].candidateIndex] : [] }])) })) };
      } else if (payload.text.format.name === 'cairn_classify') {
        output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
      } else if (payload.text.format.name === 'cairn_select') {
        output = { refs: input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')
          .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) };
      } else {
        assert.equal(payload.text.format.name, 'cairn_rank'); ranks++;
        assert.ok(input.candidates.every(item => item.qualification?.anchors?.length));
        output = mode === 'recall-invalid' && ranks === 1 ? { refs: [{ namespaceIndex: 0, memoryId: 'absent-memory', revision: 1 }] }
          : { refs: input.candidates.slice(0, input.limit).map(item => ({ namespaceIndex: item.namespaceIndex, memoryId: item.memory.id, revision: item.memory.revision })) };
      }
      return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null, incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 120, output_tokens: 100, total_tokens: 220 } });
    } });
    const expected = mode === 'transport' ? 1 : mode === 'capture-invalid' ? 74 : 80;
    assert.equal(sends, expected, JSON.stringify(report)); assert.equal(report.cases.length, 8); assert.equal(report.semanticReviewRequired, true);
    if (mode === 'success') assert.equal(report.status, 'completed', JSON.stringify(report));
    if (mode === 'capture-invalid') { assert.equal(report.cases[0].captureStatus, 'failed'); assert.equal(report.cases[0].recallStatus, 'not_run'); }
    if (mode === 'recall-invalid') { assert.equal(report.cases[0].captureStatus, 'completed'); assert.equal(report.cases[0].recallStatus, 'failed'); }
    if (mode === 'transport') { assert.equal(report.status, 'halted'); assert.ok(report.cases.slice(1).every(item => item.status === 'not_run')); }
    else assert.ok(report.cases.slice(1).every(item => item.status === 'completed'));
    for (const record of report.cases) {
      for (const phase of ['capture', 'recall']) assert.ok(record.traces.filter(trace => trace.phase === phase).length <= 6);
      if (record.coldStatus === 'completed') {
        assert.deepEqual(record.warmRecords, record.coldRecords); assert.equal(record.replay.value.duplicate, true);
        assert.deepEqual(record.replay.value.retainedSourceWindow, record.capture.value.retainedSourceWindow);
      }
      if (record.recallStatus === 'completed') for (const recalled of record.recall.value.memories) {
        const original = record.warmRecords.find(item => item.value.memory.id === recalled.memory.id);
        assert.deepEqual(recalled.qualification, original.value.qualification);
      }
    }
    assert.equal(report.budgetAfter.requestCount, sends); assert.equal(report.budgetAfter.reservedMicroUsd, sends * 5000);
    assert.equal(report.budgetAfter.unsettled, 0); assert.deepEqual(readFileSync(capabilityFile), capability);
    assert.ok(!JSON.stringify(report).includes(f.apiKey)); verifyPrivate(f.privateDirectory, f.apiKey);
    const intent = join(f.ledger.directory, 'source-support-v1-intent.json'); const intentBefore = readFileSync(intent);
    const retryDirectory = join(f.root, 'retry'); mkdirSync(retryDirectory, { mode: 0o700 });
    const retry = await runSourceSupportPilot({ ...f.options, privateDirectory: retryDirectory,
      expectedCheckpoint: { requestCount: sends, reservedMicroUsd: sends * 5000 }, fetchImpl: () => assert.fail('No repeated intent HTTP') });
    assert.equal(retry.status, 'halted'); assert.ok(retry.cases.every(item => item.status === 'not_run')); assert.deepEqual(readFileSync(intent), intentBefore);
  });
}

test('installed source-support pilot preserves partial intent and refuses mismatched pins/capabilities without grants', async () => {
  const f = fixture(); const intent = join(f.ledger.directory, 'source-support-v1-intent.json');
  writeFileSync(intent, '{partial', { flag: 'wx', mode: 0o600 });
  const report = await runSourceSupportPilot({ ...f.options, fetchImpl: () => assert.fail('No partial intent HTTP') });
  assert.equal(report.status, 'halted'); assert.equal(report.budgetAfter.requestCount, 0); assert.equal(readFileSync(intent, 'utf8'), '{partial');
  const missing = fixture(false);
  for (const candidateQualificationExtension of [undefined, { authorizationId: 'wrong' }]) await assert.rejects(runSourceSupportPilot({ ...missing.options,
    candidateQualificationExtension, fetchImpl: () => assert.fail('No absent grant HTTP') }));
  assert.equal(existsSync(join(missing.ledger.directory, 'experiment-candidate-qualification-extension.json')), false);
  const altered = fixture(); const pins = structuredClone(altered.options.pins); pins[Object.keys(pins)[0]] = '0'.repeat(64);
  await assert.rejects(runSourceSupportPilot({ ...altered.options, pins, fetchImpl: () => assert.fail('No altered pins HTTP') }));
});
