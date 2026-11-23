import assert from "node:assert/strict";
import { test } from "node:test";
import { CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const skipped = { status: "not_searched", count: 0 };
const unwired = { ...skipped, code: "capability_unavailable" };
const isInvalid = error => error instanceof CoreError && error.code === "invalid_input";
const filters = { sinceMs: 10, untilMs: 20, clients: ["a", "a", "b"] };
const readScope = { owner: scope.owner, namespaces: [scope.namespace], window: { sinceMs: 10, untilMs: 20 }, clients: ["a", "b"] };

test("find defaults to eight memories ranked exactly like recall and marks the card layer unwired", async () => {
  for (const semantic of [false, true]) {
    const rows = Array.from({ length: 10 }, (_, index) => memory(`row-${index}`));
    const { deps, hooks } = serviceFake({ rows, recall: true, semantic });
    hooks.lexicalScore = row => Number(row.id.slice(-1)) + 1;
    hooks.vectorDistance = row => Number(row.id.slice(-1)) / 10;
    const service = createMemoryService(deps);
    const page = await service.recall(scope, "  Query ", { mode: "search", cursor: null, limit: 8 });
    assert.equal(page.items.length, 8);
    assert.deepEqual(await service.find(scope, "  Query ", {}), {
      memories: page.items, cards: [], raw: [],
      layers: { memory: { status: "ok", count: 8 }, card: unwired, raw: skipped },
    });
  }
});

test("find reports each requested but unwired layer without querying memory", async () => {
  const { deps, calls } = serviceFake();
  const service = createMemoryService(deps);
  assert.deepEqual(await service.find(scope, "query", { kinds: ["card", "raw"] }), {
    memories: [], cards: [], raw: [], layers: { memory: skipped, card: unwired, raw: unwired },
  });
  assert.deepEqual(calls, []);
});

test("find rejects malformed requests before any port call", async () => {
  const { deps, calls } = serviceFake();
  const service = createMemoryService(deps);
  for (const options of [
    undefined, null, [], new Date(0), { cursor: null },
    ...[0, 21, 1.5, Infinity, NaN, "8", null].map(limit => ({ limit })),
    ...[[], ["memory", "memory"], ["invalid"], Array(1), "memory", null].map(kinds => ({ kinds })),
    ...[[], [""], ["\uD800"], [1], Array(1), "client", null].map(clients => ({ clients })),
    ...[-1, 1.5, Infinity, Number.MAX_SAFE_INTEGER + 1, "1", null].flatMap(bound =>
      [{ sinceMs: bound }, { untilMs: bound }]),
    { sinceMs: 10, untilMs: 10 }, { sinceMs: 11, untilMs: 10 },
  ]) {
    await assert.rejects(service.find(scope, "query", options), isInvalid);
  }
  for (const query of [undefined, 1, {}]) await assert.rejects(service.find(scope, query, {}), isInvalid);
  await assert.rejects(service.find({ ...scope, owner: "" }, null, {}), isInvalid);
  assert.deepEqual(calls, []);
});

test("find forwards window and deduped clients to the search read set in both runs", async () => {
  const row = memory("match");
  const { deps, hooks, calls } = serviceFake({ rows: [row], recall: true, semantic: true });
  hooks.lexicalScore = () => 1;
  hooks.vectorDistance = () => 0.1;
  const result = await createMemoryService(deps).find(scope, "query", { ...filters, kinds: ["memory"] });
  assert.deepEqual(result.memories, [row]);
  assert.deepEqual(result.layers, { memory: { status: "ok", count: 1 }, card: skipped, raw: skipped });
  const ports = calls.filter(([method]) => method.includes("."));
  assert.deepEqual(ports.map(([method]) => method), [
    "snapshot.stateToken", "lexical.lexical", "vector.vector", "hydrate.hydrate", "hydrate.hydrate", "fence.assertVisible",
  ]);
  for (const [, selection] of ports) assert.deepEqual(selection, readScope);
});

test("null and blank find use recent with the requested window and clients", async () => {
  const rows = [
    { ...memory("match"), createdAtMs: 10, source: { client: "a" } },
    { ...memory("too-late"), createdAtMs: 20, source: { client: "a" } },
    { ...memory("no-client"), createdAtMs: 12, source: { client: null } },
  ];
  const { deps, storage, calls } = serviceFake({ rows, recall: true });
  storage.recent.recent = async (tx, selection, page) => {
    assert.equal(tx.options.readOnly, true);
    assert.deepEqual(selection, readScope);
    assert.deepEqual(page, { cursor: null, limit: 1 });
    const { window: { sinceMs, untilMs }, clients } = selection;
    const items = rows.filter(row => clients.includes(row.source.client) &&
      row.createdAtMs >= sinceMs && row.createdAtMs < untilMs).slice(0, page.limit);
    return { items, nextCursor: null };
  };
  const service = createMemoryService(deps);
  for (const query of [null, " \n\t "]) {
    assert.deepEqual((await service.find(scope, query, { ...filters, limit: 1 })).memories, [rows[0]]);
  }
  const fences = calls.filter(([method]) => method === "fence.assertVisible");
  assert.equal(fences.length, 2);
  for (const [, selection] of fences) assert.deepEqual(selection, readScope);
});

test("find maps a lexical port failure to a content-free unavailable memory layer", async () => {
  const { deps, hooks } = serviceFake({ rows: [memory("match")], recall: true });
  const service = createMemoryService(deps);
  for (const [failure, code] of [
    [new CoreError("storage_busy"), "storage_busy"],
    [new Error("private port detail"), "internal_error"],
  ]) {
    hooks.lexicalScore = () => { throw failure; };
    assert.deepEqual(await service.find(scope, "query", { kinds: ["memory", "raw"] }), {
      memories: [], cards: [], raw: [],
      layers: { memory: { status: "unavailable", count: 0, code }, card: skipped, raw: unwired },
    });
  }
});

test("find drops forgotten, hidden, and out-of-scope memory rows", async () => {
  const rows = [
    memory("visible"), memory("forgotten"), memory("hidden"),
    memory("other-owner", { scope: { ...scope, owner: "another-owner" } }),
    memory("other-namespace", { scope: { ...scope, namespace: "another-namespace" } }),
  ];
  const fake = serviceFake({ rows, recall: true, leakForgotten: true });
  fake.hooks.lexicalScore = () => 1;
  fake.hooks.hideAtFence = ref => ref.id === "hidden";
  fake.forget(rows[1]);
  const service = createMemoryService(fake.deps);
  assert.deepEqual((await service.find(scope, "query", {})).memories, [rows[0]]);
});

test("find fences in a fresh run after a forget commits during hydration", async () => {
  const row = memory("forgotten-during-search");
  const fake = serviceFake({ rows: [row], recall: true });
  fake.hooks.lexicalScore = () => 1;
  fake.hooks.hydrate = () => { fake.commitForget(row); };
  const result = await createMemoryService(fake.deps).find(scope, "query", {});
  assert.deepEqual(result.memories, []);
  assert.deepEqual(result.layers.memory, { status: "ok", count: 0 });
  assert.deepEqual(fake.calls.map(([method]) => method), [
    "run", "snapshot.stateToken", "lexical.lexical", "hydrate.hydrate", "run", "hydrate.hydrate", "fence.assertVisible",
  ]);
});
