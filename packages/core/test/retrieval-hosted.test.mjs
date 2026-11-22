import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  CoreError, decodeCursor, encodeCursor, fuseHosted, fuseHostedLexicalOnly, pageLimit, searchOffset,
} from "../src/index.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/retrieval/hosted-cases.json", import.meta.url), "utf8"));
const ref = id => ({ id, type: "memory", namespace: null });
const lexical = ([id, score, updatedAtUs]) => ({ ref: ref(id), score, updatedAtUs: BigInt(updatedAtUs) });
const vector = ([id, distance, updatedAtUs]) => ({ ref: ref(id), distance, updatedAtUs: BigInt(updatedAtUs) });
const ids = rows => rows.map(row => row.ref.id);
const inputLexical = fixture.lexical.map(lexical);
const inputVector = fixture.vector.map(vector);
const page = { offset: 0, limit: 50 };
const expectedScore = (lexicalRank, vectorRank) =>
  (lexicalRank === null ? 0 : 0.5 / (60 + lexicalRank)) + (vectorRank === null ? 0 : 1 / (60 + vectorRank));

test("hosted ranks by exact microseconds and descending UTF-8 ids", () => {
  const result = fuseHosted(inputLexical, inputVector, page);
  assert.deepStrictEqual(result, {
    total: 6,
    rows: fixture.fused.map(([id, lexicalRank, vectorRank, updatedAtUs]) => ({
      ref: ref(id), updatedAtUs: BigInt(updatedAtUs), lexicalRank, vectorRank,
      score: expectedScore(lexicalRank, vectorRank),
    })),
  });
  assert.deepStrictEqual(inputLexical, fixture.lexical.map(lexical));
  assert.deepStrictEqual(inputVector, fixture.vector.map(vector));
});

test("fused score ties use exact microseconds and then descending UTF-8 ids", () => {
  // Lexical/vector ranks (6, 50) and (10, 45) both contribute 1/60.
  const astralId = "😀";
  const bmpPrivateId = "";
  const rows = (highUs, lowUs) => {
    const left = Array.from({ length: 10 }, (_, i) =>
      lexical([i === 5 ? bmpPrivateId : i === 9 ? astralId : "lexical" + i, 10 - i,
        i === 5 ? highUs : lowUs]));
    const right = Array.from({ length: 50 }, (_, i) =>
      vector([i === 49 ? bmpPrivateId : i === 44 ? astralId : "vector" + i, i / 100,
        i === 49 ? highUs : lowUs]));
    const result = fuseHosted(left, right, { offset: 0, limit: 2 }).rows;
    assert.deepStrictEqual(result.map(row => row.score), [1 / 60, 1 / 60]);
    return ids(result);
  };
  assert.deepStrictEqual(rows(1002, 1001), [bmpPrivateId, astralId]);
  assert.deepStrictEqual(rows(1001, 1001), [astralId, bmpPrivateId]);
});

test("plugin floor keeps .45 and lexical pool matches and leaves retained scores and ranks intact", () => {
  const unfiltered = fuseHosted(inputLexical, inputVector, page);
  const filtered = fuseHosted(inputLexical, inputVector, { ...page, floor: true });
  assert.deepStrictEqual(ids(filtered.rows), fixture.floorIds);
  assert.equal(filtered.total, 5);
  assert.deepStrictEqual(filtered.rows, unfiltered.rows.filter(row => row.ref.id !== "over"));
  assert.deepStrictEqual(fuseHosted(inputLexical, inputVector, { offset: 2, limit: 2, floor: true }),
    { rows: filtered.rows.slice(2, 4), total: 5 });
});

const labelled = (prefix, index) => prefix + String(index).padStart(2, "0");
const lexicalPool = Array.from({ length: 60 }, (_, i) => lexical([labelled("l", i), 60 - i, 1001])).reverse();
const vectorPool = Array.from({ length: 60 }, (_, i) => vector([labelled("v", i), 0.2, i === 0 ? 1002 : 1001]));

test("ties at the vector pool boundary and paging span the whole 100-row union", () => {
  for (const [offset, limit, expected] of fixture.pages) {
    const result = fuseHosted(lexicalPool, vectorPool, { offset, limit });
    assert.equal(result.total, 100);
    assert.deepStrictEqual(ids(result.rows), expected, "offset " + offset);
  }
  const vectorPage = fuseHosted(lexicalPool, vectorPool, page).rows;
  assert.deepStrictEqual(ids(vectorPage), ["v00", ...Array.from({ length: 49 }, (_, i) => labelled("v", 59 - i))]);
  assert.deepStrictEqual(vectorPage.map(row => row.vectorRank), Array.from({ length: 50 }, (_, i) => i + 1));
  assert.ok(vectorPage.every(row => row.lexicalRank === null));
});

test("a lexical match below the lexical pool cutoff does not bypass the plugin floor", () => {
  const lexicalRows = [lexical(["outside", -1, 1001]), ...lexicalPool];
  const vectorRows = [vector(["outside", 0.4500001, 1001])];
  const without = fuseHosted(lexicalRows, vectorRows, page);
  assert.equal(without.total, 51);
  assert.deepStrictEqual(without.rows[0], {
    ref: ref("outside"), updatedAtUs: 1001n, score: 1 / 61, lexicalRank: null, vectorRank: 1,
  });
  const withFloor = fuseHosted(lexicalRows, vectorRows, { ...page, floor: true });
  assert.equal(withFloor.total, 50);
  assert.ok(!ids(withFloor.rows).includes("outside"));
});

test("lexical-only paging uses relevance, exact microseconds, and descending ids without a pool cut", () => {
  const ordered = fuseHostedLexicalOnly(inputLexical, page);
  assert.equal(ordered.total, 4);
  assert.deepStrictEqual(ids(ordered.rows), fixture.lexicalOnlyIds);
  assert.deepStrictEqual(fuseHostedLexicalOnly(inputLexical, { offset: 1, limit: 2 }),
    { rows: ordered.rows.slice(1, 3), total: 4 });
  assert.deepStrictEqual(ids(fuseHostedLexicalOnly(lexicalPool, { offset: 49, limit: 3 }).rows),
    ["l49", "l50", "l51"]);
});

test("page limit defaults, clamps and truncates like the hosted seam", () => {
  for (const [value, expected] of [
    [undefined, 10], [NaN, 10], [0, 1], [-1.5, 1], [1, 1], [12.9, 12], [50.1, 50], [99, 50], [Infinity, 50], [-Infinity, 1],
  ]) assert.equal(pageLimit(value), expected);
});

test("offset cursors are byte-compatible with the hosted JSON and base64url format", () => {
  for (const [offset, cursor] of fixture.cursors) {
    assert.equal(encodeCursor(offset), cursor);
    assert.equal(decodeCursor(cursor), offset);
    assert.equal(searchOffset(cursor), offset);
  }
  const unicode = ["\u{1f600}", "\ue000", "\ud800", "%"];
  const encoded = Buffer.from(JSON.stringify(unicode), "utf8").toString("base64url");
  assert.equal(encodeCursor(unicode), encoded);
  assert.deepStrictEqual(decodeCursor(encoded), unicode);
  assert.equal(searchOffset("MA=="), 0);
  assert.equal(searchOffset(null), 0);
  assert.equal(searchOffset(), 0);
});

test("invalid offsets and invalid encodings throw a content-free CoreError", () => {
  for (const cursor of ["!", "LTE", "MS41", "bnVsbA", "IjEi", "OTAwNzE5OTI1NDc0MDk5Mg", "_w", "77u_MA", ""]) {
    assert.throws(() => searchOffset(cursor), error =>
      error instanceof CoreError && error.code === "invalid_cursor" && error.message === "invalid_cursor");
  }
});
