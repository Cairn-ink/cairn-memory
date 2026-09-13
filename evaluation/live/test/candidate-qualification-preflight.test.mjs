import assert from 'node:assert/strict';
import { mkdtempSync, readdirSync, realpathSync, symlinkSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { getCandidateQualificationPilotPins, runCandidateQualificationPilot } from '../candidate-qualification-pilot.mjs';

// Only failing preflight: installed successful execution is verified separately.
const root = fileURLToPath(new URL('../../../', import.meta.url));
function fixture() {
  const directory = mkdtempSync(join(tmpdir(), 'cairn-candidate-preflight-'));
  const ledgerDirectory = mkdtempSync(join(tmpdir(), 'cairn-candidate-unopened-'));
  return { directory, ledgerDirectory, options: { ledger: { directory: ledgerDirectory, runId: 'synthetic', limitMicroUsd: 50000000, requestCap: 1000 },
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, apiKey: 'synthetic-key', fetchImpl: () => assert.fail('No preflight transport'),
    nodePath: realpathSync(process.execPath), cairnExecutable: join(root, 'adapters/mcp/cli.mjs'),
    cairnArtifact: join(directory, 'missing.tgz'), cairnArtifactSha256: 'a'.repeat(64), privateDirectory: directory,
    pins: getCandidateQualificationPilotPins() } };
}
test('CP1 exact explicit operator options and pin set reject missing or altered inputs before creating intent', async () => {
  const f = fixture(); await assert.rejects(runCandidateQualificationPilot());
  for (const key of Object.keys(f.options)) { const bad = { ...f.options }; delete bad[key]; await assert.rejects(runCandidateQualificationPilot(bad)); }
  await assert.rejects(runCandidateQualificationPilot({ ...f.options, apiKey: '' }));
  await assert.rejects(runCandidateQualificationPilot({ ...f.options, extra: true }));
  const pins = { ...f.options.pins }; pins[Object.keys(pins)[0]] = 'a'.repeat(64);
  await assert.rejects(runCandidateQualificationPilot({ ...f.options, pins }));
  assert.equal(f.options.pins['evaluation/live/candidate-qualification-fixture.json'], 'acbf7efc39ffaece1f9ab93f870a47494530d4cdde37293ada671dfc201c6691');
  assert.deepEqual(readdirSync(f.directory), []); assert.deepEqual(readdirSync(f.ledgerDirectory), []);
});
test('CP2 missing archive and noncanonical executable paths do not create intent or discover credentials', async () => {
  const f = fixture(); await assert.rejects(runCandidateQualificationPilot(f.options));
  await assert.rejects(runCandidateQualificationPilot({ ...f.options, nodePath: 'node' }));
  const alias = join(f.directory, 'node-alias'); symlinkSync(f.options.nodePath, alias);
  await assert.rejects(runCandidateQualificationPilot({ ...f.options, nodePath: alias }));
  assert.deepEqual(readdirSync(f.ledgerDirectory), []); assert.deepEqual(readdirSync(f.directory), ['node-alias']);
});
