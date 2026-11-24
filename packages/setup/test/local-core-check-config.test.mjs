import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { lstat, mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import test from 'node:test';
import { buildCoreLocalCandidate } from '../../../packaging/build-core-local.mjs';
import { engineIdForCoreLocal, sha256 } from '../../../packaging/core-local/engine-id.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { executableFor } from '../lib/local-descriptor.mjs';
import { checkCoreLocalConfig, engineBaseId, nextRepairId } from '../lib/local-engine.mjs';

const verificationFailed = { key: 'local_engine_verification_failed', code: 1 };
const binPath = 'packaging/core-local/cli.mjs';

test('check-config verifies a built candidate and refuses wrong identities, reports and bytes', async t => {
  const { path: root } = createTestWorkspace(t);
  const output = join(root, 'candidate');
  buildCoreLocalCandidate(output);
  const manifest = JSON.parse(await readFile(join(output, 'candidate-manifest.json'), 'utf8'));
  const { engineId } = manifest;
  const appDirectory = join(root, 'engine', engineId, 'app');
  const modules = join(appDirectory, 'node_modules');
  const installed = join(modules, manifest.package.name);
  await mkdir(modules, { recursive: true });
  const unpack = spawnSync('tar', ['-xzf', join(output, manifest.archive.filename), '-C', modules],
    { encoding: 'utf8', timeout: 10000 });
  assert.equal(unpack.error, undefined);
  assert.equal(unpack.status, 0, unpack.stderr);
  await rename(join(modules, 'package'), installed);
  const options = { appDirectory, manifest, engineId, node: process.execPath };
  const probe = () => checkCoreLocalConfig(options);
  const report = { ok: true, engineId, databaseOpened: false, providerContacted: false };
  assert.deepEqual(await probe(), report);
  await assert.rejects(lstat(join(root, 'data')), { code: 'ENOENT' });

  const repair = await nextRepairId(root, engineId);
  assert.equal(repair, engineId + '-r2');
  assert.equal(engineBaseId(repair), engineId);
  assert.deepEqual(await checkCoreLocalConfig({ ...options, engineId: repair }), { ...report, engineId: repair });
  const differentId = 'core-local-v1-' + '0'.repeat(64);
  await assert.rejects(checkCoreLocalConfig({ ...options, engineId: differentId }), verificationFailed);
  await assert.rejects(checkCoreLocalConfig({ ...options, engineId: differentId,
    manifest: { ...manifest, engineId: differentId } }), verificationFailed);

  const executable = executableFor(root, engineId);
  const original = await readFile(executable, 'utf8');
  await writeFile(executable, original + '\n');
  await assert.rejects(probe(), verificationFailed);

  // Recalculate the manifest for synthetic payloads so these cases exercise the
  // probe itself after successful runtime inventory and checksum verification.
  const wrongReport = original.replace("await serveStdio(process.stdin, process.stdout);",
    "console.log(JSON.stringify({ jsonrpc: '2.0', id: 1, result: { capabilities: {}, serverInfo: { name: 'other', version: '0.0.0' }, protocolVersion: '2025-11-25' } }));\n" +
    "  console.log(JSON.stringify({ jsonrpc: '2.0', id: 2, result: {} }));");
  const blockedImport = original.replace("import { serveStdio }", "import './adapter-slot.mjs';\nimport { serveStdio }");
  for (const [source, code] of [[wrongReport, 0], [blockedImport, 1]]) {
    assert.notEqual(source, original);
    await writeFile(executable, source);
    const files = { ...manifest.files, [binPath]: sha256(source) };
    const id = engineIdForCoreLocal(files);
    await assert.rejects(checkCoreLocalConfig({ ...options, engineId: id,
      manifest: { ...manifest, files, engineId: id } }), error => {
      assert.equal(error.key, verificationFailed.key);
      assert.equal(error.params.exitCode, code);
      if (code === 1) assert.match(error.params.stderr, /candidate_probe_import_denied/u);
      return true;
    });
  }
});
