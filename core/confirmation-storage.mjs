import { createHash } from 'node:crypto';
import { transaction } from './database.mjs';
import { exceedsRelationLimit } from './relation-limits.mjs';
import { fail } from './validation.mjs';

export function decisionReviewOption(input) {
  if (Object.hasOwn(input, 'decisionReview') && input.decisionReview !== 'required-v1') fail('invalid_input');
  return input.decisionReview === 'required-v1';
}

export function createConfirmationStorage({ db, enabled, activeRow, attach, forgetMutation, advanceEpoch, resolveHeld }) {
  return function resolve(ns, action, input) {
    if (!enabled) fail('decision_review_required');
    const key = [ns.ownerId, ns.scope, ns.projectId, input.actionId];
    const digest = createHash('sha256').update(JSON.stringify({ action, memoryId: input.memoryId,
      expectedRevision: input.expectedRevision, ...(action === 'confirm' ? { receipt: input.receipt } : {}) })).digest('hex');
    return transaction(db, () => {
      const previous = db.prepare(`SELECT payload_digest,result FROM confirmation_actions
        WHERE owner_id=? AND scope=? AND project_id=? AND action_id=?`).get(...key);
      if (previous) {
        if (previous.payload_digest !== digest) fail('action_conflict');
        return JSON.parse(previous.result);
      }
      const row = activeRow(ns, input.memoryId);
      if (!row) fail('memory_not_found');
      if (row.revision !== input.expectedRevision) fail('revision_conflict');
      if (row.review_state !== 'awaiting') fail('memory_not_awaiting');
      let result;
      if (action === 'reject') {
        const forgotten = forgetMutation(ns, row.id, input.expectedRevision, 'rejected');
        result = { ...forgotten, reviewEffects: forgotten.reviewEffects ?? { transitions: [], conflicts: [] } };
      } else {
        if (row.currentness !== 'current') fail('memory_historical');
        const now = new Date().toISOString();
        const insertedReceiptIds = [];
        if (!attach(row.id, input.receipt, now, insertedReceiptIds)) fail('invalid_receipt');
        db.prepare(`UPDATE memories SET review_state='confirmed',revision=revision+1,updated_at=? WHERE id=?`)
          .run(now, row.id);
        const reviewEffects = resolveHeld(ns, row);
        result = { memory: { id: row.id, revision: row.revision + 1 },
          confirmationReceiptId: insertedReceiptIds[0], reviewEffects, indexRevision: advanceEpoch(ns) };
      }
      db.prepare(`INSERT INTO confirmation_actions
        (owner_id,scope,project_id,action_id,payload_digest,result) VALUES(?,?,?,?,?,?)`)
        .run(...key, digest, JSON.stringify(result));
      return result;
    });
  };
}

export function transitionResult(row, status, reason, predecessorRevision = row.previous_revision, replacementRevision = row.replacement_revision) {
  return { predecessor: { memoryId: row.previous_id, revision: predecessorRevision },
    replacement: { memoryId: row.replacement_id, revision: replacementRevision }, status, reason };
}
export function recordTransition(db, row, result) {
  db.prepare('UPDATE confirmation_supersessions SET status=?,result=? WHERE previous_id=? AND replacement_id=?')
    .run(result.status, JSON.stringify(result), row.previous_id, row.replacement_id);
}
export function dropHeldWork(db, memoryId, reason = 'stale_evidence') {
  const effects = { transitions: [], conflicts: [] };
  for (const row of db.prepare(`SELECT * FROM confirmation_supersessions
    WHERE (previous_id=? OR replacement_id=?) AND status IN ('pending','unresolved')`).all(memoryId, memoryId)) {
    const result = transitionResult(row, 'dropped', reason);
    recordTransition(db, row, result);
    effects.transitions.push(result);
  }
  for (const row of db.prepare(`SELECT * FROM confirmation_conflicts
    WHERE (memory_id=? OR target_id=?) AND status='pending'`).all(memoryId, memoryId)) {
    const result = { memoryId: row.memory_id, targetId: row.target_id, status: 'dropped', reason };
    db.prepare("UPDATE confirmation_conflicts SET status='dropped',drop_reason=?,result=? WHERE memory_id=? AND target_id=?")
      .run(reason, JSON.stringify(result), row.memory_id, row.target_id);
    effects.conflicts.push(result);
  }
  return effects.transitions.length || effects.conflicts.length ? effects : undefined;
}
/** Shared by confirmation and explicit promotion, inside the caller's transaction. */
export function createHeldReviewResolver({ db, activeRow, supersessionStorage, conflictStorage }) {
  return function resolveHeld(ns, row) {
    const transitions = new Map(), conflicts = new Map();
    const collect = effects => {
      for (const result of effects.transitions) transitions.set(JSON.stringify([result.predecessor.memoryId, result.replacement.memoryId]), result);
      for (const result of effects.conflicts) conflicts.set(JSON.stringify([result.memoryId, result.targetId]), result);
    };
    const held = db.prepare("SELECT * FROM confirmation_supersessions WHERE replacement_id=? AND status='pending' ORDER BY previous_id").all(row.id);
    for (const transition of held) {
      const predecessor = activeRow(ns, transition.previous_id);
      const replacement = activeRow(ns, row.id);
      const evidenceExists = (ids, memoryId) => JSON.parse(ids).every(id =>
        db.prepare('SELECT 1 FROM receipts WHERE id=? AND memory_id=?').get(id, memoryId));
      let status = 'applied', reason = null;
      // Awaiting predecessors are never reconciliation candidates. Receipt-only
      // revisions preserve this proof; content identity and bound sources fence it.
      if (!predecessor || predecessor.currentness !== 'current' || predecessor.fingerprint !== transition.previous_fingerprint ||
          !evidenceExists(transition.previous_receipt_ids, transition.previous_id) || !evidenceExists(transition.receipt_ids, row.id)) {
        status = 'dropped'; reason = 'stale_evidence';
      } else if (exceedsRelationLimit(db.prepare('SELECT count(*) n FROM memory_supersessions WHERE replacement_memory_id=?').get(row.id).n + 1)) {
        status = 'dropped'; reason = 'supersession_limit';
      } else if (supersessionStorage.requiresQualification(predecessor, replacement)) {
        status = 'unresolved'; reason = 'qualified_transition_required';
      }
      const result = transitionResult(transition, status, reason, predecessor?.revision, replacement.revision);
      recordTransition(db, transition, result);
      collect({ transitions: [result], conflicts: [] });
      if (status === 'applied') supersessionStorage.retire(ns, predecessor, replacement, JSON.parse(transition.receipt_ids), collect);
    }
    collect({ transitions: [], conflicts: conflictStorage.restore(ns, row) });
    return { transitions: [...transitions.values()], conflicts: [...conflicts.values()] };
  };
}

/** Called by the lineage writer after insertion, before endpoint invalidation. */
export function recordHeldRetirement(db, previous, replacement, linked) {
  const outcomes = [];
  const held = db.prepare("SELECT * FROM confirmation_supersessions WHERE previous_id=? AND replacement_id=? AND status IN ('pending','unresolved')")
    .get(previous.id, replacement.id);
  if (held) {
    const result = transitionResult(held, 'applied', null, previous.revision, replacement.revision);
    recordTransition(db, held, result);
    outcomes.push(result);
  }
  // Closing the last slot also closes earlier qualification hand-offs.
  if (exceedsRelationLimit(linked + 1)) {
    for (const pending of db.prepare(`SELECT * FROM confirmation_supersessions
      WHERE replacement_id=? AND status IN ('pending','unresolved')`).all(replacement.id)) {
      const result = { ...(pending.result ? JSON.parse(pending.result) : transitionResult(pending, 'dropped', 'supersession_limit')),
        status: 'dropped', reason: 'supersession_limit' };
      recordTransition(db, pending, result);
      outcomes.push(result);
    }
  }
  return outcomes;
}
