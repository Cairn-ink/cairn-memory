import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { contextReadTestService } from "@cairn-ink/conformance/context-read";
import { createMemoryAdapter } from "../src/index.mjs";

const scope = { owner: "fixture-owner", namespace: "project\0read" };
const outside = { ...scope, namespace: "project\0outside" };
const readSet = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
const session = sessionId => ({ client: "fixture-client", sessionId });
const message = (id, content = "albatross sighting") => ({ id, content, role: "user", occurredAtMs: null });
const receipt = (address, turn) => ({ ...address, messageId: turn.id, role: turn.role,
  occurredAtMs: turn.occurredAtMs, excerpt: turn.content });
const write = (adapter, action) => adapter.uow.run(scope.owner, { pauseLock: true }, action);
const read = (adapter, action) => adapter.uow.run(scope.owner, { readOnly: true }, action);

const fixture = () => createMemoryAdapter({ capabilities: { inspect: true,
  contextRead: true, contextRawRead: true, rawArchive: true, fingerprintKey: true } });

async function archive(adapter, target, address, turns, record = false) {
  await write(adapter, async tx => {
    const key = { scope: target, ...address, eventId: address.sessionId, payloadDigest: "a".repeat(64) };
    assert.equal((await adapter.raw.archive(tx, key, turns)).archived, turns.length);
    if (record) await adapter.raw.recordLineage(tx, key, turns);
  });
}

async function insert(adapter, text, receipts = [], now = 1) {
  const textHash = "sha256:" + createHash("sha256").update(text.toLowerCase()).digest("hex");
  const row = await write(adapter, tx => adapter.memories.insert(tx, scope, {
    text, kind: "fact", confidence: 1, origin: "explicit", embedding: null, textHash,
    source: { kind: "mcp", client: null, sessionId: null },
  }, receipts, now));
  return { type: "memory", scope, id: row.id, revision: row.revision };
}

test("fenced Raw rows do not spend the row or text caps", async () => {
  const adapter = fixture();
  const search = () => read(adapter, tx => adapter.contextRead.raw.search(tx, readSet, "albatross",
    { limit: 24, lexicalOnly: true }));
  for (const [address, count, text] of [
    [session("long-fenced"), 216, "x".repeat(20_000)],
    [session("many-fenced"), 4097, "short"],
  ]) {
    await archive(adapter, scope, address, Array.from({ length: count }, (_, i) => message(`hidden-${i}`, text)));
    await write(adapter, tx => adapter.raw.fenceSession(tx, scope, address));
  }
  const safe = message("safe-turn");
  await archive(adapter, scope, session("safe"), [safe]);
  const result = await search();
  assert.equal(result.coverage, "included");
  assert.deepEqual(result.turns.map(turn => turn.messageId), [safe.id]);
});

test("inspect continuations bind relevant receipt safety across namespaces", async () => {
  const adapter = fixture();
  const root = session("root"), fork = session("fork");
  const shared = message("shared-turn");
  await archive(adapter, outside, root, [shared], true);
  await archive(adapter, scope, fork, [shared], true);
  const safe = receipt(session("standalone"), message("safe-turn", "independent source"));
  const memory = await insert(adapter, "Memory with two receipts", [safe], 1);
  await write(adapter, tx => adapter.memories.touchDuplicate(tx, scope, memory.id,
    [receipt(fork, shared)], { confidence: 1 }, 2));
  await insert(adapter, "Second Memory for listing", [], 3);
  const inspect = contextReadTestService(adapter).inspect;
  const itemInput = { memoryId: memory.id, receiptLimit: 1 };
  const firstItem = await inspect(scope, itemInput);
  const firstList = await inspect(scope, { limit: 1 });
  assert.equal(firstItem.receipts[0].messageId, safe.messageId);
  assert.ok(firstItem.nextReceiptCursor);
  assert.ok(firstList.nextCursor);

  const unrelated = session("unrelated");
  await archive(adapter, outside, unrelated, [message("unrelated-turn")]);
  await write(adapter, tx => adapter.raw.fenceSession(tx, outside, unrelated));
  assert.equal((await inspect(scope, itemInput)).nextReceiptCursor, firstItem.nextReceiptCursor);
  assert.equal((await inspect(scope, { limit: 1 })).nextCursor, firstList.nextCursor);
  const nextItem = () => inspect(scope, { ...itemInput, receiptCursor: firstItem.nextReceiptCursor });
  const nextList = () => inspect(scope, { limit: 1, cursor: firstList.nextCursor });
  assert.deepEqual((await nextItem()).receipts.map(row => row.messageId), [shared.id]);
  assert.deepEqual((await nextList()).memories.map(row => row.id), [memory.id]);

  await write(adapter, tx => adapter.raw.fenceSession(tx, outside, root));
  await assert.rejects(nextItem, { code: "cursor_stale" });
  await assert.rejects(nextList, { code: "cursor_stale" });
  assert.deepEqual((await inspect(scope, itemInput)).receipts.map(row => row.messageId), [safe.messageId]);
});

test("fetch caps qualified receipts after withholding unsafe receipts", async () => {
  const adapter = fixture();
  const address = session("fenced-receipts");
  const denied = Array.from({ length: 17 }, (_, i) => message(`denied-${i}`, "withheld source"));
  await archive(adapter, scope, address, denied);
  const ref = await insert(adapter, "Memory with many receipts", denied.map(turn => receipt(address, turn)));
  const safe = Array.from({ length: 17 }, (_, i) => receipt(session("safe-receipts"),
    message(`safe-${i}`, `safe source ${i}`)));
  for (const [i, item] of safe.entries()) {
    await write(adapter, tx => adapter.memories.touchDuplicate(tx, scope, ref.id, [item], { confidence: 1 }, i + 2));
  }
  await write(adapter, tx => adapter.raw.fenceSession(tx, scope, address));

  const service = contextReadTestService(adapter);
  const inspected = await service.inspect(scope, { memoryId: ref.id });
  assert.deepEqual(inspected.receipts.map(row => row.messageId), safe.map(row => row.messageId));
  const current = await read(adapter, tx => adapter.memories.get(tx, scope, ref.id));
  const result = await service.fetchEvidence(readSet, { refs: [{ ...ref, revision: current.revision }], intent: "current" });
  const { provenance } = result.items[0];
  assert.deepEqual(provenance.sources.map(row => row.receiptId), inspected.receipts.slice(0, 16).map(row => row.id));
  assert.deepEqual(provenance.coverage, { status: "budget_exhausted", included: 16, omitted: null });
});
