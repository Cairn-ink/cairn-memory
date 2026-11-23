import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { amendmentId, buildDocumentCard } from "@cairn-ink/core/routing";

const sha256 = identity => createHash("sha256").update(JSON.stringify(identity)).digest("hex");

test("a document card ID is the SHA-256 hex of its identity JSON", async () => {
  const { card } = await buildDocumentCard(
    { id: "message", role: "user", content: "Garden guide" },
    { scope: { owner: "owner", namespace: null }, client: "client", canonicalSessionKey: "session" },
  );

  assert.ok(card);
  assert.equal(card.id, sha256(["document-card", "owner", null, "client", "session", "message", 1]));
});

test("an amendment ID is the SHA-256 hex of its identity JSON with a normalized quote", async () => {
  const id = await amendmentId(
    "card",
    { client: "client", sessionId: "later-session", messageId: "later-message" },
    "  標籤\u0085改成\t藍色。\n",
  );

  assert.equal(id, sha256(["document-card-amendment", "card", "client", "later-session", "later-message", "標籤 改成 藍色。"]));
});
