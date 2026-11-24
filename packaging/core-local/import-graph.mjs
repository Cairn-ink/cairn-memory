// Threat model: this static audit catches ACCIDENTAL capability use (SQLite, network,
// native, worker or child-process access) in first-party code reachable from the
// candidate's entry points. It is not a sandbox: code written to evade it on purpose,
// for example through reflection, is out of scope. The runtime check is the builder's
// installed startup smoke with SQLite disabled.
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';

const coreRoot = 'packages/core';
const coreSource = coreRoot + '/src/';
const hostEntry = 'packaging/core-local/host.mjs';
const adapterSlot = 'packaging/core-local/adapter-slot.mjs';
const compositionEntry = 'openLocalService';
export const cliEntry = 'packaging/core-local/cli.mjs';
export const coreManifest = coreRoot + '/package.json';

const runtimeGlobals = new Set([
  'AbortSignal', 'Array', 'ArrayBuffer', 'BigInt', 'Blob', 'Date', 'Error', 'Float32Array',
  'Float64Array', 'Infinity', 'Intl', 'JSON', 'Map', 'Math', 'NaN', 'Number',
  'Object', 'Promise', 'Reflect', 'RegExp', 'Set', 'String', 'TextDecoder',
  'TextEncoder', 'TypeError', 'Uint8Array', 'WeakMap', 'WeakSet', 'atob', 'btoa',
  'encodeURIComponent', 'isFinite', 'isNaN', 'parseInt', 'structuredClone', 'undefined',
]);
const stdioProcessMembers = new Set(['argv', 'stdin', 'stdout']);
const contextReadTokens = coreSource + 'service/context-read-tokens.mjs';
const webCryptoMembers = new Map([
  [coreSource + 'privacy/fingerprint.mjs', new Set(['digest', 'importKey', 'sign'])],
  [coreSource + 'routing/card.mjs', new Set(['digest'])],
  [coreSource + 'service/signed-read-token.mjs', new Set(['importKey', 'sign'])],
]);
const functionTypes = new Set(['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression']);
const scopeTypes = new Set([
  ...functionTypes, 'Program', 'BlockStatement', 'StaticBlock', 'CatchClause',
  'ClassDeclaration', 'ClassExpression', 'ForStatement', 'ForInStatement',
  'ForOfStatement', 'SwitchStatement',
]);

function walk(node, parent, visit) {
  visit(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) {
      for (const item of value) if (item?.type) walk(item, node, visit);
    } else if (value?.type) walk(value, node, visit);
  }
}

function bind(pattern, names, declarations) {
  if (!pattern) return;
  switch (pattern.type) {
    case 'Identifier':
      names.add(pattern.name);
      declarations.add(pattern);
      return;
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        bind(property.type === 'RestElement' ? property.argument : property.value, names, declarations);
      }
      return;
    case 'ArrayPattern':
      for (const element of pattern.elements) bind(element, names, declarations);
      return;
    case 'AssignmentPattern':
      return bind(pattern.left, names, declarations);
    case 'RestElement':
      return bind(pattern.argument, names, declarations);
    default:
      throw new Error('unsupported_core_local_binding');
  }
}

function identifierReference(node, parent, parents, declarations) {
  if (node.type !== 'Identifier' || declarations.has(node)) return false;
  switch (parent.type) {
    case 'MemberExpression':
      return parent.computed || node === parent.object;
    case 'Property':
    case 'PropertyDefinition':
    case 'MethodDefinition':
      return parent.computed || node !== parent.key;
    case 'ExportSpecifier':
      return node === parent.local && !parents.get(parent).source;
    case 'ImportSpecifier':
    case 'MetaProperty':
    case 'ExportAllDeclaration':
      return false;
    case 'LabeledStatement':
    case 'BreakStatement':
    case 'ContinueStatement':
      return node !== parent.label;
    default:
      return true;
  }
}

function dotMember(object, member) {
  return member?.type === 'MemberExpression' && member.object === object &&
    !member.computed && !member.optional ? member.property.name : undefined;
}

function allowedAmbient(name, node, parents, path) {
  const member = parents.get(node);
  const use = parents.get(member);
  const property = dotMember(node, member);
  if (path === cliEntry && name === 'process') {
    return stdioProcessMembers.has(property) || property === 'exitCode' &&
      use.type === 'AssignmentExpression' && use.left === member && use.operator === '=' && use.right.value === 2;
  }
  if (path === cliEntry && name === 'console') {
    return (property === 'log' || property === 'error') && use.type === 'CallExpression' && use.callee === member;
  }
  if (name === 'globalThis' && property === 'crypto') {
    const method = parents.get(use);
    if (path === contextReadTokens && dotMember(member, use) === 'randomUUID') {
      return method.type === 'CallExpression' && method.callee === use;
    }
    if (dotMember(member, use) !== 'subtle') return false;
    const call = parents.get(method);
    return webCryptoMembers.get(path)?.has(dotMember(use, method)) &&
      call.type === 'CallExpression' && call.callee === method;
  }
  return runtimeGlobals.has(name);
}

function computedString(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value;
  if (node.type === 'TemplateLiteral' && node.expressions.length === 0) return node.quasis[0].value.cooked;
  if (node.type !== 'BinaryExpression' || node.operator !== '+') return;
  const left = computedString(node.left), right = computedString(node.right);
  if (left !== undefined && right !== undefined) return left + right;
}

function auditCapabilities(ast, path, parents) {
  const scopes = new WeakMap(), declarations = new WeakSet();
  const unsupported = name => { throw new Error(`unsupported_core_local_capability: ${path}: ${name}`); };
  walk(ast, null, (node, parent) => {
    let outer = scopes.get(parent);
    if (parent?.type === 'SwitchStatement' && node === parent.discriminant) outer = outer.outer;
    let scope = outer;
    if (scopeTypes.has(node.type)) {
      const names = new Set();
      // Function body vars are invisible to parameter initializers.
      const varScope = node.type === 'Program' || node.type === 'StaticBlock' ||
        node.type === 'BlockStatement' && functionTypes.has(parent.type);
      scope = { outer, names, varNames: varScope ? names : outer.varNames };
    }
    scopes.set(node, scope);
    if (functionTypes.has(node.type)) {
      bind(node.id, node.type === 'FunctionDeclaration' ? outer.names : scope.names, declarations);
      for (const param of node.params) bind(param, scope.names, declarations);
    } else if (node.type === 'VariableDeclarator') {
      bind(node.id, parent.kind === 'var' ? scope.varNames : scope.names, declarations);
    } else if (node.type === 'ClassDeclaration' || node.type === 'ClassExpression') {
      bind(node.id, scope.names, declarations);
      if (node.type === 'ClassDeclaration') bind(node.id, outer.names, declarations);
    } else if (node.type === 'CatchClause') {
      bind(node.param, scope.names, declarations);
    } else if (node.type === 'ImportDeclaration') {
      for (const specifier of node.specifiers) bind(specifier.local, scope.names, declarations);
    }
  });
  walk(ast, null, (node, parent) => {
    if (node.type === 'MemberExpression' || node.type === 'Property' && parent.type === 'ObjectPattern') {
      const key = node.property ?? node.key;
      const name = node.computed ? computedString(key) : key.name ?? computedString(key);
      if (name === 'constructor' || name === '__proto__') unsupported(name);
    }
    if (!identifierReference(node, parent, parents, declarations)) return;
    for (let scope = scopes.get(node); scope; scope = scope.outer) {
      if (scope.names.has(node.name)) return;
    }
    if (!allowedAmbient(node.name, node, parents, path)) unsupported(node.name);
  });
}

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

function namedImport(node, name) {
  return node.type === 'ImportDeclaration' && node.specifiers.length === 1 &&
    node.specifiers[0].type === 'ImportSpecifier' && node.specifiers[0].imported.name === name;
}

function target(from, specifier, node) {
  if (specifier === 'node:sqlite') {
    if (from === adapterSlot) return;
    throw new Error(`sqlite_outside_core_local_adapter: ${from}`);
  }
  if (specifier === 'node:readline' && from === hostEntry && namedImport(node, 'createInterface')) return;
  if (typeof specifier !== 'string' || !/^\.\.?\/(?:[\w.-]+\/)*[\w.-]+\.mjs$/u.test(specifier)) {
    throw new Error(`unsupported_core_local_import: ${from}`);
  }
  const path = posix.join(posix.dirname(from), specifier);
  if (from.startsWith(coreSource)) {
    if (!path.startsWith(coreSource)) throw new Error(`core_import_escapes_package: ${from} -> ${path}`);
  } else if (!path.startsWith(coreSource) && !path.startsWith('packaging/core-local/')) {
    throw new Error(`core_local_import_escapes_runtime: ${from} -> ${path}`);
  }
  if (path === hostEntry && (from !== cliEntry || !namedImport(node, 'serveStdio'))) {
    throw new Error(`invalid_core_local_host_edge: ${from}`);
  }
  return path;
}

function imports(root, path) {
  const source = readFileSync(regularFile(root, path), 'utf8');
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  const composition = path === hostEntry ? ast.body
    .filter(node => node.type === 'ExportNamedDeclaration')
    .map(node => node.declaration)
    .find(node => node?.type === 'FunctionDeclaration' && node.async && !node.generator &&
      node.id.name === compositionEntry) : undefined;
  const edges = new Set();
  const parents = new WeakMap();
  walk(ast, null, (node, parent) => {
    parents.set(node, parent);
    if (node.type === 'MetaProperty' && node.meta.name === 'import' ||
        node.type === 'Identifier' && node.name === 'getBuiltinModule' ||
        node.type === 'Literal' && node.value === 'getBuiltinModule') {
      throw new Error(`unsupported_core_local_loader: ${path}`);
    }
    // The host cannot call or forward the composition entry. The CLI can
    // import only serveStdio, including through the rest of the closure.
    if (path === hostEntry && node.type === 'Identifier' && node.name === compositionEntry &&
        node !== composition?.id) {
      throw new Error(`eager_core_local_composition_reference: ${path}`);
    }
    const dynamic = node.type === 'ImportExpression';
    if (dynamic || ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type)) {
      if (node.source) {
        const next = target(path, node.source.type === 'Literal' ? node.source.value : undefined, node);
        if (next === adapterSlot) {
          let body = parent;
          while (body && body !== composition?.body) body = parents.get(body);
          if (!dynamic || !body) throw new Error(`invalid_core_local_adapter_edge: ${path}`);
        }
        if (next) edges.add(next);
      }
    }
  });
  if (path !== adapterSlot) auditCapabilities(ast, path, parents);
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
