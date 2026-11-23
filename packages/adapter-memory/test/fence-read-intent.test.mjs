import assert from "node:assert/strict";
import { test } from "node:test";
import { capabilities } from "@cairn-ink/core";
import { createMemoryStore } from "../src/memory-store.mjs";
import { createRetrievalPorts } from "../src/retrieval.mjs";
import { createUnitOfWork } from "../src/unit-of-work.mjs";

test("read intent keeps a historical ref subject to the same memory filters", async () => {
  const scope = { owner: "owner", namespace: null };
  const readSet = { owner: scope.owner, namespaces: [scope.namespace] };
  const { uow, port } = createUnitOfWork({});
  const flags = capabilities({});
  const { memories } = createMemoryStore(port, flags, () => "memory");
  const { fence } = createRetrievalPorts(port, flags);
  const id = await uow.run(scope.owner, {}, async tx => {
    const { id } = await memories.insert(tx, scope, {
      text: "original memory", textHash: "sha256:" + "a".repeat(64),
      kind: "fact", origin: "explicit", confidence: 1,
      source: { kind: "mcp", client: "client", sessionId: null }, embedding: null,
    }, [], 1);
    port(tx, scope, true, state => { state.rows.get(scope.namespace).get(id).row.historical = true; });
    return id;
  });
  const ref = { type: "memory", id, namespace: scope.namespace };

  await uow.run(scope.owner, { readOnly: true }, async tx => {
    assert.deepEqual(await fence.assertVisible(tx, readSet, [ref]), []);
    assert.deepEqual(await fence.assertVisible(tx, readSet, [ref], "read"), [ref]);
    assert.deepEqual(await fence.assertVisible(tx, { ...readSet, clients: ["other"] }, [ref], "read"), []);
    assert.deepEqual(await fence.assertVisible(tx, { ...readSet, window: { sinceMs: 2 } }, [ref], "read"), []);
  });
});
