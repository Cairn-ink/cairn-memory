import { buildDocumentCard } from "@cairn-ink/core/routing";
import { check, equal } from "./support.mjs";

/** @import { DocumentCardAmendment, DocumentCardSourceMessage, DocumentCardStore, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

/** @param {CaseContext} ctx */
function setup(ctx) {
  const { uow, documentCards, placement } = ctx.adapter;
  check(documentCards, "Document card store is required");
  const scope = ctx.scope(null);
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const write = (fn) => uow.run(scope.owner, {}, fn);
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const read = (fn) => uow.run(scope.owner, { readOnly: true }, fn);
  /** @param {string} key @param {string} [sessionId] */
  async function record(key, sessionId = "original-" + key) {
    const client = "client";
    const { card } = await buildDocumentCard({
      id: key, role: "user", content: "Document title\n\nOriginal body for " + key + ".", occurredAtMs: 1,
    }, { scope, client, canonicalSessionKey: sessionId });
    check(card, "Expected a routed card");
    /** @type {Parameters<DocumentCardStore["put"]>[2]} */
    const input = {
      id: card.id, scope, origin: "router", title: card.title, body: card.body,
      contentHash: await ctx.hash(card.body), date: card.date, sourceMemories: [], sentences: [], stale: [],
      sourceMessage: { client, sessionId, messageId: key },
    };
    return input;
  }
  return {
    scope, documentCards, write, read, record,
    /** @param {string} key @param {string} [sessionId] */
    async put(key, sessionId) {
      const input = await record(key, sessionId);
      equal((await write((tx) => documentCards.put(tx, scope, input))).status, "inserted", "Expected a new card");
      return input;
    },
    /** @param {string} id @param {DocumentCardAmendment} amendment */
    amend: (id, amendment) => write((tx) => documentCards.amend(tx, scope, id, amendment)),
    /** @param {string} id */
    get: (id) => read((tx) => documentCards.get(tx, scope, id)),
    list: () => read((tx) => documentCards.list(tx, scope)),
    async revision() {
      check(placement, "Placement must expose the owner index revision");
      return (await read((tx) => placement.catalog(tx, scope, { cursor: null, limit: 10 }))).indexRevision;
    },
  };
}

/** @param {string} amendmentId @param {string} date @param {DocumentCardSourceMessage} [sourceMessage]
 * @returns {DocumentCardAmendment} */
function change(amendmentId, date = "2025-01-02",
  sourceMessage = { client: "client", sessionId: "correction", messageId: amendmentId }) {
  return { amendmentId, date, sourceMessage, sentence: "Updated value " + amendmentId, quote: "Correction " + amendmentId };
}

/** @param {number} number @param {string} title @param {ConformanceCase["run"]} run @returns {ConformanceCase} */
const amendmentCase = (number, title, run) =>
  ({ id: `T-CARD-AMEND-${number}`, title, needs: ["documentCards"], run });

export const DOCUMENT_CARD_AMENDMENT_CASES = [
  amendmentCase(1, "get and list order amendments by date and then insertion", async (ctx) => {
    const store = setup(ctx);
    const { id } = await store.put("ordered");
    equal((await store.get(id))?.amendments, [], "New cards must have an empty amendment history");
    const later = change("later", "2025-01-03");
    const first = change("z-first-tie");
    const second = change("a-second-tie");
    for (const amendment of [later, first, second]) {
      equal((await store.amend(id, amendment)).status, "inserted", "A new amendment id must insert");
    }
    equal((await store.get(id))?.amendments, [first, second, later], "get must order by date and then insertion");
    equal((await store.list()).find((card) => card.id === id)?.amendments, [first, second, later],
      "list must order by date and then insertion");
  }),

  amendmentCase(2, "replays are idempotent and replacement preserves amendment history", async (ctx) => {
    const store = setup(ctx);
    const { documentCards, scope, write } = store;
    const card = await store.put("replayed");
    const amendment = change("stable");
    await store.amend(card.id, amendment);
    const replay = { ...amendment, sentence: "Different text from the replay" };
    equal((await store.amend(card.id, replay)).status, "unchanged", "A visible amendment id must be idempotent");
    equal((await store.get(card.id))?.amendments, [amendment], "A replay must preserve the first amendment payload");
    const replacement = { ...card, body: "Replacement", contentHash: await ctx.hash("Replacement") };
    equal((await write((tx) => documentCards.put(tx, scope, replacement))).status, "replaced", "Expected replaced content");
    equal((await store.get(card.id))?.amendments, [amendment], "A content replacement must retain amendment history");
  }),

  amendmentCase(3, "hideAmendment withholds one amendment and keeps its id reserved", async (ctx) => {
    const store = setup(ctx);
    const { documentCards, scope, write } = store;
    const { id } = await store.put("individual");
    const kept = change("kept");
    const hidden = change("hidden");
    await store.amend(id, kept);
    await store.amend(id, hidden);
    await write(async (tx) => {
      await documentCards.hideAmendment(tx, scope, id, hidden.amendmentId, "forget");
      equal((await documentCards.get(tx, scope, id))?.amendments, [kept], "hideAmendment must withhold only its target");
      equal((await documentCards.amend(tx, scope, id, hidden)).status, "unchanged", "A hidden amendment id must stay reserved");
    });
    equal((await store.list()).find((card) => card.id === id)?.amendments, [kept], "A replay must keep an amendment hidden");
  }),

  amendmentCase(4, "hidden and tombstoned cards refuse amendments", async (ctx) => {
    const store = setup(ctx);
    const { documentCards, scope, write } = store;
    const card = await store.put("removed");
    const original = change("existing");
    await store.amend(card.id, original);
    await write(async (tx) => {
      await documentCards.hide(tx, scope, card.id, "forget");
      equal(await documentCards.get(tx, scope, card.id), null, "A hidden card must be unavailable in its write transaction");
      equal((await documentCards.amend(tx, scope, card.id, original)).status, "hidden_card",
        "Card visibility must be checked before amendment replay");
    });
    equal((await store.amend(card.id, change("new"))).status, "hidden_card", "A tombstoned card must refuse new amendments");
    equal((await write((tx) => documentCards.put(tx, scope, card))).status, "tombstoned", "A tombstone must reject card replay");
    equal(await store.list(), [], "The tombstoned card and its amendments must be absent from list");
  }),

  amendmentCase(5, "a message or session hide also withholds amendments and counts the cascade", async (ctx) => {
    const store = setup(ctx);
    const { documentCards, scope, write } = store;
    const kept = await store.put("kept");
    const hidden = await store.put("hidden", "correction");
    const direct = change("direct");
    const sameSession = change("same-session");
    const cascade = change("cascaded", "2025-01-03", { client: "client", sessionId: "later", messageId: "later" });
    await store.amend(kept.id, direct);
    await store.amend(kept.id, sameSession);
    await store.amend(hidden.id, cascade);
    await write(async (tx) => {
      equal(await documentCards.hideWhere(tx, scope, { sourceMessage: direct.sourceMessage }, "forget"), { hidden: 1 },
        "Message selectors must count directly matched amendments");
      equal((await documentCards.get(tx, scope, kept.id))?.amendments, [sameSession],
        "Message selectors must match the message ID");
      equal(await documentCards.hideWhere(tx, scope, { session: sameSession.sourceMessage }, "forget"), { hidden: 3 },
        "Session selectors must count the matching card, its cascaded amendment and the directly matched amendment");
      equal(await documentCards.hideWhere(tx, scope, { session: sameSession.sourceMessage }, "forget"), { hidden: 0 },
        "An identical session hide must have no new effects");
    });
    equal((await store.get(kept.id))?.amendments, [], "The card with an independently hidden amendment must remain visible");
    equal(await store.get(hidden.id), null, "Session hiding must also hide cards with that source");
  }),

  {
    ...amendmentCase(6, "the index advances once per effective call", async (ctx) => {
      const store = setup(ctx);
      const { documentCards, scope, write } = store;
      const { id } = await store.put("index");
      const before = await store.revision();
      const first = change("first");
      const second = change("second");
      const third = change("third");
      await write(async (tx) => {
        for (const amendment of [first, second, third, first]) await documentCards.amend(tx, scope, id, amendment);
        await documentCards.hideAmendment(tx, scope, id, first.amendmentId, "forget");
        await documentCards.hideAmendment(tx, scope, id, first.amendmentId, "forget");
        await documentCards.hideAmendment(tx, scope, id, "unknown", "forget");
      });
      equal(await store.revision(), before + 4, "Three effective adds and one hide must advance four times in one transaction");
      await write((tx) => documentCards.hideWhere(tx, scope, { session: second.sourceMessage }, "forget"));
      equal(await store.revision(), before + 5, "An amendment-only bulk hide must advance the index once");
      await write((tx) => documentCards.hideWhere(tx, scope, { session: second.sourceMessage }, "forget"));
      equal(await store.revision(), before + 5, "Repeating a bulk hide must leave the index unchanged");
      await store.amend(id, change("remaining", "2025-01-03"));
      await write((tx) => documentCards.hide(tx, scope, id, "forget"));
      equal(await store.revision(), before + 7, "A card hide that cascades must still advance the index once");
    }),
    needs: ["documentCards", "placement"],
  },
];
