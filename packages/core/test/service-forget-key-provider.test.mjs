import assert from "node:assert/strict";
import { test } from "node:test";
import { allDigests, CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

const source = { kind: "mcp", client: null, sessionId: null };

for (const fingerprintKey of [false, true]) {
  test(`forget erases a suppressed row ${fingerprintKey ? "with the adapter's key provider" : "without using the external key provider"}`, async () => {
    const row = memory("target", { text: "The spare lens is in the cabinet." });
    const [digest] = await allDigests(row.text);
    row.textHash = "sha256:" + digest.value;
    const { deps, storage, calls, seedFact, committed } = serviceFake({
      writes: true, forgetting: { capabilities: { fingerprintKey } }, rows: [row],
    });
    seedFact({ ...scope, kind: "text", mode: "exact", origin: "forget", actionId: "previous-suppression",
      text: { digests: [digest] } });
    const key = await storage.keys.userKey(scope.owner);
    calls.length = 0;
    let transactionLookups = 0;
    storage.keys.userKeyForWrite = async tx => {
      transactionLookups++;
      if (!fingerprintKey) throw new CoreError("internal_error");
      assert.equal(tx.owner, scope.owner);
      assert.equal(tx.options.pauseLock, true);
      assert.ok(!tx.options.readOnly);
      return key;
    };
    storage.keys.retainedDigesters = async () => assert.fail("forget does not request retained signers");
    const service = createMemoryService(deps);
    assert.deepEqual((await service.exportMemories(scope, { limit: 10, cursor: null })).items, []);

    assert.deepEqual(await service.forget(scope, row.id, source), { status: "forgotten", removedSimilar: 0 });
    assert.equal(transactionLookups, fingerprintKey ? 1 : 0);
    assert.deepEqual(calls.filter(([method]) => method === "keys.userKey"), []);
    const { rows, facts } = committed(scope.owner);
    assert.deepEqual(rows, []);
    assert.equal(facts.length, 2);
    const { fact } = facts[1];
    assert.equal(fact.kind, "text");
    if (fingerprintKey) {
      assert.equal(fact.mode, "full");
      assert.equal(fact.text.keyId, key.id);
    } else {
      assert.equal(fact.mode, "exact");
      assert.deepEqual(fact.text, { digests: await allDigests(row.text, null), keyId: null });
    }
    assert.ok(fact.text.digests.every(digest => !("label" in digest)));
  });
}
