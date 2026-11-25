import assert from "node:assert/strict";
import test from "node:test";
import { hostedV1Digest, sha256Hex } from "../src/privacy/fingerprint.mjs";
import { legacyPassageMatcher, MAX_LEGACY_PASSAGE_SENTENCES } from "../src/privacy/legacy-passages.mjs";
import { StreamingSha256 } from "../src/privacy/streaming-sha256.mjs";
import { createMemoryService } from "../src/service/index.mjs";
import { hostedScope as scope, serviceFake } from "./helpers/service-fake.mjs";

const source = { kind: "mcp", client: null, sessionId: null };
const forgotten = "The cedar gate opens at sunrise.";
const sentences = count => Array.from({ length: count }, (_, index) => `Entry ${index} is empty.`);

async function fact(text, overrides) {
  return { ...scope, kind: "text", actionId: "test-passage", origin: "forget", mode: "full",
    text: { keyId: null, shingles: null, digests: [await hostedV1Digest(text)] }, ...overrides };
}

test("streaming SHA-256 agrees with Web Crypto across blocks and padding boundaries", async () => {
  const stream = new StreamingSha256();
  const copy = new StreamingSha256();
  const encoder = new TextEncoder();
  const hex = words => Array.from(words, word => word.toString(16).padStart(8, "0")).join("");
  const chunks = ["", "a".repeat(55), "b", "c".repeat(7), "d", "雪".repeat(30), "🎋"];
  let input = "";
  for (const chunk of chunks) {
    input += chunk;
    stream.update(encoder.encode(chunk));
    copy.copyFrom(stream);
    assert.equal(hex(copy.finish()), await sha256Hex(input));
  }
  stream.reset();
  stream.update(encoder.encode("abc"));
  assert.equal(hex(stream.finish()), "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
});

for (const [name, passage, text] of [
  ["CJK punctuation without whitespace", "雨很大！天很暗？", "門已關。雨很大！天很暗？船已到。"],
  ["line breaks without punctuation", "the old bridge", "first line\r\n  the old bridge\nlast line"],
  ["lowercase after a period", forgotten, `It is late. ${forgotten.toLowerCase()} The road is empty.`],
  ["a period within a version number", "Use release 1.2.", "Start. Use release 1.2. Stop."],
  ["two sentences with mixed spacing", "Roses grow here. The wind is cold.", "Go north! Roses grow here.\nThe wind is cold. Stop."],
  ["six sentences", sentences(6).join(" "), `Go north. ${sentences(6).join(" ")} Stop.`],
  ["redaction that consumes terminal punctuation", "A password=invalidFixtureSecret123.", "Begin. A password=invalidFixtureSecret123. Continue."],
]) {
  test(`legacy passages match ${name}`, async () => {
    const match = legacyPassageMatcher(scope, [await fact(passage)]);
    assert.equal(match(text), true);
  });
}

test("save withholds a passage in a 250-sentence text", async () => {
  const fake = serviceFake({ writes: true, hasKey: false });
  fake.seedFact(await fact(forgotten));
  const service = createMemoryService(fake.deps);
  const utterances = sentences(250);
  utterances[170] = forgotten;
  assert.equal((await service.save(scope, utterances.join(" "), source)).status, "suppressed");
  assert.equal(fake.mutations.some(({ method }) => method === "memories.insert"), false);
});

test("only a scoped full-mode hosted SHA fact without shingles activates the cap", async () => {
  const unrelated = sentences(MAX_LEGACY_PASSAGE_SENTENCES + 1).join(" ");
  const eligible = await fact(forgotten);
  const { text } = eligible;
  assert.equal(legacyPassageMatcher(scope, [eligible])(unrelated), true);
  assert.equal(legacyPassageMatcher(scope, [{ ...eligible, text: { ...text, shingles: [] } }])(unrelated), true);
  for (const excluded of [
    { ...eligible, mode: "exact", origin: "edit" },
    { ...eligible, owner: "other-owner" },
    { ...eligible, namespace: "other-namespace" },
    { ...eligible, text: { ...text, keyId: "test-key", shingles: ["ab"] } },
    { ...eligible, text: { ...text, digests: [{ ...text.digests[0], pipeline: "core" }] } },
  ]) assert.equal(legacyPassageMatcher(scope, [excluded]), undefined);
  assert.equal(legacyPassageMatcher(scope, []), undefined);
});

test("2,000 sentences and 50 legacy facts stay within the scanning budget", async t => {
  const facts = await Promise.all(Array.from({ length: 50 }, (_, index) => fact(`Missing sentence ${index}.`)));
  const match = legacyPassageMatcher(scope, facts);
  const text = sentences(2_000).join(" ");
  const started = performance.now();
  assert.equal(match(text), false);
  const elapsed = performance.now() - started;
  t.diagnostic(`Legacy scan took ${Math.round(elapsed)} ms (budget 12,000 ms)`);
  assert.ok(elapsed < 12_000, `Legacy scan took ${elapsed} ms`);
});
