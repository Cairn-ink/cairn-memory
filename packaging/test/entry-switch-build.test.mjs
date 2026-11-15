import test from 'node:test';
import { spawnSync } from 'node:child_process';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { buildArtifact, command } from '../build.mjs';
import { engineBuild } from '../../adapters/mcp/local-daemon-identity.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const walk = (root, prefix = '') => readdirSync(root, { withFileTypes: true }).flatMap(e => e.isDirectory()
  ? walk(join(root, e.name), prefix + e.name + '/') : [prefix + e.name]).sort();
test('staged build record covers the actual archive and installed verification refuses tampering', async t => {
  const a = buildArtifact({ ownDirectory: path => t.after(() => rmSync(path, { recursive: true, force: true })) });
  const root = a.stagingPath, build = JSON.parse(readFileSync(join(root, 'engine-build.json')));
  const archive = command('tar', ['-tzf', a.artifactPath], root, a.userconfig).trim().split('\n').map(n => n.slice(8)).sort();
  assert.deepEqual(walk(root), archive); assert.equal(archive.length, a.files.length);
  t.diagnostic(`archive/filesystem cross-check: ${archive.length} files`);
  assert.ok(archive.includes('engine-build.json'));
  assert.ok(!archive.some(n => /(?:demo-transcript|walkthrough)\.mjs$/.test(n)));
  const digest = createHash('sha256');
  assert.deepEqual(Object.keys(build.sourceHashes).sort(), archive.filter(n => n !== 'engine-build.json'));
  for (const name of Object.keys(build.sourceHashes).sort()) {
    assert.equal(hash(readFileSync(join(root, name))), build.sourceHashes[name], name);
    digest.update(name + '\0' + build.sourceHashes[name] + '\0');
  }
  assert.equal(build.digest, digest.digest('hex'));
  assert.equal(await engineBuild(root), build.digest);
  assert.equal(await engineBuild(root), build.digest);
  const backup = join(root, '..', 'mutation-original');
  const metadataPath = join(root, 'engine-build.json'), metadataBytes = readFileSync(metadataPath);
  writeFileSync(backup, metadataBytes);
  const malformed = structuredClone(build);
  // String coercion would preserve this digest; the metadata must still reject
  // a hash with the wrong JSON type, including a non-rehashed file's entry.
  malformed.sourceHashes['bin/cairn-memory.mjs'] = [malformed.sourceHashes['bin/cairn-memory.mjs']];
  try {
    writeFileSync(metadataPath, JSON.stringify(malformed));
    await assert.rejects(engineBuild(root), { code: 'daemon_build' });
  } finally {
    writeFileSync(metadataPath, metadataBytes);
    assert.equal(spawnSync('cmp', [backup, metadataPath]).status, 0);
  }
  for (const name of ['engine-build.json', 'package.json', 'npm-shrinkwrap.json',
    'adapters/mcp/local-daemon.mjs', 'adapters/mcp/local-daemon-identity.mjs', 'adapters/mcp/local-daemon-state.mjs',
    'adapters/mcp/local-daemon-wire.mjs', 'adapters/mcp/local-daemon-liveness.mjs', 'adapters/mcp/local-forwarder.mjs']) {
    const path = join(root, name), bytes = readFileSync(path);
    writeFileSync(backup, bytes);
    try { writeFileSync(path, name.endsWith('.json') ? '{malformed' : Buffer.concat([bytes, Buffer.from('\n// mutation\n')]));
      await assert.rejects(engineBuild(root), { code: 'daemon_build' }, name);
      rmSync(path); await assert.rejects(engineBuild(root), { code: 'daemon_build' }, 'missing ' + name);
    } finally { writeFileSync(path, bytes); assert.equal(spawnSync('cmp', [backup, path]).status, 0); }
  }
  t.diagnostic('all 10 staged one-file mutations restored byte-for-byte: cmp rc=0');
});
