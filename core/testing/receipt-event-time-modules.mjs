// Scope: this gate covers an honest engineer who accidentally reads the
// event-time feature flag in another S2h path. Deliberately obtaining it by
// reflection or constructed access is out of scope and is caught in code
// review, the same as for any other module-private state.

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';

// Acorn is vendored for this test-only audit; no installed package, regex lexer,
// or Node private API determines which executable expressions we can see.
const frozenExceptions = JSON.parse(readFileSync(new URL('../test/fixtures/receipt-event-time-loaders.json', import.meta.url), 'utf8'));
// Preserve PR 1's frozen fixture. Main 8cdb5e49 adds Worker failure disposal
// after index.run and in its catch; neither hunk changes a loader or feature
// consumer. Pin the complete merged source, retaining the original pin too.
// This package's three hunks extend the maintenance method allowlist and
// deadline handling and pass a private admission diagnostic through. They
// change no loader or feature consumer. The private sidecar-handle registry
// adds an identity-ack field and passes it to storage; loaders stay unchanged.
const exceptions = frozenExceptions.map(entry => {
  // The journal-mode probe checks the opening deadline before preparing and
  // executing its statement. This hunk adds no loader and no feature consumer.
  if (entry.file === 'core/topic-reader-sqlite.mjs') {
    assert.equal(entry.sha256, '78547baf2b9eea0572ad69e8be2ef0bb2e8dcc8314aa4e58fc0b4dda87ce679f',
      'frozen journal-mode probe loader pin');
    return { ...entry, sha256: 'b284cf9ae1e2a307639e362940d59a08e238219342190a3701aae7f7c17fe51c' };
  }
  // Opening-deadline checks run before SQLite configuration and journal-mode
  // statements. These hunks add no loader and no feature consumer.
  if (entry.file === 'core/context-product-sqlite.mjs') {
    assert.equal(entry.sha256, '03d69f0bdb2e5e8acd1b6e08e566d3333bfbc9e22fdfac97514aa8023618c207',
      'frozen SQLite policy loader pin');
    return { ...entry, sha256: 'e5c700237258e5e077c03aa49a7ba509f805cfdf0df4dba29a1265ec21b515c1' };
  }
  // Parent handle reservation, target preparation and close/exit cleanup keep
  // the host loader and synchronous transmission/final validation unchanged.
  // Keep the frozen PR 1 pin, then bind the complete integrated Worker bytes.
  if (entry.file === 'core/context-semantic-worker.mjs') {
    assert.equal(entry.sha256, 'ef2961fcb0114b9d9062084d57babea2adfad4d0753619c500728ca657da5fa5',
      'frozen semantic Worker loader pin');
    return { ...entry, line: 502, sha256: '184156b8181e5e9efabc107045fb7d50f52058b58a010570f487dd7ce36949fe' };
  }
  if (entry.file !== 'core/context-product-worker.mjs') return entry;
  assert.equal(entry.sha256, '073071759a46698824ffd029a5fe48fbd737513c5c6936ba826b5d413be32bbe',
    'frozen pre-rebase Worker loader pin');
  // Passing the optional maintenance phase adds no loader or feature consumer.
  return { ...entry, line: 120, sha256: '4e3c5ed3d23b8b102e0baa6bd270ac63df6a383dd3f072760f56cac75ff3b242' };
});
export const moduleLoadingExceptions = exceptions;
const cache = new Map();
const hash = source => createHash('sha256').update(source).digest('hex');
const string = node => node?.type === 'Literal' && typeof node.value === 'string' ? node.value : undefined;
const member = node => node?.type === 'MemberExpression' ? (node.computed ? string(node.property) : node.property.name) : undefined;
const restricted = new Set(['require', 'createRequire', 'eval', 'Function', 'AsyncFunction', 'GeneratorFunction', 'AsyncGeneratorFunction']);
const moduleBuiltins = new Set(['module', 'node:module', 'vm', 'node:vm']);

function walk(node, visit, parent) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc') continue;
    if (Array.isArray(value)) for (const child of value) walk(child, visit, node);
    else if (value && typeof value === 'object') walk(value, visit, node);
  }
}

export function moduleEdges(file, source) {
  const prior = cache.get(file);
  if (prior?.source === source) return prior.edges;
  const exception = exceptions.find(entry => entry.file === file);
  // An exemption never covers arbitrary future code in the same module.
  if (exception) assert.equal(hash(source), exception.sha256, 'review module-loading exception: ' + file);
  const reviewed = exception !== undefined;
  let ast;
  try { ast = parse(source, { ecmaVersion: 2025, sourceType: 'module', locations: true, allowReturnOutsideFunction: true }); }
  catch (error) { assert.fail(`unsupported production syntax: ${file}:${error.loc?.line}: ${error.message}`); }
  // Symbol-keyed process registries are data, not an escape to eval/Function.
  // Track direct ambient aliases; forbid arbitrary computed global lookups and escapes.
  const parents = new WeakMap(), symbols = new WeakMap();
  walk(ast, (node, parent) => parents.set(node, parent));
  const scopeOf = node => {
    while (node && !['Program', 'BlockStatement', 'FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression', 'CatchClause', 'ForStatement', 'ForOfStatement', 'ForInStatement'].includes(node.type)) node = parents.get(node);
    return node;
  };
  const bind = (pattern, scope, kind = 'data') => {
    if (!pattern) return;
    if (pattern.type === 'Identifier') {
      if (!symbols.has(scope)) symbols.set(scope, new Map());
      const names = symbols.get(scope);
      names.set(pattern.name, names.has(pattern.name) ? 'data' : kind);
    } else if (pattern.type === 'RestElement') bind(pattern.argument, scope);
    else if (pattern.type === 'AssignmentPattern') bind(pattern.left, scope);
    else if (pattern.type === 'ArrayPattern') for (const value of pattern.elements) bind(value, scope);
    else if (pattern.type === 'ObjectPattern') for (const property of pattern.properties) bind(property.value ?? property.argument, scope);
  };
  const symbolCall = node => node?.type === 'CallExpression' && member(node.callee) === 'for' &&
    node.callee.object.name === 'Symbol' && node.arguments.length === 1 && string(node.arguments[0]) !== undefined;
  walk(ast, (node, parent) => {
    if (node.type === 'VariableDeclarator') bind(node.id, scopeOf(parent), parent.kind === 'const' && symbolCall(node.init) ? 'symbol' : ['FunctionExpression', 'ArrowFunctionExpression', 'ClassExpression'].includes(node.init?.type) ? 'callable' : 'data');
    if (['FunctionDeclaration', 'FunctionExpression', 'ArrowFunctionExpression'].includes(node.type)) {
      for (const parameter of node.params) bind(parameter, node);
      if (node.id) bind(node.id, node.type === 'FunctionDeclaration' ? scopeOf(parent) : node, 'callable');
    }
    if (node.type === 'CatchClause') bind(node.param, node);
    if (node.type === 'ClassDeclaration') bind(node.id, scopeOf(parent), 'callable');
  });
  const bindingKind = (node, name) => {
    while (node) {
      const names = symbols.get(node);
      if (names?.has(name)) return names.get(name);
      node = parents.get(node);
    }
    return false;
  };
  const isBound = (node, name) => {
    while (node) {
      if (symbols.get(node)?.has(name)) return true;
      node = parents.get(node);
    }
    return false;
  };
  const workers = new Set();
  walk(ast, node => {
    if (node.type === 'ImportDeclaration' && ['worker_threads', 'node:worker_threads'].includes(string(node.source))) {
      for (const binding of node.specifiers) if (binding.imported?.name === 'Worker') workers.add(binding.local.name);
    }
  });
  const ambient = new Map([['process', 'process'], ['globalThis', 'global'], ['global', 'global']]);
  let changed;
  do {
    changed = false;
    walk(ast, node => {
      const id = node.type === 'VariableDeclarator' ? node.id : node.type === 'AssignmentPattern' ? node.left : undefined;
      const value = node.type === 'VariableDeclarator' ? node.init : node.type === 'AssignmentPattern' ? node.right : undefined;
      if (id?.type === 'Identifier' && value?.type === 'Identifier' && ambient.has(value.name) && !ambient.has(id.name)) {
        ambient.set(id.name, ambient.get(value.name));
        changed = true;
      }
    });
  } while (changed);
  const edges = [];
  const reject = (node, why) => assert.fail(`unreviewed module loading: ${file}:${node.loc.start.line}: ${why}`);
  const edge = (node, argument, kind) => {
    const path = string(argument);
    if (path === undefined) {
      if (!reviewed) reject(node, 'expected one string literal path');
      return;
    }
    // A string containing executable source, a URL or an absolute path cannot
    // stand in for a repository edge or an explicitly named external package.
    if (!path || /[\\%?#\0]/.test(path) || /^(?:[./]?\/|[a-z]+:)/i.test(path) && !path.startsWith('./') && !path.startsWith('../') && !path.startsWith('node:')) {
      reject(node, 'unsupported module path');
    }
    if (moduleBuiltins.has(path) && !reviewed) reject(node, 'module/vm loader capability');
    if (['worker_threads', 'node:worker_threads'].includes(path) && !(kind === 'import' &&
      node.specifiers.every(binding => binding.type === 'ImportSpecifier'))) reject(node, 'Worker namespace capability');
    if (['process', 'node:process'].includes(path) && !(kind === 'import' && node.specifiers.every(binding =>
      binding.type === 'ImportSpecifier' && binding.imported.name === 'hrtime'))) reject(node, 'process loader capability');
    edges.push({ path, kind, node });
  };
  walk(ast, (node, parent) => {
    if (node.type === 'ImportDeclaration') edge(node, node.source, 'import');
    if ((node.type === 'ExportNamedDeclaration' || node.type === 'ExportAllDeclaration') && node.source) edge(node, node.source, 'export');
    if (node.type === 'ImportExpression') edge(node, node.source, 'dynamic');
    if (node.type === 'CallExpression' && node.callee.type === 'Identifier' && node.callee.name === 'require') {
      if (node.arguments.length !== 1) reject(node, 'require arguments');
      edge(node, node.arguments[0], 'require');
    }
    if (node.type === 'Identifier' && workers.has(node.name) && parent?.type !== 'ImportSpecifier' &&
        !(parent?.type === 'NewExpression' && parent.callee === node)) reject(node, 'Worker loader alias');
    if (node.type === 'Identifier' && node.name === 'module' && !reviewed && !isBound(node, 'module')) reject(node, 'CommonJS module capability');
    if (node.type === 'Identifier' && restricted.has(node.name) && !reviewed) {
      // A bare require may only occur as this exact call's callee. Aliasing,
      // destructuring, .call/.bind and computed loader properties fail closed.
      const directRequire = node.name === 'require' && parent?.type === 'CallExpression' && parent.callee === node;
      if (!directRequire) reject(node, 'loader/code-construction capability ' + node.name);
    }
    if (node.type === 'Identifier' && ambient.has(node.name) && !reviewed) {
      const allowed = parent?.type === 'MemberExpression' && (parent.object === node || !parent.computed && parent.property === node) ||
        parent?.type === 'VariableDeclarator' && parent.id.type === 'Identifier' ||
        parent?.type === 'AssignmentPattern' && parent.left.type === 'Identifier' ||
        parent?.type === 'Property' && !parent.computed && parent.key === node;
      if (!allowed) reject(node, 'ambient loader escape');
    }
    if (node.type === 'MemberExpression' && !reviewed) {
      const name = member(node);
      if (ambient.get(node.object.name) === 'global') {
        const key = node.property;
        const symbol = node.computed && (key.type === 'Identifier' && bindingKind(node, key.name) === 'symbol' ||
          symbolCall(key));
        if (!symbol && (node.computed || !['fetch', 'Float16Array'].includes(name))) reject(node, 'ambient code-construction capability');
      }
      if (restricted.has(name) || ['mainModule', 'getBuiltinModule', '_load', '_compile', '_linkedBinding', 'dlopen'].includes(name)) reject(node, 'indirect loader capability');
      if (name === 'constructor') {
        // A comparison consumes class identity; an in-memory SQLite probe
        // supplies a database name, never a program. Other constructor values
        // are code-construction capabilities and need a whole-module pin.
        const container = parent?.type === 'ChainExpression' ? parent : node;
        const operation = parent?.type === 'ChainExpression' ? parents.get(parent) : parent;
        const comparison = operation?.type === 'BinaryExpression' && ['===', '!=='].includes(operation.operator) &&
          (operation.left === container ? operation.right : operation.left).name === 'Error';
        const memoryProbe = node.object.type === 'Identifier' && node.object.name === 'db' &&
          parent?.type === 'NewExpression' && parent.callee === node && parent.arguments.length === 1 && string(parent.arguments[0]) === ':memory:';
        if (!comparison && !memoryProbe) reject(node, 'constructor code-construction capability');
      }
      if (node.computed && string(node.property) === undefined &&
          (['FunctionExpression', 'ArrowFunctionExpression', 'ClassExpression'].includes(node.object.type) || bindingKind(node, node.object.name) === 'callable')) reject(node, 'computed callable capability');
      if (node.object.type === 'Identifier' && ambient.get(node.object.name) === 'process' && (node.computed || name === 'binding')) reject(node, 'computed process capability');
    }
    if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && node.callee.name === 'URL' && /\.(?:mjs|js|cjs)$/.test(string(node.arguments[0]) ?? '')) edge(node, node.arguments[0], 'url');
    if (node.type === 'NewExpression' && node.callee.type === 'Identifier' && (workers.has(node.callee.name) || node.callee.name === 'Worker')) {
      const argument = node.arguments[0];
      if (argument?.type !== 'NewExpression' || argument.callee.name !== 'URL' || argument.arguments.length !== 2 ||
          argument.arguments[1].type !== 'MemberExpression' || member(argument.arguments[1]) !== 'url' || argument.arguments[1].object.type !== 'MetaProperty') reject(node, 'unsupported Worker path');
      edge(node, argument.arguments[0], 'worker');
    }
  });
  cache.set(file, { source, edges });
  return edges;
}
