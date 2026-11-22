import assert from "node:assert/strict";
import { test } from "node:test";
import {
  allDigests, coreDigest, engineLegacyDigest, fingerprintLegacyCapture, hostedV1Digest,
  legacyExactMac, passageShingles, userFingerprintKey, validateSuppressionFact,
} from "../src/index.mjs";
import { cases, coreRefusal, expected, inputOf, keyIds, FAKE_MASTER, FAKE_ROTATED_MASTER, OWNERS } from "./privacy-vectors.mjs";

const keys = await Promise.all(OWNERS.map((owner) => userFingerprintKey(FAKE_MASTER, owner)));

function digest(pipeline, value, keyId = null) {
  return { pipeline, value, alg: keyId ? "hmac" : "sha256", redactionVersion: pipeline === "core" ? 3 : 1, keyId };
}

function distinct(digests) {
  return digests.filter((candidate, index) =>
    digests.findIndex(({ alg, value }) => alg === candidate.alg && value === candidate.value) === index);
}

test("hosted key IDs are stable across owners and change with a rotated master", async () => {
  for (const key of keys) {
    assert.equal(key.id, keyIds.master);
    assert.deepEqual(key.signingKey.usages, ["sign"]);
    assert.equal(key.signingKey.extractable, false);
  }
  const rotated = await userFingerprintKey(FAKE_ROTATED_MASTER, OWNERS[0]);
  assert.equal(rotated.id, keyIds.rotated);
  assert.notEqual(rotated.id, keyIds.master);
  assert.equal(await userFingerprintKey(null, OWNERS[0]), null);
  assert.equal(await userFingerprintKey("", OWNERS[0]), null);
});

for (const vector of cases) {
  test(`fingerprint: ${vector.id}`, async () => {
    const input = inputOf(vector);
    const row = expected[vector.id];
    if (row.coreDigest.refusal) {
      await assert.rejects(coreDigest(input), coreRefusal(row.coreDigest.refusal));
      await assert.rejects(allDigests(input), coreRefusal(row.coreDigest.refusal));
      await assert.rejects(hostedV1Digest(input), { name: row.hostedV1Digest.refusal });
      await assert.rejects(engineLegacyDigest(input), coreRefusal(row.engineLegacyDigest.refusal));
      for (const [index, owner] of OWNERS.entries()) {
        await assert.rejects(fingerprintLegacyCapture(input, keys[index]),
          coreRefusal(row.fingerprintLegacyCapture[owner].refusal));
      }
      return;
    }

    const [key] = keys;
    const core = digest("core", row.coreDigest.sha256);
    const keyed = digest("core", row.coreDigest.hmac, key.id);
    const hosted = digest("hosted-v1", row.hostedV1Digest);
    const aliases = [hosted];
    assert.deepEqual(await coreDigest(input), core);
    assert.deepEqual(await coreDigest(input, key), keyed);
    assert.deepEqual(await hostedV1Digest(input), hosted);
    if (row.engineLegacyDigest.refusal) {
      await assert.rejects(engineLegacyDigest(input), coreRefusal(row.engineLegacyDigest.refusal));
    } else {
      const engine = digest("engine-legacy", row.engineLegacyDigest);
      aliases.push(engine);
      assert.deepEqual(await engineLegacyDigest(input), engine);
    }
    if (row.engineNarrowDigest?.refusal) {
      await assert.rejects(engineLegacyDigest(input, vector.narrowMaxUtf16), coreRefusal(row.engineNarrowDigest.refusal));
    } else if (row.engineNarrowDigest) {
      assert.deepEqual(await engineLegacyDigest(input, vector.narrowMaxUtf16), digest("engine-legacy", row.engineNarrowDigest));
    }
    if (row.engineWideDigest?.refusal) {
      await assert.rejects(engineLegacyDigest(input, 20_000), coreRefusal(row.engineWideDigest.refusal));
    } else if (row.engineWideDigest) {
      assert.deepEqual(await engineLegacyDigest(input, 20_000), digest("engine-legacy", row.engineWideDigest));
    }
    assert.deepEqual(await allDigests(input), distinct([core, ...aliases]));
    const lookup = await allDigests(input, key);
    assert.deepEqual(lookup, distinct([keyed, ...aliases]));
    validateSuppressionFact({
      kind: "text", owner: OWNERS[0], actionId: vector.id, origin: "forget", mode: "exact",
      text: { digests: [keyed] },
    });
    for (const [index, owner] of OWNERS.entries()) {
      const legacy = row.fingerprintLegacyCapture[owner];
      assert.deepEqual(await fingerprintLegacyCapture(input, keys[index]), legacy);
      assert.equal(await legacyExactMac(input, keys[index]), legacy.text_hmac);
      assert.deepEqual(await passageShingles(input, keys[index]), legacy.shingles);
    }
    assert.notEqual(row.fingerprintLegacyCapture[OWNERS[0]].text_hmac, row.fingerprintLegacyCapture[OWNERS[1]].text_hmac);
  });
}
