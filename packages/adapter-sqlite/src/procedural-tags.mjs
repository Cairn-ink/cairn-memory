import { CoreError } from "@cairn-ink/core";
import { decodeJson, readEntry } from "./memory-rows.mjs";
import { invalidInput, scopeKey, validateId } from "./storage-values.mjs";
import { scopedSuppression } from "./suppressions.mjs";

/** @import { ProceduralTag, ProceduralTagStore, Scope } from "@cairn-ink/core/ports" */
/** @import { Connection, Port } from "./storage-values.mjs" */
/** @import { SessionHasher } from "./suppressions.mjs" */
/** @import { Policy } from "./receipt-read-safety.mjs" */
/** @typedef {(db: Connection, scope: Scope, policy: Policy, id: string, anchors: ProceduralTag["anchors"]) => boolean | null} AnchorVisibility */

const inMemory = "owner_id = ? AND namespace_key = ? AND memory_id = ?";

/** @param {Connection} db @param {Scope} scope @param {string} id @returns {ProceduralTag | null} */
export function readProceduralTag(db, scope, id) {
  const row = db.prepare(`SELECT tag_revision, positive, origin, anchors FROM cairn_procedural_tags
    WHERE ${inMemory}`).get(...scopeKey(scope), id);
  if (!row) return null;
  return {
    tagRevision: Number(row.tag_revision), positive: row.positive === 1,
    origin: /** @type {ProceduralTag["origin"]} */ (row.origin),
    anchors: row.anchors === null ? [] : decodeJson(row.anchors),
  };
}

/** @param {Connection} db @param {Scope} scope @param {string} id */
export function clearProceduralTag(db, scope, id) {
  const cleared = db.prepare(`UPDATE cairn_procedural_tags
    SET tag_revision = tag_revision + 1, positive = 0, origin = NULL, anchors = NULL
    WHERE ${inMemory} AND positive = 1`).run(...scopeKey(scope), id);
  const legacy = db.prepare(`UPDATE cairn_inspect_evidence SET procedural = NULL
    WHERE ${inMemory} AND procedural IS NOT NULL`).run(...scopeKey(scope), id);
  return Boolean(cleared.changes || legacy.changes);
}

/** @param {Connection} db @param {Scope} scope @param {string} id */
export function deleteProceduralTag(db, scope, id) {
  db.prepare(`DELETE FROM cairn_procedural_tags WHERE ${inMemory}`).run(...scopeKey(scope), id);
}

/** @param {Connection} db @param {Scope} scope */
function advanceInspectEpoch(db, scope) {
  db.prepare(`INSERT INTO cairn_inspect_epochs (owner_id, namespace_key, epoch) VALUES (?, ?, 2)
    ON CONFLICT (owner_id, namespace_key) DO UPDATE SET epoch = epoch + 1`).run(...scopeKey(scope));
}

/** @param {Port} port @param {SessionHasher} hashSession @param {AnchorVisibility} anchorsVisible
 * @param {ReturnType<typeof import("./index-revisions.mjs").createIndexRevisions>["markDirty"]} markDirty
 * @returns {ProceduralTagStore}
 */
export function createProceduralTagStore(port, hashSession, anchorsVisible, markDirty) {
  return {
    write(tx, scope, id, tag) {
      return port(tx, scope?.owner, { write: true }, db => {
        validateId(id);
        const entry = readEntry(db, scope, id);
        if (!entry) throw new CoreError("memory_not_found");
        if (entry.row.historical) throw new CoreError("memory_historical");
        const policy = scopedSuppression(db, scope, hashSession);
        if (policy.hides(entry)) throw new CoreError("suppressed");
        const { positive, origin, anchors } = tag;
        if (typeof positive !== "boolean" || (origin !== null && origin !== "explicit" && origin !== "inferred") ||
            !Array.isArray(anchors) || (positive
              ? (entry.row.kind !== "instruction" && entry.row.kind !== "preference") || anchors.length < 1 || anchors.length > 4
              : origin !== null || anchors.length !== 0)) invalidInput();
        const stored = Array.from(anchors, anchor => {
          if (!anchor) invalidInput();
          const { receiptId, digest, start, end } = anchor;
          return { receiptId, digest, start, end };
        });
        if (positive && !anchorsVisible(db, scope, policy, id, stored)) invalidInput();
        db.prepare(`INSERT INTO cairn_procedural_tags
          (owner_id, namespace_key, memory_id, tag_revision, positive, origin, anchors) VALUES (?, ?, ?, 1, ?, ?, ?)
          ON CONFLICT (owner_id, namespace_key, memory_id) DO UPDATE SET tag_revision = tag_revision + 1,
            positive = excluded.positive, origin = excluded.origin, anchors = excluded.anchors`)
          .run(...scopeKey(scope), id, Number(positive), origin, positive ? JSON.stringify(stored) : null);
        advanceInspectEpoch(db, scope);
        markDirty(db, tx);
      });
    },

    clear(tx, scope, id) {
      return port(tx, scope?.owner, { write: true }, db => {
        validateId(id);
        if (clearProceduralTag(db, scope, id)) {
          advanceInspectEpoch(db, scope);
          markDirty(db, tx);
        }
      });
    },

    read(tx, scope, id) {
      return port(tx, scope?.owner, {}, db => {
        validateId(id);
        const entry = readEntry(db, scope, id);
        const policy = scopedSuppression(db, scope, hashSession);
        if (!entry || policy.hides(entry)) return null;
        const tag = readProceduralTag(db, scope, id);
        return tag?.positive && !anchorsVisible(db, scope, policy, id, tag.anchors) ? null : tag;
      });
    },
  };
}
