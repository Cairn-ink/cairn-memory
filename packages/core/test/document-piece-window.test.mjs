import assert from "node:assert/strict";
import { test } from "node:test";
import { selectDocumentPiece } from "../src/routing/index.mjs";

const piece = (body, query, countTokens = text => text.length) =>
  selectDocumentPiece({ body }, query, { maxTokens: 1_000, countTokens });

test("an oversized matching line keeps the match near the end", () => {
  const result = piece(`${"a".repeat(350)} cedar`, "cedar");
  assert.deepEqual(result, { body: `${"a".repeat(344)} cedar`, kind: "excerpt" });
});

test("an oversized matching line centers the first longest matching run", () => {
  const line = `ce ${"x".repeat(350)} CE DAR ${"x".repeat(350)} cedar ${"x".repeat(350)}`;
  const result = piece(`# Guide\n${line}`, "cedar");
  assert.equal(result.kind, "excerpt");
  assert.equal(result.body.length, 350);
  assert.equal(result.body.indexOf("CE DAR"), 172);
  assert.ok(!result.body.includes("cedar"));
});

test("an oversized line includes the heading when the combined excerpt fits", () => {
  const countTokens = text => Math.ceil(text.length / 100) * 100;
  const result = piece(`# H\n${"a".repeat(350)} cedar`, "cedar", text =>
    countTokens(text.replace(/^# H\n…\n/u, "")));
  assert.equal(result.kind, "excerpt");
  assert.ok(result.body.startsWith("# H\n…\n"));
  assert.ok(result.body.endsWith("cedar"));
});

test("a run wider than the window still keeps a matching bigram", () => {
  const line = `${"z".repeat(360)} ced${" ".repeat(400)}ar ${"z".repeat(360)}`;
  const result = piece(line, "cedar");
  assert.equal(result.kind, "excerpt");
  assert.equal(result.body.length, 350);
  assert.ok(result.body.includes("ed"));
});
