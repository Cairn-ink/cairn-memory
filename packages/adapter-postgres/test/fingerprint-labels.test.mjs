import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fingerprintLegacyCapture, legacyExactMac, passageShingles, userFingerprintKey } from "../../core/src/index.mjs";
import { cases, FAKE_MASTER, FAKE_ROTATED_MASTER, inputOf, OWNERS } from "../../core/test/privacy-vectors.mjs";
import { HOSTED_FINGERPRINT_LABELS as labels } from "../src/index.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/fingerprint-labels.json", import.meta.url), "utf8"));
const keys = await Promise.all(OWNERS.map((owner) => userFingerprintKey(FAKE_MASTER, owner, labels)));
const rotated = await userFingerprintKey(FAKE_ROTATED_MASTER, OWNERS[0], labels);

async function assertCapture(input, key, expected) {
  if (expected.refusal) {
    const error = { code: expected.refusal };
    await assert.rejects(fingerprintLegacyCapture(input, key, labels), error);
    await assert.rejects(legacyExactMac(input, key, labels), error);
    await assert.rejects(passageShingles(input, key, labels), error);
    return;
  }
  assert.deepEqual(await fingerprintLegacyCapture(input, key, labels), expected);
  assert.equal(await legacyExactMac(input, key, labels), expected.text_hmac);
  assert.deepEqual(await passageShingles(input, key, labels), expected.shingles);
}

test("adapter exports frozen hosted domains and derives the production key IDs", () => {
  assert.ok(Object.isFrozen(labels));
  assert.deepEqual(keys.map(({ id }) => id), OWNERS.map((owner) => fixture.keyIds[owner]));
  assert.equal(rotated.id, fixture.rotatedKeyId);
});

test("rotated master produces the hosted legacy capture bytes", async () => {
  const vector = cases.find(({ id }) => id === fixture.rotatedCapture.caseId);
  assert.ok(vector);
  await assertCapture(inputOf(vector), rotated, fixture.rotatedCapture.expected);
});

for (const vector of cases) {
  test(`hosted fingerprint: ${vector.id}`, async () => {
    const input = inputOf(vector);
    for (const [index, owner] of OWNERS.entries()) {
      await assertCapture(input, keys[index], fixture.cases[vector.id][owner]);
    }
  });
}
