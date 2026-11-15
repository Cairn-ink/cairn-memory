import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, lstat, mkdir, readFile, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { observeHostedPause, withHostedPauseGate } from '../hosted-pause.mjs';
import { hostedTargetId } from '../transport-hosted.mjs';

for (const alias of [false, true]) test(`host-created readable root preserves pause authority (alias=${alias})`, async t => {
  const ws = createTestWorkspace(t), directory = join(ws.path, 'host-data');
  await mkdir(directory, { mode: 0o755 });
  const root = alias ? join(ws.path, 'profile') : directory;
  if (alias) await symlink(directory, root);
  const config = { root, endpoint: 'http://127.0.0.1:1' };
  let remote = { generation: 0, paused: false, enforced: true };
  t.mock.method(globalThis, 'fetch', async () => Response.json(remote));
  let starts = 0;
  await observeHostedPause(config, 'synthetic');
  await withHostedPauseGate(config, 0, guard => { guard.beforeStart(); starts++; });
  assert.equal(starts, 1, 'active_host_root_sends');
  remote = { ...remote, generation: 1, paused: true };
  await observeHostedPause(config, 'synthetic');
  await assert.rejects(withHostedPauseGate(config, 0, () => { starts++; }), /pause_unavailable/);
  remote = { ...remote, paused: false };
  await observeHostedPause(config, 'synthetic');
  await withHostedPauseGate(config, 1, guard => { guard.beforeStart(); starts++; });
  assert.equal(starts, 2, 'resume_restores_admission');
  assert.equal((await lstat(directory)).mode & 0o777, 0o755, 'host_mode_is_preserved');
  const file = join(root, 'hosted-pause', hostedTargetId(config) + '.json');
  assert.equal((await lstat(file)).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), remote);
  await chmod(file, 0o644);
  await assert.rejects(withHostedPauseGate(config, 1, () => { starts++; }), /state_permissions/);
  assert.equal(starts, 2, 'authority_files_remain_private');
});

for (const mode of [0o775, 0o777]) test(`writable host root fails closed (${mode.toString(8)})`, async t => {
  const ws = createTestWorkspace(t), root = join(ws.path, 'host-data');
  await mkdir(root); await chmod(root, mode);
  t.mock.method(globalThis, 'fetch', async () => Response.json({ generation: 0, paused: false, enforced: true }));
  await assert.rejects(observeHostedPause({ root, endpoint: 'http://127.0.0.1:1' }, 'synthetic'), /state_permissions/);
});
