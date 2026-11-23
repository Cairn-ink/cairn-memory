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

function recallFixture({ lexical = golden.lexical, vector = golden.vector, semantic = true } = {}) {
  const rows = new Map([...lexical, ...vector].map(([id, , us]) => [id, memory(id, { updatedAtUs: BigInt(us) })]));
  const fake = serviceFake({ rows: [...rows.values()], recall: true, semantic });
  const scores = new Map(lexical.map(([id, score]) => [id, score]));
  const distances = new Map(vector.map(([id, distance]) => [id, distance]));
  fake.hooks.lexicalScore = row => scores.get(row.id);
  fake.hooks.vectorDistance = row => distances.get(row.id);
  return fake;
}

function assertLexical(result) {
  assert.deepEqual(ids(result), golden.lexicalOnlyIds);
  assert.deepEqual(result.scores, [12, 10, 10, 10]);
  assert.equal(result.nextCursor, null);
}

test("hosted recall fuses the golden pools and gates the send before its read-only runs", async () => {
  const fake = recallFixture();
  const service = createMemoryService(fake.deps);
  const result = await service.recall(hostedScope, "A Query", page);

  // Hosted src/memory/search.ts:32–61. Ranks and exact timestamp/ID ties are from hosted-cases.json.
  assert.deepEqual(ids(result), golden.fused.map(([id]) => id));
  assert.deepEqual(result.scores, golden.fused.map(([, lexical, vector]) =>
    (lexical === null ? 0 : 0.5 / (60 + lexical)) + (vector === null ? 0 : 1 / (60 + vector))));
  assert.equal(result.nextCursor, null);
  assert.deepEqual(methods(fake), [
    "gate", "embedQuery", "run", "snapshot.stateToken", "lexical.lexical", "vector.vector",
    "run", "hydrate.hydrate", "fence.assertVisible",
  ]);
  const [gate, embed, run, token, lexical, vector, delivery, hydrate, fence] = fake.calls;
  assert.deepEqual(gate, ["gate", hostedScope.owner, "dispatch"]);
  assert.deepEqual(embed, ["embedQuery", hostedScope.owner, "a query", { budgetClass: "recall" }]);
  assert.deepEqual(run, ["run", hostedScope.owner, { readOnly: true }]);
  assert.deepEqual(token, ["snapshot.stateToken", readScope]);
  assert.deepEqual(lexical, ["lexical.lexical", readScope, "A Query", 50, {}]);
  assert.deepEqual(vector, ["vector.vector", readScope, Float32Array.of(1), "query-model", 50]);
  assert.deepEqual(delivery, run);
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
  assert.deepEqual(methods(fake), ["run", "snapshot.stateToken", "lexical.lexical", "run", "hydrate.hydrate", "fence.assertVisible"]);

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

test("service construction rejects the removed fusionPreset config", () => {
  const { deps } = recallFixture();
  for (const fusionPreset of ["rrf-k60-d12", "hosted", undefined]) {
    assert.throws(() => createMemoryService({ ...deps, config: { fusionPreset } }), code("invalid_input"));
  }
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
    assert.deepEqual(methods(fake), ["run", "snapshot.stateToken", "lexical.lexical", "run", "hydrate.hydrate", "fence.assertVisible"]);
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
    ["gate", "run", "snapshot.stateToken", "lexical.lexical", "run", "hydrate.hydrate", "fence.assertVisible"]).flat());
});

test("query embed failure leaves lexical recall available", async () => {
  const fake = recallFixture();
  fake.hooks.embedQuery = () => { throw new Error("provider details"); };
  assertLexical(await createMemoryService(fake.deps).recall(hostedScope, "query", page));
  assert.deepEqual(methods(fake), [
    "gate", "embedQuery", "run", "snapshot.stateToken", "lexical.lexical", "run", "hydrate.hydrate", "fence.assertVisible",
  ]);
});

function pagingFixture() {
  return recallFixture({
    lexical: [["A", 2, 1000], ["B", 1, 1000]],
    vector: [["B", 0.1, 1000], ["A", 0.2, 1000]],
  });
}

test("a hybrid cursor becomes stale when its next embed fails", async () => {
  const fake = pagingFixture();
  const service = createMemoryService(fake.deps);
  const options = { ...page, limit: 1 };
  const first = await service.recall(hostedScope, "query", options);
  assert.deepEqual(ids(first), ["B"]);
  assert.ok(first.nextCursor);
  fake.hooks.embedQuery = () => { throw new Error("embed failed on continuation"); };
  await assert.rejects(() => service.recall(hostedScope, "query", { ...options, cursor: first.nextCursor }),
    code("cursor_stale"));
});

test("a hybrid cursor becomes stale if dispatch, capability or complete coverage is lost", async () => {
  for (const disable of [
    fake => { fake.hooks.gate = () => { throw new CoreError("capture_paused"); }; },
    fake => { fake.storage.capabilities.semanticRetrieval = false; },
    fake => { fake.hooks.coverage = { eligible: 2, embedded: 1, complete: false }; },
  ]) {
    const fake = pagingFixture();
    const service = createMemoryService(fake.deps);
    const options = { ...page, limit: 1 };
    const first = await service.recall(hostedScope, "query", options);
    assert.deepEqual(ids(first), ["B"]);
    assert.ok(first.nextCursor);
    disable(fake);
    fake.calls.length = 0;
    await assert.rejects(() => service.recall(hostedScope, "query", { ...options, cursor: first.nextCursor }),
      code("cursor_stale"));
    assert.ok(!methods(fake).includes("hydrate.hydrate"));
  }
});

test("a lexical cursor continues without calling the gate or query embedder", async () => {
  const fake = pagingFixture();
  const service = createMemoryService(fake.deps);
  const options = { ...page, limit: 1 };
  fake.hooks.embedQuery = () => { throw new Error("embed failed on first page"); };
  const first = await service.recall(hostedScope, "query", options);
  assert.deepEqual(ids(first), ["A"]);
  assert.ok(first.nextCursor);
  delete fake.hooks.embedQuery;
  fake.calls.length = 0;
  const second = await service.recall(hostedScope, "query", { ...options, cursor: first.nextCursor });
  assert.deepEqual(methods(fake).filter(method => method === "gate" || method === "embedQuery"), []);
  assert.deepEqual(ids(second), ["B"]);
  assert.deepEqual(second.scores, [1]);
  assert.equal(second.nextCursor, null);
});

test("recall omits a forget committed after candidate collection and rejects out-of-scope hydration", async () => {
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
    fake.commitForget(racing);
  };
  fake.hooks.hydrate = rows => {
    return rows.map(result => result.memory === local ? { ...result, memory: wrongOwner } : result);
  };
  const result = await createMemoryService(fake.deps).recall(hostedScope, "query", page);
  assert.deepEqual(result.items, [visible]);
  assert.deepEqual(result.scores, [0.5 / 63 + 1 / 61]);
  assert.equal(methods(fake).at(-1), "fence.assertVisible");
});

for (const route of ["recent", "blank recall"]) {
  test(`${route} omits a forget committed after the recent page read`, async () => {
    const gone = memory("gone", { updatedAtUs: 2000n });
    const older = memory("older");
    const fake = serviceFake({ rows: [gone, older] });
    const service = createMemoryService(fake.deps);
    fake.hooks.afterRecentPage = ({ items }) => {
      assert.deepEqual(items, [gone]);
      fake.commitForget(gone);
    };
    const result = route === "recent"
      ? await service.recent(hostedScope, { cursor: null, limit: 1 })
      : await service.recall(hostedScope, " \t", { ...page, limit: 1 });
    assert.deepEqual(result.items, []);
    assert.ok(result.nextCursor);
    if (route === "blank recall") assert.deepEqual(result.scores, []);
  });
}

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
  const [, owner, namespace, digest, mode, limit, token, offset] = decodeCursor(first.nextCursor);
  const oldCursor = encodeCursor(["recall-v1", owner, namespace, digest, mode, limit, "hosted", token, offset]);
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
    () => service.recall(hostedScope, "query", { ...next, cursor: oldCursor }),
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
  assert.deepEqual(methods(fake), ["run", "snapshot.stateToken", "recent.recent", "run", "fence.assertVisible"]);
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
