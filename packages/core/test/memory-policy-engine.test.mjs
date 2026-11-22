import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
}
