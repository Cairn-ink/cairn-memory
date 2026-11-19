import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { parse } from '../../../tools/testing/vendor/acorn/acorn.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
function walk(node, visit, parent) {
  if (!node || typeof node.type !== 'string') return;
  visit(node, parent);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit, node);
    else if (value && typeof value === 'object') walk(value, visit, node);
  }
}
function packageFile(specifier, parent) {
  const parts = specifier.split('/'), name = parts.slice(0, specifier.startsWith('@') ? 2 : 1).join('/');
  const subpath = specifier.slice(name.length);
  for (let directory = dirname(parent);;) {
    const base = join(directory, 'node_modules', name), manifest = join(base, 'package.json');
    if (existsSync(manifest)) {
      const data = JSON.parse(readFileSync(manifest, 'utf8')); let target = data.exports;
      if (target && Object.keys(target).some(key => key.startsWith('.'))) target = target['.' + subpath];
      while (target && typeof target === 'object') target = target.node ?? target.import ?? target.default;
      return resolve(base, typeof target === 'string' ? target : subpath.slice(1) || data.module || data.main || 'index.js');
    }
    if (dirname(directory) === directory) assert.fail('source census cannot resolve dependency: ' + specifier);
    directory = dirname(directory);
  }
}
function closure(entry, external = false) {
  const sources = new Map();
  function visit(file) {
    if (sources.has(file) || !/\.[cm]?js$/.test(file)) return;
    const source = readFileSync(file, 'utf8'), ast = parse(source, { ecmaVersion: 2025, sourceType: 'module', allowReturnOutsideFunction: true });
    sources.set(file, { source, ast });
    walk(ast, node => {
      const edge = ['ImportDeclaration', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type) ? node.source : node.type === 'ImportExpression' ? node.source : undefined;
      if (!edge) return;
      if (edge.type !== 'Literal' || typeof edge.value !== 'string') {
        // Existing verified-pack loader has its own closed integrity fence. It
        // cannot be selected by any managed daemon vector (A7).
        assert.equal(relative(root, file), 'adapters/local-embedder/runtime.mjs', 'unreviewed computed import in daemon closure');
        return;
      }
      const specifier = edge.value;
      if (specifier.startsWith('node:')) return;
      if (specifier.startsWith('.')) visit(resolve(dirname(file), specifier));
      else if (external) visit(packageFile(specifier, file));
      else assert.fail('forwarder may import only Node core and small helpers: ' + specifier);
    });
  }
  visit(resolve(root, entry)); return sources;
}
test('protocol-two liveness is private and T has no environment or argv input', () => {
  const wire = readFileSync(resolve(root, 'adapters/mcp/local-daemon-wire.mjs'), 'utf8');
  const forwarder = readFileSync(resolve(root, 'adapters/mcp/local-forwarder.mjs'), 'utf8');
  const daemon = readFileSync(resolve(root, 'adapters/mcp/local-daemon.mjs'), 'utf8');
  assert.match(wire, /DAEMON_UNRESPONSIVE_MS = 30000, DAEMON_LIVENESS_MS = 5000/);
  assert.match(forwarder, /process\.hrtime\.bigint\(\)/);
  const filter = forwarder.indexOf('message.method === DAEMON_LIVENESS_METHOD');
  assert.ok(filter >= 0 && filter < forwarder.indexOf('return originalPush(bytes, encoding)'));
  assert.match(daemon, /socket\.write\(DAEMON_LIVENESS_FRAME\)/);
  assert.doesNotMatch(wire + forwarder + daemon, /Date\.now\(/);
});

test('support command closure never opens SQLite or loads MCP SDK or core', () => {
  const sources = closure('adapters/mcp/local-daemon-liveness.mjs');
  for (const [path, { source }] of sources) {
    assert.ok(!relative(root, path).startsWith('core/'));
    assert.doesNotMatch(source, /(?:node:sqlite|@modelcontextprotocol|openMemoryCore|openDatabase)/);
  }
});

test('only lifetime-holder paths publish stamp and descriptor targets across tracked production', t => {
  const files = execFileSync('git', ['ls-files', '-z', 'adapters', 'core', 'packaging', 'packages', 'integrations'], { cwd: root, encoding: 'utf8' })
    .split('\0').filter(path => /\.(?:mjs|js)$/.test(path) && !/(?:^|\/)(?:test|tests|fixtures)\/|\.(?:test|spec)\./.test(path));
  const violations = [];
  const property = node => node?.type === 'MemberExpression' ? node.computed ? node.property.value : node.property.name : undefined;
  for (const path of files) {
    const ast = parse(readFileSync(resolve(root, path), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module', allowReturnOutsideFunction: true });
    const parents = new WeakMap(), nodes = [], imports = new Map(), namespaces = new Map();
    walk(ast, (node, parent) => { parents.set(node, parent); nodes.push(node); });
    for (const node of nodes) if (node.type === 'ImportDeclaration') {
      for (const binding of node.specifiers) {
        if (binding.type === 'ImportSpecifier') imports.set(binding.local.name, [node.source.value, binding.imported.name]);
        else namespaces.set(binding.local.name, node.source.value);
      }
    }
    const imported = node => {
      if (node?.type === 'Identifier') return imports.get(node.name);
      if (node?.type === 'MemberExpression') {
        const source = namespaces.get(node.object.name);
        if (source) return [source, property(node)];
        if (property(node.object) === 'promises' && namespaces.has(node.object.object?.name)) return [namespaces.get(node.object.object.name), property(node)];
      }
    };
    const stateCall = (node, name) => { const value = imported(node?.callee); return node?.type === 'CallExpression' && value?.[0].endsWith('local-daemon-state.mjs') && value[1] === name; };
    const endpointObjects = new Set(), endpointTargets = new Set();
    const isObject = node => node?.type === 'Identifier' && endpointObjects.has(node.name) || stateCall(node, 'endpointPaths');
    const isTarget = node => node?.type === 'Identifier' && endpointTargets.has(node.name) || ['stamp', 'ready'].includes(property(node)) && isObject(node.object);
    // Follow ordinary aliases and destructuring to a fixed point, including
    // namespace endpointPaths calls. Computed/eval paths need human review.
    let changed = true;
    while (changed) {
      const count = endpointObjects.size + endpointTargets.size;
      for (const node of nodes) if (node.type === 'VariableDeclarator') {
        if (node.id.type === 'Identifier') {
          if (isObject(node.init)) endpointObjects.add(node.id.name);
          if (isTarget(node.init)) endpointTargets.add(node.id.name);
        } else if (node.id.type === 'ObjectPattern' && isObject(node.init)) {
          for (const value of node.id.properties) if (['stamp', 'ready'].includes(value.key?.name ?? value.key?.value)) endpointTargets.add(value.value.name);
        }
      }
      changed = count !== endpointObjects.size + endpointTargets.size;
    }
    const ancestors = node => { const values = []; for (let parent = parents.get(node); parent; parent = parents.get(parent)) values.push(parent); return values; };
    const inLifetime = node => ancestors(node).some(parent => parent.type === 'CallExpression' && parent.callee.name === 'withFileLock' &&
      property(parent.arguments[0]) === 'lock' && parent.arguments[0].object.name === 'paths' &&
      node.start >= parent.arguments[1].start && node.end <= parent.arguments[1].end);
    const holderFunctions = new Set(['serve', 'reapEndpoint', 'cleanupTemps']);
    for (const node of nodes) {
      if (node.type !== 'CallExpression') continue;
      if (path === 'adapters/mcp/local-daemon.mjs' && holderFunctions.has(node.callee.name)) {
        const inServe = ancestors(node).some(parent => parent.type === 'FunctionDeclaration' && parent.id.name === 'serve');
        assert.ok(inLifetime(node) || node.callee.name === 'cleanupTemps' && inServe, 'holder entry must remain inside lifetime: ' + node.callee.name);
      }
      const value = imported(node.callee);
      if (!value) continue;
      const [source, name] = value;
      const privateWriter = source.endsWith('local-daemon-state.mjs') && ['writePrivate', 'removePrivate'].includes(name) && isTarget(node.arguments[1]);
      const fsWriter = /^(?:node:)?fs(?:\/promises)?$/.test(source) &&
        ['writeFile','appendFile','write','rename','link','open','unlink','rm'].includes(name) && node.arguments.some(isTarget);
      if (!privateWriter && !fsWriter) continue;
      const insideHolder = path === 'adapters/mcp/local-daemon.mjs' && ancestors(node).some(parent => parent.type === 'FunctionDeclaration' && holderFunctions.has(parent.id.name));
      if (!insideHolder && !(path === 'adapters/mcp/local-daemon.mjs' && inLifetime(node))) violations.push(path + ':' + (readFileSync(resolve(root, path), 'utf8').slice(0, node.start).split('\n').length));
    }
  }
  assert.deepEqual(violations, [], 'endpoint writer outside lifetime holder');
  t.diagnostic('endpoint writer boundary scanned ' + files.length + ' tracked production modules');
});
