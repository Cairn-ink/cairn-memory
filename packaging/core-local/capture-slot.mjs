import { DatabaseSync } from 'node:sqlite';
import { CoreError } from '../../packages/core/src/index.mjs';
import { readMigratedControls, migratedCaptureControls } from '../../packages/adapter-sqlite/src/migrate/capture-controls.mjs';
import { createMigratedRawPolicy } from '../../packages/adapter-sqlite/src/migrate/raw-privacy.mjs';
import { allowsRawSession } from '../../packages/adapter-sqlite/src/raw-lineage.mjs';
import { sessionHasher } from '../../packages/adapter-sqlite/src/suppressions.mjs';
import { readPause } from '../../packages/adapter-sqlite/src/pause.mjs';
import { captureStoreIdentity } from './capture-binding.mjs';
import { openStorage } from './adapter-slot.mjs';

// Capture uses a read-only permission probe before opening the transcript.
// The SQLite adapter repeats the frozen local-authority checks on writes.
export function captureAdapter(binding) {
  const { authority, database } = binding;
  const { ownerId: owner, scope: type, projectId } = authority.namespace;
  const scope = { owner, namespace: type + '\0' + projectId };
  const { client, storeId, targetId, expectedControlRevision, expectedConsentGeneration,
    expectedNamespaceGeneration, expectedRawRevision } = authority;
  const localAuthority = { scope, client, storeId, targetId, expectedControlRevision, expectedConsentGeneration,
    expectedNamespaceGeneration, expectedRawRevision };

  function check(sessionId) {
    const db = new DatabaseSync(database, { readOnly: true, timeout: 2000 });
    try {
      db.exec('BEGIN');
      const store = db.prepare(`SELECT s.store_id, s.session_hash_key, m.migration_id, m.attestation, m.checkpoint,
          json_type(m.source_evidence, '$.legacyRawHashing') = 'true' AS legacy
        FROM cairn_store s JOIN cairn_migration m USING (singleton)`).get();
      if (store?.store_id !== storeId || store.migration_id !== binding.migrationId ||
          store.attestation !== binding.attestation || store.checkpoint !== 3) throw new CoreError('revision_conflict');
      const controls = readMigratedControls(db);
      migratedCaptureControls(controls, localAuthority).assertCapture({ scope, client });
      if (readPause(db, owner).paused) throw new CoreError('capture_paused');
      if (sessionId !== undefined) {
        const hash = sessionHasher(store.session_hash_key, store.legacy === 1);
        const policy = store.legacy === 1 ? createMigratedRawPolicy(store.session_hash_key, hash, controls.evidence.localRawPrivacy === true) : null;
        if (!allowsRawSession(db, scope, client, hash(scope, client, sessionId)) ||
            policy?.blocks(db, scope, { client, sessionId }, [])) throw new CoreError('capture_evidence_closed');
      }
    } finally { db.close(); }
  }

  async function run(sessionId, work) {
    const identity = await captureStoreIdentity(database);
    if (identity.device !== binding.device || identity.inode !== binding.inode) throw new CoreError('revision_conflict');
    check(sessionId);
    const runtime = await openStorage(database, localAuthority);
    try {
      const actual = await captureStoreIdentity(database);
      if (actual.device !== binding.device || actual.inode !== binding.inode) throw new CoreError('revision_conflict');
      return await work({ service: runtime.service, scope, storage: runtime.storage });
    } finally { await runtime.close(); }
  }

  return {
    check, run,
    fence: sessionId => run(undefined, ({ storage }) => storage.uow.run(owner, { pauseLock: true }, async tx => {
      if ((await storage.pause.get(tx, owner)).paused) throw new CoreError('capture_paused');
      return storage.raw.fenceSession(tx, scope, { client, sessionId });
    })),
  };
}
