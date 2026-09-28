import { exceedsRelationLimit } from './confirmation-schema.mjs';
import { dropHeldWork } from './confirmation-storage.mjs';
import { fail } from "./validation.mjs";

// Match SQLite's BINARY ordering, including opaque IDs containing Unicode.
const compareIds = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));

/** Revision-bound symmetric links. All callers own the enclosing transaction. */
export function createConflictStorage({ db, activeRow, rawRow = activeRow, advanceEpoch }) {
  function validateTargets(ns, hints = []) {
    for (const hint of hints) {
      const target = activeRow(ns, hint.memoryId);
      if (!target) fail("memory_not_found");
      if (target.revision !== hint.expectedRevision) fail("revision_conflict");
    }
  }

  function invalidateMemory(memoryId, { preserveHeld = false } = {}) {
    if (!preserveHeld) dropHeldWork(db, memoryId);
    db.prepare("DELETE FROM memory_conflicts WHERE left_memory_id = ? OR right_memory_id = ?")
      .run(memoryId, memoryId);
  }

  function insertBatch(ns, entries, source) {
    let changed = false;
    for (const { memoryId, hints = [] } of entries) {
      const raw = rawRow(ns, memoryId);
      if (!raw) fail("memory_not_found");
      if (raw.review_state === 'awaiting') {
        if (hints.some(hint => hint.memoryId === memoryId)) fail("invalid_ref");
        validateTargets(ns, hints);
        for (const hint of hints) db.prepare(`INSERT INTO confirmation_conflicts
          (memory_id,memory_revision,target_id,target_revision,source) VALUES(?,?,?,?,?)
          ON CONFLICT DO NOTHING`).run(memoryId, raw.revision, hint.memoryId, hint.expectedRevision, source);
        continue;
      }
      const memory = activeRow(ns, memoryId);
      if (!memory) fail("memory_not_found");
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
          if (exceedsRelationLimit(degree, 0)) fail("conflict_limit");
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

  function restore(ns, memory) {
    const outcomes = [];
    const held = db.prepare(`SELECT * FROM confirmation_conflicts WHERE memory_id=? AND status='pending' ORDER BY target_id`).all(memory.id);
    for (const hint of held) {
      const target = activeRow(ns, hint.target_id);
      if (!target) {
        outcomes.push({ memoryId: hint.target_id, status: 'dropped', reason: 'stale_evidence' });
        continue;
      }
      const full = [memory.id, target.id].some(id => exceedsRelationLimit(db.prepare(`SELECT count(*) n FROM memory_conflicts
        WHERE left_memory_id=? OR right_memory_id=?`).get(id, id).n));
      if (full) {
        // Review must succeed even when another writer has filled a target's degree.
        outcomes.push({ memoryId: target.id, status: 'dropped', reason: 'conflict_limit' });
        continue;
      }
      insertBatch(ns, [{ memoryId: memory.id, hints: [{ memoryId: target.id, expectedRevision: target.revision }] }], hint.source);
      outcomes.push({ memoryId: target.id, status: 'restored', reason: null });
    }
    for (const result of outcomes) db.prepare('UPDATE confirmation_conflicts SET status=?,drop_reason=?,result=? WHERE memory_id=? AND target_id=?')
      .run(result.status === 'restored' ? 'applied' : 'dropped', result.reason, JSON.stringify(result), memory.id, result.memoryId);
    return outcomes;
  }

  return { validateTargets, invalidateMemory, insertBatch, inspect, restore };
}
