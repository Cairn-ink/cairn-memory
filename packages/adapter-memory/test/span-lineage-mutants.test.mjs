import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { runCase, SPAN_LINEAGE_CASES } from "@cairn-ink/conformance";
import { CoreError } from "@cairn-ink/core";
import { hashSessionKey, rawFactory } from "./fixtures/raw.mjs";

function factory(wrap = resolve => resolve) {
  const base = rawFactory({ flags: { spanLineage: false } });
  return {
    ...base,
    async open(request) {
      const opened = await base.open(request);
      const { adapter } = opened;
      const { hydrate, raw } = adapter;
      async function resolve(tx, scope, id) {
        const selection = { owner: scope.owner, namespaces: [scope.namespace] };
        const [memory] = await hydrate.hydrate(tx, selection, [{ type: "memory", id, namespace: scope.namespace }], "read");
        if (!memory?.receipts?.length) throw new CoreError("raw_lineage_unavailable");
        // Each case fixture has at most one Raw row.
        const { items } = await raw.listRaw(tx, selection, { cursor: null, limit: 1 });
        const spans = [];
        for (const { client, sessionId, messageId, role } of memory.receipts) {
          const message = items.find(row => row.client === client && row.sessionId === sessionId && row.messageId === messageId);
          if (!message) continue;
          if (message.role !== role || !message.content) throw new CoreError("raw_lineage_unavailable");
          spans.push({
            ...scope, kind: "rawSpan", origin: "forget", actionId: id,
            sessionKeyHash: hashSessionKey(client, sessionId), messageKey: messageId,
            startUtf16: 0, endUtf16: message.content.length,
            contentDigest: createHash("sha256").update(message.content).digest("hex"),
          });
        }
        return spans;
      }
      return {
        ...opened,
        adapter: { ...adapter, capabilities: { ...adapter.capabilities, spanLineage: true },
          spanLineage: { resolveSpans: wrap(resolve) } },
      };
    },
  };
}

const deletedRaw = SPAN_LINEAGE_CASES.find(({ id }) => id === "K-SPAN-1");
const unknownMemory = SPAN_LINEAGE_CASES.find(({ id }) => id === "K-SPAN-2");

test("the span lineage fixture passes both kit cases", async () => {
  assert.equal(await runCase(factory(), deletedRaw), null);
  assert.equal(await runCase(factory(), unknownMemory), null);
});

test("K-SPAN-1 detects a throw when source Raw is gone", async () => {
  const mutant = factory(resolve => async (...args) => {
    const spans = await resolve(...args);
    if (!spans.length) throw new CoreError("raw_lineage_unavailable");
    return spans;
  });
  await assert.rejects(runCase(mutant, deletedRaw), { code: "raw_lineage_unavailable" });
});

test("K-SPAN-1 detects a stale span after Raw deletion", async () => {
  const mutant = factory(resolve => {
    let previous;
    return async (...args) => {
      const spans = await resolve(...args);
      if (spans.length) previous = spans;
      return previous ?? spans;
    };
  });
  await assert.rejects(runCase(mutant, deletedRaw), { message: "Deleted source Raw must resolve to []" });
});

test("K-SPAN-2 detects an empty result for an unknown memory", async () => {
  const mutant = factory(resolve => async (...args) => {
    try {
      return await resolve(...args);
    } catch (error) {
      if (error.code !== "raw_lineage_unavailable") throw error;
      return [];
    }
  });
  await assert.rejects(runCase(mutant, unknownMemory), { message: "Expected operation to reject" });
});

test("the runner keeps a rejected span lineage request as a failure when the port is available on reopen", async () => {
  const base = factory();
  const rejection = new CoreError("capability_unavailable");
  let closed = false;
  const refusing = {
    ...base,
    async open(request) {
      if (request.capabilities.spanLineage) throw rejection;
      const opened = await base.open(request);
      return { ...opened, async close() { await opened.close(); closed = true; } };
    },
  };
  await assert.rejects(runCase(refusing, deletedRaw), error => error === rejection);
  assert.equal(closed, true);
});
