import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { DatabaseSync } from "node:sqlite";
import { test } from "node:test";
import { receiptExcerpt } from "@cairn-ink/core";
import { openMemoryCore } from "../../../core/index.mjs";
import { openSqliteAdapter } from "../src/index.mjs";
import { migrateLegacyStore } from "../src/migrate/index.mjs";
import { installInspectSchema } from "../src/schema/inspect.mjs";
import { STORAGE_SCHEMA, INITIALIZE_STORE } from "../src/schema/layout.mjs";
import { editFixture, fixture, scratch } from "./legacy/fixtures.mjs";
import { admit, coreScope, createLegacyBackup, personal, prepareInput, sha256 } from "./migration-fixtures.mjs";
import { createMemoryService } from "@cairn-ink/core/service";

const clock = { async hmacHex(key, value) { return createHmac("sha256", key).update(value).digest("hex"); } };

test("F2 legacy conversion and inspect backfill redact quoted credential fields and rekey", async t => {
  const directory = scratch(t);
  const source = await fixture(directory, 18);
  const fake = ["synthetic", "not", "a", "credential"].join("-");
  const excerpt = JSON.stringify({ refresh_token: fake });
  const expected = receiptExcerpt(excerpt);
  assert.ok(expected !== excerpt && expected.includes("[REDACTED]"), "Synthetic field must exercise current redaction");
  const rawSource = { client: "fixture-source", sessionId: "source-session", messageId: "source-turn", role: "user" };
  const { client, sessionId, messageId, role } = rawSource;
  const keyFor = text => sha256(JSON.stringify({ client, sessionId, eventId: messageId, role, excerpt: text }));
  const engine = openMemoryCore({ path: source.path });
  let memory;
  try {
    memory = admit(engine, "A retained synthetic Memory", personal, [{ client, sessionId, eventId: messageId, role, excerpt }]);
  } finally {
    await engine.close();
  }
  editFixture(source.path, db => {
    assert.ok(db.prepare("SELECT excerpt, receipt_key FROM receipts WHERE memory_id = ?").get(memory.id).excerpt === excerpt,
      "Legacy input must retain the original fixture field");
  });
  const input = prepareInput(directory, source);
  await createLegacyBackup(input);
  await migrateLegacyStore(input);
  const scope = coreScope(personal);

  function checkStored(db) {
    const record = db.prepare(`SELECT i.excerpt, r.body, r.legacy_receipt_key FROM cairn_inspect_receipts i
      JOIN cairn_receipts r USING (owner_id, namespace_key, memory_id, ordinal) WHERE i.memory_id = ?`).get(memory.id);
    const body = JSON.parse(record.body);
    assert.ok(record.excerpt === expected && body.legacy.excerpt === expected, "Both excerpt copies must be redacted");
    assert.ok((body.receiptKey ?? record.legacy_receipt_key) === keyFor(expected), "Stored identity must bind redacted bytes");
  }

  await t.test("conversion", async () => {
    editFixture(input.destination, checkStored);
    const adapter = await openSqliteAdapter(input.destination);
    try {
      await adapter.uow.run(scope.owner, { pauseLock: true }, tx => adapter.raw.archive(tx,
        { scope, client, sessionId, eventId: "archive-event", payloadDigest: "a".repeat(64) },
        [{ id: messageId, role, content: expected, occurredAtMs: null }]));
      const item = await createMemoryService({ profile: "keyless-local", storage: adapter, clock }).inspect(scope, { memoryId: memory.id });
      assert.ok(item.receipts.length === 1 && item.receipts[0].excerpt === expected, "Inspect must only deliver redacted bytes");
    } finally {
      await adapter.close();
    }
  });

  await t.test("pre-inspect backfill", () => {
    const old = new DatabaseSync(":memory:");
    try {
      old.exec(STORAGE_SCHEMA + INITIALIZE_STORE);
      editFixture(input.destination, migrated => {
        const { body, text_hash } = migrated.prepare("SELECT body, text_hash FROM cairn_memories WHERE id = ?").get(memory.id);
        old.prepare(`INSERT INTO cairn_memories (owner_id, namespace_key, id, revision, historical, deleted,
          created_at_ms, updated_at_us, text_hash, body) VALUES (?, ?, ?, 1, 0, 0, 1, 1000, ?, ?)`)
          .run(scope.owner, JSON.stringify(scope.namespace), memory.id, text_hash, body);
        const saved = JSON.parse(migrated.prepare("SELECT body FROM cairn_receipts WHERE memory_id = ?").get(memory.id).body);
        delete saved.receiptKey;
        saved.legacy.excerpt = excerpt;
        old.prepare("INSERT INTO cairn_receipts VALUES (?, ?, ?, 1, ?, ?, ?)")
          .run(scope.owner, JSON.stringify(scope.namespace), memory.id, JSON.stringify([client, sessionId, messageId]),
            keyFor(excerpt), JSON.stringify(saved));
      });
      installInspectSchema(old);
      checkStored(old);
    } finally {
      old.close();
    }
  });
});
