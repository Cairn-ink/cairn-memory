import { NEAR_DUPLICATE_DISTANCE } from "@cairn-ink/core";
import { check, equal, fixtureEmbedding } from "./support.mjs";

/** @import { CaptureKey, FinishItem } from "@cairn-ink/core/ports" */
/** @import { ConformanceCase } from "./index.d.mts" */

/**
 * Reads reported positions in core's exact sequence: one length read for the bounds check, then the loop's own
 * length reads and each indexed entry before its ownership check, never the iterator. Returns a sorted copy, so a
 * later change to the store's array cannot alter what was checked. Callers read the result field once, first,
 * inside the finish transaction, as core does before it archives.
 * @param {unknown} list
 * @param {number} itemCount
 * @param {string} label
 */
function readPositions(list, itemCount, label) {
  check(Array.isArray(list), `${label} must be an array`);
  const positions = /** @type {unknown[]} */ (list);
  check(!(positions.length > itemCount), `${label} must not list more positions than items`);
  /** @type {Set<number>} */
  const values = new Set();
  for (let index = 0; index < positions.length; index++) {
    const position = positions[index];
    check(Object.hasOwn(positions, index), `${label} must not have holes`);
    check(Number.isInteger(position), `${label} must hold integer positions`);
    const value = /** @type {number} */ (position);
    check(value >= 0 && value < itemCount, `${label} must be within the item range`);
    check(!values.has(value), `${label} must not repeat a position`);
    values.add(value);
  }
  return [...values].sort((a, b) => a - b);
}

/** @type {readonly ConformanceCase[]} */
export const captureFinishCases = [
  {
    id: "K-CLM-6", title: "finish reports the positions its write policy suppressed", needs: [],
    async run(ctx) {
      const { adapter: { capture, memories, uow }, harness, owner } = ctx;
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
      // Core counts the batch before handing it to the store; the store may consume the caller's array.
      const itemCount = items.length;
      const expectedTexts = [items[0].content, items[2].content].sort();
      const forgottenHash = items[1].textHash;
      const { result, reported } = await uow.run(owner, { pauseLock: true }, async (tx) => {
        const finished = await capture.finish(tx, fresh.token, items);
        // Core reads this field first, inside the transaction, and archives from that single read.
        const list = finished.suppressedItems;
        return { result: finished,
          reported: list === undefined ? undefined : readPositions(list, itemCount, "Finish suppression positions") };
      });
      if (reported) equal(reported, [1], "Finish must report exactly the suppressed middle position");
      equal(result.suppressedCount, 1, "Finish must count the suppressed middle item");
      equal(result.memories.length, 2, "Finish must write the other two items");
      // Whether or not the store reports positions, it must store exactly the first and last items and not the
      // suppressed middle one. Compare stored text: a store could carry the wrong item under a reported hash.
      const stored = await uow.run(owner, { readOnly: true }, async (tx) => {
        const rows = [];
        for (const { id } of result.memories) rows.push(await memories.get(tx, key.scope, id));
        const [matches] = await memories.findDuplicates(tx, key.scope, [{ textHash: forgottenHash }],
          { nearDistance: NEAR_DUPLICATE_DISTANCE });
        return { texts: rows.map((row) => row?.text), forgotten: matches.filter(({ match }) => match === "exact").length };
      });
      equal([...stored.texts].sort(), expectedTexts, "Finish must store exactly the first and last items");
      equal(stored.forgotten, 0, "Finish must not store the suppressed middle item");

      const replay = await claim();
      // A completed claim may acknowledge a duplicate without returning a result.
      check(replay.status === "rawReplay" || replay.status === "duplicate", "Expected a completed claim");
      if (replay.status === "rawReplay") {
        const replayList = replay.result.suppressedItems;
        const replayed = replayList === undefined ? undefined
          : readPositions(replayList, itemCount, "Replayed suppression positions");
        equal(replayed, reported, "Replay must preserve the reported suppression positions");
      }
    },
  },
];
