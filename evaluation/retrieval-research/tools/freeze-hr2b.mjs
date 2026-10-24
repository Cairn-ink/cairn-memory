import { readdir, readFile, writeFile, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { cliMain, requiredOption, compareIds } from '../lib/fixture.mjs';
import { sha256, fail } from '../assembly/auth.mjs';

// Coordinator only. Reconcile the filesystem walk against Git's independent
// cached+untracked enumeration (including ignored files); no index mutation.
export async function freezeHR2b(dir) {
  const root = fileURLToPath(new URL('../../../', import.meta.url)), names = [];
  dir = resolve(dir);
  const prefix = relative(root, dir);
  if (!prefix || prefix === '..' || prefix.startsWith(`..${sep}`)) fail('freeze_directory_outside_repository');
  async function visit(path = '') {
    for (const entry of await readdir(join(dir, path), { withFileTypes: true })) {
      const name = join(path, entry.name);
      if (entry.isSymbolicLink()) fail('freeze_symlink');
      if (entry.isDirectory()) await visit(name);
      else if (entry.isFile()) {
        if (!/^[\w./-]+$/u.test(name) || name === 'FROZEN.md') fail('freeze_invalid_or_existing_manifest');
        names.push(name);
      } else fail('freeze_special_file');
    }
  }
  await visit(); names.sort(compareIds);
  if (!names.length) fail('freeze_empty_directory');
  const workspace = createTestWorkspace(null, { prefix: '.hr2-freeze-', parent: fileURLToPath(new URL('../assembly/', import.meta.url)) });
  try {
    const path = join(workspace.path, 'git-list'), out = await open(path, 'w');
    let code;
    try {
      const child = spawn('git', ['--no-optional-locks', 'ls-files', '--cached', '--others', '--', prefix], { cwd: root, stdio: ['ignore', out.fd, 'inherit'] });
      code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    } finally { await out.close(); }
    if (code !== 0) fail(`freeze_git_exit:${code}`);
    const independent = [...new Set((await readFile(path, 'utf8')).trim().split('\n').filter(Boolean).map(name => relative(prefix, name)))].sort(compareIds);
    if (JSON.stringify(names) !== JSON.stringify(independent)) fail('freeze_file_list_mismatch');
    const pairs = [];
    for (const name of names) pairs.push([name, sha256(await readFile(join(dir, name)))]);
    const markdown = '| File | SHA-256 |\n| --- | --- |\n' + pairs.map(([name, hash]) => `| \`${name}\` | \`${hash}\` |`).join('\n') + '\n';
    await writeFile(join(dir, 'FROZEN.md'), markdown, { flag: 'wx' });
    return { ok: true, files: names.length, crossCheck: 'filesystem-walk == git-ls-files-cached-and-others', gitExitCode: code };
  } finally { await workspace.cleanup(); }
}
await cliMain(import.meta.url, async options => { console.log(JSON.stringify(await freezeHR2b(requiredOption(options, 'dir')))); });
