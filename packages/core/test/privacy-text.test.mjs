import assert from "node:assert/strict";
import { test } from "node:test";
import { cleanContent, normalizeForHash, prepareCoreText } from "../src/index.mjs";
import { assertText, cases, coreRefusal, expected, inputOf } from "./privacy-vectors.mjs";

for (const vector of cases) {
  test(`text preparation: ${vector.id}`, () => {
    const input = inputOf(vector);
    const row = expected[vector.id];
    if (row.prepareCoreText.refusal) {
      assert.throws(() => cleanContent(input), { name: row.cleanContent.refusal });
      assert.throws(() => normalizeForHash(input), { name: row.normalizeText.refusal });
      assert.throws(() => prepareCoreText(input), coreRefusal(row.prepareCoreText.refusal));
      return;
    }
    assertText(cleanContent(input), row.cleanContent);
    assertText(normalizeForHash(input), row.normalizeText);
    const prepared = prepareCoreText(input);
    assertText(prepared, row.prepareCoreText);
    assert.ok(prepared.isWellFormed());
    assert.ok(!prepared.includes("\0"));
  });
}
