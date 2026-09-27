import { createHash, randomUUID } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const MAX_ENTRIES = 100_000;
const MAX_BYTES = 1024 ** 3;
const FILE_CHUNK = Buffer.allocUnsafe(1024 * 1024);
const identities = new WeakMap();

export class Mem0NativeArtifactError extends Error {
  constructor(code) {
    super(code);
    this.name = 'Mem0NativeArtifactError';
    this.code = code;
  }
}

function fail(code) { throw new Mem0NativeArtifactError(code); }

function exactData(value, keys) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) fail('invalid_artifact_options');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length
    || keys.some((key) => !Object.hasOwn(descriptors, key) || !('value' in descriptors[key]))) {
    fail('invalid_artifact_options');
  }
  return Object.fromEntries(keys.map((key) => [key, descriptors[key].value]));
}

function canonicalRoot(value) {
  if (typeof value !== 'string' || !path.isAbsolute(value) || path.normalize(value) !== value) {
    fail('invalid_artifact_root');
  }
  try {
    const canonical = fs.realpathSync(value);
    if (canonical !== value || !fs.statSync(value).isDirectory()) fail('invalid_artifact_root');
    return canonical;
  } catch { fail('invalid_artifact_root'); }
}

function contained(root, target) {
  const relative = path.relative(root, target);
  return relative === '' || (relative !== '..' && !relative.startsWith(`..${path.sep}`)
    && !path.isAbsolute(relative));
}

function hashFile(file, expectedSize) {
  let fd;
  try {
    fd = fs.openSync(file, fs.constants.O_RDONLY | fs.constants.O_NOFOLLOW);
    const before = fs.fstatSync(fd);
    if (!before.isFile() || before.size !== expectedSize) fail('artifact_changed');
    const hash = createHash('sha256');
    let count = 0;
    while (count < before.size) {
      const n = fs.readSync(fd, FILE_CHUNK, 0, Math.min(FILE_CHUNK.length, before.size - count), null);
      if (n <= 0) fail('artifact_changed');
      hash.update(FILE_CHUNK.subarray(0, n));
      count += n;
    }
    const after = fs.fstatSync(fd);
    if (after.size !== before.size || after.mtimeMs !== before.mtimeMs
      || after.ino !== before.ino || after.mode !== before.mode) fail('artifact_changed');
    return hash.digest('hex');
  } catch (error) {
    if (error instanceof Mem0NativeArtifactError) throw error;
    fail('artifact_unreadable');
  } finally {
    if (fd !== undefined) fs.closeSync(fd);
  }
}

function digest(tag, value) {
  return createHash('sha256').update(`${tag}\n${JSON.stringify(value)}\n`).digest('hex');
}

function optionalNlpEntry(relative) {
  const importRoot = /^(?:lib|lib64)\/python3\.11\/(?:site-packages\/)?(.+)$/u.exec(relative)?.[1];
  if (!importRoot) return false;
  return importRoot === 'spacy' || importRoot.startsWith('spacy/')
    || /^spacy(?:\.py|\.pyc|(?:\.[^/]+)?\.so|\.pyd)$/iu.test(importRoot)
    || /^spacy[-_.][^/]+\.dist-info(?:\/|$)/iu.test(importRoot);
}

function scan(venvRoot, pythonRoot) {
  const roots = { venv: venvRoot, python: pythonRoot };
  const entries = [];
  let bytes = 0;
  const metadata = [];
  const directoryEdges = new Map();
  const addDirectoryEdge = (from, to) => {
    if (!directoryEdges.has(from)) directoryEdges.set(from, new Set());
    if (!directoryEdges.has(to)) directoryEdges.set(to, new Set());
    directoryEdges.get(from).add(to);
  };
  for (const role of ['venv', 'python']) {
    const root = roots[role];
    directoryEdges.set(root, new Set());
    const stack = [''];
    while (stack.length) {
      const relativeDir = stack.pop();
      const names = [];
      let directory;
      try {
        directory = fs.opendirSync(path.join(root, relativeDir));
        let item;
        while ((item = directory.readSync()) !== null) {
          if (entries.length + names.length >= MAX_ENTRIES) fail('artifact_entry_cap');
          names.push(item.name);
        }
      } catch (error) {
        if (error instanceof Mem0NativeArtifactError) throw error;
        fail('artifact_unreadable');
      } finally { directory?.closeSync(); }
      names.sort((a, b) => a < b ? -1 : a > b ? 1 : 0);
      for (const name of names) {
        if (name === '.' || name === '..' || name.includes(path.sep)) fail('invalid_artifact_entry');
        const relative = path.join(relativeDir, name);
        const file = path.join(root, relative);
        let stat;
        try { stat = fs.lstatSync(file); } catch { fail('artifact_unreadable'); }
        if (entries.length >= MAX_ENTRIES) fail('artifact_entry_cap');
        const slashRelative = relative.split(path.sep).join('/');
        if (optionalNlpEntry(slashRelative)) fail('optional_nlp_available');
        if (stat.isSymbolicLink()) {
          let literal;
          let target;
          try { literal = fs.readlinkSync(file); target = fs.realpathSync(file); }
          catch { fail('invalid_artifact_link'); }
          const targetRole = ['venv', 'python'].find((candidate) => contained(roots[candidate], target));
          if (!targetRole) fail('artifact_link_escape');
          let targetStat;
          try { targetStat = fs.statSync(target); } catch { fail('invalid_artifact_link'); }
          if (targetStat.isDirectory() && contained(target, path.dirname(file))) {
            fail('artifact_link_cycle');
          }
          if (targetStat.isDirectory()) addDirectoryEdge(path.dirname(file), target);
          entries.push([role, slashRelative, 'link', stat.mode & 0o111, 0, literal,
            targetRole, path.relative(roots[targetRole], target).split(path.sep).join('/')]);
        } else if (stat.isDirectory()) {
          addDirectoryEdge(path.dirname(file), file);
          entries.push([role, slashRelative, 'directory', stat.mode & 0o111, 0, null]);
          stack.push(relative);
        } else if (stat.isFile()) {
          bytes += stat.size;
          if (bytes > MAX_BYTES) fail('artifact_byte_cap');
          const hash = hashFile(file, stat.size);
          entries.push([role, slashRelative, 'file', stat.mode & 0o111, stat.size, hash]);
          if (/(^|\/)[^/]+\.dist-info\/METADATA$/.test(slashRelative)) {
            let data;
            if (stat.size > 1024 * 1024) fail('invalid_artifact_metadata');
            try { data = fs.readFileSync(file, 'utf8'); } catch { fail('artifact_unreadable'); }
            const packageName = /^Name:\s*(.+)$/m.exec(data)?.[1]?.trim();
            const version = /^Version:\s*(.+)$/m.exec(data)?.[1]?.trim();
            if (!packageName || !version) fail('invalid_artifact_metadata');
            if (packageName.toLowerCase().replace(/[-_.]+/gu, '-') === 'spacy')
              fail('optional_nlp_available');
            if (role === 'venv') metadata.push([slashRelative, packageName, version]);
          }
        } else fail('invalid_artifact_entry');
      }
    }
  }
  // Filesystem traversal never follows links, but the contained child can.
  // Reject cycles in the declared directory graph, including sibling links.
  const incoming = new Map([...directoryEdges.keys()].map(node => [node, 0]));
  for (const targets of directoryEdges.values()) {
    for (const target of targets) incoming.set(target, incoming.get(target) + 1);
  }
  const ready = [...incoming].filter(([, count]) => count === 0).map(([node]) => node);
  let visited = 0;
  while (ready.length) {
    const node = ready.pop();
    visited += 1;
    for (const target of directoryEdges.get(node)) {
      const count = incoming.get(target) - 1;
      incoming.set(target, count);
      if (count === 0) ready.push(target);
    }
  }
  if (visited !== directoryEdges.size) fail('artifact_link_cycle');
  const compare = (a, b) => a < b ? -1 : a > b ? 1 : 0;
  entries.sort((a, b) => compare(a[0], b[0]) || compare(a[1], b[1]));
  metadata.sort((a, b) => compare(a[0], b[0]));
  const source = entries.filter((entry) => entry[0] === 'venv'
    && entry[1].startsWith('lib/python3.11/site-packages/mem0/')
    && entry[2] === 'file' && !entry[1].includes('/__pycache__/')
    && !entry[1].endsWith('.pyc'));
  if (source.length === 0) fail('invalid_artifact_layout');
  if (metadata.filter(([, name, version]) => name.toLowerCase() === 'mem0ai'
    && version === '2.2.0').length !== 1
    || metadata.some(([, name, version]) => name.toLowerCase() === 'mem0ai'
      && version !== '2.2.0')) fail('invalid_artifact_version');
  const required = [
    ['venv', 'pyvenv.cfg', 'file'],
    ['venv', 'lib/python3.11/site-packages/mem0/memory/main.py', 'file'],
    ['python', 'bin/python3.11', 'file'],
    ['python', 'lib/python3.11/encodings/__init__.py', 'file'],
  ];
  for (const [role, relative, type] of required) {
    if (!entries.some((entry) => entry[0] === role && entry[1] === relative
      && entry[2] === type)) fail('invalid_artifact_layout');
  }
  let pyvenv;
  try { if (fs.statSync(path.join(venvRoot, 'pyvenv.cfg')).size > 4096) fail('invalid_artifact_layout'); }
  catch (error) { if (error instanceof Mem0NativeArtifactError) throw error; fail('artifact_unreadable'); }
  try { pyvenv = fs.readFileSync(path.join(venvRoot, 'pyvenv.cfg'), 'utf8'); }
  catch { fail('artifact_unreadable'); }
  if (!pyvenv.split('\n').some((line) => line.trim() === `home = ${path.join(pythonRoot, 'bin')}`)) {
    fail('invalid_artifact_layout');
  }
  const executable = fs.realpathSync(path.join(venvRoot, 'bin/python'));
  if (executable !== path.join(pythonRoot, 'bin/python3.11')) fail('invalid_artifact_layout');
  return Object.freeze({
    sourceTreeSha256: digest('cairn.mem0.native.source-tree.v1', source),
    dependencyLockSha256: digest('cairn.mem0.native.dependency-lock.v1', { entries, metadata }),
    entryCount: entries.length,
    regularFileBytes: bytes,
  });
}

export function inspectMem0NativeArtifact(options) {
  const { venvRoot: venvInput, pythonRoot: pythonInput } = exactData(options,
    ['venvRoot', 'pythonRoot']);
  const venvRoot = canonicalRoot(venvInput);
  const pythonRoot = canonicalRoot(pythonInput);
  if (contained(venvRoot, pythonRoot) || contained(pythonRoot, venvRoot)) fail('invalid_artifact_root');
  const snapshot = scan(venvRoot, pythonRoot);
  const descriptor = Object.freeze({ version: 'cairn-mem0-native-artifact-v1',
    sourceTreeSha256: snapshot.sourceTreeSha256,
    dependencyLockSha256: snapshot.dependencyLockSha256,
    entryCount: snapshot.entryCount, regularFileBytes: snapshot.regularFileBytes });
  identities.set(descriptor, Object.freeze({ venvRoot, pythonRoot, nonce: randomUUID() }));
  return descriptor;
}

export function checkedMem0NativeArtifact(descriptor) {
  const identity = identities.get(descriptor);
  if (!identity) fail('artifact_identity_required');
  const snapshot = scan(identity.venvRoot, identity.pythonRoot);
  if (snapshot.sourceTreeSha256 !== descriptor.sourceTreeSha256
    || snapshot.dependencyLockSha256 !== descriptor.dependencyLockSha256
    || snapshot.entryCount !== descriptor.entryCount
    || snapshot.regularFileBytes !== descriptor.regularFileBytes) fail('artifact_changed');
  return identity;
}
