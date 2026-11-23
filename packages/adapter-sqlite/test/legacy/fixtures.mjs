import { copyFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { openDatabase } from '../../../../core/database.mjs';
import { installReceiptEventTimeInside, migrateCardLineage } from '../../../../core/content-safety-migration.mjs';
import { installLocalRawPrivacy } from '../../../../core/local-authority-schema.mjs';
import { installCardMemorySources, installPrivateCards } from '../../../../core/private-card-schema.mjs';
import { installPrivateEvidence } from '../../../../core/private-evidence-schema.mjs';

export const quiescence = Object.freeze({
  admissionsClosed: true, writersStopped: true, readersDrained: true, oldHandlesClosed: true,
});

export function scratch(test) {
  const path = mkdtempSync(join(tmpdir(), 'legacy-store-'));
  test.after(() => rmSync(path, { force: true, recursive: true }));
  return path;
}

const profiles = {
  18: {}, 20: {}, 21: {}, 22: {}, 23: { privateCards: true },
  24: { rawConversations: true }, 25: { rawCapture: true }, 26: { rawLineage: true },
  27: { rawDeletion: true }, 28: { rawSources: true }, 29: { localControls: true },
  30: { methodPackages: true }, 31: { assets: true }, 32: { roleProfiles: true },
  33: { currentDependencies: true },
};
const safetyBases = { 34: 18, 38: 23, 48: 33, 51: 18, 52: 23, 53: 33 };

// Use the engine's fresh profile, or its schema leaves for old staged layouts.
// The two v53 feature variants exercise independent engine maintenance paths.
export async function fixture(directory, physical, { localPrivacy = false, lineage = false } = {}) {
  const path = join(directory, 'layout-' + physical + (lineage ? '-lineage' : '') + '.sqlite');
  const base = safetyBases[physical] ?? physical;
  const options = safetyBases[physical] ? { ...profiles[base], contentSafety: 's2h-v1' } : profiles[base];
  const db = openDatabase(path, options);
  let storeId, suppressionDomain;
  try {
    db.exec('BEGIN IMMEDIATE');
    if ([20, 21, 22].includes(physical)) {
      installPrivateCards(db);
      if (physical >= 21) installCardMemorySources(db);
      if (physical >= 22) installPrivateEvidence(db);
      db.exec(`PRAGMA user_version = ${physical}`);
    }
    if (localPrivacy) installLocalRawPrivacy(db);
    if (physical >= 51 && !lineage) installReceiptEventTimeInside(db, base);
    storeId = db.prepare('SELECT store_id FROM store_metadata').get().store_id;
    if (safetyBases[physical]) {
      suppressionDomain = db.prepare('SELECT suppression_domain FROM content_safety_control').get().suppression_domain;
    }
    db.exec('COMMIT');
  } finally { db.close(); }

  if (lineage) {
    // The real lineage maintenance path accepts the non-attested safety cell.
    const backupPath = join(directory, 'maintenance.sqlite');
    copyFileSync(path, backupPath);
    await migrateCardLineage({ path, backupPath, expected: { storeId, base, suppressionDomain }, quiescence });
  }
  return { path, storeId };
}

export function editFixture(path, work) {
  const db = new DatabaseSync(path);
  try { return work(db); }
  finally { db.close(); }
}

export const namespace = Object.freeze({ ownerId: 'fixture-owner', scope: 'personal', projectId: null });
export const receipt = Object.freeze({ client: 'codex', sessionId: 'fixture-session', eventId: 'fixture-event',
  role: 'user', excerpt: 'Synthetic receipt excerpt' });
