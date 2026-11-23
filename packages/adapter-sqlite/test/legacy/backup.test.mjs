import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../../../../core/index.mjs';
import { assertLegacyBackupCanServe, createLegacyBackup, verifyLegacyBackup,
  verifyLegacyBackupAgainstSource } from '../../src/legacy/backup.mjs';
import { editFixture, fixture, namespace, quiescence, receipt, scratch } from './fixtures.mjs';

async function archiveInput(t, physical = 29) {
  const directory = scratch(t);
  const { path, storeId: expectedStoreId } = await fixture(directory, physical);
  return { path, expectedStoreId, backupDirectory: join(directory, 'archive'), quiescence };
}

test('publishes a private, durable backup and verifies its independent proofs', async t => {
  const input = await archiveInput(t, 53);
  const before = readFileSync(input.path);
  const proof = await createLegacyBackup(input);
  assert.deepEqual(verifyLegacyBackup(input), proof);
  assert.deepEqual(verifyLegacyBackupAgainstSource(input), proof);
  assert.deepEqual(readFileSync(input.path), before);
  assert.equal(proof.receiptEventTime, true);
  assert.match(proof.logicalDigest, /^[0-9a-f]{64}$/);
  assert.match(proof.byteDigest, /^[0-9a-f]{64}$/);
  assert.deepEqual(readdirSync(input.backupDirectory).sort(), ['proof.json', 'store.sqlite']);
  assert.equal(statSync(input.backupDirectory).mode & 0o777, 0o700);
  for (const member of ['proof.json', 'store.sqlite']) {
    assert.equal(statSync(join(input.backupDirectory, member)).mode & 0o777, 0o600);
  }
  await assert.rejects(createLegacyBackup(input), { code: 'legacy_backup_exists' });
  assert.throws(() => assertLegacyBackupCanServe(input), { code: 'legacy_backup_archival_only' });
  assert.throws(() => verifyLegacyBackupAgainstSource({ ...input, path: join(input.backupDirectory, 'store.sqlite') }),
    { code: 'legacy_backup_no_authority' });
});

test('refuses copy without the cold barrier or if source or destination proof is absent', async t => {
  const input = await archiveInput(t);
  await assert.rejects(createLegacyBackup({ ...input, quiescence: { ...quiescence, oldHandlesClosed: false } }),
    { code: 'legacy_quiescence_required' });
  assert.throws(() => verifyLegacyBackup(input), { code: 'legacy_backup_unpublished' });
  mkdirSync(input.backupDirectory, { mode: 0o700 });
  assert.throws(() => verifyLegacyBackup(input), { code: 'legacy_backup_unpublished' });
  await assert.rejects(createLegacyBackup(input), { code: 'legacy_backup_exists' });
});

test('rejects SQL integrity, logical content and byte proof mismatches', async t => {
  const input = await archiveInput(t);
  const proof = await createLegacyBackup(input);
  const proofPath = join(input.backupDirectory, 'proof.json');
  const copy = join(input.backupDirectory, 'store.sqlite');
  const restoreProof = () => writeFileSync(proofPath, JSON.stringify(proof));
  writeFileSync(proofPath, JSON.stringify({ ...proof, byteDigest: '0'.repeat(64) }));
  assert.throws(() => verifyLegacyBackup(input), { code: 'legacy_integrity_mismatch' });
  restoreProof();
  // This changes logical content without damaging SQLite or the expected schema.
  editFixture(copy, db => db.exec("INSERT INTO suppressed VALUES ('fixture-owner','personal','',lower(hex(zeroblob(32))) )"));
  assert.throws(() => verifyLegacyBackup(input), { code: 'legacy_integrity_mismatch' });

  // A database written with FK checks off can look physically healthy.
  editFixture(input.path, db => db.exec(`PRAGMA foreign_keys=OFF;
    INSERT INTO receipts VALUES ('orphan','absent','fixture-receipt','codex','fixture-session',
      'fixture-event','user','synthetic orphan','fixture-time');`));
  await assert.rejects(createLegacyBackup({ ...input, backupDirectory: input.backupDirectory + '-invalid' }),
    { code: 'legacy_integrity_mismatch' });
});

for (const physical of [29, 48]) {
  test(`a later engine forget on physical ${physical} invalidates backup freshness`, async t => {
    const input = await archiveInput(t, physical);
    const core = openMemoryCore({ path: input.path });
    let memory;
    try {
      const save = core.admit({ namespace, memory: { content: 'Synthetic pre-forget content', kind: 'fact' }, receipts: [receipt] });
      assert.equal(save.ok, true);
      memory = save.value.memory;
    } finally { core.close(); }
    const proof = await createLegacyBackup(input);
    assert.deepEqual(verifyLegacyBackupAgainstSource(input), proof);
    const reopened = openMemoryCore({ path: input.path });
    try {
      assert.equal(reopened.forget({ namespace, memoryId: memory.id, expectedRevision: memory.revision }).ok, true);
    } finally { reopened.close(); }
    assert.deepEqual(verifyLegacyBackup(input), proof);
    assert.throws(() => verifyLegacyBackupAgainstSource(input), { code: 'legacy_backup_stale' });
    assert.throws(() => assertLegacyBackupCanServe(input), { code: 'legacy_backup_stale' });
    assert.throws(() => assertLegacyBackupCanServe({ ...input, path: resolve(input.path, '../absent.sqlite') }),
      { code: 'legacy_missing_file' });
  });
}

test('a killed cold copy cannot be verified before publication and can be retried', async t => {
  const input = await archiveInput(t, 18);
  const parent = resolve(input.backupDirectory, '..');
  const source = readFileSync(input.path);
  const module = new URL('../../src/legacy/backup.mjs', import.meta.url).href;
  const child = spawnSync(process.execPath, ['--input-type=module', '-e', `
    import fs from 'node:fs';
    import { syncBuiltinESMExports } from 'node:module';
    fs.renameSync = () => process.kill(process.pid, 'SIGKILL');
    syncBuiltinESMExports();
    const { createLegacyBackup } = await import(process.argv[1]);
    await createLegacyBackup(JSON.parse(process.argv[2]));
    `, module, JSON.stringify(input)], { timeout: 30_000, env: {} });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, 'SIGKILL', child.stderr?.toString());
  assert.throws(() => verifyLegacyBackup(input), { code: 'legacy_backup_unpublished' });
  const [stage, ...otherStages] = readdirSync(parent).filter(name => name.startsWith('.legacy-backup-'));
  assert.equal(otherStages.length, 0);
  assert.ok(stage);
  assert.throws(() => verifyLegacyBackup({ backupDirectory: join(parent, stage) }), { code: 'legacy_backup_unpublished' });
  assert.deepEqual(readFileSync(input.path), source);
  const retry = await createLegacyBackup(input);
  assert.deepEqual(verifyLegacyBackupAgainstSource(input), retry);
  chmodSync(join(input.backupDirectory, 'store.sqlite'), 0o644);
  assert.throws(() => verifyLegacyBackup(input), { code: 'legacy_unsafe_path' });
});
