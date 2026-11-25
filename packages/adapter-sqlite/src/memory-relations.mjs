import { canonicalPair, compareUtf8, CoreError } from "@cairn-ink/core";
import { decodeJson, LIVE_SCOPE } from "./memory-rows.mjs";
import { exactScope, placementPort } from "./placement-visibility.mjs";
import { invalidInput, scopeKey, validateId, writeTime } from "./storage-values.mjs";

/** @import { ConflictEdge, ConflictEdgeStore, Scope, SupersessionStore } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { PlacementVisibility, ScopedVisibility } from "./placement-visibility.mjs" */
/** @typedef {Awaited<ReturnType<SupersessionStore["read"]>>} SupersessionView */
/** @typedef {ReturnType<typeof import("./index-revisions.mjs").createIndexRevisions>} IndexRevisions */

const write = { write: true };
const conflictEndpoints = "(left_id = ? OR right_id = ?)";
const conflictScope = `${exactScope} AND ${conflictEndpoints}`;

/** @param {Connection} db @param {Scope} scope @param {string} id */
export function storedSupersession(db, scope, id) {
  const row = db.prepare(`SELECT previous_revision, replacement_id, replacement_revision, receipt_ids
    FROM cairn_supersessions WHERE ${exactScope} AND previous_id = ?`).get(...scopeKey(scope), id);
  return row && { previousRevision: Number(row.previous_revision), memoryId: String(row.replacement_id),
    revision: Number(row.replacement_revision), receiptIds: /** @type {string[]} */ (decodeJson(row.receipt_ids)) };
}

/** @param {Connection} db @param {Scope} scope @param {readonly string[]} ids @param {ScopedVisibility} visible */
function readSupersessions(db, scope, ids, visible) {
  /** @type {Map<string, SupersessionView>} */
  const result = new Map(ids.map(id => [id, { supersededBy: null, supersedes: [] }]));
  const keys = JSON.stringify([...result.keys()]);
  const rows = db.prepare(`SELECT previous_id, replacement_id FROM cairn_supersessions WHERE ${exactScope}
    AND (previous_id IN (SELECT value FROM json_each(?)) OR replacement_id IN (SELECT value FROM json_each(?)))
    ORDER BY previous_id`).iterate(...scopeKey(scope), keys, keys);
  for (const row of rows) {
    const previous = String(row.previous_id);
    const replacement = String(row.replacement_id);
    if (!visible(previous) || !visible(replacement)) continue;
    const from = result.get(previous);
    if (from) from.supersededBy = replacement;
    result.get(replacement)?.supersedes.push(previous);
  }
  return result;
}

/** @param {Connection} db @param {Scope} scope @param {readonly string[]} ids @param {ScopedVisibility} visible */
export function readConflicts(db, scope, ids, visible) {
  /** @type {Map<string, ConflictEdge[]>} */
  const result = new Map(ids.map(id => [id, []]));
  const keys = JSON.stringify([...result.keys()]);
  const rows = db.prepare(`SELECT left_id, left_revision, right_id, right_revision, source FROM cairn_conflicts WHERE ${exactScope}
    AND (left_id IN (SELECT value FROM json_each(?)) OR right_id IN (SELECT value FROM json_each(?)))`)
    .iterate(...scopeKey(scope), keys, keys);
  for (const { left_id, left_revision, right_id, right_revision, source } of rows) {
    const left = String(left_id);
    const right = String(right_id);
    const a = visible(left);
    const b = visible(right);
    if (!a || !b || a.historical || b.historical || a.revision !== left_revision || b.revision !== right_revision) continue;
    const fields = { relation: /** @type {const} */ ("contradicts"), source: String(source) };
    result.get(left)?.push({ memoryId: right, revision: b.revision, ...fields });
    result.get(right)?.push({ memoryId: left, revision: a.revision, ...fields });
  }
  for (const edges of result.values()) {
    edges.sort((a, b) => compareUtf8(a.memoryId, b.memoryId) || compareUtf8(a.source, b.source));
  }
  return result;
}

/** @param {Connection} db @param {Scope} scope @param {string} id */
function deleteConflicts(db, scope, id) {
  return Number(db.prepare(`DELETE FROM cairn_conflicts WHERE ${conflictScope}`).run(...scopeKey(scope), id, id).changes);
}

/** @param {Port} port @param {IndexRevisions} index @param {PlacementVisibility} visibility */
export function createRelationStores(port, index, visibility) {
  const access = placementPort(port);

  /** @type {SupersessionStore} */
  const supersession = {
    record(tx, callerScope, edge, receiptIds, nowMs) {
      return access(tx, callerScope, write, (db, scope) => {
        const { previous, replacement } = edge;
        validateId(previous.id);
        validateId(replacement.id);
        if (previous.id === replacement.id) throw new CoreError("invalid_ref");
        const { changes } = db.prepare(`INSERT INTO cairn_supersessions VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT (owner_id, namespace_key, previous_id) DO NOTHING`)
          .run(...scopeKey(scope), previous.id, previous.revision, replacement.id, replacement.revision, JSON.stringify(receiptIds), nowMs);
        if (!changes) throw new CoreError("invalid_ref");
        index.markDirty(db, tx);
      });
    },
    markHistorical(tx, callerScope, id, nowMs) {
      return access(tx, callerScope, write, (db, scope) => {
        validateId(id);
        const { updatedAtUs } = writeTime(nowMs);
        const removed = deleteConflicts(db, scope, id);
        const { changes } = db.prepare(`UPDATE cairn_memories SET historical = 1, revision = revision + 1, updated_at_us = ?
          WHERE ${LIVE_SCOPE} AND id = ?`).run(updatedAtUs, ...scopeKey(scope), id);
        if (changes || removed) index.markDirty(db, tx);
      });
    },
    async read(tx, callerScope, id) {
      const rows = await supersession.readMany?.(tx, callerScope, [id]);
      return rows?.get(id) ?? { supersededBy: null, supersedes: [] };
    },
    readMany(tx, callerScope, ids) {
      return access(tx, callerScope, {}, (db, scope) => readSupersessions(db, scope, ids, visibility(db, scope)));
    },
    incomingCount(tx, callerScope, id) {
      return access(tx, callerScope, {}, (db, scope) => Number(db.prepare(`SELECT count(*) AS count
        FROM cairn_supersessions WHERE ${exactScope} AND replacement_id = ?`).get(...scopeKey(scope), id)?.count));
    },
  };

  /** @type {ConflictEdgeStore} */
  const conflicts = {
    insert(tx, callerScope, edge, nowMs) {
      return access(tx, callerScope, write, (db, scope) => {
        const { left, right, relation, source } = edge;
        validateId(left.id);
        validateId(right.id);
        if (relation !== "contradicts" || (source !== "explicit-hint" && source !== "inferred-hint")) invalidInput();
        const [first] = canonicalPair(left.id, right.id);
        const [a, b] = first === left.id ? [left, right] : [right, left];
        const { changes } = db.prepare("INSERT INTO cairn_conflicts VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING")
          .run(...scopeKey(scope), a.id, a.revision, b.id, b.revision, source, nowMs);
        if (changes) index.markDirty(db, tx);
        return { inserted: !!changes };
      });
    },
    async list(tx, callerScope, id) {
      const rows = await conflicts.readMany?.(tx, callerScope, [id]);
      return rows?.get(id) ?? [];
    },
    readMany(tx, callerScope, ids) {
      return access(tx, callerScope, {}, (db, scope) => readConflicts(db, scope, ids, visibility(db, scope)));
    },
    invalidate(tx, callerScope, id) {
      return access(tx, callerScope, write, (db, scope) => {
        const count = deleteConflicts(db, scope, id);
        if (count) index.markDirty(db, tx);
        return count;
      });
    },
    degree(tx, callerScope, id) {
      return access(tx, callerScope, {}, (db, scope) => Number(db.prepare(`SELECT count(*) AS count
        FROM cairn_conflicts WHERE ${conflictScope}`).get(...scopeKey(scope), id, id)?.count));
    },
  };
  return { supersession, conflicts };
}
