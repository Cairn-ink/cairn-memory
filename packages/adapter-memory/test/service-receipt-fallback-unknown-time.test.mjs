import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { createMemoryService } from "../../core/src/service/index.mjs";

const scope = { owner: "owner", namespace: null };
const source = { kind: "mcp", client: null, sessionId: null };
const receipt = { client: "client", sessionId: "explicit-tool", eventId: "event", role: "user", occurredAtMs: null };
const text = "The spare key is in the cabinet.";

function setup() {
  const adapter = createMemoryAdapter({ capabilities: { rawArchive: true } });
  const { snapshot, factsFor, writeFact, epoch } = adapter.suppressions;
  const receiptCandidates = [];
  const storage = { ...adapter, suppressions: {
    factsFor, writeFact, epoch,
    async snapshot(tx, target, candidates) {
      if (Object.hasOwn(candidates, "occurredAtMs")) receiptCandidates.push(candidates);
      return snapshot(tx, target, candidates);
    },
  } };
  assert.equal("receiptWithheld" in storage.suppressions, false);
  const service = createMemoryService({
    storage, model: null, embedder: null, config: {},
    gate: { async assertOpen() {} },
    clock: {
      nowMs: () => 100, monotonicMs: () => 0,
      async sha256Hex(value) { return createHash("sha256").update(value).digest("hex"); },
      hmacHex: () => assert.fail("Unexpected keyed hashing"),
    },
    tokens: { countTokens: () => 1 },
  });
  const seed = fact => adapter.harness.seedFact(scope.owner, { ...scope, origin: "forget", ...fact });
  const seedWindow = (client = null) => seed({ actionId: "window", kind: "window", client,
    window: { startMs: 10, endMs: 20 }, unknownTime: true });
  return { adapter, seed, seedWindow, receiptCandidates, save: input => service.save(scope, text, source, "fact", { receipt: input }) };
}

for (const [name, input] of [
  ["a placeholder receipt", receipt],
  ["another null-time receipt", { ...receipt, sessionId: "session" }],
  ["a finite-time receipt in the placeholder session", { ...receipt, occurredAtMs: 15 }],
]) {
  test(`the snapshot fallback suppresses ${name} when a window matches`, async () => {
    const { receiptCandidates, save, seedWindow } = setup();
    await seedWindow();
    const { client, sessionId, occurredAtMs } = input;
    assert.equal((await save(input)).status, "suppressed");
    assert.deepEqual(receiptCandidates, [{ client, sessionId, occurredAtMs: [occurredAtMs] }]);
  });
}

test("the snapshot fallback suppresses a receipt citing timeless Raw when a window matches", async () => {
  const { adapter, receiptCandidates, save, seedWindow } = setup();
  const client = "codex";
  const { sessionId, role, occurredAtMs } = receipt;
  const key = { scope, client, sessionId, eventId: "archive-event", payloadDigest: "a".repeat(64) };
  const message = { id: "raw-message", role, occurredAtMs, content: text };
  const archived = await adapter.uow.run(scope.owner, {}, tx => adapter.raw.archive(tx, key, [message]));
  assert.deepEqual(archived, { archived: 1 });
  await seedWindow();

  assert.equal((await save({ client, sessionId, eventId: message.id, role, occurredAtMs })).status, "suppressed");
  assert.deepEqual(receiptCandidates, [{ client, sessionId, occurredAtMs: [null] }]);
});

test("the snapshot fallback still applies a session fact to a placeholder receipt", async () => {
  const { seed, seedWindow, save } = setup();
  const { client, sessionId } = receipt;
  await seedWindow("other-client");
  await seed({ actionId: "session", kind: "session", session: { client, sessionId } });
  assert.equal((await save(receipt)).status, "suppressed");
});
