import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { boundedText, CoreError, normalizeBoundedText } from "../src/index.mjs";
import { cases, coreRefusal, inputOf } from "./privacy-vectors.mjs";

// Projected from the recorded engine outputs. Each entry hashes the original
// UTF-16LE code units and UTF-8 bytes independently. Null records invalid_text.
const recorded = JSON.parse(readFileSync(new URL("./fixtures/privacy/bounded-text.json", import.meta.url), "utf8"));
const expected = new Map(recorded.cases.map(([id, ...values]) => [id, values]));
const invalidText = coreRefusal("invalid_text");
const hash = (text, encoding) => createHash("sha256").update(text, encoding).digest("hex");

function assertBounded(run, index) {
  if (index === null) {
    assert.throws(run, (error) => error instanceof CoreError && error.code === "invalid_text" &&
      error.message === "invalid_text" && error.kind === "invalid_input" && !error.retryable);
    return;
  }
  const text = run();
  assert.deepEqual([hash(text, "utf16le"), hash(text, "utf8")], recorded.texts[index]);
}

test("bounded-text fixture covers the complete vector corpus", () => {
  assert.equal(cases.length, 325);
  assert.equal(recorded.cases.length, cases.length);
  assert.deepEqual([...expected.keys()].sort(), cases.map(({ id }) => id).sort());
});

for (const vector of cases) {
  test(`bounded text: ${vector.id}`, () => {
    const input = inputOf(vector);
    const [normalized, strict, truncated, strictNarrow, truncateNarrow] = expected.get(vector.id);
    assertBounded(() => normalizeBoundedText(input), normalized);
    assertBounded(() => boundedText(input, 4_000), strict);
    assertBounded(() => boundedText(input, 800, true), truncated);
    if (vector.narrowMaxUtf16 !== undefined) {
      assertBounded(() => boundedText(input, vector.narrowMaxUtf16), strictNarrow);
      assertBounded(() => boundedText(input, vector.narrowMaxUtf16, true), truncateNarrow);
    }
  });
}

test("the raw bound is inclusive and applies before any cleanup or truncation", () => {
  const at = " ".repeat(19_999) + "x";
  const above = at + " ";
  assert.equal(normalizeBoundedText(at), "x");
  assert.equal(boundedText(at, 4_000), "x");
  assert.throws(() => normalizeBoundedText(above), invalidText);
  assert.throws(() => boundedText(above, 4_000, true), invalidText);
  assert.equal(normalizeBoundedText(above, 20_001), "x");
  assert.equal(boundedText(above, 4_000, true, 20_001), "x");
  assert.throws(() => normalizeBoundedText("😀", 1), invalidText);
});

test("the normalized bound counts UTF-16 units after normalization", () => {
  const prefix = "a".repeat(3_998);
  const at = prefix + "😀";
  assert.equal(boundedText(at, 4_000), at);
  assert.equal(boundedText(at + "a", 4_000, true), at);
  assert.throws(() => boundedText(at + "a", 4_000), invalidText);
  assert.equal(boundedText(at, 3_999, true), prefix);
  assert.throws(() => boundedText(prefix + "ﬃ", 4_000), invalidText);
  assert.equal(boundedText(prefix + "ﬃ", 4_000, true), prefix + "ff");
});
