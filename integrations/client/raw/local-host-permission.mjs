import { checkedPath } from '../private-state.mjs';
import { localAuthorityInput } from '../../../core/local-authority-input.mjs';
import { fail, hostRuntime } from './local-host-profile.mjs';

// Import SQLite and the storage helper only after the runtime gate. No writable
// core opener, migration or consent setter participates in this read snapshot.
export async function checkHostPermission(config) {
  hostRuntime();
  let db;
  try {
    const [{ DatabaseSync },{ createLocalAuthorityStorage }] = await Promise.all([
      import('node:sqlite'),import('../../../core/local-authority-storage.mjs'),
    ]);
    await checkedPath(config.usage.root,{ directory:true });
    const before = await checkedPath(config.databasePath);
    db = new DatabaseSync(config.databasePath,{ readOnly:true });
    const after = await checkedPath(config.databasePath);
    if (before.dev !== after.dev || before.ino !== after.ino) fail('store_invalid');
    db.exec('BEGIN');
    if (db.prepare('PRAGMA application_id').get().application_id !== 0x43414952 ||
        db.prepare('PRAGMA user_version').get().user_version !== 29 ||
        db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get()?.store_id !== config.authority.storeId ||
        db.prepare('SELECT 1 FROM raw_owner_usage WHERE owner_id=? AND cap_bytes!=?').get(config.authority.namespace.ownerId,config.raw.capBytes))
      fail('store_invalid');
    const authority = localAuthorityInput(config.authority);
    try { createLocalAuthorityStorage(db).check(authority,authority.namespace,authority.client); }
    catch (error) {
      if (error.code === 'capture_disabled') fail('capture_disabled');
      if (error.code === 'revision_conflict') fail('authority_changed');
      throw error;
    }
    db.exec('COMMIT');
    const final = await checkedPath(config.databasePath);
    if (before.dev !== final.dev || before.ino !== final.ino) fail('store_invalid');
  } catch (error) {
    if (['store_invalid','capture_disabled','authority_changed'].includes(error.reason)) throw error;
    fail('store_invalid');
  } finally { db?.close(); }
}
