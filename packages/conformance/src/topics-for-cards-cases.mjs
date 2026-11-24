import { compareUtf8 } from "@cairn-ink/core";
import { check, equal, rejects, row } from "./support.mjs";

/** @import { Scope, SourceLessDocumentCardRecord, TopicCardGuard, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const page = { cursor: null, limit: 100 };

/** @param {CaseContext} ctx @param {Scope} [scope] */
function setup(ctx, scope = ctx.scope(null)) {
  const { uow, documentCards, memories, placement } = ctx.adapter;
  check(documentCards && placement?.forCards, "Card placement and forCards are required");
  const forCards = placement.forCards.bind(placement);
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const read = (fn) => uow.run(scope.owner, { readOnly: true }, fn);
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const write = (fn) => uow.run(scope.owner, {}, fn);
  return {
    scope, read, write, documentCards, placement, forCards,
    /** @param {readonly string[]} ids @param {Scope} [selection] */
    lookup: (ids, selection = scope) => read((tx) => forCards(tx, selection, ids)),
    /** @param {string} id @param {SourceLessDocumentCardRecord["sourceMemories"]} [sourceMemories] */
    async card(id, sourceMemories = []) {
      const body = "Document " + id;
      /** @type {SourceLessDocumentCardRecord} */
      const card = { id, scope, origin: "import", title: id, body, contentHash: await ctx.hash(body),
        date: null, sourceMessage: null, sourceMemories, sentences: [], stale: [] };
      equal((await write((tx) => documentCards.put(tx, scope, card))).status, "inserted", "Expected a new card");
      return card;
    },
    /** @param {string} title */
    async memory(title) {
      const input = await row(ctx, title);
      const { id, revision } = await uow.run(scope.owner, { pauseLock: true },
        (tx) => memories.insert(tx, scope, input, [], 1));
      return { id, revision };
    },
    /** @param {{id: string, revision: number}} source @param {string} title */
    async topic({ id: memoryId, revision }, title) {
      const { createdTopics } = await write(async (tx) => {
        const { indexRevision } = await placement.catalog(tx, scope, page);
        return placement.applyPlacement(tx, scope, { indexRevision, memoryRevisions: [{ memoryId, revision }] },
          { items: [{ memoryId, parentIds: [], newL1: { title, parentL2Ids: [], newL2Title: title + " overview" } }] });
      });
      const child = createdTopics.find(({ level }) => level === "L1");
      check(child, "Expected an L1 topic");
      return { id: child.id, title: child.title };
    },
    /** @param {SourceLessDocumentCardRecord} card @param {string[]} parentIds @param {Scope} [selection] */
    place: (card, parentIds, selection = scope) => write(async (tx) => {
      const { indexRevision } = await placement.catalog(tx, scope, page);
      await placement.applyCardPlacement(tx, selection, { indexRevision, cards: [guard(card)] },
        { items: [{ cardId: card.id, parentIds }] });
    }),
    /** @param {string} id */
    async forget(id) {
      await ctx.harness.seedFact(scope.owner, { ...scope, kind: "identity", origin: "forget",
        actionId: "forget-" + id, memoryId: id });
    },
  };
}

/** @param {SourceLessDocumentCardRecord} card @returns {TopicCardGuard} */
const guard = ({ id, contentHash }) => ({ cardId: id, contentHash });

/** @param {number} number @param {string} title @param {ConformanceCase["run"]} run @returns {ConformanceCase} */
function batchCase(number, title, run) {
  return {
    id: `T-FOR-CARDS-${number}`, title, needs: ["placement", "documentCards"],
    async run(ctx) {
      if (!ctx.adapter.placement?.forCards) return "forCards is optional";
      return run(ctx);
    },
  };
}

export const TOPICS_FOR_CARDS_CASES = [
  batchCase(1, "mixed batches keep first occurrence and include visible empty outcomes", async (ctx) => {
    const store = setup(ctx);
    const source = await store.memory("Topic title source");
    const child = await store.topic(source, "Child");
    const filed = await store.card("a-filed");
    const unfiled = await store.card("z-unfiled");
    const pending = await store.card("pending");
    await store.place(filed, [child.id]);
    await store.place(unfiled, []);
    equal(await store.lookup([unfiled.id, "unknown", filed.id, pending.id, unfiled.id, filed.id]), [
      { cardId: unfiled.id, topics: [] }, { cardId: filed.id, topics: [child] },
    ], "A mixed batch must retain input order, deduplicate, and require a placement outcome");
    await store.forget(source.id);
    equal(await store.lookup([filed.id]), [{ cardId: filed.id, topics: [{ ...child, title: null }] }],
      "A title whose source was forgotten must be null while the independent card remains visible");
  }),

  batchCase(2, "hidden cards and tombstones leave no batch row", async (ctx) => {
    const store = setup(ctx);
    const card = await store.card("hidden");
    await store.place(card, []);
    equal(await store.lookup([card.id]), [{ cardId: card.id, topics: [] }], "The unfiled card must start visible");
    await store.write(async (tx) => {
      await store.documentCards.hide(tx, store.scope, card.id, "forget");
      equal(await store.forCards(tx, store.scope, [card.id]), [], "A hidden card must leave no row in the hiding transaction");
    });
    equal((await store.write((tx) => store.documentCards.put(tx, store.scope, card))).status, "tombstoned",
      "The hidden card must remain tombstoned on replay");
    equal(await store.lookup([card.id]), [], "A tombstone must leave no row");
  }),

  batchCase(3, "replacement needs a placement outcome at the new hash", async (ctx) => {
    const store = setup(ctx);
    const card = await store.card("replaced");
    await store.place(card, []);
    const body = "Replacement document";
    const next = { ...card, body, contentHash: await ctx.hash(body) };
    equal((await store.write((tx) => store.documentCards.put(tx, store.scope, next))).status, "replaced", "Expected replacement");
    equal(await store.lookup([card.id]), [], "The old placement hash must not annotate the replacement");
    await store.place(next, []);
    equal(await store.lookup([card.id]), [{ cardId: card.id, topics: [] }], "The new placement hash must annotate the replacement");
  }),

  batchCase(4, "forgetting a linked source memory removes the card row", async (ctx) => {
    const store = setup(ctx);
    const source = await store.memory("Linked source to forget");
    const card = await store.card("dependent", [source]);
    await store.place(card, []);
    equal(await store.lookup([card.id]), [{ cardId: card.id, topics: [] }], "The linked card must start visible");
    await store.forget(source.id);
    equal(await store.lookup([card.id]), [], "A forgotten source memory must remove its card from the batch");
  }),

  batchCase(5, "batch lookup is confined to one owner and namespace", async (ctx) => {
    const local = setup(ctx);
    const team = setup(ctx, ctx.scope("team"));
    const external = setup(ctx, { ...local.scope, owner: ctx.otherOwner });
    const [mine, theirs, shared] = await Promise.all([local.card("mine"), external.card("external"), team.card("team")]);
    await local.place(mine, []);
    await team.place(shared, []);
    await external.place(theirs, []);
    const ids = [theirs.id, shared.id, mine.id];
    equal(await local.lookup(ids), [{ cardId: mine.id, topics: [] }], "Foreign owners and namespaces must leave no row");
    equal(await team.lookup(ids), [{ cardId: shared.id, topics: [] }], "The named namespace must see only its own card");
    equal(await external.lookup(ids), [{ cardId: theirs.id, topics: [] }], "The other owner must see only its own card");
  }),

  batchCase(6, "batch limits include duplicate ids", async (ctx) => {
    const store = setup(ctx);
    const card = await store.card("limits");
    const { id } = card;
    const expected = [{ cardId: id, topics: [] }];
    await store.place(card, []);
    equal(await store.lookup([id]), expected, "The lower bound must be accepted");
    equal(await store.lookup(Array(100).fill(id)), expected, "The upper bound must be accepted");
    await rejects(() => store.lookup([]), "invalid_input");
    await rejects(() => store.lookup(Array(101).fill(id)), "invalid_input");
  }),

  batchCase(7, "lying iterators are rejected without being invoked", async (ctx) => {
    const store = setup(ctx);
    const card = await store.card("iterator");
    await store.place(card, []);
    let calls = 0;
    const ids = Object.defineProperty([card.id], Symbol.iterator, {
      value: function* () { calls++; yield "different-id"; },
    });
    await rejects(() => store.lookup(ids), "invalid_input");
    equal(calls, 0, "The caller iterator must never run");
  }),

  batchCase(8, "card methods hold one scope when a getter flips namespaces", async (ctx) => {
    const local = setup(ctx);
    const team = setup(ctx, ctx.scope("team"));
    const localTopic = await local.topic(await local.memory("Local title source"), "Local");
    const teamTopic = await team.topic(await team.memory("Team title source"), "Team");
    const localCard = await local.card("same-id");
    const teamCard = await team.card("same-id");
    const pending = await local.card("pending");
    await team.place(teamCard, [teamTopic.id]);
    /** @template T @param {(scope: Scope) => Promise<T>} call */
    async function once(call) {
      let namespaceReads = 0;
      let ownerReads = 0;
      const result = await call({
        get owner() { ownerReads++; return ctx.owner; },
        get namespace() { return namespaceReads++ === 0 ? null : "team"; },
      });
      equal([ownerReads, namespaceReads], [1, 1], "The caller's owner and namespace must each be read once");
      return result;
    }
    const { placement } = local;
    equal((await once((scope) => local.read((tx) => placement.pendingCards(tx, scope, { limit: 5 }))))
      .map(({ cardId }) => cardId).sort(compareUtf8), [pending.id, localCard.id],
      "The local pending query must not select from the team namespace");
    await once((scope) => local.place(localCard, [localTopic.id], scope));
    equal(await once((scope) => local.lookup([localCard.id], scope)), [{ cardId: localCard.id, topics: [localTopic] }],
      "The batch must use the same scope for membership, card visibility and title visibility");
    equal(await once((scope) => local.read((tx) => placement.forCard(tx, scope, localCard.id))), [localTopic.id],
      "The single lookup must use the local membership");
    await once((scope) => local.write((tx) => placement.markCardsFailed(tx, scope, [pending.id], "source_excluded")));
    equal(await local.read((tx) => placement.pendingCards(tx, local.scope, { limit: 5 })), [],
      "The failure receipt must be written in the local namespace");
    equal(await once((scope) => local.write((tx) => placement.dropCard(tx, scope, localCard.id))), { dropped: 1 },
      "Dropping with the flipping scope must affect the local membership");
    equal(await local.lookup([localCard.id]), [{ cardId: localCard.id, topics: [] }], "The local outcome must now be empty");
    equal(await team.lookup([teamCard.id]), [{ cardId: teamCard.id, topics: [teamTopic] }],
      "The team outcome must be preserved");
  }),

  batchCase(9, "L1 annotations match forCard topic IDs and order", async (ctx) => {
    const store = setup(ctx);
    const first = await store.topic(await store.memory("First topic source"), "First");
    const second = await store.topic(await store.memory("Second topic source"), "Second");
    const card = await store.card("multiple");
    const expected = [first, second].sort((a, b) => compareUtf8(a.id, b.id));
    await store.place(card, expected.map(({ id }) => id).reverse());
    await store.read(async (tx) => {
      const [annotation] = await store.forCards(tx, store.scope, [card.id]);
      equal(annotation?.topics.map(({ id }) => id), await store.placement.forCard(tx, store.scope, card.id),
        "Batch topic IDs must equal forCard in the same order");
      equal(annotation, { cardId: card.id, topics: expected }, "The batch must annotate only the sorted L1 memberships");
    });
  }),
];
