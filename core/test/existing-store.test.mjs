import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createHash } from 'node:crypto';
import { openMemoryCore, createMemoryCore } from '../contract.mjs';
import { createMemoryRuntime } from '../runtime.mjs';
import { openDatabase } from '../database.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

const raw = () => ({ mode: 'off', configureCap: false, readPolicy() { throw Error('Capture policy is not read authority'); } });
function fixture(t, filename = 'store.sqlite') {
  const workspace = createTestWorkspace(t, { prefix: 'retained-existing-' }), path = join(workspace.path, filename);
  let core, db;
  workspace.defer(() => core?.close());
  workspace.defer(() => db?.close());
  core = openMemoryCore({ path, rawConversations: raw() }); core.close(); core = null;
  db = new DatabaseSync(path);
  const storeId = db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get().store_id;
  const existingStore = { version: 'schema29-existing-v1', storeId };
  return { workspace, path, db, existingStore, open(extra = {}) {
    core = openMemoryCore({ path, existingStore, rawConversations: raw(), ...extra }); return core;
  } };
}
const fingerprint = path => createHash('sha256').update(fs.readFileSync(path)).digest('hex');
const schema = db => JSON.stringify(db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all());

test('existing-only real core accepts the exact private schema29 without changing schema, identity or usage', t => {
  const f = fixture(t), before = schema(f.db), bytes = fingerprint(f.path);
  const exec = DatabaseSync.prototype.exec, statements = [];
  const execMock = t.mock.method(DatabaseSync.prototype, 'exec', function(sql, ...args) {
    statements.push(sql); return exec.call(this, sql, ...args);
  });
  let core;
  try { core = f.open(); } finally { execMock.mock.restore(); }
  assert.ok(statements.length > 0);
  assert.ok(statements.every(sql => !/\b(CREATE|ALTER|INSERT|UPDATE|DELETE|BEGIN|COMMIT)\b/i.test(sql)));
  assert.equal(core.listRawConversations({ namespace: { ownerId: 'synthetic', scope: 'personal', projectId: null }, client: 'codex' }).ok, true);
  assert.equal(schema(f.db), before); assert.equal(fingerprint(f.path), bytes);
  assert.equal(f.db.prepare('SELECT count(*) n FROM raw_owner_usage').get().n, 0);
  assert.equal(f.db.prepare('SELECT count(*) n FROM local_capture_controls').get().n, 0);
  assert.equal(f.db.prepare('SELECT store_id FROM store_metadata').get().store_id, f.existingStore.storeId);
  const plain = openMemoryCore({ path: f.path, existingStore: f.existingStore });
  try { assert.equal(plain.getConversation, undefined); } finally { plain.close(); }
});

test('existing-only requires actual keyset index structure, STRICT status, types, nullability and keys', t => {
  const definitions = [
    ['raw_conversations', sql => sql.replace('UNIQUE(owner_id,scope,project_id,client,session_key)', 'UNIQUE(owner_id,scope,project_id,session_key,client)'), ''],
    ['raw_conversations', sql => sql.replace('UNIQUE(owner_id,scope,project_id,client,session_key)', 'UNIQUE(owner_id,scope,project_id,client,session_key DESC)'), ''],
    ['raw_conversations', sql => sql.replace('UNIQUE(owner_id,scope,project_id,client,session_key)', 'UNIQUE(owner_id,scope,project_id,client,session_key COLLATE NOCASE)'), ''],
    ['raw_conversations', sql => sql.replace(',\n      UNIQUE(owner_id,scope,project_id,client,session_key)', ''),
      'CREATE UNIQUE INDEX partial_directory ON raw_conversations(owner_id,scope,project_id,client,session_key) WHERE revision>1'],
    ['raw_conversations', sql => sql.replace(') STRICT', ')'), ''],
    ['raw_source_exclusions', sql => sql.replace('generation INTEGER NOT NULL', 'generation TEXT NOT NULL'), ''],
    ['raw_source_exclusions', sql => sql.replace('generation INTEGER NOT NULL', 'generation INTEGER'), ''],
    ['raw_source_exclusions', sql => sql.replace('PRIMARY KEY(conversation_id,message_id,start,end)', 'PRIMARY KEY(conversation_id,message_id,end,start)'), ''],
  ];
  for (const [index, [table, transform, additional]] of definitions.entries()) {
    const f = fixture(t, `structure-${index}.sqlite`);
    const original = f.db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name=?").get(table).sql;
    assert.notEqual(transform(original), original);
    f.db.exec(`PRAGMA foreign_keys=OFF; DROP TABLE ${table}; ${transform(original)}; ${additional}`);
    const before = schema(f.db), bytes = fingerprint(f.path);
    assert.throws(() => f.open(), { code: 'unsupported_database' });
    assert.equal(schema(f.db), before); assert.equal(fingerprint(f.path), bytes);
  }
});

test('existing-only preserves explicitly requested SDK cap configuration while retained-off never inherits a cap', t => {
  const f = fixture(t);
  f.db.prepare('INSERT INTO raw_owner_usage(owner_id,cap_bytes) VALUES(?,?)').run('synthetic', 12345);
  const explicit = f.open({ rawConversations: { ...raw(), capBytes: 45678, configureCap: true } });
  assert.equal(f.db.prepare('SELECT cap_bytes FROM raw_owner_usage').get().cap_bytes, 45678);
  explicit.close();
  const before = { ...f.db.prepare('SELECT * FROM raw_owner_usage').get() };
  f.open();
  assert.deepEqual({ ...f.db.prepare('SELECT * FROM raw_owner_usage').get() }, before);
});

test('existing-only malformed closed options reject before path creation, with and without Raw', t => {
  const workspace = createTestWorkspace(t, { prefix: 'retained-option-' }); let reads = 0;
  const good = { version: 'schema29-existing-v1', storeId: 'synthetic-store' };
  const accessor = Object.defineProperty({ storeId: good.storeId }, 'version', { get() { reads++; return good.version; } });
  const proxy = new Proxy(good, { ownKeys() { reads++; throw Error('must not reflect proxy'); } });
  const bad = [undefined, null, [], {}, { ...good, unknown: true }, { ...good, version: 'other' },
    Object.create(good), accessor, proxy, { ...good, [Symbol('unknown')]: true }, { ...good, storeId: '' }];
  for (const [index, existingStore] of bad.entries()) for (const withRaw of [false, true]) {
    const path = join(workspace.path, 'absent-parent', `${index}-${withRaw}.sqlite`);
    assert.throws(() => openMemoryCore({ path, existingStore, ...(withRaw ? { rawConversations: raw() } : {}) }), { code: 'invalid_input' });
    assert.equal(fs.existsSync(join(workspace.path, 'absent-parent')), false);
  }
  const path = join(workspace.path, 'uncreated.sqlite');
  for (const input of [Object.create({ existingStore: good }), new Proxy({ path, existingStore: good }, {}),
    Object.defineProperty({ path, existingStore: good }, 'model', { get() { reads++; } }),
    { path, existingStore: good, [Symbol('unknown')]: true }, { path, existingStore: good, unknown: true }]) {
    assert.throws(() => openMemoryCore(input), { code: 'invalid_input' });
  }
  assert.equal(reads, 0); assert.equal(fs.existsSync(path), false);
});

test('existing-only missing, URI, relative and memory paths never create leaf or parent', t => {
  const workspace = createTestWorkspace(t, { prefix: 'retained-missing-' });
  for (const path of [join(workspace.path, 'missing.sqlite'), join(workspace.path, 'missing-parent', 'store.sqlite'),
    ':memory:', 'relative.sqlite', 'file:///tmp/retained-forbidden.sqlite?mode=rwc']) {
    assert.throws(() => openMemoryCore({ path, existingStore: { version: 'schema29-existing-v1', storeId: 'synthetic' } }));
  }
  assert.deepEqual(fs.readdirSync(workspace.path), []);
});

test('existing-only incompatible identity/schema/layout is refused without migration or writes', t => {
  const mutations = [
    'PRAGMA application_id=0', 'PRAGMA user_version=28', 'DELETE FROM store_metadata',
    "UPDATE store_metadata SET store_id='foreign'", "UPDATE store_metadata SET cursor_secret='bad'",
    'DELETE FROM episode_identity', "PRAGMA ignore_check_constraints=ON; UPDATE episode_identity SET secret=upper(secret)",
    'DROP TABLE raw_closed_jobs', 'DROP TRIGGER card_raw_purge', 'DROP TRIGGER card_memory_revision_invalidation',
    'DROP TRIGGER local_capture_binding_insert', 'DROP TRIGGER local_capture_binding_update',
    'DROP INDEX raw_source_part_start',
    'DROP INDEX card_raw_dependents; CREATE INDEX card_raw_dependents ON card_raw_bindings(card_id,conversation_id,message_id,start,end)',
    'ALTER TABLE raw_parts RENAME COLUMN digest TO wrong_digest',
    'ALTER TABLE raw_messages RENAME COLUMN total_units TO wrong_units',
    'ALTER TABLE raw_capture_events RENAME COLUMN local_store_id TO wrong_store_id',
    'DROP TABLE namespace_epochs; CREATE TABLE namespace_epochs(owner_id TEXT,scope TEXT,project_id TEXT,epoch INTEGER)',
  ];
  for (const [index, mutation] of mutations.entries()) {
    const f = fixture(t, `incompatible-${index}.sqlite`); f.db.exec(mutation);
    const before = schema(f.db), bytes = fingerprint(f.path);
    assert.throws(() => f.open(), { code: 'unsupported_database' }, mutation);
    assert.equal(schema(f.db), before, mutation); assert.equal(fingerprint(f.path), bytes, mutation);
    assert.equal(f.db.prepare('PRAGMA user_version').get().user_version, index === 1 ? 28 : 29);
  }
  const blank = join(createTestWorkspace(t, { prefix: 'retained-blank-' }).path, 'blank.sqlite');
  fs.writeFileSync(blank, '', { mode: 0o600 });
  assert.throws(() => openMemoryCore({ path: blank, existingStore: { version: 'schema29-existing-v1', storeId: 'synthetic' } }), { code: 'unsupported_database' });
  assert.equal(fs.statSync(blank).size, 0);
});

test('existing-only checks private leaf/parent permissions and rejects leaf symlinks while accepting host aliases', t => {
  const f = fixture(t);
  fs.chmodSync(f.path, 0o640);
  assert.throws(() => f.open(), { code: 'unsafe_database_file' }); fs.chmodSync(f.path, 0o600);
  fs.chmodSync(f.workspace.path, 0o750);
  try { assert.throws(() => f.open(), { code: 'unsafe_database_file' }); }
  finally { fs.chmodSync(f.workspace.path, 0o700); }
  const linked = join(f.workspace.path, 'leaf-link.sqlite'); fs.symlinkSync(f.path, linked);
  assert.throws(() => f.open({ path: linked }), { code: 'unsafe_database_file' });
  const alias = join(f.workspace.path, 'host-alias'); fs.symlinkSync(f.workspace.path, alias);
  f.open({ path: join(alias, 'store.sqlite') }).close();
});

test('existing-only escaped Unicode/URI-special filename supports WAL writes across a fresh process', t => {
  const f = fixture(t, '保留 #?%&+=.sqlite'); f.db.exec('PRAGMA journal_mode=WAL');
  const core = f.open(), namespace = { ownerId: 'synthetic', scope: 'personal', projectId: null };
  const memory = core.admit({ namespace, memory: { content: 'Synthetic cold-process value', kind: 'fact' },
    receipts: [{ client: 'synthetic', sessionId: 'session', eventId: 'event', role: 'user', excerpt: 'Synthetic cold-process value' }] });
  assert.equal(memory.ok, true, JSON.stringify(memory)); core.close();
  const child = spawnSync(process.execPath, ['--input-type=module', '-e',
    `import {openMemoryCore} from ${JSON.stringify(new URL('../index.mjs', import.meta.url).href)};
    const core=openMemoryCore(JSON.parse(process.argv[1]));
    try { const result=core.list({namespace:JSON.parse(process.argv[2]),limit:1});
      if(!result.ok || result.value.memories.length!==1) process.exitCode=2; }
    finally {core.close();}`, JSON.stringify({ path: f.path, existingStore: f.existingStore }), JSON.stringify(namespace)],
  { encoding: 'utf8', timeout: 10000, env: { NODE_NO_WARNINGS: '1', NODE_DISABLE_COMPILE_CACHE: '1' } });
  assert.equal(child.status, 0, child.stderr + child.stdout); assert.equal(child.signal, null);
});

test('existing-only actual open refuses delete-gap and replacement and closes rejected connections once', t => {
  for (const [replace, at] of [[false, 1], [true, 1], [true, 2]]) {
    const f = fixture(t, `race-${replace}-${at}.sqlite`), original = fs.lstatSync;
    const spare = join(f.workspace.path, `original-${replace}-${at}.sqlite`);
    let calls = 0, closes = 0;
    const close = DatabaseSync.prototype.close;
    const closeMock = t.mock.method(DatabaseSync.prototype, 'close', function() { closes++; return close.call(this); });
    fs.lstatSync = function(path, ...args) {
      const stat = original(path, ...args);
      if (path === f.path && ++calls === at) {
        fs.renameSync(f.path, spare);
        // A replacement has the same authentic store ID, not merely a blank DB.
        if (replace) fs.copyFileSync(spare, f.path);
      }
      return stat;
    };
    syncBuiltinESMExports();
    try {
      assert.throws(() => f.open());
      if (replace) assert.equal(fingerprint(f.path), fingerprint(spare));
      else assert.equal(fs.existsSync(f.path), false);
      assert.equal(closes, replace ? 1 : 0);
    } finally { fs.lstatSync = original; syncBuiltinESMExports(); closeMock.mock.restore(); }
  }
});

test('construction failures after database open or runtime attachment close once and preserve the cause', t => {
  const f = fixture(t), prepare = DatabaseSync.prototype.prepare, close = DatabaseSync.prototype.close;
  let closes = 0;
  const closeMock = t.mock.method(DatabaseSync.prototype, 'close', function() { closes++; return close.call(this); });
  const error = new Error('synthetic-runtime-construction-failure');
  const prepareMock = t.mock.method(DatabaseSync.prototype, 'prepare', function(sql, ...args) {
    if (sql.includes('SELECT store_id AS storeId')) throw error;
    return prepare.call(this, sql, ...args);
  });
  try { assert.throws(() => f.open(), value => value === error); assert.equal(closes, 1); }
  finally { prepareMock.mock.restore(); }
  const afterRuntime = new Error('synthetic-facade-construction-failure');
  let runtimeCloses = 0;
  assert.throws(() => createMemoryCore({ path: f.path }, { createRuntime() {
    return { get identity() { throw afterRuntime; }, close() { runtimeCloses++; } };
  } }), value => value === afterRuntime);
  assert.equal(runtimeCloses, 1);
  const attached = new Error('synthetic-attachment-failure');
  closes = 0;
  assert.throws(() => createMemoryRuntime({ path: f.path, existingStore: f.existingStore }, { attachRaw() { throw attached; } }), value => value === attached);
  assert.equal(closes, 1); closeMock.mock.restore();
});

test('existing-only startup works beside WAL writer; write contention returns actual storage_busy', t => {
  const f = fixture(t); f.db.exec('PRAGMA journal_mode=WAL; BEGIN IMMEDIATE');
  try {
    const core = f.open(), namespace = { ownerId: 'synthetic', scope: 'personal', projectId: null };
    assert.equal(core.listRawConversations({ namespace, client: 'codex' }).ok, true);
    const result = core.admit({ namespace, memory: { content: 'Synthetic busy', kind: 'fact' },
      receipts: [{ client: 'synthetic', sessionId: 'session', eventId: 'busy', role: 'user', excerpt: 'Synthetic busy' }] });
    assert.deepEqual(result, { ok: false, error: { code: 'storage_busy', retryable: true } });
  } finally { f.db.exec('ROLLBACK'); }
});

test('ordinary opener keeps its historical incomplete-local-binding scan', t => {
  const f = fixture(t); f.db.exec(`PRAGMA foreign_keys=OFF; DROP TRIGGER local_capture_binding_insert;
    INSERT INTO raw_capture_events(owner_id,scope,project_id,client,event_id,conversation_id,session_key,first_message_ids,
    eligible_message_ids,projection_digest,binding_digest,capture_generation,local_target_id)
    VALUES('synthetic','personal','','codex','synthetic','synthetic','synthetic','[]','[]','x','x','x','incomplete');
    CREATE TRIGGER local_capture_binding_insert BEFORE INSERT ON raw_capture_events BEGIN SELECT 1; END;`);
  assert.throws(() => openDatabase(f.path), { code: 'unsupported_database' });
  // The new guard is metadata-only, not a historical-data certification pass.
  f.open().close();
});

test('owned synthetic core workspaces close and disappear on success and assertion failure', async t => {
  for (const failure of [false, true]) {
    const workspace = createTestWorkspace(null, { prefix: 'retained-cleanup-' }), path = join(workspace.path, 'store.sqlite');
    let core;
    workspace.defer(() => core?.close());
    try {
      const run = () => {
        core = openMemoryCore({ path, rawConversations: raw() });
        if (failure) assert.fail('Synthetic expected assertion failure');
      };
      if (failure) assert.throws(run, /Synthetic expected assertion failure/);
      else run();
    } finally { await workspace.cleanup(); }
    assert.equal(fs.existsSync(workspace.path), false);
    assert.equal(core.listRawConversations({ namespace: { ownerId: 'synthetic', scope: 'personal', projectId: null }, client: 'codex' }).error.code, 'store_closed');
  }
});
