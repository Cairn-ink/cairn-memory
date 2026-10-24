import { lstatSync, realpathSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';
import { fail } from './auth.mjs';

const repositoryRoot = realpathSync(new URL('../../../', import.meta.url));
const researchRoot = join(repositoryRoot, 'evaluation/retrieval-research');
const constantsPath = resolvedOutputPath(join(researchRoot, 'assembly/overhead-host-v2.json'));
const protectedRoots = ['results/hr2-final', 'results/test-final', 'fixtures'].map(path => resolvedOutputPath(join(researchRoot, path)));
const within = (path, root) => {
  const suffix = relative(root, path);
  return suffix === '' || (suffix !== '..' && !suffix.startsWith(`..${sep}`) && !isAbsolute(suffix));
};

// Resolve the deepest existing ancestor, including symlinks, before appending
// absent components. Return this physical path to the writer as well.
export function resolvedOutputPath(path) {
  let ancestor = resolve(path);
  const remainder = [];
  for (;;) {
    try {
      const entry = lstatSync(ancestor);
      try { return join(realpathSync(ancestor), ...remainder); }
      catch (error) {
        // A dangling link cannot establish a safe output ancestor.
        if (entry.isSymbolicLink()) fail('protected_output_path');
        throw error;
      }
    } catch (error) {
      if (error.code === 'ELOOP') fail('protected_output_path');
      if (error.code !== 'ENOENT') throw error;
      remainder.unshift(basename(ancestor));
      const parent = dirname(ancestor);
      if (parent === ancestor) throw error;
      ancestor = parent;
    }
  }
}

export function validateOutputPath(path) {
  const destination = resolvedOutputPath(path);
  if (destination === constantsPath || protectedRoots.some(root => within(destination, root))) fail('protected_output_path');
  try { if (lstatSync(destination).isFile()) fail('protected_output_path'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  return destination;
}

// Validate a stage's complete file set before its first write. File outputs
// must also be distinct and cannot be ancestors of one another.
export function validateOutputPaths(paths) {
  const destinations = paths.map(validateOutputPath);
  for (let i = 0; i < destinations.length; i++) for (let j = 0; j < i; j++) {
    if (within(destinations[i], destinations[j]) || within(destinations[j], destinations[i])) fail('protected_output_path');
  }
  return destinations;
}

export async function writeOutputText(path, text) {
  const destination = validateOutputPath(path);
  try { await writeFile(destination, text, { flag: 'wx' }); }
  catch (error) {
    if (error.code === 'EEXIST') fail('protected_output_path');
    throw error;
  }
}
export const writeOutputJson = (path, value) => writeOutputText(path, `${JSON.stringify(value, null, 2)}\n`);

// CLI stages defer provenance scratch creation until output preflight passes.
export const isStageCli = url => Boolean(process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === url);
