import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import {
  canonicalKey, canonicalTuple, compareCanonical, createBM25, fuseCandidates, termFrequencies, tokenizeT1,
  COMPACT_RRF_PRESETS, ENGLISH_STOPWORDS, REPRESENTATION_VERSION, RRF_PRESETS, TOKENIZER_VERSION,
} from "../src/index.mjs";

const golden = JSON.parse(readFileSync(new URL("./fixtures/retrieval/engine-goldens.json", import.meta.url), "utf8"));

// A retrieval read set belongs to one owner. The owner stays on the read set.
function adaptEngineRow(row) {
  const { ref, ...fields } = row;
  const { scope, projectId } = ref.namespace;
  return { ...fields, ref: {
    namespace: scope + "\u0000" + (projectId ?? ""), type: ref.type,
    id: ref.memoryId ?? ref.cardId ?? row.id ?? row.memoryId,
  } };
}

function assertOutcome(run, { value, error }, adapt = value => value) {
  if (error) {
    assert.throws(run, thrown => (thrown.code ?? thrown.message) === error);
    return;
  }
  const actual = run();
  const expected = adapt(value);
  assert.deepStrictEqual(actual, expected);
  const rows = Array.isArray(actual) ? actual : actual.rows;
  const expectedRows = Array.isArray(expected) ? expected : expected.rows;
  for (const [i, row] of rows.entries()) {
    assert.ok(Object.is(row.score, expectedRows[i].score), "score bits");
    if ("fusionScore" in row) {
      assert.ok(Object.is(row.fusionScore, expectedRows[i].fusionScore), "fusionScore bits");
      for (const [channel, rank] of Object.entries(row.channels)) {
        if (rank !== null) assert.ok(Object.is(rank.rawScore, expectedRows[i].channels[channel].rawScore), "rawScore bits");
      }
    }
  }
}

test("tokenizer versions and frozen stopwords match the engine", () => {
  assert.equal(TOKENIZER_VERSION, golden.TOKENIZER_VERSION);
  assert.equal(REPRESENTATION_VERSION, golden.REPRESENTATION_VERSION);
  assert.deepStrictEqual([...ENGLISH_STOPWORDS], golden.stopwords);
  assert.ok(Object.isFrozen(ENGLISH_STOPWORDS));
  for (const { method, error } of golden.stopwordMutations) {
    assert.throws(() => ENGLISH_STOPWORDS[method]("the"), { name: "TypeError", message: error });
  }
  assert.deepStrictEqual([...ENGLISH_STOPWORDS], golden.stopwords);
});

for (const { text, tokens, length, frequencies } of golden.tokens) {
  test("T1: " + JSON.stringify(text.length > 60 ? "all stopwords" : text), () => {
    assert.deepStrictEqual(tokenizeT1(text), tokens);
    const terms = termFrequencies(text);
    assert.equal(terms.length, length);
    assert.deepStrictEqual([...terms.frequencies], frequencies);
  });
}

const documents = golden.documents.map(adaptEngineRow);
test("the single-owner namespace adapter preserves the engine canonical order", () => {
  const expected = golden.canonicalOrder.map(ref => adaptEngineRow({ ref }).ref);
  const actual = [...documents].sort(compareCanonical).map(doc => doc.ref);
  assert.deepStrictEqual(actual, expected);
  for (const ref of actual) {
    assert.deepStrictEqual(canonicalTuple(ref), [ref.namespace, ref.type, ref.id]);
    assert.equal(canonicalKey(ref), JSON.stringify([ref.namespace, ref.type, ref.id]));
  }
  assert.ok(compareCanonical({ ...actual[0], namespace: null }, actual[0]) < 0);
});

const { search, df, ...stats } = createBM25(documents);
test("BM25 corpus statistics and duplicate keys match", () => {
  assert.deepStrictEqual({ ...stats, df: [...df] }, golden.index);
  assertOutcome(() => createBM25([...documents, { ...documents[0], text: "other" }]), golden.duplicateDocument);
});
for (const entry of golden.search) {
  test("BM25: " + JSON.stringify([entry.query, entry.depth]), () => {
    assertOutcome(() => search(entry.query, entry.depth), entry, rows => rows.map(adaptEngineRow));
  });
}

test("all frozen engine fusion presets match", () => {
  assert.deepStrictEqual({ ...RRF_PRESETS, ...COMPACT_RRF_PRESETS }, golden.presets);
});

const channels = Object.fromEntries(Object.entries(golden.channels).map(([name, rows]) => [name, rows.map(adaptEngineRow)]));
for (const entry of golden.fusion) {
  test("fusion: " + entry.name, () => {
    const { lexical, semantic, moc, opts } = entry;
    assertOutcome(() => fuseCandidates(channels[lexical], channels[semantic], opts && { ...opts, moc: channels[moc] }),
      entry, value => ({ ...value, rows: value.rows.map(adaptEngineRow) }));
  });
}
