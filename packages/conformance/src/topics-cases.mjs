import { compareUtf8 } from "@cairn-ink/core";
import { check, equal, readDump, rejects, row } from "./support.mjs";

/** @import {ErrorCode, PlacementItem} from "@cairn-ink/core" */
/** @import {Scope, TopicStore, Tx} from "@cairn-ink/core/ports" */
/** @import {CaseContext, ConformanceCase} from "./index.d.mts" */
/** @typedef {Awaited<ReturnType<TopicStore["pending"]>>[number]} Guard */

const firstPage = { cursor: null, limit: 100 };

/** @param {CaseContext} ctx @param {Scope} [scope] */
function setup(ctx, scope = ctx.scope(null)) {
  const { uow, memories, placement } = ctx.adapter;
  check(placement, "placement port is required");
  return {
    placement, scope,
    /** @template T @param {(tx: Tx) => Promise<T>} fn */
    write: (fn) => uow.run(scope.owner, {}, fn),
    /** @param {string} content @param {number} [now] @returns {Promise<Guard>} */
    async seed(content, now = 1) {
      const next = await row(ctx, content);
      const { id, revision } = await uow.run(scope.owner, { pauseLock: true },
        (tx) => memories.insert(tx, scope, next, [], now));
      return { memoryId: id, revision };
    },
    /** @param {Guard} guard @param {string} content */
    async correct({ memoryId, revision }, content) {
      const next = await row(ctx, content);
      return uow.run(scope.owner, { pauseLock: true },
        (tx) => memories.replaceContent(tx, scope, memoryId, revision, next, null, 2));
    },
    /** @param {Guard} guard */
    erase: ({ memoryId }) => uow.run(scope.owner, { pauseLock: true }, (tx) => memories.erase(tx, scope, memoryId)),
    /** @param {Guard} guard */
    hide: ({ memoryId }) => ctx.harness.seedFact(scope.owner, {
      ...scope, kind: "identity", origin: "forget", actionId: "topic-forget", memoryId,
    }),
    /** @param {{cursor: string | null, limit: number}} [query] */
    catalog: (query = firstPage) => uow.run(scope.owner, { readOnly: true }, (tx) => placement.catalog(tx, scope, query)),
    /** @param {{cursor: string | null, limit: number, level?: "L1" | "L2"}} [query] */
    list: (query = firstPage) => uow.run(scope.owner, { readOnly: true }, (tx) => placement.list(tx, scope, query)),
    /** @param {string} id @param {{cursor: string | null, limit: number}} [query] */
    members: (id, query = firstPage) => uow.run(scope.owner, { readOnly: true }, (tx) => placement.members(tx, scope, id, query)),
    /** @param {Guard} guard */
    forMemory: ({ memoryId }) => uow.run(scope.owner, { readOnly: true }, (tx) => placement.forMemory(tx, scope, memoryId)),
    /** @param {Guard} guard */
    drop: ({ memoryId }) => uow.run(scope.owner, {}, (tx) => placement.dropMemory(tx, scope, memoryId)),
    pending: () => uow.run(scope.owner, { readOnly: true }, (tx) => placement.pending(tx, scope, { limit: 5 })),
    /** @param {Guard[]} memoryRevisions @param {PlacementItem[]} items @param {number} [indexRevision] */
    apply: (memoryRevisions, items, indexRevision) => uow.run(scope.owner, {}, async (tx) => {
      const revision = indexRevision ?? (await placement.catalog(tx, scope, firstPage)).indexRevision;
      return placement.applyPlacement(tx, scope, { memoryRevisions, indexRevision: revision }, { items });
    }),
  };
}

/** @param {Guard} guard @param {string[]} [parentIds] @param {PlacementItem["newL1"]} [newL1] @returns {PlacementItem} */
function item({ memoryId }, parentIds = [], newL1) {
  return { memoryId, parentIds, ...(newL1 && { newL1 }) };
}

/** @param {string} title @param {string[]} [parentL2Ids] @param {string} [newL2Title] */
function topic(title, parentL2Ids = [], newL2Title) {
  return { title, parentL2Ids, ...(newL2Title && { newL2Title }) };
}

/** @param {CaseContext} ctx @param {() => Promise<unknown>} apply @param {ErrorCode} code */
async function unchanged(ctx, apply, code) {
  const before = await readDump(ctx.harness);
  await rejects(apply, code);
  equal(await readDump(ctx.harness), before, "Rejected placement must leave the store unchanged");
}

/** @param {ReturnType<typeof setup>} store */
async function fourParents(store) {
  const parents = [];
  for (let i = 0; i < 4; i++) {
    const memory = await store.seed(`Parent source ${i}`);
    const result = await store.apply([memory], [item(memory, [], topic(`Child ${i}`, [], `Parent ${i}`))]);
    const l1 = result.createdTopics.find(({ level }) => level === "L1");
    const l2 = result.createdTopics.find(({ level }) => level === "L2");
    check(l1 && l2, "Both proposed levels must be created");
    parents.push({ l1: l1.id, l2: l2.id });
  }
  return parents;
}

/** @param {number} number @param {string} title @param {ConformanceCase["run"]} run @returns {ConformanceCase} */
const topicCase = (number, title, run) => ({ id: `T-TOP-${number}`, title, needs: ["placement"], run });

export const topicCases = [
  topicCase(1, "forgotten memories are invisible even before memberships are dropped", async (ctx) => {
    const store = setup(ctx);
    const forgotten = await store.seed("Memory to hide");
    const current = await store.seed("Memory to retain");
    const { createdTopics } = await store.apply([forgotten, current], [item(forgotten, [], topic("Child", [], "Parent")),
      item(current, [], topic("Child", [], "Parent"))]);
    const [parent, child] = ["L2", "L1"].map((level) => createdTopics.find((entry) => entry.level === level));
    check(parent && child, "Need a child and its parent");
    const { createdTopics: siblings } = await store.apply([current], [
      item(current, [child.id], topic("Sibling", [parent.id])),
    ]);
    check(siblings.length === 1, "Need a second child holding the same memory");
    await store.hide(forgotten);
    for (const { id } of [parent, child]) {
      equal((await store.members(id)).items.map((member) => member.id), [current.memoryId], "Member listing leaks a forgotten row or duplicates a memory");
      const overview = (await store.list()).items.find((entry) => entry.id === id);
      equal(overview?.memberCount, 1, "A forgotten row must not contribute to the count");
      equal(overview?.newestMemberIds, [current.memoryId], "Only visible members contribute to recency");
    }
    equal(await store.forMemory(forgotten), [], "A forgotten memory has no visible topic ids");
  }),

  topicCase(2, "empty topics leave list and stay in catalog", async (ctx) => {
    const store = setup(ctx);
    const target = await store.seed("Only member");
    const { createdTopics } = await store.apply([target], [item(target, [], topic("Empty later", [], "Empty parent later"))]);
    equal((await store.list()).items.length, 2, "Both levels initially have a visible member");
    await store.erase(target);
    equal((await store.list()).items, [], "Neither level has a visible member after erasure");
    const ids = createdTopics.map(({ id }) => id).sort(compareUtf8);
    equal((await store.catalog()).items.map(({ id }) => id).sort(compareUtf8), ids, "Catalog retains both empty levels");
  }),

  topicCase(3, "every title source must remain visible at its recorded revision", async (ctx) => {
    for (const change of ["forget", "correct", "erase"]) {
      const store = setup(ctx, ctx.scope(change));
      const source = await store.seed("Source to change");
      const other = await store.seed("Source that stays visible");
      const proposed = topic("Shared title", [], "Shared parent title");
      const { createdTopics } = await store.apply([source, other], [item(source, [], proposed), item(other, [], proposed)]);
      check(createdTopics.length === 2 && createdTopics.every(({ title }) => title !== null), "Current sources should expose both created titles");
      if (change === "forget") await store.hide(source);
      if (change === "correct") await store.correct(source, "Corrected source");
      if (change === "erase") await store.erase(source);
      equal((await store.catalog()).items.map(({ title }) => title), [null, null], `Catalog exposed a ${change} title`);
      equal((await store.list()).items.map(({ title }) => title), [null, null], `List exposed a ${change} title`);
      equal(await store.forMemory(source), [], `A ${change} placement is no longer current`);
    }
  }),

  topicCase(4, "topic reads and parent resolution are isolated by owner and namespace", async (ctx) => {
    const store = setup(ctx);
    const otherScope = setup(ctx, ctx.scope("other"));
    const otherOwner = setup(ctx, { owner: ctx.otherOwner, namespace: null });
    const entries = [];
    for (const [i, lane] of [store, otherScope, otherOwner].entries()) {
      const seed = await lane.seed(`Scope member ${i}`);
      const { createdTopics: [created] } = await lane.apply([seed], [item(seed, [], topic("Title reused across scopes"))]);
      entries.push({ lane, seed, id: created.id });
    }
    for (const { lane, seed, id } of entries) {
      equal((await lane.catalog()).items.map((entry) => entry.id), [id], "Catalog leaked another scope");
      equal((await lane.list()).items.map((entry) => entry.id), [id], "List leaked another scope");
      for (const { id: foreignId } of entries.filter((entry) => entry.lane !== lane)) {
        equal(await lane.members(foreignId), { items: [], nextCursor: null }, "Foreign membership must look absent");
        await unchanged(ctx, () => lane.apply([seed], [item(seed, [foreignId])]), "not_found");
      }
    }
  }),

  topicCase(5, "bad items and stale guards reject the whole placement", async (ctx) => {
    const store = setup(ctx);
    const first = await store.seed("First guarded memory");
    const second = await store.seed("Second guarded memory");
    const plan = [item(first, [], topic("Must stay absent")), item(second)];
    await unchanged(ctx, () => store.apply([first, second], [plan[0], item(second, ["absent-topic"])]), "not_found");
    await unchanged(ctx, () => store.apply([first], plan), "invalid_input");
    const { indexRevision } = await store.catalog();
    await store.correct(second, "New revision of second memory");
    await unchanged(ctx, () => store.apply([first, second], plan), "revision_conflict");
    await unchanged(ctx, () => store.apply([first, { ...second, revision: second.revision + 1 }], plan, indexRevision),
      "revision_conflict");
    await store.hide(second);
    await unchanged(ctx, () => store.apply([first, { ...second, revision: second.revision + 1 }], plan), "revision_conflict");
  }),

  topicCase(6, "replaying an index-changing apply conflicts", async (ctx) => {
    const store = setup(ctx);
    const target = await store.seed("Replay source");
    const { indexRevision } = await store.catalog();
    const plan = [item(target, [], topic("Created once"))];
    await store.apply([target], plan, indexRevision);
    await unchanged(ctx, () => store.apply([target], plan, indexRevision), "revision_conflict");
  }),

  topicCase(7, "parent counts and levels are enforced atomically", async (ctx) => {
    const store = setup(ctx);
    const parents = await fourParents(store);
    const a = await store.seed("First limit source");
    const b = await store.seed("Second limit source");
    await unchanged(ctx, () => store.apply([a], [item(a, parents.map(({ l1 }) => l1))]), "invalid_input");
    const l2s = parents.map(({ l2 }) => l2);
    await unchanged(ctx, () => store.apply([a, b], [item(a, [], topic("Combined", l2s.slice(0, 2))),
      item(b, [], topic("Combined", l2s.slice(2)))]), "invalid_input");
    await unchanged(ctx, () => store.apply([a], [item(a, [l2s[0]])]), "invalid_ref");
    await unchanged(ctx, () => store.apply([a], [item(a, [], topic("Wrong level", [parents[0].l1]))]), "invalid_ref");
  }),

  topicCase(8, "canonical titles conflict with stored topics and coalesce within a batch", async (ctx) => {
    const store = setup(ctx);
    const a = await store.seed("First shared-title source");
    const b = await store.seed("Second shared-title source");
    const existing = topic("Diagrams", [], "Engineering");
    const { createdTopics, placed } = await store.apply([a, b], [item(a, [], existing), item(b, [], existing)]);
    equal(createdTopics.map(({ level }) => level).sort(), ["L1", "L2"], "Each distinct title and level must be created once");
    equal(placed[0].topicIds, placed[1].topicIds, "Both items must use the same coalesced L1");
    await unchanged(ctx, () => store.apply([a], [item(a, [], topic("ＤＩＡＧＲＡＭＳ"))]), "moc_title_conflict");
    await unchanged(ctx, () => store.apply([a], [item(a, [], topic("Another child", [], "ｅＮＧＩＮＥＥＲＩＮＧ"))]), "moc_title_conflict");
  }),

  topicCase(9, "pending skips outcomes and failures until the memory revision changes", async (ctx) => {
    const store = setup(ctx);
    const unfiled = await store.seed("Classified without a topic", 1);
    const failed = await store.seed("Failed classification attempt", 2);
    const untouched = await store.seed("Untouched memory", 3);
    const tie = await store.seed("Same creation time", 3);
    const tied = [untouched, tie].sort((a, b) => compareUtf8(a.memoryId, b.memoryId));
    equal(await store.pending(), [unfiled, failed, ...tied], "Pending order uses creation time then id");
    await store.apply([unfiled], [item(unfiled)]);
    await store.write((tx) => store.placement.markFailed(tx, store.scope, [failed.memoryId], "invalid_model_output"));
    equal(await store.pending(), tied, "Outcomes and failures prevent repeated pending work");
    const a = await store.correct(unfiled, "Corrected unfiled body");
    const b = await store.correct(failed, "Corrected failed body");
    equal(await store.pending(), [{ ...unfiled, revision: a.revision }, { ...failed, revision: b.revision }, ...tied],
      "A new memory revision is eligible at its original creation position");
  }),

  topicCase(10, "catalog keeps empty topics and orders both levels across pages", async (ctx) => {
    const store = setup(ctx);
    const a = await store.seed("Source for topic Z");
    const b = await store.seed("Source for topic with emoji");
    const c = await store.seed("Source for topic with a private-use character");
    await store.apply([a, b, c], [item(a, [], topic("Z")), item(b, [], topic("😀", [], "A parent")), item(c, [], topic("\uE000"))]);
    await store.apply([a], [item(a)]);
    const first = await store.catalog({ cursor: null, limit: 2 });
    check(first.nextCursor !== null && !first.exhausted, "First catalog page must expose continuation");
    const second = await store.catalog({ cursor: first.nextCursor, limit: 2 });
    equal(second.nextCursor, null, "Last page has no cursor");
    equal(second.exhausted, true, "Last page is exhausted");
    equal(second.indexRevision, first.indexRevision, "Pages are at the same revision");
    equal([...first.items, ...second.items].map(({ level, title }) => [level, title]),
      [["L1", "Z"], ["L1", "\uE000"], ["L1", "😀"], ["L2", "A parent"]], "Catalog must use level and UTF-8 order");
    equal(first.items[0].parentIds, [], "L1 without L2 parents is valid");
    equal((await store.list()).items.map(({ title }) => title), ["\uE000", "😀", "A parent"], "List omits the empty L1");
  }),

  topicCase(11, "index changes exactly on membership mutations and is owner-wide", async (ctx) => {
    const store = setup(ctx);
    const a = await store.seed("Index mutation source");
    const b = await store.seed("Unfiled recording source");
    let { indexRevision } = await store.catalog();
    await store.apply([a], [item(a, [], topic("Index topic", [], "Index parent"))]);
    const created = await store.catalog({ cursor: null, limit: 1 });
    equal(created.indexRevision, ++indexRevision, "One bump for two topics and a membership");
    await store.apply([b], [item(b)]);
    equal((await store.catalog()).indexRevision, indexRevision, "No bump for classified-unfiled alone");
    const child = (await store.catalog()).items.find(({ level }) => level === "L1");
    check(child, "Placement created an L1");
    await store.apply([a], [item(a, [child.id])]);
    equal((await store.catalog()).indexRevision, indexRevision, "No bump on a full no-op");
    await store.apply([b], [item(b, [child.id])]);
    equal((await store.catalog()).indexRevision, ++indexRevision, "One bump on adding a membership alone");
    equal(await store.drop(a), { dropped: 1 }, "A membership was removed");
    equal((await store.catalog()).indexRevision, ++indexRevision, "One bump on dropping memberships");
    equal(await store.drop(a), { dropped: 0 }, "Second drop is empty");
    equal((await store.catalog()).indexRevision, indexRevision, "No bump on an empty drop");
    const before = await store.catalog({ cursor: null, limit: 1 });
    check(before.nextCursor, "A cursor is needed to exercise owner invalidation");
    await setup(ctx, ctx.scope("same-owner-other-namespace")).seed("An unrelated owner write");
    await rejects(() => store.catalog({ cursor: before.nextCursor, limit: 1 }), "cursor_stale");
    await rejects(() => store.catalog({ cursor: created.nextCursor, limit: 1 }), "cursor_stale");
  }),

  topicCase(12, "new L2 edges may extend the three existing parents", async (ctx) => {
    const store = setup(ctx);
    const parents = (await fourParents(store)).slice(0, 3).map(({ l2 }) => l2);
    const target = await store.seed("Source for a fourth edge");
    const { createdTopics } = await store.apply([target], [item(target, [], topic("Four edges", parents, "Fourth new parent"))]);
    const child = createdTopics.find(({ level }) => level === "L1");
    const parent = createdTopics.find(({ level }) => level === "L2");
    check(child && parent, "The proposed child and parent must both be created");
    equal([...child.parentIds].sort(compareUtf8), [...parents, parent.id].sort(compareUtf8), "The new L2 adds a fourth edge");
  }),

  topicCase(13, "a full no-op can be replayed with its original index revision", async (ctx) => {
    const store = setup(ctx);
    const target = await store.seed("A no-op replay source");
    const { createdTopics: [created] } = await store.apply([target], [item(target, [], topic("Reused"))]);
    const { indexRevision } = await store.catalog();
    const plan = [item(target, [created.id])];
    const before = await readDump(ctx.harness);
    const first = await store.apply([target], plan, indexRevision);
    equal(await store.apply([target], plan, indexRevision), first, "Replay returns the same outcome");
    equal((await store.catalog()).indexRevision, indexRevision, "Replay preserves the index revision");
    equal(await readDump(ctx.harness), before, "A full no-op writes nothing");
  }),
];
