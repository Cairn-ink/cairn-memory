import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, posix } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';
import { candidateSourcePath, cliEntry, deriveRuntimeGraph } from '../core-local/import-graph.mjs';

const repo = fileURLToPath(new URL('../../', import.meta.url));
const raw = 'packaging/core-local/raw-cli.mjs';
const entry = 'packaging/core-local/daemon-entry.mjs';
const roots = ['packaging/core-local/host.mjs', entry, 'packaging/core-local/daemon-worker.mjs'];

function moduleEdges(path) {
  const tree = parse(readFileSync(join(repo, path), 'utf8'), { ecmaVersion: 'latest', sourceType: 'module' });
  const edges = [];
  function visit(node) {
    if (!node || typeof node !== 'object') return;
    const importEdge = ['ImportDeclaration', 'ImportExpression', 'ExportNamedDeclaration', 'ExportAllDeclaration'].includes(node.type);
    const moduleURL = node.type === 'NewExpression' && node.callee.name === 'URL' &&
      node.arguments[1]?.object?.type === 'MetaProperty' && node.arguments[1].property?.name === 'url';
    const target = importEdge ? node.source?.value : moduleURL ? node.arguments[0]?.value : undefined;
    if (typeof target === 'string' && target.startsWith('.') && target.endsWith('.mjs')) {
      edges.push(posix.join(posix.dirname(path), target));
    }
    if (target === '@cairn-ink/core') edges.push('packages/core/src/index.mjs');
    for (const child of Object.values(node)) {
      if (Array.isArray(child)) child.forEach(visit);
      else visit(child);
    }
  }
  visit(tree);
  return edges;
}

test('MCP host, entry and worker closures cannot load the Raw CLI', () => {
  assert.ok(moduleEdges(cliEntry).includes(raw));
  for (const root of roots) {
    const seen = new Set();
    const remaining = [root];
    while (remaining.length) {
      const name = remaining.pop();
      if (seen.has(name)) continue;
      assert.notEqual(name, raw, root);
      seen.add(name);
      remaining.push(...moduleEdges(name));
    }
  }
});

test('the packaging audit rejects the former dynamic daemon-to-Raw edge', t => {
  const { path } = createTestWorkspace(t);
  const files = deriveRuntimeGraph(repo, { includeCapture: true, includeDaemon: true });
  for (const name of [...files, 'packages/core/package.json']) {
    const file = candidateSourcePath(name);
    const destination = join(path, file);
    mkdirSync(dirname(destination), { recursive: true });
    copyFileSync(join(repo, file), destination);
  }
  const options = { includeCapture: true, includeDaemon: true };
  assert.deepEqual(deriveRuntimeGraph(path, options), files);
  const candidate = join(path, entry);
  writeFileSync(candidate, readFileSync(candidate, 'utf8') + "\nexport const wrong = () => import('./raw-cli.mjs');\n");
  assert.throws(() => deriveRuntimeGraph(path, options), {
    message: `invalid_core_local_daemon_edge: ${entry} -> ${raw}`,
  });
});
