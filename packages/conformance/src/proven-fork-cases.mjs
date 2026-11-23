import { coreDigest, factIncarnationBody } from "@cairn-ink/core";
import { caught, check, equal, readDump, rejects } from "./support.mjs";

/** @import { CaptureKey, CaptureMessage, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

/** @type {CaptureMessage} */
const anchor = { id: "anchor", role: "user", content: "cedar marker", occurredAtMs: 10 };
/** @type {CaptureMessage} */
const turn = { id: "new-turn", role: "assistant", content: "maple grove", occurredAtMs: 20 };
const messages = [anchor, turn];

/** @param {CaseContext} ctx */
function fixture(ctx) {
  const { capture, raw, suppressions, uow } = ctx.adapter;
  check(raw, "rawArchive requires the raw port");
  /** @type {CaptureKey} */
  const root = { scope: ctx.scope(null), client: "test-client", sessionId: "test-session",
    eventId: "test-event", payloadDigest: "a".repeat(64) };
  const fork = { ...root, sessionId: "fork", eventId: "fork-event" };
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const write = (fn) => uow.run(ctx.owner, { pauseLock: true }, fn);
  /** @param {CaptureKey} key @param {readonly CaptureMessage[]} items */
  const eligible = (key, items) => uow.run(key.scope.owner, { readOnly: true }, (tx) => capture.eligible(tx, key, items));
  return {
    raw, capture, suppressions, root, fork, write, eligible,
    record: (items = [anchor], key = root) => write((tx) => raw.recordLineage(tx, key, items)),
    fence: (key = root) => write((tx) => raw.fenceSession(tx, key.scope, key)),
  };
}

/** @type {readonly ConformanceCase[]} */
export const PROVEN_FORK_CASES = [
  {
    id: "K-FORK-1", title: "one matching proof blocks every position of a fresh fork", needs: ["rawArchive"],
    async run(ctx) {
      const { record, fence, eligible, fork } = fixture(ctx);
      await record();
      equal(await eligible(fork, messages), [0, 1], "An unfenced anchor must leave another session eligible");
      await fence();
      equal(await eligible(fork, messages), [], "A proven fork must block the matching message and every new turn");
    },
  },
  {
    id: "K-FORK-2", title: "a reused ID with edited content leaves the session eligible", needs: ["rawArchive"],
    async run(ctx) {
      const { record, fence, eligible, fork } = fixture(ctx);
      await record();
      await fence();
      const edited = { ...anchor, content: "Cedar marker" };
      equal(await eligible(fork, [edited, turn]), [0, 1], "Different content must leave a reused ID eligible");
    },
  },
  {
    id: "K-FORK-3", title: "a scrubbed anchor proves a fork by ID alone", needs: ["rawArchive"],
    async run(ctx) {
      const { record, fence, eligible, fork } = fixture(ctx);
      await record([{ ...anchor, content: "" }]);
      await fence();
      equal(await eligible(fork, [turn]), [0], "A different ID must remain eligible");
      equal(await eligible(fork, messages), [], "A scrubbed anchor must prove a fork by ID alone");
    },
  },
  {
    id: "K-FORK-4", title: "anchors apply only to the same client and owner", needs: ["rawArchive"],
    async run(ctx) {
      const { record, fence, eligible, fork } = fixture(ctx);
      await record();
      await fence();
      equal(await eligible({ ...fork, client: "other-client" }, messages), [0, 1],
        "Another client must remain eligible");
      equal(await eligible({ ...fork, scope: { ...fork.scope, owner: ctx.otherOwner } }, messages), [0, 1],
        "Another owner must remain eligible");
    },
  },
  {
    id: "K-FORK-5", title: "a direct fence blocks a session even without a matching ID", needs: ["rawArchive"],
    async run(ctx) {
      const { capture, fence, eligible, write, root } = fixture(ctx);
      const claim = await write((tx) => capture.claim(tx, root, [turn], { leaseMs: 60_000 }));
      equal(claim.status, "claimed", "Fixture must acquire a live claim");
      await fence();
      equal(await eligible(root, [turn]), [], "Directly fenced session must be ineligible");
      await rejects(() => write((tx) => capture.assertEligible(tx, root, [0])), "lineage_fenced");
    },
  },
  {
    id: "K-FORK-6", title: "the write re-check tests the whole claimed batch against a new fence", needs: ["rawArchive"],
    async run(ctx) {
      const { raw, capture, record, eligible, write, root, fork } = fixture(ctx);
      await record();
      const claim = await write((tx) => capture.claim(tx, fork, messages, { leaseMs: 60_000 }));
      equal(claim.status, "claimed", "Fixture must acquire a live claim");
      equal(await eligible(fork, messages), [0, 1], "The entire batch must be eligible before the fence");
      await write((tx) => capture.assertEligible(tx, fork, [1]));
      const before = await readDump(ctx.harness);
      await rejects(() => write(async (tx) => {
        await raw.fenceSession(tx, root.scope, root);
        await capture.assertEligible(tx, fork, [1]);
      }), "lineage_fenced");
      equal(await readDump(ctx.harness), before, "A failing re-check must roll back writes from the run");
      await write((tx) => raw.fenceSession(tx, root.scope, root));
      equal(await eligible(fork, messages), [], "Preflight must see the committed fence");
      await rejects(() => write((tx) => capture.assertEligible(tx, fork, [1])), "lineage_fenced");
    },
  },
  {
    id: "K-FORK-7", title: "distinct proofs survive content purge and conversation deletion", needs: ["rawArchive"],
    async run(ctx) {
      const { raw, suppressions, record, fence, eligible, write, root, fork } = fixture(ctx);
      const edited = { ...anchor, content: "willow marker" };
      await record();
      await record([edited, turn]);
      equal(await write((tx) => raw.archive(tx, root, messages)), { archived: 2 }, "Fixture must archive both messages");
      await fence();
      const fact = { kind: /** @type {const} */ ("text"), mode: /** @type {const} */ ("exact"),
        origin: /** @type {const} */ ("forget"), owner: ctx.owner, actionId: "purge-text",
        text: { digests: [await coreDigest(anchor.content)] } };
      const incarnation = (await ctx.hash(factIncarnationBody(fact))).slice(7);
      await write(async (tx) => {
        const stored = await suppressions.writeFact(tx, fact, incarnation);
        equal((await raw.purgeWithheld(tx, root.scope, [{ ...stored, fact, incarnation }])).rawDeleted, 1,
          "Fixture must physically purge the matching row");
        equal(await raw.deleteConversation(tx, root.scope, root), { rawDeleted: 1 },
          "Fixture must delete the remaining row");
      });
      equal(await eligible(fork, [anchor]), [], "The first proof must survive purge and deletion");
      equal(await eligible(fork, [edited]), [], "The later proof for the same ID must also survive");
      equal(await eligible(fork, [turn]), [], "The deleted row must still have a proof");
    },
  },
  {
    id: "K-FORK-8", title: "session facts fence anchors in their recorded namespace", needs: ["rawArchive"],
    async run(ctx) {
      const { root, fork, record, eligible } = fixture(ctx);
      const scoped = { ...root, scope: ctx.scope("project") };
      const { client, sessionId } = scoped;
      await record([anchor], scoped);
      const fact = { ...scoped.scope, kind: /** @type {const} */ ("session"),
        origin: /** @type {const} */ ("forget"), actionId: "forget-session" };
      if (ctx.sessionRefs === "hashed") {
        const sessionKeyHash = ctx.harness.hashSessionKey?.(client, sessionId);
        check(typeof sessionKeyHash === "string" && /^[a-f0-9]{64}$/u.test(sessionKeyHash),
          "Hashed sessions require harness.hashSessionKey");
        await ctx.harness.seedFact(ctx.owner, { ...fact, session: { client, sessionKeyHash } });
      } else {
        await ctx.harness.seedFact(ctx.owner, { ...fact, session: { client, sessionId } });
      }
      equal(await eligible(fork, messages), [], "A forgotten anchor must prove a fork across namespaces");
    },
  },
  {
    id: "K-FORK-9", title: "recorded proofs are opaque and rolled-back anchors cannot prove a fork", needs: ["rawArchive"],
    async run(ctx) {
      const { raw, root, fork, record, fence, write, eligible } = fixture(ctx);
      const before = await readDump(ctx.harness);
      const abort = new Error("Abort lineage fixture");
      const error = await caught(() => write(async (tx) => {
        await raw.recordLineage(tx, root, [anchor]);
        throw abort;
      }));
      check(error === abort, "The lineage run must reject with the fixture error");
      equal(await readDump(ctx.harness), before, "Rolled-back anchors must leave the committed state unchanged");
      await fence();
      equal(await eligible(fork, messages), [0, 1], "A rolled-back anchor must never prove a fork");
      const other = { ...root, sessionId: "unfenced", eventId: "unfenced-event" };
      const beforeRecord = await readDump(ctx.harness);
      await record([anchor], other);
      const committed = await readDump(ctx.harness);
      check(JSON.stringify(committed) !== JSON.stringify(beforeRecord), "Committed anchors must be visible in the dump");
      check(!JSON.stringify(committed).includes(anchor.content), "The anchor dump must omit plaintext");
      await write(async (tx) => {
        const { items } = await raw.listRaw(tx, { owner: ctx.owner, namespaces: [root.scope.namespace] },
          { limit: 10, cursor: null });
        equal(items, [], "Lineage alone must never write raw rows");
      });
    },
  },
];
