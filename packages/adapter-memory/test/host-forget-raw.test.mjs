import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";
import { archive, clock, fork, makeRow, rawForgetCases, root, scope, service, sessionless, sourceTuple, text }
  from "../../conformance/test/host-forget-raw.mjs";

function fixture(_t, hostWriteHooks = true) {
  let serial = 0;
  let proven = false;
  const adapter = createMemoryAdapter({ hostWriteHooks, now: clock.nowMs, newId: () => `fixture-${++serial}`,
    capabilities: { rawArchive: true, fingerprintKey: true, documentCards: false, embeddingRequiredOnInsert: false } });
  const storage = { ...adapter, capabilities: { ...adapter.capabilities, sessionLineage: true },
    sessionLineage: { async provenClosure(_tx, target, roots) {
      assert.deepEqual(target, scope);
      assert.deepEqual(roots, [root]);
      assert.equal(proven, true);
      return [root, fork];
    } } };
  return {
    storage, table: adapter.harness.createHostHookTable?.(),
    containingText: `  ${text}  `,
    createService: hooks => service(storage, null, hooks),
    async rawRows() { return (await adapter.harness.dump())[0].rawRows.map(sourceTuple); },
    async proveFork() { proven = true; },
  };
}

rawForgetCases(test, fixture);

test("omitting Memory hooks preserves forget and purge result bytes", async t => {
  async function run(capability) {
    const f = fixture(t, capability);
    const api = f.createService();
    const row = makeRow("other", "turn", null, f.containingText);
    await archive(f.storage, row);
    const saved = await api.save(scope, text, sessionless);
    assert.equal(saved.status, "saved");
    const purge = f.storage.raw.purgeWithheld.bind(f.storage.raw);
    let counts;
    f.storage.raw.purgeWithheld = async (...args) => {
      assert.equal(args[3], undefined);
      counts = await purge(...args);
      assert.deepEqual(counts, { rawDeleted: 1, ledgerBlanked: 0 });
      return counts;
    };
    const result = await api.forget(scope, saved.item.id, sessionless);
    assert.equal(result.status, "forgotten");
    return JSON.stringify({ result, counts, rows: await f.rawRows() });
  }
  assert.equal(await run(true), await run(false));
});
