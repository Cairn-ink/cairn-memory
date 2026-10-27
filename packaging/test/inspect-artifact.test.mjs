import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, realpathSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { inspectArtifact, verifyInspectedArtifact } from '../../evaluation/live/installed-capture-support.mjs';
import { createQualificationPilotAttempt } from '../../evaluation/live/qualification-pilot-attempt.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

function fixture(t, changeManifest = () => {}) {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'cairn-inspect-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const staging = path.join(root, 'staging');
  const source = path.join(staging, 'package');
  const files = ['core/contract.mjs', 'adapters/openai/index.mjs', 'bin/cairn-memory.mjs',
    ...Array.from({ length: 297 }, (_, index) => `core/synthetic-${index}.mjs`)];
  for (const relative of files) {
    const filename = path.join(source, relative);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, `// Synthetic source: ${relative}\n`);
  }
  const manifest = { name: 'cairn-memory-local-preview', files };
  changeManifest(manifest);
  writeFileSync(path.join(source, 'package.json'), JSON.stringify(manifest));
  const packageRoot = path.join(root, 'installed');
  cpSync(source, packageRoot, { recursive: true });
  const archive = path.join(root, 'synthetic.tgz');
  // Fixture creation is separate from the counted inspection extraction.
  childProcess.execFileSync('tar', ['-czf', archive, '-C', staging, 'package'], { stdio: 'ignore' });
  return { root, packageRoot, files, archive, artifactSha256: hash(readFileSync(archive)),
    executable: path.join(packageRoot, 'bin/cairn-memory.mjs') };
}

function trackTar(t, failExtraction = false) {
  const original = childProcess.execFileSync;
  const calls = [];
  const wrapped = t.mock.method(childProcess, 'execFileSync', (command, args, options) => {
    assert.equal(command, 'tar');
    assert.equal(args[0], '-xzf');
    const directory = args[args.indexOf('-C') + 1];
    assert.ok(lstatSync(directory).isDirectory());
    if (process.platform !== 'win32') assert.equal(lstatSync(directory).mode & 0o777, 0o700);
    calls.push({ args, directory });
    if (failExtraction) throw new Error('synthetic_extraction_failure');
    return original(command, args, options);
  });
  syncBuiltinESMExports();
  t.after(() => { wrapped.mock.restore(); syncBuiltinESMExports(); });
  return calls;
}

function assertRemoved(calls) {
  for (const { directory } of calls) assert.equal(existsSync(directory), false, 'extraction directory is removed');
}

test('300 manifest files require exactly one extraction; repeated verification never spawns tar', t => {
  const f = fixture(t);
  assert.equal(f.files.length, 300);
  const calls = trackTar(t);
  const provenance = inspectArtifact(f.executable, f.archive, f.artifactSha256);
  const sourceHashes = Object.fromEntries([...f.files, 'package.json'].map(relative =>
    [relative, hash(readFileSync(path.join(f.packageRoot, relative)))]));
  assert.deepEqual(provenance, { packageRoot: f.packageRoot, artifactSha256: f.artifactSha256, sourceHashes });
  assert.equal(Object.keys(provenance.sourceHashes).length, 301);
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0].args, ['-xzf', f.archive, '-C', calls[0].directory]);
  assertRemoved(calls);
  for (let index = 0; index < 3; index++) verifyInspectedArtifact(f.executable, f.archive, provenance);
  assert.equal(calls.length, 1, 'first-send and later checks must use hashes only');
});

for (const [kind, code] of [['source', 'cairn_install_source_mismatch'], ['archive', 'unpinned_cairn_artifact']]) {
  test(`${kind} changed between preflight and first send is rejected without extraction or forwarding`, async t => {
    const f = fixture(t);
    const calls = trackTar(t);
    const provenance = inspectArtifact(f.executable, f.archive, f.artifactSha256);
    const filename = kind === 'source' ? path.join(f.packageRoot, 'core/contract.mjs') : f.archive;
    writeFileSync(filename, 'synthetic changed bytes');
    assert.throws(() => verifyInspectedArtifact(f.executable, f.archive, provenance), { message: code });
    let forwarded = 0;
    const attempt = createQualificationPilotAttempt({
      readState: () => ({ state: 'open', attempts: [], requestCount: 0, reservedMicroUsd: 0,
        requestCap: 100, limitMicroUsd: 1_000_000 }),
      expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 },
      checkPins: () => verifyInspectedArtifact(f.executable, f.archive, provenance),
      persist: () => {},
      send: () => { forwarded++; assert.fail('Changed provenance must fail before forwarding'); },
    });
    await assert.rejects(attempt.request('/responses', JSON.stringify({ model: 'gpt-4.1-mini-2025-04-14',
      text: { format: { name: 'cairn_extract' } } })), { message: 'guard_pin_or_persistence_failed' });
    assert.equal(forwarded, 0);
    assert.equal(attempt.getState().requests, 0);
    assert.equal(calls.length, 1);
    assertRemoved(calls);
  });
}

for (const kind of ['file-symlink', 'directory-symlink', 'directory', 'missing']) {
  test(`cheap verifier rejects an installed ${kind} even with unchanged source bytes`, t => {
    const f = fixture(t);
    const calls = trackTar(t);
    const provenance = inspectArtifact(f.executable, f.archive, f.artifactSha256);
    const filename = path.join(f.packageRoot, 'core/contract.mjs');
    const copy = path.join(f.root, 'copied-core');
    cpSync(path.join(f.packageRoot, 'core'), copy, { recursive: true });
    if (kind === 'directory-symlink') {
      rmSync(path.join(f.packageRoot, 'core'), { recursive: true });
      symlinkSync(copy, path.join(f.packageRoot, 'core'), 'dir');
    } else {
      unlinkSync(filename);
      if (kind === 'file-symlink') symlinkSync(path.join(copy, 'contract.mjs'), filename);
      if (kind === 'directory') mkdirSync(filename);
    }
    assert.throws(() => verifyInspectedArtifact(f.executable, f.archive, provenance),
      { message: 'cairn_install_source_mismatch' });
    assert.equal(calls.length, 1);
    assertRemoved(calls);
  });
}

test('preflight rejects malformed or changed hash pins before any extraction', t => {
  const f = fixture(t);
  const calls = trackTar(t);
  assert.throws(() => inspectArtifact(f.executable, f.archive, 'bad'), { message: 'invalid_cairn_artifact' });
  const changedHash = `${f.artifactSha256[0] === '0' ? '1' : '0'}${f.artifactSha256.slice(1)}`;
  assert.throws(() => inspectArtifact(f.executable, f.archive, changedHash), { message: 'unpinned_cairn_artifact' });
  assert.equal(calls.length, 0);
});

for (const kind of ['name', 'files', 'required', 'path', 'source', 'extraction']) {
  test(`preflight ${kind} failure still removes its private extraction directory`, t => {
    const f = fixture(t, manifest => {
      if (kind === 'name') manifest.name = 'synthetic-wrong-package';
      if (kind === 'files') manifest.files = null;
      if (kind === 'required') manifest.files = manifest.files.filter(relative => relative !== 'core/contract.mjs');
      if (kind === 'path') manifest.files.push('core/../outside.mjs');
    });
    if (kind === 'source') writeFileSync(path.join(f.packageRoot, 'core/contract.mjs'), 'synthetic mismatch');
    const calls = trackTar(t, kind === 'extraction');
    assert.throws(() => inspectArtifact(f.executable, f.archive, f.artifactSha256),
      { message: kind === 'source' ? 'cairn_install_source_mismatch' : 'invalid_cairn_artifact' });
    assert.equal(calls.length, 1);
    assertRemoved(calls);
  });
}
