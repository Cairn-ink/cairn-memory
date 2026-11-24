import { coreDigest } from "@cairn-ink/core";
import { buildDocumentCard } from "@cairn-ink/core/routing";
import { check, equal, row } from "./support.mjs";

/** @import { DocumentCardStore, ItemRef, Receipt, StoredDocumentCardRecord, TopicCardGuard, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @typedef {Parameters<DocumentCardStore<StoredDocumentCardRecord>["put"]>[2]} CardWrite */
/** @typedef {"text" | "identity" | "session" | "linked-session"} Exclusion */

const page = { cursor: null, limit: 10 };
const client = "fixture";
const title = "Filed notes";
const dependentText = "Keep the spare key in the top drawer.";
const sourceSession = (/** @type {string} */ label) => `${label}-memory`;

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

  /** @param {string} text @param {Receipt[]} [receipts] */
  async function memory(text, receipts = []) {
    const input = await row(ctx, text);
    const { value } = await coreDigest(text);
    const { id, revision } = await write((tx) => memories.insert(tx, scope, { ...input, textHash: `sha256:${value}` }, receipts, 1));
    return { id, revision };
  }

  /** @param {string} sessionId @param {string} content */
  async function archive(sessionId, content) {
    check(raw, "Raw archive is required for message-backed cards");
    const message = { id: "message", role: /** @type {const} */ ("user"), occurredAtMs: 1, content };
    const capture = { scope, client, sessionId, eventId: sessionId, payloadDigest: "a".repeat(64) };
    equal(await write((tx) => raw.archive(tx, capture, [message])), { archived: 1 }, "Expected a visible Raw source");
    return message;
  }

  /** @param {string} label @param {string} text */
  async function card(label, text) {
    const receipts = [];
    if (exclusion === "linked-session") {
      const sessionId = sourceSession(label);
      const { id: messageId, role, occurredAtMs } = await archive(sessionId, text);
      receipts.push({ client, sessionId, messageId, role, occurredAtMs });
    }
    const sourceMemories = [await memory(text, receipts)];
    const body = `Notes filed under ${label}.`;
    const cardTitle = `Document ${label}`;
    /** @type {CardWrite} */
    let record = { id: label, scope, origin: "import", title: cardTitle, body, contentHash: await ctx.hash(body),
      date: null, sourceMessage: null, sourceMemories, sentences: [], stale: [] };
    if (exclusion === "session" || exclusion === "linked-session") {
      const sessionId = `${label}-message`;
      const canonicalSessionKey = ctx.harness.hashSessionKey?.(client, sessionId) ??
        (ctx.sessionRefs === "plain" ? sessionId : undefined);
      check(canonicalSessionKey, "Expected the capture session key");
      const message = await archive(sessionId, `${cardTitle}\n\n${body}`);
      const { card: routed } = await buildDocumentCard(message, { scope, client, canonicalSessionKey });
      check(routed, "Expected a message-backed card");
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
  } else if (exclusion === "session") {
    check(raw && dependent.sourceMessage, "Expected a message-backed source to fence");
    const { client, sessionId } = dependent.sourceMessage;
    await write((tx) => raw.fenceSession(tx, scope, { client, sessionId }));
  } else {
    const sessionId = sourceSession("dependent");
    let session;
    if (ctx.sessionRefs === "hashed") {
      const sessionKeyHash = ctx.harness.hashSessionKey?.(client, sessionId);
      check(sessionKeyHash && /^[a-f0-9]{64}$/u.test(sessionKeyHash), "Expected the linked memory session hash");
      session = { client, sessionKeyHash };
    } else {
      session = { client, sessionId };
    }
    await ctx.harness.seedFact(ctx.owner, { ...fact, kind: "session", session });

    check(raw && dependent.sourceMessage, "Expected a message-backed card with a linked memory");
    /** @type {ItemRef[]} */
    const linkedRefs = cards.map(({ sourceMemories: [{ id }] }) => ({ type: "memory", id, namespace: scope.namespace }));
    equal(await read((tx) => fence.assertVisible(tx, selection, linkedRefs)), [linkedRefs[1]], "Only the linked control memory stays visible");
    const { items } = await read((tx) => raw.listRaw(tx, selection, page));
    const source = dependent.sourceMessage;
    check(items.some(({ client, sessionId, messageId }) =>
      client === source.client && sessionId === source.sessionId && messageId === source.messageId), "The card's own Raw message stays visible");
  }
  await assertDelivery([control], "after exclusion");
}

/** @param {Exclusion} exclusion @param {string} title @returns {ConformanceCase} */
const deliveryCase = (exclusion, title) => ({
  id: `T-DVIS-${exclusion}`, title,
  needs: exclusion === "session" || exclusion === "linked-session"
    ? ["documentCards", "placement", "rawArchive"] : ["documentCards", "placement"],
  async run(ctx) {
    if (exclusion === "session" && !ctx.adapter.raw?.fenceSession) return "needs Raw session fence";
    return checkDelivery(ctx, exclusion);
  },
});

export const DELIVERY_VISIBILITY_CASES = [
  deliveryCase("text", "a linked text fact excludes a card from the fence and topic views"),
  deliveryCase("identity", "a linked identity fact excludes a card from the fence and batch annotations"),
  deliveryCase("session", "a message session fence excludes its card from topic views"),
  deliveryCase("linked-session", "a linked memory session fact excludes a card from the fence and topic views"),
];
