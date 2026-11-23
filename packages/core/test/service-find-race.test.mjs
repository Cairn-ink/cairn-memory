import assert from "node:assert/strict";
import { test } from "node:test";
import { CoreError } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { hostedScope as scope, memory, serviceFake } from "./helpers/service-fake.mjs";

test("find keeps the memory layer ok when a failed query embed falls back to lexical search", async () => {
  const row = memory("lexical-match");
  const { deps, hooks, calls } = serviceFake({ rows: [row], recall: true, semantic: true });
  hooks.embedQuery = () => { throw new CoreError("embedding_failed"); };
  hooks.lexicalScore = () => 1;

  const result = await createMemoryService(deps).find(scope, "query", { kinds: ["memory"] });

  assert.deepEqual(result.memories, [row]);
  assert.deepEqual(result.layers.memory, { status: "ok", count: 1 });
  assert.equal(calls.filter(([method]) => method === "embedQuery").length, 1);
  assert.equal(calls.some(([method]) => method === "vector.vector"), false);
});
