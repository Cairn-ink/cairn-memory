import assert from "node:assert/strict";
import { test } from "node:test";
import { createMemoryService } from "@cairn-ink/core/service";
import { allDigests, coreFingerprintLabels, fingerprintLegacyCapture } from "../src/privacy/fingerprint.mjs";
import { hostedScope as scope, serviceFake } from "./helpers/service-fake.mjs";

const selection = { client: "client", sessionId: "fresh-session", eventId: "event" };
const forgotten = "The lantern is stored beneath the western staircase.";
const containing = "A note from the caretaker: " + forgotten + " Please leave it there.";
const unrelated = "Log small purchases in the blue notebook.";
const message = (id, content, occurredAtMs) => ({ id, role: "user", content, occurredAtMs });
const messages = [message("containing", containing, 10), message("unrelated", unrelated, 20)];
const { client, sessionId } = selection;

async function setup() {
  // `forgetting` enables the fake's row-level prefilter when candidates include passages.
  const fake = serviceFake({ writes: true, capture: true, rawArchive: true, forgetting: {} });
  const key = await fake.storage.keys.userKey(scope.owner);
  const { shingles } = await fingerprintLegacyCapture(forgotten, key, coreFingerprintLabels);
  const fact = { ...scope, kind: "text", mode: "full", origin: "forget", actionId: "forget-lantern",
    text: { digests: await allDigests(forgotten, key), shingles, keyId: key.id } };
  // Let the service's snapshot path make the text decision even if source eligibility allows every position.
  fake.hooks.eligible = rows => rows.map((_, index) => index);
  const seedForgotten = () => fake.seedFact(fact);
  const service = createMemoryService(fake.deps);
  return { ...fake, service, seedForgotten };
}

test("capture admission scrubs a message containing a forgotten passage", async () => {
  const { service, mutations, seedForgotten } = await setup();
  seedForgotten();
  assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages }), { status: "accepted" });
  const expected = [{ ...messages[0], content: "" }, messages[1]];
  assert.deepEqual(mutations.find(({ method }) => method === "capture.admit").args[1], expected);
  assert.deepEqual(mutations.find(({ method }) => method === "raw.recordLineage").args[1], expected);
});

test("raw import withholds a message containing a forgotten passage", async () => {
  const { service, calls, archived, seedForgotten } = await setup();
  seedForgotten();
  assert.deepEqual(await service.importRawMessages(scope, [{ client, sessionId, messages }]),
    { imported: 1, duplicate: 0, suppressed: 1, invalid: 0 });
  assert.deepEqual(calls.find(([method]) => method === "raw.importArchive").at(-1), { withheld: [0] });
  assert.deepEqual(archived(scope.owner), [messages[1]]);
});

for (const forgottenDuringEmbedding of [false, true]) {
  const timing = forgottenDuringEmbedding ? "at finish after embedding" : "before embedding";
  test(`capture withholds model output containing a forgotten passage ${timing}`, async () => {
    const { service, calls, hooks, mutations, seedForgotten } = await setup();
    assert.deepEqual(await service.enqueueCapture(scope, { ...selection, messages: [messages[1]] }),
      { status: "accepted" });
    if (forgottenDuringEmbedding) hooks.embed = seedForgotten;
    else seedForgotten();
    hooks.model = () => ({ items: [containing, unrelated].map(content => ({
      content, kind: "fact", confidence: 0.9, sourceIndices: [0],
    })) });
    assert.equal((await service.runCapture(scope, selection)).status, "done");
    const items = mutations.find(({ method }) => method === "capture.finish").args[1];
    assert.deepEqual(items.map(({ content }) => content), [unrelated]);
    assert.deepEqual(calls.find(([method]) => method === "embed")[1],
      (forgottenDuringEmbedding ? [containing, unrelated] : [unrelated]).map(content => content.toLowerCase()));
  });
}
