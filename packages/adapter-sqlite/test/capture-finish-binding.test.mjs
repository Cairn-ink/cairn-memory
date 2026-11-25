import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { captureFixture } from "./capture-fixtures.mjs";
import { sha256 } from "./storage-fixtures.mjs";

test("finish with an unasserted receipt leaves no memory text in the closed database", async t => {
  const fixture = await captureFixture();
  t.after(fixture.close);
  const { adapter } = fixture;
  const { capture, memories, uow } = adapter;
  const scope = { owner: "owner", namespace: null };
  const session = { client: "client", sessionId: "session" };
  const key = { scope, ...session, eventId: "event", payloadDigest: sha256("event") };
  const messages = [
    { id: "first", role: "user", content: "Label the seed tray.", occurredAtMs: 10 },
    { id: "second", role: "user", content: "Water the seed tray.", occurredAtMs: 20 },
  ];
  const output = ["The basil tray has a copper label.", "The thyme tray has a brass watering can."];
  const items = messages.map(({ id, role, occurredAtMs }, position) => ({
    content: output[position], kind: "fact", confidence: 0.8, embedding: null,
    textHash: "sha256:" + sha256(output[position]),
    receipts: [{ ...session, messageId: id, role, occurredAtMs }],
  }));
  const write = work => uow.run(scope.owner, { pauseLock: true }, work);
  assert.deepEqual(await write(tx => capture.admit(tx, key, messages)), { status: "admitted" });
  const claim = await write(tx => capture.claim(tx, key, messages, { leaseMs: 100 }));
  assert.equal(claim.status, "claimed");

  await assert.rejects(write(async tx => {
    await capture.assertEligible(tx, key, [0]);
    return capture.finish(tx, claim.token, items);
  }), { code: "suppressed" });
  const page = await uow.run(scope.owner, { readOnly: true }, tx =>
    memories.exportPage(tx, scope, { cursor: null, limit: 10 }));
  assert.deepEqual(page.items, []);

  await adapter.close();
  const bytes = readFileSync(fixture.path);
  for (const content of output) assert.equal(bytes.includes(content), false);
});
