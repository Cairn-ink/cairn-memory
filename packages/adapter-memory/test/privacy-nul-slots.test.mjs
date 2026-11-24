import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { factIncarnationBody } from "@cairn-ink/core";

const owner = "test-owner";
const base = { owner, actionId: "test-action", origin: "forget" };
const sessionHash = "a".repeat(64);
const span = { ...base, kind: "rawSpan", sessionKeyHash: sessionHash, startUtf16: 1, endUtf16: 3, contentDigest: "b".repeat(64) };

test("memory keeps quoted and escaped identity targets containing NUL distinct", async () => {
  await assertDistinct(createMemoryAdapter(),
    { ...base, kind: "identity", namespace: "a,b", memoryId: 'c"\\\u0000' },
    { ...base, kind: "identity", namespace: "a", memoryId: 'b,c"\\\u0000' });
});

const pairs = [
  ["identity", { ...base, kind: "identity", namespace: "a\u0000b", memoryId: "c" },
    { ...base, kind: "identity", namespace: "a", memoryId: "b\u0000c" },
    ({ namespace, memoryId, throughRevision }) => [namespace, memoryId, throughRevision]],
  ["session", { ...base, kind: "session", session: { client: "a\u0000id\u0000b", sessionId: "c" } },
    { ...base, kind: "session", session: { client: "a", sessionId: "b\u0000id\u0000c" } },
    ({ namespace, session }) => [namespace, session.client, "id", session.sessionId]],
  ["raw span", { ...span, namespace: `a\u0000${sessionHash}\u0000b`, messageKey: "c" },
    { ...span, namespace: "a", messageKey: `b\u0000${sessionHash}\u0000c` },
    ({ namespace, sessionKeyHash, messageKey, startUtf16, endUtf16 }) =>
      [namespace, sessionKeyHash, messageKey, startUtf16, endUtf16]],
];

function sha256(text) {
  return createHash("sha256").update(text).digest("hex");
}

async function assertDistinct(adapter, first, second) {
  const { uow, suppressions } = adapter;
  const write = (fact) => uow.run(owner, {}, (tx) =>
    suppressions.writeFact(tx, fact, sha256(factIncarnationBody(fact))));
  const a = await write(first);
  const b = await write(second);
  assert.equal(a.created, true);
  assert.equal(b.created, true);
  assert.notEqual(a.factId, b.factId);
  assert.equal(b.epoch, a.epoch + 1n);
}

for (const [kind, first, second, target] of pairs) {
  test(`memory keeps NUL-delimited ${kind} targets distinct`, async () => {
    const options = { capabilities: { rawSpans: true } };
    await assertDistinct(createMemoryAdapter(options), first, second);

    const adapter = createMemoryAdapter(options);
    const { suppressions } = adapter;
    const mutant = { ...adapter, suppressions: { ...suppressions, writeFact(tx, fact, incarnation) {
      const memoryId = sha256(target(fact).join("\u0000"));
      return suppressions.writeFact(tx, { ...base, kind: "identity", memoryId }, incarnation);
    } } };
    await assert.rejects(assertDistinct(mutant, first, second), { code: "fact_conflict" });
  });
}
