// Replays the engine parity fixtures (carried over from the engine's parity suite) against core.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { decodeEmbeddingData } from "../src/extraction/embedding.mjs";
import { EXTRACT_MEMORIES_PROMPT, plainExtractionSpec, validatePlainCandidates } from "../src/extraction/extraction.mjs";

const fixture = (name) => JSON.parse(readFileSync(new URL(`./fixtures/extraction/${name}`, import.meta.url), "utf8"));

test("the prompt module equals the canonical Markdown bytes", () => {
  assert.equal(EXTRACT_MEMORIES_PROMPT, readFileSync(new URL("../prompts/extract-memories.md", import.meta.url), "utf8"));
});

for (const { name, messages, itemLimit, indexMaximum, errorMessage } of fixture("extraction-spec.json")) {
  test(`plain extraction request: ${name}`, () => {
    if (errorMessage) return assert.throws(() => plainExtractionSpec(messages), { message: errorMessage });
    const spec = plainExtractionSpec(messages);
    assert.equal(spec.system, EXTRACT_MEMORIES_PROMPT);
    assert.deepEqual(spec.input.messages.map((m) => m.index), messages.map((_, i) => i));
    assert.equal(spec.schema.properties.items.maxItems, itemLimit);
    const index = spec.schema.properties.items.items.properties.sourceIndices.items;
    assert.equal(index.maximum ?? null, indexMaximum);
  });
}

for (const { name, output, policy, errorCode, expected } of fixture("extraction-candidates.json")) {
  test(`plain extraction validation: ${name}`, () => {
    const validate = () => validatePlainCandidates(output, policy);
    if (errorCode) assert.throws(validate, { code: errorCode });
    else assert.deepEqual(validate(), expected);
  });
}

const embedding = fixture("embedding-data.json");
for (const { name, requestedCount, data, dataJson = JSON.stringify(data), errorCode, expected } of embedding.cases) {
  test(`embedding decode: ${name}`, () => {
    const decode = () => decodeEmbeddingData(JSON.parse(dataJson), requestedCount, embedding.spec);
    if (errorCode) assert.throws(decode, { code: errorCode });
    else assert.deepEqual(decode(), expected.map((v) => Float32Array.from(v)));
  });
}
