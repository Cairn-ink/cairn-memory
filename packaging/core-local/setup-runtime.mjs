import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, posix } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';
import { buildCoreLocalCandidate } from '../build-core-local.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const entryList = 'packages/setup/lib/local-cutover-runtime.mjs';
const pathPattern = /^(?:[\w-][\w.-]*\/)*[\w-][\w.-]*$/u;
const domain = /^(?:packages\/(?:adapter-sqlite|core)\/src\/|core\/|adapters\/(?:mcp|local)\/|integrations\/client\/|packaging\/core-local\/)/u;
const core = 'packages/core/src/index.mjs';
const manifestName = 'migration-manifest.json';
const json = value => JSON.stringify(value, null, 2) + '\n';
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const sorted = map => Object.fromEntries([...map].sort(([left], [right]) => (left > right) - (left < right)));

function read(root, path) {
  const absolute = join(root, path);
  if (!pathPattern.test(path) || !lstatSync(absolute).isFile() || realpathSync(absolute) !== absolute) {
    throw new Error('invalid_setup_migration_file: ' + path);
  }
  return readFileSync(absolute);
}

function visit(node, callback) {
  if (!node || typeof node !== 'object') return;
  if (Array.isArray(node)) {
    for (const child of node) visit(child, callback);
    return;
  }
  if (node.type) callback(node);
  for (const value of Object.values(node)) visit(value, callback);
}

function ast(bytes) {
  return parse(bytes.toString('utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
}

function entryPoints() {
  const tree = ast(read(repo, entryList));
  const declaration = tree.body.find(node => node.type === 'VariableDeclaration' &&
    node.declarations[0]?.id.name === 'entryPaths');
  if (!declaration || declaration.declarations.length !== 1 ||
      declaration.declarations[0].init.type !== 'ObjectExpression') throw new Error('invalid_setup_migration_entries');
  return declaration.declarations[0].init.properties.map(node => {
    if (node.type !== 'Property' || node.value.type !== 'Literal' || typeof node.value.value !== 'string') {
      throw new Error('invalid_setup_migration_entry');
    }
    return node.value.value;
  }).sort();
}

// This is a first-party dependency check for accidental imports. The offline
// migration owns its SQLite handles and OS access in the setup process.
function deriveMigration(root, entries) {
  const files = new Map(), imports = new Map();
  const pending = [...entries];
  while (pending.length) {
    const file = pending.pop();
    if (files.has(file)) continue;
    if ((!domain.test(file) || !file.endsWith('.mjs')) && file !== 'plugins/cairn-memory/lib/redact.mjs') {
      throw new Error('invalid_setup_migration_edge: ' + file);
    }
    const bytes = read(root, file);
    const edges = new Set(), rewrites = [];
    visit(ast(bytes), node => {
      if (!['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration', 'ImportExpression'].includes(node.type) ||
          !node.source) return;
      const specifier = node.source.value;
      if (typeof specifier !== 'string') throw new Error('dynamic_setup_migration_import: ' + file);
      if (specifier.startsWith('node:')) {
        edges.add(specifier);
        return;
      }
      const target = specifier === '@cairn-ink/core' ? core
        : specifier.startsWith('.') ? posix.join(posix.dirname(file), specifier) : null;
      if (!target) throw new Error(`external_setup_migration_import: ${file} -> ${specifier}`);
      edges.add(target);
      pending.push(target);
      if (specifier === '@cairn-ink/core') {
        const relative = posix.relative(posix.dirname(file), core);
        rewrites.push({ ...node.source, specifier: relative.startsWith('.') ? relative : './' + relative });
      }
    });
    let source = bytes.toString('utf8');
    for (const { start, end, specifier } of rewrites.sort((left, right) => right.start - left.start)) {
      source = source.slice(0, start) + JSON.stringify(specifier) + source.slice(end);
    }
    files.set(file, Buffer.from(source));
    imports.set(file, [...edges].sort());
  }
  return { files, imports: sorted(imports) };
}

function inventory(root, prefix = '') {
  return readdirSync(join(root, prefix), { withFileTypes: true }).flatMap(entry => {
    const path = prefix + entry.name;
    if (entry.isDirectory()) return inventory(root, path + '/');
    if (!entry.isFile()) throw new Error('invalid_setup_runtime_entry: ' + path);
    return [path];
  }).sort();
}

export function buildSetupCoreLocal(runtime, { check }) {
  const entries = entryPoints();
  const { files, imports } = deriveMigration(repo, entries);
  const scratch = mkdtempSync(join(tmpdir(), 'cairn-setup-core-'));
  try {
    const rebuilt = join(scratch, 'candidate'), candidate = join(runtime, 'core-local');
    buildCoreLocalCandidate(rebuilt);
    const candidateFiles = inventory(rebuilt);
    if (check) {
      if (!isDeepStrictEqual(inventory(candidate), candidateFiles) ||
          candidateFiles.some(file => !read(candidate, file).equals(read(rebuilt, file)))) {
        throw new Error('core_local_setup_bundle_stale');
      }
    } else {
      mkdirSync(candidate, { recursive: true });
      for (const file of candidateFiles) writeFileSync(join(candidate, file), read(rebuilt, file));
    }

    const migration = join(runtime, 'cutover'), payload = join(migration, 'files');
    const manifest = json({ schemaVersion: 1, entries, imports,
      files: sorted([...files].map(([file, bytes]) => [file, sha256(bytes)])) });
    if (check) {
      if (!isDeepStrictEqual(inventory(migration), [...files.keys()].map(file => 'files/' + file).concat(manifestName).sort()) ||
          read(migration, manifestName).toString('utf8') !== manifest ||
          [...files].some(([file, bytes]) => !read(payload, file).equals(bytes)) ||
          !isDeepStrictEqual(deriveMigration(payload, entries).imports, imports)) {
        throw new Error('setup_migration_bundle_stale');
      }
    } else {
      rmSync(migration, { recursive: true, force: true });
      for (const [file, bytes] of files) {
        const target = join(payload, file);
        mkdirSync(dirname(target), { recursive: true });
        writeFileSync(target, bytes);
      }
      writeFileSync(join(migration, manifestName), manifest);
    }
    console.log(`Core-local candidate and setup migration ${check ? 'verified' : 'generated'} (${files.size} migration files).`);
  } finally {
    rmSync(scratch, { recursive: true, force: true });
  }
}
