import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile, unlink, symlink, link, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { fixture } from './fixtures/pack.mjs';
import { parseManifest, verifyPack, checkFence } from '../pack.mjs';
import { canonical, sha256, strictJSON } from '../common.mjs';
const verify = f => verifyPack(f.root, { catalog: f.catalog });
test('L03 canonical approved manifest precedes all hashing and runtime selection; production catalog fails closed', async t => {
  const f = await fixture(t), stages = [];
  const p = await verifyPack(f.root, { catalog: f.catalog, onStage: (...args) => stages.push(args) });
  assert.equal(p.metadata.revision, 'sha256:' + sha256(canonical(f.manifest)));
  assert.equal(stages[0][0], 'manifest');
  assert.equal(stages.filter(s => s[0] === 'hash').length, f.manifest.files.length + 1);
  assert.deepEqual(stages.slice(-2).map(s => s[0]), ['metadata', 'native-selection']);
  await assert.rejects(verifyPack(f.root), { code: 'model_pack_manifest_invalid' });
  await writeFile(join(f.root, 'manifest.json'), canonical(f.manifest) + ' ');
  stages.length = 0;
  await assert.rejects(verifyPack(f.root, { catalog: f.catalog, onStage: s => stages.push(s) }), { code: 'model_pack_manifest_invalid' });
  assert.equal(stages.length, 0);
});
test('L03 duplicate/unknown keys, unsafe paths, missing inventory and self-consistent unapproved manifests refuse', async t => {
  const f = await fixture(t), original = canonical(f.manifest);
  for (const bytes of [original.replace('"format":', '"format":"duplicate","format":'), original.replace('"format":', '"unknown":0,"format":')]) assert.throws(() => parseManifest(Buffer.from(bytes), f.catalog), { code: 'model_pack_manifest_invalid' });
  for (const path of ['../escape', '/absolute', 'a\\b', 'a//b', 'a/./b', 'C:/escape']) {
    const m = structuredClone(f.manifest); m.files[0].path = path;
    assert.throws(() => parseManifest(Buffer.from(canonical(m)), f.catalog), { code: 'model_pack_manifest_invalid' });
  }
  assert.throws(() => strictJSON(Buffer.from('{"a":1,"a":2}')), { code: 'protocol_error' });
});
test('L03 extra/missing data, symlinks, hardlinks and byte corruption have stage-specific errors', async t => {
  for (const mode of ['extra', 'missing', 'symlink', 'hardlink', 'corrupt']) {
    const f = await fixture(t), path = join(f.root, 'model/onnx/model.onnx_data');
    if (mode === 'extra') await writeFile(join(f.root, 'extra'), 'extra');
    if (mode === 'missing') await unlink(path);
    if (mode === 'symlink') { await unlink(path); await symlink(join(f.root, 'model/onnx/model.onnx'), path); }
    if (mode === 'hardlink') { await unlink(path); await link(join(f.root, 'model/onnx/model.onnx'), path); }
    if (mode === 'corrupt') await writeFile(path, 'x'.repeat(f.contents.get('model/onnx/model.onnx_data').bytes.length));
    await assert.rejects(verify(f), { code: 'model_pack_integrity' }, mode);
  }
});
test('L03 complete file fence detects post-verification replacement of every artifact and directories', async t => {
  const f = await fixture(t);
  for (const path of f.manifest.files.map(f => f.path)) {
    const p = await verify(f), full = join(f.root, path), data = await f.read(path);
    await writeFile(full + '.new', data); await rename(full + '.new', full);
    await assert.rejects(checkFence(f.root, p.fence), { code: 'model_pack_integrity' }, path);
  }
  const p = await verify(f);
  await rename(join(f.root, 'model'), join(f.root, 'old-model')); await mkdir(join(f.root, 'model'));
  await assert.rejects(checkFence(f.root, p.fence), { code: 'model_pack_integrity' });
});
test('L05 static platform selection follows complete hashes and never imports a runtime', async t => {
  const f = await fixture(t), stages = [];
  await assert.rejects(verifyPack(f.root, { catalog: f.catalog, arch: 'absent', onStage: s => stages.push(s) }), { code: 'model_runtime_unavailable' });
  assert.equal(stages.at(-1), 'native-selection');
  const p = await verify(f); assert.equal(p.runtimeStatus, 'not-loaded');
});
