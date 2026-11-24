import { allDigests, coreFingerprintLabels, passageShingles, userFingerprintKey, withholdsAnyPassage } from "@cairn-ink/core";
import { check, equal } from "./support.mjs";

/** @import { FingerprintKey } from "@cairn-ink/core" */
/** @import { PassageFingerprint } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const forgotten = "The orchard has a cedar gate and a path lined with rosemary";
const containing = `At the trailhead, ${forgotten} next to the creek.`;
const unrelated = "Copper conducts electricity.";
const actionId = "test-forgotten-passage";

/** @param {string} text @param {FingerprintKey | null} key @returns {Promise<PassageFingerprint>} */
async function fingerprint(text, key) {
  return {
    digests: await allDigests(text, key),
    shingles: key ? await passageShingles(text, key, coreFingerprintLabels) : null,
    keyId: key?.id ?? null,
  };
}

/** @param {CaseContext} ctx */
async function ownerKey({ adapter, owner }) {
  const key = await adapter.keys.userKey(owner);
  check(key, "The enabled fingerprint key provider must return a key");
  return key;
}

/** @param {CaseContext} ctx @param {FingerprintKey | null} key */
async function seedForgotten({ harness, owner }, key) {
  await harness.seedFact(owner, {
    owner, actionId, kind: "text", mode: "full", origin: "forget", text: await fingerprint(forgotten, key),
  });
}

/** @param {CaseContext} ctx @param {PassageFingerprint} passage */
async function snapshotFacts({ adapter: { uow, suppressions }, owner, scope }, passage) {
  const snapshot = await uow.run(owner, { readOnly: true },
    (tx) => suppressions.snapshot(tx, scope(null), { passages: [passage] }));
  return snapshot.passages.map(({ fact }) => fact);
}

/** @type {readonly ConformanceCase[]} */
export const CAPTURE_CONTAINMENT_CASES = [
  {
    id: "K-SNAP-C1", title: "a forgotten passage inside a new capture output is withheld", needs: ["fingerprintKey"],
    async run(ctx) {
      const key = await ownerKey(ctx);
      await seedForgotten(ctx, key);
      const control = await fingerprint(unrelated, key);
      equal(withholdsAnyPassage([control], await snapshotFacts(ctx, control)), false,
        "Core must admit an unrelated capture output");

      const output = await fingerprint(containing, key);
      const facts = await snapshotFacts(ctx, output);
      check(facts.some((fact) => fact.actionId === actionId),
        "Snapshot must retain the full fact for a containing capture output");
      equal(withholdsAnyPassage([output], facts), true, "Core must withhold the containing capture output");
    },
  },
  {
    id: "K-SNAP-C2", title: "the no-key capture profile uses exact digests only",
    needs: [], needsOff: ["fingerprintKey"],
    async run(ctx) {
      equal(await ctx.adapter.keys.userKey(ctx.owner), null, "The no-key profile must have no owner key");
      await seedForgotten(ctx, null);
      const exact = await fingerprint(forgotten, null);
      equal(withholdsAnyPassage([exact], await snapshotFacts(ctx, exact)), true,
        "Core must withhold an exact capture output without a key");

      // Without a key the longer output misses the digest and containment is unavailable.
      const output = await fingerprint(containing, null);
      equal(withholdsAnyPassage([output], await snapshotFacts(ctx, output)), false,
        "Core must admit the SHA-miss containing output without a key");
    },
  },
  {
    id: "K-SNAP-C3", title: "a shingle key mismatch keeps the full fact for capture", needs: ["fingerprintKey"],
    async run(ctx) {
      const key = await ownerKey(ctx);
      await seedForgotten(ctx, key);
      // Only the candidate uses the other key, so the adapter need not rotate or store it.
      const otherKey = await userFingerprintKey("test-other-capture-key", ctx.owner, coreFingerprintLabels);
      check(otherKey && otherKey.id !== key.id, "The candidate needs a different shingle key");
      const output = await fingerprint(containing, otherKey);
      const facts = await snapshotFacts(ctx, output);
      check(facts.some((fact) => fact.actionId === actionId),
        "Snapshot must retain an ineligible full fact on a shingle key mismatch");
      equal(withholdsAnyPassage([output], facts), true, "Core must withhold when the shingle keys differ");
    },
  },
];
