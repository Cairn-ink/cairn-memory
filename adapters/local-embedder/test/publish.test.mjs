import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFile, mkdir, readdir, access } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fixture } from './fixtures/pack.mjs';
import { sha256 } from '../common.mjs';
import { installPack } from '../install.mjs';
import { publishPackNoReplace } from '../publish.mjs';
import { verifyPack } from '../pack.mjs';
async function publisherFixture(t) {
  const f = await fixture(t), binary = join(f.parent, 'compiled-publisher');
  // Release-build simulation only. The production installer never compiles.
  const sourcePath = fileURLToPath(new URL('../publish.c', import.meta.url));
  const result = spawnSync('cc', ['-std=c11', '-O2', '-Wall', '-Wextra', '-Werror', sourcePath, '-o', binary], { stdio: 'ignore' });
  assert.equal(result.error, undefined); assert.equal(result.status, 0); assert.equal(result.signal, null);
  for (const [path, bytes, role] of [['runtime/cairn-publish', await readFile(binary), 'native'], ['licenses/cairn-publish.c', await readFile(sourcePath), 'license']]) {
    f.contents.set(path, { bytes, role }); f.manifest.files.push({ path, bytes: bytes.length, sha256: sha256(bytes), role });
  }
  f.manifest.files.sort((a, b) => a.path < b.path ? -1 : 1);
  f.manifest.runtime.nativeTargets[0].files.push('runtime/cairn-publish'); f.manifest.runtime.nativeTargets[0].files.sort();
  f.manifest.licenses.push({ component: 'cairn-publish', version: f.manifest.packVersion, spdx: 'Apache-2.0', source: 'https://example.invalid/reviewed/cairn-publish', revision: null, evidencePaths: ['licenses/cairn-publish.c'], noticePaths: ['licenses/THIRD_PARTY_NOTICES.md'], sourceOfferPaths: [] });
  f.manifest.licenses.sort((a, b) => a.component + '\0' + a.version < b.component + '\0' + b.version ? -1 : 1);
  f.catalog.splice(0, 1, ...(await f.publish()));
  return f;
}
test('L04 manifest-bound native publisher atomically installs a tiny fake pack without overwriting', async t => {
  const f = await publisherFixture(t), target = join(f.parent, 'installed');
  const p = await installPack(target, { catalog: f.catalog, source: f.source });
  assert.equal(p.manifestHash, f.catalog[0].manifestHash); assert.equal(p.runtimeStatus, 'not-loaded');
  // Exercise the native operation directly against a preexisting EMPTY target;
  // the former plain rename implementation could have silently replaced it.
  const other = join(f.parent, 'conflict'); await mkdir(other);
  await assert.rejects(publishPackNoReplace(target, other, p), { code: 'model_pack_conflict' });
  assert.deepEqual(await readdir(other), []); await access(target);
});
test('L04 final empty-directory race is refused at the atomic operation, after the JS checks', async t => {
  const f = await publisherFixture(t), target = join(f.parent, 'raced');
  await assert.rejects(installPack(target, { catalog: f.catalog, source: f.source, publishNoReplace: async (stage, final, verified) => {
    await mkdir(final); return publishPackNoReplace(stage, final, verified);
  } }), { code: 'model_pack_conflict' });
  assert.deepEqual(await readdir(target), []);
});
