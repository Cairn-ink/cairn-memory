import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";

test("forMemories checks visibility in the first namespace from a flipping scope", async () => {
  const first = { owner: "owner", namespace: "first" };
  const second = { ...first, namespace: "second" };
  const ids = ["shared", "shared", "first-topic"];
  const { harness, memories, placement, uow } = createMemoryAdapter({
    capabilities: { placement: true },
    newId: () => ids.shift(),
  });

  await uow.run(first.owner, {}, async (tx) => {
    for (const scope of [first, second]) {
      const text = `Memory in ${scope.namespace}`;
      const { id, revision } = await memories.insert(tx, scope, {
        text, textHash: "sha256:" + createHash("sha256").update(text).digest("hex"),
        kind: "fact", origin: "explicit", confidence: 1,
        source: { kind: "mcp", client: null, sessionId: null }, embedding: null,
      }, [], 1);
      assert.deepEqual({ id, revision }, { id: "shared", revision: 1 });
    }
    const { indexRevision } = await placement.catalog(tx, first, { cursor: null, limit: 100 });
    await placement.applyPlacement(tx, first, { indexRevision, memoryRevisions: [{ memoryId: "shared", revision: 1 }] }, {
      items: [{ memoryId: "shared", parentIds: [], newL1: { title: "First namespace title", parentL2Ids: [] } }],
    });
  });
  await harness.seedFact(first.owner, {
    ...first, kind: "identity", origin: "forget", actionId: "forget-first", memoryId: "shared",
  });

  let namespaceReads = 0;
  const flipping = {
    owner: first.owner,
    get namespace() {
      return namespaceReads++ === 0 ? first.namespace : second.namespace;
    },
  };
  await uow.run(first.owner, { readOnly: true }, async (tx) => {
    assert.deepEqual(await placement.forMemories(tx, first, ["shared"]), []);
    assert.deepEqual(await placement.forMemories(tx, flipping, ["shared"]), []);
    assert.equal(namespaceReads, 1);
  });
});
