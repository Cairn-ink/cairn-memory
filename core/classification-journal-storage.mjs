import { randomUUID } from 'node:crypto';
import { transaction } from './database.mjs';
import { fail, identifier } from './validation.mjs';

const claimWhere = 'owner_id=? AND scope=? AND project_id=? AND client=? AND event_id=?';
const key = (ns, input) => [ns.ownerId, ns.scope, ns.projectId, input.client, input.eventId];
const statuses = new Set(['not_started', 'in_flight_or_interrupted', 'applied',
  'skipped_already_filed', 'failed', 'skipped_empty']);
const same = (left, right) => JSON.stringify(left) === JSON.stringify(right);

function refs(value) {
  let parsed;
  try { parsed = typeof value === 'string' ? JSON.parse(value) : value; } catch { fail('storage_error'); }
  if (!Array.isArray(parsed) || parsed.length > 5) fail('storage_error');
  const seen = new Set();
  for (const ref of parsed) {
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) ||
        Object.keys(ref).sort().join(',') !== 'memoryId,revision' ||
        !Number.isSafeInteger(ref.revision) || ref.revision < 1 || seen.has(ref.memoryId)) fail('storage_error');
    try { identifier(ref.memoryId); } catch { fail('storage_error'); }
    seen.add(ref.memoryId);
  }
  return parsed;
}

/** Private, source-free first-attempt state for capture only. */
export function createClassificationJournalStorage({ db }) {
  const read = (ns, input) => db.prepare(`SELECT * FROM capture_initial_classification
    WHERE ${claimWhere}`).get(...key(ns, input));
  const claim = (ns, input) => db.prepare(`SELECT state,memory_ids,payload_digest FROM admission_claims
    WHERE ${claimWhere}`).get(...key(ns, input));
  const current = db.prepare(`SELECT revision,filing_status FROM memories
    WHERE owner_id=? AND scope=? AND project_id=? AND id=?
      AND deleted=0 AND currentness='current'`);
  const currentRows = (ns, bound) => bound.map(({ memoryId, revision }) => {
    const row = current.get(ns.ownerId, ns.scope, ns.projectId, memoryId);
    return row?.revision === revision ? row : null;
  });

  function checked(ns, input, row) {
    if (!row || !statuses.has(row.status)) fail('storage_error');
    const admission = claim(ns, input);
    if (admission?.state !== 'completed') fail('storage_error');
    if (input.payloadDigest !== undefined && admission.payload_digest !== input.payloadDigest) {
      fail('revision_conflict');
    }
    const bound = refs(row.bound_refs);
    let ids;
    try { ids = JSON.parse(admission.memory_ids); } catch { fail('storage_error'); }
    if (!Array.isArray(ids) || !same(ids, bound.map(ref => ref.memoryId))) fail('storage_error');
    const selected = row.selected_refs === null ? null : refs(row.selected_refs);
    const final = row.final_refs === null ? null : refs(row.final_refs);
    if (selected && selected.some(ref => !bound.some(item => same(item, ref))) ||
        final && !same(final.map(ref => ref.memoryId), ids)) fail('storage_error');
    const valid = row.status === 'not_started' && bound.length > 0 && !selected && !final && !row.attempt_token ||
      row.status === 'skipped_empty' && bound.length === 0 && !selected && same(final, []) && !row.attempt_token ||
      row.status === 'in_flight_or_interrupted' && selected?.length > 0 && !final && row.attempt_token ||
      row.status === 'failed' && selected?.length > 0 && !final && !row.attempt_token ||
      row.status === 'skipped_already_filed' && same(selected, []) && same(final, bound) && !row.attempt_token ||
      row.status === 'applied' && selected?.length > 0 && final && !row.attempt_token;
    if (!valid) fail('storage_error');
    if (row.attempt_token) try { identifier(row.attempt_token); } catch { fail('storage_error'); }
    return { bound, selected, final };
  }

  // Called from the already-open admission transaction, after member revisions settle.
  function insert(ns, input, admitted) {
    const bound = refs(admitted.map(({ id, revision }) => ({ memoryId: id, revision })));
    const empty = bound.length === 0;
    db.prepare(`INSERT INTO capture_initial_classification
      (owner_id,scope,project_id,client,event_id,status,bound_refs,final_refs)
      VALUES (?,?,?,?,?,?,?,?)`).run(...key(ns, input), empty ? 'skipped_empty' : 'not_started',
      JSON.stringify(bound), empty ? '[]' : null);
  }

  function inspect(ns, input) {
    const row = read(ns, input);
    if (!row) return { status: 'unknown' };
    const { bound, final } = checked(ns, input, row);
    const applicable = row.status === 'applied' || row.status === 'skipped_already_filed'
      ? final : bound;
    if (currentRows(ns, applicable).some(value => !value)) return { status: 'unknown' };
    return { status: row.status };
  }

  function begin(ns, input, admitted, selected) {
    const all = refs(admitted);
    const chosen = refs(selected);
    return transaction(db, () => {
      const row = read(ns, input);
      const { bound } = checked(ns, input, row);
      if (row.status !== 'not_started' || !same(bound, all)) fail('revision_conflict');
      const rows = currentRows(ns, bound);
      if (rows.some(value => !value)) fail('revision_conflict');
      const unfiled = bound.filter((ref, index) => rows[index].filing_status === 'unfiled');
      if (!same(chosen, unfiled)) fail('revision_conflict');
      if (!chosen.length) {
        db.prepare(`UPDATE capture_initial_classification
          SET status='skipped_already_filed',selected_refs='[]',final_refs=bound_refs
          WHERE ${claimWhere}`).run(...key(ns, input));
        return { skipped: true };
      }
      const token = randomUUID();
      db.prepare(`UPDATE capture_initial_classification
        SET status='in_flight_or_interrupted',selected_refs=?,attempt_token=?
        WHERE ${claimWhere}`).run(JSON.stringify(chosen), token, ...key(ns, input));
      return { token };
    });
  }

  function failAttempt(ns, input, token) {
    return transaction(db, () => {
      const row = read(ns, input);
      if (!row || row.status !== 'in_flight_or_interrupted' || row.attempt_token !== token) return false;
      checked(ns, input, row);
      return db.prepare(`UPDATE capture_initial_classification
        SET status='failed',attempt_token=NULL WHERE ${claimWhere}
          AND status='in_flight_or_interrupted' AND attempt_token=?`)
        .run(...key(ns, input), token).changes === 1;
    });
  }

  // Both methods run only within applyPlacement's existing BEGIN IMMEDIATE.
  function assertPlacement(ns, input, token, guards) {
    const row = read(ns, input);
    const { bound, selected } = checked(ns, input, row);
    if (row.status !== 'in_flight_or_interrupted' || row.attempt_token !== token ||
        !same(selected, refs(guards)) || currentRows(ns, bound).some(value => !value)) {
      fail('revision_conflict');
    }
  }

  function completePlacement(ns, input, token) {
    const row = read(ns, input);
    const { bound } = checked(ns, input, row);
    if (row.status !== 'in_flight_or_interrupted' || row.attempt_token !== token) fail('revision_conflict');
    const final = bound.map(({ memoryId }) => {
      const value = current.get(ns.ownerId, ns.scope, ns.projectId, memoryId);
      if (!value) fail('revision_conflict');
      return { memoryId, revision: value.revision };
    });
    const changed = db.prepare(`UPDATE capture_initial_classification
      SET status='applied',final_refs=?,attempt_token=NULL WHERE ${claimWhere}
        AND status='in_flight_or_interrupted' AND attempt_token=?`)
      .run(JSON.stringify(final), ...key(ns, input), token).changes;
    if (changed !== 1) fail('revision_conflict');
  }

  return Object.freeze({ insert, inspect, begin, failAttempt, assertPlacement, completePlacement });
}
