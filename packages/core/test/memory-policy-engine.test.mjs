import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { generateCases, verifyEngineSource } from "../../../tools/goldens/memory-policy.generate.mjs";
import { planDuplicateMerge } from "../src/memory-policy/index.mjs";

const cases = JSON.parse(readFileSync(new URL("./fixtures/memory-policy/duplicate-merge.json", import.meta.url), "utf8"));

test("engine merge fixture covers all 24 combinations", () => {
  assert.equal(cases.length, 24);
  assert.equal(new Set(cases.map(({ existing, incoming }) => JSON.stringify([existing, incoming]))).size, 24);
});

for (const { name, existing, incoming, expected } of cases) {
  test(name, () => {
    const merge = incoming.origin === "explicit" ? expected.merged : { confidence: expected.merged.confidence };
    const result = planDuplicateMerge(Object.freeze(existing), Object.freeze(incoming));
    assert.deepEqual(result, { merge, changed: expected.changed });
    assert.deepEqual({ ...existing, ...result.merge }, expected.merged);
  });
}

const engineDir = process.env.ENGINE_DIR;
if (engineDir) {
  test("engine source quote and committed merge fixture agree", () => {
    verifyEngineSource(engineDir);
    assert.deepEqual(cases, generateCases());
  });

  for (const [name, lineNumber, mutateLine] of [
    ["the changed assignment is commented out in its indentation", 313,
      line => line.replace(/^ {6}(?= {2}changed = true;$)/, "    //")],
    ["Math.max is replaced with Math.min", 311,
      line => line.replace("Math.max(", "Math.min(")],
  ]) {
    test(`engine source guard rejects when ${name}`, () => {
      const source = readFileSync(join(engineDir, "core/runtime.mjs"), "utf8").split("\n");
      const original = source[lineNumber - 1];
      const mutated = mutateLine(original);
      assert.notEqual(mutated, original);
      source[lineNumber - 1] = mutated;

      const scratchDir = mkdtempSync(join(tmpdir(), "memory-policy-engine-"));
      try {
        mkdirSync(join(scratchDir, "core"));
        writeFileSync(join(scratchDir, "core/runtime.mjs"), source.join("\n"));
        assert.throws(() => verifyEngineSource(scratchDir), {
          code: "ERR_ASSERTION",
          message: /^engine core\/runtime\.mjs:306–314 changed(?:\n|$)/,
        });
      } finally {
        rmSync(scratchDir, { recursive: true });
      }
    });
  }
}
