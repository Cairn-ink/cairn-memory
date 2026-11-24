import { coreDigest } from "@cairn-ink/core";
import { buildDocumentCard } from "@cairn-ink/core/routing";
import { check, equal, row } from "./support.mjs";

/** @import { DocumentCardStore, ItemRef, StoredDocumentCardRecord, TopicCardGuard, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @typedef {Parameters<DocumentCardStore<StoredDocumentCardRecord>["put"]>[2]} CardWrite */
/** @typedef {"text" | "identity" | "session"} Exclusion */

const page = { cursor: null, limit: 10 };
const client = "fixture";
const title = "Filed notes";
const dependentText = "Keep the spare key in the top drawer.";

/** @param {CardWrite} card @returns {TopicCardGuard} */
const guard = ({ id, contentHash }) => ({ cardId: id, contentHash });

/** @param {CaseContext} ctx @param {Exclusion} exclusion */
async function checkDelivery(ctx, exclusion) {
  const { uow, memories, fence, placement, documentCards, raw } = ctx.adapter;
  if (!fence?.assertVisible) return "needs visibility fence";
  if (!documentCards) return "needs document card store";
  if (!placement) return "needs topic placement store";
  if (!placement.forCards) return "needs topic forCards";
  const put = documentCards.put.bind(documentCards);
  const forCards = placement.forCards.bind(placement);
  const scope = ctx.scope(null);
  const selection = { owner: ctx.owner, namespaces: [scope.namespace] };
  const digest = await coreDigest(dependentText);
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const read = (fn) => uow.run(ctx.owner, { readOnly: true }, fn);
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const write = (fn) => uow.run(ctx.owner, { pauseLock: true }, fn);

  /** @param {string} text */
  async function memory(text) {
    const input = await row(ctx, text);
    const { value } = await coreDigest(text);
    const { id, revision } = await write((tx) => memories.insert(tx, scope, { ...input, textHash: `sha256:${value}` }, [], 1));
    return { id, revision };
  }

  /** @param {string} label @param {string} text */
  async function card(label, text) {
    const sourceMemories = [await memory(text)];
    const body = `Notes filed under ${label}.`;
    const cardTitle = `Document ${label}`;
    /** @type {CardWrite} */
    let record = { id: label, scope, origin: "import", title: cardTitle, body, contentHash: await ctx.hash(body),
      date: null, sourceMessage: null, sourceMemories, sentences: [], stale: [] };
    if (exclusion === "session") {
      check(raw, "Raw archive is required for message-backed cards");
      const sessionId = label;
      const canonicalSessionKey = ctx.harness.hashSessionKey?.(client, sessionId) ??
        (ctx.sessionRefs === "plain" ? sessionId : undefined);
      check(canonicalSessionKey, "Expected the capture session key");
      const message = { id: "message", role: /** @type {const} */ ("user"), occurredAtMs: 1, content: `${cardTitle}\n\n${body}` };
      const { card: routed } = await buildDocumentCard(message, { scope, client, canonicalSessionKey });
      check(routed, "Expected a message-backed card");
      const capture = { scope, client, sessionId, eventId: label, payloadDigest: "a".repeat(64) };
      equal(await write((tx) => raw.archive(tx, capture, [message])), { archived: 1 }, "Expected a visible Raw source");
      record = { ...record, id: routed.id, origin: "router", title: routed.title, body: routed.body,
        contentHash: await ctx.hash(routed.body), date: routed.date, sourceMessage: { client, sessionId, messageId: message.id } };
    }
    equal((await write((tx) => put(tx, scope, record))).status, "inserted", "Expected a new card");
    return record;
  }

  const heading = await memory("Independent topic heading");
  const dependent = await card("dependent", dependentText);
  const control = await card("control", "Use the large cabinet for paper.");
  const { createdTopics } = await write(async (tx) => {
    const { indexRevision } = await placement.catalog(tx, scope, page);
    return placement.applyPlacement(tx, scope, {
      indexRevision, memoryRevisions: [{ memoryId: heading.id, revision: heading.revision }],
    }, { items: [{ memoryId: heading.id, parentIds: [], newL1: { title, parentL2Ids: [], newL2Title: "Overview" } }] });
  });
  const child = createdTopics.find(({ level }) => level === "L1");
  const parent = createdTopics.find(({ level }) => level === "L2");
  check(child && parent, "Expected both topic levels");
  const cards = [dependent, control];
  await write(async (tx) => {
    const { indexRevision } = await placement.catalog(tx, scope, page);
    await placement.applyCardPlacement(tx, scope, { indexRevision, cards: cards.map(guard) },
      { items: cards.map(({ id: cardId }) => ({ cardId, parentIds: [child.id] })) });
  });

  /** @param {CardWrite} card @returns {ItemRef} */
  const ref = ({ id }) => ({ type: "card", id, namespace: scope.namespace });
  const refs = cards.map(ref);
  const cardIds = cards.map(({ id }) => id);
  const annotation = (/** @type {string} */ cardId) => ({ cardId, topics: [{ id: child.id, title }] });

  /** @param {CardWrite[]} expected @param {string} phase */
  const assertDelivery = (expected, phase) => read(async (tx) => {
    // The session fence on card refs is already covered by T-CARD-LINK-7.
    if (exclusion !== "session") {
      equal(await fence.assertVisible(tx, selection, refs), expected.map(ref), `Card fence visibility ${phase}`);
    }
    const expectedIds = expected.map(({ id }) => id);
    equal(await forCards(tx, scope, cardIds), expectedIds.map(annotation), `Batch card annotations ${phase}`);
    // Identity facts on individual annotations, members and counts are covered by T-TCARD-7.
    if (exclusion === "identity") return;
    for (const id of cardIds) {
      equal(await placement.forCard(tx, scope, id), expectedIds.includes(id) ? [child.id] : [], `Card annotation ${phase}`);
    }
    const { items: topics } = await placement.list(tx, scope, page);
    for (const topic of [child, parent]) {
      const { items } = await placement.members(tx, scope, topic.id, page);
      equal(items.filter(({ kind }) => kind === "card").map(({ id }) => id).sort(),
        [...expectedIds].sort(), `${topic.level} card members ${phase}`);
      equal(topics.find(({ id }) => id === topic.id)?.cardCount, expectedIds.length, `${topic.level} card count ${phase}`);
    }
  });

  await assertDelivery(cards, "before exclusion");
  const fact = { ...scope, origin: /** @type {const} */ ("forget"), actionId: "exclude-source" };
  if (exclusion === "text") {
    await ctx.harness.seedFact(ctx.owner, { ...fact, kind: "text", mode: "exact", text: { digests: [digest] } });
  } else if (exclusion === "identity") {
    await ctx.harness.seedFact(ctx.owner, { ...fact, kind: "identity", memoryId: dependent.sourceMemories[0].id });
  } else {
    check(raw && dependent.sourceMessage, "Expected a message-backed source to fence");
    const { client, sessionId } = dependent.sourceMessage;
    await write((tx) => raw.fenceSession(tx, scope, { client, sessionId }));
  }
  await assertDelivery([control], "after exclusion");
}

/** @param {Exclusion} exclusion @param {string} title @returns {ConformanceCase} */
const deliveryCase = (exclusion, title) => ({
  id: `T-DVIS-${exclusion}`, title,
  needs: exclusion === "session" ? ["documentCards", "placement", "rawArchive"] : ["documentCards", "placement"],
  async run(ctx) {
    if (exclusion === "session" && !ctx.adapter.raw?.fenceSession) return "needs Raw session fence";
    return checkDelivery(ctx, exclusion);
  },
});

export const DELIVERY_VISIBILITY_CASES = [
  deliveryCase("text", "a linked text fact excludes a card from the fence and topic views"),
  deliveryCase("identity", "a linked identity fact excludes a card from the fence and batch annotations"),
  deliveryCase("session", "a message session fence excludes its card from topic views"),
];
