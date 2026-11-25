// Threat model: this static audit catches ACCIDENTAL capability use (SQLite, network,
// native, worker or child-process access) in first-party code reachable from the
// candidate's entry points. It is not a sandbox: code written to evade it on purpose,
// for example through reflection, is out of scope. The runtime check is the builder's
// installed startup smoke with SQLite disabled.
import { existsSync, lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { join, posix } from 'node:path';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';
import { adapterImports } from './adapter-imports.mjs';
import { sha256 } from './engine-id.mjs';

const coreRoot = 'packages/core';
const coreSource = coreRoot + '/src/';
const hostEntry = 'packaging/core-local/host.mjs';
const adapterSlot = 'packaging/core-local/adapter-slot.mjs';
const adapterSource = 'packages/adapter-sqlite/src/';
const adapterEntry = adapterSource + 'adapter.mjs';
const coreEntry = coreSource + 'index.mjs';
const continuations = 'packaging/core-local/continuations.mjs';
const wireTools = 'packaging/core-local/wire-tools.mjs';
const tokenizerRoot = 'packaging/core-local/vendor/tiktoken/';
const tokenizerEntry = tokenizerRoot + 'tiktoken.cjs';
const tokenizerLicense = 'licenses/tiktoken-LICENSE';
const tokenizerAssets = {
  'package.json': 'aa9ac5822add55718d3f6cff328c2b06e9226db770947575fd4e10868caad02d',
  'tiktoken.cjs': '0cd4b1d0482281f0afea13558f440af06b8cf329fdd83e3950c504c7684b5e31',
  'tiktoken_bg.cjs': '85b2bfcc1cab757b81b3ebfd200a188175c20ce9c9f7ccd340dfa479813d1205',
  'tiktoken_bg.wasm': 'dedd9a7b5d8d98b44448bedb371ade1c5327f7bb5dd9effe159da816473a415f',
};
const tokenizerLicenseDigest = '1432b164b5be63a7fe11b89a5b5ca87a26153d0db1d6855cd89ef27c728f433b';
const hostBuiltins = new Map([
  [hostEntry, { readline: 'createInterface' }],
  [adapterSlot, { crypto: 'createHash createHmac', perf_hooks: 'performance' }],
  [continuations, { crypto: 'randomBytes', perf_hooks: 'performance' }],
  [wireTools, { crypto: 'randomUUID' }],
]);
const fileGlobals = new Map([
  [continuations, new Set(['setTimeout', 'clearTimeout'])],
  ...['context-lexical.mjs', 'context-raw-read.mjs', 'context-read.mjs', 'context-read-state.mjs',
    'migrate/raw-privacy.mjs', 'procedural-tags.mjs', 'raw-lineage.mjs', 'uow.mjs'].map(path =>
    [adapterSource + path, new Set(['Boolean'])]),
]);
const adapterMembers = {
  'adapter.mjs': { performance: ['now'] },
  'context-lexical.mjs': { Buffer: ['from'] },
  'context-raw-read.mjs': { Buffer: ['concat', 'from'] },
  'memories.mjs': { Buffer: ['from'] },
  'migrate/raw-privacy.mjs': { Buffer: ['from'] },
  'placement-input.mjs': { Symbol: ['iterator'] },
  'port-scope.mjs': { Symbol: ['dispose', 'iterator'] },
  'raw-lineage.mjs': { Buffer: ['from'] },
  'raw-read.mjs': { Buffer: ['from'] },
  'retrieval-snapshot.mjs': { Buffer: ['from'] },
  'retrieval.mjs': { Buffer: ['from'] },
  'suppressions.mjs': { Buffer: ['from'] },
};
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
  return runtimeGlobals.has(name) || fileGlobals.get(path)?.has(name) ||
    path.startsWith(adapterSource) && adapterMembers[path.slice(adapterSource.length)]?.[name]?.includes(property);
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

function approvedNames(node, names) {
  return typeof names === 'string' && node.type === 'ImportDeclaration' && node.specifiers.length > 0 &&
    node.specifiers.every(part => part.type === 'ImportSpecifier' && names.split(' ').includes(part.imported.name));
}

function adapterApproval(from) {
  return from.startsWith(adapterSource) ? adapterImports[from.slice(adapterSource.length)] : undefined;
}

function adapterCoreSpecifier(from) {
  return posix.relative(posix.dirname(from), coreEntry);
}

function target(from, specifier, node) {
  const approved = adapterApproval(from);
  if (specifier === 'node:sqlite') {
    if (approvedNames(node, approved?.sqlite) || from === adapterSlot && node.type === 'ExportNamedDeclaration' &&
        node.specifiers.length === 1 && node.specifiers[0].local.name === 'DatabaseSync') return;
    throw new Error(`sqlite_outside_core_local_adapter: ${from}`);
  }
  if (typeof specifier === 'string' && specifier.startsWith('node:') &&
      approvedNames(node, (hostBuiltins.get(from) ?? approved)?.[specifier.slice(5)])) return;
  if (approvedNames(node, approved?.core) &&
      (specifier === '@cairn-ink/core' || specifier === adapterCoreSpecifier(from))) return coreEntry;
  if (from === adapterSlot && specifier === './vendor/tiktoken/tiktoken.cjs' &&
      node.type === 'ImportDeclaration' && node.specifiers.length === 1 &&
      node.specifiers[0].type === 'ImportDefaultSpecifier') return tokenizerEntry;
  if (typeof specifier !== 'string' || !/^\.\.?\/(?:[\w.-]+\/)*[\w.-]+\.mjs$/u.test(specifier)) {
    throw new Error(`unsupported_core_local_import: ${from}`);
  }
  const path = posix.join(posix.dirname(from), specifier);
  if (from.startsWith(coreSource)) {
    if (!path.startsWith(coreSource)) throw new Error(`core_import_escapes_package: ${from} -> ${path}`);
  } else if (from.startsWith(adapterSource) || path.startsWith(adapterSource)) {
    if (!(from.startsWith(adapterSource) && path.startsWith(adapterSource)) &&
        !(from === adapterSlot && path === adapterEntry && namedImport(node, 'openSqliteAdapter'))) {
      throw new Error(`invalid_core_local_sqlite_edge: ${from} -> ${path}`);
    }
  } else if (!path.startsWith(coreSource) && !path.startsWith('packaging/core-local/')) {
    throw new Error(`core_local_import_escapes_runtime: ${from} -> ${path}`);
  }
  if (path === hostEntry && (from !== cliEntry || !namedImport(node, 'serveStdio'))) {
    throw new Error(`invalid_core_local_host_edge: ${from}`);
  }
  return path;
}

// Only the immediate awaited call in the guarded stdio request branch may
// refer to the opener. Alias, wrapper and module-scope references still fail.
function dispatchedCall(node, parents) {
  const call = parents.get(node);
  if (call.type !== 'CallExpression' || call.callee !== node || parents.get(call).type !== 'AwaitExpression') return false;
  let current = call, guard, inCall;
  for (let parent = parents.get(current); parent; current = parent, parent = parents.get(current)) {
    if (parent.type === 'IfStatement' && current === parent.consequent) {
      const test = parent.test;
      if (test.type === 'LogicalExpression' && test.operator === '&&' && test.left.name === 'scope' &&
          test.right.type === 'UnaryExpression' && test.right.operator === '!' && test.right.argument.name === 'error') guard = true;
    }
    if (parent.type === 'SwitchCase' && parent.test?.value === 'tools/call') {
      inCall = parents.get(parent).discriminant?.object?.name === 'request' &&
        dotMember(parents.get(parent).discriminant.object, parents.get(parent).discriminant) === 'method';
    }
    if (functionTypes.has(parent.type)) {
      return guard && inCall && parent.type === 'FunctionDeclaration' && parent.id.name === 'serveStdio' &&
        parents.get(parent)?.type === 'ExportNamedDeclaration' && parents.get(parents.get(parent))?.type === 'Program';
    }
  }
  return false;
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
    if (path === hostEntry && node.type === 'Identifier' && node.name === compositionEntry &&
        node !== composition?.id && !dispatchedCall(node, parents)) {
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
  auditCapabilities(ast, path, parents);
  return edges;
}

export function candidateSourcePath(path) {
  return path === tokenizerLicense ? 'packaging/core-local/' + path : path;
}

export function candidateFileBytes(path, bytes) {
  if (!adapterApproval(path)?.core) return bytes;
  let source = bytes.toString('utf8');
  const tree = parse(source, { ecmaVersion: 'latest', sourceType: 'module' });
  for (const node of tree.body.toReversed()) {
    if (node.source?.value === '@cairn-ink/core' && approvedNames(node, adapterApproval(path).core)) {
      source = source.slice(0, node.source.start) + JSON.stringify(adapterCoreSpecifier(path)) + source.slice(node.source.end);
    }
  }
  return source;
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

export function deriveRuntimeGraph(root, { checkStartup } = {}) {
  root = realpathSync(root);
  const { exports } = coreRuntimeManifest(root);
  const coreEntries = Object.values(exports).map(({ default: entry }) => posix.join(coreRoot, entry));
  // Audit unbundled core modules too. Only modules reachable from the runtime
  // entry points contribute to the archive.
  const graph = new Map();
  for (const path of coreModules(root)) graph.set(path, imports(root, path));
  const edges = path => {
    if (!graph.has(path)) graph.set(path, imports(root, path));
    return graph.get(path);
  };
  const startup = new Set();
  const eager = [cliEntry, ...coreEntries];
  let deferred = false;
  while (eager.length) {
    const path = eager.pop();
    if (startup.has(path)) continue;
    if (path.startsWith(adapterSource) || path === tokenizerEntry || path === adapterSlot) {
      throw new Error(`eager_core_local_runtime_edge: ${path}`);
    }
    startup.add(path);
    for (const next of edges(path)) {
      if (path === hostEntry && next === adapterSlot) deferred = true;
      else eager.push(next);
    }
  }
  if (!deferred) throw new Error('core_local_adapter_slot_missing');
  checkStartup?.([...startup, adapterSlot].sort());

  const required = new Set(startup);
  const pending = [adapterSlot];
  while (pending.length) {
    const path = pending.pop();
    if (required.has(path)) continue;
    required.add(path);
    if (path === tokenizerEntry) {
      for (const [name, digest] of Object.entries(tokenizerAssets)) {
        const file = tokenizerRoot + name;
        if (sha256(readFileSync(regularFile(root, file))) !== digest) throw new Error(`unverified_core_local_tokenizer: ${file}`);
        required.add(file);
      }
      const license = existsSync(join(root, tokenizerLicense)) ? tokenizerLicense : candidateSourcePath(tokenizerLicense);
      if (sha256(readFileSync(regularFile(root, license))) !== tokenizerLicenseDigest) {
        throw new Error('unverified_core_local_tokenizer_license');
      }
      required.add(tokenizerLicense);
      continue;
    }
    pending.push(...edges(path));
  }
  return [...required].sort();
}
