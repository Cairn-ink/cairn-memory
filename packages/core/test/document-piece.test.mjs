import assert from "node:assert/strict";
import { test } from "node:test";
import { rankDocumentCards, selectDocumentPiece } from "@cairn-ink/core/routing";

const countTokens = text => text.length;
const piece = (body, query, maxTokens = 1_000) => selectDocumentPiece({ body }, query, { maxTokens, countTokens });

test("whole cues use 60 percent of the budget and truncate at line boundaries", () => {
  const body = "abcdef\nghij";
  assert.deepEqual(piece(body, "send the entire note", 20), { kind: "whole", body });
  assert.deepEqual(piece(body, "全文", 10), { kind: "truncated", body: "abcdef" });
  assert.deepEqual(piece(body, "all of the note", 18), { kind: "truncated", body: "abcdef" });
  assert.deepEqual(piece(body, "完整", 19), { kind: "whole", body });
  assert.deepEqual(piece(body, "écomplete", 10), { kind: "whole", body });
});

test("a whole cue uses a code-point prefix when the first line is too long", () => {
  assert.deepEqual(piece("abc😀def\nmore", "resend", 9), { kind: "truncated", body: "abc😀" });
  assert.deepEqual(piece("😀abc", "resend", 2), { kind: "truncated", body: "" });
  assert.deepEqual(selectDocumentPiece({ body: "abcdef" }, "resend", {
    maxTokens: 5, countTokens: text => text === "abcde" ? 3 : text.length,
  }), { kind: "truncated", body: "abcde" });
});

test("ordinary queries return whole bodies at the exact window threshold", () => {
  const body = "a".repeat(350);
  assert.deepEqual(piece(body, "query"), { kind: "whole", body });
  assert.deepEqual(piece(body + "a", "query"), { kind: "excerpt", body });
});

test("the reference window probes both sides from the same bounds and attaches the heading", () => {
  const body = `# H\n${"a".repeat(200)}\ntarget\n${"b".repeat(200)}`;
  assert.deepEqual(piece(body, "target"), {
    kind: "excerpt",
    body: "# H\n…\ntarget\nbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
  });
});

test("window matching uses distinct non-whitespace bigrams and the earliest line on ties", () => {
  const divider = "z".repeat(350);
  const body = `Topics:\n${divider}\nce dar\n${divider}\nDay 1\n${divider}\ncedar`;
  assert.deepEqual(piece(body, "CEDAR"), { kind: "excerpt", body: "Topics:\n…\nce dar" });
});

const card = (id, title, body = "") => ({ id, title, body });

test("vector ranking admits the cosine boundary and prefers the highest score", () => {
  const first = card("first", "Rain");
  const second = card("second", "Moss");
  const third = card("third", "Ferns");
  const options = {
    queryVector: [1, 0],
    cardVectors: new Map([
      [first.id, [0.35, Math.sqrt(1 - 0.35 ** 2)]],
      [second.id, new Float32Array([1, 0])],
      [third.id, [0, 0]],
    ]),
  };
  assert.deepEqual(rankDocumentCards("rain", [first, second, third], options), {
    card: second, score: 1, method: "vector",
  });
  assert.deepEqual(rankDocumentCards("", [first], options), { card: first, score: 0.35, method: "vector" });
  options.cardVectors.set(first.id, [0.34, Math.sqrt(1 - 0.34 ** 2)]);
  assert.equal(rankDocumentCards("rain", [first, third], options), null);
});

test("lexical ranking uses distinct query terms across title and body with stable ties", () => {
  const first = card("first", "Cedar", "Seedling care");
  const second = card("second", "Seedlings", "Watering cedar");
  assert.deepEqual(rankDocumentCards("cedar cedar watering", [first, second]), {
    card: second, score: 1, method: "lexical",
  });
  assert.deepEqual(rankDocumentCards("cedar moss", [first, second]), {
    card: first, score: 0.5, method: "lexical",
  });
  assert.equal(rankDocumentCards("cedar moss fern", [first, second]), null);
  assert.equal(rankDocumentCards("the and", [first, second]), null);
});
