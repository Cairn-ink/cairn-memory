import { buildDocumentCard, documentCardVisible } from "@cairn-ink/core/routing";
import { caught, check, equal, row } from "./support.mjs";

/** @import { DocumentCardStore, ItemRef, Scope, StoredDocumentCardRecord, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @typedef {Parameters<DocumentCardStore<StoredDocumentCardRecord>["put"]>[2]} CardWrite */

/** @param {CaseContext} ctx @param {Scope} scope @param {string} id
 * @param {CardWrite["sourceMemories"]} [sourceMemories] @returns {Promise<CardWrite>} */
async function authored(ctx, scope, id, sourceMemories = []) {
  const body = "Cabinet inventory";
  return { id, scope, origin: "manual", title: "Filed notes", body, date: null,
    contentHash: await ctx.hash(body), sourceMessage: null, sourceMemories, sentences: [], stale: [] };
}

/** @param {CaseContext} ctx */
function fixture(ctx) {
  const { uow, documentCards: store } = ctx.adapter;
  const visibilityInputs = store?.visibilityInputs?.bind(store);
  if (!store || !visibilityInputs) return null;
  const scope = ctx.scope(null);
  /** @param {CardWrite} card @returns {ItemRef} */
  const ref = ({ id, scope: { namespace } }) => ({ type: "card", id, namespace });
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const write = fn => uow.run(ctx.owner, { pauseLock: true }, fn);
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const read = fn => uow.run(ctx.owner, { readOnly: true }, fn);
  /** @param {CardWrite} card */
  const put = card => uow.run(card.scope.owner, { pauseLock: true }, tx => store.put(tx, card.scope, card));
  return { scope, ref, write, read, put, store, visibilityInputs };
}

/** @type {ConformanceCase[]} */
export const DOCUMENT_CARD_VISIBILITY_INPUT_CASES = [
  {
    id: "T-CARD-INPUT-1", title: "card inputs keep ref order and return null for unavailable rows",
    needs: ["documentCards"],
    async run(ctx) {
      const f = fixture(ctx);
      if (!f) return "needs documentCards.visibilityInputs";
      const first = await authored(ctx, f.scope, "first");
      const last = await authored(ctx, f.scope, "last");
      const hidden = await authored(ctx, f.scope, "hidden");
      const tombstone = await authored(ctx, f.scope, "tombstone");
      const otherNamespace = await authored(ctx, ctx.scope("other-namespace"), "other-namespace");
      const otherOwner = await authored(ctx, { ...f.scope, owner: ctx.otherOwner }, "other-owner");
      for (const card of [first, last, hidden, tombstone, otherNamespace, otherOwner]) {
        equal((await f.put(card)).status, "inserted", "Expected a new card");
      }
      await f.write(async tx => {
        await f.store.hide(tx, f.scope, hidden.id, "forget");
        await f.store.hide(tx, f.scope, tombstone.id, "forget");
      });
      equal((await f.put(tombstone)).status, "tombstoned", "A replay preserves the tombstone");

      const refs = [
        f.ref(last), { ...f.ref(first), type: /** @type {const} */ ("memory") },
        f.ref(otherNamespace), f.ref(otherOwner), { ...f.ref(first), id: "unknown" },
        f.ref(hidden), f.ref(tombstone), f.ref(first), f.ref(last),
      ];
      const inputs = await f.read(tx => f.visibilityInputs(tx, f.scope, refs));
      equal(inputs.map(input => input?.card.id ?? null),
        [last.id, null, null, null, null, null, null, first.id, last.id], "Card inputs must align with refs");
      for (const input of inputs) {
        if (input) check((await documentCardVisible(input)).visible, "Expected complete authored visibility evidence");
      }
    },
  },
  {
    id: "T-CARD-INPUT-2", title: "card input records a forgotten linked memory",
    needs: ["documentCards"],
    async run(ctx) {
      const f = fixture(ctx);
      if (!f) return "needs documentCards.visibilityInputs";
      const memory = await row(ctx, "The cabinet has a brass latch.");
      const { id, revision } = await f.write(tx => ctx.adapter.memories.insert(tx, f.scope, memory, [], 1));
      const card = await authored(ctx, f.scope, "dependent", [{ id, revision }]);
      await f.put(card);
      const load = () => f.read(tx => f.visibilityInputs(tx, f.scope, [f.ref(card)]));
      const [before] = await load();
      check(before && (await documentCardVisible(before)).visible, "Expected visibility before forget");
      await ctx.harness.seedFact(ctx.owner,
        { ...f.scope, kind: "identity", origin: "forget", actionId: "forget-source", memoryId: id });
      const [after] = await load();
      check(after, "Expected evidence for the stored card");
      equal(after.memoryStates.get(id)?.status, "forgotten", "Expected the current linked memory state");
      equal(await documentCardVisible(after), { visible: false, reason: "source_memory_forgotten" },
        "Forgetting a linked memory must withhold the card");
    },
  },
  {
    id: "T-CARD-INPUT-3", title: "card input records a withheld source message",
    needs: ["documentCards", "rawArchive"],
    async run(ctx) {
      const f = fixture(ctx);
      if (!f) return "needs documentCards.visibilityInputs";
      const raw = ctx.adapter.raw;
      if (!raw?.fenceSession) return "needs Raw session fence";
      const client = "fixture";
      const sessionId = "source";
      const canonicalSessionKey = ctx.harness.hashSessionKey?.(client, sessionId) ??
        (ctx.sessionRefs === "plain" ? sessionId : null);
      check(canonicalSessionKey, "Expected the capture session key");
      const message = { id: "message", role: /** @type {const} */ ("user"), occurredAtMs: 1, content: "Cabinet inventory" };
      const { card: routed } = await buildDocumentCard(message, { scope: f.scope, client, canonicalSessionKey });
      check(routed, "Expected a message-backed card");
      const capture = { scope: f.scope, client, sessionId, eventId: "source-event", payloadDigest: "a".repeat(64) };
      await f.write(tx => raw.archive(tx, capture, [message]));
      /** @type {CardWrite} */
      const card = { id: routed.id, scope: f.scope, origin: "router", title: routed.title, body: routed.body,
        contentHash: await ctx.hash(routed.body), date: routed.date, sourceMessage: { client, sessionId, messageId: message.id },
        sourceMemories: [], sentences: [], stale: [] };
      await f.put(card);
      const load = () => f.read(tx => f.visibilityInputs(tx, f.scope, [f.ref(card)]));
      const [before] = await load();
      check(before && (await documentCardVisible(before)).visible, "Expected visibility before withholding");
      equal(before.card.canonicalSessionKey, canonicalSessionKey, "Expected capture's canonical session key");
      await f.write(tx => raw.fenceSession(tx, f.scope, { client, sessionId }));
      const [after] = await load();
      check(after, "Expected evidence for the stored card");
      equal(after.sourceWithheld, true, "Expected a definite Raw withholding verdict");
      equal(await documentCardVisible(after), { visible: false, reason: "source_withheld" },
        "Withholding the message must withhold its card");
    },
  },
  {
    id: "T-CARD-INPUT-4", title: "card inputs are bound to a live transaction snapshot",
    needs: ["documentCards"],
    async run(ctx) {
      const f = fixture(ctx);
      if (!f) return "needs documentCards.visibilityInputs";
      const card = await authored(ctx, f.scope, "snapshot");
      await f.put(card);
      const refs = [f.ref(card)];
      const endedTx = await f.read(async tx => {
        const [input] = await f.visibilityInputs(tx, f.scope, refs);
        check(input && (await documentCardVisible(input)).visible, "Expected the card in the original snapshot");
        return tx;
      });
      await f.write(tx => f.store.hide(tx, f.scope, card.id, "forget"));
      equal(await f.read(tx => f.visibilityInputs(tx, f.scope, refs)), [null], "A later snapshot must see the hide");
      await caught(() => f.visibilityInputs(endedTx, f.scope, refs));
    },
  },
];
