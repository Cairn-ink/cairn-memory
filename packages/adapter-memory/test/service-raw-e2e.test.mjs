import assert from "node:assert/strict";
import { registerHooks } from "node:module";
import { test } from "node:test";
import { CoreError } from "../../core/src/index.mjs";
import { createMemoryService } from "../../core/src/service/index.mjs";
import { serviceFake } from "../../core/test/helpers/service-fake.mjs";

// The adapter's file dependency can be an installed copy. Share the checkout's core and error class.
const core = new URL("../../core/src/index.mjs", import.meta.url).href;
const hooks = registerHooks({
  resolve(specifier, context, nextResolve) {
    return nextResolve(specifier === "@cairn-ink/core" ? core : specifier, context);
  },
});
let createMemoryAdapter;
try {
  ({ createMemoryAdapter } = await import("@cairn-ink/adapter-memory"));
} finally {
  hooks.deregister();
}

const scope = { owner: "owner", namespace: "project" };
const query = "cedar";

function fixture() {
  const adapter = createMemoryAdapter({ capabilities: { rawArchive: true } });
  const { raw, uow } = adapter;
  const { deps } = serviceFake();
  const createService = (storage = adapter) => createMemoryService({ ...deps, storage });
  const write = fn => uow.run(scope.owner, {}, fn);
  async function archive(id, occurredAtMs, { client = "client", target = scope } = {}) {
    const key = { scope: target, client, sessionId: id, eventId: id, payloadDigest: "a".repeat(64) };
    const message = { id, occurredAtMs, role: "user", content: " Cedar passage\n " };
    assert.deepEqual(await write(tx => raw.archive(tx, key, [message])), { archived: 1 });
  }
  return { adapter, archive, createService, write };
}

test("raw service lists original segments and rejects continuation after an archive write", async () => {
  const { archive, createService } = fixture();
  const service = createService();
  await archive("first", 10);
  await archive("second", 20);
  await archive("other", 15, { target: { ...scope, namespace: null } });

  const first = await service.listRawMessages(scope, { limit: 1, cursor: null });
  assert.deepEqual(first.items.map(({ messageId, content }) => [messageId, content]), [["first", " Cedar passage\n "]]);
  assert.ok(first.nextCursor);
  const next = await service.listRawMessages(scope, { limit: 1, cursor: first.nextCursor });
  assert.deepEqual(next.items.map(({ messageId }) => messageId), ["second"]);
  assert.equal(next.nextCursor, null);

  await archive("late", 30);
  await assert.rejects(service.listRawMessages(scope, { limit: 1, cursor: first.nextCursor }),
    error => error instanceof CoreError && error.code === "cursor_stale");
});

test("raw service search fences stale candidates against the adapter's raw visibility predicate", async () => {
  const { adapter, archive, createService, write } = fixture();
  const { uow, raw } = adapter;
  await archive("hidden", 10);
  await archive("visible", 10);
  await archive("end", 20);
  await archive("unknown-time", null);
  await archive("other-client", 12, { client: "other" });
  const readScope = { owner: scope.owner, namespaces: [scope.namespace] };
  const { items } = await uow.run(scope.owner, { readOnly: true }, tx => raw.listRaw(tx, readScope, { cursor: null, limit: 5 }));
  const stale = items.filter(({ messageId }) => messageId !== "visible");
  await write(tx => raw.fenceSession(tx, scope, { client: "client", sessionId: "hidden" }));

  const service = createService({ ...adapter, raw: {
    ...raw,
    async raw(...args) {
      const result = await raw.raw(...args);
      return { ...result, segments: [...stale, ...result.segments] };
    },
  } });
  const result = await service.find(scope, query, { kinds: ["raw"], clients: ["client"], sinceMs: 10, untilMs: 20 });
  assert.deepEqual(result.raw.map(({ messageId }) => messageId), ["visible"]);
  assert.deepEqual(result.layers.raw, { status: "ok", count: 1 });
});
