import { readFile, readdir, open } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { compareIds } from '../lib/fixture.mjs';
import { fail } from './auth.mjs';

const sourceDir = fileURLToPath(new URL('.', import.meta.url));
const root = new URL('../../../', import.meta.url);
export async function sourceIdentity(dir = sourceDir) {
  const entries = [];
  async function visit(relative) {
    for (const entry of (await readdir(join(dir, relative), { withFileTypes: true })).sort((a, b) => compareIds(a.name, b.name))) {
      const path = join(relative, entry.name);
      // Reserved owned scratch directories are never implementation sources.
      if (entry.isDirectory() && !entry.name.startsWith('.hr2-')) await visit(path);
      else if (entry.isFile() && entry.name.endsWith('.mjs')) entries.push([path, createHash('sha256').update(await readFile(join(dir, path))).digest('hex')]);
    }
  }
  await visit('');
  if (dir === sourceDir) {
    const research = fileURLToPath(new URL('../', import.meta.url));
    for (const folder of ['lib', 'tools']) for (const entry of (await readdir(join(research, folder))).filter(name => name.endsWith('.mjs')).sort(compareIds)) {
      const path = `../${folder}/${entry}`;
      entries.push([path, createHash('sha256').update(await readFile(join(research, folder, entry))).digest('hex')]);
    }
    entries.push(['../run.mjs', createHash('sha256').update(await readFile(join(research, 'run.mjs'))).digest('hex')]);
  }
  entries.sort(([a], [b]) => compareIds(a, b));
  if (!entries.length) fail('implementation_sources_missing');
  return { sourceHash: createHash('sha256').update(JSON.stringify(entries)).digest('hex'), sourceFiles: entries.map(([path]) => path) };
}

export async function implementationIdentity() {
  const workspace = createTestWorkspace(null, { prefix: '.hr2-identity-', parent: sourceDir });
  async function git(args, detachedAllowed = false) {
    const path = join(workspace.path, 'git-output'), output = await open(path, 'w');
    try {
      const child = spawn('git', args, { cwd: root, stdio: ['ignore', output.fd, 'inherit'] });
      const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
      if (code !== 0 && !(detachedAllowed && code === 1)) fail(`implementation_git_exit:${code}`);
      return { code, text: (await readFile(path, 'utf8')).trim() };
    } finally { await output.close(); }
  }
  try {
    const commit = (await git(['rev-parse', 'HEAD'])).text;
    const dirty = Boolean((await git(['--no-optional-locks', 'status', '--porcelain', '--untracked-files=all', '--', '.',
      ':(exclude,glob)evaluation/retrieval-research/assembly/.hr2-*/**'])).text);
    const detached = (await git(['symbolic-ref', '-q', 'HEAD'], true)).code === 1;
    const identity = { format: 'hr2-implementation-v1', commit, ...await sourceIdentity(), dirty, detached };
    validateImplementation(identity);
    return identity;
  } finally { await workspace.cleanup(); }
}

export function validateImplementation(identity) {
  if (identity?.format !== 'hr2-implementation-v1' || !/^[a-f0-9]{40}$/.test(identity.commit ?? '') || !/^[a-f0-9]{64}$/.test(identity.sourceHash ?? '') ||
      typeof identity.dirty !== 'boolean' || typeof identity.detached !== 'boolean' || !Array.isArray(identity.sourceFiles) || !identity.sourceFiles.length ||
      identity.sourceFiles.some(path => typeof path !== 'string' || !path.endsWith('.mjs')) || new Set(identity.sourceFiles).size !== identity.sourceFiles.length) fail('invalid_implementation_identity');
}
export const implementationKey = identity => JSON.stringify([identity.commit, identity.sourceHash, identity.dirty, identity.detached, [...identity.sourceFiles].sort(compareIds)]);
