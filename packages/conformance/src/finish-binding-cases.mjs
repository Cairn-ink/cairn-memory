import { check, equal, fixtureEmbedding, readDump } from "./support.mjs";

/** @import { CaptureKey, CaptureMessage, FinishItem, Receipt, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

/** @param {CaseContext} ctx */
async function fixture(ctx) {
  const { owner, harness, adapter: { capture, memories, uow } } = ctx;
  if (typeof capture.admit !== "function") return null;
  const { admit } = capture;
  const scope = ctx.scope(null);
  const session = { client: "fixture-client", sessionId: "fixture-session" };
  /** @type {CaptureKey} */
  const key = { ...session, scope, eventId: crypto.randomUUID(), payloadDigest: "a".repeat(64) };
  /** @type {CaptureMessage[]} */
  const messages = [
    { id: "first", role: "user", content: "The shed has a green door.", occurredAtMs: 1 },
    { id: "second", role: "user", content: "The greenhouse has a blue door.", occurredAtMs: 2 },
  ];
  const receipts = messages.map(({ id, role, occurredAtMs }) => ({ ...session, messageId: id, role, occurredAtMs }));
  const [first, second] = receipts;
  const content = "The shed door is green.";
  const embedding = fixtureEmbedding(ctx);
  /** @type {FinishItem} */
  const item = {
    content, kind: "fact", confidence: 0.8, textHash: await ctx.hash(content),
    embedding: embedding && { model: embedding.model, vector: new Float32Array(embedding.vector) }, receipts: [first],
  };

  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const write = fn => uow.run(owner, { pauseLock: true }, fn);
  /** @param {CaptureKey} captureKey */
  async function claim(captureKey) {
    const admission = await write(tx => admit.call(capture, tx, captureKey, messages));
    equal(admission.status, "admitted", "The fixture must admit its messages");
    const claimed = await write(tx => capture.claim(tx, captureKey, messages, { leaseMs: 60_000 }));
    check(claimed.status === "claimed", "The fixture must claim its capture");
    return (await write(tx => capture.beginDispatch(tx, claimed.token))).token;
  }
  const token = await claim(key);
  const exported = () => uow.run(owner, { readOnly: true }, async tx =>
    (await memories.exportPage(tx, scope, { cursor: null, limit: 10 })).items.map(({ id }) => id));
  /** @param {Tx} tx @param {number[]} positions */
  const assertSelection = (tx, positions) => capture.assertEligible(tx, key, positions);

  /** @param {FinishItem[]} items @param {number[][]} selections @param {string} message */
  async function rejectFinish(items, selections, message) {
    const before = await readDump(harness);
    let refused = false;
    try {
      await write(async tx => {
        for (const positions of selections) await assertSelection(tx, positions);
        try {
          await capture.finish(tx, token, items);
        } catch (error) {
          refused = true;
          throw error;
        }
      });
    } catch (error) {
      if (!refused) throw error;
    }
    check(refused, message);
    equal(await exported(), [], "A rejected finish must leave no exported memory");
    equal(await readDump(harness), before, "A rejected finish must leave the dump unchanged");
  }

  async function finishValid() {
    const { memories: written } = await write(async tx => {
      await assertSelection(tx, [1]);
      await assertSelection(tx, [0]);
      return capture.finish(tx, token, [item]);
    });
    check(written.length === 1 && written[0]?.outcome === "inserted",
      "The rejected claim must still finish with a receipt in the latest same-transaction selection");
    equal(await exported(), [written[0].id], "The valid finish must store its memory");
  }

  async function finishEmpty() {
    const emptyKey = { ...key, eventId: crypto.randomUUID() };
    const emptyToken = await claim(emptyKey);
    const before = await exported();
    const result = await write(tx => capture.finish(tx, emptyToken, []));
    equal(result.memories, [], "An empty finish without an assertion must return no memories");
    const replay = await write(tx => capture.claim(tx, emptyKey, messages, { leaseMs: 60_000 }));
    equal(replay.status, "rawReplay", "An empty finish without an assertion must complete its claim");
    equal(await exported(), before, "An empty finish must leave the exported memories unchanged");
  }

  return { write, assertSelection, rejectFinish, finishValid, finishEmpty, item, second };
}

/** @type {readonly ConformanceCase[]} */
export const FINISH_BINDING_CASES = [
  {
    id: "K-FIN-BIND-1", title: "finish refuses a receipt outside the asserted selection", needs: ["rawArchive"],
    async run(ctx) {
      const setup = await fixture(ctx);
      if (!setup) return "needs capture.admit";
      const { item, second, rejectFinish, finishValid, finishEmpty } = setup;
      await rejectFinish([item, { ...item, receipts: [...item.receipts, second] }], [[0]],
        "Finish must reject a receipt outside the asserted selection");
      await finishValid();
      await finishEmpty();
    },
  },
  {
    id: "K-FIN-BIND-2", title: "finish requires an assertion in its own transaction", needs: ["rawArchive"],
    async run(ctx) {
      const setup = await fixture(ctx);
      if (!setup) return "needs capture.admit";
      const { item, write, assertSelection, rejectFinish, finishValid } = setup;
      await write(tx => assertSelection(tx, [0]));
      await rejectFinish([item], [], "Finish must reject a receipt asserted only in an earlier transaction");
      await finishValid();
    },
  },
  {
    id: "K-FIN-BIND-3", title: "finish uses the most recent asserted selection", needs: ["rawArchive"],
    async run(ctx) {
      const setup = await fixture(ctx);
      if (!setup) return "needs capture.admit";
      const { item, second, rejectFinish, finishValid } = setup;
      await rejectFinish([{ ...item, receipts: [second] }], [[0, 1], [0]],
        "Finish must reject a receipt excluded by the latest assertion");
      await finishValid();
    },
  },
  {
    id: "K-FIN-BIND-4", title: "finish refuses receipts with unmatched source addresses", needs: ["rawArchive"],
    async run(ctx) {
      const setup = await fixture(ctx);
      if (!setup) return "needs capture.admit";
      const { item, rejectFinish, finishValid } = setup;
      /** @type {Array<[Partial<Receipt>, string]>} */
      const mismatches = [
        [{ client: "other-client" }, "another client"],
        [{ sessionId: "other-session" }, "another session"],
        [{ messageId: "unknown-message" }, "an unknown message ID"],
      ];
      for (const [address, label] of mismatches) {
        await rejectFinish([{ ...item, receipts: [{ ...item.receipts[0], ...address }] }], [[0, 1]],
          `Finish must reject a receipt with ${label}`);
      }
      await finishValid();
    },
  },
];
