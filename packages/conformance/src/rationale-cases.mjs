import { coreDigest, decisionContext, relatePlaced } from "@cairn-ink/core";
import { check, equal, evidence, receiptAttachAdvancesRevision, rejects, row } from "./support.mjs";

/** @import { ModelPort, RationaleGuard, RationaleRelation, Receipt, Scope, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @import { RationaleFixtureChange } from "./factory.d.ts" */

const page = { limit: 11 };
const support = "supports-decision";
const challenge = "challenges-premise";
const gate = { async assertOpen() {} };

/** @param {number} from @param {number} to @param {RationaleRelation} [relation] */
const edge = (from, to, relation = support) => ({ from, to, relation, fromReceipt: 0, toReceipt: 0 });

/** @param {CaseContext} ctx @param {Scope} [scope] */
function fixture(ctx, scope = ctx.scope(null)) {
  const { adapter, harness } = ctx;
  const { uow, memories, rationale, raw } = adapter;
  const { changeRationaleMemory } = harness;
  check(rationale && (raw || harness.seedRationaleMessage), "rationale port and source message fixtures are required");
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const read = fn => uow.run(scope.owner, { readOnly: true }, fn);
  /** @template T @param {(tx: Tx) => Promise<T>} fn */
  const write = fn => uow.run(scope.owner, { pauseLock: true }, fn);
  const options = { uow, scope, store: rationale, retrieval: adapter };
  /** @param {Scope} target @param {Receipt} receipt @param {string | null} text */
  async function seedRationaleMessage(target, receipt, text) {
    if (!raw) {
      check(harness.seedRationaleMessage, "adapter needs synthetic sources when Raw is unavailable");
      return harness.seedRationaleMessage(target, receipt, text);
    }
    const { client, sessionId, messageId, role, occurredAtMs } = receipt;
    // Each synthetic source has its own conversation and can be retired independently.
    if (text === null) {
      const result = await write(tx => raw.deleteConversation(tx, target, { client, sessionId }));
      equal(result.rawDeleted, 1, "Retire the archived source");
      return;
    }
    const capture = { scope: target, client, sessionId, eventId: crypto.randomUUID(), payloadDigest: "a".repeat(64) };
    const result = await write(tx => raw.archive(tx, capture, [{ id: messageId, role, occurredAtMs, content: text }]));
    equal(result.archived, 1, "Archive the source message");
  }
  return {
    rationale, scope, read, write, seedRationaleMessage,
    /** @param {string} name @param {string} [text] */
    async seed(name, text = "Synthetic raw source " + name) {
      const receipt = { ...evidence(name, 11), client: "fixture-" + name, sessionId: "fixture-" + name };
      await seedRationaleMessage(scope, receipt, text);
      const next = await row(ctx, "Filed memory " + name);
      const { id, revision } = await write(tx => memories.insert(tx, scope, next, [receipt], 10));
      return { memoryId: id, revision, receipt };
    },
    /** @param {readonly RationaleGuard[]} refs @param {ReturnType<typeof edge>[]} edges @param {ModelPort["call"]} [call] */
    review(refs, edges, call = async () => ({ edges })) {
      return relatePlaced({ ...options, refs: refs.map(({ memoryId, revision }) => ({ memoryId, revision })), gate,
        model: { model: "fixture", contextWindow: 8192, countTokens: () => 1, call } });
    },
    /** @param {RationaleGuard} ref */
    context: ({ memoryId, revision }) => decisionContext({ ...options, memoryId, revision }),
    /** @param {RationaleGuard} ref */
    incident: ({ memoryId }) => read(tx => rationale.incident(tx, scope, memoryId, page)),
    /** @param {RationaleGuard} ref */
    degree: ({ memoryId }) => read(tx => rationale.degree(tx, scope, memoryId)),
    /** @param {RationaleGuard} ref */
    erase: ({ memoryId }) => write(tx => memories.erase(tx, scope, memoryId)),
    /** @param {RationaleGuard} ref @param {readonly Receipt[]} receipts @param {number} [confidence] */
    touch: ({ memoryId }, receipts, confidence = 0.4) =>
      write(tx => memories.touchDuplicate(tx, scope, memoryId, receipts, { confidence }, 12)),
    /** @param {RationaleGuard} ref @param {RationaleFixtureChange} mutation */
    change({ memoryId }, mutation) {
      check(changeRationaleMemory, "adapter needs a fixture for otherwise unsupported invalidating writes");
      return changeRationaleMemory(scope, memoryId, mutation);
    },
  };
}

/** @param {string} id @param {string} title @param {ConformanceCase["run"]} run
 * @param {boolean} [rawArchive] @returns {ConformanceCase}
 */
const rationaleCase = (id, title, run, rawArchive = true) =>
  ({ id: "T-RAT-" + id, title, needs: ["rationaleEdges"], requests: { rawArchive }, run });

const invalidationCases = [
  rationaleCase("revision", "a revision-only write deletes incident edges", async ctx => {
    await invalidates(ctx, (f, source) => f.change(source, "revision"));
  }),
  rationaleCase("content", "a content-only write deletes incident edges", async ctx => {
    await invalidates(ctx, (f, source) => f.change(source, "content"));
  }),
  rationaleCase("correct", "replacing content deletes incident edges", async ctx => {
    await invalidates(ctx, async (f, source) => {
      const next = await row(ctx, "Replacement memory");
      const result = await f.write(tx => ctx.adapter.memories.replaceContent(
        tx, f.scope, source.memoryId, source.revision, next, null, 12));
      equal(result.outcome, "changed", "Content replacement commits");
    });
  }),
  rationaleCase("currentness", "superseding a memory deletes incident edges", async ctx => {
    await invalidates(ctx, (f, source) => f.change(source, "currentness"));
  }),
  rationaleCase("namespace", "moving a memory deletes its old namespace edges", async ctx => {
    await invalidates(ctx, (f, source) => f.change(source, "namespace"));
  }),
  rationaleCase("forget", "erasure deletes incident edges", async ctx => {
    await invalidates(ctx, async (f, source) => check(await f.erase(source), "Memory must be erased"));
  }),
  rationaleCase("receipt-add", "adding a receipt deletes incident edges", async ctx => {
    // With receiptAttachAdvancesRevision, a newly attached receipt advances the revision once (PHASE0 addendum 18).
    const advances = receiptAttachAdvancesRevision(ctx);
    await invalidates(ctx, async (f, source) => {
      equal((await f.touch(source, [evidence("conformance-extra", 12)])).revision,
        advances ? source.revision + 1 : source.revision, advances ? "A new receipt advances the revision once"
          : "Guard stays current");
    });
  }),
  rationaleCase("receipt-remove", "removing a receipt deletes incident edges", async ctx => {
    await invalidates(ctx, (f, source) => f.change(source, "receipt-remove"));
  }),
  rationaleCase("receipt-update", "updating a receipt's source text deletes incident edges", async ctx => {
    await invalidates(ctx, (f, source) => f.seedRationaleMessage(f.scope, source.receipt, "Updated raw text"));
  }, false), // Raw keeps the first content for a message identity.
  rationaleCase("duplicate", "reattaching an identical receipt deletes incident edges at the same revision", async ctx => {
    await invalidates(ctx, async (f, source) => {
      equal((await f.touch(source, [source.receipt])).revision, source.revision, "Guard stays current");
    });
  }),
];

/**
 * @param {CaseContext} ctx
 * @param {(f: ReturnType<typeof fixture>, source: Awaited<ReturnType<ReturnType<typeof fixture>["seed"]>>) => Promise<void>} change
 */
async function invalidates(ctx, change) {
  const f = fixture(ctx);
  const root = await f.seed("decision");
  const source = await f.seed("support");
  const result = await f.review([root, source], [edge(1, 0)]);
  check(result.status === "reviewed" && result.inserted === 1, "Fixture edge must commit");
  equal((await f.incident(root)).length, 1, "Rationale is present before the write");
  await change(f, source);
  equal(await f.incident(root), [], "Invalidating write must delete stored incident rows");
  equal(await f.degree(source), 0, "Invalidating write must remove the endpoint degree");
}

const indexCase = rationaleCase("index", "the owner index advances once per nonempty insert batch", async ctx => {
  const { placement } = ctx.adapter;
  check(placement, "placement catalog is the numeric owner index witness");
  const f = fixture(ctx);
  const root = await f.seed("index-root");
  const source = await f.seed("index-source");
  const index = async () => (await f.read(tx => placement.catalog(tx, f.scope, { cursor: null, limit: 1 }))).indexRevision;
  const before = await index();
  const refs = [root, source];
  const edges = [edge(0, 0), edge(1, 0, challenge)];
  equal((await f.review(refs, edges)).inserted, 2, "Both new edges commit");
  equal(await index(), before + 1, "One owner index revision for the batch");
  equal((await f.review(refs, edges)).inserted, 0, "Duplicate batch writes no edges");
  equal((await f.review(refs, [])).inserted, 0, "Empty proposal writes no edges");
  equal(await index(), before + 1, "No index advance for a duplicate or empty proposal");
});
indexCase.needs.push("placement");

const rawDeletedCase = rationaleCase("raw-deleted", "deleting cited Raw hides only its path and prevents dispatch", async ctx => {
  const { raw, memories } = ctx.adapter;
  check(raw, "rawArchive requires the raw ports");
  const f = fixture(ctx);
  const root = await f.seed("deletion-root");
  const retained = await f.seed("retained");
  const removed = await f.seed("removed");
  const child = await f.seed("removed-challenge");
  const result = await f.review([root, retained, removed, child], [edge(1, 0), edge(2, 0), edge(3, 2, challenge)]);
  check(result.status === "reviewed" && result.inserted === 3, "Both paths must commit before Raw deletion");
  const before = await f.context(root);
  equal(before.status, "reconfirmation-suggested", "The removed path initially has a challenge");
  equal(before.refs.length, 3, "Both paths are visible before Raw deletion");

  const deletion = await f.write(tx => raw.deleteConversation(tx, f.scope, removed.receipt));
  equal(deletion.rawDeleted, 1, "Delete the cited Raw message");
  equal((await f.read(tx => memories.readRevision(tx, f.scope, removed.memoryId)))?.revision, removed.revision,
    "The cited memory stays at the same revision");
  equal(await f.context(root), { status: "unassessed", refs: [{
    id: retained.memoryId, revision: retained.revision, relation: support, direction: "incoming",
  }] }, "Only the path with archived Raw remains");
  await rejects(() => f.read(tx => f.rationale.sourceEvidence(tx, f.scope, [root, removed])), "revision_conflict");
  let calls = 0;
  const after = await f.review([root, removed], [], async () => { calls++; return { edges: [] }; });
  check(after.status === "failed" && after.error.code === "revision_conflict", "Deleted Raw must fail closed");
  equal(calls, 0, "No provider call with deleted Raw");
});
rawDeletedCase.needs.push("rawArchive");

/** @type {readonly ConformanceCase[]} */
export const RATIONALE_CASES = [
  rationaleCase("insert", "directed receipt-anchored edges are idempotent", async ctx => {
    const f = fixture(ctx);
    const root = await f.seed("root");
    const source = await f.seed("source");
    const result = await f.review([root, source], [edge(0, 0), edge(1, 0, challenge)]);
    check(result.status === "reviewed" && result.inserted === 2, "Both edges must commit");
    const rows = await f.incident(root);
    equal(rows.length, 2, "Stored edge count");
    equal(await f.degree(root), 2, "A self-edge counts once");
    const sources = await f.read(tx => f.rationale.sourceEvidence(tx, f.scope, [root, source]));
    for (const { from, to } of rows) {
      for (const anchor of [from, to]) {
        const receipt = sources.find(({ memory }) => memory.id === anchor.id)?.receipts[0];
        check(receipt, "Cited receipt exists");
        equal(anchor.receiptId, receipt.id, "Stable receipt anchor");
        equal(anchor.digest, (await ctx.hash(JSON.stringify(receipt))).slice(7), "Exact receipt digest");
      }
    }
    equal((await f.review([root, source], [edge(0, 0), edge(1, 0, challenge)])).inserted, 0, "Repeated tuple inserts nothing");
    equal(await f.incident(root), rows, "Repeated proposal leaves existing rows intact");
  }),
  rationaleCase("degree", "the eleventh incident edge rolls back the whole proposal", async ctx => {
    const f = fixture(ctx);
    const root = await f.seed("degree-root");
    for (let i = 0; i < 10; i++) {
      const source = await f.seed("degree-" + i);
      equal((await f.review([root, source], [edge(1, 0)])).inserted, 1, "Fill the degree bound");
    }
    const first = await f.seed("overflow-first");
    const last = await f.seed("overflow-last");
    const result = await f.review([root, first, last], [edge(2, 1), edge(1, 0)]);
    check(result.status === "failed" && result.error.code === "rationale_limit", "Degree overflow must fail");
    equal(await f.degree(root), 10, "Initial edges survive");
    equal(await f.incident(first), [], "Earlier independent insert rolls back");
    equal(await f.incident(last), [], "No half-committed edge");
  }),
  ...invalidationCases,
  rationaleCase("stale", "a stored stale digest or revision cannot surface", async ctx => {
    const f = fixture(ctx);
    const root = await f.seed("stale-root");
    const source = await f.seed("stale-source");
    equal((await f.review([root, source], [edge(1, 0)])).inserted, 1, "Initial edge");
    const [current] = await f.incident(root);
    const args = { uow: ctx.adapter.uow, retrieval: ctx.adapter, scope: f.scope,
      memoryId: root.memoryId, revision: root.revision };
    for (const anchor of [{ ...current.from, revision: current.from.revision + 1 },
      { ...current.from, digest: "0".repeat(64) }]) {
      const store = { ...f.rationale, async incoming(/** @type {Tx} */ tx, /** @type {Scope} */ scope,
        /** @type {string} */ id, /** @type {RationaleRelation} */ relation, /** @type {{limit: number}} */ options) {
        return (await f.rationale.incoming(tx, scope, id, relation, options)).map(row => ({ ...row, from: anchor }));
      } };
      await rejects(() => decisionContext({ ...args, store }), "revision_conflict");
    }
    equal((await f.context(root)).refs.length, 1, "Current edge remains available");
  }),
  rationaleCase("hidden", "a hidden endpoint removes only its own path and exposes only refs", async ctx => {
    const f = fixture(ctx);
    const root = await f.seed("hidden-root");
    const visible = await f.seed("visible");
    const hidden = await f.seed("hidden");
    const child = await f.seed("hidden-challenge");
    equal((await f.review([root, visible, hidden, child], [edge(1, 0), edge(2, 0), edge(3, 2, challenge)])).inserted,
      3, "Both premises and the challenge are stored");
    await ctx.harness.seedFact(f.scope.owner, {
      ...f.scope, kind: "identity", origin: "forget", actionId: "fixture-hidden", memoryId: hidden.memoryId,
    });
    equal(await f.context(root), { status: "unassessed", refs: [{
      id: visible.memoryId, revision: visible.revision, relation: support, direction: "incoming",
    }] }, "Only the visible premise remains and hidden receipt text never appears");
    equal((await f.incident(root)).length, 2, "Visibility filtering need not delete the stored edges");
  }),
  rationaleCase("receipt-private", "withheld or retired raw source text is never read or sent", async ctx => {
    const f = fixture(ctx);
    const root = await f.seed("raw-root", "An ordinary raw source.");
    const hidden = await f.seed("raw-hidden", "A message with a forgotten excerpt.");
    const sessionHidden = await f.seed("fenced");
    const windowHidden = await f.seed("windowed");
    const retired = await f.seed("retired");
    const { owner, namespace } = f.scope;
    await ctx.harness.seedFact(owner, { owner, namespace, kind: "text", mode: "exact", origin: "forget",
      actionId: "fixture-text", text: { digests: [await coreDigest("A message with a forgotten excerpt.")],
        shingles: null, keyId: null } });
    for (const source of [hidden, sessionHidden, windowHidden, retired]) {
      if (source === sessionHidden) {
        const { client, sessionId } = source.receipt;
        const sessionKeyHash = ctx.harness.hashSessionKey?.(client, sessionId);
        if (ctx.sessionRefs === "hashed") check(sessionKeyHash, "Hashed session fixture needs its key mapper");
        await ctx.harness.seedFact(owner, { owner, namespace, kind: "session", origin: "forget",
          actionId: "fixture-session", session: sessionKeyHash ? { client, sessionKeyHash } : { client, sessionId } });
      } else if (source === windowHidden) {
        await ctx.harness.seedFact(owner, { owner, namespace, kind: "window", origin: "forget",
          actionId: "fixture-window", client: source.receipt.client, window: { startMs: 10, endMs: 12 } });
      } else if (source === retired) await f.seedRationaleMessage(f.scope, retired.receipt, null);
      await rejects(() => f.read(tx => f.rationale.sourceEvidence(tx, f.scope, [source, root])), "revision_conflict");
      let calls = 0;
      const result = await f.review([source, root], [], async () => { calls++; return { edges: [] }; });
      check(result.status === "failed" && result.error.code === "revision_conflict", "Missing source must fail closed");
      equal(calls, 0, "No provider call with unsafe source text");
    }
  }),
  rationaleCase("scope", "rationale reads and invalidation isolate owners and namespaces", async ctx => {
    const f = fixture(ctx);
    const root = await f.seed("scope-root");
    const source = await f.seed("scope-source");
    equal((await f.review([root, source], [edge(1, 0)])).inserted, 1, "Fixture edge");
    const [stored] = await f.incident(root);
    for (const scope of [ctx.scope("other-namespace"), { owner: ctx.otherOwner, namespace: null }]) {
      const other = fixture(ctx, scope);
      equal(await other.incident(root), [], "Foreign scope has no rows");
      equal(await other.degree(root), 0, "Foreign scope has no degree");
      await rejects(() => other.read(tx => other.rationale.sourceEvidence(tx, scope, [root])), "memory_not_found");
      await rejects(() => other.write(tx => other.rationale.insert(tx, scope, stored)), "memory_not_found");
      equal(await other.write(tx => other.rationale.invalidate(tx, scope, root.memoryId)), { deleted: 0 },
        "Foreign invalidation cannot delete this owner's edge");
    }
    equal(await f.incident(root), [stored], "Original scope keeps its edge");
  }),
  rawDeletedCase,
  indexCase,
];
