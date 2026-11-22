import assert from 'node:assert/strict';
import { readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { parse } from '../../../tools/testing/vendor/acorn/acorn.mjs';

const root = realpathSync(fileURLToPath(new URL('../src/', import.meta.url)));
const nodeGlobals = new Set(['Buffer', 'process', 'require', 'module', 'exports', 'global', '__dirname', '__filename']);

function* files(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) yield* files(path);
    else {
      assert.ok(entry.isFile(), `Expected a regular file under src: ${path}`);
      yield path;
    }
  }
}

function checkSpecifier(specifier, file) {
  assert.equal(typeof specifier, 'string', `Expected a literal module specifier in ${file}`);
  assert.match(specifier, /^\.\.?\//, `Only relative imports are portable: ${specifier} in ${file}`);
  const path = realpathSync(resolve(dirname(file), specifier));
  const fromRoot = relative(root, path);
  assert.ok(fromRoot !== '..' && !fromRoot.startsWith('..' + sep) && !isAbsolute(fromRoot),
    `Import leaves src: ${specifier} in ${file}`);
}

function checkSyntax(node, file) {
  if (!node || typeof node.type !== 'string') return;
  if (node.type === 'ImportDeclaration' || node.type === 'ExportNamedDeclaration' ||
      node.type === 'ExportAllDeclaration' || node.type === 'ImportExpression') {
    if (node.source) checkSpecifier(node.source.value, file);
  }
  if (node.type === 'Identifier') assert.ok(!nodeGlobals.has(node.name), `Node global ${node.name} in ${file}`);
  for (const child of Object.values(node)) {
    if (Array.isArray(child)) for (const entry of child) checkSyntax(entry, file);
    else if (typeof child === 'object') checkSyntax(child, file);
  }
}

test('all package sources are portable and dependency-free', () => {
  const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    assert.deepEqual(manifest[field] ?? {}, {}, `Unexpected ${field}`);
  }
  for (const file of files(root)) {
    const source = readFileSync(file, 'utf8');
    if (file.endsWith('.d.ts')) {
      const references = /\b(?:from\s*|(?:import|require)\s*\(?\s*)(['"])([^'"]+)\1|^\s*\/\/\/\s*<reference\s+(?:types|path)\s*=\s*(['"])([^'"]+)\3/gm;
      for (const match of source.matchAll(references)) checkSpecifier(match[2] ?? match[4], file);
    } else {
      checkSyntax(parse(source, { sourceType: 'module', ecmaVersion: 'latest' }), file);
    }
  }
});
