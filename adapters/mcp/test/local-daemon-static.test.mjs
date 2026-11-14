import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../../../tools/testing/vendor/acorn/acorn.mjs';
import { IDENTITY_ENV } from '../local-daemon-identity.mjs';

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
test('forwarder closure is exactly Node core plus identity state and wire', () => {
  const sources = closure('adapters/mcp/local-forwarder.mjs');
  assert.deepEqual([...sources.keys()].map(file => relative(root, file)).sort(), [
    'adapters/mcp/local-daemon-identity.mjs', 'adapters/mcp/local-daemon-state.mjs',
    'adapters/mcp/local-daemon-wire.mjs', 'adapters/mcp/local-forwarder.mjs',
  ], 'forwarder import closure must exclude server SDK core stateLock and pairing');
});
test('A8 every environment read in daemon closure is pinned to identity allowlist', t => {
  const sources = closure('adapters/mcp/local-daemon.mjs', true), reads = [];
  const property = node => node?.type === 'MemberExpression' ? node.computed ? node.property.type === 'Literal' ? node.property.value : undefined : node.property.name : undefined;
  const processEnv = node => property(node) === 'env' && node.object.name === 'process';
  for (const [file, { source, ast }] of sources) walk(ast, (node, parent) => {
    if (node.type === 'VariableDeclarator' && node.init?.name === 'process') assert.fail('A8 unreviewed process alias or destructuring: ' + relative(root, file));
    if (node.type === 'ImportDeclaration' && ['node:process', 'process'].includes(node.source.value))
      assert.ok(node.specifiers.every(binding => binding.type === 'ImportDefaultSpecifier' && binding.local.name === 'process'), 'A8 unreviewed process namespace import: ' + relative(root, file));
    if (node.type !== 'MemberExpression') return;
    if (processEnv(node) && parent?.type === 'MemberExpression' && parent.object === node) return;
    if (processEnv(node) || processEnv(node.object) || node.object?.name === 'env' && /^[A-Z_]+$/.test(property(node) ?? ''))
      reads.push([relative(root, file), source.slice(node.start, node.end)]);
  });
  const expected = [
    ['adapters/mcp/local-daemon-identity.mjs', 'process.env'],
    ['adapters/mcp/context-read-provider.mjs', 'process.env'],
    ['adapters/mcp/context-read-provider.mjs', 'process.env'],
    ['adapters/mcp/context-read-provider.mjs', 'env.OPENAI_API_KEY'],
    ['adapters/local-embedder/process.mjs', 'process.env[key]'],
    ['adapters/local-embedder/process.mjs', 'process.env[key]'],
  ];
  const ordered = values => values.map(value => JSON.stringify(value)).sort();
  assert.deepEqual(ordered(reads), ordered(expected), 'A8 environment-read census must remain closed');
  for (const name of ['OPENAI_API_KEY', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR']) assert.ok(IDENTITY_ENV.includes(name), 'every consumed environment name must join identity');
  const embedder = sources.get(resolve(root, 'adapters/local-embedder/process.mjs')).source;
  assert.match(embedder, /for \(const key of \['SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'TMPDIR'\]\)/, 'computed environment reads must use exact reviewed list');
  t.diagnostic('A8 static closure modules ' + sources.size + '; pinned environment reads ' + reads.length);
});
test('blocking process-boundary guards remain explicit and ordered', () => {
  const source = file => readFileSync(resolve(root, 'adapters/mcp', file), 'utf8');
  const daemon = source('local-daemon.mjs'), forwarder = source('local-forwarder.mjs');
  assert.match(daemon, /return withFileLock\(paths\.lock, async \(\) =>/, 'candidate must hold lifetime lock around serving');
  assert.match(daemon, /return withFileLock\(path, async \(\) =>/, 'store creation must hold parent and basename lock');
  assert.ok(daemon.indexOf('return withFileLock(paths.lock') < daemon.indexOf("await import('./local-shared-runtime.mjs')"), 'heavy imports must follow candidate lifetime lock');
  assert.match(daemon, /while \(host\?\.inspect\(\)\.inFlight\)/, 'SIGTERM must drain in-flight work before runtime close');
  const draining = daemon.indexOf('draining = true; clearTimeout(idle)');
  assert.ok(draining >= 0 && draining < daemon.indexOf('server.close(); // Stop admissions'), 'drain state must precede listener close');
  assert.match(daemon, /sockets\.size >= 64/, 'handshake capacity must be bounded');
  assert.match(daemon, /queued\(\) > 16 \* 1048576/, 'aggregate queue must be bounded');
  assert.match(daemon, /startAwareAlive\(old\.owner, live\)/, 'stale endpoints must prove old incarnation dead');
  assert.match(daemon, /current\.incarnation !== old\.incarnation/, 'reap must recheck exact incarnation');
  assert.match(daemon, /String\(socket\.ino\) !== old\.socket\.ino/, 'reap must pin stale socket inode');
  assert.match(daemon, /isAlive: \(_pid, owner\) => startAwareAlive\(owner, live\)/, 'lifetime lock must compare process start time');
  const wire = source('local-daemon-wire.mjs');
  assert.match(wire, /canonical\(hello\.identity\) !== canonical\(descriptor\.identity\)/, 'server must independently compare full identity');
  assert.match(wire, /hello\.incarnation !== descriptor\.incarnation/, 'server must independently compare incarnation');
  assert.match(wire, /hello\.protocol !== DAEMON_PROTOCOL/, 'server must independently compare protocol');
  const state = source('local-daemon-state.mjs');
  assert.equal([...state.matchAll(/constants\.O_NOFOLLOW/g)].length, 2, 'private metadata reads and writes must refuse symlinks at open');
  assert.match(state, /after\.dev !== before\.dev \|\| after\.ino !== before\.ino/, 'private metadata read must pin opened inode');
  assert.match(forwarder, /detached: true, shell: false/, 'candidate must have separate process group and no shell');
  assert.match(forwarder, /Math\.min\(options\.connectMs \?\? 10000, 10000\)/, 'connect and start must have ten second outer bound');
  assert.match(forwarder, /delete launchEnvironment\.OPENAI_API_KEY/, 'credentials must use private bootstrap channel only');
  assert.match(forwarder, /input\.destroy\(\); output\.end\(\)/, 'fatal transport must terminate stdio and release pipe handles');
  assert.doesNotMatch(forwarder, /import\s*\([^)]*(?:server|cli|shared-runtime)/, 'daemon failures must never load full server fallback');
});
