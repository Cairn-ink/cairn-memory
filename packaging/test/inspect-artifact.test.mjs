import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync,
  rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import zlib, { gzipSync, gunzipSync } from 'node:zlib';
import { inspectArtifact, verifyInspectedArtifact } from '../../evaluation/live/installed-capture-support.mjs';
import { createQualificationPilotAttempt } from '../../evaluation/live/qualification-pilot-attempt.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');

// Write deterministic ustar headers directly, including adversarial members
// that filesystem-based fixture creation would normalize or refuse.
function tarMember({ name, prefix = '', type = '0', bytes = Buffer.alloc(0), mode = 0o644, size = bytes.length }) {
  const header = Buffer.alloc(512);
  const field = (offset, length, text) => {
    assert.ok(Buffer.byteLength(text) <= length);
    header.write(text, offset, length, 'utf8');
  };
  const octal = (offset, length, value) => field(offset, length, `${value.toString(8).padStart(length - 1, '0')}\0`);
  field(0, 100, name);
  octal(100, 8, mode); octal(108, 8, 0); octal(116, 8, 0);
  octal(124, 12, size); octal(136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = type.charCodeAt(0);
  field(257, 8, 'ustar\0' + '00');
  field(345, 155, prefix);
  const checksum = header.reduce((sum, byte) => sum + byte, 0);
  field(148, 8, `${checksum.toString(8).padStart(6, '0')}\0 `);
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)]);
}

const tarBytes = members => Buffer.concat([...members.map(tarMember), Buffer.alloc(1024)]);

function fixture(t, { changeManifest = () => {}, extraFiles = [] } = {}) {
  const root = mkdtempSync(path.join(realpathSync(tmpdir()), 'cairn-inspect-test-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const files = ['core/contract.mjs', 'adapters/openai/index.mjs', 'bin/cairn-memory.mjs',
    ...Array.from({ length: 297 }, (_, index) => `core/synthetic-${index}.mjs`), ...extraFiles];
  const members = files.map(relative => ({ name: `package/${relative}`,
    bytes: Buffer.from(`// Synthetic source: ${relative}\n`) }));
  const manifest = { name: 'cairn-memory-local-preview', files };
  changeManifest(manifest);
  members.push({ name: 'package/package.json', bytes: Buffer.from(JSON.stringify(manifest)) });
  const packageRoot = path.join(root, 'installed');
  for (const { name, bytes } of members) {
    const filename = path.join(packageRoot, name.slice('package/'.length));
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, bytes);
  }
  const archive = path.join(root, 'synthetic.tgz');
  const f = { root, packageRoot, files, members, archive, executable: path.join(packageRoot, 'bin/cairn-memory.mjs') };
  f.pack = (edit = bytes => bytes) => {
    writeFileSync(archive, gzipSync(edit(tarBytes(members))));
    f.artifactSha256 = hash(readFileSync(archive));
  };
  f.pack();
  return f;
}

function mockBuiltin(t, object, name, implementation) {
  const wrapped = t.mock.method(object, name, implementation);
  syncBuiltinESMExports();
  t.after(() => { wrapped.mock.restore(); syncBuiltinESMExports(); });
  return wrapped;
}

function forbidChildProcesses(t) {
  return ['exec', 'execSync', 'execFile', 'execFileSync', 'spawn', 'spawnSync', 'fork'].map(name =>
    mockBuiltin(t, childProcess, name, () => { assert.fail(`Unexpected child process: ${name}`); }));
}

const assertNoChildren = mocks => mocks.forEach(mock => assert.equal(mock.mock.callCount(), 0));
const inspect = f => inspectArtifact(f.executable, f.archive, f.artifactSha256);
const verify = (f, provenance) => verifyInspectedArtifact(f.executable, f.archive, provenance);
function caught(fn) {
  try { fn(); } catch (error) { return error; }
  assert.fail('Expected an error');
}
function sameNativeError(actual, expected) {
  assert.equal(actual.constructor, expected.constructor);
  for (const key of ['message', 'code', 'syscall', 'path']) assert.equal(actual[key], expected[key], key);
  return true;
}

test('300 manifest files use one archive read and gunzip, zero children, and no filesystem extraction', t => {
  const f = fixture(t);
  assert.equal(f.files.length, 300);
  const children = forbidChildProcesses(t);
  const read = fs.readFileSync, unzip = zlib.gunzipSync;
  let archiveReads = 0;
  mockBuiltin(t, fs, 'readFileSync', (...args) => {
    if (args[0] === f.archive) archiveReads++;
    return read(...args);
  });
  const decompression = mockBuiltin(t, zlib, 'gunzipSync', (...args) => unzip(...args));
  const scratch = mockBuiltin(t, fs, 'mkdtempSync', () => assert.fail('Inspection must not create a directory'));
  const provenance = inspect(f);
  const sourceHashes = Object.fromEntries([...f.files, 'package.json'].map(relative =>
    [relative, hash(readFileSync(path.join(f.packageRoot, relative)))]));
  assert.deepEqual(provenance, { packageRoot: f.packageRoot, artifactSha256: f.artifactSha256, sourceHashes });
  assert.equal(Object.keys(provenance.sourceHashes).length, 301);
  assert.equal(archiveReads, 1);
  assert.equal(decompression.mock.callCount(), 1);
  for (let index = 0; index < 3; index++) verify(f, provenance);
  assert.equal(archiveReads, 4);
  assert.equal(decompression.mock.callCount(), 1, 'verification must never decompress the archive');
  assert.equal(scratch.mock.callCount(), 0);
  assertNoChildren(children);
});

for (const [kind, code] of [['source', 'cairn_install_source_mismatch'], ['archive', 'unpinned_cairn_artifact']]) {
  test(`${kind} changed between preflight and first send is rejected without children or forwarding`, async t => {
    const f = fixture(t);
    const children = forbidChildProcesses(t);
    const provenance = inspect(f);
    const filename = kind === 'source' ? path.join(f.packageRoot, 'core/contract.mjs') : f.archive;
    writeFileSync(filename, 'synthetic changed bytes');
    assert.throws(() => verify(f, provenance), { message: code });
    let forwarded = 0;
    const attempt = createQualificationPilotAttempt({
      readState: () => ({ state: 'open', attempts: [], requestCount: 0, reservedMicroUsd: 0,
        requestCap: 100, limitMicroUsd: 1_000_000 }),
      expectedCheckpoint: { requestCount: 0, reservedMicroUsd: 0 },
      checkPins: () => verify(f, provenance),
      persist: () => {},
      send: () => { forwarded++; assert.fail('Changed provenance must fail before forwarding'); },
    });
    await assert.rejects(attempt.request('/responses', JSON.stringify({ model: 'gpt-4.1-mini-2025-04-14',
      text: { format: { name: 'cairn_extract' } } })), { message: 'guard_pin_or_persistence_failed' });
    assert.equal(forwarded, 0);
    assert.equal(attempt.getState().requests, 0);
    assertNoChildren(children);
  });
}

test('__proto__ is an own hash entry and tampering cannot escape verification', t => {
  const f = fixture(t, { extraFiles: ['__proto__'] });
  const provenance = inspect(f);
  assert.equal(Object.getPrototypeOf(provenance.sourceHashes), Object.prototype);
  assert.equal(Object.hasOwn(provenance.sourceHashes, '__proto__'), true);
  assert.equal(Object.keys(provenance.sourceHashes).length, 302);
  assert.equal(provenance.sourceHashes.__proto__, hash(readFileSync(path.join(f.packageRoot, '__proto__'))));
  verify(f, provenance);
  writeFileSync(path.join(f.packageRoot, '__proto__'), 'synthetic changed bytes');
  assert.throws(() => verify(f, provenance), { message: 'cairn_install_source_mismatch' });
});

for (const kind of ['file-symlink', 'directory-symlink', 'directory', 'missing']) {
  test(`cheap verifier rejects an installed ${kind} even with unchanged source bytes`, t => {
    const f = fixture(t);
    const children = forbidChildProcesses(t);
    const provenance = inspect(f);
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
    assert.throws(() => verify(f, provenance), { message: 'cairn_install_source_mismatch' });
    assertNoChildren(children);
  });
}

test('preflight rejects malformed or changed hash pins before decompression', t => {
  const f = fixture(t);
  const children = forbidChildProcesses(t);
  const decompression = mockBuiltin(t, zlib, 'gunzipSync', () => assert.fail('Unpinned bytes cannot be parsed'));
  assert.throws(() => inspectArtifact(f.executable, f.archive, 'bad'), { message: 'invalid_cairn_artifact' });
  const changedHash = `${f.artifactSha256[0] === '0' ? '1' : '0'}${f.artifactSha256.slice(1)}`;
  assert.throws(() => inspectArtifact(f.executable, f.archive, changedHash), { message: 'unpinned_cairn_artifact' });
  assert.equal(decompression.mock.callCount(), 0);
  assertNoChildren(children);
});

for (const kind of ['name', 'files', 'required', 'path', 'source']) {
  test(`preflight ${kind} validation keeps its failure code`, t => {
    const f = fixture(t, { changeManifest: manifest => {
      if (kind === 'name') manifest.name = 'synthetic-wrong-package';
      if (kind === 'files') manifest.files = null;
      if (kind === 'required') manifest.files = manifest.files.filter(relative => relative !== 'core/contract.mjs');
      if (kind === 'path') manifest.files.push('core/../outside.mjs');
    } });
    if (kind === 'source') writeFileSync(path.join(f.packageRoot, 'core/contract.mjs'), 'synthetic mismatch');
    assert.throws(() => inspect(f),
      { message: kind === 'source' ? 'cairn_install_source_mismatch' : 'invalid_cairn_artifact' });
  });
}

for (const relative of ['core/contract.mjs', 'package.json']) {
  test(`missing archive member package/${relative} fails explicitly with invalid_cairn_artifact`, t => {
    const f = fixture(t);
    const index = f.members.findIndex(member => member.name === `package/${relative}`);
    assert.ok(index >= 0);
    f.members.splice(index, 1);
    f.pack();
    assert.ok(readFileSync(path.join(f.packageRoot, relative)).length, 'installed file remains present');
    const children = forbidChildProcesses(t);
    assert.throws(() => inspect(f), { message: 'invalid_cairn_artifact' });
    assertNoChildren(children);
  });
}

test('ustar prefix, NUL file flags and restrictive unlisted directories need no extraction', t => {
  const f = fixture(t);
  const member = f.members[0];
  member.name = 'contract.mjs'; member.prefix = 'package/core'; member.type = '\0';
  f.members.push({ name: 'package/', type: '5', mode: 0o777 },
    { name: 'package/locked/', type: '5', mode: 0o500 },
    { name: 'package/locked/unlisted', bytes: Buffer.from('synthetic unlisted bytes') });
  f.pack();
  const children = forbidChildProcesses(t);
  const before = readdirSync(f.root);
  const scratch = mockBuiltin(t, fs, 'mkdtempSync', () => assert.fail('No archive metadata may reach disk'));
  const provenance = inspect(f);
  verify(f, provenance);
  assert.equal(Object.hasOwn(provenance.sourceHashes, 'core/contract.mjs'), true);
  assert.equal(scratch.mock.callCount(), 0);
  assert.deepEqual(readdirSync(f.root), before);
  assertNoChildren(children);
});

for (const kind of ['duplicate', 'duplicate-directory', 'alias-duplicate', 'outside', 'dot-directory', 'traversal',
  'checksum', 'size', 'padding', 'size-field', 'trailer']) {
  test(`tar ${kind} is rejected with invalid_cairn_artifact`, t => {
    const f = fixture(t);
    if (kind === 'duplicate') f.members.push({ ...f.members.at(-1) });
    if (kind === 'duplicate-directory') f.members.push({ name: 'package/core/', type: '5' }, { name: 'package/core/', type: '5' });
    if (kind === 'alias-duplicate') f.members.push({ ...f.members[0], name: 'package/core//contract.mjs' });
    if (kind === 'outside') f.members.push({ name: 'outside', bytes: Buffer.from('synthetic') });
    if (kind === 'dot-directory') f.members.push({ name: '.', type: '5', mode: 0o777 });
    if (kind === 'traversal') f.members.push({ name: 'package/../outside', bytes: Buffer.from('synthetic') });
    if (kind === 'size') f.members[0].size = 0o77777777777;
    if (kind === 'size-field') {
      f.pack(bytes => {
        bytes[124] = 0x39;
        bytes.fill(0x20, 148, 156);
        const checksum = bytes.subarray(0, 512).reduce((sum, byte) => sum + byte, 0);
        bytes.write(`${checksum.toString(8).padStart(6, '0')}\0 `, 148, 8, 'ascii');
        return bytes;
      });
    } else if (kind === 'padding') {
      // Header promises one byte; its data exists but the rest of its block does not.
      const one = tarMember({ name: 'package/truncated', bytes: Buffer.from('x') });
      f.pack(() => one.subarray(0, 513));
    } else f.pack(bytes => {
      if (kind === 'checksum') bytes[0] ^= 1;
      if (kind === 'trailer') bytes[bytes.length - 1] = 1;
      return bytes;
    });
    const children = forbidChildProcesses(t);
    assert.throws(() => inspect(f), { message: 'invalid_cairn_artifact' });
    assertNoChildren(children);
  });
}

for (const type of ['1', '2', '3', '4', '6', 'g', 'x', 'L', 'K']) {
  test(`tar typeflag ${type} is rejected, including links and extended headers`, t => {
    const f = fixture(t);
    f.members.push({ name: 'package/unsupported', type });
    f.pack();
    assert.throws(() => inspect(f), { message: 'invalid_cairn_artifact' });
  });
}

for (const relative of ['core/contract.mjs', 'bin/cairn-memory.mjs']) {
  test(`missing installed ${relative} preserves the native preflight filesystem error`, t => {
    const f = fixture(t);
    const provenance = inspect(f);
    const filename = path.join(f.packageRoot, relative);
    unlinkSync(filename);
    const expected = caught(() => realpathSync(filename));
    assert.equal(expected.code, 'ENOENT');
    assert.throws(() => inspect(f), error => sameNativeError(error, expected));
    assert.throws(() => verify(f, provenance), { message: 'cairn_install_source_mismatch' });
  });
}

test('unreadable installed files propagate the exact native read error only during preflight', t => {
  const f = fixture(t);
  const provenance = inspect(f);
  const filename = path.join(f.packageRoot, 'core/contract.mjs');
  const expected = Object.assign(new Error('synthetic unreadable source'), { code: 'EACCES', syscall: 'open', path: filename });
  const read = fs.readFileSync;
  mockBuiltin(t, fs, 'readFileSync', (...args) => {
    if (args[0] === filename) throw expected;
    return read(...args);
  });
  assert.throws(() => inspect(f), error => error === expected);
  assert.throws(() => verify(f, provenance), { message: 'cairn_install_source_mismatch' });
});

test('malformed package.json retains its native SyntaxError', t => {
  const f = fixture(t);
  const member = f.members.find(member => member.name === 'package/package.json');
  member.bytes = Buffer.from('{malformed');
  f.pack();
  const expected = caught(() => JSON.parse(member.bytes));
  assert.equal(expected.constructor, SyntaxError);
  assert.throws(() => inspect(f), error => sameNativeError(error, expected));
});

test('corrupt gzip retains its native zlib error', t => {
  const f = fixture(t);
  const bytes = Buffer.from('synthetic corrupt gzip');
  writeFileSync(f.archive, bytes);
  f.artifactSha256 = hash(bytes);
  const expected = caught(() => gunzipSync(bytes));
  assert.equal(expected.code, 'Z_DATA_ERROR');
  assert.throws(() => inspect(f), error => sameNativeError(error, expected));
});
