import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';

const coreRoot = 'packages/core';
const coreSource = coreRoot + '/src/';
const hostEntry = 'packaging/core-local/host.mjs';
const adapterSlot = 'packaging/core-local/adapter-slot.mjs';
export const cliEntry = 'packaging/core-local/cli.mjs';
export const coreManifest = coreRoot + '/package.json';

function regularFile(root, path) {
  const absolute = join(root, path);
  if (!lstatSync(absolute).isFile() || realpathSync(absolute) !== absolute) {
    throw new Error(`nonregular_core_local_input: ${path}`);
  }
  return absolute;
}

function* coreModules(root, directory = coreSource.slice(0, -1)) {
  for (const entry of readdirSync(join(root, directory), { withFileTypes: true })) {
    const path = directory + '/' + entry.name;
    if (entry.isSymbolicLink()) throw new Error(`linked_core_input: ${path}`);
    if (entry.isDirectory()) yield* coreModules(root, path);
    else if (entry.name.endsWith('.mjs')) yield path;
  }
}

function target(from, specifier, dynamic) {
  if (specifier === 'node:sqlite') {
    if (from === adapterSlot) return;
    throw new Error(`sqlite_outside_core_local_adapter: ${from}`);
  }
  if (specifier === 'node:readline' && from === hostEntry) return;
  if (typeof specifier !== 'string' || !/^\.\.?\/(?:[\w.-]+\/)*[\w.-]+\.mjs$/u.test(specifier)) {
    throw new Error(`unsupported_core_local_import: ${from}`);
  }
  const path = posix.join(posix.dirname(from), specifier);
  if (from.startsWith(coreSource)) {
    if (!path.startsWith(coreSource)) throw new Error(`core_import_escapes_package: ${from} -> ${path}`);
  } else if (!path.startsWith(coreSource) && !path.startsWith('packaging/core-local/')) {
    throw new Error(`core_local_import_escapes_runtime: ${from} -> ${path}`);
  }
  if (path === adapterSlot && (from !== hostEntry || !dynamic)) {
    throw new Error(`invalid_core_local_adapter_edge: ${from}`);
  }
  return path;
}

function imports(root, path) {
  const source = readFileSync(regularFile(root, path), 'utf8');
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const edges = new Set();
  function visit(node) {
    if (node.type === 'MetaProperty' && node.meta.name === 'import' ||
        node.type === 'Identifier' && node.name === 'getBuiltinModule' ||
        node.type === 'Literal' && node.value === 'getBuiltinModule') {
      throw new Error(`unsupported_core_local_loader: ${path}`);
    }
    const dynamic = node.type === 'ImportExpression';
    if (dynamic || ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)) {
      if (node.source) {
        const next = target(path, node.source.type === 'Literal' ? node.source.value : undefined, dynamic);
        if (next) edges.add(next);
      }
    }
    for (const value of Object.values(node)) {
      if (Array.isArray(value)) {
        for (const item of value) if (item?.type) visit(item);
      } else if (value?.type) visit(value);
    }
  }
  visit(ast);
  return edges;
}

export function coreRuntimeManifest(root) {
  const manifest = JSON.parse(readFileSync(regularFile(root, coreManifest), 'utf8'));
  const exports = Object.entries(manifest.exports).flatMap(([name, value]) => {
    if (!value || typeof value !== 'object' || Object.keys(value).some(key => key !== 'default' && key !== 'types')) {
      throw new Error('unsupported_core_runtime_export');
    }
    const entry = value.default;
    if (entry === undefined && Object.hasOwn(value, 'types')) return [];
    if (typeof entry !== 'string' || !entry.startsWith('./src/') || !entry.endsWith('.mjs')) {
      throw new Error('unsupported_core_runtime_export');
    }
    const path = posix.join(coreRoot, entry);
    if (!path.startsWith(coreSource)) throw new Error('core_runtime_export_escapes_package');
    return [[name, { default: entry }]];
  });
  const { name, version, type, license, engines } = manifest;
  return { name, version, private: true, type, license, engines, exports: Object.fromEntries(exports) };
}

export function deriveRuntimeGraph(root) {
  root = realpathSync(root);
  const { exports } = coreRuntimeManifest(root);
  const coreEntries = Object.values(exports).map(({ default: entry }) => posix.join(coreRoot, entry));
  // Audit unbundled core modules too. Only modules reachable from the runtime
  // entry points contribute to the archive.
  const graph = new Map();
  for (const path of coreModules(root)) graph.set(path, imports(root, path));
  const required = new Set();
  const pending = [cliEntry, ...coreEntries];
  while (pending.length) {
    const path = pending.pop();
    if (required.has(path)) continue;
    required.add(path);
    pending.push(...(graph.get(path) ?? imports(root, path)));
  }
  if (!required.has(adapterSlot)) throw new Error('core_local_adapter_slot_missing');
  return [...required].sort();
}
