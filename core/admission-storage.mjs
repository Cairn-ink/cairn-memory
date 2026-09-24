import { randomUUID } from "node:crypto";
import { transaction } from "./database.mjs";
import { fail, identifier } from "./validation.mjs";

const where = "owner_id = ? AND scope = ? AND project_id = ? AND client = ? AND event_id = ?";
const key = (ns, input) => [ns.ownerId, ns.scope, ns.projectId, input.client, input.eventId];

/** Content-free job state around the shared admission mutation transaction. */
export function createAdmissionStorage({ db, admitMutation, isSuppressed, activeRow, epoch,
  conflictStorage, stagedEvidence, classificationJournal }) {
  const read = (ns, input) => db.prepare(`SELECT * FROM admission_claims WHERE ${where}`)
    .get(...key(ns, input));
  const live = (row, input, now) => row?.state === "pending" &&
    row.payload_digest === input.payloadDigest && row.token === input.token &&
    row.lease_expires_at > now;

  function inspectAdmission(ns, input) {
    // A deferred read transaction gives claim state and every member one
    // consistent snapshot without acquiring an admission lease or write lock.
    db.exec('BEGIN');
    try {
      const row = db.prepare(`SELECT state, memory_ids, suppressed_count FROM admission_claims WHERE ${where}`)
        .get(...key(ns, input));
      let result;
      if (!row) result = { status: 'absent', classification: { status: 'unknown' } };
      else if (row.state === 'pending') result = { status: 'pending', classification: { status: 'unknown' } };
      else {
        let ids;
        try { ids = JSON.parse(row.memory_ids); } catch { fail('storage_error'); }
        if (!Array.isArray(ids) || ids.length > 5 ||
          !Number.isInteger(row.suppressed_count) || row.suppressed_count < 0 ||
          row.suppressed_count > 5 || new Set(ids).size !== ids.length) fail('storage_error');
        try { ids.forEach(identifier); } catch { fail('storage_error'); }
        const findCurrent = db.prepare(`SELECT revision, filing_status FROM memories
          WHERE owner_id = ? AND scope = ? AND project_id = ? AND id = ?
            AND deleted = 0 AND currentness = 'current'`);
        const members = ids.map((id) => {
          const current = findCurrent.get(ns.ownerId, ns.scope, ns.projectId, id);
          return current ? { status: 'current', memoryId: id, revision: current.revision,
            filing: { status: current.filing_status } } : { status: 'closed' };
        });
        result = { status: 'completed', classification: { status: 'unknown' },
          suppressedCount: row.suppressed_count, members };
      }
      if (input.includeInitialClassification === true) result.initialClassification =
        row?.state === 'completed' ? classificationJournal.inspect(ns, input) : { status: 'unknown' };
      db.exec('COMMIT');
      return result;
    } catch (error) {
      db.exec('ROLLBACK');
      throw error;
    }
  }

  function claimAdmission(ns, input, hooks, stagedView) {
    const serialized = stagedView === undefined ? null : stagedEvidence.serializeView(stagedView);
    const result = transaction(db, () => {
      const now = stagedEvidence.admissionTime(ns, input, serialized !== null);
      const row = read(ns, input);
      if (row && row.payload_digest !== input.payloadDigest) return { closed: 'event_payload_conflict' };
      const closed = stagedEvidence.claimGuard(ns, input, row, now, serialized !== null);
      if (closed) return { closed };
      if (row?.state === "completed") {
        return { duplicate: true, memoryIds: JSON.parse(row.memory_ids),
          suppressedCount: row.suppressed_count, ...hooks?.replay() };
      }
      const prepared = hooks?.prepare(row);
      if (row && row.lease_expires_at > now) return { processing: true };
      const capacity = serialized && stagedEvidence.capacityGuard(ns, serialized);
      if (capacity) return { closed: capacity };
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
      if (serialized) stagedEvidence.insert(ns, input, serialized, now);
      return { token, ...prepared };
    });
    if (result.closed) fail(result.closed);
    return result;
  }

  function finishAdmission(ns, input, hooks) {
    const result = transaction(db, () => {
      const now = stagedEvidence.admissionTime(ns, input);
      const row = read(ns, input);
      const closed = stagedEvidence.finishGuard(ns, input, row, now);
      if (closed) return { closed };
      if (!live(row, input, now)) fail("stale_admission");
      // The public manual finish cannot bypass ordered capture's private proof.
      if (!hooks?.validate && db.prepare(`SELECT 1 FROM capture_events WHERE ${where}`)
        .get(...key(ns, input))) fail('stale_admission');
      hooks?.validate?.();
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
        const result = admitMutation(ns, item);
        const memoryId = result.memory.id;
        ids.add(memoryId);
        return { memoryId, hints: item.conflictHints, item,
          insertedReceiptIds: result.insertedReceiptIds };
      });
      conflictStorage.insertBatch(ns, entries, "inferred-hint");
      const extra = hooks?.admitted?.(entries);
      const memoryIds = [...ids];
      // Resolve revisions after the entire batch: later exact matches can attach
      // receipts to an earlier result while preserving its first occurrence order.
      const memories = memoryIds.map((id) => ({ id, revision: activeRow(ns, id).revision }));
      db.prepare(`UPDATE admission_claims SET state = 'completed', token = NULL,
        lease_expires_at = NULL, memory_ids = ?, suppressed_count = ? WHERE ${where}`)
        .run(JSON.stringify(memoryIds), suppressedCount, ...key(ns, input));
      hooks?.complete?.();
      stagedEvidence.mark(ns, input, 'admitted');
      if (hooks?.initialClassification) classificationJournal.insert(ns, input, memories);
      return { duplicate: false, memories, suppressedCount, indexRevision: epoch(ns), ...extra };
    });
    if (result.closed) fail(result.closed);
    return result;
  }

  function abandonAdmission(ns, input) {
    return transaction(db, () => {
      const now = stagedEvidence.admissionTime(ns, input);
      const row = read(ns, input);
      // The expired owner may record its failure, but cannot release a successor.
      if (row?.state !== 'pending' || row.payload_digest !== input.payloadDigest ||
        row.token !== input.token) return { abandoned: false };
      stagedEvidence.mark(ns, input, 'failed');
      if (!live(row, input, now)) return { abandoned: false };
      db.prepare(`UPDATE admission_claims SET lease_expires_at = 0 WHERE ${where}`)
        .run(...key(ns, input));
      return { abandoned: true };
    });
  }

  function assertCaptureEvidence(ns, input) {
    const result = transaction(db, () => {
      const now = stagedEvidence.admissionTime(ns, input);
      const row = read(ns, input);
      return stagedEvidence.finishGuard(ns, input, row, now) ||
        (!live(row, input, now) ? 'capture_evidence_closed' : null);
    });
    if (result) fail(result);
    return null;
  }

  return { claimAdmission, finishAdmission, abandonAdmission, assertCaptureEvidence, inspectAdmission };
}
