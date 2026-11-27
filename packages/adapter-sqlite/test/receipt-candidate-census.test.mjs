import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { MIGRATION_SCHEMA } from "../src/migrate/layout.mjs";
import { legacyRawHash } from "../src/migrate/raw-privacy.mjs";
import { createRawLineage } from "../src/raw-lineage.mjs";
import { installContextReadSchema } from "../src/schema/context-read.mjs";
import { installInspectSchema } from "../src/schema/inspect.mjs";
import { INITIALIZE_STORE, STORAGE_SCHEMA } from "../src/schema/layout.mjs";
import { sessionHasher } from "../src/suppressions.mjs";

// These columns have distinct identifier domains or store payloads or metadata.
// Classify columns explicitly so a new SQLite table or column requires review.
const excluded = {
  // Owner, namespace, client and session coordinates recur across the tables.
  // Capture event keys identify whole batches, and lease tokens are generated.
  cairn_capture_abandoned_tokens: "owner_id client_key event_key token",
  cairn_capture_claims: "owner_id namespace_key client_key event_key session_key payload_digest status token expires_at_ms dispatched failure_code",
  // FinishResult contains memory IDs, counters and model-item positions.
  cairn_capture_outbox: "owner_id client_key event_key result",
  // Relation endpoints and lexical document IDs come from memory records.
  cairn_conflicts: "owner_id namespace_key left_id left_revision right_id right_revision source created_at_ms",
  cairn_context_documents: "projection namespace_key id revision sequence token_length",
  cairn_context_publications: "projection fence incarnation sequence base_sequence checkpoint phase last_id eligible total_length published rebuilt",
  // last_key is an authenticated, randomly sealed cursor under the projection
  // and fence. Its ciphertext is neither an address nor a message ID tag.
  cairn_context_raw_checkpoints: "projection fence last_key examined published",
  cairn_context_terms: "projection namespace_key id term frequency",
  // Inspect anchors refer to receipt IDs. Inspect excerpts are display text.
  cairn_index_revisions: "owner_id revision",
  cairn_inspect_epochs: "owner_id namespace_key epoch",
  cairn_inspect_evidence: "owner_id namespace_key memory_id filing qualification procedural supersession",
  cairn_inspect_identity: "singleton cursor_secret",
  cairn_inspect_receipts: "position owner_id namespace_key memory_id ordinal id excerpt created_at_us",
  // Fingerprints are text digests or composite receipt-denial digests. The
  // receipt-denial policy checks its own address/identity before the exemption.
  cairn_legacy_denials: "owner_id namespace_key fingerprint",
  // The tombstone retains a memory ID and clears the memory payload. Content
  // and the memory source stamp contain text, digests, client/session metadata.
  cairn_memories: "owner_id namespace_key id revision created_at_ms updated_at_us historical deleted text_hash legacy_hash body",
  // The Raw map's source_key is a role/text proof.
  cairn_migrated_raw_maps: "owner_id namespace_key client_key session_key source_key start_utf16 end_utf16 precision",
  cairn_migrated_raw_privacy: "owner_id namespace_key client_key kind",
  cairn_migrated_safety: "owner_id namespace_key kind epoch reason origin",
  // The journal retains controls, counts, receipt-ID attestations and deletion
  // results/effects for conversations, episodes and memories.
  cairn_migration: "singleton migration_id source_version source_digest checkpoint source_evidence attestation",
  cairn_pause: "owner_id paused generation",
  cairn_procedural_tags: "owner_id namespace_key memory_id tag_revision positive origin anchors",
  // The anchor proof includes content. The separate ID tag is tested below.
  cairn_raw_anchors: "owner_id client_key namespace_key session_tag session_hash proof",
  cairn_raw_fences: "owner_id namespace_key session_hash",
  cairn_raw_messages: "owner_id namespace_key client_key session_key role content occurred_at_ms",
  cairn_receipts: "owner_id namespace_key memory_id ordinal legacy_receipt_key",
  cairn_store: "singleton store_id session_hash_key",
  cairn_supersessions: "owner_id namespace_key previous_id previous_revision replacement_id replacement_revision receipt_ids created_at_ms",
  cairn_suppression_epochs: "owner_id epoch",
  // Fact IDs, incarnations and action IDs identify complete facts or actions.
  cairn_suppression_facts: "owner_id namespace_key fact_id incarnation epoch created_at_ms action_id",
  // Placement keys and JSON parent lists are memory or topic identifiers.
  cairn_topic_failures: "owner_id namespace_key memory_id revision code attempts failed_at_ms",
  cairn_topic_memberships: "owner_id namespace_key memory_id topic_id placed_at_us",
  cairn_topic_outcomes: "owner_id namespace_key memory_id revision",
  cairn_topic_sources: "owner_id namespace_key topic_id memory_id revision",
  cairn_topics: "owner_id namespace_key id level title title_hash revision wire_order parent_ids",
  // SQLite records the table name and its last autoincrement position here.
  sqlite_sequence: "name seq",
};

const recorded = { owner: "census-owner", namespace: "personal\0" };
const cited = { ...recorded, namespace: "project\0census" };
const client = "claude-code";
const id = "census-message";
const other = "other-message";
const json = JSON.stringify;
const [owner_id, namespace_key, client_key, session_key, event_key] =
  [recorded.owner, json(recorded.namespace), json(client), json("stored-session"), json("batch-event")];
const coordinates = { owner_id, namespace_key };
const claimKey = { owner_id, client_key, event_key };
const rawKey = { ...coordinates, client_key, session_key };
const claim = { ...claimKey, namespace_key, session_key, payload_digest: "payload", status: "leased",
  token: "lease", expires_at_ms: 100, source_positions: json([{ id: other }]), source_proofs: json([[other, ""]]) };
const receipt = { ...coordinates, memory_id: "memory", ordinal: 1, source_key: json([client, "session", other]),
  body: json({ messageId: other }) };
const span = { ...coordinates, slot: json(["rawSpan", "session-hash", other, 0, 10]),
  fact_id: "fact", incarnation: "incarnation", epoch: "1", created_at_ms: 1, action_id: json("forget"),
  body: json({ kind: "rawSpan", messageKey: other }) };
const rawPrivacy = { ...coordinates, client_key, kind: "span", selector: "session-hash", body: "null" };
const safety = { ...coordinates, kind: "fact", identity: "legacy-fact", origin: "writer",
  body: json({ kind: "raw", source_version: "*", message_key: other }) };
const reserve = { ...safety, kind: "reservation", identity: json(["raw-message", json(["conversation", other])]),
  body: json({ kind: "raw-part", stable_key: json(["conversation", other, 0]) }) };

// The JSON path list records each supported layout. Each witness isolates
// its entry, including columns that normally repeat an address from a sibling
// column or foreign-key target. The live writers are exercised by the
// placeholder receipt and migration suites.
function witnesses(storeKey, lineage) {
  const [[messageTag]] = lineage.proofs(recorded.owner, client, [{ id, content: "" }]);
  return [
    ["cairn_raw_messages", "message_key", "archive including session alias",
      { ...rawKey, session_key: json("legacy-raw:" + "a".repeat(64)), message_key: json(id), role: "user", content: json(other) }],
    ["cairn_raw_anchors", "message_tag", "lineage ID tag",
      { ...coordinates, client_key, message_tag: messageTag, session_tag: "tag", session_hash: "hash", proof: "" }],
    ["cairn_capture_claims", "source_positions", "$[*].id",
      { ...claim, source_positions: json([{ id, occurredAtMs: null }]) }],
    ["cairn_capture_claims", "source_proofs", "$[*][0]",
      { ...claim, source_proofs: json([[messageTag, ""]]) }],
    ["cairn_capture_outbox", "messages", "$[*].id",
      { ...claimKey, messages: json([{ id, content: other }]) }],
    ["cairn_receipts", "source_key", "$[2]",
      { ...receipt, source_key: json([client, "session", id, "retained-receipt-id"]) }],
    ["cairn_receipts", "body", "$.messageId",
      { ...receipt, body: json({ messageId: id, legacy: { spans: [{ sessionId: "legacy-session" }] } }) }],
    ["cairn_suppression_facts", "slot", "$[2] in Raw spans",
      { ...span, slot: json(["rawSpan", "session-hash", id, 0, 10]) }],
    ["cairn_suppression_facts", "body", "$.messageKey in Raw spans",
      { ...span, body: json({ kind: "rawSpan", messageKey: id }) }],
    ["cairn_migrated_raw_privacy", "selector", "keyed UUID fence",
      { ...rawPrivacy, kind: "uuid", selector: legacyRawHash(storeKey, recorded, "local-raw-forgotten-uuid-v1", client, id) }],
    ["cairn_migrated_raw_privacy", "selector", "closed event fence",
      { ...rawPrivacy, kind: "event", selector: id }],
    ["cairn_migrated_raw_privacy", "selector", "closed migration admission",
      { ...rawPrivacy, kind: "admission", selector: id }],
    ["cairn_migrated_raw_privacy", "body", "$[0] in span exclusions",
      { ...rawPrivacy, body: json([id, 0, 10, 1]) }],
    ["cairn_migrated_raw_privacy", "body", "$ in message reservations",
      { ...rawPrivacy, kind: "reservation", body: json(id) }],
    ["cairn_migrated_raw_maps", "message_key", "archive map",
      { ...rawKey, message_key: json(id), source_key: "source-proof", start_utf16: 0, end_utf16: 10, precision: "exact" }],
    ["cairn_migrated_safety", "body", "$.message_key in Raw span facts",
      { ...safety, body: json({ kind: "raw", source_version: "*", message_key: id }) }],
    ["cairn_migrated_safety", "body", "$.source_version decoded as $[1] in Raw version facts",
      { ...safety, body: json({ kind: "raw", source_version: json(["raw-span-v1", id, 0, 10, "exact", [0]]) }) }],
    ["cairn_migrated_safety", "identity", "$[1] decoded as $[1] in Raw child reservations",
      { ...reserve, identity: json(["raw-message", json(["conversation", id])]) }],
    ["cairn_migrated_safety", "body", "$.stable_key decoded as $[1] in Raw child reservations",
      { ...reserve, body: json({ kind: "raw-part", stable_key: json(["conversation", id, 0]) }) }],
  ];
}

test("live SQLite schema classifies every column and each message address disables the exemption", async t => {
  const db = new DatabaseSync(":memory:", { enableForeignKeyConstraints: false });
  t.after(() => db.close());
  db.exec(STORAGE_SCHEMA + INITIALIZE_STORE + MIGRATION_SCHEMA);
  installInspectSchema(db);
  installContextReadSchema(db);
  const storeKey = db.prepare("SELECT session_hash_key FROM cairn_store").get().session_hash_key;
  const lineage = createRawLineage(storeKey, sessionHasher(storeKey));
  const entries = witnesses(storeKey, lineage);
  const includedColumns = [...new Set(entries.map(([table, column]) => table + "." + column))];
  const excludedColumns = Object.entries(excluded).flatMap(([table, columns]) =>
    columns.split(" ").map(column => table + "." + column));
  const live = db.prepare(`SELECT m.name || '.' || c.name AS column
    FROM sqlite_master m, pragma_table_xinfo(m.name) c WHERE m.type = 'table'`).all().map(row => row.column);
  assert.deepEqual([...includedColumns, ...excludedColumns].sort(), live.sort(), "unclassified or overlapping columns");

  for (const [table, column, path, row] of entries) {
    await t.test(`${table}.${column} ${path}`, () => {
      const columns = Object.keys(row);
      assert.ok(columns.includes(column));
      db.exec("SAVEPOINT witness");
      try {
        db.prepare(`INSERT INTO ${table} (${columns.join(", ")})
          VALUES (${columns.map(() => "?").join(", ")})`).run(...Object.values(row));
        assert.equal(lineage.hasReceiptCandidate(db, cited, id), true, "the cited ID is present in this column");
        assert.equal(lineage.hasReceiptCandidate(db, cited, "unrecorded-message"), false);
        assert.equal(lineage.hasReceiptCandidate(db, { ...cited, owner: "different-owner" }, id), false);
      } finally {
        db.exec("ROLLBACK TO witness; RELEASE witness");
      }
    });
  }
});
