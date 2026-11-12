import { createPrivateCardStorage } from './private-card-storage.mjs';
import { requireSuppressionTransaction } from './content-suppression-storage.mjs';

// The caller owns the forget/suppression transaction. Do not use serving
// eligibility here: stale bodies and older rebuild rows must also be erased.
export function purgeEngineCardsInside(db, ns, actionId, memoryId) {
  requireSuppressionTransaction(db);
  if (!db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='card_memory_bindings'").get()) return;
  const rows = db.prepare(`SELECT c.* FROM private_cards c
    JOIN card_operations o ON (o.owner_id,o.scope,o.project_id,o.action_id,o.target_id)=
      (c.owner_id,c.scope,c.project_id,c.id,c.id)
    WHERE c.owner_id=? ${ns.scope === 'owner' ? '' : 'AND c.scope=? AND c.project_id=?'}
      AND o.method='consolidate' AND json_extract(o.result,'$.origin')='engine'
      AND (c.title IS NOT NULL OR c.body IS NOT NULL)
      ${memoryId === undefined ? '' : `AND EXISTS(SELECT 1 FROM card_memory_bindings b
        WHERE b.card_id=c.id AND b.memory_id=?)`}
    ORDER BY c.id`).all(ns.ownerId, ...(ns.scope === 'owner' ? [] : [ns.scope, ns.projectId ?? '']),
      ...(memoryId === undefined ? [] : [memoryId]));
  if (!rows.length) return;
  const identity = db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata WHERE singleton=1').get();
  const writers = createPrivateCardStorage({ db, identity, ready() {} }).engineCardWriters();
  const namespaces = new Map();
  for (const row of rows) {
    const namespace = { ownerId: row.owner_id, scope: row.scope, projectId: row.project_id };
    writers.purge(namespace, row, actionId);
    namespaces.set(JSON.stringify(namespace), namespace);
  }
  for (const namespace of namespaces.values()) db.prepare(`INSERT INTO card_epochs VALUES(?,?,?,2)
    ON CONFLICT(owner_id,scope,project_id) DO UPDATE SET generation=generation+1`)
    .run(namespace.ownerId, namespace.scope, namespace.projectId);
}
