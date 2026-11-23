import assert from "node:assert/strict";
import { test } from "node:test";
import { CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { decodeCursor, encodeCursor } from "../src/retrieval/hosted-paging.mjs";
import { hostedScope, memory, serviceFake } from "./helpers/service-fake.mjs";

const readSet = { owner: hostedScope.owner, namespaces: [null] };
const read = ["run", hostedScope.owner, { readOnly: true }];
const snapshot = ["snapshot.stateToken", readSet];
const limits = { maxChars: 8000, maxTokens: 2000 };
const refs = (...ids) => ids.map(id => ({ type: "memory", namespace: null, id }));
const ids = ({ items }) => items.map(item => item.id);
const callsFor = (scope, ...ids) => ["fence.assertVisible", scope, refs(...ids)];
const code = expected => error => error instanceof CoreError && error.code === expected;

test("recent pages by exact microseconds and descending ID in one read-only snapshot per page", async () => {
  const rows = [
    memory("old", { updatedAtUs: 1000n }),
    memory("a", { updatedAtUs: 1001n }),
    memory("b", { updatedAtUs: 1001n }),
    memory("new", { updatedAtUs: 1002n }),
    memory("other", { scope: { owner: "other", namespace: null } }),
    memory("project", { scope: { ...hostedScope, namespace: "project\u0000example" } }),
  ];
  const { deps, calls } = serviceFake({ rows });
  const service = createMemoryService(deps);
  // Hosted src/memory/index.ts:92–108 and search.ts:108–118. Milliseconds tie on all four rows.
  const first = await service.recent(hostedScope, { limit: 2.9, cursor: null });
  assert.deepEqual(ids(first), ["new", "b"]);
  assert.ok(first.nextCursor);

  const [, , , token, inner] = decodeCursor(first.nextCursor);
  assert.deepEqual(JSON.parse(inner), ["1001", "b"]);
  const second = await service.recent(hostedScope, { limit: 50, cursor: first.nextCursor });
  assert.deepEqual(ids(second), ["a", "old"]);
  assert.equal(second.nextCursor, null);
  assert.deepEqual(calls, [
    read, snapshot, ["recent.recent", readSet, { cursor: null, limit: 2 }], read, callsFor(readSet, "new", "b"),
    read, ["snapshot.assertUnchanged", readSet, token],
    ["recent.recent", readSet, { cursor: inner, limit: 50 }], read, callsFor(readSet, "a", "old"),
  ]);
});

test("recent clamps limits and refuses malformed, out-of-scope or stale cursors", async () => {
  const rows = Array.from({ length: 51 }, (_, i) => memory(String(i), { updatedAtUs: BigInt(i) }));
  const { deps, calls, forget } = serviceFake({ rows });
  const service = createMemoryService(deps);
  // Hosted src/memory/search.ts:81–83,108–118. Scope and state binding are Phase 0 requirements.
  for (const [limit, expected] of [[0, 1], [NaN, 10], [51, 50], [undefined, 10]]) {
    const result = await service.recent(hostedScope, { limit, cursor: null });
    assert.equal(result.items.length, expected);
    assert.ok(result.nextCursor);
  }
  const first = await service.recent(hostedScope, { limit: 1, cursor: null });
  calls.length = 0;
  await assert.rejects(() => service.recent(hostedScope, { limit: 1, cursor: "bad-cursor" }), code("invalid_cursor"));
  for (const scope of [{ owner: "other", namespace: null }, { ...hostedScope, namespace: "project\u0000other" }]) {
    await assert.rejects(() => service.recent(scope, { limit: 1, cursor: first.nextCursor }), code("cursor_stale"));
  }
  // Hosted search.ts:101–118 and raw.ts:325–337. These positions require restarting on a core route.
  await assert.rejects(() => service.exportMemories(hostedScope, { limit: 1, cursor: first.nextCursor }),
    code("cursor_stale"));
  const foreignPositions = [
    ["2026-11-23T00:00:00.123456Z", "memory-1"], 10,
    ["terminal", "session-1", "2026-11-23T00:00:00.123456Z", 3, "message-1"],
    [], ["recent-v1", "owner", null, "", "position"],
  ];
  for (const page of [service.recent, service.exportMemories]) {
    for (const position of foreignPositions) {
      await assert.rejects(() => page(hostedScope, { limit: 1, cursor: encodeCursor(position) }), code("cursor_stale"));
    }
    for (const value of [{ other: 1 }, null, true, "position", -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
      await assert.rejects(() => page(hostedScope, { limit: 1, cursor: encodeCursor(value) }), code("invalid_cursor"));
    }
  }
  assert.deepEqual(calls, []);

  forget(rows[0]);
  await assert.rejects(() => service.recent(hostedScope, { limit: 1, cursor: first.nextCursor }), code("cursor_stale"));
  assert.deepEqual(calls, [read, ["snapshot.assertUnchanged", readSet, decodeCursor(first.nextCursor)[3]]]);
});

test("a route cursor whose opaque position the store rejects is stale", async () => {
  const { deps, storage } = serviceFake({ rows: [memory("a"), memory("b")] });
  const service = createMemoryService(deps);
  const first = await service.recent(hostedScope, { limit: 1 });
  storage.recent.recent = async () => { throw new CoreError("invalid_cursor"); };
  await assert.rejects(() => service.recent(hostedScope, { cursor: first.nextCursor }), code("cursor_stale"));
});

test("sessionStart fills the hosted groups from multiple pages and rechecks before delivery", async () => {
  const rows = [
    ...Array.from({ length: 46 }, (_, i) => memory("ignored-" + i, {
      kind: i % 2 ? "decision" : "preference", updatedAtUs: 20000n,
    })),
    ...Array.from({ length: 7 }, (_, i) => memory("instruction-" + i, {
      kind: "instruction", updatedAtUs: 18000n - BigInt(i),
    })),
    memory("fact", { updatedAtUs: 7000n }),
    memory("context", { kind: "context", updatedAtUs: 6000n }),
  ];
  const { deps, calls } = serviceFake({ rows });
  const service = createMemoryService(deps);
  const context = await service.sessionStart(hostedScope, limits);
  // Hosted session-start reader:9–14,62–100 and port.ts:83–99. The seventh instruction marks truncation.
  assert.equal(context.namespace, null);
  assert.equal(context.indexRevision, 0);
  const enabled = { enabled: true, complete: true, budgetExhausted: false, items: [], returned: 0 };
  assert.deepEqual(context.groups.nextSteps, enabled);
  assert.deepEqual(context.groups.commitments, { ...enabled, enabled: false });
  assert.deepEqual(context.groups.background, { ...enabled, returned: 2, items: rows.slice(-2) });
  assert.deepEqual(context.groups.procedural, {
    enabled: true, complete: false, budgetExhausted: true, returned: 6, items: rows.slice(46, 52),
  });
  assert.deepEqual(calls.map(([method]) => method), [
    "run", "recent.recent", "fence.assertVisible", "recent.recent", "fence.assertVisible", "run", "fence.assertVisible",
  ]);
  assert.deepEqual(calls.filter(([method]) => method === "run"), [read, read]);
  assert.deepEqual(calls[1], ["recent.recent", readSet, { cursor: null, limit: 50 }]);
  assert.deepEqual(calls[3], ["recent.recent", readSet, { cursor: '["17997","instruction-3"]', limit: 50 }]);
  assert.deepEqual(calls.at(-1), callsFor(readSet, "fact", "context",
    ...Array.from({ length: 6 }, (_, i) => "instruction-" + i)));
});

test("sessionStart enforces input ceilings and refuses an oversized empty wire envelope", async () => {
  const { deps, calls, hooks } = serviceFake();
  const service = createMemoryService(deps);
  let serialized;
  hooks.countTokens = text => {
    serialized = text;
    return 5;
  };
  // Hosted src/memory/contracts.ts:113–118, session-start reader:62–67, session-tokenizer.ts:109–112.
  for (const options of [{ maxChars: 8001, maxTokens: 2000 }, { maxChars: 8000, maxTokens: 2001 },
    { maxChars: 0, maxTokens: 2000 }, { maxChars: 8000, maxTokens: 0 }, { maxChars: 1000.5, maxTokens: 10 }]) {
    await assert.rejects(() => service.sessionStart(hostedScope, options), code("invalid_input"));
  }
  const projectId = "example-project-1";
  const context = await service.sessionStart(hostedScope, { ...limits, projectId });
  assert.equal(context.namespace, "project\u0000" + projectId);
  assert.ok(Object.values(context.groups).every(group => group.items.length === 0));
  const wire = JSON.parse(serialized);
  assert.deepEqual(wire.namespace, { ownerId: hostedScope.owner, scope: "project", projectId });
  assert.equal(wire.groups.commitments.status, "disabled");
  assert.equal(wire.version, 1);
  // Hosted port.ts:83–99 and session-start reader:62–67 (the hosted read route).
  // JSON.stringify of the empty project context for these IDs is 809 UTF-16 units. The limit is inclusive.
  const maxChars = 809;
  assert.deepEqual(await service.sessionStart(hostedScope, { maxChars, maxTokens: 5, projectId }), context);
  await assert.rejects(() => service.sessionStart(hostedScope, { maxChars: 808, maxTokens: 5, projectId }),
    code("context_item_too_large"));
  await assert.rejects(() => service.sessionStart(hostedScope, { maxChars, maxTokens: 4, projectId }),
    code("context_item_too_large"));
  assert.deepEqual(calls, []);
});

test("sessionStart masks hosted text and budgets the hosted projection outside the transaction", async () => {
  const rows = [
    memory("large-background", { text: "x".repeat(2000) }),
    memory("instruction", { kind: "instruction", text: "password=synthetic-example" }),
  ];
  const { deps, hooks } = serviceFake({ rows });
  const service = createMemoryService(deps);
  const counted = [];
  hooks.countTokens = text => {
    counted.push(JSON.parse(text));
    return 1;
  };
  // Hosted session-start reader:20–26,89–98. The background cap includes JSON overhead.
  const result = await service.sessionStart(hostedScope, limits);
  assert.deepEqual(result.groups.background, {
    enabled: true, returned: 0, complete: false, budgetExhausted: true, items: [],
  });
  assert.equal(result.groups.procedural.items[0].text, "password=[REDACTED]");
  const item = counted.at(-1).groups.procedural.items[0];
  assert.equal(item.memory.content, "password=[REDACTED]");
  assert.equal(item.memory.state, "active");
  assert.deepEqual(item.receipts, [{ id: "withheld", role: "user", excerpt: "[source not available]" }]);
  assert.equal(item.semanticSupport, "unassessed");
});

test("sessionStart succeeds after an unrelated insert between collection and delivery", async () => {
  const row = memory("visible");
  for (const namespace of ["other", null]) {
    const { deps, hooks, insert, calls } = serviceFake({ rows: [row] });
    const service = createMemoryService(deps);
    hooks.beforeRun = () => {
      if (calls.filter(([method]) => method === "run").length === 2) {
        insert(memory("new", { scope: { ...hostedScope, namespace } }));
      }
    };
    const context = await service.sessionStart(hostedScope, limits);
    assert.deepEqual(context.groups.background.items, [row]);
    assert.deepEqual(calls.at(-1), callsFor(readSet, row.id));
  }
});

test("sessionStart drops a row forgotten between collection and delivery and repacks", async () => {
  const gone = memory("forgotten");
  const remaining = memory("visible");
  const { deps, hooks, forget, calls } = serviceFake({ rows: [gone, remaining] });
  const service = createMemoryService(deps);
  hooks.beforeRun = () => {
    if (calls.filter(([method]) => method === "run").length === 2) forget(gone);
  };

  const { groups } = await service.sessionStart(hostedScope, limits);
  assert.deepEqual(groups.background, {
    enabled: true, returned: 1, complete: true, budgetExhausted: false, items: [remaining],
  });
  assert.deepEqual(calls.at(-1), callsFor(readSet, remaining.id, gone.id));
});

test("export uses a fresh delivery snapshot for every memory-store page", async () => {
  const rows = [memory("b"), memory("a")];
  const { deps, calls } = serviceFake({ rows });
  const service = createMemoryService(deps);
  // Hosted src/export/index.ts:65–89 and src/memory/index.ts:92–108 use the same descending order.
  const first = await service.exportMemories(hostedScope, { limit: 1, cursor: null });
  assert.deepEqual(ids(first), ["b"]);
  const [, , , token, inner] = decodeCursor(first.nextCursor);
  const assertUnchanged = ["snapshot.assertUnchanged", readSet, token];
  assert.deepEqual(calls.splice(0), [
    read, snapshot, ["memories.exportPage", hostedScope, { cursor: null, limit: 1 }], callsFor(readSet, "b"),
    read, assertUnchanged, callsFor(readSet, "b"),
  ]);

  const second = await service.exportMemories(hostedScope, { limit: 1, cursor: first.nextCursor });
  assert.deepEqual(second, { items: [rows[1]], nextCursor: null });
  assert.deepEqual(calls, [
    read, assertUnchanged, ["memories.exportPage", hostedScope, { cursor: inner, limit: 1 }], callsFor(readSet, "a"),
    read, assertUnchanged, callsFor(readSet, "a"),
  ]);
});

test("export rejects the last page if a forget commits after its candidates are read", async () => {
  const gone = memory("a");
  const { deps, calls, hooks, forget } = serviceFake({ rows: [memory("c"), memory("b"), gone] });
  const service = createMemoryService(deps);
  const first = await service.exportMemories(hostedScope, { limit: 1 });
  const second = await service.exportMemories(hostedScope, { limit: 1, cursor: first.nextCursor });
  assert.deepEqual(ids(first), ["c"]);
  assert.deepEqual(ids(second), ["b"]);
  const [, , , token, inner] = decodeCursor(second.nextCursor);
  calls.length = 0;
  hooks.afterExportPage = result => {
    assert.deepEqual(result, { items: [gone], nextCursor: null });
    forget(gone);
  };

  await assert.rejects(() => service.exportMemories(hostedScope, { limit: 1, cursor: second.nextCursor }),
    code("cursor_stale"));
  const assertUnchanged = ["snapshot.assertUnchanged", readSet, token];
  assert.deepEqual(calls, [
    read, assertUnchanged, ["memories.exportPage", hostedScope, { cursor: inner, limit: 1 }], callsFor(readSet, "a"),
    read, assertUnchanged,
  ]);
});

test("export omits a row hidden by the delivery fence while its token remains unchanged", async () => {
  const row = memory("hidden");
  const { deps, hooks, calls } = serviceFake({ rows: [row] });
  const service = createMemoryService(deps);
  hooks.beforeRun = () => {
    if (calls.filter(([method]) => method === "run").length === 2) hooks.hideAtFence = () => true;
  };
  assert.deepEqual(await service.exportMemories(hostedScope, { limit: 1 }), { items: [], nextCursor: null });
});

test("export aborts before querying another page when a forget changes the first-page state", async () => {
  const rows = [memory("latest", { updatedAtUs: 1500n }), memory("older"), memory("forgotten")];
  const { deps, calls, forget } = serviceFake({ rows });
  const service = createMemoryService(deps);
  const first = await service.exportMemories(hostedScope, { limit: 1, cursor: null });
  const second = await service.exportMemories(hostedScope, { limit: 1, cursor: first.nextCursor });
  assert.ok(second.nextCursor);
  assert.equal(decodeCursor(second.nextCursor)[3], decodeCursor(first.nextCursor)[3]);
  calls.length = 0;

  forget(rows[2]);
  await assert.rejects(() => service.exportMemories(hostedScope, { limit: 1, cursor: second.nextCursor }),
    code("cursor_stale"));
  assert.deepEqual(calls, [read, ["snapshot.assertUnchanged", readSet, decodeCursor(first.nextCursor)[3]]]);
});

test("the visibility fence drops forgotten rows in all three read routes and keeps page progress", async () => {
  const gone = memory("forgotten", { updatedAtUs: 1100n });
  const remaining = memory("visible");
  const { deps, forget } = serviceFake({ rows: [gone, remaining], leakForgotten: true });
  const service = createMemoryService(deps);
  forget(gone);
  // Hosted src/memory/index.ts:99–101 requires visibility before delivery.
  // Force the candidate port to return the forgotten row so the release-bar assertion tests the final fence.
  for (const page of [service.recent, service.exportMemories]) {
    const first = await page(hostedScope, { limit: 1, cursor: null });
    assert.deepEqual(first.items, []);
    assert.ok(first.nextCursor);
    assert.deepEqual((await page(hostedScope, { limit: 1, cursor: first.nextCursor })).items, [remaining]);
  }
  assert.deepEqual((await service.sessionStart(hostedScope, limits)).groups.background.items, [remaining]);
});

test("sessionStart returns an empty group if the final fence drops its only selected row", async () => {
  const { deps, hooks } = serviceFake({ rows: [memory("hidden")] });
  const service = createMemoryService(deps);
  hooks.countTokens = text => {
    if (text.includes('"id":"hidden"')) hooks.hideAtFence = () => true;
    return 1;
  };
  const { groups } = await service.sessionStart(hostedScope, limits);
  assert.deepEqual(groups.background, {
    enabled: true, returned: 0, complete: true, budgetExhausted: false, items: [],
  });
});
