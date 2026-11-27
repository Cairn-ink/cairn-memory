import { compareUtf8, placePendingCardsBatch } from "@cairn-ink/core";
import { check, equal, readDump, rejects, row } from "./support.mjs";

/** @import { Scope, SourceLessDocumentCardRecord, TopicCardGuard, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const page = { cursor: null, limit: 100 };

/** @param {CaseContext} ctx @param {Scope} [scope] */
function setup(ctx, scope = ctx.scope(null)) {
  const { uow, memories, placement, documentCards } = ctx.adapter;
  check(placement && documentCards, "Card placement ports are required");
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const read = (fn) => uow.run(scope.owner, { readOnly: true }, fn);
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const write = (fn) => uow.run(scope.owner, {}, fn);
  return {
    scope, placement, documentCards, read, write,
    /** @param {string} title */
    async memory(title) {
      const input = await row(ctx, title);
      const { id, revision } = await uow.run(scope.owner, { pauseLock: true },
        (tx) => memories.insert(tx, scope, input, [], 1));
      return { id, revision };
    },
    /** @param {{id: string, revision: number}} source @param {string} title @param {string[]} [parentL2Ids] */
    async topics(source, title, parentL2Ids = []) {
      const { createdTopics } = await write(async (tx) => {
        const { indexRevision } = await placement.catalog(tx, scope, page);
        const memoryId = source.id;
        return placement.applyPlacement(tx, scope, {
          indexRevision, memoryRevisions: [{ memoryId, revision: source.revision }],
        }, { items: [{ memoryId, parentIds: [], newL1: {
          title, parentL2Ids, ...(parentL2Ids.length ? {} : { newL2Title: title + " overview" }),
        } }] });
      });
      const child = createdTopics.find(({ level }) => level === "L1");
      check(child, "Expected a child topic");
      const parent = createdTopics.find(({ level }) => level === "L2")?.id ?? parentL2Ids[0];
      return { child: child.id, parent };
    },
    /** @param {string} id @param {SourceLessDocumentCardRecord["sourceMemories"]} [sourceMemories] */
    async card(id, sourceMemories = []) {
      const body = "Document " + id;
      /** @type {SourceLessDocumentCardRecord} */
      const record = { id, scope, origin: "import", title: id, body, contentHash: await ctx.hash(body),
        date: null, sourceMessage: null, sourceMemories, sentences: [], stale: [] };
      equal((await write((tx) => documentCards.put(tx, scope, record))).status, "inserted", "Expected a new card");
      return record;
    },
    /** @param {SourceLessDocumentCardRecord} record */
    async replace(record) {
      const body = record.body + " revised";
      const next = { ...record, body, contentHash: await ctx.hash(body) };
      equal((await write((tx) => documentCards.put(tx, scope, next))).status, "replaced", "Expected replaced card");
      return next;
    },
    catalog: () => read((tx) => placement.catalog(tx, scope, page)),
    list: () => read((tx) => placement.list(tx, scope, page)),
    /** @param {string} id */
    members: (id) => read((tx) => placement.members(tx, scope, id, page)),
    /** @param {string} id */
    forCard: (id) => read((tx) => placement.forCard(tx, scope, id)),
    pending: (limit = 5) => read((tx) => placement.pendingCards(tx, scope, { limit })),
    /** @param {Array<{card: SourceLessDocumentCardRecord, parentIds: string[]}>} batch @param {number} [revision] */
    apply: (batch, revision) => write(async (tx) => {
      const indexRevision = revision ?? (await placement.catalog(tx, scope, page)).indexRevision;
      return placement.applyCardPlacement(tx, scope, { indexRevision, cards: batch.map(({ card }) => guard(card)) },
        { items: batch.map(({ card, parentIds }) => ({ cardId: card.id, parentIds })) });
    }),
  };
}

/** @param {SourceLessDocumentCardRecord} card @returns {TopicCardGuard} */
const guard = ({ id, contentHash }) => ({ cardId: id, contentHash });

/** @param {CaseContext} ctx @param {() => Promise<unknown>} attempt */
async function conflicts(ctx, attempt) {
  const before = await readDump(ctx.harness);
  await rejects(attempt, "revision_conflict");
  equal(await readDump(ctx.harness), before, "A rejected placement must leave the store unchanged");
}

/** @param {number} number @param {string} title @param {ConformanceCase["run"]} run @returns {ConformanceCase} */
const topicCardCase = (number, title, run) => ({ id: `T-TCARD-${number}`, title, needs: ["placement", "documentCards"], run });

export const TOPIC_CARD_CASES = [
  topicCardCase(1, "cards mix with memories and count once across L1 children", async (ctx) => {
    const store = setup(ctx);
    const source = await store.memory("Seed memory for topics");
    const { child, parent } = await store.topics(source, "Child");
    const { child: sibling } = await store.topics(source, "Sibling", [parent]);
    const card = await store.card("imported");
    await store.apply([{ card, parentIds: [child, sibling] }]);
    equal(await store.forCard(card.id), [child, sibling].sort(compareUtf8), "forCard must return both L1 ids");
    for (const id of [child, parent]) {
      const { items } = await store.members(id);
      equal(items.filter(({ kind }) => kind === "card").map(({ id }) => id), [card.id], "Expected one card member");
      const topic = (await store.list()).items.find((item) => item.id === id);
      check(topic, "Topic must be listed");
      equal([topic.memberCount, topic.newestMemberIds, topic.cardCount], id === child ? [0, [], 1] : [1, [source.id], 1],
        "Card membership must keep card-only topics listed and memory counts separate");
    }
    equal((await store.members(parent)).items.map(({ kind, id }) => [kind, id]).sort(), [
      ["card", card.id], ["memory", source.id],
    ], "L2 members must contain a memory and a distinct card");
  }),
  topicCardCase(2, "hide and hideWhere drop memberships in the same transaction", async (ctx) => {
    const store = setup(ctx);
    const source = await store.memory("Source for hide selector");
    const { child } = await store.topics(source, "Child");
    const direct = await store.card("direct");
    const linked = await store.card("linked", [source]);
    await store.apply([{ card: direct, parentIds: [child] }, { card: linked, parentIds: [child] }]);
    await store.write(async (tx) => {
      const { placement, scope, documentCards } = store;
      await documentCards.hide(tx, scope, direct.id, "forget");
      equal(await placement.forCard(tx, scope, direct.id), [], "Direct hide must be immediately visible");
      equal(await placement.dropCard(tx, scope, direct.id), { dropped: 0 }, "Direct hide must have dropped the membership");
      equal(await documentCards.hideWhere(tx, scope, { sourceMemoryId: source.id }, "forget"), { hidden: 1 },
        "Source selector must hide the linked card");
      equal(await placement.forCard(tx, scope, linked.id), [], "Bulk hide must be immediately visible");
      equal(await placement.dropCard(tx, scope, linked.id), { dropped: 0 }, "Bulk hide must have dropped the membership");
    });
  }),
  topicCardCase(3, "a changed L1 catalog rejects a stale placement snapshot", async (ctx) => {
    const store = setup(ctx);
    const source = await store.memory("Catalog revision source");
    const { child } = await store.topics(source, "Child");
    const card = await store.card("card");
    const { indexRevision } = await store.catalog();
    await ctx.harness.seedFact(ctx.owner, { ...store.scope, kind: "identity", origin: "forget",
      actionId: "forget-topic-source", memoryId: source.id });
    equal((await store.catalog()).items.find(({ id }) => id === child)?.title, null, "The existing L1 title changed");
    await conflicts(ctx, () => store.apply([{ card, parentIds: [child] }], indexRevision));
  }),
  topicCardCase(4, "L2 and unknown parents both reject the whole batch", async (ctx) => {
    const store = setup(ctx);
    const { child, parent } = await store.topics(await store.memory("Parent level source"), "Child");
    const card = await store.card("card");
    const second = await store.card("second");
    for (const badParent of [parent, "absent-topic"]) {
      await conflicts(ctx, () => store.apply([{ card, parentIds: [child] }, { card: second, parentIds: [badParent] }]));
    }
  }),
  topicCardCase(5, "another namespace and another owner each have a separate card queue", async (ctx) => {
    const store = setup(ctx);
    const team = setup(ctx, ctx.scope("team"));
    const external = setup(ctx, { ...store.scope, owner: ctx.otherOwner });
    const { child } = await store.topics(await store.memory("Personal parent source"), "Child");
    const personal = await store.card("personal");
    for (const foreign of [await team.card("team"), await external.card("external")]) {
      equal(await store.pending(), [guard(personal)], "Pending cards must belong to this owner and namespace");
      await conflicts(ctx, () => store.apply([{ card: foreign, parentIds: [child] }]));
    }
  }),
  topicCardCase(6, "replacement hides old memberships and queues the new hash", async (ctx) => {
    const store = setup(ctx);
    const { child } = await store.topics(await store.memory("Replacement parent source"), "Child");
    const card = await store.card("card");
    await store.apply([{ card, parentIds: [child] }]);
    const replaced = await store.replace(card);
    equal(await store.forCard(card.id), [], "Only current content may have visible memberships");
    equal((await store.list()).items.find(({ id }) => id === child)?.cardCount, 0, "Old hash must stop contributing to counts");
    equal(await store.pending(), [guard(replaced)], "Replacement must be pending at its new hash");
    await conflicts(ctx, () => store.apply([{ card, parentIds: [child] }]));
    await store.apply([{ card: replaced, parentIds: [child] }]);
    equal(await store.forCard(card.id), [child], "The new hash can be placed");
  }),
  topicCardCase(7, "forgetting a source excludes its card from every membership view", async (ctx) => {
    const store = setup(ctx);
    const source = await store.memory("Card source to forget");
    const { child, parent } = await store.topics(await store.memory("Independent topic source"), "Child");
    const dependent = await store.card("dependent", [source]);
    const independent = await store.card("independent");
    await store.apply([{ card: dependent, parentIds: [child] }, { card: independent, parentIds: [child] }]);
    await ctx.harness.seedFact(ctx.owner, { ...store.scope, kind: "identity", origin: "forget",
      actionId: "forget-card-source", memoryId: source.id });
    equal(await store.forCard(dependent.id), [], "A forgotten source must hide its card from forCard");
    for (const topic of [child, parent]) {
      equal((await store.list()).items.find(({ id }) => id === topic)?.cardCount, 1, "Only the independent card may count");
      equal((await store.members(topic)).items.filter(({ kind }) => kind === "card").map(({ id }) => id),
        [independent.id], "A forgotten source must hide its card from membership pages");
    }
    await conflicts(ctx, () => store.apply([{ card: dependent, parentIds: [child] }]));
  }),
  topicCardCase(8, "a source-less import is visible until tombstoned and cannot be replayed", async (ctx) => {
    const store = setup(ctx);
    const { child } = await store.topics(await store.memory("Import parent source"), "Child");
    const card = await store.card("import");
    const refs = [{ type: /** @type {const} */ ("card"), id: card.id, namespace: store.scope.namespace }];
    const selection = { owner: ctx.owner, namespaces: [store.scope.namespace] };
    equal(await store.read((tx) => ctx.adapter.fence.assertVisible(tx, selection, refs)), refs, "A source-less import is visible");
    await store.apply([{ card, parentIds: [child] }]);
    await store.write(async (tx) => {
      await store.documentCards.hide(tx, store.scope, card.id, "forget");
      equal(await store.placement.dropCard(tx, store.scope, card.id), { dropped: 0 }, "Tombstone must drop membership");
      equal((await store.documentCards.put(tx, store.scope, card)).status, "tombstoned", "Replay must stay tombstoned");
    });
    equal(await store.forCard(card.id), [], "Tombstone must stay invisible");
    equal(await store.pending(), [], "Tombstone must stay out of the queue");
    equal(await store.read((tx) => ctx.adapter.fence.assertVisible(tx, selection, refs)), [], "Tombstone must fail the fence");
  }),
  topicCardCase(9, "filed batches advance once, idempotent and unfiled outcomes do not", async (ctx) => {
    const store = setup(ctx);
    const { child } = await store.topics(await store.memory("Idempotence parent source"), "Child");
    const card = await store.card("card");
    const other = await store.card("other");
    const unfiled = await store.card("unfiled");
    const { indexRevision } = await store.catalog();
    const filing = [{ card, parentIds: [child] }, { card: other, parentIds: [child] }];
    const placed = await store.apply(filing);
    equal((await store.catalog()).indexRevision, indexRevision + 1, "Two filed cards advance the index once");
    const committed = await readDump(ctx.harness);
    equal(await store.apply(filing), placed, "The same filing must return the same placement");
    equal(await readDump(ctx.harness), committed, "The same filing must leave state unchanged");
    await store.apply([{ card: unfiled, parentIds: [] }]);
    equal((await store.catalog()).indexRevision, indexRevision + 1, "Unfiled alone cannot advance the index");
    equal(await store.pending(), [], "An unfiled outcome still leaves the queue");
  }),
  topicCardCase(10, "failure receipts enforce cooldown, attempt limits, and the content hash", async (ctx) => {
    const store = setup(ctx);
    const card = await store.card("retry");
    const excluded = await store.card("excluded");
    const mark = (/** @type {string} */ id, /** @type {import("@cairn-ink/core").ErrorCode} */ code) =>
      store.write((tx) => store.placement.markCardsFailed(tx, store.scope, [id], code));
    await mark(excluded.id, "source_excluded");
    await mark(card.id, "provider_error");
    equal(await store.pending(), [], "Retryable and terminal errors both leave the immediate queue");
    if (!ctx.harness.advanceClock) return "needs a controllable clock to verify retries";
    for (let attempt = 1; attempt < 3; attempt++) {
      await ctx.harness.advanceClock(3_600_000);
      equal(await store.pending(), [guard(card)], "A retry becomes eligible after the cooldown");
      await mark(card.id, "provider_error");
    }
    await ctx.harness.advanceClock(3_600_000);
    equal(await store.pending(), [], "Exhausted retries and excluded cards stay out of the queue");
    const replacement = await store.replace(card);
    equal(await store.pending(), [guard(replacement)], "Failure receipts cannot block a different hash");
  }),
  topicCardCase(11, "a card edit leaves the replacement and its batchmate pending", async (ctx) => {
    const store = setup(ctx);
    const source = await store.memory("Seed for card classification");
    const { child } = await store.topics(source, "Card filing");
    const original = await store.card("a-edited-card");
    const unchanged = await store.card("b-unchanged-card");
    const { uow, fence } = ctx.adapter;
    const { scope, placement, documentCards } = store;
    const options = { uow, fence, scope, placement, documentCards };
    const stale = await placePendingCardsBatch({
      ...options,
      async classify({ cards }, _catalog, { validateFresh }) {
        equal(cards.map(({ cardId, contentHash }) => ({ cardId, contentHash })), [guard(original), guard(unchanged)],
          "Expected both original card guards");
        await store.replace(original);
        await validateFresh();
        throw new Error("A stale card batch reached dispatch");
      },
    });
    equal(stale, { status: "failed", error: { code: "revision_conflict", retryable: false } }, "Expected a stale card batch");
    const replacementHash = await ctx.hash(original.body + " revised");
    const expected = [{ cardId: original.id, contentHash: replacementHash }, guard(unchanged)];
    equal(await store.pending(), expected, "The replacement and its unchanged batchmate must both remain pending");

    const next = await placePendingCardsBatch({
      ...options,
      async classify({ cards }, _catalog, { validateFresh }) {
        equal(cards.map(({ cardId, contentHash }) => ({ cardId, contentHash })), expected,
          "The next batch must read both current card hashes");
        await validateFresh();
        return { items: cards.map(({ cardId }) => ({ cardId, parentIds: [child] })) };
      },
    });
    equal(next, { status: "applied", placed: expected.map(({ cardId }) => ({ cardId, topicIds: [child] })) },
      "The next batch must file both cards");
    equal(await store.pending(), [], "Current filings must consume both card hashes");
  }),
];
