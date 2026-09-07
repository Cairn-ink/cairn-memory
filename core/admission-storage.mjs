import { randomUUID } from "node:crypto";
import { transaction } from "./database.mjs";
import { fail } from "./validation.mjs";

const where = "owner_id = ? AND scope = ? AND project_id = ? AND client = ? AND event_id = ?";
const key = (ns, input) => [ns.ownerId, ns.scope, ns.projectId, input.client, input.eventId];

/** Content-free job state around the shared admission mutation transaction. */
export function createAdmissionStorage({ db, admitMutation, isSuppressed, activeRow, epoch,
  conflictStorage }) {
  const read = (ns, input) => db.prepare(`SELECT * FROM admission_claims WHERE ${where}`)
    .get(...key(ns, input));
  const live = (row, input, now) => row?.state === "pending" &&
    row.payload_digest === input.payloadDigest && row.token === input.token &&
    row.lease_expires_at > now;

  function claimAdmission(ns, input) {
    return transaction(db, () => {
      const row = read(ns, input);
      if (row && row.payload_digest !== input.payloadDigest) fail("event_payload_conflict");
      if (row?.state === "completed") {
        return { duplicate: true, memoryIds: JSON.parse(row.memory_ids),
          suppressedCount: row.suppressed_count };
      }
      // Read trusted time only once the write lock has been acquired.
      const now = Date.now();
      if (row && row.lease_expires_at > now) return { processing: true };
      const token = randomUUID();
      if (row) {
        db.prepare(`UPDATE admission_claims SET token = ?, lease_expires_at = ? WHERE ${where}`)
          .run(token, now + input.leaseMs, ...key(ns, input));
      } else {
        db.prepare(`INSERT INTO admission_claims
          (owner_id, scope, project_id, client, event_id, payload_digest, state, token, lease_expires_at)
          VALUES (?, ?, ?, ?, ?, ?, 'pending', ?, ?)`)
          .run(...key(ns, input), input.payloadDigest, token, now + input.leaseMs);
      }
      return { token };
    });
  }

  function finishAdmission(ns, input) {
    return transaction(db, () => {
      if (!live(read(ns, input), input, Date.now())) fail("stale_admission");
      const ids = new Set();
      let suppressedCount = 0;
      const activeItems = [];
      for (const item of input.items) {
        // Check before deduplication; one suppressed input contributes one count.
        if (isSuppressed(ns, item.fingerprint)) {
          suppressedCount++;
          continue;
        }
        conflictStorage.validateTargets(ns, item.conflictHints);
        activeItems.push(item);
      }
      const entries = activeItems.map((item) => {
        const memoryId = admitMutation(ns, item).memory.id;
        ids.add(memoryId);
        return { memoryId, hints: item.conflictHints };
      });
      conflictStorage.insertBatch(ns, entries, "inferred-hint");
      const memoryIds = [...ids];
      // Resolve revisions after the entire batch: later exact matches can attach
      // receipts to an earlier result while preserving its first occurrence order.
      const memories = memoryIds.map((id) => ({ id, revision: activeRow(ns, id).revision }));
      db.prepare(`UPDATE admission_claims SET state = 'completed', token = NULL,
        lease_expires_at = NULL, memory_ids = ?, suppressed_count = ? WHERE ${where}`)
        .run(JSON.stringify(memoryIds), suppressedCount, ...key(ns, input));
      return { duplicate: false, memories, suppressedCount, indexRevision: epoch(ns) };
    });
  }

  function abandonAdmission(ns, input) {
    return transaction(db, () => {
      if (!live(read(ns, input), input, Date.now())) return { abandoned: false };
      db.prepare(`UPDATE admission_claims SET lease_expires_at = 0 WHERE ${where}`)
        .run(...key(ns, input));
      return { abandoned: true };
    });
  }

  return { claimAdmission, finishAdmission, abandonAdmission };
}
