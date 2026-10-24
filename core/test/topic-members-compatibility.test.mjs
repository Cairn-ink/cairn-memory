import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync, chmodSync, symlinkSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase, STORAGE_BUSY_TIMEOUT_MS } from '../database.mjs';
import { migrateMethodPrerequisites } from '../method-package-migration.mjs';
import { installAssets } from '../asset-schema.mjs';
import { installRoleProfiles } from '../role-profile-schema.mjs';
import { installCardCurrentDependencies } from '../card-current-schema.mjs';
import { installOverviewLayout, fileBytes } from '../testing/topic-overview-raw29-fixture.mjs';
import { memberFixture, smallHierarchy, namespace, overview, collectMembers, ok } from '../testing/topic-members-fixture.mjs';

const base = { namespace, selection: { type: 'unfiled' }, accessRevision: 'g', limit: 1 };
const inspect = db => ({ version: db.prepare('PRAGMA user_version').get(), journal: db.prepare('PRAGMA journal_mode').get(),
  schema: db.prepare('SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name').all(),
  metadata: db.prepare('SELECT id,revision,kind,deleted,currentness,review_state FROM memories ORDER BY id').all() });
for (const mode of ['DELETE', 'WAL']) for (const version of [18,20,21,22,23,29,30,31,32,33]) {
  test(`E1M-08 physical ${version} ${mode} semantic/busy/read-only compatibility without migration`, async t => {
    const f = memberFixture(t, { mode }); smallHierarchy(f); f.core.close();
    if (version <= 29) installOverviewLayout(f.path, version);
    else {
      const db = openDatabase(f.path);
      try {
        migrateMethodPrerequisites(db);
        if (version >= 31) { installAssets(db); db.exec('PRAGMA user_version=31'); }
        if (version >= 32) { installRoleProfiles(db); db.exec('PRAGMA user_version=32'); }
        if (version >= 33) { installCardCurrentDependencies(db); db.exec('PRAGMA user_version=33'); }
      } finally { db.close(); }
    }
    const beforeState = inspect(f.db), before = fileBytes(f.path), shm = mode === 'WAL' ? readFileSync(f.path + '-shm') : null;
    assert.equal(beforeState.version.user_version, version);
    assert.equal(Boolean(f.db.prepare("SELECT 1 FROM sqlite_master WHERE name='card_notes'").get()), version >= 20);
    const reader = f.reader();
    const legacy = ok(await reader.readTopicOverview({ namespace })); assert.deepEqual(Object.keys(legacy.snapshot), ['indexRevision','generation']);
    const issued = await overview(reader), result = await collectMembers(reader, { ...base, expectedSnapshot: issued.snapshot });
    assert.equal(result.items.length, 1); assert.equal(result.items[0].kind, 'preference');
    assert.doesNotMatch(JSON.stringify(result), /MEMBER_BODY_SENTINEL/);
    f.db.exec('BEGIN IMMEDIATE');
    try { assert.equal((await reader.readTopicMembers(base)).ok, true); } finally { f.db.exec('ROLLBACK'); }
    if (mode === 'DELETE') {
      f.db.exec('BEGIN EXCLUSIVE');
      try { assert.deepEqual(await reader.readTopicMembers(base), { ok: false, error: { code: 'storage_busy' } }); }
      finally { f.db.exec('ROLLBACK'); }
      assert.equal((await reader.readTopicMembers(base)).ok, true);
    }
    await reader.close();
    assert.deepEqual(inspect(f.db), beforeState);
    const cold = fileBytes(f.path);
    assert.equal(cold[''], before['']); assert.equal(cold['-wal'], before['-wal']);
    if (mode === 'WAL') {
      const after = readFileSync(f.path + '-shm'), offsets = [...shm.keys()].filter(i => shm[i] !== after[i]);
      assert.ok(offsets.every(i => i >=100 && i <120), offsets.join(','));
    } else assert.deepEqual(cold, before);
    const warm = f.reader(); await collectMembers(warm, base); await warm.close();
    assert.deepEqual(fileBytes(f.path), cold);
  });
}
for (const version of [17,19,24,25,26,27,28,99]) test(`E1M-08 unsupported ${version} refuses unchanged`, async t => {
  const f = memberFixture(t); f.admit('legacy'); f.core.close();
  if (version >=24 && version<=28) installOverviewLayout(f.path, version);
  else f.db.exec('PRAGMA user_version=' + version);
  const before = fileBytes(f.path), reader = f.reader();
  assert.deepEqual(await reader.readTopicMembers(base), { ok: false, error: { code: 'unsupported_database' } });
  await reader.close(); assert.deepEqual(fileBytes(f.path), before);
});
test('E1M-08 unsafe, symlink, missing and malformed access paths refuse untouched', async t => {
  const f = memberFixture(t); f.admit('a');
  const missing = join(f.workspace.path, 'missing.sqlite');
  assert.equal((await f.reader(namespace, missing).readTopicMembers(base)).error.code, 'database_not_found'); assert.equal(existsSync(missing), false);
  const linked = join(f.workspace.path, 'linked.sqlite'); symlinkSync(f.path, linked);
  assert.equal((await f.reader(namespace, linked).readTopicMembers(base)).error.code, 'unsafe_database_file');
  chmodSync(f.path, 0o644);
  assert.equal((await f.reader().readTopicMembers(base)).error.code, 'unsafe_database_file'); chmodSync(f.path, 0o600);
  f.db.exec('DROP INDEX memory_moc_refs; CREATE INDEX memory_moc_refs ON moc_memory_refs(memory_id,moc_id COLLATE NOCASE)');
  const before = fileBytes(f.path);
  assert.equal((await f.reader().readTopicMembers(base)).error.code, 'unsupported_database'); assert.deepEqual(fileBytes(f.path), before);
});
test('E1M-08 native cold WAL control has the same qualified read-mark-only invariant', async t => {
  const f = memberFixture(t, { mode: 'WAL' }); smallHierarchy(f);
  const before = fileBytes(f.path), initial = readFileSync(f.path + '-shm');
  const native = new DatabaseSync(f.path, { readOnly: true });
  try { native.exec(`PRAGMA busy_timeout=${STORAGE_BUSY_TIMEOUT_MS}; PRAGMA query_only=ON; PRAGMA trusted_schema=OFF`); native.prepare('SELECT id FROM memories').all(); }
  finally { native.close(); }
  const cold = fileBytes(f.path), after = readFileSync(f.path + '-shm');
  assert.equal(cold[''], before['']); assert.equal(cold['-wal'], before['-wal']);
  const offsets = [...initial.keys()].filter(i => initial[i] !== after[i]); assert.ok(offsets.every(i => i>=100 && i<120));
  const reader = f.reader(); await collectMembers(reader, base); await reader.close(); assert.deepEqual(fileBytes(f.path), cold);
  t.diagnostic(JSON.stringify({ changedShmOffsets: offsets, warmedEqual: true }));
});

test('E1M-06 current-layout member opening and opt-in issuance never query bodies or unrelated Card/Raw data', async t => {
  const threads=await import('node:worker_threads'),{syncBuiltinESMExports}=await import('node:module');
  const NativeWorker=threads.default.Worker;
  threads.default.Worker=class extends NativeWorker{
    constructor(url,options){super(url,{...options,execArgv:['--import',new URL('../testing/topic-members-no-bodies.mjs',import.meta.url).href]});}
  };syncBuiltinESMExports();t.after(()=>{threads.default.Worker=NativeWorker;syncBuiltinESMExports();});
  const f=memberFixture(t);smallHierarchy(f);f.core.close();
  const current=openDatabase(f.path,{currentDependencies:true});current.close();
  const reader=f.reader();const issued=await overview(reader);
  assert.equal((await collectMembers(reader,{...base,expectedSnapshot:issued.snapshot})).items.length,1);
});

test('E1M-08 a physical v18 store relabelled as current is refused without migration',async t=>{
  const f=memberFixture(t);f.admit('relabelled');f.db.exec('PRAGMA user_version=33');const before=fileBytes(f.path);
  assert.deepEqual(await f.reader().readTopicMembers(base),{ok:false,error:{code:'unsupported_database'}});
  assert.deepEqual(fileBytes(f.path),before);
});
