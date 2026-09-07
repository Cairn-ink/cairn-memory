import { fail } from "./validation.mjs";

// Match SQLite's BINARY ordering, including opaque IDs containing Unicode.
const compareIds = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));

/** Revision-bound symmetric links. All callers own the enclosing transaction. */
export function createConflictStorage({ db, activeRow, advanceEpoch }) {
  function validateTargets(ns, hints = []) {
    for (const hint of hints) {
      const target = activeRow(ns, hint.memoryId);
      if (!target) fail("memory_not_found");
      if (target.revision !== hint.expectedRevision) fail("revision_conflict");
    }
  }

  function invalidateMemory(memoryId) {
    db.prepare("DELETE FROM memory_conflicts WHERE left_memory_id = ? OR right_memory_id = ?")
      .run(memoryId, memoryId);
  }

  function insertBatch(ns, entries, source) {
    let changed = false;
    for (const { memoryId, hints = [] } of entries) {
      const memory = activeRow(ns, memoryId);
      if (hints.some((hint) => memoryId === hint.memoryId)) fail("invalid_ref");
      validateTargets(ns, hints);
      for (const hint of hints) {
        const endpoints = compareIds(memoryId, hint.memoryId) < 0
          ? [memoryId, memory.revision, hint.memoryId, hint.expectedRevision]
          : [hint.memoryId, hint.expectedRevision, memoryId, memory.revision];
        const inserted = db.prepare(`INSERT INTO memory_conflicts
          (left_memory_id, left_revision, right_memory_id, right_revision, relation, source)
          VALUES (?, ?, ?, ?, 'contradicts', ?) ON CONFLICT DO NOTHING`)
          .run(...endpoints, source).changes;
        if (!inserted) continue;
        changed = true;
        for (const id of [memoryId, hint.memoryId]) {
          const degree = db.prepare(`SELECT count(*) AS n FROM memory_conflicts
            WHERE left_memory_id = ? OR right_memory_id = ?`).get(id, id).n;
          if (degree > 5) fail("conflict_limit");
        }
      }
    }
    if (changed) advanceEpoch(ns);
    return changed;
  }

  function inspect(ns, memoryId) {
    const rows = db.prepare(`SELECT * FROM memory_conflicts
      WHERE left_memory_id = ? OR right_memory_id = ?`).all(memoryId, memoryId);
    return rows.flatMap((row) => {
      const left = activeRow(ns, row.left_memory_id);
      const right = activeRow(ns, row.right_memory_id);
      if (!left || !right || left.revision !== row.left_revision ||
          right.revision !== row.right_revision) return [];
      const other = left.id === memoryId ? right : left;
      return [{ memoryId: other.id, revision: other.revision,
        relation: row.relation, source: row.source }];
    }).sort((a, b) => compareIds(a.memoryId, b.memoryId) || compareIds(a.source, b.source));
  }

  return { validateTargets, invalidateMemory, insertBatch, inspect };
}
