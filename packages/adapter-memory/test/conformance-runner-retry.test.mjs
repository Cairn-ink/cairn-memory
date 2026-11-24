import assert from "node:assert/strict";
import { test } from "node:test";
import { setImmediate } from "node:timers/promises";
import { CoreError } from "@cairn-ink/core";
import { RAW_LEDGER_CASES, runCase } from "@cairn-ink/conformance";
import { rawFactory } from "./fixtures/raw.mjs";

const closureCase = RAW_LEDGER_CASES.find(({ id }) => id === "K-RAW-LEDGER-2");

test("the runner reports a needed capability the store rejects as a standard skip", async () => {
  assert.ok(closureCase);
  assert.equal(await runCase(rawFactory(), closureCase), "needs sessionLineage");
});

test("the runner keeps a rejected needed capability as a failure when the store provides it on reopen", async () => {
  assert.ok(closureCase);
  const base = rawFactory();
  const rejection = new CoreError("capability_unavailable");
  let opens = 0;
  let closes = 0;
  const factory = {
    name: "memory raw, lineage rejected on request but enabled by default",
    async open({ capabilities }) {
      opens += 1;
      if (capabilities.sessionLineage === true) throw rejection;
      const opened = await base.open({ capabilities });
      const { adapter } = opened;
      return {
        ...opened,
        adapter: { ...adapter, capabilities: { ...adapter.capabilities, sessionLineage: true } },
        async close() { closes += 1; await opened.close(); },
      };
    },
  };
  await assert.rejects(runCase(factory, closureCase), (error) => error === rejection);
  assert.equal(opens, 2, "The runner must reopen once without the rejected request");
  assert.equal(closes, 1, "The runner must close the reopened adapter before rethrowing");
});

for (const [behavior, close] of [
  ["rejects", async () => { throw new Error("Close failed"); }],
  ["never settles", () => new Promise(() => {})],
]) {
  test(`the runner preserves the open rejection when retry close ${behavior}`, async (t) => {
    const timeoutMs = 25;
    t.mock.timers.enable({ apis: ["setTimeout"] });
    const base = rawFactory();
    const rejection = new CoreError("capability_unavailable");
    let closes = 0;
    const factory = {
      ...base,
      async open({ capabilities }) {
        if (capabilities.sessionLineage === true) throw rejection;
        const opened = await base.open({ capabilities });
        const { adapter } = opened;
        return {
          ...opened, timeoutMs,
          adapter: { ...adapter, capabilities: { ...adapter.capabilities, sessionLineage: true } },
          close() { closes += 1; return close(); },
        };
      },
    };
    const result = runCase(factory, closureCase).catch(error => error);
    await setImmediate();
    t.mock.timers.tick(timeoutMs);
    assert.equal(closes, 1);
    assert.equal(await Promise.race([result, setImmediate("Retry still pending after timeoutMs")]), rejection);
  });
}
