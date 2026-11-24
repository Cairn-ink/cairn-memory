import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { createMemoryAdapter } from "@cairn-ink/adapter-memory";

test("the index revision is stable within a run and advances once on commit", async () => {
  const scope = { owner: "owner", namespace: null };
  const { memories, uow } = createMemoryAdapter();
  const readRevision = () => uow.run(scope.owner, { readOnly: true }, tx => memories.indexRevision(tx));
  const start = await uow.run(scope.owner, {}, async tx => {
    const revision = await memories.indexRevision(tx);
    assert.equal(revision, 0);
    for (const text of ["A stored memory", "Another stored memory"]) {
      await memories.insert(tx, scope, {
        text, textHash: "sha256:" + createHash("sha256").update(text).digest("hex"),
        kind: "fact", origin: "explicit", confidence: 1,
        source: { kind: "mcp", client: null, sessionId: null }, embedding: null,
      }, [], 1);
      assert.equal(await memories.indexRevision(tx), revision);
    }
    return revision;
  });

  assert.equal(await readRevision(), start + 1);
  assert.equal(await readRevision(), start + 1);
});

test("the index revision is stable within a run across a Raw fence", async () => {
  const scope = { owner: "owner", namespace: null };
  const { memories, raw, uow } = createMemoryAdapter({ capabilities: { rawArchive: true } });
  await uow.run(scope.owner, {}, async tx => {
    assert.equal(await memories.indexRevision(tx), 0);
    await raw.fenceSession(tx, scope, { client: "fixture", sessionId: "session" });
    assert.equal(await memories.indexRevision(tx), 0);
  });
  assert.equal(await uow.run(scope.owner, { readOnly: true }, tx => memories.indexRevision(tx)), 1);
});
