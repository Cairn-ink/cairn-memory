import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { openMemoryStore } from "../core/index.mjs";

// Always use a new synthetic database; never overwrite an existing user's data.
const path = join(mkdtempSync(join(tmpdir(), "cairn-store-demo-")), "memory.sqlite");
const boundary = { ownerId: "demo-user", projectId: "demo-project" };
const record = (content, eventId) => ({
  content, kind: "preference",
  receipt: { client: "example", sessionId: "session-a", eventId, role: "user", excerpt: content },
});

let store = openMemoryStore({ path });
try {
  let memory = store.scope(boundary);
  const saved = memory.remember(record("I prefer green tea", "initial"));
  store.close();

  store = openMemoryStore({ path });
  memory = store.scope(boundary);
  const recalled = memory.search("green tea")[0];
  assert.equal(recalled.id, saved.id);
  assert.equal(recalled.receipts[0].eventId, "initial");
  assert.deepEqual(store.scope({ ownerId: "other-user" }).search("tea"), []);

  const corrected = memory.correct(saved.id, record("I prefer coffee", "correction"), saved.revision);
  assert.deepEqual(memory.search("tea"), []);
  assert.equal(memory.forget(corrected.id, corrected.revision), true);
  assert.deepEqual(memory.search("coffee"), []);
  assert.throws(() => memory.remember(record("I prefer coffee", "replay")),
    (error) => error.code === "memory_suppressed");
  console.log("PASS: persist → reopen → lexical lookup + receipt → isolate → correct → forget → reject replay");
  console.log(`Synthetic database retained at ${path}`);
  console.log("Storage example only: no model extraction, semantic recall, MCP server, or account.");
} finally {
  store.close();
}
