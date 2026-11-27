import assert from "node:assert/strict";
import { test } from "node:test";
import { CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { decodeCursor, encodeCursor } from "../src/retrieval/hosted-paging.mjs";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const readScope = { owner: scope.owner, namespaces: [scope.namespace] };
const skipped = { status: "not_searched", count: 0 };
const unwired = { ...skipped, code: "capability_unavailable" };
const query = "private search passage";
const code = expected => error => error instanceof CoreError && error.code === expected && error.message === expected;

function segment(id, score = 0) {
  return {
    ref: { type: "raw", id, namespace: scope.namespace },
    client: "client", sessionId: "conversation", messageId: id, role: "user",
    content: "  archived passage\nwith original spacing  ", occurredAtMs: 12, score,
  };
}

function fixture(options) {
  const fake = serviceFake(options);
  const { storage } = fake;
  const transactions = [];
  const { assertVisible } = storage.fence;
  storage.capabilities.rawArchive = true;
  storage.raw = {
    async listRaw() { assert.fail("unexpected raw listing"); },
    async raw() { assert.fail("unexpected raw search"); },
  };
  storage.fence.assertVisible = async (tx, selection, refs, intent) => {
    transactions.push({ tx, selection, refs, intent });
    return (await assertVisible(tx, selection, refs, intent)).reverse().map(ref => ({ ...ref }));
  };
  return { ...fake, service: createMemoryService(fake.deps), transactions };
}

test("raw listing uses one read-only snapshot and advances from the store position after a fence drop", async () => {
  const { service, storage, hooks, calls, transactions } = fixture();
  const hidden = segment("hidden");
  const first = segment("first");
  const last = segment("last");
  hooks.hideAtFence = ref => ref.id === hidden.ref.id;
  const pages = [];
  storage.raw.listRaw = async (tx, selection, page) => {
    pages.push({ tx, selection, page });
    return page.cursor === null ? { items: [first, hidden], nextCursor: "store-position" } :
      { items: [last], nextCursor: null };
  };

  const page = await service.listRawMessages(scope, { cursor: null, limit: 2.8 });
  assert.deepEqual(page.items, [first]);
  const [route, owner, namespace, token, inner] = decodeCursor(page.nextCursor);
  assert.deepEqual([route, owner, namespace, inner], ["raw-export-v1", scope.owner, scope.namespace, "store-position"]);
  assert.equal(typeof token, "string");
  const second = await service.listRawMessages(scope, { cursor: page.nextCursor, limit: 1 });
  assert.deepEqual(second, { items: [last], nextCursor: null });

  assert.equal(transactions.length, 2);
  assert.equal(pages.length, 2);
  assert.deepEqual(pages.map(({ page }) => page), [{ cursor: null, limit: 2 }, { cursor: "store-position", limit: 1 }]);
  assert.deepEqual(transactions.map(({ refs }) => refs), [[first.ref, hidden.ref], [last.ref]]);
  for (const [index, { tx, selection }] of pages.entries()) {
    assert.equal(transactions[index].tx, tx, "listRaw and fence must use the same transaction");
    assert.equal(transactions[index].selection, selection);
    assert.deepEqual(selection, readScope);
    assert.deepEqual(tx.options, { readOnly: true });
    assert.equal(transactions[index].intent, undefined);
  }
  assert.deepEqual(calls, [
    ["run", scope.owner, { readOnly: true }], ["snapshot.stateToken", readScope],
    ["fence.assertVisible", readScope, [first.ref, hidden.ref]],
    ["run", scope.owner, { readOnly: true }], ["snapshot.assertUnchanged", readScope, token],
    ["fence.assertVisible", readScope, [last.ref]],
  ]);
});

test("raw listing validates its page and binds a cursor to route, scope, and snapshot", async () => {
  const { service, storage, calls, insert } = fixture();
  const inner = encodeCursor(["store-token", "store-binding", 12, "position"]);
  storage.raw.listRaw = async () => ({ items: [], nextCursor: inner });
  const first = await service.listRawMessages(scope, { cursor: null, limit: 1 });
  assert.deepEqual(first.items, []);
  const [route, owner, namespace, token] = decodeCursor(first.nextCursor);
  calls.length = 0;

  for (const page of [null, [], { limit: "1" }, { unexpected: true }]) {
    await assert.rejects(service.listRawMessages(scope, page), code("invalid_input"));
  }
  for (const cursor of [9, "!", encodeCursor({ token }), encodeCursor([route, owner, namespace, token]),
    encodeCursor([route, owner, namespace, token, ""]), encodeCursor([route, owner, namespace, false, inner])]) {
    await assert.rejects(service.listRawMessages(scope, { cursor, limit: 1 }), code("invalid_cursor"));
  }
  for (const cursor of [inner, encodeCursor(10), encodeCursor(["export-v1", owner, namespace, token, inner])]) {
    await assert.rejects(service.listRawMessages(scope, { cursor, limit: 1 }), code("cursor_stale"));
  }
  for (const target of [{ ...scope, owner: "other" }, { ...scope, namespace: "project" }]) {
    await assert.rejects(service.listRawMessages(target, { cursor: first.nextCursor, limit: 1 }), code("cursor_stale"));
  }
  assert.deepEqual(calls, []);

  insert(memory("write-between-pages"));
  storage.raw.listRaw = async () => assert.fail("stale cursor must not reach listRaw");
  await assert.rejects(service.listRawMessages(scope, { cursor: first.nextCursor, limit: 1 }), code("cursor_stale"));
  assert.deepEqual(calls, [["run", scope.owner, { readOnly: true }], ["snapshot.assertUnchanged", readScope, token]]);
});

test("both raw routes check the capability and port before calling dependencies", async () => {
  for (const enabled of [false, true]) {
    const { deps, storage, calls } = serviceFake();
    storage.capabilities.rawArchive = enabled;
    if (!enabled) storage.raw = {
      async listRaw() { assert.fail("disabled raw listing"); },
      async raw() { assert.fail("disabled raw search"); },
    };
    const service = createMemoryService(deps);
    await assert.rejects(service.listRawMessages(scope, { cursor: null, limit: 1 }), code("capability_unavailable"));
    assert.deepEqual(await service.find(scope, query, { kinds: ["raw"] }), {
      memories: [], cards: [], raw: [], layers: { memory: skipped, card: skipped, raw: unwired },
    });
    assert.deepEqual(calls, []);
  }
});

test("raw find forwards filters and fences in the same snapshot without reordering store results", async () => {
  const { service, storage, hooks, transactions, calls } = fixture();
  const first = segment("first", 3);
  const hidden = segment("hidden", 2);
  const last = segment("last", 1);
  hooks.hideAtFence = ref => ref.id === hidden.ref.id;
  let candidateCall;
  storage.raw.raw = async (...args) => {
    candidateCall = args;
    return { segments: [first, hidden, last], coverage: { complete: false } };
  };
  const result = await service.find(scope, `  ${query}  `, {
    kinds: ["raw"], clients: ["client", "client", "other"], sinceMs: 10, untilMs: 20, limit: 3,
  });
  assert.deepEqual(result, {
    memories: [], cards: [], raw: [first, last],
    layers: { memory: skipped, card: skipped, raw: { status: "ok", count: 2, code: "index_unavailable" } },
  });
  assert.equal(transactions.length, 1);
  const [tx, selection, text, intent, options] = candidateCall;
  assert.equal(transactions[0].selection, selection);
  assert.equal(transactions[0].intent, undefined);
  assert.deepEqual(transactions[0].refs, [first.ref, hidden.ref, last.ref]);
  assert.deepEqual(selection, { ...readScope, clients: ["client", "other"], window: { sinceMs: 10, untilMs: 20 } });
  assert.deepEqual([text, intent, options], [query, "search", { limit: 3 }]);
  assert.deepEqual({
    fenceRun: transactions[0].tx.runId,
    runs: calls.filter(([name]) => name === "run"),
  }, { fenceRun: tx.runId + 1, runs: Array(2).fill(["run", scope.owner, { readOnly: true }]) });
});

test("raw find skips null and blank queries", async () => {
  const { service, calls } = fixture();
  for (const blank of [null, "", " \n\t "]) {
    const result = await service.find(scope, blank, { kinds: ["raw"] });
    assert.deepEqual(result.raw, []);
    assert.deepEqual(result.layers.raw, skipped);
  }
  assert.deepEqual(calls, []);
});

test("raw find uses the memory layer's single query embedding", async () => {
  const row = memory("memory");
  const { service, storage, hooks, calls } = fixture({ rows: [row], recall: true, semantic: true });
  hooks.lexicalScore = () => 1;
  let rawOptions;
  storage.raw.raw = async (_tx, _scope, _query, _intent, options) => {
    rawOptions = options;
    return { segments: [], coverage: { complete: true } };
  };
  const result = await service.find(scope, query, { kinds: ["memory", "raw"] });
  assert.deepEqual(result.memories, [row]);
  assert.deepEqual(result.layers.raw, { status: "ok", count: 0 });
  assert.equal(calls.filter(([name]) => name === "embedQuery").length, 1);
  assert.equal(rawOptions.queryVector, calls.find(([name]) => name === "vector.vector")[2]);
});

test("raw failures are content-free and isolate the raw layer", async () => {
  const row = memory("memory");
  const { storage, hooks, deps } = fixture({ rows: [row], recall: true });
  const diagnostics = [];
  const service = createMemoryService({ ...deps, diagnostics: event => diagnostics.push(event) });
  hooks.lexicalScore = () => 1;
  const item = segment("private-raw-id");
  const fail = () => { throw new Error(`${query} ${item.ref.id} ${item.content}`); };
  const fence = storage.fence.assertVisible;
  const options = { kinds: ["memory", "card", "raw"] };
  const expected = { memories: [row], cards: [], raw: [], layers: {
    memory: { status: "ok", count: 1 }, card: unwired, raw: { status: "unavailable", count: 0, code: "internal_error" },
  } };
  storage.raw.raw = fail;
  assert.deepEqual(await service.find(scope, query, options), expected);
  storage.raw.raw = async () => ({ segments: [item], coverage: { complete: true } });
  storage.fence.assertVisible = (...args) => args[2].some(({ type }) => type === "raw") ? fail() : fence(...args);
  assert.deepEqual(await service.find(scope, query, options), expected);
  storage.raw.listRaw = fail;
  await assert.rejects(service.listRawMessages(scope, { limit: 1, cursor: null }), code("internal_error"));
  assert.ok(diagnostics.length > 0, "memory search emits its normal diagnostics");
  assert.doesNotMatch(JSON.stringify(diagnostics), /private search passage|private-raw-id|archived passage/);

  storage.fence.assertVisible = fence;
  storage.raw.listRaw = async () => ({ items: [item], nextCursor: "opaque-position" });
  const { nextCursor } = await service.listRawMessages(scope, { limit: 1, cursor: null });
  assert.doesNotMatch(JSON.stringify(decodeCursor(nextCursor)), /private search passage|private-raw-id|archived passage/);
});
