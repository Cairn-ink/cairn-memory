import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { openContextProductReader, openContextIndexMaintainer, createContextReadSupervisor } from '../index.mjs';
import { credentialDigest, PRODUCT_PROFILE } from '../context-product-control.mjs';
import { openMemoryReader } from '../memory-reader.mjs';
import { memberFixture, namespace } from '../testing/topic-members-fixture.mjs';
import { assertContextReadReadOnlyAuxiliaries, openContextReadSidecar } from '../context-read-sidecar.mjs';
import { pinStoreFile } from '../store-fence.mjs';

// A different process is essential: SQLite's in-process connection accounting
// cannot detect POSIX locks silently removed by an unrelated raw close.
function child(path, sql) {
  const run = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import { DatabaseSync } from 'node:sqlite';
    const db = new DatabaseSync(process.argv[1]);
    db.exec('PRAGMA busy_timeout=0');
    try {
      if (process.argv[2] === 'exclusive-transaction') db.exec('BEGIN EXCLUSIVE');
      if (process.argv[2] === 'exclusive-read') db.exec('PRAGMA locking_mode=EXCLUSIVE; BEGIN');
      const rows = db.prepare(['exclusive-read', 'exclusive-transaction'].includes(process.argv[2]) ? 'SELECT store_id FROM store_metadata' : process.argv[2]).all();
      console.log(JSON.stringify({ rows }));
    }
    catch (e) { console.log(JSON.stringify({ code: e.errcode & 255 })); }
    finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  `, path, sql], { encoding: 'utf8', timeout: 10000 });
  assert.equal(run.error, undefined); assert.equal(run.signal, null);
  assert.equal(run.status, 0, run.stderr);
  return JSON.parse(run.stdout);
}
const locked = path => assert.deepEqual(child(path, 'BEGIN IMMEDIATE'), { code: 5 });
async function topicRead(path, members) {
  const reader = openMemoryReader({ path, ownerId: namespace.ownerId });
  try {
    const result = await (members ? reader.readTopicMembers({ namespace, selection: { type: 'unfiled' }, accessRevision: 'g' }) :
      reader.readTopicOverview({ namespace }));
    assert.equal(result.ok, true, JSON.stringify(result));
  } finally { await reader.close(); }
}
for (const mode of ['DELETE', 'WAL']) for (const members of [false, true]) {
  test(`${mode}: public topic ${members ? 'members' : 'overview'} and Worker exit preserve host writer locks`, async t => {
    const f = memberFixture(t, { mode }); f.admit('lock safety');
    f.db.exec('BEGIN IMMEDIATE');
    f.db.exec("UPDATE store_metadata SET store_id=store_id WHERE singleton=1");
    try {
      locked(f.path);
      await topicRead(f.path, members);
      locked(f.path);
      f.db.exec('COMMIT');
      assert.deepEqual(child(f.path, 'BEGIN IMMEDIATE'), { rows: [] });
    } finally { if (f.db.isTransaction) f.db.exec('ROLLBACK'); }
  });
}
test('WAL: topic reads preserve host snapshot and prevent checkpoint truncation', async t => {
  const f = memberFixture(t, { mode: 'WAL' }); f.admit('snapshot');
  f.db.exec('BEGIN');
  const before = f.db.prepare('SELECT store_id FROM store_metadata').get().store_id;
  try {
    assert.deepEqual(child(f.path, "UPDATE store_metadata SET store_id='child-store'"), { rows: [] });
    for (const members of [false, true]) {
      await topicRead(f.path, members);
      const checkpoint = child(f.path, 'PRAGMA wal_checkpoint(TRUNCATE)').rows[0];
      assert.equal(checkpoint.busy, 1, JSON.stringify(checkpoint));
      assert.equal(f.db.prepare('SELECT store_id FROM store_metadata').get().store_id, before);
      // WAL main-file SHARED locks also prevent a different process obtaining
      // exclusive locking mode. This catches loss of the main-file lock even
      // when the read-mark in SHM still happens to protect the snapshot.
      assert.deepEqual(child(f.path, 'exclusive-read'), { code: 5 });
    }
  } finally { f.db.exec('ROLLBACK'); }
  assert.equal(child(f.path, 'PRAGMA wal_checkpoint(TRUNCATE)').rows[0].busy, 0);
});
test('context read-only canonical and sidecar probes preserve other host writer locks', t => {
  const f = memberFixture(t); f.admit('context lock');
  const index = openContextReadSidecar({ path: f.path, db: f.db }); index.close();
  for (const path of [f.path, f.path + '.context-read-v1.sqlite']) {
    const db = new DatabaseSync(path); db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE');
    // An actual write is required; a RESERVED lock alone creates no journal.
    db.exec(path === f.path ? 'UPDATE store_metadata SET store_id=store_id' : 'UPDATE generations SET phase=phase');
    try {
      locked(path);
      // A live rollback journal is a refusal. Probe again after deleting no data
      // by using the read-only preflight on the *other* file first.
      try { assertContextReadReadOnlyAuxiliaries(f.path); } catch (error) { assert.equal(error.code, 'index_unavailable'); }
      if (path !== f.path) {
        const other = openContextReadSidecar({ path: f.path, db: f.db }); other.close();
      }
      locked(path);
      db.exec('COMMIT'); assert.deepEqual(child(path, 'BEGIN IMMEDIATE'), { rows: [] });
    } finally { if (db.isTransaction) db.exec('ROLLBACK'); db.close(); }
  }
});
test('context canonical preflight preserves an existing host read lock', t => {
  const f = memberFixture(t); f.admit('canonical snapshot');
  const index = openContextReadSidecar({ path: f.path, db: f.db }); index.close();
  f.db.exec('BEGIN');
  const before = f.db.prepare('SELECT store_id FROM store_metadata').get();
  try {
    assert.deepEqual(child(f.path, 'exclusive-transaction'), { code: 5 });
    assertContextReadReadOnlyAuxiliaries(f.path);
    assert.deepEqual(child(f.path, 'exclusive-transaction'), { code: 5 });
    assert.deepEqual(f.db.prepare('SELECT store_id FROM store_metadata').get(), before);
  } finally { f.db.exec('ROLLBACK'); }
});
test('DELETE: product open, capabilities, fetch and Worker exit preserve host writer locks', async t => {
  const f = memberFixture(t, { mode: 'DELETE' }), memory = f.admit('product lock safety');
  const supervisor = createContextReadSupervisor(); t.after(() => supervisor.close());
  const credential = { nonce: randomUUID() }, state = new SharedArrayBuffer(32);
  new Int32Array(state)[0] = 1;
  const requestControl = { requestId: randomUUID(), handleId: randomUUID(), credentialBindingId: randomUUID(),
    credentialExpiresUtcMs: null, requestMaxMs: 5000 };
  const readSet = [namespace], ownerCoverage = { policy: 'recent-projects-v1', selectionRevision: 'synthetic',
    requestedNamespaces: 1, selectedNamespaces: 1, omittedNamespaces: 0 };
  const binding = { kind: 'request', ...requestControl, ownerId: namespace.ownerId,
    namespaces: { readSet, ownerCoverage }, issuedAt: 1, credentialDigest: credentialDigest(credential) };
  delete binding.requestMaxMs;
  const input = { readSet, intent: 'current', refs: [{ type: 'memory', namespace,
    memoryId: memory.id, revision: memory.revision }] };
  let reader;
  // No journal yet: both opening and fetch must reach the SQLite mode probe.
  // A raw header close here would silently release this RESERVED lock.
  f.db.exec('BEGIN IMMEDIATE');
  try {
    locked(f.path);
    reader = await openContextProductReader({ supervisor, path: f.path, version: 'context-read-v1',
      profile: PRODUCT_PROFILE, readSet, ownerCoverage, requestControl,
      host: { moduleUrl: new URL('../testing/context-product-host.mjs', import.meta.url).href,
        configuration: { requestBinding: binding, state, requestReservation: new SharedArrayBuffer(4) } } });
    locked(f.path);
    const capabilities = await reader.getContextReadCapabilities();
    assert.equal(capabilities.ok, true, JSON.stringify(capabilities));
    locked(f.path);
    const fetched = await reader.fetchCandidateEvidence(input, credential);
    assert.equal(fetched.ok, true, JSON.stringify(fetched));
    assert.equal(fetched.value.items[0].content, memory.content);
    locked(f.path);
    // Once an actual write creates a journal, ready() must refuse safely too.
    f.db.exec('UPDATE store_metadata SET store_id=store_id WHERE singleton=1');
    assert.deepEqual(await reader.fetchCandidateEvidence(input, credential),
      { ok: false, error: { code: 'index_unavailable', retryable: false } });
    locked(f.path);
    await reader.close(); locked(f.path);
    f.db.exec('COMMIT');
    assert.deepEqual(child(f.path, 'BEGIN IMMEDIATE'), { rows: [] });
  } finally {
    await reader?.close();
    if (f.db.isTransaction) f.db.exec('ROLLBACK');
  }
});
test('store fence check and close preserve same-process SQLite locks', t => {
  const f = memberFixture(t); f.admit('fence');
  const pin = pinStoreFile(f.path);
  f.db.exec('BEGIN IMMEDIATE; UPDATE store_metadata SET store_id=store_id');
  try {
    locked(f.path);
    assert.throws(() => pin.check(), { code: 'unsafe_database_file' });
    pin.close(); locked(f.path);
    f.db.exec('COMMIT'); assert.deepEqual(child(f.path, 'BEGIN IMMEDIATE'), { rows: [] });
  } finally { if (f.db.isTransaction) f.db.exec('ROLLBACK'); pin.close(); }
});

for (const mode of ['DELETE', 'WAL']) for (const channel of ['asset', 'method-package', 'review-card'])
  test(`${mode}: ${channel} arbitrary inputs preserve locks on all live stores`, async t => {
    const { prepareAssetFiles } = await import('../../adapters/mcp/asset-files.mjs');
    const { prepareMethodFiles } = await import('../../adapters/mcp/method-package-files.mjs');
    const { reviewCard } = await import('../../adapters/mcp/review-card.mjs');
    const { linkSync, unlinkSync, mkdirSync, writeFileSync } = await import('node:fs');
    const { join, dirname } = await import('node:path');
    const f = memberFixture(t, { mode }); f.admit('input lock');
    const other = memberFixture(t, { mode }); other.admit('other live store');
    const index = openContextReadSidecar({ path: f.path, db: f.db }); index.close();
    const root = join(dirname(f.path), 'package'); mkdirSync(root); writeFileSync(join(root, 'SKILL.md'), 'input');
    const read = input => {
      if (channel === 'review-card') {
        // JSON decoding fails before terminal review. No terminal or store open.
        assert.throws(() => reviewCard(['--db', f.path, '--owner', 'owner', '--card', 'synthetic', '--revision', '1',
          '--dependencies', input, '--dependency-revision', 'null']));
        return;
      }
      const files = channel === 'asset' ? prepareAssetFiles() : prepareMethodFiles(root);
      try {
        if (channel === 'asset') {
          // A regular SQLite file is valid binary input; safety comes from fd
          // isolation, not an inode denylist. Hard links retain nlink refusal.
          try { files.read(input, 33554432, { binary: true }); }
          catch (error) { assert.equal(error.code, 'invalid_input'); }
        } else assert.throws(() => files.change(input), { code: 'invalid_input' });
      } finally { files.close(); }
    };
    for (const path of [f.path, f.path + '.context-read-v1.sqlite', other.path]) {
      const db = path === f.path ? f.db : path === other.path ? other.db : new DatabaseSync(path);
      db.exec('PRAGMA busy_timeout=5000; BEGIN IMMEDIATE; PRAGMA user_version=33');
      try {
        const suffixes = path !== f.path + '.context-read-v1.sqlite' && mode === 'WAL' ? ['-wal', '-shm'] : ['-journal'];
        for (const source of [path, ...suffixes.map(suffix => path + suffix)]) {
          locked(path); read(source); locked(path);
          const alias = source + '.input-link'; linkSync(source, alias);
          try { read(alias); locked(path); } finally { unlinkSync(alias); }
        }
      } finally { db.exec('ROLLBACK'); if (db !== f.db && db !== other.db) db.close(); }
      assert.deepEqual(child(path, 'BEGIN IMMEDIATE'), { rows: [] });
    }
  });

test('DELETE: maintainer open, production refresh and close preserve host writer exclusivity across processes', async t => {
  const f=memberFixture(t,{mode:'DELETE'});f.admit('maintainer locks');
  const supervisor=createContextReadSupervisor();t.after(()=>supervisor.close());
  const credential={nonce:randomUUID()},state=new SharedArrayBuffer(32);new Int32Array(state)[0]=1;
  const readSet=[namespace],ownerCoverage={policy:'recent-projects-v1',selectionRevision:'locks',requestedNamespaces:1,selectedNamespaces:1,omittedNamespaces:0};
  const serviceBinding={kind:'service',serviceId:randomUUID(),credentialBindingId:randomUUID(),credentialExpiresUtcMs:null,
    credentialDigest:credentialDigest(credential),ownerId:namespace.ownerId,namespaces:{readSet,ownerCoverage},issuedAt:0};
  let maintainer;
  // RESERVED is the exclusive writer role in DELETE. It permits independent
  // read-only canonical connections, while a child writer must remain BUSY.
  f.db.exec('BEGIN IMMEDIATE');
  try {
    locked(f.path);
    maintainer=await openContextIndexMaintainer({supervisor,path:f.path,version:'context-read-v1',profile:PRODUCT_PROFILE,
      readSet,ownerCoverage,sidecarJournalMode:'DELETE',host:{moduleUrl:new URL('../testing/context-product-index-host.mjs',import.meta.url).href,
        configuration:{serviceBinding,state}}});
    locked(f.path);
    const built=await maintainer.refreshContextIndex({readSet,types:['memory'],intent:'current',mode:'lexical',budget:{maxItems:1024,maxMs:5000}},credential);
    assert.equal(built.ok,true,JSON.stringify(built));assert.equal(built.value.status,'complete');locked(f.path);
    await maintainer.close();locked(f.path);
    f.db.exec('COMMIT');assert.deepEqual(child(f.path,'BEGIN IMMEDIATE'),{rows:[]});
  } finally {await maintainer?.close();if(f.db.isTransaction)f.db.exec('ROLLBACK');}
});
