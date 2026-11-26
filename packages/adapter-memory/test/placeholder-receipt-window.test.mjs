import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { coreDigest } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";

const scope = { owner: "owner", namespace: null };
const selection = { owner: scope.owner, namespaces: [scope.namespace] };
const source = { kind: "mcp", client: null, sessionId: null };
const receipt = {
  client: "client", sessionId: "explicit-tool", messageId: "message", role: "user",
  occurredAtMs: null, excerpt: "The spare hinge is in the cabinet.",
};
const message = { id: receipt.messageId, role: receipt.role, occurredAtMs: null, content: receipt.excerpt };

function fixture() {
  const adapter = createMemoryAdapter({ capabilities: { rawArchive: true, inspect: true, contextRead: true } });
  const { uow, suppressions, harness, memories, inspect, contextRead } = adapter;
  const read = fn => uow.run(scope.owner, { readOnly: true }, fn);
  const write = fn => uow.run(scope.owner, {}, fn);
  const seed = fact => harness.seedFact(scope.owner, { ...scope, origin: "forget", ...fact });
  const window = client => seed({
    actionId: "window", kind: "window", client, window: { startMs: 10, endMs: 20 }, unknownTime: true,
  });
  return {
    adapter, read, write, seed, window,
    withheld: (input = receipt, admitted) => read(tx => suppressions.receiptWithheld(tx, scope, input, admitted)),
    async insert(input = receipt, text = "A cabinet holds spare hardware.") {
      const { value } = await coreDigest(text);
      const { id } = await write(tx => memories.insert(tx, scope, {
        kind: "fact", origin: "explicit", text, textHash: `sha256:${value}`, confidence: 1, source, embedding: null,
      }, [input], 25));
      return id;
    },
    inspected: id => read(async tx => (await inspect.item(tx, scope, id, { limit: 10 })).item.receipts),
    evidence: id => read(async tx => {
      const [row] = await contextRead.evidence(tx, { ...selection, accessGenerations: [1] },
        [{ type: "memory", scope, id }], "current");
      return row.receipts;
    }),
  };
}

for (const [label, client] of [["global", null], ["client-scoped", receipt.client]]) {
  test(`receiptWithheld permits a placeholder under a ${label} window`, async () => {
    const f = fixture();
    await f.window(client);
    assert.equal(await f.withheld(), false);
  });

  test(`receiptWithheld permits a placeholder with admitted content under a ${label} window`, async () => {
    const f = fixture();
    await f.window(client);
    assert.equal(await f.withheld(receipt, message), false);
  });

  test(`inspect returns a placeholder under a ${label} window`, async () => {
    const f = fixture();
    const id = await f.insert();
    await f.window(client);
    assert.deepEqual((await f.inspected(id)).map(({ excerpt }) => excerpt), [receipt.excerpt]);
  });

  test(`context read returns a placeholder under a ${label} window`, async () => {
    const f = fixture();
    const id = await f.insert();
    await f.window(client);
    assert.deepEqual((await f.evidence(id)).map(({ excerpt }) => excerpt), [receipt.excerpt]);
  });

  test(`explicit save succeeds through the adapter snapshot under a ${label} window`, async () => {
    const f = fixture();
    await f.window(client);
    const snapshots = [];
    const { snapshot } = f.adapter.suppressions;
    f.adapter.suppressions.snapshot = async (tx, target, candidates) => {
      const result = await snapshot(tx, target, candidates);
      snapshots.push({ occurredAtMs: candidates.occurredAtMs, blockedMessages: result.blockedMessages });
      return result;
    };
    const service = createMemoryService({
      storage: f.adapter, model: null, embedder: null, config: {},
      gate: { async assertOpen() {} },
      clock: {
        nowMs: () => 25, monotonicMs: () => 0,
        async sha256Hex(value) { return createHash("sha256").update(value).digest("hex"); },
        hmacHex: () => assert.fail("Unexpected keyed hashing"),
      },
      tokens: { countTokens: () => 1 },
    });
    const { status } = await service.save(scope, receipt.excerpt, source, "fact", { receipt });
    assert.deepEqual({ status, snapshots }, {
      status: "saved", snapshots: [{ occurredAtMs: undefined, blockedMessages: [] }],
    });
  });

  test(`a ${label} window withholds other null-time receipts and finite-time matches`, async () => {
    const f = fixture();
    const unknown = { ...receipt, sessionId: "unknown" };
    const id = await f.insert(unknown);
    await f.window(client);
    assert.equal(await f.withheld(unknown), true);
    assert.equal(await f.withheld(unknown, message), true);
    assert.equal(await f.withheld({ ...receipt, occurredAtMs: 15 }), true);
    assert.deepEqual(await f.inspected(id), []);
    assert.deepEqual(await f.evidence(id), []);

    const snapshot = await f.read(tx => f.adapter.suppressions.snapshot(tx, scope, {
      client: receipt.client, sessionId: receipt.sessionId, occurredAtMs: [null, 15, 20],
    }));
    assert.deepEqual(snapshot.blockedMessages, [0, 1]);
  });
}

test("a session fact still withholds a placeholder receipt", async () => {
  const f = fixture();
  await f.window(null);
  const { client, sessionId } = receipt;
  await f.seed({ actionId: "session", kind: "session", session: { client, sessionId } });
  assert.equal(await f.withheld(), true);
});

test("a text fact matching the excerpt still withholds a placeholder receipt", async () => {
  const f = fixture();
  const id = await f.insert();
  await f.window(null);
  await f.seed({ actionId: "text", kind: "text", mode: "exact", text: { digests: [await coreDigest(receipt.excerpt)] } });
  assert.equal(await f.withheld(), true);
  assert.deepEqual(await f.inspected(id), []);
  assert.deepEqual(await f.evidence(id), []);
});

test("erasing a memory still denies its placeholder receipt", async () => {
  const f = fixture();
  const id = await f.insert();
  const other = await f.insert(receipt, "Spare hardware belongs in the cabinet.");
  await f.window(null);
  assert.equal(await f.write(tx => f.adapter.memories.erase(tx, scope, id)), true);
  assert.equal(await f.withheld(), true);
  assert.deepEqual(await f.inspected(other), []);
  assert.deepEqual(await f.evidence(other), []);
});

for (const [label, input] of [
  ["a custom prototype", Object.assign(Object.create({}), receipt)],
  ["an accessor", { ...receipt, get occurredAtMs() { return null; } }],
]) {
  test(`a receipt with ${label} is still withheld by an unknown-time window`, async () => {
    const f = fixture();
    const id = await f.insert(input);
    await f.window(null);
    assert.equal(await f.withheld(input), true);
    assert.equal(await f.withheld(input, message), true);
    assert.deepEqual(await f.inspected(id), []);
    assert.deepEqual(await f.evidence(id), []);
  });
}

test("a timeless archived Raw turn is still hidden from list and search", async () => {
  const f = fixture();
  const { raw } = f.adapter;
  const { client, sessionId } = receipt;
  const key = { scope, client, sessionId, eventId: "event", payloadDigest: "a".repeat(64) };
  const list = () => f.read(tx => raw.listRaw(tx, selection, { limit: 10, cursor: null }));
  const search = () => f.read(tx => raw.raw(tx, selection, "cabinet", "search", { limit: 10 }));
  assert.deepEqual(await f.write(tx => raw.archive(tx, key, [message])), { archived: 1 });
  assert.deepEqual((await list()).items.map(({ messageId }) => messageId), [message.id]);
  assert.deepEqual((await search()).segments.map(({ messageId }) => messageId), [message.id]);

  await f.window(client);
  assert.deepEqual((await list()).items, []);
  assert.deepEqual((await search()).segments, []);
  assert.equal(await f.withheld(), true);
});

for (const [label, windowClient] of [["global", null], ["client-scoped", "codex"]]) {
  test(`a placeholder receipt citing an archived timeless Raw turn stays withheld under a ${label} window`, async () => {
    const f = fixture();
    const { raw } = f.adapter;
    const cited = { ...receipt, client: "codex" };
    const key = { scope, client: cited.client, sessionId: cited.sessionId, eventId: "event", payloadDigest: "a".repeat(64) };
    assert.deepEqual(await f.write(tx => raw.archive(tx, key, [message])), { archived: 1 });
    assert.equal(await f.withheld(cited), false);

    await f.window(windowClient);
    assert.equal(await f.withheld(cited), true);
    assert.equal(await f.withheld(cited, message), true);
    const service = createMemoryService({
      storage: f.adapter, model: null, embedder: null, config: {},
      gate: { async assertOpen() {} },
      clock: {
        nowMs: () => 25, monotonicMs: () => 0,
        async sha256Hex(value) { return createHash("sha256").update(value).digest("hex"); },
        hmacHex: () => assert.fail("Unexpected keyed hashing"),
      },
      tokens: { countTokens: () => 1 },
    });
    assert.equal((await service.save(scope, cited.excerpt, source, "fact", { receipt: cited })).status, "suppressed");
  });
}
