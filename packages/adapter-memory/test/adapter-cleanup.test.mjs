import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { CoreError } from "@cairn-ink/core";

const scope = { owner: "owner", namespace: null };
const captureKey = (sessionId, client = "client") => ({
  scope, client, sessionId, eventId: sessionId, payloadDigest: "a".repeat(64),
});
const message = (id) => ({ id, role: "user", content: "cedar", occurredAtMs: null });

for (const mode of ["archive", "importArchive"]) {
  test(`${mode} rejects an empty message ID before writing any row in the batch`, async () => {
    const { harness, raw, uow } = createMemoryAdapter({ capabilities: { rawArchive: true } });
    const key = captureKey("source");
    const submit = (ids) => uow.run(scope.owner, {}, (tx) => {
      const messages = ids.map(message);
      return mode === "archive" ? raw.archive(tx, key, messages) : raw.importArchive(tx, scope, key, messages);
    });
    const before = await harness.dump();
    await assert.rejects(submit(["valid", ""]), { code: "invalid_input" });
    assert.deepEqual(await harness.dump(), before);

    const ids = [" msg ", "a".repeat(512)];
    assert.equal((await submit(ids)).archived, ids.length);
    const [{ rawRows }] = await harness.dump();
    assert.deepEqual(new Set(rawRows.map(({ messageId }) => messageId)), new Set(ids));
  });
}

test("an unlocked claim rejects before reading the capture key", async () => {
  const { capture, uow } = createMemoryAdapter();
  let reads = 0;
  const key = {
    get scope() {
      reads++;
      throw new CoreError("invalid_input");
    },
  };
  await assert.rejects(uow.run(scope.owner, {}, (tx) => capture.claim(tx, key, [], { leaseMs: 1 })),
    { code: "internal_error" });
  assert.equal(reads, 0);
  await assert.rejects(uow.run(scope.owner, { pauseLock: true }, (tx) => capture.claim(tx, key, [], { leaseMs: 1 })),
    { code: "invalid_input" });
  assert.equal(reads, 1);
});
