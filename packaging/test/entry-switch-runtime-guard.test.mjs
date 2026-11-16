import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir, lstat, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { parse } from '../../tools/testing/vendor/acorn/acorn.mjs';
import * as runtime from './fixtures/installed-daemon-runtime.mjs';

function walk(node, visit) {
  if (!node || typeof node.type !== 'string') return;
  visit(node);
  for (const value of Object.values(node)) {
    if (Array.isArray(value)) for (const child of value) walk(child, visit);
    else if (value?.type) walk(value, visit);
  }
}
const property = node => node?.type === 'MemberExpression' ? node.computed ? node.property.value : node.property.name : undefined;
const mutations = new Set(['rm', 'unlink', 'rename', 'writeFile', 'rmSync', 'unlinkSync', 'renameSync', 'writeFileSync']);

// Conservative syntactic dataflow, deliberately independent of the helper's
// implementation. Track directory.path, aliases, and derived path variables;
// inspect every fixture, including function bodies used in generated children.
// This is not general interprocedural analysis: reflective calls, arbitrary
// string construction and paths passed through unknown functions need review.
function unguardedMutations(source, { helper = false } = {}) {
  const ast = parse(source, { ecmaVersion: 'latest', sourceType: 'module', locations: true });
  const nodes = [], aliases = new Map(), tainted = new Set(), directories = new Set(['dir', 'directory']);
  walk(ast, node => nodes.push(node));
  // Exempt exactly the shared helper body, never the rest of its module.
  const guarded = helper ? nodes.find(node => node.type === 'FunctionDeclaration' && node.id.name === 'ownedRuntimeFiles') : undefined;
  const outside = nodes.filter(node => !guarded || node.start < guarded.start || node.end > guarded.end);
  for (const node of outside) {
    if (node.type === 'ImportDeclaration' && /^(?:node:)?fs(?:\/promises)?$/.test(node.source.value))
      for (const specifier of node.specifiers) if (specifier.type === 'ImportSpecifier') aliases.set(specifier.local.name, specifier.imported.name);
  }
  const method = node => node?.type === 'Identifier' ? aliases.get(node.name) ?? node.name : property(node);
  function runtimePath(node) {
    if (!node) return false;
    if (node.type === 'Identifier') return tainted.has(node.name);
    if (node.type === 'MemberExpression') return property(node) === 'path' &&
      (directories.has(node.object.name) || property(node.object) === 'directory') || runtimePath(node.object);
    // Only path builders return paths. A readFile(runtimePath) result is data;
    // dirname(runtime-directory) is the scheduling lease's parent directory.
    if (node.type === 'CallExpression') return ['join', 'resolve', 'normalize'].includes(method(node.callee)) && node.arguments.some(runtimePath);
    if (node.type === 'BinaryExpression') return runtimePath(node.left) || runtimePath(node.right);
    if (node.type === 'TemplateLiteral') return node.expressions.some(runtimePath);
    return false;
  }
  let changed;
  do {
    changed = false;
    for (const node of outside) {
      const binding = node.type === 'VariableDeclarator' ? node.id : node.type === 'AssignmentExpression' ? node.left : undefined;
      const value = node.type === 'VariableDeclarator' ? node.init : node.right;
      if (binding?.type !== 'Identifier') continue;
      if (runtimePath(value) && !tainted.has(binding.name)) { tainted.add(binding.name); changed = true; }
      const expression = value?.type === 'AwaitExpression' ? value.argument : value;
      if ((expression?.type === 'CallExpression' && method(expression.callee) === 'runtimeDirectory' ||
        expression?.type === 'Identifier' && directories.has(expression.name)) && !directories.has(binding.name)) {
        directories.add(binding.name); changed = true;
      }
      const name = method(value);
      if (mutations.has(name) && aliases.get(binding.name) !== name) { aliases.set(binding.name, name); changed = true; }
    }
  } while (changed);
  return outside.filter(node => node.type === 'CallExpression' && mutations.has(method(node.callee)) &&
    node.arguments.slice(0, method(node.callee).startsWith('rename') ? 2 : 1).some(runtimePath))
    .map(node => ({ line: node.loc.start.line, operation: method(node.callee) }));
}

test('fixtures mutate runtime paths only through the shared ownership helper', async t => {
  const failures = [];
  const files = (await readdir(new URL('./fixtures/', import.meta.url), { recursive: true })).filter(name => name.endsWith('.mjs')).sort();
  for (const file of files) {
    const source = await readFile(new URL('./fixtures/' + file, import.meta.url), 'utf8');
    for (const violation of unguardedMutations(source, { helper: file === 'installed-daemon-runtime.mjs' }))
      failures.push(`${file}:${violation.line} ${violation.operation}`);
  }
  t.diagnostic(`runtime mutation guard inspected ${files.length} fixture modules`);
  assert.deepEqual(failures, [], 'direct runtime mutations outside ownedRuntimeFiles');
});

test('static guard detects direct, aliased, namespace and derived-path bypasses', () => {
  for (const source of [
    "import {rm} from 'node:fs/promises'; await rm(join(dir.path, name));",
    "import {unlink as erase} from 'node:fs/promises'; const target=join(directory.path,name); await erase(target);",
    "import fs from 'node:fs'; fs['writeFileSync'](join(runtime.directory.path,name),'x');",
    "import * as fs from 'node:fs/promises'; const erase=fs.unlink; const a=directory.path; const b=join(a,name); await erase(b);",
    "import {rename} from 'node:fs/promises'; await rename(scratch, join(directory.path,name));",
    "import {rename} from 'node:fs/promises'; await rename(join(directory.path,name), scratch);",
    "import {rm} from 'node:fs/promises'; const d=await state.runtimeDirectory(); const copy=d; let target; target=join(copy.path,name); await rm(target);",
  ]) assert.equal(unguardedMutations(source).length, 1, source);
  assert.deepEqual(unguardedMutations("import {unlink} from 'node:fs/promises'; const path=join(dirname(directory.path),'.installed-daemon-test.lease'); await unlink(path);"), []);
});

test('foreign-name control throws before mutation and preserves every file', async t => {
  const path = await mkdtemp(join(tmpdir(), 'owned-runtime-control-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  const own = 'd-' + 'a'.repeat(32), foreign = 'd-' + 'b'.repeat(32), name = foreign + '.log';
  await writeFile(join(path, name), 'synthetic foreign control', { mode: 0o600 });
  const before = await lstat(join(path, name), { bigint: true }), bytes = await readFile(join(path, name));
  assert.equal(typeof runtime.ownedRuntimeFiles, 'function', 'shared ownership helper exists');
  const mutate = runtime.ownedRuntimeFiles({ path, validate: async () => {} }, { prefixes: new Set([own]) });
  for (const action of ['remove', 'write', 'rename']) {
    await assert.rejects(mutate(action, name, action === 'rename' ? own + '.log' : 'replacement'), { code: 'runtime_fixture_foreign_name' });
    assert.deepEqual(await readFile(join(path, name)), bytes);
    const after = await lstat(join(path, name), { bigint: true });
    for (const field of ['dev', 'ino', 'size', 'mtimeNs']) assert.equal(after[field], before[field]);
  }
  assert.deepEqual(await readdir(path), [name]);
});

test('helper accepts recorded own classes and refuses prefix lookalikes, traversal and foreign rename targets', async t => {
  const path = await mkdtemp(join(tmpdir(), 'owned-runtime-positive-'));
  t.after(() => rm(path, { recursive: true, force: true }));
  assert.equal(typeof runtime.ownedRuntimeFiles, 'function', 'shared ownership helper exists');
  const own = 'd-' + 'a'.repeat(32), provisioning = 'p-' + 'c'.repeat(32), marker = 'own-token';
  const prefixes = new Set([own, provisioning]), names = new Set(['identity-v1.key', 'test-key-own']), tokenPrefixes = new Set([marker]);
  const mutate = runtime.ownedRuntimeFiles({ path, validate: async () => {} }, { prefixes, names, tokenPrefixes });
  for (const name of [own + '.log', own + '.stamp.tmp-token', provisioning + '.lock', marker, marker + '.owner-child', 'identity-v1.key', 'test-key-own']) {
    await mutate('write', name, 'synthetic own file', { flag: 'wx', mode: 0o600 });
    await mutate('remove', name);
  }
  // Collections remain live as launch and exclusive-key ownership is recorded.
  names.add('test-key-later'); await mutate('write', 'test-key-later', 'owned'); await mutate('remove', 'test-key-later');
  for (const name of [own + '0.log', own, '../' + own + '.log', '/' + own + '.log', 'identity-v1.key.other', marker + '-other', ''])
    await assert.rejects(mutate('remove', name), { code: 'runtime_fixture_foreign_name' });
  await mutate('write', own + '.log', 'retained');
  await assert.rejects(mutate('rename', own + '.log', 'foreign.log'), { code: 'runtime_fixture_foreign_name' });
  assert.equal(await readFile(join(path, own + '.log'), 'utf8'), 'retained');
  await mutate('remove', own + '.log');
  assert.deepEqual(await readdir(path), []);
});
