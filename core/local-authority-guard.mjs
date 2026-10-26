// Stored bindings are authoritative even through a later unmanaged facade.
export function localAuthorityGuard(db, captured) {
  const fields = ['local_target_id','local_store_id','local_consent_generation'];
  if (fields.every(key => captured[key] == null)) return null;
  if (fields.some(key => typeof captured[key] !== 'string')) return 'capture_evidence_closed';
  const current = db.prepare(`SELECT * FROM local_capture_controls WHERE owner_id=? AND scope=? AND project_id=? AND client=?`)
    .get(captured.owner_id,captured.scope,captured.project_id,captured.client);
  const store = db.prepare('SELECT store_id FROM store_metadata WHERE singleton=1').get();
  return current?.automatic_capture_enabled === 1 && current.target_id === captured.local_target_id &&
    current.consent_generation === captured.local_consent_generation && store.store_id === captured.local_store_id ? null : 'capture_evidence_closed';
}
