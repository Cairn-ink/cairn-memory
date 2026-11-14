import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { parse } from '../../../tools/testing/vendor/acorn/acorn.mjs';
import { masked, functionRegions } from './commit-dispatch-sync-inventory.mjs';
import { APPROVED_SYNCHRONOUS_SCOPES } from '../../../core/commit-dispatch.mjs';
import { sharedSources, syncInventory, syncEntryCalls } from './commit-dispatch-sync-inventory.mjs';

const pin = JSON.parse(readFileSync(new URL('./fixtures/commit-dispatch-sync-paths.json', import.meta.url), 'utf8'));
const check = sources => {
  assert.deepEqual(syncInventory(sources), pin.counts, 'R2G_UNPINNED_SYNC_WRITE');
  assert.deepEqual(syncEntryCalls(sources), pin.entryCalls, 'R2G_UNPINNED_SYNC_WRITE');
};
// AST coverage refuses an alias, computed call or template interpolation
// that the conservative lexical inventory would otherwise fail to see.
function assertCoveredCalls(sources) {
  const identifiers = new Set(['transaction', 'readTransaction', 'reconcile', 'reconcileAsync']);
  const members = new Set([...identifiers, 'exec', 'run']);
  for (const [file, source] of sources) {
    const positions = new Set();
    for (const match of masked(source).matchAll(/\b(transaction|readTransaction|reconcile|reconcileAsync)\s*\(|\.\s*(exec|run)\s*\(/g)) {
      const name = match[1] ?? match[2]; positions.add(match.index + match[0].indexOf(name));
    }
    const visit = node => {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'CallExpression') {
        const callee = node.callee;
        if (callee.type === 'Identifier' && identifiers.has(callee.name))
          assert.ok(positions.has(callee.start), 'R2G_UNPINNED_SYNC_WRITE ' + file);
        if (callee.type === 'MemberExpression') {
          const name = callee.computed ? callee.property.value : callee.property.name;
          if (members.has(name)) assert.ok(positions.has(callee.property.start), 'R2G_UNPINNED_SYNC_WRITE ' + file);
        }
      }
      if (node.type === 'ImportSpecifier' && identifiers.has(node.imported.name))
        assert.equal(node.local.name, node.imported.name, 'R2G_UNPINNED_SYNC_WRITE aliased transaction import');
      if (node.type === 'VariableDeclarator' && node.init?.type === 'Identifier' && identifiers.has(node.init.name))
        assert.fail('R2G_UNPINNED_SYNC_WRITE transaction capability alias');
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      }
    };
    visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
  }
}
test('shared-runtime synchronous write census is closed by module and enclosing function', t => {
  const sources = sharedSources(); check(sources); assertCoveredCalls(sources);
  assert.deepEqual(pin.approvedSynchronousPaths.map(item => item.path), [
    'daemon start install', 'sidecar create or repair at open', 'lazy Card storage init', 'read_role_task_context',
  ]);
  assert.deepEqual(pin.approvedSynchronousPaths.flatMap(item => item.functions), [
    'core/database.mjs:openDatabase', 'core/runtime.mjs:createMemoryRuntime',
    'core/context-read-sidecar.mjs:open', 'core/context-read-sidecar.mjs:openContextReadSidecar',
    'core/engine-card-storage.mjs:createEngineCardStorage', 'core/engine-card-storage.mjs:ensureLayout',
    'core/role-context-evidence.mjs:search', 'core/role-context-facade.mjs:readRoleTaskContext',
  ]);
  assert.equal(Object.keys(pin.exclusions).length, 1);
  assert.match(sources.get('core/raw-search-storage.mjs'), /PRAGMA busy_timeout=0/);
  assert.match(sources.get('core/raw-search-maintenance.mjs'), /quantum/);
  // Deferred reads are excluded only by the engine's enforced query_only
  // helper, never by the caller's name or read-only tool annotation.
  assert.match(sources.get('core/database.mjs'), /PRAGMA query_only\s*=\s*ON/);
  const total = Object.values(pin.counts).reduce((sum, count) => sum + count, 0);
  t.diagnostic(`R2G_SYNC_PIN ${Object.keys(pin.counts).length} module/function/callee keys; ${total} calls; ${sources.size} modules`);
});
test('negative control: an added transaction in an existing shared write function fails with a specific marker', () => {
  const sources = sharedSources(), file = 'core/runtime.mjs';
  const source = sources.get(file), anchor = '  function admit(';
  const start = source.indexOf(anchor); assert.ok(start >= 0);
  const brace = source.indexOf('{', source.indexOf(')', start));
  sources.set(file, source.slice(0, brace + 1) + '\n    transaction(db, () => {});\n' + source.slice(brace + 1));
  assert.throws(() => check(sources), /R2G_UNPINNED_SYNC_WRITE/);
});

test('R2i named scopes equal the four approved paths and no fifth scope can hide in a caller', { timeout: 3000 }, () => {
  const names = new Set();
  for (const source of sharedSources().values()) {
    const visit = node => {
      if (!node || typeof node.type !== 'string') return;
      if (node.type === 'CallExpression' && node.callee.name === 'withSynchronousCommitScope' && node.arguments[0]?.type === 'Literal')
        names.add(node.arguments[0].value);
      for (const value of Object.values(node)) {
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === 'object') visit(value);
      }
    };
    visit(parse(source, { ecmaVersion: 'latest', sourceType: 'module' }));
  }
  const approved = pin.approvedSynchronousPaths.map(item => item.path).sort();
  assert.deepEqual([...APPROVED_SYNCHRONOUS_SCOPES].sort(), approved);
  assert.deepEqual([...names].sort(), approved, 'R2I_NAMED_SYNC_SCOPES');
});

test('R2i census attributes arrows and methods to their own regions', { timeout: 3000 }, () => {
  const source = 'function outer(){const guard=()=>transaction(db,check);return {write(){transaction(db,work)}}}';
  const regions = functionRegions(source);
  for (const [needle, expected] of [['transaction(db,check)', 'guard'], ['transaction(db,work)', 'write']]) {
    const offset = source.indexOf(needle);
    const region = regions.filter(fn => fn.start <= offset && fn.end >= offset).sort((a,b) => b.start-a.start)[0];
    assert.equal(region.name, expected);
  }
});
