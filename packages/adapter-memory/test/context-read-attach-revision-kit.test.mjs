import assert from "node:assert/strict";
import { test } from "node:test";
import { runCase } from "@cairn-ink/conformance";
import { CONTEXT_READ_CASES } from "@cairn-ink/conformance/context-read";
import { rawFactory } from "./fixtures/raw.mjs";

const fetchCase = CONTEXT_READ_CASES.find(({ id }) => id === "T-CONTEXT-READ-2");
assert.ok(fetchCase);

// Keep the flag non-enumerable for core's current capability validator. A second touch
// changes the unasserted origin so the public write port advances the stored revision.
function attachFactory({ advances = true, flag = true } = {}) {
  const base = rawFactory();
  return {
    ...base,
    async open(request) {
      const opened = await base.open(request);
      const { adapter } = opened;
      const { memories } = adapter;
      return {
        ...opened,
        adapter: {
          ...adapter,
          capabilities: Object.defineProperty({ ...adapter.capabilities }, "receiptAttachAdvancesRevision", { value: flag }),
          memories: advances ? {
            ...memories,
            async touchDuplicate(tx, scope, id, receipts, merge, nowMs) {
              const selection = { owner: scope.owner, namespaces: [scope.namespace] };
              const refs = [{ type: "memory", namespace: scope.namespace, id }];
              const [before] = await adapter.hydrate.hydrate(tx, selection, refs, "read");
              const result = await memories.touchDuplicate(tx, scope, id, receipts, merge, nowMs);
              if (!before || result.outcome !== "touched") return result;
              const [after] = await adapter.hydrate.hydrate(tx, selection, refs, "read");
              if (!after || after.receipts.length <= before.receipts.length) return result;
              const origin = after.memory.origin === "explicit" ? "inferred" : "explicit";
              return memories.touchDuplicate(tx, scope, id, [], { ...merge, origin }, nowMs);
            },
          } : memories,
        },
      };
    },
  };
}

test("T-CONTEXT-READ-2 accepts a flag-on store that advances the stored revision", async () => {
  assert.equal(await runCase(attachFactory(), fetchCase), null);
});

test("T-CONTEXT-READ-2 accepts a plain store with the flag off", async () => {
  assert.equal(await runCase(attachFactory({ advances: false, flag: false }), fetchCase), null);
});

test("T-CONTEXT-READ-2 rejects a flag-on store that leaves the revision unchanged", async () => {
  await assert.rejects(runCase(attachFactory({ advances: false }), fetchCase),
    /A newly attached receipt should advance the revision once/);
});
