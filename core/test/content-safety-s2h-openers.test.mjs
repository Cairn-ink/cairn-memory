import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, transaction } from '../database.mjs';
import { openReadDatabase } from '../read-database.mjs';
import { validateContextProductLayout } from '../context-product-schema.mjs';
import { createTopicSession } from '../topic-members-session.mjs';
import { existingStoreOption, validateExistingStore } from '../existing-store.mjs';
import { resolveContentLayout, contentSafetyPin } from '../content-safety-layout.mjs';
import { migrateMethodPrerequisites } from '../method-package-migration.mjs';
import { storeIdentity } from '../store-fence.mjs';
import { openMemoryReader, openMemoryCore } from '../index.mjs';
import { safetyFixture, ns, ok, receipt } from '../testing/content-safety-s2h-fixture.mjs';
import { configured, prebuild } from '../testing/context-product-owner-fixture.mjs';
import { host as contextHost } from '../testing/context-read-core-fixture.mjs';

const schema = db => JSON.stringify(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_schema ORDER BY type,name').all());
function topic(path) { const session = createTopicSession(path); try { session.prepare({ charge() {}, request: {} }); } finally { session.dispose(); } }
function attempts(f, db, physical) {
  const pin = contentSafetyPin(resolveContentLayout(physical), f.storeId);
  return [
    ['write', () => { const d = openDatabase(f.path); d.close(); }],
    ['read', () => { const d = openReadDatabase(f.path); d.db.close(); }],
    ['product', () => validateContextProductLayout(db)],
    ['topic', () => topic(f.path)],
    ['existing', () => validateExistingStore(db, existingStoreOption(pin))],
    ['probe', () => storeIdentity(db)],
  ];
}

test('S2h resolver is SQLite-free and has exactly three safety mappings', () => {
  for (const [physical, base] of [[34,18],[38,23],[48,33]]) assert.equal(resolveContentLayout(physical).base, base);
  for (const physical of [35,36,37,39,40,41,42,43,44,45,46,47,49,50,100]) assert.throws(() => resolveContentLayout(physical), { code: 'unsupported_database' });
});
for (const base of [18,23,33]) test(`S2h ${base} openers accept exact cells without DDL; old pins and every feature upgrade refuse`, async t => {
  const f = safetyFixture(t, base); const migrated = await f.migrate(); const db = f.connect(); t.after(() => db.close());
  const before = schema(db);
  for (const [name, open] of attempts(f, db, migrated.physical)) { assert.doesNotThrow(open, name); assert.equal(schema(db), before); }
  for (const version of ['schema29-existing-v1','schema30-existing-v1','schema31-existing-v1','schema32-existing-v1','schema33-existing-v1']) {
    assert.throws(() => openDatabase(f.path, { existingStore: { version, storeId: f.storeId } }), { code: 'unsupported_database' });
  }
  for (const [feature, first] of [['privateCards',20],['rawConversations',24],['rawCapture',25],['rawLineage',26],['rawDeletion',27],['rawSources',28],['localControls',29],['methodPackages',30],['assets',31],['roleProfiles',32],['currentDependencies',33]]) {
    if (base < first) assert.throws(() => openDatabase(f.path, { [feature]: true }), { code: 'unsupported_database' }, feature);
    else { const d = openDatabase(f.path, { [feature]: true }); d.close(); }
    assert.equal(schema(db), before);
  }
  assert.throws(() => transaction(db, () => migrateMethodPrerequisites(db)), { code: 'unsupported_database' });
  assert.equal(schema(db), before);
});

for (const damage of ['missing-control','missing-guard','wrong-control','missing-index','lowered-version']) test(`S2h every opener refuses ${damage} with no DDL`, async t => {
  const f = safetyFixture(t); await f.migrate(); const db = f.connect(); t.after(() => db.close());
  if (damage === 'missing-control') db.exec('DROP TABLE content_safety_control');
  if (damage === 'missing-guard') db.exec('DROP TRIGGER safety_memories_insert');
  if (damage === 'wrong-control') db.exec('DROP TRIGGER safety_control_update; UPDATE content_safety_control SET base_layout=23');
  if (damage === 'missing-index') db.exec('DROP INDEX content_suppression_window');
  if (damage === 'lowered-version') db.exec('PRAGMA user_version=18');
  const before = schema(db);
  for (const [name, open] of attempts(f, db, 34)) { assert.throws(open, { code: 'unsupported_database' }, name); assert.equal(schema(db), before); }
});

test('S2h established topic and writer snapshots refuse a data-only capability change', async t => {
  const f = safetyFixture(t, 23); await f.migrate();
  const core = openMemoryCore({ path: f.path }), db = f.connect(), session = createTopicSession(f.path);
  t.after(() => { session.dispose(); core.close(); db.close(); });
  session.prepare({ charge() {}, request: {} });
  session.transaction(() => session.snapshot(ns));
  const before = schema(db);
  // This future-capability transition is permitted by the frozen control guard;
  // an S2h-only handle must still refuse it without relying on a schema cookie.
  db.exec('UPDATE content_safety_control SET card_lineage_revision=1');
  assert.equal(schema(db), before);
  assert.throws(() => session.transaction(() => session.snapshot(ns)), { code: 'unsupported_database' });
  assert.equal(core.admit({ namespace: ns, memory: { content: 'Synthetic refused capability', kind: 'fact' }, receipts: [receipt('capability')] }).ok, false);
});

test('S2h actual pre-safety write/read/topic/product/existing-store/method binaries refuse safety cells', async t => {
  const f = safetyFixture(t), root = join(f.workspace.path, 'old'); mkdirSync(root);
  // Frozen exact runtime sources (40d5ddbb), independent of checkout history.
  const archive = fileURLToPath(new URL('./fixtures/content-safety-openers.tgz',import.meta.url));
  const unpacked = spawnSync('tar', ['-xf',archive,'-C',root,'legacy'], { encoding: 'utf8' }); assert.equal(unpacked.status, 0, unpacked.stderr);
  const load = name => import(pathToFileURL(join(root,'legacy','core',name)).href);
  const [write, read, product, existing, method, topics] = await Promise.all(['database.mjs','read-database.mjs','context-product-schema.mjs','existing-store.mjs','method-package-migration.mjs','topic-members-session.mjs'].map(load));
  // Count executed statements, including multi-statement configuration execs.
  const count = operation => {
    const prepare = DatabaseSync.prototype.prepare, exec = DatabaseSync.prototype.exec; let statements = 0;
    DatabaseSync.prototype.exec = function(sql) { statements += sql.split(';').filter(value => value.trim()).length; return exec.call(this, sql); };
    DatabaseSync.prototype.prepare = function(sql) {
      const statement = prepare.call(this, sql);
      return new Proxy(statement, { get(target, key) {
        const value = Reflect.get(target, key, target);
        return typeof value !== 'function' ? value : (...args) => { if (['get','all','iterate','run'].includes(key)) statements++; return value.apply(target, args); };
      } });
    };
    try { const handle = operation(); handle.db.close(); return statements; }
    finally { DatabaseSync.prototype.prepare = prepare; DatabaseSync.prototype.exec = exec; }
  };
  const beforeRead = count(() => read.openReadDatabase(f.path));
  const afterRead = count(() => openReadDatabase(f.path));
  t.diagnostic(`fresh physical v18 ordinary read statements: before=${beforeRead}, after=${afterRead}, delta=${afterRead-beforeRead}`);
  const before = count(() => read.openReadDatabase(f.path, { contextRead: true, validateProduct: product.validateContextProductLayout }));
  const after = count(() => openReadDatabase(f.path, { contextRead: true, validateProduct: validateContextProductLayout }));
  t.diagnostic(`fresh physical v18 product read statements: before=${before}, after=${after}, delta=${after-before}`);
  for (const base of [18,23,33]) {
    const f = safetyFixture(t, base); await f.migrate(); const db = f.connect();
    if (base === 18) {
      const migratedRead = count(() => openReadDatabase(f.path));
      t.diagnostic(`fresh migrated v18→34 ordinary read statements: before=${beforeRead}, after=${migratedRead}, delta=${migratedRead-beforeRead}`);
      const migrated = count(() => openReadDatabase(f.path, { contextRead: true, validateProduct: validateContextProductLayout }));
      t.diagnostic(`fresh migrated v18→34 product read statements: before=${before}, after=${migrated}, delta=${migrated-before}`);
    }
    const beforeSchema = schema(db);
    assert.throws(() => write.openDatabase(f.path), { code: 'unsupported_database' });
    assert.throws(() => read.openReadDatabase(f.path), { code: 'unsupported_database' });
    assert.throws(() => product.validateContextProductLayout(db), { code: 'unsupported_database' });
    assert.throws(() => existing.validateExistingStore(db, { storeId: f.storeId }), { code: 'unsupported_database' });
    const session = topics.createTopicSession(f.path);
    try { assert.throws(() => session.prepare({ charge() {}, request: {} }), { code: 'unsupported_database' }); } finally { session.dispose(); }
    // The old direct method installer has an unsafe numeric shortcut, but the
    // old public write/existing openers above prevent obtaining a serving handle.
    assert.equal(schema(db), beforeSchema); db.close();
  }
});

test('S2h hosted 18→34 product Worker: exact, candidates, assembly and suppression after a fresh refetch', async t => {
  const f = safetyFixture(t), core = openMemoryCore({ path: f.path });
  const memory = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic hosted searchable content', kind: 'fact' }, receipts: [receipt('hosted')] })).memory;
  core.close(); await f.migrate();
  const coldConfig = configured(t, f.path, [ns]), cold = await coldConfig.open();
  assert.equal((await cold.findCandidates({ readSet: [ns], query: 'hosted', types: ['memory'], intent: 'current' }, coldConfig.token)).error.code, 'index_unavailable');
  await cold.close();
  await prebuild(configured(t, f.path, [ns], { service: true }), ['memory']);
  const config = configured(t, f.path, [ns]), reader = await config.open();
  const input = { readSet: [ns], refs: [{ type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision }], intent: 'current' };
  const exact = ok(await reader.fetchCandidateEvidence(input, config.token)); assert.equal(exact.items[0].content, 'Synthetic hosted searchable content');
  const candidates = ok(await reader.findCandidates({ readSet: [ns], query: 'hosted', types: ['memory'], intent: 'current', limit: 4 }, config.token));
  assert.ok(JSON.stringify(candidates).includes(memory.id));
  const assembly = ok(await reader.contextRead({ readSet: [ns], query: 'hosted', types: ['memory'], intent: 'current', budget: { maxTokens: 2000, maxItems: 4 } }, config.token));
  assert.ok(JSON.stringify(assembly).includes('Synthetic hosted searchable content'));
  const writer = openMemoryCore({ path: f.path }); ok(writer.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision })); writer.close();
  const result = await reader.fetchCandidateEvidence(input, config.token);
  assert.doesNotMatch(JSON.stringify(result), /Synthetic hosted searchable content|user_forget/);
});

test('S2h hosted v34 topic and legacy fetch fallback keep working and suppress forgotten content', async t => {
  const f = safetyFixture(t); await f.migrate(); const core = openMemoryCore({ path: f.path, model: { countTokens: () => 1 } });
  t.after(() => core.close());
  const memory = ok(core.admit({ namespace: ns, memory: { content: 'Synthetic fallback content', kind: 'fact' }, receipts: [receipt('fallback')] })).memory;
  const reader = openMemoryReader({ path: f.path, ownerId: ns.ownerId }); t.after(() => reader.close());
  const items = []; let cursor;
  do {
    const page = ok(await reader.readTopicMembers({ namespace: ns, selection: { type: 'unfiled' }, accessRevision: 'synthetic-grant', ...(cursor ? { cursor } : {}) }));
    items.push(...page.items); cursor = page.nextCursor;
  } while (cursor);
  assert.ok(items.some(row => row.id === memory.id));
  const invoke = () => core.fetch({ namespace: ns, refs: [{ memoryId: memory.id, revision: memory.revision }] });
  const initial = await invoke(); assert.ok(JSON.stringify(initial).includes('Synthetic fallback content'));
  ok(core.forget({ namespace: ns, memoryId: memory.id, expectedRevision: memory.revision }));
  assert.doesNotMatch(JSON.stringify(await invoke()), /Synthetic fallback content|user_forget/);
});
