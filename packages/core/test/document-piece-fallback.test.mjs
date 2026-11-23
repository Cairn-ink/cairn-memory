import assert from "node:assert/strict";
import { test } from "node:test";
import { selectDocumentPiece } from "../src/routing/index.mjs";

const piece = (body, query, countTokens) =>
  selectDocumentPiece({ body }, query, { maxTokens: 1_000, countTokens });

test("an oversized line tries the next matching run when the first cannot fit", () => {
  const gap = " ".repeat(351);
  const countTokens = text => text.length;
  const result = piece(`a${gap}b${gap}c${gap}d${"z".repeat(360)}xy`, "abcd xy", countTokens);
  assert.equal(result.kind, "excerpt");
  assert.ok(result.body.includes("xy"));
  assert.ok(countTokens(result.body) <= 350);
});

test("an asymmetric window can fit even when the bare match and centered windows do not", () => {
  const line = `${"z".repeat(360)}cedar${"x".repeat(360)}`;
  const countTokens = text => text === "zzcedar" ? 1 : text.length + (text.includes("cedar") ? 350 : 0);
  const result = piece(line, "cedar", countTokens);
  assert.deepEqual(result, { body: "zzcedar", kind: "excerpt" });
  assert.ok(countTokens(result.body) <= 350);

  const onlyOffCenterFits = text => text === "zcedarxxx" ? 1 : 351;
  assert.deepEqual(piece(line, "cedar", onlyOffCenterFits), { body: "zcedarxxx", kind: "excerpt" });
});

test("when no match fits the excerpt uses the longest fitting code-point prefix", () => {
  const line = `😀xy${"z".repeat(360)}cedar`;
  const countTokens = text => text === "😀x" ? 1 : 351;
  assert.deepEqual(piece(line, "cedar", countTokens), { body: "😀x", kind: "excerpt" });
  assert.deepEqual(piece(line, "cedar", () => 351), { body: "😀", kind: "excerpt" });
  assert.deepEqual(piece(line, "unrelated", () => 351), { body: "😀", kind: "excerpt" });
});

test("the excerpt bounds meter calls even with many matching runs and bigrams", () => {
  for (const repetitions of [32, 256]) {
    const line = `😀x${"cedar😀".repeat(repetitions)}`;
    let calls = 0;
    const countTokens = text => {
      calls++;
      return text === "😀x" ? 1 : 351;
    };
    const result = piece(line, "cedar", countTokens);
    assert.ok(calls <= 12 * Array.from(line).length + 3, `meter called ${calls} times`);
    assert.deepEqual(result, { body: "😀x", kind: "excerpt" });
  }
});
