import { createHash } from 'node:crypto';
import { closeSync, constants, fstatSync, lstatSync, openSync, readSync,
  realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const CHECKOUT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const DEPENDENCIES = Object.freeze([
  'core/model-call.mjs',
  'core/model-budget.mjs',
  'core/model-diagnostics.mjs',
  'core/validation.mjs',
  'plugins/cairn-memory/lib/redact.mjs',
]);
const predicates = new WeakMap();
const fail = () => { throw new Error('installed_core_deadline_invalid'); };
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

function canonicalPath(filename) {
  if (typeof filename !== 'string' || !path.isAbsolute(filename)
    || path.resolve(filename) !== filename || filename === path.parse(filename).root
    || /[\x00-\x1f\x7f]/u.test(filename)) fail();
  for (let current = filename; current !== path.parse(filename).root;
    current = path.dirname(current)) {
    let entry;
    try { entry = lstatSync(current); } catch { fail(); }
    if (entry.isSymbolicLink()) fail();
  }
  if (realpathSync(filename) !== filename) fail();
  return filename;
}

function boundedRegularBytes(filename) {
  canonicalPath(filename);
  let descriptor;
  try {
    const before = lstatSync(filename);
    if (!before.isFile() || before.size < 1 || before.size > 1024 * 1024) fail();
    descriptor = openSync(filename, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    const opened = fstatSync(descriptor);
    if (!opened.isFile() || opened.dev !== before.dev || opened.ino !== before.ino
      || opened.size !== before.size) fail();
    const bytes = Buffer.alloc(before.size + 1);
    let length = 0;
    while (length < bytes.length) {
      const count = readSync(descriptor, bytes, length, bytes.length - length, length);
      if (count === 0) break;
      length += count;
    }
    const after = fstatSync(descriptor);
    if (length !== before.size || after.dev !== before.dev || after.ino !== before.ino
      || after.size !== before.size || after.mtimeMs !== before.mtimeMs) fail();
    return bytes.subarray(0, length);
  } catch { fail(); }
  finally { if (descriptor !== undefined) closeSync(descriptor); }
}

// This token is only a local bridge between one verified installed core and
// the pair guard. It is not serializable authorization or a caller predicate.
export async function loadQualifiedSourcePairInstalledCoreDeadline(options) {
  try {
    if (options === null || typeof options !== 'object' || Array.isArray(options)
      || Object.keys(options).length !== 1 || !Object.hasOwn(options, 'packageRoot')) fail();
    const packageRoot = canonicalPath(options.packageRoot);
    if (path.basename(packageRoot) !== 'cairn-memory-local-preview'
      || !lstatSync(packageRoot).isDirectory()) fail();
    for (const relative of DEPENDENCIES) {
      if (sha256(boundedRegularBytes(path.join(packageRoot, relative)))
        !== sha256(boundedRegularBytes(path.join(CHECKOUT, relative)))) fail();
    }
    const module = await import(pathToFileURL(path.join(packageRoot, 'core/model-call.mjs')).href);
    if (typeof module.isCoreModelDeadlineSignal !== 'function') fail();
    const token = Object.freeze(Object.create(null));
    predicates.set(token, module.isCoreModelDeadlineSignal);
    return token;
  } catch { fail(); }
}

export function installedCoreDeadlinePredicateFor(token) {
  if (token === null || typeof token !== 'object' || !predicates.has(token)) fail();
  return predicates.get(token);
}
