import { fail } from './validation.mjs';

const boundary = ns => [ns.ownerId, ns.scope, ns.projectId];
const where = 'owner_id = ? AND scope = ? AND project_id = ?';

/** Durable directional history. Mutation callers own the enclosing transaction. */
export function createSupersessionStorage({ db, activeRow, suppress, advanceEpoch,
  invalidateConflicts, invalidateMemory }) {
  function retire(ns, previous, replacement, receiptIds) {
    if (previous.id === replacement.id) fail('invalid_ref');
    const incoming = db.prepare(`SELECT count(*) AS n FROM memory_supersessions
      WHERE replacement_memory_id = ?`).get(replacement.id).n;
    if (incoming >= 5) fail('supersession_limit');
    db.prepare(`INSERT INTO memory_supersessions
      (owner_id, scope, project_id, previous_memory_id, previous_revision,
       replacement_memory_id, replacement_revision, receipt_ids)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(...boundary(ns), previous.id,
      previous.revision, replacement.id, replacement.revision, JSON.stringify(receiptIds));
    const now = new Date().toISOString();
    suppress(ns, previous.fingerprint);
    invalidateConflicts(previous.id);
    invalidateMemory(ns, previous.id, now);
    db.prepare(`UPDATE memories SET currentness = 'historical', revision = revision + 1,
      updated_at = ? WHERE ${where} AND id = ?`).run(now, ...boundary(ns), previous.id);
    return { previous: { id: previous.id, revision: previous.revision + 1 },
      indexRevision: advanceEpoch(ns) };
  }

  function inspect(ns, memoryId) {
    const row = db.prepare(`SELECT * FROM memory_supersessions
      WHERE ${where} AND previous_memory_id = ?`).get(...boundary(ns), memoryId);
    const unavailable = { previousRevision: row?.previous_revision ?? null,
      replacement: null, receiptIds: [], evidenceAvailable: false };
    if (!row) return unavailable;
    const successor = activeRow(ns, row.replacement_memory_id);
    if (!successor || !Number.isSafeInteger(successor.revision) ||
        successor.revision < row.replacement_revision ||
        !['current', 'historical'].includes(successor.currentness)) return unavailable;
    let bound;
    try { bound = JSON.parse(row.receipt_ids); } catch { return unavailable; }
    if (!Array.isArray(bound) || bound.length < 1 || bound.length > 4 ||
        new Set(bound).size !== bound.length || bound.some(id => typeof id !== 'string')) {
      return unavailable;
    }
    const receiptIds = bound.filter(id => db.prepare(`SELECT 1 FROM receipts
      WHERE id = ? AND memory_id = ?`).get(id, successor.id));
    return { previousRevision: row.previous_revision,
      replacement: { memoryId: successor.id, revision: row.replacement_revision,
        currentRevision: successor.revision,
        state: successor.currentness === 'historical' ? 'historical' : 'active' }, receiptIds,
      evidenceAvailable: receiptIds.length === bound.length };
  }

  return { retire, inspect };
}
