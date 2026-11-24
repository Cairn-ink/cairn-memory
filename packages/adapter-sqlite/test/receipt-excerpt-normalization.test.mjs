import assert from "node:assert/strict";
import { test } from "node:test";
import { receiptExcerpt } from "@cairn-ink/core";
import { createMemoryAdapter } from "../../adapter-memory/src/index.mjs";
import { fixture, sha256 } from "./storage-fixtures.mjs";

const scope = { owner: "fixture-owner", namespace: null };

test("F5 write ports require the exact canonical excerpt and accept legacy truncation spaces", async t => {
  const sqlite = await fixture();
  t.after(sqlite.close);
  const memory = createMemoryAdapter({ capabilities: { inspect: true } });
  for (const storage of [memory, sqlite.adapter]) {
    await t.test(storage.name, async () => {
      const insert = (text, excerpt) => storage.uow.run(scope.owner, {}, tx => storage.memories.insert(tx, scope, {
        text, textHash: "sha256:" + sha256(text.toLowerCase()), kind: "fact", confidence: 1,
        origin: "explicit", source: { kind: "mcp", client: null, sessionId: null }, embedding: null,
      }, [{ client: "fixture", sessionId: "session", messageId: text, role: "user", occurredAtMs: 1, excerpt }], 2));
      await assert.rejects(insert("Rejected trailing space", "Source   "), { code: "invalid_input" });
      for (const [index, size] of [799, 800].entries()) {
        const prefix = "x".repeat(size - 1) + " ";
        const full = prefix + (size === 799 ? "🌱" : "next");
        assert.ok(receiptExcerpt(full) === prefix, "Legacy truncation keeps the boundary space");
        await insert("Accepted boundary " + index, prefix);
        assert.ok(receiptExcerpt(prefix) === prefix, "An already truncated excerpt is canonical");
      }
      await assert.rejects(insert("Rejected wide input", "Ｓource"), { code: "invalid_input" });
    });
  }
});
