import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { createMemoryService } from "../../core/src/service/index.mjs";

const scope = { owner: "owner", namespace: null };
const source = { kind: "mcp", client: null, sessionId: null };
const receipt = { client: "client", sessionId: "explicit-tool", eventId: "event", role: "user", occurredAtMs: null };
const text = "The spare key is in the cabinet.";

async function setup() {
  const adapter = createMemoryAdapter();
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
  await seed({ actionId: "window", kind: "window", client: null, window: { startMs: 10, endMs: 20 }, unknownTime: true });
  return { seed, receiptCandidates, save: input => service.save(scope, text, source, "fact", { receipt: input }) };
}

for (const [name, input, times, status] of [
  ["a placeholder receipt", receipt, [], "saved"],
  ["another null-time receipt", { ...receipt, sessionId: "session" }, [null], "suppressed"],
  ["a finite-time receipt in the placeholder session", { ...receipt, occurredAtMs: 15 }, [15], "suppressed"],
]) {
  test(`the snapshot fallback returns ${status} for ${name}`, async () => {
    const { receiptCandidates, save } = await setup();
    const result = await save(input);
    assert.equal(result.status, status);
    if (status === "saved") assert.equal(result.item.text, text);
    assert.deepEqual(receiptCandidates, [{ client: input.client, sessionId: input.sessionId, occurredAtMs: times }]);
  });
}

test("the snapshot fallback still applies a session fact to a placeholder receipt", async () => {
  const { seed, receiptCandidates, save } = await setup();
  const { client, sessionId } = receipt;
  await seed({ actionId: "session", kind: "session", session: { client, sessionId } });
  assert.equal((await save(receipt)).status, "suppressed");
  assert.deepEqual(receiptCandidates, [{ client, sessionId, occurredAtMs: [] }]);
});
