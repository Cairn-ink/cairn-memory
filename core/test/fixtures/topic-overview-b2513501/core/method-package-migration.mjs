import { installPrivateCards, installCardMemorySources } from './private-card-schema.mjs';
import { installPrivateEvidence } from './private-evidence-schema.mjs';
import { installPrivateOrganization } from './private-organization-schema.mjs';
import { installRawJournal, installRawCapture } from './raw-schema.mjs';
import { installRawLineage } from './raw-lineage-schema.mjs';
import { installRawDeletion } from './raw-deletion-schema.mjs';
import { installRawSources } from './raw-source-schema.mjs';
import { installLocalAuthority } from './local-authority-schema.mjs';
import { validateExistingStore } from './existing-store.mjs';
import { installMethodPackages, validateMethodPrerequisites } from './method-package-schema.mjs';
import { fail } from './validation.mjs';

// Caller owns BEGIN IMMEDIATE. These are schema installers, never feature opts,
// capture, authority grants or backfill. A failure rolls back the whole opener.
export function migrateMethodPrerequisites(db) {
  const version = db.prepare('PRAGMA user_version').get().user_version;
  if (version >= 30) return;
  if (![18,20,21,22,23,24,25,26,27,28,29].includes(version)) fail('unsupported_database');
  for (const [threshold, install] of [
    [20,installPrivateCards], [21,installCardMemorySources], [22,installPrivateEvidence],
    [23,installPrivateOrganization], [24,installRawJournal], [25,installRawCapture],
    [26,installRawLineage], [27,installRawDeletion], [28,installRawSources], [29,installLocalAuthority],
  ]) if (version < threshold) install(db);
  // Validate the complete prerequisite seam before allocating the final schema.
  db.exec('PRAGMA user_version=29');
  const storeId = db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id;
  validateExistingStore(db, { storeId });
  validateMethodPrerequisites(db);
  installMethodPackages(db);
  db.exec('PRAGMA user_version=30');
  validateExistingStore(db, { storeId });
}
