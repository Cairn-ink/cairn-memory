import { compareUtf8, placePendingBatch } from "@cairn-ink/core";
import { check, equal, evidence, readDump, rejects, row } from "./support.mjs";

/** @import {ErrorCode, PlacementItem} from "@cairn-ink/core" */
/** @import {Receipt, Scope, TopicStore, Tx} from "@cairn-ink/core/ports" */
/** @import {CaseContext, ConformanceCase} from "./index.d.mts" */
/** @typedef {Awaited<ReturnType<TopicStore["pending"]>>[number]} Guard */

const firstPage = { cursor: null, limit: 100 };

/** @param {CaseContext} ctx @param {Scope} [scope] */
function setup(ctx, scope = ctx.scope(null)) {
  const { uow, memories, placement } = ctx.adapter;
  check(placement, "placement port is required");
  return {
    placement, scope,
    placePendingBatch: ctx.harness.placePendingBatch ?? placePendingBatch,
    /** @template T @param {(tx: Tx) => Promise<T>} fn */
    write: (fn) => uow.run(scope.owner, {}, fn),
    /** @param {string} content @param {number} [now] @param {readonly Receipt[]} [receipts] @returns {Promise<Guard>} */
    async seed(content, now = 1, receipts = []) {
      const next = await row(ctx, content);
      const { id, revision } = await uow.run(scope.owner, { pauseLock: true },
        (tx) => memories.insert(tx, scope, next, receipts, now));
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

  topicCase(14, "titles depend on every guarded memory in the placement batch", async (ctx) => {
    const observed = [];
    for (const change of ["erase", "correct"]) {
      const store = setup(ctx, ctx.scope(change));
      const proposer = await store.seed("A memory that proposes both topics");
      const other = await store.seed("A second memory with title material");
      const { createdTopics } = await store.apply([proposer, other], [
        item(proposer, [], topic("Title material", [], "Title context")), item(other),
      ]);
      check(createdTopics.length === 2 && createdTopics.every(({ title }) => title !== null),
        "The first memory proposes two topics with visible titles");
      const titles = async () => {
        const { items: catalog } = await store.catalog();
        const { items: list } = await store.list();
        return createdTopics.map(({ id }) => [catalog.find((entry) => entry.id === id)?.title,
          list.find((entry) => entry.id === id)?.title]);
      };
      equal(await titles(), createdTopics.map(({ title }) => [title, title]), "Both titles are initially visible");
      if (change === "erase") await store.erase(other);
      else {
        const corrected = await store.correct(other, "Corrected second memory");
        check(corrected.revision !== other.revision, "Correcting the second memory must change its revision");
      }
      observed.push(await titles());
    }
    equal(observed, [[[null, null], [null, null]], [[null, null], [null, null]]],
      "Catalog and list must hide both titles after erasing or correcting the non-proposing memory");
  }),

  topicCase(15, "session facts hide receipt-linked members and titles", async (ctx) => {
    const store = setup(ctx);
    const receipt = evidence("topic-source", 1);
    const { client, sessionId } = receipt;
    const source = await store.seed("Title source with a receipt", 1, [receipt]);
    const retained = await store.seed("Member without a receipt", 2);
    const pending = await store.seed("Pending memory with a receipt", 3, [evidence("topic-pending", 3)]);
    const { createdTopics: [created] } = await store.apply([source], [item(source, [], topic("Receipt-linked title"))]);
    await store.apply([retained], [item(retained, [created.id])]);
    equal((await store.list()).items.map(({ title, memberCount }) => [title, memberCount]),
      [["Receipt-linked title", 2]], "Both members and the sourced title are initially visible");
    equal(await store.pending(), [pending], "The unplaced receipt-linked memory is initially pending");

    let session;
    if (ctx.sessionRefs === "hashed") {
      const sessionKeyHash = ctx.harness.hashSessionKey?.(client, sessionId);
      check(typeof sessionKeyHash === "string" && /^[0-9a-f]{64}$/u.test(sessionKeyHash),
        "Hashed profile requires a session hash for the fixture");
      session = { client, sessionKeyHash };
    } else {
      session = { client, sessionId };
    }
    await ctx.harness.seedFact(ctx.owner, { ...store.scope, kind: "session", origin: "forget", actionId: crypto.randomUUID(), session });

    equal((await store.members(created.id)).items.map(({ id }) => id), [retained.memoryId],
      "A session fact must hide the receipt-linked member from members");
    equal((await store.list()).items.map(({ id, memberCount, newestMemberIds, title }) => [id, memberCount, newestMemberIds, title]),
      [[created.id, 1, [retained.memoryId], null]], "List must omit the suppressed member and null its sourced title");
    equal((await store.catalog()).items.map(({ id, title }) => [id, title]), [[created.id, null]],
      "Catalog must null the suppressed member's sourced title");
    equal(await store.forMemory(source), [], "A suppressed member must have no visible topic ids");
    equal(await store.pending(), [], "A suppressed memory must leave pending");
  }),

  topicCase(16, "an edit before classification dispatch leaves the live revision pending", async (ctx) => {
    const store = setup(ctx);
    const original = await store.seed("Before classification edit");
    const { uow, memories } = ctx.adapter;
    const { scope, placement } = store;
    const options = { uow, memories, scope, placement };
    const editedText = "After classification edit";
    const stale = await store.placePendingBatch({
      ...options,
      async classify({ memories: snapshot }, _catalog, { validateFresh }) {
        equal(snapshot.map(({ id, revision }) => ({ memoryId: id, revision })), [original], "Expected the original revision");
        await store.correct(original, editedText);
        await validateFresh();
        throw new Error("A stale snapshot reached dispatch");
      },
    });
    equal(stale, { status: "failed", error: { code: "revision_conflict", retryable: false } }, "Expected a stale batch");
    const edited = { ...original, revision: original.revision + 1 };
    equal(await store.pending(), [edited], "A conflict receipt must not consume the edited revision");

    const next = await store.placePendingBatch({
      ...options,
      async classify({ memories: snapshot }, _catalog, { validateFresh }) {
        equal(snapshot.map(({ revision, content }) => ({ revision, content })),
          [{ revision: edited.revision, content: editedText }], "Expected the new revision and content");
        await validateFresh();
        return { items: [item(edited, [], topic("Edited memory"))] };
      },
    });
    check(next.status === "applied" && next.createdTopics.length === 1, "The next batch must file the edited memory");
    equal(await store.forMemory(edited), [next.createdTopics[0].id], "The edited memory must have a current filing");
    equal(await store.pending(), [], "The current filing must consume the edited revision");
  }),

  topicCase(17, "a late failure preserves filed and unfiled outcomes at the same revision", async (ctx) => {
    const store = setup(ctx);
    const filed = await store.seed("Filed by another writer", 1);
    const unfiled = await store.seed("Left unfiled by another writer", 2);
    const snapshot = await store.pending();
    equal(snapshot, [filed, unfiled], "Both memories must be pending when the stale worker starts");
    const { createdTopics } = await store.apply(snapshot, [item(filed, [], topic("Concurrent filing")), item(unfiled)]);
    const before = await readDump(ctx.harness);
    await store.write((tx) => store.placement.markFailed(tx, store.scope, snapshot.map(({ memoryId }) => memoryId), "provider_error"));
    equal(await store.forMemory(filed), [createdTopics[0].id], "A late failure must preserve the filing");
    equal(await store.forMemory(unfiled), [], "A late failure must preserve the unfiled outcome");
    equal(await store.pending(), [], "Neither outcome may return to the queue");

    // Postgres keeps failures and outcomes in one row and exposes it in the
    // harness dump. Memory and SQLite store them separately.
    if (before && typeof before === "object" && "memoryPlacements" in before) {
      const after = await readDump(ctx.harness);
      check(after && typeof after === "object" && "memoryPlacements" in after, "Expected placement rows in the dump");
      equal(after.memoryPlacements, before.memoryPlacements, "A late failure must preserve every outcome column");
    }
  }),

  topicCase(18, "deterministic title conflicts write receipts and let the next memory run", async (ctx) => {
    const store = setup(ctx);
    const title = "Existing topic";
    const source = await store.seed("Source for the existing title");
    await store.apply([source], [item(source, [], topic(title))]);
    const queue = [];
    for (let i = 0; i < 6; i++) queue.push(await store.seed(`Pending memory ${i}`, i + 2));

    /** @type {string[][]} */
    const batches = [];
    const options = { uow: ctx.adapter.uow, memories: ctx.adapter.memories, scope: store.scope, placement: store.placement };
    const run = () => store.placePendingBatch({
      ...options,
      async classify({ memories }, _catalog, { validateFresh }) {
        await validateFresh();
        batches.push(memories.map(({ id }) => id));
        return { items: memories.map(({ id, revision }) => item({ memoryId: id, revision }, [], topic(title))) };
      },
    });
    const failure = { status: "failed", error: { code: "moc_title_conflict", retryable: false } };
    equal(await run(), failure, "The existing title must be rejected");
    equal(await store.pending(), queue.slice(5), "Title conflict receipts must consume the oldest five memories");
    equal(await run(), failure, "The sixth memory must reach the same classifier");
    equal(batches, [queue.slice(0, 5), queue.slice(5)].map(batch => batch.map(({ memoryId }) => memoryId)),
      "The second batch must reach the sixth memory");
    equal(await store.pending(), [], "A terminal receipt must also consume the sixth memory");
  }),

  topicCase(19, "an index change after validation defers the memory until a fresh catalog can be read", async (ctx) => {
    if (!ctx.harness.advanceClock) return "needs a controllable clock to verify retries";
    const store = setup(ctx);
    const pending = await store.seed("Awaiting a catalog update");
    const title = "Concurrent topic";
    const options = { uow: ctx.adapter.uow, memories: ctx.adapter.memories, scope: store.scope, placement: store.placement };
    const stale = await store.placePendingBatch({
      ...options,
      async classify({ memories }, { map }, { validateFresh }) {
        equal(memories.map(({ id }) => id), [pending.memoryId], "Expected the original pending memory");
        equal(map, [], "The original catalog must be empty");
        await validateFresh();
        const writer = await store.seed("Concurrent writer's memory");
        await store.apply([writer], [item(writer, [], topic(title))]);
        return { items: [item(pending)] };
      },
    });
    equal(stale, { status: "failed", error: { code: "revision_conflict", retryable: false } }, "Apply must reject the old index revision");
    equal(await store.pending(), [], "An index-only failure must start the retry cooldown");
    await ctx.harness.advanceClock(3_600_000);
    equal(await store.pending(), [pending], "The unchanged revision must become eligible after cooldown");

    const next = await store.placePendingBatch({
      ...options,
      async classify({ memories }, { map }, { validateFresh }) {
        equal(memories.map(({ id }) => id), [pending.memoryId], "Expected to classify the same memory again");
        const entry = map.find(({ moc }) => moc.title === title);
        check(entry, "The next batch must read the concurrent topic");
        await validateFresh();
        return { items: [item(pending, [entry.moc.id])] };
      },
    });
    check(next.status === "applied" && next.placed[0]?.topicIds.length === 1, "The re-read must file the memory");
    equal(await store.pending(), [], "The current filing must consume the pending memory");
  }),

  topicCase(20, "continuous index movement lets the sixth memory run and caps deterministic failures", async (ctx) => {
    if (!ctx.harness.advanceClock) return "needs a controllable clock to verify retries";
    const store = setup(ctx);
    const title = "Existing topic";
    const source = await store.seed("Source for the existing topic");
    await store.apply([source], [item(source, [], topic(title))]);
    const queue = [];
    for (let i = 0; i < 6; i++) queue.push(await store.seed(`Waiting memory ${i}`, i + 2));
    const [failing] = queue;
    const sixth = queue[5];
    const oldestIds = queue.slice(0, 5).map(({ memoryId }) => memoryId);
    /** @type {string[][]} */
    const batches = [];
    let tick = 0;
    const run = () => store.placePendingBatch({
      uow: ctx.adapter.uow, memories: ctx.adapter.memories, scope: store.scope, placement: store.placement,
      async classify({ memories }, _catalog, { validateFresh }) {
        await validateFresh();
        const ids = memories.map(({ id }) => id);
        batches.push(ids);
        const writer = await store.seed(`Concurrent writer ${++tick}`, tick + 10);
        await store.apply([writer], [item(writer, [], topic(`Concurrent topic ${tick}`))]);
        if (ids.includes(failing.memoryId)) {
          // Use the fresh index for the deterministic rejection after the original snapshot has gone stale.
          await store.apply([failing], [item(failing, [], topic(title))]);
        }
        return { items: memories.map(({ id }) => ({ memoryId: id, parentIds: [] })) };
      },
    });
    const deterministic = { status: "failed", error: { code: "moc_title_conflict", retryable: false } };
    equal(await run(), deterministic, "The first memory must fail deterministically");
    await run();
    equal(batches, [oldestIds, [sixth.memoryId]], "The sixth memory must run while the oldest five are cooling down");

    for (let attempt = 2; attempt <= 3; attempt++) {
      await ctx.harness.advanceClock(3_600_000);
      equal(await store.pending(), queue.slice(0, 5), `The oldest five must be eligible for attempt ${attempt}`);
      equal(await run(), deterministic, `The first memory must fail on attempt ${attempt}`);
    }
    equal(batches, [oldestIds, [sixth.memoryId], oldestIds, oldestIds], "The index must advance on every classification tick");
    await ctx.harness.advanceClock(3_600_000);
    equal(await store.pending(), [sixth], "The deterministic failure and its four batchmates must leave the queue at the cap");
  }),

  topicCase(21, "placement reads the full 150-topic catalog across cursor pages with a limit of 200", async (ctx) => {
    const store = setup(ctx);
    for (let offset = 0; offset < 75; offset += 5) {
      const guards = [];
      const items = [];
      for (let i = offset; i < offset + 5; i++) {
        const guard = await store.seed(`Catalog source ${i}`);
        guards.push(guard);
        items.push(item(guard, [], topic(`Child ${i}`, [], `Parent ${i}`)));
      }
      await store.apply(guards, items);
    }

    const first = await store.catalog();
    check(first.nextCursor, "Expected a second catalog page");
    const second = await store.catalog({ ...firstPage, cursor: first.nextCursor });
    equal([first.items.length, second.items.length, second.exhausted], [100, 50, true], "Expected 150 catalog topics");
    const pending = await store.seed("Awaiting placement across catalog pages");
    const result = await store.placePendingBatch({
      uow: ctx.adapter.uow, memories: ctx.adapter.memories, scope: store.scope, placement: store.placement,
      catalogLimit: 200,
      async classify({ memories }, { map, mapExhausted }, { validateFresh }) {
        equal(memories.map(({ id }) => id), [pending.memoryId], "Expected the pending memory");
        equal(map.map(({ moc }) => moc.id), [...first.items, ...second.items].map(({ id }) => id),
          "Classification must receive both catalog pages in order");
        equal(mapExhausted, true, "The catalog must be exhausted");
        await validateFresh();
        return { items: [item(pending)] };
      },
    });
    equal(result.status, "applied", "Expected placement to succeed");
  }),
];
