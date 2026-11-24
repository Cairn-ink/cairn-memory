import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { contextReadTestService } from "../../conformance/src/context-read-cases.mjs";
import { createMemoryAdapter } from "../src/index.mjs";

test("F4 capture receipts bind the source message and keep retention time outside the common port", async () => {
  const scope = { owner: "fixture-owner", namespace: "personal\0" };
  const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
  const adapter = createMemoryAdapter({ now: () => 200, capabilities: { contextRead: true, inspect: true } });
  const service = contextReadTestService(adapter);
  const key = { scope, client: "fixture-source", sessionId: "session", eventId: "capture-batch", payloadDigest: "a".repeat(64) };
  const message = { id: "turn-1", role: "user", content: "Source turn", occurredAtMs: 100 };
  const write = action => adapter.uow.run(scope.owner, { pauseLock: true }, action);
  const messages = [message];
  assert.equal((await write(tx => adapter.capture.admit(tx, key, messages))).status, "admitted");
  const claim = await write(tx => adapter.capture.claim(tx, key, messages, { leaseMs: 10_000 }));
  assert.equal(claim.status, "claimed");
  await write(tx => adapter.capture.beginDispatch(tx, claim.token));
  const body = "Persisted synthetic Memory";
  const result = await write(tx => adapter.capture.finish(tx, claim.token, [{
    content: body, kind: "fact", confidence: 0.8, embedding: null,
    textHash: "sha256:" + createHash("sha256").update(body.toLowerCase()).digest("hex"),
    receipts: [{ client: key.client, sessionId: key.sessionId, messageId: message.id, role: message.role, occurredAtMs: null }],
  }]));
  const { id, revision } = result.memories[0];
  const inspected = await service.inspect(scope, { memoryId: id });
  const receipt = inspected.receipts[0];
  assert.deepEqual([receipt.eventId, receipt.messageId, receipt.occurredAtMs, receipt.createdAtMs], ["turn-1", "turn-1", 100, 200]);

  const ref = { type: "memory", scope, id, revision };
  const fetched = await service.fetchEvidence(readSet, { refs: [ref], intent: "current" });
  const { storeId, cursorKey } = await adapter.uow.run(scope.owner, { readOnly: true }, tx => adapter.contextRead.identity(tx));
  const binding = JSON.stringify(["retained-receipt-content-v1", [storeId, [
    { ownerId: scope.owner, scope: "personal", projectId: null }, id, revision, receipt.id,
    key.client, key.sessionId, message.id, message.role, message.content,
  ]]]);
  const expected = createHmac("sha256", cursorKey).update(binding).digest("base64url");
  assert.ok(fetched.items[0].provenance.sources[0].contentIdentity === expected, "Fetch identity must bind the legacy source event");

  const types = readFileSync(new URL("../../core/src/ports/common.d.ts", import.meta.url), "utf8");
  const declaration = /export interface Receipt \{([^}]+)\}/u.exec(types)[1];
  assert.doesNotMatch(declaration, /\b(eventId|createdAtMs)\?/u);
});
