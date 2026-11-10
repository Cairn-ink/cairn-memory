import { installMemoryRelations } from './memory-relations-schema.mjs';
import { cachedContentLayout, attestContentSafety, contentLayoutCheckpoint } from './content-safety-schema.mjs';
import { randomUUID } from 'node:crypto';
import { contentReadSafety } from './content-safety.mjs';
import { exceedsRelationLimit } from "./relation-limits.mjs";
import { fail } from "./validation.mjs";

// Match SQLite's BINARY ordering, including opaque IDs containing Unicode.
const compareIds = (left, right) => Buffer.compare(Buffer.from(left), Buffer.from(right));

/** Revision-bound symmetric links. All callers own the enclosing transaction. */
export function createConflictStorage({ db, activeRow, rawRow = activeRow, advanceEpoch, dropHeldWork, upgradeRelations = true }) {
  function upgradeRelationWrite() {
    if(!upgradeRelations||cachedContentLayout(db)?.relationsRevision!==1)return;
    const restore=contentLayoutCheckpoint(db,{optional:true});
    try{db.exec('SAVEPOINT memory_relation_hint');}catch{return;}
    try{
      installMemoryRelations(db);attestContentSafety(db);
      db.exec('RELEASE memory_relation_hint');
    }catch{
      db.exec('ROLLBACK TO memory_relation_hint');db.exec('RELEASE memory_relation_hint');restore();
    }
  }
  function validateTargets(ns, hints = []) {
    for (const hint of hints) {
      const target = activeRow(ns, hint.memoryId);
      if (!target) fail("memory_not_found");
      if (target.revision !== hint.expectedRevision) fail("revision_conflict");
    }
  }

  function invalidateMemory(memoryId, { preserveHeld = false, reason } = {}) {
    const effects = preserveHeld ? undefined : dropHeldWork(memoryId, reason);
    db.prepare(cachedContentLayout(db)?.relationsRevision
      ? "DELETE FROM memory_relations WHERE from_memory_id = ? OR to_memory_id = ?"
      : "DELETE FROM memory_conflicts WHERE left_memory_id = ? OR right_memory_id = ?")
      .run(memoryId, memoryId);
    return effects;
  }

  function insertBatch(ns, entries, source) {
    let changed = false;
    for (const { memoryId, hints = [] } of entries) {
      const raw = rawRow(ns, memoryId);
      if (!raw) fail("memory_not_found");
      if (raw.review_state === "awaiting") {
        if (hints.some(hint => hint.memoryId === memoryId)) fail("invalid_ref");
        validateTargets(ns, hints);
        for (const hint of hints) {
          const previous = db.prepare("SELECT status FROM confirmation_conflicts WHERE memory_id=? AND target_id=?")
            .get(memoryId, hint.memoryId);
          db.prepare(`INSERT INTO confirmation_conflicts
          (memory_id,memory_revision,target_id,target_revision,source) VALUES(?,?,?,?,?)
          ON CONFLICT(memory_id,target_id) DO UPDATE SET
            memory_revision=excluded.memory_revision,target_revision=excluded.target_revision,
            source=excluded.source,status='pending',result=NULL,drop_reason=NULL
          WHERE confirmation_conflicts.status <> 'pending'`).run(memoryId, raw.revision, hint.memoryId, hint.expectedRevision, source);
          // New hidden hints do not invalidate ordinary readers. Re-arming
          // replaces a listed outcome, so existing review cursors must expire.
          if (previous && previous.status !== "pending") changed = true;
        }
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
        let inserted;
        if(!cachedContentLayout(db)?.relationsRevision){
          inserted = db.prepare(`INSERT INTO memory_conflicts
          (left_memory_id, left_revision, right_memory_id, right_revision, relation, source)
          VALUES (?, ?, ?, ?, 'contradicts', ?) ON CONFLICT DO NOTHING`)
          .run(...endpoints, source).changes;
        }else{
        const exists = db.prepare(`SELECT 1 FROM memory_conflicts WHERE left_memory_id=? AND left_revision=?
          AND right_memory_id=? AND right_revision=? AND source=?`).get(...endpoints, source);
        if (exists) continue;
        upgradeRelationWrite();
        inserted = db.prepare(`INSERT INTO memory_relations
          (id,from_memory_id,from_revision,to_memory_id,to_revision,relation,confidence,decided_by,created_at)
          VALUES (?, ?, ?, ?, ?, 'contradicts', 1, 'user', ?)`)
          .run(source + ':' + randomUUID(), ...endpoints, new Date().toISOString()).changes;
        }
        if (!inserted) continue;
        changed = true;
        for (const id of [memoryId, hint.memoryId]) {
          const degree = db.prepare(`SELECT count(*) AS n FROM memory_conflicts
            WHERE left_memory_id = ? OR right_memory_id = ?`).get(id, id).n;
          if (exceedsRelationLimit(degree)) fail("conflict_limit");
        }
      }
    }
    if (changed) advanceEpoch(ns);
    return changed;
  }

  function inspect(ns, memoryId) {
    const rows = db.prepare(cachedContentLayout(db)?.relationsRevision ? `SELECT from_memory_id AS left_memory_id,from_revision AS left_revision,
      to_memory_id AS right_memory_id,to_revision AS right_revision,relation,
      CASE WHEN decided_by!='user' OR id LIKE 'inferred-hint:%' THEN 'inferred-hint' ELSE 'explicit-hint' END AS source
      FROM memory_relations WHERE relation='contradicts' AND decided_by!='rule' AND (from_memory_id=? OR to_memory_id=?)` : `SELECT * FROM memory_conflicts
      WHERE left_memory_id = ? OR right_memory_id = ?`).all(memoryId, memoryId);
    return rows.flatMap((row) => {
      const left = activeRow(ns, row.left_memory_id);
      const right = activeRow(ns, row.right_memory_id);
      if (!left || !right || left.revision !== row.left_revision ||
          right.revision !== row.right_revision || [left,right].some(memory => !contentReadSafety(db, { namespace: ns,
            ref: { type: 'memory', namespace: ns, memoryId: memory.id, revision: memory.revision } }).allowed)) return [];
      const other = left.id === memoryId ? right : left;
      return [{ memoryId: other.id, revision: other.revision,
        relation: row.relation, source: row.source }];
    }).sort((a, b) => compareIds(a.memoryId, b.memoryId) || compareIds(a.source, b.source))
      .slice(0,cachedContentLayout(db)?.relationsRevision?5:Infinity);
  }

  function restore(ns, memory) {
    const outcomes = [];
    const held = db.prepare(`SELECT * FROM confirmation_conflicts WHERE memory_id=? AND status='pending' ORDER BY target_id`).all(memory.id);
    for (const hint of held) {
      const target = activeRow(ns, hint.target_id);
      if (!target) {
        outcomes.push({ memoryId: memory.id, targetId: hint.target_id, status: "dropped", reason: "stale_evidence" });
        continue;
      }
      const full = [memory.id, target.id].some(id => exceedsRelationLimit(db.prepare(`SELECT count(*) n FROM memory_conflicts
        WHERE left_memory_id=? OR right_memory_id=?`).get(id, id).n + 1));
      if (full) {
        // Review must succeed even when another writer has filled a target's degree.
        outcomes.push({ memoryId: memory.id, targetId: target.id, status: "dropped", reason: "conflict_limit" });
        continue;
      }
      insertBatch(ns, [{ memoryId: memory.id, hints: [{ memoryId: target.id, expectedRevision: target.revision }] }], hint.source);
      outcomes.push({ memoryId: memory.id, targetId: target.id, status: "restored", reason: null });
    }
    for (const result of outcomes) db.prepare("UPDATE confirmation_conflicts SET status=?,drop_reason=?,result=? WHERE memory_id=? AND target_id=?")
      .run(result.status === "restored" ? "applied" : "dropped", result.reason, JSON.stringify(result), memory.id, result.targetId);
    return outcomes;
  }

  return { validateTargets, invalidateMemory, insertBatch, inspect, restore };
}
