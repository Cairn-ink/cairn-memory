import test from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { physicalStore, creationIdentity, storeFilesystemProbe } from '../local-daemon-identity.mjs';
import { assertLocalFilesystem } from '../local-daemon-state.mjs';
import { workspace, until } from './local-daemon-support.mjs';

test('both store identities probe the canonical parent and reject non-local types', async t => {
  await mkdir('/tmp/cairn-es-r2', { recursive: true });
  const root = await mkdtemp('/tmp/cairn-es-r2/f-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'parent')); await symlink(join(root, 'parent'), join(root, 'alias'));
  const path = join(root, 'alias', 'synthetic.sqlite'); await writeFile(path, 'synthetic metadata only');
  const parent = await realpath(dirname(path));
  for (const identify of [physicalStore, creationIdentity]) {
    const seen = [];
    await assert.rejects(identify(path, undefined, async directory => {
      seen.push(directory); return { type: 0x6969 };
    }), { code: 'daemon_filesystem' });
    assert.deepEqual(seen, [parent]);
  }
  const missing = join(root, 'alias', 'not-created.sqlite');
  await assert.rejects(creationIdentity(missing, undefined, async () => ({ type: 0x6969 })), { code: 'daemon_filesystem' });
  let probes = 0;
  const filesystem = storeFilesystemProbe(async directory => { probes++; assert.equal(directory, parent); return { type: 0xef53 }; });
  await physicalStore(path, undefined, filesystem); await creationIdentity(path, undefined, filesystem);
  assert.equal(probes, 1, 'one statfs for the canonical parent in a session attempt');
  // Pure policy assertion: no path beneath /mnt is created or probed.
  assert.throws(() => assertLocalFilesystem('/mnt', 0xef53), { code: 'daemon_filesystem' });
  assert.throws(() => assertLocalFilesystem('/mnt/synthetic', 0xef53), { code: 'daemon_filesystem' });
});
test('non-local store refusal precedes stdin; a local store attaches with one store statfs', { timeout: 25000 }, async t => {
  const w = await workspace(t);
  const rejected = w.child({ args: w.args, storeType: 0x6969, options: { root: join(w.root, 'run'), environment: {} } });
  rejected.release();
  rejected.process.stdin.write('{"jsonrpc":"2.0","id":1,"method":"initialize"}\n');
  const refusal = await until(() => rejected.messages.find(m => m.kind === 'forwarder-done'), 'filesystem refusal settles');
  assert.deepEqual(refusal.code, { refused: 'daemon_filesystem' }); assert.equal(refusal.bytesRead, 0);
  assert.equal(rejected.messages.filter(m => m.kind === 'candidate').length, 0);
  const local = w.child({ args: w.args, storeType: 0xef53, options: { root: join(w.root, 'run'), environment: {} } });
  local.release(); await w.connect(local);
  const probes = local.messages.filter(m => m.kind === 'store-statfs');
  assert.deepEqual(probes.map(m => m.parent), [await realpath(dirname(w.path))]);
});
