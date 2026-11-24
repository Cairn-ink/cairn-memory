import { check, equal, fixtureEmbedding } from "./support.mjs";

/** @import { CaptureKey, FinishItem } from "@cairn-ink/core/ports" */
/** @import { ConformanceCase } from "./index.d.mts" */

/**
 * Reads reported positions the way core does: the array length and its own indexed entries, never its iterator.
 * Returns a sorted copy, so a later change to the store's array cannot alter what was checked.
 * @param {unknown} list
 * @param {string} label
 */
function readPositions(list, label) {
  check(Array.isArray(list), `${label} must be an array`);
  const positions = /** @type {unknown[]} */ (list);
  /** @type {number[]} */
  const values = [];
  for (let index = 0; index < positions.length; index++) {
    check(Object.hasOwn(positions, index), `${label} must not have holes`);
    const position = positions[index];
    check(Number.isInteger(position), `${label} must hold integer positions`);
    values.push(/** @type {number} */ (position));
  }
  return values.sort((a, b) => a - b);
}

/** @type {readonly ConformanceCase[]} */
export const captureFinishCases = [
  {
    id: "K-CLM-6", title: "finish reports the positions its write policy suppressed", needs: [],
    async run(ctx) {
      const { adapter: { capture, uow }, harness, owner } = ctx;
      if (typeof capture?.claim !== "function" || typeof capture.finish !== "function") {
        return "capture claim and finish ports are required";
      }

      /** @type {CaptureKey} */
      const key = { scope: ctx.scope(null), client: "client", sessionId: "session", eventId: "finish-positions",
        payloadDigest: "a".repeat(64) };
      /** @type {FinishItem[]} */
      const items = await Promise.all(["First memory", "Suppressed memory", "Final memory"].map(async (content) => {
        const fixture = fixtureEmbedding(ctx);
        const embedding = fixture && { model: fixture.model, vector: new Float32Array(fixture.vector) };
        return { content, kind: "fact", confidence: 0.4, textHash: await ctx.hash(content), embedding, receipts: [] };
      }));
      await harness.seedFact(owner, {
        owner, actionId: "forget-middle-item", origin: "forget", kind: "text", mode: "exact",
        text: { digests: [{ alg: "sha256", value: items[1].textHash.slice(7), pipeline: "core",
          redactionVersion: 1, keyId: null }] },
      });

      const claim = () => uow.run(owner, { pauseLock: true }, (tx) => capture.claim(tx, key, [], { leaseMs: 60_000 }));
      const fresh = await claim();
      check(fresh.status === "claimed", "Expected a fresh claim");
      const result = await uow.run(owner, { pauseLock: true }, (tx) => capture.finish(tx, fresh.token, items));
      equal(result.suppressedCount, 1, "Finish must count the suppressed middle item");
      equal(result.memories.length, 2, "Finish must write the other two items");
      const reported = result.suppressedItems === undefined ? undefined
        : readPositions(result.suppressedItems, "Finish suppression positions");
      if (reported) equal(reported, [1], "Finish must report exactly the suppressed middle position");

      const replay = await claim();
      // A completed claim may acknowledge a duplicate without returning a result.
      check(replay.status === "rawReplay" || replay.status === "duplicate", "Expected a completed claim");
      if (replay.status === "rawReplay") {
        const replayed = replay.result.suppressedItems === undefined ? undefined
          : readPositions(replay.result.suppressedItems, "Replayed suppression positions");
        equal(replayed, reported, "Replay must preserve the reported suppression positions");
      }
    },
  },
];
