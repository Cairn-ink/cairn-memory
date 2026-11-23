import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { CoreError, decodeCursor, encodeCursor } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope, memory, serviceFake } from "./helpers/service-fake.mjs";

const golden = JSON.parse(readFileSync(new URL("./fixtures/retrieval/hosted-cases.json", import.meta.url), "utf8"));
const readScope = { owner: hostedScope.owner, namespaces: [null] };
const page = { mode: "search", cursor: null, limit: 10 };
const code = expected => error => error instanceof CoreError && error.code === expected && error.message === expected;
const ids = ({ items }) => items.map(row => row.id);
const methods = ({ calls }) => calls.map(([method]) => method);

function recallFixture({ lexical = golden.lexical, vector = golden.vector, semantic = true, preset } = {}) {
  const rows = new Map([...lexical, ...vector].map(([id, , us]) => [id, memory(id, { updatedAtUs: BigInt(us) })]));
  const fake = serviceFake({ rows: [...rows.values()], recall: true, semantic });
  const scores = new Map(lexical.map(([id, score]) => [id, score]));
  const distances = new Map(vector.map(([id, distance]) => [id, distance]));
  fake.hooks.lexicalScore = row => scores.get(row.id);
  fake.hooks.vectorDistance = row => distances.get(row.id);
  fake.deps.config = { fusionPreset: preset };
  return fake;
}

function assertLexical(result) {
  assert.deepEqual(ids(result), golden.lexicalOnlyIds);
  assert.deepEqual(result.scores, [12, 10, 10, 10]);
  assert.equal(result.nextCursor, null);
}

test("hosted recall fuses the golden pools and gates the send before a single read-only run", async () => {
  const fake = recallFixture();
  const service = createMemoryService(fake.deps);
  const result = await service.recall(hostedScope, "A Query", page);

  // Hosted src/memory/search.ts:32–61. Ranks and exact timestamp/ID ties are from hosted-cases.json.
  assert.deepEqual(ids(result), golden.fused.map(([id]) => id));
  assert.deepEqual(result.scores, golden.fused.map(([, lexical, vector]) =>
    (lexical === null ? 0 : 0.5 / (60 + lexical)) + (vector === null ? 0 : 1 / (60 + vector))));
  assert.equal(result.nextCursor, null);
  assert.deepEqual(methods(fake), [
    "gate", "embedQuery", "run", "snapshot.stateToken", "lexical.lexical", "vector.vector", "hydrate.hydrate", "fence.assertVisible",
  ]);
  const [gate, embed, run, token, lexical, vector, hydrate, fence] = fake.calls;
  assert.deepEqual(gate, ["gate", hostedScope.owner, "dispatch"]);
  assert.deepEqual(embed, ["embedQuery", hostedScope.owner, "a query", { budgetClass: "recall" }]);
  assert.deepEqual(run, ["run", hostedScope.owner, { readOnly: true }]);
  assert.deepEqual(token, ["snapshot.stateToken", readScope]);
  assert.deepEqual(lexical, ["lexical.lexical", readScope, "A Query", 50, {}]);
  assert.deepEqual(vector, ["vector.vector", readScope, Float32Array.of(1), "query-model", 50]);
  const refs = ids(result).map(id => ({ type: "memory", namespace: null, id }));
  assert.deepEqual(hydrate, ["hydrate.hydrate", readScope, refs, "recall"]);
  assert.deepEqual(fence, ["fence.assertVisible", readScope, refs]);
});

test("hosted fused ties use microseconds first and descending UTF-8 IDs second", async () => {
  // Hosted src/memory/search.ts:45–61. Rank pairs (6, 50) and (10, 45) both sum to 1/60.
  for (const [firstUs, expected] of [[1002, ["\ue000", "😀"]], [1001, ["😀", "\ue000"]]]) {
    const lexical = Array.from({ length: 10 }, (_, i) =>
      [i === 5 ? "\ue000" : i === 9 ? "😀" : "lexical" + i, 10 - i, i === 5 ? firstUs : 1001]);
    const vector = Array.from({ length: 50 }, (_, i) =>
      [i === 49 ? "\ue000" : i === 44 ? "😀" : "vector" + i, i / 100, i === 49 ? firstUs : 1001]);
    const { deps } = recallFixture({ lexical, vector });
    const result = await createMemoryService(deps).recall(hostedScope, "query", { ...page, limit: 2 });
    assert.deepEqual(ids(result), expected);
    assert.deepEqual(result.scores, [1 / 60, 1 / 60]);
  }
});

test("hosted plugin floor is inclusive, retains lexical-pool hits, and leaves retained scores intact", async () => {
  const { deps } = recallFixture();
  const service = createMemoryService(deps);
  // Hosted src/memory/search.ts:21–28,45–61 and src/memory/service.ts:10,61–64.
  const search = await service.recall(hostedScope, "query", page);
  const plugin = await service.recall(hostedScope, "query", { ...page, mode: "plugin" });
  assert.deepEqual(ids(search), golden.fused.map(([id]) => id));
  assert.deepEqual(ids(plugin), golden.floorIds);
  assert.deepEqual(plugin.scores, [search.scores[0], search.scores[1], ...search.scores.slice(3)]);
});

const label = (prefix, i) => prefix + String(i).padStart(2, "0");
const longLexical = Array.from({ length: 60 }, (_, i) => [label("l", i), 60 - i, 1001]).reverse();

test("hosted offset pages cross the pool boundary and end at the 100-row fused union", async () => {
  const vector = Array.from({ length: 60 }, (_, i) => [label("v", i), 0.2, i === 0 ? 1002 : 1001]);
  const { deps } = recallFixture({ lexical: longLexical, vector });
  const service = createMemoryService(deps);
  const options = { ...page, limit: 49 };
  const first = await service.recall(hostedScope, "query", options);
  assert.ok(first.nextCursor);
  const second = await service.recall(hostedScope, "query", { ...options, cursor: first.nextCursor });
  assert.ok(second.nextCursor);
  const last = await service.recall(hostedScope, "query", { ...options, cursor: second.nextCursor });

  // Hosted src/memory/index.ts:127–133 and the Phase 0 vector cutoff tie rule.
  assert.deepEqual(ids(first), ["v00", ...Array.from({ length: 48 }, (_, i) => label("v", 59 - i))]);
  assert.deepEqual(ids(second), ["v11", ...Array.from({ length: 48 }, (_, i) => label("l", i))]);
  assert.deepEqual(ids(last), ["l48", "l49"]);
  assert.deepEqual(last.scores, [0.5 / 109, 0.5 / 110]);
  assert.equal(last.nextCursor, null);
});

test("hosted lexical-only uses relevance and can page beyond the hybrid pool", async () => {
  const fake = recallFixture({ semantic: false });
  assertLexical(await createMemoryService(fake.deps).recall(hostedScope, "query", page));
  assert.deepEqual(methods(fake), ["run", "snapshot.stateToken", "lexical.lexical", "hydrate.hydrate", "fence.assertVisible"]);

  // Hosted src/memory/search.ts:64–74. This route has no 50-row lexical cutoff.
  const { deps } = recallFixture({ lexical: longLexical, vector: [], semantic: false });
  const service = createMemoryService(deps);
  const options = { ...page, limit: 50 };
  const first = await service.recall(hostedScope, "query", options);
  assert.deepEqual(ids(first), Array.from({ length: 50 }, (_, i) => label("l", i)));
  const last = await service.recall(hostedScope, "query", { ...options, cursor: first.nextCursor });
  assert.deepEqual(ids(last), Array.from({ length: 10 }, (_, i) => label("l", 50 + i)));
  assert.deepEqual(last.scores, [10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
  assert.equal(last.nextCursor, null);
});

test("engine preset keeps canonical ranking and applies the plugin floor after fusion", async () => {
  const { deps, calls } = recallFixture({
    preset: "rrf-k60-d12",
    lexical: [["z", 3, 2000], ["a", 3, 1000]],
    vector: [["z", 0.9, 2000], ["over", 0.46, 1000]],
  });
  const service = createMemoryService(deps);
  // The engine preset gives z two rank-2 contributions and breaks the rank-1 tie by ID.
  const search = await service.recall(hostedScope, "query", page);
  assert.deepEqual(ids(search), ["z", "a", "over"]);
  const rank1 = 0.45 * (1 / 61);
  const rank2 = 0.45 * (1 / 62);
  assert.deepEqual(search.scores, [rank2 + rank2, rank1, rank1]);
  assert.equal(calls.find(([method]) => method === "vector.vector").at(-1), 12);
  const plugin = await service.recall(hostedScope, "query", { ...page, mode: "plugin" });
  assert.deepEqual(ids(plugin), ["z", "a"]);
  assert.deepEqual(plugin.scores, [rank2 + rank2, rank1]);
});

test("incomplete semantic coverage discards the entire vector list", async () => {
  const fake = recallFixture();
  for (const complete of [false, "true"]) {
    fake.hooks.coverage = { eligible: 4, embedded: 3, complete };
    assertLexical(await createMemoryService(fake.deps).recall(hostedScope, "query", page));
  }
  assert.equal(methods(fake).filter(method => method === "vector.vector").length, 2);
});

test("missing query embedder or vector capability prevents semantic dispatch", async () => {
  for (const disable of [
    fake => { delete fake.deps.embedQuery; },
    fake => { fake.storage.capabilities.semanticRetrieval = false; },
    fake => { delete fake.storage.vector; },
  ]) {
    const fake = recallFixture();
    disable(fake);
    assertLexical(await createMemoryService(fake.deps).recall(hostedScope, "query", page));
    assert.deepEqual(methods(fake), ["run", "snapshot.stateToken", "lexical.lexical", "hydrate.hydrate", "fence.assertVisible"]);
  }
});

test("closed dispatch gate means lexical recall in both modes with zero query embeds", async () => {
  const fake = recallFixture();
  fake.hooks.gate = () => { throw new CoreError("capture_paused"); };
  const service = createMemoryService(fake.deps);
  // Hosted src/memory/index.ts:65–83,119–133 keeps search available independently of the capture pause.
  for (const mode of ["search", "plugin"]) {
    assertLexical(await service.recall(hostedScope, "query", { ...page, mode }));
  }
  assert.deepEqual(methods(fake), Array.from({ length: 2 }, () =>
    ["gate", "run", "snapshot.stateToken", "lexical.lexical", "hydrate.hydrate", "fence.assertVisible"]).flat());
});

test("query embed failure leaves lexical recall available", async () => {
  const fake = recallFixture();
  fake.hooks.embedQuery = () => { throw new Error("provider details"); };
  assertLexical(await createMemoryService(fake.deps).recall(hostedScope, "query", page));
  assert.deepEqual(methods(fake), [
    "gate", "embedQuery", "run", "snapshot.stateToken", "lexical.lexical", "hydrate.hydrate", "fence.assertVisible",
  ]);
});

test("candidate snapshot and final fence prevent delivery of forgotten and out-of-scope memories", async () => {
  const forgotten = memory("forgotten");
  const racing = memory("racing");
  const wrongOwner = memory("same-id", { scope: { owner: "other-owner", namespace: null } });
  const wrongNamespace = memory("namespace", { scope: { ...hostedScope, namespace: "other" } });
  const local = memory("same-id");
  const visible = memory("visible");
  const fake = serviceFake({ recall: true, semantic: true, rows: [forgotten, racing, wrongOwner, wrongNamespace, local, visible] });
  fake.forget(forgotten);
  fake.hooks.lexicalScore = row => row === visible ? 1 : 2;
  fake.hooks.vectorDistance = () => 0.2;
  fake.hooks.afterLexical = rows => {
    assert.deepEqual(rows.map(row => row.ref.id), ["same-id", "racing", "visible"]);
    fake.forget(racing);
  };
  fake.hooks.hydrate = rows => {
    assert.deepEqual(rows.map(({ ref }) => ref.id).sort(), ["racing", "same-id", "visible"]);
    return rows.map(result => result.memory === local ? { ...result, memory: wrongOwner } : result);
  };
  const result = await createMemoryService(fake.deps).recall(hostedScope, "query", page);
  assert.deepEqual(result.items, [visible]);
  assert.deepEqual(result.scores, [0.5 / 63 + 1 / 61]);
  assert.equal(methods(fake).at(-1), "fence.assertVisible");
});

test("a fence-dropped page still advances over the scanned ranks", async () => {
  const fake = recallFixture();
  const service = createMemoryService(fake.deps);
  fake.hooks.hideAtFence = ref => ref.id === "both-above";
  const options = { ...page, limit: 1 };
  const first = await service.recall(hostedScope, "query", options);
  assert.deepEqual(first.items, []);
  assert.deepEqual(first.scores, []);
  assert.ok(first.nextCursor);
  const next = await service.recall(hostedScope, "query", { ...options, cursor: first.nextCursor });
  assert.deepEqual(ids(next), ["equal"]);
  assert.deepEqual(next.scores, [1 / 61]);
});

test("recall cursors bind request, route, and state with OS1 error classification", async () => {
  const fake = recallFixture({ semantic: false });
  const service = createMemoryService(fake.deps);
  const options = { ...page, limit: 1 };
  const first = await service.recall(hostedScope, "query", options);
  assert.ok(first.nextCursor);
  const next = { ...options, cursor: first.nextCursor };
  const { nextCursor: recentCursor } = await service.recent(hostedScope, optionsForRecent(options));
  fake.calls.length = 0;
  for (const invoke of [
    () => service.recall(hostedScope, "different query", next),
    () => service.recall(hostedScope, "query", { ...next, mode: "plugin" }),
    () => service.recall(hostedScope, "query", { ...next, limit: 2 }),
    () => service.recall({ ...hostedScope, owner: "other" }, "query", next),
    () => service.recall({ ...hostedScope, namespace: "other" }, "query", next),
    () => service.recall(hostedScope, "", next),
    () => service.recent(hostedScope, optionsForRecent(next)),
    () => service.recall(hostedScope, "query", { ...next, cursor: recentCursor }),
    () => service.recall(hostedScope, "query", { ...next, cursor: encodeCursor(1) }),
    () => service.recall(hostedScope, "query", { ...next, cursor: encodeCursor(["recall-v0"]) }),
  ]) await assert.rejects(invoke, code("cursor_stale"));
  await assert.rejects(() => service.recall(hostedScope, "query", { ...next, cursor: "!" }), code("invalid_cursor"));
  assert.deepEqual(fake.calls, []);

  fake.forget(memory("a-newer"));
  await assert.rejects(() => service.recall(hostedScope, "query", next), code("cursor_stale"));
  assert.deepEqual(methods(fake), ["run", "snapshot.assertUnchanged"]);
});

function optionsForRecent({ limit, cursor }) {
  return { limit, cursor };
}

test("blank recall delegates to recent with zero scores and a bound cursor", async () => {
  const fake = recallFixture();
  const service = createMemoryService(fake.deps);
  const options = { ...page, limit: 1 };
  const first = await service.recall(hostedScope, " \t\0\n ", options);
  // Hosted src/memory/index.ts:119–125 delegates cleaned blanks and supplies zero scores.
  assert.deepEqual(ids(first), ["a-newer"]);
  assert.deepEqual(first.scores, [0]);
  assert.ok(first.nextCursor);
  assert.deepEqual(methods(fake), ["run", "snapshot.stateToken", "recent.recent", "fence.assertVisible"]);
  const next = { ...options, cursor: first.nextCursor };
  await assert.rejects(() => service.recall(hostedScope, "query", next), code("cursor_stale"));
  await assert.rejects(() => service.recall(hostedScope, "", { ...next, mode: "plugin" }), code("cursor_stale"));
  await assert.rejects(() => service.recall(hostedScope, "", { ...next, limit: 2 }), code("cursor_stale"));
  assert.deepEqual(ids(await service.recall(hostedScope, "", next)), ["😀"]);
  fake.insert(memory("new"));
  await assert.rejects(() => service.recall(hostedScope, "", next), code("cursor_stale"));
});

test("only retrieval inputs receive the redacted query and each recall embeds afresh", async () => {
  const fake = recallFixture();
  const service = createMemoryService(fake.deps);
  const raw = "unique-marker ｐａｓｓｗｏｒｄ＝synthetic-example";
  const options = { ...page, limit: 1 };
  const before = fake.committed(hostedScope.owner);
  const first = await service.recall(hostedScope, raw, options);
  await service.recall(hostedScope, raw, { ...options, cursor: first.nextCursor });

  for (const method of ["embedQuery", "lexical.lexical"]) {
    const queries = fake.calls.filter(([name]) => name === method).map(([, , text]) => text);
    const expected = method === "embedQuery" ? "unique-marker password=[redacted]" : "unique-marker password=[REDACTED]";
    assert.deepEqual(queries, [expected, expected]);
  }
  const otherCalls = fake.calls.filter(([method]) => !["embedQuery", "lexical.lexical"].includes(method));
  assert.doesNotMatch(JSON.stringify([otherCalls, decodeCursor(first.nextCursor)]), /unique-marker|synthetic-example/);
  assert.deepEqual(fake.mutations, []);
  assert.deepEqual(fake.committed(hostedScope.owner), before);
});

test("foreign throws at recall ports are mapped to content-free CoreError failures", async () => {
  const native = Object.assign(new Error("private port error"), { code: "storage_busy" });
  for (const [port, method] of [
    ["uow", "run"], ["snapshot", "stateToken"], ["lexical", "lexical"],
    ["vector", "vector"], ["hydrate", "hydrate"], ["fence", "assertVisible"],
  ]) {
    const { deps, storage } = recallFixture();
    storage[port][method] = async () => { throw native; };
    await assert.rejects(() => createMemoryService(deps).recall(hostedScope, "query", page), code("internal_error"));
  }
});
