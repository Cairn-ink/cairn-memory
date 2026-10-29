import { sourceReadSafety, createContentReadMemo } from './content-safety.mjs';
import { fail } from './validation.mjs';
import { cardMemoryRefs, sourceRef } from './private-card-input.mjs';

/** Canonical reads only; never persists Memory text or copies receipt excerpts. */
export function createCardReceiptSources(db, binding) {
  function memory(ns, id, revision) {
    const row = db.prepare(`SELECT id,revision FROM memories WHERE owner_id=? AND scope=?
      AND project_id=? AND id=? AND deleted=0 AND currentness='current' AND review_state!='awaiting'`)
      .get(ns.ownerId, ns.scope, ns.projectId ?? '', id);
    if (!row || row.revision !== revision) fail('source_unavailable');
    return row;
  }
  function refFor(ns, current, row) {
    return { type: 'receipt', namespace: ns, memoryId: current.id, memoryRevision: current.revision,
      receiptId: row.id, contentIdentity: binding('retained-receipt-content-v1',
        [ns, current.id, current.revision, row.id, row.client, row.session_id, row.event_id, row.role, row.excerpt]),
      completeness: 'excerpt-only' };
  }
  function resolve(ns, ref) {
    sourceRef(ref, ns);
    const identity = db.prepare('SELECT store_id AS storeId,cursor_secret AS cursorSecret FROM store_metadata WHERE singleton=1').get();
    const memo = createContentReadMemo(db);
    if (!sourceReadSafety(db, { identity, namespace: ns, ref, strict: true, memo }).allowed) fail('source_unavailable');
    return memo.sources.get(JSON.stringify(ref)).value;
  }
  function refInside(ns, memoryRow, receiptRow) {
    const current = memory(ns, memoryRow.id, memoryRow.revision);
    const row = db.prepare('SELECT * FROM receipts WHERE id=? AND memory_id=?').get(receiptRow.id, current.id);
    if (!row) fail('source_unavailable');
    return refFor(ns, current, row);
  }
  function fromMemories(ns, values) {
    const result = [];
    for (const ref of cardMemoryRefs(values, ns)) {
      const current = memory(ns, ref.memoryId, ref.revision);
      const receipts = db.prepare('SELECT * FROM receipts WHERE memory_id=? ORDER BY id LIMIT 17').all(current.id);
      if (!receipts.length || result.length + receipts.length > 16) fail('source_unavailable');
      result.push(...receipts.map(row => refFor(ns, current, row)));
    }
    return result;
  }
  return { resolve, fromMemories, refInside };
}
