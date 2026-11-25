import { CoreError, coreDigest, coreFingerprintLabels, passageShingles, userFingerprintKey } from "@cairn-ink/core";
import { buildDocumentCard } from "@cairn-ink/core/routing";
import { captureService, client as captureClient, message } from "./capture-documents-support.mjs";
import { check, equal, readDump, rejects, row, source } from "./support.mjs";

/** @import { ConformanceCase, CaseContext } from "./index.d.mts" */
/** @import { DocumentCardStore, ItemRef, Scope, StoredDocumentCardRecord, Tx } from "@cairn-ink/core/ports" */
/** @typedef {Parameters<DocumentCardStore<StoredDocumentCardRecord>["put"]>[2]} CardWrite */

const client = "purge-fixture";

/** @param {CaseContext} ctx @param {Scope} [scope] */
function fixture(ctx, scope = ctx.scope(null)) {
  const { documentCards, raw, fence, uow, memories } = ctx.adapter;
  check(documentCards, "Expected a document card store");
  /** @template T @param {(tx: Tx) => Promise<T>} work */
  const write = work => uow.run(ctx.owner, { pauseLock: true }, work);
  /** @template T @param {(tx: Tx) => Promise<T>} work */
  const read = work => uow.run(ctx.owner, { readOnly: true }, work);
  /** @param {CardWrite} card @returns {ItemRef} */
  const ref = ({ id }) => ({ type: "card", id, namespace: scope.namespace });
  return {
    cards: documentCards, raw, scope, write,
    get: (/** @type {string} */ id) => read(tx => documentCards.get(tx, scope, id)),
    list: () => read(tx => documentCards.list(tx, scope)),
    put: (/** @type {CardWrite} */ card) => write(tx => documentCards.put(tx, scope, card)),
    insert: async (/** @type {string} */ body, memorySource = source) => {
      const input = await row(ctx, body);
      return write(tx => memories.insert(tx, scope, { ...input, source: memorySource }, [], 1));
    },
    visible: (/** @type {CardWrite[]} */ records) => read(tx =>
      fence.assertVisible(tx, { owner: ctx.owner, namespaces: [scope.namespace] }, records.map(ref))),
    ref,
    /** @param {string} sessionId @param {ReturnType<typeof message>} item */
    async archive(sessionId, item) {
      check(raw, "Expected a Raw port");
      const capture = { scope, client, sessionId, eventId: item.id, payloadDigest: "a".repeat(64) };
      equal((await write(tx => raw.archive(tx, capture, [item]))).archived, 1, "Expected an archived source");
      return { client, sessionId, messageId: item.id };
    },
    async storedText() {
      const dump = await readDump(ctx.harness);
      check(Array.isArray(dump), "Expected an owner snapshot");
      const owner = dump.find(entry => entry && typeof entry === "object" && "owner" in entry && entry.owner === ctx.owner);
      check(owner && "documentCards" in owner, "Expected stored document-card state in the owner snapshot");
      return JSON.stringify(owner.documentCards);
    },
  };
}

/** @param {CaseContext} ctx @param {Scope} scope @param {string} sessionId @param {ReturnType<typeof message>} item */
async function routedCard(ctx, scope, sessionId, item) {
  const canonicalSessionKey = ctx.harness.hashSessionKey?.(client, sessionId) ??
    (ctx.sessionRefs === "plain" ? sessionId : null);
  check(canonicalSessionKey, "Expected a capture session key");
  const { card } = await buildDocumentCard(item, { scope, client, canonicalSessionKey });
  check(card, "Expected a built document card");
  const sourceMessage = { client, sessionId, messageId: item.id };
  return { id: card.id, scope, origin: /** @type {const} */ ("router"), sourceMessage, sourceMemories: [],
    title: card.title, body: card.body, date: card.date, contentHash: await ctx.hash(card.body),
    sentences: card.sentences.map(({ start, end }) => ({ start, end, source: sourceMessage })), stale: [] };
}

/** @param {CaseContext} ctx @param {Scope} scope @param {string} id @param {string} body @returns {Promise<CardWrite>} */
async function authoredCard(ctx, scope, id, body) {
  return { id, scope, origin: "manual", title: "Filed notes", body, contentHash: await ctx.hash(body),
    date: null, sourceMessage: null, sourceMemories: [], sentences: [], stale: [] };
}

/** @type {readonly ConformanceCase[]} */
export const DOCUMENT_CARD_PURGE_CASES = [
  {
    id: "T-CARD-PURGE-1", title: "Raw deletion tombstones all stored card and amendment bindings in its transaction",
    needs: ["documentCards", "rawArchive"],
    async run(ctx) {
      const f = fixture(ctx);
      const { raw } = f;
      check(raw, "Expected a Raw port");
      const first = message("first", "Cedar title. Cedar body.");
      const second = message("second", "Willow title. Willow body.");
      const control = message(first.id, "Keep these maple notes.");
      const deletedSource = await f.archive("deleted", first);
      const secondSource = await f.archive("deleted", second);
      const keepSource = await f.archive("control", control);
      const bound = await routedCard(ctx, f.scope, deletedSource.sessionId, first);
      const rejected = { ...await routedCard(ctx, f.scope, secondSource.sessionId, second), id: "reader-rejected" };
      const kept = await routedCard(ctx, f.scope, keepSource.sessionId, control);
      const amendment = { amendmentId: "amendment-to-erase", date: "2025-01-02", sourceMessage: deletedSource,
        sentence: "Deleted amendment sentence.", quote: "Deleted amendment quote." };
      const keptAmendment = { ...amendment, amendmentId: "keep-amendment", sourceMessage: keepSource,
        sentence: "Keep this amendment.", quote: "Keep this quote." };
      for (const card of [bound, rejected, kept]) equal((await f.put(card)).status, "inserted", "Fixture card insert");
      await f.write(async tx => {
        for (const change of [amendment, keptAmendment]) await f.cards.amend(tx, f.scope, kept.id, change);
      });
      equal(await f.visible([bound, rejected, kept]), [f.ref(bound), f.ref(kept)], "The reader rejects the forged ID");

      const remove = async (/** @type {Tx} */ tx) => {
        equal(await raw.deleteConversation(tx, f.scope, deletedSource), { rawDeleted: 2 }, "Delete Raw rows");
        equal((await f.cards.list(tx, f.scope)).map(({ id }) => id), [kept.id], "Read tombstones inside the delete transaction");
      };
      await rejects(() => f.write(async tx => {
        await remove(tx);
        throw new CoreError("storage_error");
      }), "storage_error");
      equal((await f.list()).length, 3, "Rollback restores the stored cards");
      equal((await f.get(kept.id))?.amendments, [amendment, keptAmendment], "Rollback restores amendment text");

      await f.write(remove);
      for (const card of [bound, rejected]) {
        equal(await f.get(card.id), null, "Tombstone is absent from get");
        equal((await f.put(card)).status, "tombstoned", "Tombstone rejects card replay");
      }
      equal((await f.get(kept.id))?.amendments, [keptAmendment], "The untouched binding stays live");
      equal((await f.write(tx => f.cards.amend(tx, f.scope, kept.id, amendment))).status, "unchanged",
        "Tombstone reserves the amendment ID");
      const stored = await f.storedText();
      for (const erased of [bound.title, rejected.title, amendment.sentence, amendment.quote]) {
        check(!stored.includes(erased), "Tombstoned text must be absent from storage");
      }
    },
  },
  {
    id: "T-CARD-PURGE-2", title: "Text forget erases definite card and amendment matches and retains no-key evidence",
    needs: ["documentCards", "rawArchive"],
    needsOff: ["fingerprintKey", "sessionLineage"],
    async run(ctx) {
      const f = fixture(ctx);
      const { service } = captureService(ctx, {});
      const text = "The brass caliper belongs in the top drawer.";
      const definite = await authoredCard(ctx, f.scope, "definite", text);
      const kept = await authoredCard(ctx, f.scope, "control", "Store the pencils in a different drawer.");
      const archived = message("exact-message", text);
      const erasedSource = await f.archive("exact-session", archived);
      const routed = await routedCard(ctx, f.scope, erasedSource.sessionId, archived);
      const amendment = { amendmentId: "exact-amendment", date: "2025-01-02", sourceMessage: erasedSource,
        sentence: "Caliper amendment sentence.", quote: "Caliper amendment quote." };
      const memory = await f.insert(text);
      for (const card of [definite, kept, routed]) equal((await f.put(card)).status, "inserted", "Fixture card insert");
      await f.write(tx => f.cards.amend(tx, f.scope, kept.id, amendment));
      equal((await service.forget(f.scope, memory.id, source)).status, "forgotten", "Forget exact text");
      equal(await f.visible([definite, routed, kept]), [f.ref(kept)], "Control remains visible");
      for (const card of [definite, routed]) {
        equal(await f.get(card.id), null, "Definite withhold is absent from the card store");
        equal((await f.put(card)).status, "tombstoned", "Definite withhold rejects replay");
      }
      equal((await f.get(kept.id))?.amendments, [], "The definitely withheld amendment disappears");
      equal((await f.write(tx => f.cards.amend(tx, f.scope, kept.id, amendment))).status, "unchanged",
        "Text forget reserves the amendment ID");
      const stored = await f.storedText();
      for (const erased of [text, amendment.sentence, amendment.quote]) {
        check(!stored.includes(erased), "Definitively withheld text must be absent from storage");
      }

      const unknown = fixture(ctx, ctx.scope("no-key"));
      const candidate = await authoredCard(ctx, unknown.scope, "indeterminate", "Stored text with an indeterminate verdict.");
      const uncertainMessage = message("uncertain-message", "Retain the text behind the unfounded session fence.");
      const uncertainSource = await unknown.archive("uncertain-session", uncertainMessage);
      const selected = await routedCard(ctx, unknown.scope, uncertainSource.sessionId, uncertainMessage);
      const unrelated = await unknown.insert("Forget this unrelated field note.",
        { ...source, client: uncertainSource.client, sessionId: uncertainSource.sessionId });
      equal((await unknown.put(candidate)).status, "inserted", "Insert before withholding");
      equal((await unknown.put(selected)).status, "inserted", "Insert a card matched by an existing hide");
      equal(await unknown.visible([candidate, selected]), [unknown.ref(candidate), unknown.ref(selected)],
        "Candidates begin visible");
      const key = await userFingerprintKey("conformance absent key", ctx.owner, coreFingerprintLabels);
      check(key, "Expected a fixture key unavailable to the adapter");
      const keyedText = "Unrelated keyed text.";
      await ctx.harness.seedFact(ctx.owner, { ...unknown.scope, kind: "text", mode: "full", origin: "forget",
        actionId: "keyed-withhold", text: { digests: [await coreDigest(keyedText, key), await coreDigest(keyedText)],
          keyId: key.id, shingles: await passageShingles(keyedText, key, coreFingerprintLabels) } });
      equal((await service.forget(unknown.scope, unrelated.id, source)).status, "forgotten", "Run a forget with no key");
      equal(await unknown.visible([candidate, selected]), [], "An unavailable signing key hides the candidates at read");
      const retained = await unknown.storedText();
      for (const card of [candidate, selected]) {
        check(retained.includes(card.body), "Indeterminate withholding must preserve stored text");
      }
    },
    followUp: {
      needs: ["documentCards"],
      needsOff: ["fingerprintKey", "rawArchive"],
      async run(ctx) {
        const f = fixture(ctx);
        const text = "The original change was recorded without Raw archive.";
        const item = message("captured-amendment", text);
        const capture = captureService(ctx, {});
        await capture.capture("amendment-source", "amendment-event", [item]);
        const kept = await authoredCard(ctx, f.scope, "ledger-control", "Keep these notes about the workbench.");
        const amendment = { amendmentId: "ledger-amendment", date: "2025-01-02",
          sourceMessage: { client: captureClient, sessionId: "amendment-source", messageId: item.id },
          sentence: "Retained capture amendment sentence.", quote: "Retained capture amendment quote." };
        const memory = await f.insert(text);
        equal((await f.put(kept)).status, "inserted", "Insert an independent card");
        equal((await f.write(tx => f.cards.amend(tx, f.scope, kept.id, amendment))).status, "inserted", "Insert amendment");
        equal((await capture.service.forget(f.scope, memory.id, source)).status, "forgotten", "Forget the admitted source text");
        equal((await f.get(kept.id))?.amendments, [], "Definite capture-message withholding erases the amendment");
        const stored = await f.storedText();
        check(!stored.includes(amendment.sentence) && !stored.includes(amendment.quote),
          "The amendment payload is absent without Raw archive");
      },
    },
  },
];
