import { createHash } from 'node:crypto';
import { transaction } from './database.mjs';
import { fail } from './validation.mjs';

export function decisionReviewOption(input) {
  if (Object.hasOwn(input, 'decisionReview') && input.decisionReview !== 'required-v1') fail('invalid_input');
  return input.decisionReview === 'required-v1';
}

export function createConfirmationStorage({ db, enabled, activeRow, attach, forgetMutation, advanceEpoch }) {
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
      if (action === 'reject') result = forgetMutation(ns, row.id, input.expectedRevision);
      else {
        if (row.currentness !== 'current') fail('memory_historical');
        const now = new Date().toISOString();
        const insertedReceiptIds = [];
        if (!attach(row.id, input.receipt, now, insertedReceiptIds)) fail('invalid_receipt');
        db.prepare(`UPDATE memories SET review_state='confirmed',revision=revision+1,updated_at=? WHERE id=?`)
          .run(now, row.id);
        result = { memory: { id: row.id, revision: row.revision + 1 },
          confirmationReceiptId: insertedReceiptIds[0], indexRevision: advanceEpoch(ns) };
      }
      db.prepare(`INSERT INTO confirmation_actions
        (owner_id,scope,project_id,action_id,payload_digest,result) VALUES(?,?,?,?,?,?)`)
        .run(...key, digest, JSON.stringify(result));
      return result;
    });
  };
}
