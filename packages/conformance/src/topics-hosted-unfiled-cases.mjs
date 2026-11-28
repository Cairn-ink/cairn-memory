import { compareUtf8, decodeCursor, encodeCursor } from "@cairn-ink/core";
import { check, equal, evidence, rejects, row } from "./support.mjs";

/** @import {ErrorCode, PlacementItem} from "@cairn-ink/core" */
/** @import {Receipt, Scope, TopicStore, Tx} from "@cairn-ink/core/ports" */
/** @import {CaseContext, ConformanceCase} from "./index.d.mts" */
/** @typedef {Awaited<ReturnType<TopicStore["pending"]>>[number]} Guard */

const firstPage = { cursor: null, limit: 50 };

/** @param {CaseContext} ctx @param {Scope} [scope] */
function setup(ctx, scope = ctx.scope(null)) {
  const { uow, memories, placement, supersession } = ctx.adapter;
  check(placement?.memoryCounts && placement.unfiled, "Hosted topic reads are required for this fixture");
  const { memoryCounts, unfiled } = placement;
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const read = fn => uow.run(scope.owner, { readOnly: true }, fn);
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const write = fn => uow.run(scope.owner, { pauseLock: true }, fn);
  return {
    counts: () => read(tx => memoryCounts.call(placement, tx, scope)),
    /** @param {string | null} [cursor] @param {number} [limit] */
    page: (cursor = null, limit = 50) => read(tx => unfiled.call(placement, tx, scope, { cursor, limit })),
    revision: async () => (await read(tx => placement.catalog(tx, scope, firstPage))).indexRevision,
    /** @param {string} text @param {number} [atMs] @param {readonly Receipt[]} [receipts] */
    async seed(text, atMs = 1, receipts = []) {
      const input = await row(ctx, text);
      const { id, revision } = await write(tx => memories.insert(tx, scope, input, receipts, atMs));
      return { memoryId: id, revision };
    },
    /** @param {Guard} guard @param {string} text */
    async edit({ memoryId, revision }, text) {
      const input = await row(ctx, text);
      const next = await write(tx => memories.replaceContent(tx, scope, memoryId, revision, input, null, 10));
      equal(next.outcome, "changed", "The fixture edit must change the memory revision");
      return { memoryId, revision: next.revision };
    },
    /** @param {Guard} guard */
    forget: ({ memoryId }) => ctx.harness.seedFact(scope.owner, {
      ...scope, actionId: "hosted-unfiled-forget", kind: "identity", origin: "forget", memoryId,
    }),
    /** @param {Guard} guard */
    drop: ({ memoryId }) => write(tx => placement.dropMemory(tx, scope, memoryId)),
    /** @param {Receipt} receipt */
    suppress: ({ client, sessionId }) => {
      const digest = ctx.harness.hashSessionKey?.(client, sessionId);
      if (ctx.sessionRefs === "hashed") check(digest, "Receipt suppression requires the fixture session hash");
      const session = ctx.sessionRefs === "hashed" && digest ? { client, sessionKeyHash: digest } : { client, sessionId };
      return ctx.harness.seedFact(scope.owner, {
        ...scope, actionId: "hosted-unfiled-suppress", kind: "session", origin: "forget", session,
      });
    },
    /** @param {Guard} guard */
    historical: ({ memoryId }) => {
      check(supersession, "Supersession is required for the historical fixture");
      return write(tx => supersession.markHistorical(tx, scope, memoryId, 10));
    },
    /** @param {Guard} guard @param {ErrorCode} [code] */
    fail: ({ memoryId }, code = "invalid_model_output") => write(tx => placement.markFailed(tx, scope, [memoryId], code)),
    /** @param {Guard[]} memoryRevisions @param {PlacementItem[]} [items] */
    apply: (memoryRevisions, items = memoryRevisions.map(({ memoryId }) => ({ memoryId, parentIds: [] }))) =>
      write(async tx => {
        const { indexRevision } = await placement.catalog(tx, scope, firstPage);
        return placement.applyPlacement(tx, scope, { indexRevision, memoryRevisions }, { items });
      }),
  };
}

/** @param {Guard} guard @param {bigint} createdAtUs */
const item = ({ memoryId, revision }, createdAtUs) => ({ id: memoryId, revision, createdAtUs });

/** @param {number} n @param {string} title @param {ConformanceCase["run"]} run @returns {ConformanceCase} */
function hostedCase(n, title, run) {
  return {
    id: `T-TOP-HU-${n}`, title, needs: ["placement", "supersession"],
    async run(ctx) {
      if (!ctx.adapter.placement?.memoryCounts || !ctx.adapter.placement.unfiled) return "hosted topic reads are optional";
      return run(ctx);
    },
  };
}

/** @param {string} token @param {number} revision */
function withRevision(token, revision) {
  const parts = decodeCursor(token);
  check(Array.isArray(parts), "Expected a core cursor tuple");
  parts[2] = revision;
  return encodeCursor(parts);
}

export const TOPIC_HOSTED_UNFILED_CASES = [
  hostedCase(1, "census uses current visible rows and hosted pending rules", async ctx => {
    const store = setup(ctx);
    const foreign = setup(ctx, { owner: ctx.otherOwner, namespace: null });
    const namespaced = setup(ctx, ctx.scope("other-namespace"));
    await foreign.apply([await foreign.seed("Other account")]);
    await namespaced.seed("Same account in another namespace");
    await rejects(() => namespaced.counts(), "capability_unavailable");
    await rejects(() => namespaced.page(), "capability_unavailable");
    equal(await store.counts(), { memoryCount: 0, pending: 0 }, "An empty owner sees no foreign memories");
    equal(await store.page(), { count: 0, items: [], nextCursor: null }, "An empty owner sees no foreign outcomes");

    const filed = await store.seed("Filed in a region");
    const orphan = await store.seed("Filed before the topic was removed", 2);
    const free = await store.seed("Placed outside a region", 3);
    const edited = await store.seed("Earlier classified revision");
    const retry = await store.seed("Recently failed with a nonretryable code");
    const capped = await store.seed("Failure kept at the attempt cap");
    const receipt = evidence("suppressed-unfiled", 1);
    const suppressed = await store.seed("Suppressed by its receipt session", 1, [receipt]);
    const forgotten = await store.seed("Forgotten before topic cleanup");
    const historical = await store.seed("Historical copy");
    const { createdTopics: [topic] } = await store.apply([filed], [{
      memoryId: filed.memoryId, parentIds: [], newL1: { title: "Region", parentL2Ids: [] },
    }]);
    await store.apply([orphan], [{ memoryId: orphan.memoryId, parentIds: [topic.id] }]);
    await store.drop(orphan);
    await store.apply([free, edited, suppressed, forgotten, historical]);
    await store.edit(edited, "New revision has no outcome");
    await store.fail(retry);
    for (let attempt = 0; attempt < 3; attempt++) await store.fail(capped, "storage_busy");
    await store.suppress(receipt);
    await store.forget(forgotten);
    await store.historical(historical);

    equal(await store.counts(), { memoryCount: 6, pending: 2 }, "Only the edit and failure under cap are pending among six visible memories");
    equal(await store.page(), { count: 2, items: [item(free, 3000n), item(orphan, 2000n)], nextCursor: null },
      "A finished outcome without an L1 member qualifies whether it was originally filed or unfiled");
    equal(await foreign.counts(), { memoryCount: 1, pending: 0 }, "Each owner has its own census");
  }),

  hostedCase(2, "unfiled seeks by creation time and id and rejects invalid or clock-stale cursors", async ctx => {
    const store = setup(ctx);
    const foreign = setup(ctx, { owner: ctx.otherOwner, namespace: null });
    const a = await store.seed("First tied creation", 3);
    const b = await store.seed("Second tied creation", 3);
    const older = await store.seed("An older creation", 2);
    await store.apply([a, b, older]);
    const tied = [a, b].sort((x, y) => compareUtf8(y.memoryId, x.memoryId));
    const first = await store.page(null, 1);
    const cursor = first.nextCursor;
    check(cursor, "Expected a next page");
    equal({ count: first.count, items: first.items }, { count: 3, items: [item(tied[0], 3000n)] }, "Larger id wins the creation time tie");
    const second = await store.page(cursor, 1);
    check(second.nextCursor, "Expected a final page");
    equal({ count: second.count, items: second.items }, { count: 3, items: [item(tied[1], 3000n)] }, "Seek resumes at the other tied id");
    equal(await store.page(second.nextCursor, 1), { count: 3, items: [item(older, 2000n)], nextCursor: null }, "Final page retains the full count");
    equal(await store.page(cursor, 50), { count: 3, items: [item(tied[1], 3000n), item(older, 2000n)], nextCursor: null },
      "Resuming with a larger limit does not alter the seek");

    const parts = decodeCursor(cursor);
    check(Array.isArray(parts), "Expected a core cursor tuple");
    await rejects(() => store.page("bad cursor"), "invalid_cursor");
    await rejects(() => store.page(encodeCursor(["catalog", ...parts.slice(1)])), "invalid_cursor");
    await rejects(() => foreign.page(cursor), "invalid_cursor");
    for (const limit of [0, 51, 1.5]) await rejects(() => store.page(null, limit), "invalid_input");
    await store.seed("Unrelated pending memory");
    await rejects(() => store.page(cursor), "cursor_stale");
    equal((await store.page()).count, 3, "The unrelated write did not alter the unfiled set");
  }),

  hostedCase(3, "set digest detects terminal retry, forget and an edited revision", async ctx => {
    const store = setup(ctx);
    const older = await store.seed("The ferry leaves at noon", 1);
    const middle = await store.seed("Marzipan needs orange blossom water", 2);
    const newer = await store.seed("Heliometer alignment starts at the objective lens", 3);
    await store.apply([older, middle]);
    await store.fail(newer, "storage_busy");
    await store.fail(newer, "storage_busy");
    const before = await store.page(null, 1);
    check(before.nextCursor, "Expected a cursor before the terminal retry");
    equal([before.count, before.items], [2, [item(middle, 2000n)]], "Two failures leave the newest memory pending");
    const revision = await store.revision();
    // Reproduce the hosted terminal write with the core finished-outcome operation.
    await store.fail(newer, "storage_busy");
    await store.apply([newer]);
    equal(await store.revision(), revision, "Terminal outcome without memberships must preserve the topic revision");
    await rejects(() => store.page(before.nextCursor, 1), "cursor_stale");
    equal(await store.page(), { count: 3, items: [item(newer, 3000n), item(middle, 2000n), item(older, 1000n)], nextCursor: null },
      "The terminal outcome adds the newest memory to a fresh traversal");

    const beforeForget = await store.page(null, 1);
    check(beforeForget.nextCursor, "Expected a cursor before forgetting");
    await store.forget(older);
    // First-party fact and memory writes advance the owner clock. Carry it forward to
    // isolate the old digest from the independent revision check.
    const sameClockForget = withRevision(beforeForget.nextCursor, await store.revision());
    await rejects(() => store.page(sameClockForget, 1), "cursor_stale");
    equal((await store.page()).count, 2, "The forgotten outcome left the full set");

    const beforeEdit = await store.page(null, 1);
    check(beforeEdit.nextCursor, "Expected a cursor before editing");
    const edited = await store.edit(middle, "Marzipan needs orange blossom water and almonds");
    await store.apply([edited]);
    const sameClockEdit = withRevision(beforeEdit.nextCursor, await store.revision());
    await rejects(() => store.page(sameClockEdit, 1), "cursor_stale");
    equal(await store.page(), { count: 2, items: [item(newer, 3000n), item(edited, 2000n)], nextCursor: null },
      "The same ids and count can contain a different memory revision");
  }),
];
