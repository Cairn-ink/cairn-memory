import assert from 'node:assert/strict';
import { chmodSync, linkSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../../../../core/index.mjs';
import { inventoryLegacyStore } from '../../src/legacy/inventory.mjs';
import { assertForwardTarget, assertLegacyOpen, LEGACY_LAYOUTS, LEGACY_RULES, LegacyRefusal } from '../../src/legacy/refusal.mjs';
import { editFixture, fixture, namespace, receipt, scratch } from './fixtures.mjs';

const refusal = code => ({ name: 'LegacyRefusal', code });

test('inventories a mixed directory across the engine layout matrix without changing bytes', async t => {
  const directory = scratch(t);
  const cells = [[18,18], [20,20], [21,21], [22,22], [23,23], [24,24], [25,25], [26,26],
    [27,27], [28,28], [29,29], [30,30], [31,31], [32,32], [33,33],
    [34,18], [38,23], [48,33], [51,18], [52,23], [53,33]];
  assert.deepEqual(LEGACY_LAYOUTS, cells.map(([physical]) => physical));
  for (const [physical, base] of cells) {
    await t.test('physical layout ' + physical, async () => {
      const { path, storeId } = await fixture(directory, physical);
      const before = readFileSync(path);
      const inventory = inventoryLegacyStore(path, { expectedStoreId: storeId });
      assert.equal(inventory.physical, physical);
      assert.equal(inventory.base, base);
      assert.equal(inventory.complete, true);
      assert.equal(inventory.suppressionRevision, Number(physical > 33));
      assert.equal(inventory.receiptEventTime, physical >= 51);
      assert.equal(inventory.cardLineageRevision, 0);
      assert.equal(inventory.privacy.raw === null, base < 24);
      assert.equal(inventory.privacy.historyComplete, false);
      assert.deepEqual(readFileSync(path), before);
    });
  }
  assert.equal(readdirSync(directory).length, cells.length);
});

test('physical 53 independently attests event time and card lineage', async t => {
  const directory = scratch(t);
  const receiptTime = await fixture(directory, 53);
  const cardLineage = await fixture(directory, 53, { lineage: true, localPrivacy: true });
  const time = inventoryLegacyStore(receiptTime.path);
  const lineage = inventoryLegacyStore(cardLineage.path);
  assert.deepEqual([time.physical, time.cardLineageRevision, time.receiptEventTime, time.localRawPrivacy], [53, 0, true, false]);
  assert.deepEqual([lineage.physical, lineage.cardLineageRevision, lineage.receiptEventTime, lineage.localRawPrivacy], [53, 1, false, true]);
  assert.throws(() => assertLegacyOpen(lineage, { ...time, storeId: lineage.storeId }), refusal('legacy_cross_version'));
});

test('reports retained forget, Raw seal, hashed fence and pause evidence without exposing payloads', async t => {
  const { path } = await fixture(scratch(t), 48, { localPrivacy: true });
  const core = openMemoryCore({ path });
  try {
    const save = core.admit({ namespace, memory: { content: 'Synthetic memory to forget', kind: 'fact' }, receipts: [receipt] });
    assert.equal(save.ok, true);
    const { id: memoryId, revision: expectedRevision } = save.value.memory;
    const forgotten = core.forget({ namespace, memoryId, expectedRevision });
    assert.equal(forgotten.ok, true);
  } finally { core.close(); }
  editFixture(path, db => {
    db.exec(`INSERT INTO episode_controls VALUES ('fixture-owner','personal','','fixture-generation',1,0,0);
      INSERT INTO local_capture_controls VALUES ('fixture-owner','personal','','codex','fixture-target',1,0,'fixture-consent',NULL);
      INSERT INTO raw_conversations VALUES ('conversation','fixture-owner','personal','','codex',
        's1:' || lower(hex(zeroblob(32))),1,'fixture-time','fixture-time');
      INSERT INTO raw_messages VALUES
        ('conversation','plain',1,'user',NULL,1,1,1,1,1,'complete',NULL,0,'raw-event'),
        ('conversation','envelope',2,'user',NULL,1,1,1,1,1,'complete',NULL,0,'raw-event');
      INSERT INTO raw_parts VALUES
        ('conversation','plain',0,0,1,1,'fixture-digest','raw-event',1,NULL,'local-plain-v1',NULL,X'61'),
        ('conversation','envelope',0,0,1,1,'fixture-digest','raw-event',1,NULL,
          'envelope-aes-256-gcm-v1','fixture-key-version',zeroblob(40));
      INSERT INTO raw_session_fences VALUES ('fixture-owner','personal','','codex','s1:' || lower(hex(zeroblob(32))));
      INSERT INTO local_raw_hide_windows VALUES ('fixture-owner','personal','',1,2);
      INSERT INTO raw_deletion_actions VALUES ('fixture-owner','personal','','fixture-action','fixture-binding','{}');
      INSERT INTO raw_deletion_effects(effect_id,owner_id,scope,project_id,source_type,source_id,entity_type,entity_id,action_id)
        VALUES ('fixture-effect','fixture-owner','personal','','conversation','old','conversation','old','fixture-action');`);
  });
  const { privacy, localRawPrivacy } = inventoryLegacyStore(path);
  assert.equal(localRawPrivacy, true);
  assert.equal(privacy.suppressions.facts, 2);
  assert.equal(privacy.suppressions.receiptDenials, 2);
  assert.equal(privacy.fingerprints.legacyExactDenials, 1);
  assert.deepEqual(privacy.forgetLogs, { memoryTombstones: 1, rawDeletionActions: 1, rawDeletionEffects: 1 });
  assert.deepEqual(privacy.pause, { scopedControls: 1, pausedScopes: 1, disabledScopes: 1,
    localConsentControls: 1, localAutomaticCaptureDisabled: 1 });
  assert.deepEqual(privacy.raw.savedSealFormats, [
    { format: 'envelope-aes-256-gcm-v1', parts: 1, keyVersions: 1 },
    { format: 'local-plain-v1', parts: 1, keyVersions: 0 },
  ]);
  assert.equal(privacy.raw.sessionFences, 1);
  assert.equal(privacy.raw.hashedSessionFences, 1);
  assert.equal(privacy.raw.hideWindows, 1);
  assert.equal(privacy.raw.uuidBackfillComplete, false);
  assert.doesNotMatch(JSON.stringify(privacy), /fixture-key-version|Synthetic memory|fixture-generation/);

  editFixture(path, db => db.exec("UPDATE raw_parts SET key_version = NULL WHERE message_id = 'envelope'"));
  assert.throws(() => inventoryLegacyStore(path), refusal('legacy_incomplete'));
});

test('refuses foreign, unsupported, relabelled and incomplete schema or evidence', async t => {
  const directory = scratch(t);
  const v18 = await fixture(directory, 18);
  assert.throws(() => inventoryLegacyStore(v18.path, { expectedStoreId: 'different-store' }), refusal('legacy_foreign_store'));
  editFixture(v18.path, db => db.exec('PRAGMA application_id = 0'));
  assert.throws(() => inventoryLegacyStore(v18.path), refusal('legacy_foreign_store'));
  const unknown = await fixture(directory, 29);
  editFixture(unknown.path, db => db.exec(`PRAGMA user_version = ${LEGACY_RULES.firstPossibleSuccessor}`));
  assert.throws(() => inventoryLegacyStore(unknown.path), refusal('legacy_unknown_layout'));
  editFixture(unknown.path, db => db.exec('PRAGMA user_version = 18'));
  assert.throws(() => inventoryLegacyStore(unknown.path), refusal('legacy_incomplete'));

  const mixed = await fixture(directory, 23);
  editFixture(mixed.path, db => db.exec('CREATE TABLE added_data (entry TEXT) STRICT'));
  assert.throws(() => inventoryLegacyStore(mixed.path), refusal('legacy_incomplete'));
  editFixture(mixed.path, db => db.exec('DROP TABLE added_data; DROP TRIGGER card_memory_revision_invalidation'));
  assert.throws(() => inventoryLegacyStore(mixed.path), refusal('legacy_incomplete'));

  const half = await fixture(directory, 48, { localPrivacy: true });
  editFixture(half.path, db => db.exec('DROP TRIGGER local_raw_uuid_delete_guard'));
  assert.throws(() => inventoryLegacyStore(half.path), refusal('legacy_incomplete'));
  const missingIdentity = await fixture(directory, 53);
  editFixture(missingIdentity.path, db => db.exec('DELETE FROM episode_identity'));
  assert.throws(() => inventoryLegacyStore(missingIdentity.path), refusal('legacy_incomplete'));
  const malformedDenial = await fixture(directory, 24);
  editFixture(malformedDenial.path, db => db.exec("INSERT INTO suppressed VALUES ('fixture-owner','personal','','malformed')"));
  assert.throws(() => inventoryLegacyStore(malformedDenial.path), refusal('legacy_incomplete'));

  const corrupt = join(directory, 'corrupt.sqlite');
  writeFileSync(corrupt, 'synthetic non-database', { mode: 0o600 });
  assert.throws(() => inventoryLegacyStore(corrupt), refusal('legacy_foreign_store'));
  const empty = join(directory, 'empty.sqlite');
  writeFileSync(empty, '', { mode: 0o600 });
  assert.throws(() => inventoryLegacyStore(empty), refusal('legacy_incomplete'));
});

test('refuses unsafe paths and journal companions without creating a database or WAL files', async t => {
  const directory = scratch(t);
  const { path } = await fixture(directory, 29);
  const missing = join(directory, 'missing.sqlite');
  assert.throws(() => inventoryLegacyStore(missing), refusal('legacy_missing_file'));
  assert.throws(() => inventoryLegacyStore('relative.sqlite'), refusal('legacy_unsafe_path'));
  const alias = join(directory, 'alias.sqlite');
  symlinkSync(path, alias);
  assert.throws(() => inventoryLegacyStore(alias), refusal('legacy_unsafe_path'));
  const hardlink = join(directory, 'alias-hard.sqlite');
  linkSync(path, hardlink);
  assert.throws(() => inventoryLegacyStore(path), refusal('legacy_unsafe_path'));
  const writableParent = join(directory, 'shared');
  mkdirSync(writableParent, { mode: 0o755 });
  assert.throws(() => inventoryLegacyStore(join(writableParent, 'ignored.sqlite')), refusal('legacy_unsafe_path'));
  const legacy = await fixture(directory, 18);
  chmodSync(legacy.path, 0o644);
  assert.throws(() => inventoryLegacyStore(legacy.path), refusal('legacy_unsafe_path'));
  chmodSync(legacy.path, 0o600);
  editFixture(legacy.path, db => db.exec('PRAGMA journal_mode = WAL'));
  const before = readdirSync(directory);
  assert.throws(() => inventoryLegacyStore(legacy.path), refusal('legacy_unsafe_path'));
  assert.deepEqual(readdirSync(directory), before);
  const cold = await fixture(directory, 53);
  writeFileSync(cold.path + '-journal', '', { mode: 0o600 });
  assert.throws(() => inventoryLegacyStore(cold.path), refusal('legacy_unsafe_path'));
});

test('enforces exact open pins and a forward-only target outside the legacy families', async t => {
  const directory = scratch(t);
  const older = inventoryLegacyStore((await fixture(directory, 18)).path);
  const newer = inventoryLegacyStore((await fixture(directory, 29)).path);
  const successor = LEGACY_RULES.firstPossibleSuccessor;
  assert.doesNotThrow(() => assertLegacyOpen(newer, newer));
  assert.throws(() => assertLegacyOpen(newer, older), LegacyRefusal);
  assert.throws(() => assertLegacyOpen({ ...older, physical: successor }, older), refusal('legacy_downgrade'));
  assert.throws(() => assertLegacyOpen(older, { ...newer, storeId: older.storeId }), refusal('legacy_cross_version'));
  assert.throws(() => assertLegacyOpen(older, { ...older, storeId: 'different-store' }), refusal('legacy_foreign_store'));
  assert.throws(() => assertForwardTarget(29, 18), refusal('legacy_downgrade'));
  assert.throws(() => assertForwardTarget(29, 53), refusal('legacy_cross_version'));
  assert.throws(() => assertForwardTarget(29, 29), refusal('legacy_cross_version'));
  assert.throws(() => assertForwardTarget(29, NaN), refusal('legacy_unknown_layout'));
  assert.doesNotThrow(() => assertForwardTarget(29, successor));
});
