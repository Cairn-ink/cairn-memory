import { compareUtf8 } from "@cairn-ink/core";
import { check, equal, rejects, row } from "./support.mjs";

/** @import {PlacementItem} from "@cairn-ink/core" */
/** @import {Scope, TopicStore, Tx} from "@cairn-ink/core/ports" */
/** @import {CaseContext, ConformanceCase} from "./index.d.mts" */
/** @typedef {Awaited<ReturnType<TopicStore["pending"]>>[number]} Guard */

const firstPage = { cursor: null, limit: 100 };

/** @param {CaseContext} ctx @param {Scope} [scope] */
function setup(ctx, scope = ctx.scope(null)) {
  const { uow, memories, placement } = ctx.adapter;
  check(placement, "placement port is required");
  return {
    /** @param {string} text @returns {Promise<Guard>} */
    async seed(text) {
      const next = await row(ctx, text);
      const { id, revision } = await uow.run(scope.owner, { pauseLock: true },
        (tx) => memories.insert(tx, scope, next, [], 1));
      return { memoryId: id, revision };
    },
    /** @param {Guard} guard @param {string} text */
    async correct({ memoryId, revision }, text) {
      const next = await row(ctx, text);
      return uow.run(scope.owner, { pauseLock: true },
        (tx) => memories.replaceContent(tx, scope, memoryId, revision, next, null, 2));
    },
    /** @param {Guard} guard */
    forget: ({ memoryId }) => ctx.harness.seedFact(scope.owner, {
      ...scope, kind: "identity", origin: "forget", actionId: crypto.randomUUID(), memoryId,
    }),
    /** @param {Guard} guard */
    drop: ({ memoryId }) => uow.run(scope.owner, {}, (tx) => placement.dropMemory(tx, scope, memoryId)),
    /** @param {Guard[]} memoryRevisions @param {PlacementItem[]} items */
    apply: (memoryRevisions, items) => uow.run(scope.owner, {}, async (tx) => {
      const { indexRevision } = await placement.catalog(tx, scope, firstPage);
      return placement.applyPlacement(tx, scope, { memoryRevisions, indexRevision }, { items });
    }),
    /** @param {readonly string[]} ids */
    lookup: (ids) => {
      const forMemories = placement.forMemories;
      check(forMemories, "forMemories is required for this case");
      return uow.run(scope.owner, { readOnly: true }, (tx) => forMemories.call(placement, tx, scope, ids));
    },
    /** @template T @param {(tx: Tx, scope: Scope, placement: TopicStore) => Promise<T>} fn */
    read: (fn) => uow.run(scope.owner, { readOnly: true }, (tx) => fn(tx, scope, placement)),
  };
}

/** @param {Guard} guard @param {string[]} [parentIds] @param {PlacementItem["newL1"]} [newL1] @returns {PlacementItem} */
function item({ memoryId }, parentIds = [], newL1) {
  return { memoryId, parentIds, ...(newL1 && { newL1 }) };
}

/** @param {number | "4-namespace"} number @param {string} title @param {ConformanceCase["run"]} run @returns {ConformanceCase} */
function batchCase(number, title, run) {
  return {
    id: `T-TFM-${number}`, title, needs: ["placement"],
    async run(ctx) {
      if (!ctx.adapter.placement?.forMemories) return "forMemories is optional";
      return run(ctx);
    },
  };
}

/** @param {ReturnType<typeof setup>[]} lanes */
async function checkIsolation(lanes) {
  const ids = [];
  for (const [index, lane] of lanes.entries()) {
    const memory = await lane.seed(`Scoped memory ${index}`);
    await lane.apply([memory], [item(memory)]);
    ids.push(memory.memoryId);
  }
  for (const [index, lane] of lanes.entries()) {
    equal(await lane.lookup(ids), [{ memoryId: ids[index], topics: [] }], "Only the memory in the requested scope appears");
  }
}

/** @type {ConformanceCase[]} */
export const TOPIC_FOR_MEMORIES_CASES = [
  batchCase(1, "mixed batches include only placed memories in first-occurrence order", async (ctx) => {
    const store = setup(ctx);
    const filed = await store.seed("Filed memory");
    const unfiled = await store.seed("Unfiled memory");
    const unplaced = await store.seed("Memory awaiting placement");
    const { createdTopics } = await store.apply([filed, unfiled], [
      item(filed, [], { title: "Child topic", parentL2Ids: [], newL2Title: "Parent topic" }), item(unfiled),
    ]);
    const child = createdTopics.find(({ level }) => level === "L1");
    check(child, "Placement must create a child topic");
    const expected = [
      { memoryId: filed.memoryId, topics: [{ id: child.id, title: "Child topic" }] },
      { memoryId: unfiled.memoryId, topics: [] },
    ].sort((a, b) => compareUtf8(b.memoryId, a.memoryId));
    const [first, second] = expected.map(({ memoryId }) => memoryId);
    equal(await store.lookup([first, unplaced.memoryId, crypto.randomUUID(), second, first]), expected,
      "Only filed and unfiled outcomes appear once, in input order, with L1 topics only");
  }),

  batchCase(2, "forgotten memories and stale placement revisions are omitted", async (ctx) => {
    const store = setup(ctx);
    const forgotten = await store.seed("Placed memory to forget");
    const corrected = await store.seed("Placed memory to correct");
    await store.apply([forgotten, corrected], [item(forgotten), item(corrected)]);
    const ids = [forgotten.memoryId, corrected.memoryId];
    equal(await store.lookup(ids), ids.map((memoryId) => ({ memoryId, topics: [] })), "Both outcomes are initially current");
    await store.forget(forgotten);
    equal(await store.lookup(ids), [{ memoryId: corrected.memoryId, topics: [] }], "A fact hides even an unfiled outcome");
    const updated = await store.correct(corrected, "New revision awaiting placement");
    check(updated.revision > corrected.revision, "Correction must advance the memory revision");
    equal(await store.lookup(ids), [], "An outcome at an older revision is omitted");
  }),

  batchCase(3, "a forgotten title source nulls the title while preserving the topic id", async (ctx) => {
    const store = setup(ctx);
    const member = await store.seed("Retained member and title source");
    const source = await store.seed("Second title source to forget");
    const title = "Title from two sources";
    const { createdTopics: [child] } = await store.apply([member, source], [
      item(member, [], { title, parentL2Ids: [] }), item(source),
    ]);
    equal(await store.lookup([member.memoryId]), [{ memoryId: member.memoryId, topics: [{ id: child.id, title }] }],
      "The title is visible while both sources are current");
    await store.forget(source);
    equal(await store.lookup([member.memoryId]), [{ memoryId: member.memoryId, topics: [{ id: child.id, title: null }] }],
      "A forgotten title source hides the title even when the member remains visible");
  }),

  batchCase(4, "other owners are invisible to the batch lookup", async (ctx) => {
    await checkIsolation([setup(ctx), setup(ctx, { owner: ctx.otherOwner, namespace: null })]);
  }),

  batchCase("4-namespace", "other owners and namespaces are invisible to the batch lookup", async (ctx) => {
    await checkIsolation([setup(ctx), setup(ctx, ctx.scope("other-namespace")), setup(ctx, { owner: ctx.otherOwner, namespace: null })]);
  }),

  batchCase(5, "the batch size must be between 1 and 100 before deduplication", async (ctx) => {
    const store = setup(ctx);
    const memory = await store.seed("Memory for batch size limits");
    await store.apply([memory], [item(memory)]);
    const { memoryId } = memory;
    const expected = [{ memoryId, topics: [] }];
    equal(await store.lookup([memoryId]), expected, "The lower bound is accepted");
    equal(await store.lookup(Array(100).fill(memoryId)), expected, "The upper bound is accepted");
    await rejects(() => store.lookup([]), "invalid_input");
    await rejects(() => store.lookup(Array(101).fill(memoryId)), "invalid_input");
  }),

  batchCase(6, "lying iterators and accessor elements are rejected without invoking them", async (ctx) => {
    const store = setup(ctx);
    const { memoryId } = await store.seed("Memory for caller-array validation");
    let calls = 0;
    const iterable = Object.defineProperty([memoryId], Symbol.iterator, {
      value: function* () { calls++; yield "different-id"; },
    });
    const accessor = Object.defineProperty([memoryId], "0", {
      get() { calls++; return memoryId; },
    });
    await rejects(() => store.lookup(iterable), "invalid_input");
    await rejects(() => store.lookup(accessor), "invalid_input");
    equal(calls, 0, "Validation must not invoke the iterator or accessor");
  }),

  batchCase(7, "batch topic ids match forMemory and preserve its order", async (ctx) => {
    const store = setup(ctx);
    const first = await store.seed("First topic source");
    const second = await store.seed("Second topic source");
    const { createdTopics } = await store.apply([first, second], [
      item(first, [], { title: "First topic", parentL2Ids: [] }),
      item(second, [], { title: "Second topic", parentL2Ids: [] }),
    ]);
    const target = await store.seed("Memory filed in both topics");
    const descending = createdTopics.map(({ id }) => id).sort((a, b) => compareUtf8(b, a));
    await store.apply([target], [item(target, descending)]);

    const ids = [target.memoryId, first.memoryId, second.memoryId];
    const expected = await store.read((tx, scope, placement) =>
      Promise.all(ids.map((id) => placement.forMemory(tx, scope, id))));
    equal(expected[0].length, 2, "The target needs two distinct memberships to check ordering");
    const rows = await store.lookup(ids);
    equal(rows.map(({ memoryId }) => memoryId), ids, "All placed memories appear in input order");
    equal(rows.map(({ topics }) => topics.map(({ id }) => id)), expected, "Each row matches its single-memory result in order");
  }),

  {
    id: "T-TFM-8",
    title: "a title-only drop advances the index once and invalidates catalog cursors",
    needs: ["placement"],
    async run(ctx) {
      const store = setup(ctx);
      const alpha = await store.seed("Alpha member");
      const zulu = await store.seed("Zulu member");
      const source = await store.seed("Second Zulu title source");
      await store.apply([alpha], [item(alpha, [], { title: "Alpha", parentL2Ids: [] })]);
      const { createdTopics: [zuluTopic] } = await store.apply([zulu, source], [
        item(zulu, [], { title: "Zulu", parentL2Ids: [] }), item(source),
      ]);

      /** @param {{cursor: string | null, limit: number}} query */
      const catalog = (query) => store.read((tx, scope, placement) => placement.catalog(tx, scope, query));
      const { nextCursor, indexRevision } = await catalog({ cursor: null, limit: 1 });
      check(nextCursor, "Two topics must produce a catalog cursor");

      equal(await store.drop(source), { dropped: 0 }, "The title source has no memberships to drop");
      const after = await catalog(firstPage);
      equal(after.items.find(({ id }) => id === zuluTopic.id)?.title, null, "The drop retires the Zulu title source");
      equal(after.indexRevision, indexRevision + 1, "A title-only drop must advance the index revision by exactly one");
      await rejects(() => catalog({ cursor: nextCursor, limit: 1 }), "cursor_stale");

      equal(await store.drop(source), { dropped: 0 }, "The repeated drop removes no memberships");
      equal((await catalog(firstPage)).indexRevision, after.indexRevision, "A repeated drop must preserve the index revision");
    },
  },
];
