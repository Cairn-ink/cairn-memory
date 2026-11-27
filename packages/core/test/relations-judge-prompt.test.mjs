import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { RECONCILE_MEMORIES_PROMPT } from "../src/capture/generated/prompts.mjs";
import { JUDGE_MEMORY_RELATIONS_PROMPT } from "../src/relations/generated/prompt.mjs";

test("the relation judge uses its own byte-for-byte checked prompt", () => {
  const bytes = name => readFileSync(new URL(`../prompts/${name}.md`, import.meta.url));
  assert.deepEqual(Buffer.from(JUDGE_MEMORY_RELATIONS_PROMPT), bytes("judge-memory-relations"));
  assert.deepEqual(Buffer.from(RECONCILE_MEMORIES_PROMPT), bytes("reconcile-memories"));
  const generator = fileURLToPath(new URL("../scripts/generate-relations-prompt.mjs", import.meta.url));
  const checked = spawnSync(process.execPath, [generator, "--check"], { encoding: "utf8" });
  assert.ifError(checked.error);
  assert.equal(checked.status, 0, checked.stderr);
});
