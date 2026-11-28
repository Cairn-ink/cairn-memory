import { coreDigest, encodeCursor } from "@cairn-ink/core";
import { check, equal, rejects, row } from "./support.mjs";

/** @import { PlacementItem } from "@cairn-ink/core" */
/** @import { Scope, SourceLessDocumentCardRecord, Topic, TopicPage, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @typedef {{memoryId: string, revision: number}} Guard */

const firstPage = { cursor: null, limit: 50 };
const hosted = /** @type {const} */ ({ ...firstPage, projection: "hosted" });

/** @param {CaseContext} ctx @param {Scope} [scope] */
function setup(ctx, scope = ctx.scope(null)) {
  const { adapter: { uow, placement, memories, documentCards }, harness } = ctx;
  check(placement && harness.withHostedTopicIds && harness.advanceClock, "Hosted topic fixture controls are required");
  const { withHostedTopicIds, advanceClock } = harness;
  /** @template T @param {(tx: Tx) => Promise<T>} work */
  const read = work => uow.run(scope.owner, { readOnly: true }, work);
  /** @template T @param {(tx: Tx) => Promise<T>} work */
  const write = work => uow.run(scope.owner, {}, work);
  return {
    read, advanceClock,
    /** @param {string} id @param {string} [text] @returns {Promise<Guard>} */
    async memory(id, text = id) {
      const input = await row(ctx, text);
      const { id: memoryId, revision } = await withHostedTopicIds([id], () =>
        uow.run(scope.owner, { pauseLock: true }, tx => memories.insert(tx, scope, input, [], 1)));
      return { memoryId, revision };
    },
    /** @param {Guard[]} guards @param {PlacementItem[]} items @param {string[]} [ids] */
    place: (guards, items, ids = []) => withHostedTopicIds(ids, () => write(async tx => {
      const { indexRevision } = await placement.catalog(tx, scope, firstPage);
      return placement.applyPlacement(tx, scope, { indexRevision, memoryRevisions: guards }, { items });
    })),
    /** @param {Guard} guard @param {string} text */
    async correct({ memoryId, revision }, text) {
      const input = await row(ctx, text);
      return uow.run(scope.owner, { pauseLock: true }, tx =>
        memories.replaceContent(tx, scope, memoryId, revision, input, null, 2));
    },
    /** @param {string} id @param {string[]} parentIds */
    async card(id, parentIds) {
      check(documentCards, "Card fixture requires documentCards");
      /** @type {SourceLessDocumentCardRecord} */
      const card = { id, scope, origin: "import", title: id, body: id, contentHash: await ctx.hash(id),
        date: null, sourceMessage: null, sourceMemories: [], sentences: [], stale: [] };
      await write(tx => documentCards.put(tx, scope, card));
      await write(async tx => {
        const { indexRevision } = await placement.catalog(tx, scope, firstPage);
        await placement.applyCardPlacement(tx, scope, { indexRevision, cards: [{ cardId: id, contentHash: card.contentHash }] },
          { items: [{ cardId: id, parentIds }] });
      });
    },
    /** @param {Partial<TopicPage> & {level?: Topic["level"]}} [page] */
    list: (page) => read(tx => placement.list(tx, scope, { ...hosted, ...page })),
    /** @param {string} topicId @param {Partial<TopicPage>} [page] */
    members: (topicId, page) => read(tx => placement.members(tx, scope, topicId, { ...hosted, ...page })),
    listDefault: () => read(tx => placement.list(tx, scope, { ...firstPage, limit: 1 })),
    /** @param {string} id */
    membersDefault: (id) => read(tx => placement.members(tx, scope, id, firstPage)),
  };
}

/** @param {Guard} guard @param {string[]} [parentIds] @param {PlacementItem["newL1"]} [newL1] @returns {PlacementItem} */
function item({ memoryId }, parentIds = [], newL1) {
  return { memoryId, parentIds, ...(newL1 && { newL1 }) };
}

/** @param {number} number @param {string} title @param {ConformanceCase["run"]} run @param {ConformanceCase["needs"]} [needs] */
function hostedCase(number, title, run, needs = ["placement"]) {
  return { id: `T-TOP-HL-${number}`, title, needs, run };
}

export const HOSTED_TOPIC_CASES = [
  // Cloud tests/w4/topics-api.test.ts and tests/topics-store.test.ts: count order, preview IDs,
  // one-row pages, the L2 header, rejected cursor scopes, and restart after a write.
  hostedCase(1, "matches hosted list and member pages and binds cursors to the owner, view and revision", async ctx => {
    const store = setup(ctx);
    const other = setup(ctx, { owner: ctx.otherOwner, namespace: null });
    const older = await store.memory("old", "Synthetic older");
    const flora = await store.memory("flora-seed", "Synthetic second topic");
    const newer = await store.memory("new", "🪨".repeat(125) + " synthetic");
    const foreign = await other.memory("foreign-seed");
    await store.place([older, flora], [
      item(older, [], { title: "Stones", parentL2Ids: [], newL2Title: "Geology" }),
      item(flora, [], { title: "Flora", parentL2Ids: [] }),
    ], ["geology", "stones", "flora"]);
    await other.place([foreign], [item(foreign, [], { title: "Private", parentL2Ids: [] })], ["private"]);
    await store.advanceClock(10);
    await store.place([newer], [item(newer, ["stones"])]);

    const list = await store.list({ level: "L1", limit: 1 });
    equal(list.items, [{ id: "stones", level: "L1", title: "Stones", parentIds: ["geology"],
      memberCount: 2, newestMemberIds: ["new", "old"] }], "Count order and preview must match the hosted fixture");
    check(list.nextCursor, "The second L1 topic must produce lookahead");
    equal(await store.list({ level: "L1", limit: 1, cursor: list.nextCursor }), {
      items: [{ id: "flora", level: "L1", title: "Flora", parentIds: [], memberCount: 1, newestMemberIds: ["flora-seed"] }],
      nextCursor: null,
    }, "The second L1 topic must exhaust the page");
    equal(await store.list({ level: "L2" }), {
      items: [{ id: "geology", level: "L2", title: "Geology", parentIds: [],
        memberCount: 2, newestMemberIds: ["new", "old"] }], nextCursor: null,
    }, "The L2 list must roll up Stones");

    const topic = { id: "stones", level: "L1", title: "Stones" };
    const members = await store.members("stones", { limit: 1 });
    equal(members.topic, topic, "The first member page must include the header");
    equal(members.items, [{ kind: "memory", id: "new", placedAtUs: 11000n }], "The newest memory must come first");
    check(members.nextCursor, "The older member must produce lookahead");
    equal(await store.members("stones", { limit: 1, cursor: members.nextCursor }), {
      topic, items: [{ kind: "memory", id: "old", placedAtUs: 1000n }], nextCursor: null,
    }, "The older row must appear exactly once and exhaust the page");
    equal((await store.members("geology")).topic, { id: "geology", level: "L2", title: "Geology" },
      "The L2 topic must have its own header");

    const wrongView = async () => rejects(() => store.list({ level: "L2", cursor: list.nextCursor }), "invalid_cursor");
    await wrongView();
    await rejects(() => store.list({ cursor: list.nextCursor }), "invalid_cursor");
    await rejects(() => other.list({ level: "L1", cursor: list.nextCursor }), "invalid_cursor");
    await rejects(() => store.members("flora", { cursor: members.nextCursor }), "invalid_cursor");
    await rejects(() => store.members("stones", { cursor: list.nextCursor }), "invalid_cursor");
    await rejects(() => store.list({ level: "L1", cursor: "bad cursor" }), "invalid_cursor");
    await rejects(() => store.list({ level: "L1", cursor: encodeCursor([ctx.owner, "list:L1", 0, 2, "stones"]) }),
      "invalid_cursor");
    await rejects(() => store.members("stones", { cursor: "bad cursor" }), "invalid_cursor");
    const defaultList = await store.listDefault();
    check(defaultList.nextCursor, "The default list must produce a cursor for its own view");
    await rejects(() => store.list({ cursor: defaultList.nextCursor }), "invalid_cursor");
    for (const id of ["unknown", "private", "", "bad\0id", "\uD800"]) {
      await rejects(() => store.members(id, { cursor: "bad cursor" }), "not_found");
    }

    const extra = await store.memory("extra", "Synthetic added topic member");
    await store.place([extra], [item(extra, ["stones"])]);
    await rejects(() => store.list({ level: "L1", cursor: list.nextCursor }), "cursor_stale");
    await rejects(() => store.members("stones", { cursor: members.nextCursor }), "cursor_stale");
    await wrongView();
  }),

  // The hosted store's default-collation keys are exercised with imported IDs,
  // so case and punctuation differ from simple byte order.
  hostedCase(2, "seeks through equal counts and placements in hosted ID collation", async ctx => {
    const store = setup(ctx);
    const alpha = await store.memory("a_1");
    const plain = await store.memory("a1");
    const upper = await store.memory("A-1");
    const combining = await store.memory("e\u0301", "Combining spelling");
    const composed = await store.memory("é", "Composed spelling");
    await store.place([alpha, plain, upper, combining, composed], [
      item(alpha, [], { title: "Zebra", parentL2Ids: [], newL2Title: "Parent" }),
      item(plain, [], { title: "Mesa", parentL2Ids: [], newL2Title: "Parent" }),
      item(upper, [], { title: "Bravo", parentL2Ids: [], newL2Title: "Parent" }),
      item(combining, [], { title: "Aardvark", parentL2Ids: [], newL2Title: "Parent" }),
      item(composed, [], { title: "Bear", parentL2Ids: [], newL2Title: "Parent" }),
    ], ["parent", "a_1", "a1", "A-1", "e\u0301", "é"]);

    const first = await store.list({ level: "L1", limit: 2 });
    equal(first.items.map(({ id }) => id), ["a_1", "A-1"], "Equal counts must use hosted ID order rather than title order");
    check(first.nextCursor, "There must be another tied page");
    const second = await store.list({ level: "L1", limit: 3, cursor: first.nextCursor });
    equal([second.items.map(({ id }) => id), second.nextCursor],
      [["a1", "e\u0301", "é"], null], "Seek must use the same order, including ICU-equivalent IDs");
    equal((await store.list({ level: "L2" })).items, [{
      id: "parent", level: "L2", title: "Parent", parentIds: [], memberCount: 5, newestMemberIds: ["é", "e\u0301", "a1"],
    }], "The preview must cap at three with descending ID order for tied placements");
    const newest = await store.members("parent", { limit: 2 });
    equal(newest.items, [
      { kind: "memory", id: "é", placedAtUs: 1000n },
      { kind: "memory", id: "e\u0301", placedAtUs: 1000n },
    ], "Members must use descending hosted ID order on placement ties");
    check(newest.nextCursor, "Three tied members remain");
    equal(await store.members("parent", { limit: 3, cursor: newest.nextCursor }), {
      topic: { id: "parent", level: "L2", title: "Parent" },
      items: [{ kind: "memory", id: "a1", placedAtUs: 1000n },
        { kind: "memory", id: "A-1", placedAtUs: 1000n }, { kind: "memory", id: "a_1", placedAtUs: 1000n }],
      nextCursor: null,
    }, "Seek must use the member tie-break");
  }),

  hostedCase(3, "rolls up each L2 memory at its latest child placement", async ctx => {
    const store = setup(ctx);
    const shared = await store.memory("shared");
    const witness = await store.memory("witness");
    await store.place([shared], [item(shared, [], { title: "Left", parentL2Ids: [], newL2Title: "Parent" })], ["parent", "left"]);
    await store.advanceClock(10);
    await store.place([witness], [item(witness, [], { title: "Right", parentL2Ids: ["parent"] })], ["right"]);
    await store.advanceClock(10);
    await store.place([shared], [item(shared, ["left", "right"])]);

    equal((await store.list({ level: "L2" })).items, [{
      id: "parent", level: "L2", title: "Parent", parentIds: [], memberCount: 2, newestMemberIds: ["shared", "witness"],
    }], "A shared memory contributes once and its latest placement ranks first");
    equal((await store.members("left")).items, [{ kind: "memory", id: "shared", placedAtUs: 1000n }],
      "An L1 must retain its original direct placement");
    const first = await store.members("parent", { limit: 1 });
    equal(first.items, [{ kind: "memory", id: "shared", placedAtUs: 21000n }], "The L2 memory uses its newest placement");
    check(first.nextCursor, "The witness must remain");
    equal(await store.members("parent", { limit: 1, cursor: first.nextCursor }), {
      topic: { id: "parent", level: "L2", title: "Parent" },
      items: [{ kind: "memory", id: "witness", placedAtUs: 11000n }], nextCursor: null,
    }, "The older child placement must not reappear after the seek");
  }),

  // Cloud tests/topics-revision.test.ts, tests/topics-store.test.ts and
  // tests/w4/topics-api.test.ts: surviving witness, retired title and empty topic header.
  hostedCase(4, "excludes forgotten, text-suppressed and stale memories before counting, previewing and paging", async ctx => {
    const store = setup(ctx);
    const stale = await store.memory("stale", "Quantum optics lab");
    const forgotten = await store.memory("forgotten", "Synthetic source to forget");
    const suppressed = await store.memory("suppressed", "Synthetic hidden related memory");
    const witness = await store.memory("witness", "Synthetic surviving topic member");
    const older = await store.memory("older", "Synthetic second surviving topic member");
    await store.place([stale, older], [
      item(stale, [], { title: "Optics", parentL2Ids: [], newL2Title: "Science" }),
      item(older, [], { title: "Optics", parentL2Ids: [], newL2Title: "Science" }),
    ], ["science", "optics"]);
    await store.advanceClock(10);
    await store.place([witness, forgotten, suppressed], [
      item(witness, ["optics"]),
      item(forgotten, ["optics"]),
      item(suppressed, ["optics"], { title: "Hidden", parentL2Ids: [] }),
    ], ["hidden"]);
    const scope = ctx.scope(null);
    await ctx.harness.seedFact(ctx.owner, { ...scope, kind: "identity", origin: "forget", actionId: "forgotten-member",
      memoryId: "forgotten" });
    await ctx.harness.seedFact(ctx.owner, { ...scope, kind: "text", mode: "exact", origin: "forget",
      actionId: "suppressed-member", text: { digests: [await coreDigest("Synthetic hidden related memory")] } });
    await store.correct(stale, "Terracotta kiln schedule");

    equal(await store.list({ level: "L1" }), {
      items: [{ id: "optics", level: "L1", title: null, parentIds: ["science"],
        memberCount: 2, newestMemberIds: ["witness", "older"] }], nextCursor: null,
    }, "Only the visible rows should affect the L1 summary");
    equal(await store.list({ level: "L2" }), {
      items: [{ id: "science", level: "L2", title: null, parentIds: [],
        memberCount: 2, newestMemberIds: ["witness", "older"] }], nextCursor: null,
    }, "Only the visible rows should affect the L2 summary");
    for (const [id, level] of /** @type {const} */ ([["optics", "L1"], ["science", "L2"]])) {
      const first = await store.members(id, { limit: 1 });
      equal(first.items, [{ kind: "memory", id: "witness", placedAtUs: 11000n }], "Hidden newest rows must be skipped");
      check(first.nextCursor, "A visible member follows the witness");
      equal(await store.members(id, { limit: 1, cursor: first.nextCursor }), {
        topic: { id, level, title: null }, items: [{ kind: "memory", id: "older", placedAtUs: 1000n }], nextCursor: null,
      }, "The remaining visible row must exhaust the page");
    }
    equal(await store.members("hidden"), {
      topic: { id: "hidden", level: "L1", title: null }, items: [], nextCursor: null,
    }, "A known topic suppressed out of the list must retain a redacted header");
  }),

  hostedCase(5, "omits cards from mixed and card-only topics and retains known empty headers", async ctx => {
    const store = setup(ctx);
    const mixed = await store.memory("mixed-source");
    const cardOnly = await store.memory("card-source");
    const empty = await store.memory("empty-source");
    await store.place([mixed, cardOnly, empty], [
      item(mixed, [], { title: "Mixed", parentL2Ids: [], newL2Title: "Parent" }),
      item(cardOnly, [], { title: "Card only", parentL2Ids: [] }),
      item(empty, [], { title: "Empty", parentL2Ids: [] }),
    ], ["parent", "mixed", "card-only", "empty"]);
    await store.place([cardOnly, empty], [item(cardOnly), item(empty)]);
    await store.card("source-less-card", ["mixed", "card-only"]);

    equal(await store.list(), {
      items: [
        { id: "mixed", level: "L1", title: "Mixed", parentIds: ["parent"], memberCount: 1, newestMemberIds: ["mixed-source"] },
        { id: "parent", level: "L2", title: "Parent", parentIds: [], memberCount: 1, newestMemberIds: ["mixed-source"] },
      ], nextCursor: null,
    }, "Memory-only list rows must omit cardCount and card-only or empty topics");
    for (const [id, title] of [["card-only", "Card only"], ["empty", "Empty"]]) {
      equal(await store.members(id), {
        topic: { id, level: "L1", title }, items: [], nextCursor: null,
      }, "Known topics with no memories must still have headers");
    }
    equal((await store.members("mixed")).items, [{ kind: "memory", id: "mixed-source", placedAtUs: 1000n }],
      "A card in the mixed topic must not become a hosted member");
    equal((await store.membersDefault("mixed")).items.map(({ kind }) => kind).sort(), ["card", "memory"],
      "The card must actually be visible through the default projection");
  }, ["placement", "documentCards"]),
];
