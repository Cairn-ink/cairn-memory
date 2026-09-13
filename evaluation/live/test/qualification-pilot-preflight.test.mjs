import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, realpathSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { getQualificationPilotPins, QUALIFICATION_PILOT_PIN_FILES, runQualificationPilot } from '../qualification-pilot.mjs';

// Deliberately invalid synthetic setup exercises only preflight. It is not an
// installed-artifact test and must never enter provider or ledger execution.
const root = fileURLToPath(new URL('../../../', import.meta.url));
const fixtureName = 'evaluation/live/qualification-pilot-fixture.json';
function fixture() {
  const directory = mkdtempSync(path.join(tmpdir(), 'cairn-pilot-preflight-'));
  const ledgerDirectory = mkdtempSync(path.join(tmpdir(), 'cairn-pilot-unused-ledger-'));
  let sends = 0;
  const options = { ledger: { directory: ledgerDirectory, runId: 'synthetic-unopened', limitMicroUsd: 50000000, requestCap: 10000 },
    expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 }, apiKey: 'synthetic-preflight-secret',
    fetchImpl: async () => { sends++; assert.fail('Preflight cannot send'); },
    nodePath: realpathSync(process.execPath), cairnExecutable: path.join(root, 'adapters/mcp/cli.mjs'),
    cairnArtifact: path.join(directory, 'missing-artifact.tgz'), cairnArtifactSha256: 'a'.repeat(64),
    privateDirectory: directory, pins: getQualificationPilotPins() };
  return { options, directory, ledgerDirectory, sends: () => sends };
}
const unchanged = (f) => { assert.equal(f.sends(), 0); assert.deepEqual(readdirSync(f.ledgerDirectory), []); };

test('QP E1 exact explicit entrypoint options reject before network or ledger creation', async () => {
  await assert.rejects(runQualificationPilot());
  const f = fixture();
  for (const key of Object.keys(f.options)) {
    const bad = { ...f.options }; delete bad[key]; await assert.rejects(runQualificationPilot(bad), /invalid_pilot_options/);
  }
  await assert.rejects(runQualificationPilot({ ...f.options, extra: true }), /invalid_pilot_options/);
  for (const apiKey of ['', null, 'synthetic\nsecret', 'synthetic secret'])
    await assert.rejects(runQualificationPilot({ ...f.options, apiKey }), /invalid_pilot_options/);
  await assert.rejects(runQualificationPilot({ ...f.options, fetchImpl: undefined }), /invalid_pilot_options/);
  unchanged(f); assert.deepEqual(readdirSync(f.directory), []);
});

test('QP E3 fixed fixture and complete exact pin set reject missing extra malformed or mismatched pins', async () => {
  const f = fixture();
  assert.equal(f.options.pins[fixtureName], '2f9859d309b145253bb6b37060a0723111045a0f9ad50ad42e095343ba40fec5');
  assert.equal(createHash('sha256').update(readFileSync(path.join(root, fixtureName))).digest('hex'), f.options.pins[fixtureName]);
  for (const name of ['evaluation/live/qualification-pilot.mjs', 'evaluation/live/qualification-pilot-attempt.mjs',
    'evaluation/live/qualification-session.mjs', 'evaluation/live/proxy.mjs', 'evaluation/live/cairn-launcher.mjs',
    'evaluation/experiment-budget/request-guard.mjs']) assert.ok(QUALIFICATION_PILOT_PIN_FILES.includes(name));
  const missing = { ...f.options.pins }; delete missing[fixtureName];
  for (const pins of [null, {}, missing, { ...f.options.pins, extra: 'a'.repeat(64) },
    { ...f.options.pins, [fixtureName]: 'bad' }])
    await assert.rejects(runQualificationPilot({ ...f.options, pins }), /invalid_pilot_pins/);
  await assert.rejects(runQualificationPilot({ ...f.options, pins: { ...f.options.pins, [fixtureName]: 'a'.repeat(64) } }), /pilot_pin_mismatch/);
  unchanged(f); assert.deepEqual(readdirSync(f.directory), []);
});

test('QP E3 missing artifact and relative or symlinked runtime paths fail without evidence or authorization', async () => {
  const f = fixture();
  await assert.rejects(runQualificationPilot(f.options));
  await assert.rejects(runQualificationPilot({ ...f.options, nodePath: 'node' }), /unsafe_pilot_path/);
  await assert.rejects(runQualificationPilot({ ...f.options, cairnExecutable: './cli.mjs' }), /unsafe_pilot_path/);
  const alias = path.join(f.directory, 'node-alias'); symlinkSync(f.options.nodePath, alias);
  await assert.rejects(runQualificationPilot({ ...f.options, nodePath: alias }), /unsafe_pilot_path/);
  unchanged(f); assert.deepEqual(readdirSync(f.directory), ['node-alias']);
});

test('QP E3 unsafe evidence permissions or existing partial evidence refuse preflight without repair', async () => {
  for (const scenario of ['mode', 'partial']) {
    const f = fixture();
    // A regular dummy archive permits path checks, but cannot pass provenance.
    const archive = path.join(f.ledgerDirectory, 'dummy.tgz'); writeFileSync(archive, 'not-an-archive', { mode: 0o600 });
    if (scenario === 'mode') chmodSync(f.directory, 0o755);
    else writeFileSync(path.join(f.directory, 'initial-report.json'), '{partial', { mode: 0o600 });
    await assert.rejects(runQualificationPilot({ ...f.options, cairnArtifact: archive }), /unsafe_private_directory/);
    assert.equal(f.sends(), 0); assert.deepEqual(readdirSync(f.ledgerDirectory), ['dummy.tgz']);
    if (scenario === 'partial') assert.equal(readFileSync(path.join(f.directory, 'initial-report.json'), 'utf8'), '{partial');
  }
});
