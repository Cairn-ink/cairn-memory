import { randomBytes } from "node:crypto";
import { CoreError, receiptExcerpt } from "../../../core/src/index.mjs";
import { decodeJson } from "../memory-rows.mjs";
import { receiptIdentityKey } from "../receipt-identity.mjs";
import { scopeKey } from "../storage-values.mjs";

/** @import { InspectItemEvidence } from "@cairn-ink/core/ports" */
/** @import { Connection } from "../storage-values.mjs" */
/** @import { LegacyInput } from "../legacy/migration-input.mjs" */
/** @import { StoredReceipt } from "../receipt-identity.mjs" */

export const INSPECT_TABLES = Object.freeze([
  "cairn_inspect_identity", "cairn_inspect_epochs", "cairn_inspect_receipts",
  "cairn_inspect_evidence", "sqlite_sequence",
]);

const schema = `
  CREATE TABLE cairn_inspect_identity (
    singleton INTEGER PRIMARY KEY CHECK (singleton = 1)
      REFERENCES cairn_store (singleton),
    cursor_secret TEXT NOT NULL
  ) STRICT;

  CREATE TABLE cairn_inspect_epochs (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    epoch INTEGER NOT NULL CHECK (epoch BETWEEN 1 AND 9007199254740991),
    PRIMARY KEY (owner_id, namespace_key)
  ) STRICT, WITHOUT ROWID;

  CREATE INDEX cairn_inspect_memory_page ON cairn_memories (owner_id, namespace_key, updated_at_us DESC, id ASC)
    WHERE deleted = 0;

  CREATE TABLE cairn_inspect_receipts (
    position INTEGER PRIMARY KEY AUTOINCREMENT CHECK (position BETWEEN 1 AND 9007199254740991),
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL,
    id TEXT NOT NULL UNIQUE,
    excerpt TEXT,
    created_at_us INTEGER NOT NULL,
    UNIQUE (owner_id, namespace_key, memory_id, ordinal),
    FOREIGN KEY (owner_id, namespace_key, memory_id, ordinal)
      REFERENCES cairn_receipts (owner_id, namespace_key, memory_id, ordinal) ON DELETE CASCADE
  ) STRICT;

  CREATE INDEX cairn_inspect_receipt_page ON cairn_inspect_receipts
    (owner_id, namespace_key, memory_id, created_at_us, id);

  CREATE TABLE cairn_inspect_evidence (
    owner_id TEXT NOT NULL,
    namespace_key TEXT NOT NULL,
    memory_id TEXT NOT NULL,
    filing TEXT NOT NULL CHECK (filing IN ('filed', 'unfiled')),
    qualification TEXT,
    procedural TEXT,
    supersession TEXT,
    PRIMARY KEY (owner_id, namespace_key, memory_id),
    FOREIGN KEY (owner_id, namespace_key, memory_id)
      REFERENCES cairn_memories (owner_id, namespace_key, id) ON DELETE CASCADE
  ) STRICT, WITHOUT ROWID;

  CREATE TRIGGER cairn_inspect_forget_evidence AFTER UPDATE OF deleted, text_hash ON cairn_memories
    WHEN OLD.deleted != NEW.deleted OR OLD.text_hash IS NOT NEW.text_hash
    BEGIN
      DELETE FROM cairn_inspect_evidence WHERE owner_id = OLD.owner_id
        AND namespace_key = OLD.namespace_key AND memory_id = OLD.id;
    END;
`;

/** @param {string} table */
function epochTriggers(table) {
  return ["INSERT", "UPDATE", "DELETE"].map(operation => {
    const row = operation === "DELETE" ? "OLD" : "NEW";
    return `
      CREATE TRIGGER ${table}_inspect_${operation.toLowerCase()} AFTER ${operation} ON ${table} BEGIN
        INSERT INTO cairn_inspect_epochs VALUES (${row}.owner_id, ${row}.namespace_key, 2)
          ON CONFLICT (owner_id, namespace_key) DO UPDATE SET epoch = epoch + 1;
      END;
    `;
  }).join("");
}

const triggers = ["cairn_memories", "cairn_receipts", "cairn_suppression_facts", "cairn_legacy_denials",
  "cairn_inspect_evidence", "cairn_topic_memberships", "cairn_supersessions", "cairn_conflicts"].map(epochTriggers).join("");

// An empty namespace key is reserved for Raw changes that can affect forks
// in other namespaces. Ordinary inspect epochs retain their existing binding.
export const RAW_INSPECT_EPOCH_KEY = "";

/** @param {string} table @param {boolean} crossScopeOnly */
function rawEpochTriggers(table, crossScopeOnly) {
  return ["INSERT", "UPDATE", "DELETE"].map(operation => {
    const row = operation === "DELETE" ? "OLD" : "NEW";
    return `
      CREATE TRIGGER IF NOT EXISTS ${table}_inspect_raw_${operation.toLowerCase()} AFTER ${operation} ON ${table}
        ${crossScopeOnly ? `WHEN EXISTS (SELECT 1 FROM cairn_raw_anchors WHERE owner_id = ${row}.owner_id)` : ""}
      BEGIN
        INSERT INTO cairn_inspect_epochs VALUES (${row}.owner_id, '${RAW_INSPECT_EPOCH_KEY}', 1)
          ON CONFLICT (owner_id, namespace_key) DO UPDATE SET epoch = epoch + 1;
      END;
    `;
  }).join("");
}

const rawTriggers = ["cairn_raw_fences", "cairn_raw_messages", "cairn_raw_anchors"].map(table => rawEpochTriggers(table, false)).join("") +
  ["cairn_suppression_facts", "cairn_legacy_denials"].map(table => rawEpochTriggers(table, true)).join("");

/** @param {string} date */
function legacyTimeUs(date) {
  const parsed = Date.parse(date);
  if (!Number.isSafeInteger(parsed)) throw new CoreError("storage_error");
  const fraction = /\.(\d{4,6})Z$/u.exec(date)?.[1];
  return BigInt(parsed) * 1000n + BigInt(fraction?.padEnd(6, "0").slice(3) ?? 0);
}

/**
 * Append the inspect layout to an attested CNXT store. Populate only evidence
 * that the base conversion retained or the cold legacy reader qualified.
 * @param {Connection} db @param {LegacyInput["inspect"]} [source]
 * @param {() => LegacyInput["inspect"]["evidence"]} [projectEvidence]
 */
export function installInspectSchema(db, source, projectEvidence) {
  db.exec(schema);
  db.prepare("INSERT INTO cairn_inspect_identity VALUES (1, ?)").run(source?.cursorSecret ?? randomBytes(32).toString("hex"));

  const legacyReceipts = db.prepare(`SELECT owner_id, namespace_key, memory_id, ordinal, body, legacy_receipt_key
    FROM cairn_receipts
    WHERE json_type(body, '$.legacy.id') = 'text' AND json_type(body, '$.legacy.excerpt') = 'text'
      AND json_type(body, '$.legacy.createdAt') = 'text'`);
  const receipt = db.prepare("INSERT INTO cairn_inspect_receipts VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const updateReceipt = db.prepare(`UPDATE cairn_receipts SET body = ?
    WHERE owner_id = ? AND namespace_key = ? AND memory_id = ? AND ordinal = ?`);
  for (const row of legacyReceipts.all()) {
    const body = /** @type {StoredReceipt & {legacy: NonNullable<StoredReceipt["legacy"]>}} */ (decodeJson(row.body));
    const { id, excerpt: original, createdAt } = body.legacy;
    const key = body.receiptKey ?? row.legacy_receipt_key;
    const hasIdentity = key === receiptIdentityKey({ ...body, excerpt: original });
    const excerpt = receiptExcerpt(original);
    const coordinates = [row.owner_id, row.namespace_key, row.memory_id, row.ordinal];
    const rawAncestryEmpty = source?.rawAncestryEmpty.get(id);
    if (rawAncestryEmpty !== undefined) body.legacyRawAncestryEmpty = rawAncestryEmpty;
    if (excerpt !== original) {
      body.legacy.excerpt = excerpt;
      if (hasIdentity) body.receiptKey = receiptIdentityKey({ ...body, excerpt });
    }
    if (rawAncestryEmpty !== undefined || excerpt !== original) {
      updateReceipt.run(JSON.stringify(body), ...coordinates);
    }
    const position = source?.receiptPositions.get(id) ?? null;
    receipt.run(position, ...coordinates, id, hasIdentity ? excerpt : null, legacyTimeUs(createdAt));
  }

  if (source) {
    const evidence = db.prepare("INSERT INTO cairn_inspect_evidence VALUES (?, ?, ?, ?, ?, ?, ?)");
    const procedural = db.prepare(`INSERT INTO cairn_procedural_tags
      (owner_id, namespace_key, memory_id, tag_revision, positive, origin, anchors) VALUES (?, ?, ?, ?, ?, ?, ?)`);
    const epoch = db.prepare("INSERT INTO cairn_inspect_epochs VALUES (?, ?, ?)");
    for (const item of projectEvidence?.() ?? source.evidence) {
      const coordinates = [...scopeKey(item.scope), item.id];
      const tag = /** @type {InspectItemEvidence["procedural"]} */ (decodeJson(item.procedural));
      if (tag) {
        const { tagRevision, procedural: positive, origin, anchors } = tag;
        procedural.run(...coordinates, tagRevision, Number(positive), origin, positive ? JSON.stringify(anchors) : null);
      }
      evidence.run(...coordinates, item.filing, item.qualification, null, item.supersession);
    }
    for (const { scope, value } of source.epochs) epoch.run(...scopeKey(scope), value);
  }
  db.exec(triggers + rawTriggers);
}
