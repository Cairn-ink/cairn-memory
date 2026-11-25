import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { captureFixture } from "./capture-fixtures.mjs";
import { seedFact, sha256 } from "./storage-fixtures.mjs";

test("a committed session suppression rejects the finish transaction at assertion", async t => {
  const fixture = await captureFixture();
  t.after(fixture.close);
  let { adapter } = fixture;
  const scope = { owner: "owner", namespace: null };
  const session = { client: "client", sessionId: "session" };
  const key = { scope, ...session, eventId: "event", payloadDigest: sha256("event") };
  const message = { id: "message", role: "user", content: "The sample tray is on the shelf.", occurredAtMs: 10 };
  const content = "The sample tray has a copper handle.";
  const item = {
    content, kind: "fact", confidence: 0.8, textHash: "sha256:" + sha256(content), embedding: null,
    receipts: [{ ...session, messageId: message.id, role: message.role, occurredAtMs: message.occurredAtMs }],
  };
  const write = work => adapter.uow.run(scope.owner, { pauseLock: true }, work);
  const claim = await write(tx => adapter.capture.claim(tx, key, [message], { leaseMs: 100 }));
  assert.equal(claim.status, "claimed");
  await seedFact(adapter, { ...scope, actionId: "block-session", origin: "forget", kind: "session",
    session: { client: key.client, sessionKeyHash: adapter.hashSessionKey(scope, key.client, key.sessionId) } });
  await adapter.close();
  const before = readFileSync(fixture.path);
  adapter = await fixture.reopen();

  let reachedFinish = false;
  await assert.rejects(write(async tx => {
    await adapter.capture.assertEligible(tx, key, [0]);
    reachedFinish = true;
    return adapter.capture.finish(tx, claim.token, [item]);
  }), { code: "suppressed" });
  assert.equal(reachedFinish, false);
  const page = await adapter.uow.run(scope.owner, { readOnly: true }, tx =>
    adapter.memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
  assert.deepEqual(page.items, []);

  await adapter.close();
  const after = readFileSync(fixture.path);
  assert.equal(after.includes(content), false);
  assert.deepEqual(after, before);
});
