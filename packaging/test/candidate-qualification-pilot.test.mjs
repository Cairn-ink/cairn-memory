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
import { getCandidateQualificationPilotPins, runCandidateQualificationPilot } from '../../evaluation/live/candidate-qualification-pilot.mjs';

let artifact, executable;
before(() => {
  artifact = buildArtifact();
  const directory = mkdtempSync(join(tmpdir(), 'cairn-candidate-pilot-install-'));
  writeFileSync(join(directory, 'package.json'), JSON.stringify({ name: 'synthetic-candidate-pilot', version: '0.0.0', private: true }), { flag: 'wx' });
  command('npm', ['install', '--prefix', directory, '--offline', '--ignore-scripts', '--no-audit', '--no-fund', artifact.artifactPath], directory, artifact.userconfig);
  executable = realpathSync(join(directory, 'node_modules', packageName, 'bin/cairn-memory.mjs'));
});
const hash = filename => createHash('sha256').update(readFileSync(filename)).digest('hex');
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'cairn-candidate-pilot-test-'));
  const ledger = { directory: join(root, 'ledger'), runId: randomUUID(), limitMicroUsd: 50000000, requestCap: 1000 };
  createExperimentBudget(ledger).close();
  createExperimentRequestGuard({ ledger, policy: experimentPolicy(), fetchImpl: () => assert.fail('No setup request') }).close();
  authorizeQualificationExtension({ ledger, policy: experimentPolicy(), authorizationId: 'synthetic-old-qualification' });
  const privateDirectory = join(root, 'evidence'); mkdirSync(privateDirectory, { mode: 0o700 });
  const apiKey = 'synthetic-candidate-parent-key';
  return { root, ledger, privateDirectory, apiKey, options: { ledger, expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 },
    apiKey, nodePath: realpathSync(process.execPath), cairnExecutable: executable,
    cairnArtifact: artifact.artifactPath, cairnArtifactSha256: hash(artifact.artifactPath),
    privateDirectory, pins: getCandidateQualificationPilotPins() } };
}
function verifyPrivate(directory, key) {
  assert.equal(statSync(directory).mode & 0o777, 0o700);
  for (const name of readdirSync(directory)) {
    const filename = join(directory, name), stat = statSync(filename);
    if (stat.isDirectory()) { verifyPrivate(filename, key); continue; }
    assert.equal(stat.mode & 0o777, 0o600);
    assert.equal(readFileSync(filename).includes(Buffer.from(key)), false);
  }
}
for (const mode of ['success', 'invalid-first', 'transport']) {
  test(`installed candidate pilot preserves all six cases: ${mode}`, { timeout: 180000 }, async () => {
    const f = fixture(); let sends = 0, qualifications = 0;
    const oldCapability = join(f.ledger.directory, 'experiment-qualification-extension.json');
    const oldBytes = readFileSync(oldCapability);
    const report = await runCandidateQualificationPilot({ ...f.options, fetchImpl: async (url, options) => {
      sends++; assert.ok(sends <= 36);
      assert.equal(new Headers(options.headers).get('authorization'), `Bearer ${f.apiKey}`);
      if (mode === 'transport') return new Response('synthetic unavailable', { status: 503 });
      const payload = JSON.parse(options.body);
      if (url.endsWith('/input_tokens')) return Response.json({ object: 'response.input_tokens', input_tokens: 120 });
      const input = JSON.parse(payload.input[0].content[0].text); let output;
      assert.equal(Object.hasOwn(input, 'expected'), false);
      assert.equal(Object.hasOwn(input, 'query'), false);
      if (payload.text.format.name === 'cairn_extract') {
        assert.deepEqual(Object.keys(input), ['messages']);
        output = { items: [{ content: input.messages[0].content, kind: 'preference', confidence: 0.9, sourceIndices: [0] }] };
      } else if (payload.text.format.name === 'cairn_qualifyCandidates') {
        qualifications++;
        output = { qualifications: input.items.map(item => ({ itemIndex: item.itemIndex,
          subject: { value: null, evidenceIndices: [mode === 'invalid-first' && qualifications === 1 ? 99999 : item.candidates[0].candidateIndex] },
          property: { value: null, evidenceIndices: [] }, scope: { value: null, evidenceIndices: [] },
          applies: { value: null, evidenceIndices: [] }, value: { value: null, evidenceIndices: [] },
          attribution: { value: 'unknown', evidenceIndices: [] }, commitment: { value: 'unknown', evidenceIndices: [] },
        })) };
      } else {
        assert.equal(payload.text.format.name, 'cairn_classify');
        output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
      }
      if (payload.text.format.name === 'cairn_qualifyCandidates') {
        output.qualifications = Object.fromEntries(output.qualifications.map(item => ['item_' + item.itemIndex, item]));
      }
      return Response.json({ object: 'response', model: payload.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 120, output_tokens: 100, total_tokens: 220 } });
    } });
    const expected = mode === 'success' ? 36 : mode === 'invalid-first' ? 34 : 1;
    assert.equal(sends, expected, JSON.stringify(report));
    assert.equal(report.cases.length, 6);
    assert.equal(report.semanticReviewRequired, true);
    if (mode === 'success') assert.ok(report.cases.every(item => item.status === 'completed'), JSON.stringify(report));
    else {
      assert.equal(report.cases[0].status, 'failed', JSON.stringify(report));
      assert.ok(report.cases.slice(1).every(item => item.status === (mode === 'invalid-first' ? 'completed' : 'not_run')));
    }
    for (const item of report.cases.filter(item => item.status === 'completed')) {
      assert.deepEqual(item.warmRecords, item.coldRecords);
      assert.equal(item.replay.ok, true);
      assert.equal(item.replay.value.duplicate, true);
    }
    assert.equal(report.budgetAfter.requestCount, sends);
    assert.equal(report.budgetAfter.reservedMicroUsd, sends * 5000);
    assert.equal(report.budgetAfter.unsettled, 0);
    assert.equal(report.budgetAfter.unknownCostRequests, mode === 'transport' ? 1 : sends / 2);
    assert.deepEqual(readFileSync(oldCapability), oldBytes);
    assert.equal(JSON.stringify(report).includes(f.apiKey), false);
    verifyPrivate(f.privateDirectory, f.apiKey);
    const intent = join(f.ledger.directory, 'candidate-qualification-heldout-v1-intent.json');
    const intentBefore = readFileSync(intent);
    const directory = join(f.root, 'retry'); mkdirSync(directory, { mode: 0o700 });
    const retry = await runCandidateQualificationPilot({ ...f.options, privateDirectory: directory,
      expectedCheckpoint: { requestCount: sends, reservedMicroUsd: sends * 5000 },
      fetchImpl: () => assert.fail('An existing global intent forbids repeat sends') });
    assert.equal(retry.status, 'halted');
    assert.ok(retry.cases.every(item => item.status === 'not_run'));
    assert.deepEqual(readFileSync(intent), intentBefore);
    const ledger = reopenExperimentBudget(f.ledger);
    try { assert.equal(ledger.getState().requestCount, sends); } finally { ledger.close(); }
  });
}

test('installed candidate pilot preserves partial intent without repair or reservation', async () => {
  const f = fixture(); const intent = join(f.ledger.directory, 'candidate-qualification-heldout-v1-intent.json');
  writeFileSync(intent, '{partial', { mode: 0o600, flag: 'wx' });
  const report = await runCandidateQualificationPilot({ ...f.options, fetchImpl: () => assert.fail('No partial-intent send') });
  assert.equal(report.status, 'halted'); assert.equal(report.budgetAfter.requestCount, 0);
  assert.equal(readFileSync(intent, 'utf8'), '{partial');
});
