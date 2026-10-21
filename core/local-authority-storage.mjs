import { randomUUID } from 'node:crypto';
import { transaction } from './database.mjs';
import { localControlInput } from './local-authority-input.mjs';
import { rawBoundary } from './raw-input.mjs';
import { createRawControlStorage } from './raw-control-storage.mjs';
import { fail } from './validation.mjs';

const where = 'owner_id=? AND scope=? AND project_id=? AND client=?';
export function createLocalAuthorityStorage(db) {
  const storeId = db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get().store_id;
  const raw = createRawControlStorage(db);
  const read = (ns,client) => db.prepare(`SELECT * FROM local_capture_controls WHERE ${where}`).get(...rawBoundary(ns),client);
  function value(ns,client) {
    const row = read(ns,client);
    return { storeId, targetId: row?.target_id ?? null, client, revision: row?.revision ?? 0,
      automaticCaptureEnabled: row?.automatic_capture_enabled === 1, consentGeneration: row?.consent_generation ?? 'initial',
      rawNoticeVersion: row?.raw_notice_version ?? null };
  }
  function get(input) { const { namespace,client } = localControlInput(input); return value(namespace,client); }
  function set(input) {
    const request = localControlInput(input,true), { namespace: ns,client,targetId,automaticCaptureEnabled,rawNoticeVersion } = request;
    return transaction(db, () => {
      const before = value(ns,client);
      if (request.expectedStoreId !== storeId || request.expectedRevision !== before.revision ||
          before.targetId !== null && before.targetId !== targetId) fail('revision_conflict');
      if (before.targetId !== null && before.automaticCaptureEnabled === automaticCaptureEnabled && before.rawNoticeVersion === rawNoticeVersion) return before;
      const generation = before.targetId === null || before.automaticCaptureEnabled !== automaticCaptureEnabled ? randomUUID() : before.consentGeneration;
      db.prepare(`INSERT INTO local_capture_controls VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(owner_id,scope,project_id,client)
        DO UPDATE SET revision=excluded.revision,automatic_capture_enabled=excluded.automatic_capture_enabled,
        consent_generation=excluded.consent_generation,raw_notice_version=excluded.raw_notice_version`)
        .run(...rawBoundary(ns),client,targetId,before.revision+1,Number(automaticCaptureEnabled),generation,rawNoticeVersion);
      if (before.automaticCaptureEnabled && !automaticCaptureEnabled) raw.closePendingInside({ ownerId: ns.ownerId,namespace: ns,client,reason:'capture_barrier' });
      else if (before.rawNoticeVersion !== null && rawNoticeVersion === null) raw.closePendingInside({ ownerId: ns.ownerId,namespace: ns,client,reason:'notice_required' });
      return value(ns,client);
    });
  }
  function check(snapshot, ns, client) {
    if (JSON.stringify(rawBoundary(ns)) !== JSON.stringify(rawBoundary(snapshot.namespace)) || client !== snapshot.client || snapshot.storeId !== storeId) fail('revision_conflict');
    const current = value(ns,client);
    if (!current.automaticCaptureEnabled) fail('capture_disabled');
    const namespace = db.prepare('SELECT generation,paused,enabled FROM episode_controls WHERE owner_id=? AND scope=? AND project_id=?').get(...rawBoundary(ns));
    if (namespace?.paused || namespace?.enabled === 0) fail('capture_disabled');
    const revision = db.prepare('SELECT revision FROM raw_capture_controls WHERE owner_id=? AND client=?').get(ns.ownerId,client)?.revision ?? 0;
    if (current.targetId !== snapshot.targetId || current.revision !== snapshot.expectedControlRevision ||
        current.consentGeneration !== snapshot.expectedConsentGeneration || (namespace?.generation ?? 'initial') !== snapshot.expectedNamespaceGeneration || revision !== snapshot.expectedRawRevision) fail('revision_conflict');
    return current;
  }
  return Object.freeze({ get,set,check });
}
