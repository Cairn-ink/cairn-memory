import { spawn } from 'node:child_process';
import { lstat } from 'node:fs/promises';
import { basename, dirname, join } from 'node:path';
import { checkFence } from './pack.mjs';
import { childEnvironment } from './process.mjs';
import { fail } from './common.mjs';
export const PUBLISHER_PATH = 'runtime/cairn-publish';
// The installer never compiles, searches PATH or runs an arbitrary pack entry.
// This fixed release-owned helper is part of the approved native inventory.
export async function publishPackNoReplace(stage, target, verified) {
  if (!verified || verified.packPath !== stage || !verified.fence.selectedNativeFiles.includes(PUBLISHER_PATH) ||
      !verified.manifest.files.some(f => f.path === PUBLISHER_PATH && f.role === 'native') ||
      !verified.manifest.licenses.some(l => l.component === 'cairn-publish' && l.version === verified.manifest.packVersion && l.spdx === 'Apache-2.0' && l.evidencePaths.includes('licenses/cairn-publish.c'))) fail('model_pack_unavailable');
  await checkFence(stage, verified.fence);
  const parentPath = dirname(stage);
  if (dirname(target) !== parentPath) fail('model_pack_unavailable');
  const parent = verified.fence.directories.find(d => d.path === parentPath), source = verified.fence.directories.find(d => d.path === stage);
  const helper = join(stage, PUBLISHER_PATH), s = await lstat(helper);
  if (!parent || !source || (s.mode & 0o111) === 0) fail('model_pack_unavailable');
  let child;
  try {
    child = spawn(helper, [parentPath, basename(stage), basename(target), parent.dev, parent.ino, source.dev, source.ino], {
      shell: false, env: childEnvironment(), stdio: ['ignore', 'ignore', 'ignore']
    });
    const result = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', code => resolve(code)); });
    if (result === 2) fail('model_pack_conflict');
    if (result !== 0) fail('model_pack_unavailable');
  } catch (e) { fail(e.code === 'model_pack_conflict' ? e.code : 'model_pack_unavailable'); }
}
