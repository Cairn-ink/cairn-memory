import { decideWrite, PRIVACY_REDACTION_VERSIONS } from "@cairn-ink/core";
import { check, equal, evidence, row, source } from "./support.mjs";

/** @import { TextDigest, TextFact } from "@cairn-ink/core" */
/** @import { InsertRow, ItemRef, Receipt, SourceRef } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const client = "test-client";
const sessionId = "test-session";
const otherSession = "other-session";
const otherClient = "other-client";
/** @type {SourceRef} */
const captureSource = { kind: "capture", client, sessionId };

/** @param {CaseContext} ctx @param {string} actionId */
function factBase({ owner }, actionId) {
  return { owner, actionId, origin: /** @type {const} */ ("forget") };
}

/** @param {CaseContext} ctx @param {string} text @param {TextDigest["pipeline"]} [pipeline] @returns {Promise<TextDigest>} */
async function digest(ctx, text, pipeline = "core") {
  const redactionVersion = pipeline === "core" ? PRIVACY_REDACTION_VERSIONS.core : PRIVACY_REDACTION_VERSIONS.v1;
  return { alg: "sha256", value: (await ctx.hash(text)).slice(7), pipeline, redactionVersion, keyId: null };
}

/** @param {CaseContext} ctx @param {string} actionId @param {TextFact["mode"]} mode @param {TextFact["text"]} text */
function seedText(ctx, actionId, mode, text) {
  return ctx.harness.seedFact(ctx.owner, { ...factBase(ctx, actionId), kind: "text", mode, text });
}

/** @param {CaseContext} ctx */
async function seedSession(ctx) {
  const hashSessionKey = ctx.harness.hashSessionKey;
  if (ctx.sessionRefs === "hashed") {
    check(typeof hashSessionKey === "function", "Hashed profile requires harness.hashSessionKey");
    const sessionKeyHash = hashSessionKey(client, sessionId);
    check(typeof sessionKeyHash === "string" && /^[0-9a-f]{64}$/u.test(sessionKeyHash),
      "Harness must return a session hash for the fixture");
    await ctx.harness.seedFact(ctx.owner, {
      ...factBase(ctx, "session"), kind: "session", session: { client, sessionKeyHash },
    });
  } else {
    await ctx.harness.seedFact(ctx.owner, {
      ...factBase(ctx, "session"), kind: "session", session: { client, sessionId },
    });
  }
}

/** @param {CaseContext} ctx @param {string} text @param {number} [distance] */
function fixtureRow(ctx, text, distance = 1) {
  // Only the vector suppression follow-up needs rows near the fact vector at distance zero.
  return row(ctx, text, distance);
}

/** @param {CaseContext} ctx @param {InsertRow} content @param {readonly Receipt[]} [receipts] */
function insert(ctx, content, receipts = []) {
  const { uow, memories } = ctx.adapter;
  return uow.run(ctx.owner, {}, (tx) => memories.insert(tx, ctx.scope(null), content, receipts, 1));
}

/** @param {CaseContext} ctx @param {string} id @param {boolean} visible @param {string} message
 * @param {"read" | "recall"} [intent]
 */
async function expectVisible(ctx, id, visible, message, intent = "read") {
  const { uow, fence, hydrate, memories } = ctx.adapter;
  const scope = ctx.scope(null);
  const readSet = { owner: ctx.owner, namespaces: [scope.namespace] };
  const ref = /** @type {ItemRef} */ ({ type: "memory", id, namespace: scope.namespace });
  await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
    const expected = visible ? [id] : [];
    equal((await fence.assertVisible(tx, readSet, [ref])).map((item) => item.id), expected, message + " (fence)");
    equal((await hydrate.hydrate(tx, readSet, [ref], intent)).map(({ ref }) => ref.id), expected, message + " (hydrate)");
    const { items } = await memories.exportPage(tx, scope, { cursor: null, limit: 10 });
    equal(items.some((item) => item.id === id), visible, message + " (export)");
  });
}

/** @param {CaseContext} ctx */
async function receiptRows(ctx) {
  const matching = { ...evidence("matching", 10), client, sessionId };
  const differentSession = { ...matching, sessionId: otherSession };
  const differentClient = { ...matching, client: otherClient };
  const matched = await insert(ctx, await fixtureRow(ctx, "memory with matching receipt"), [matching]);
  const empty = await insert(ctx, await fixtureRow(ctx, "MCP memory"));
  const sameClient = await insert(ctx, await fixtureRow(ctx, "memory from another session"), [differentSession]);
  const sameSession = await insert(ctx, await fixtureRow(ctx, "memory from another client"), [differentClient]);
  const sourceOnly = await insert(ctx, { ...await fixtureRow(ctx, "memory with matching source only"), source: captureSource },
    [differentSession]);
  const several = await insert(ctx, await fixtureRow(ctx, "memory with several receipts"),
    [differentSession, matching, differentClient]);
  await seedSession(ctx);

  return /** @type {const} */ ([
    [matched.id, false, "Matching receipt must hide the row"],
    [empty.id, true, "Receipt-less MCP row must stay visible"],
    [sameClient.id, true, "Another session must stay visible"],
    [sameSession.id, true, "Another client must stay visible"],
    [sourceOnly.id, true, "Matching row source cannot substitute for a receipt"],
    [several.id, false, "One matching receipt must hide a row with several receipts"],
  ]);
}

/** @type {readonly ConformanceCase[]} */
export const PRIVACY_MATCH_CASES = [
  {
    id: "K-HIDE-1", title: "hides identities up to the fenced revision", needs: [],
    async run(ctx) {
      const { uow, memories } = ctx.adapter;
      const scope = ctx.scope(null);
      const permanent = await insert(ctx, await fixtureRow(ctx, "permanent identity"));
      const corrected = await insert(ctx, await fixtureRow(ctx, "original wording"));
      const untouched = await insert(ctx, await fixtureRow(ctx, "untouched identity"));
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "forget"), kind: "identity", memoryId: permanent.id,
      });
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "correct"), origin: "correct", kind: "identity", memoryId: corrected.id,
        throughRevision: corrected.revision + 1,
      });

      await expectVisible(ctx, permanent.id, false, "Identity must hide its row");
      await expectVisible(ctx, untouched.id, true, "Identity must leave another ID visible");
      await expectVisible(ctx, corrected.id, false, "Identity must hide revisions below its limit");
      const equalRevision = await fixtureRow(ctx, "first correction");
      const first = await uow.run(ctx.owner, {}, (tx) =>
        memories.replaceContent(tx, scope, corrected.id, corrected.revision, equalRevision, null, 2));
      equal(first.revision, corrected.revision + 1, "First correction must reach the fenced revision");
      await expectVisible(ctx, corrected.id, false, "Identity must hide the revision at its limit");
      const laterRevision = await fixtureRow(ctx, "second correction");
      await uow.run(ctx.owner, {}, (tx) =>
        memories.replaceContent(tx, scope, corrected.id, first.revision, laterRevision, null, 3));
      await expectVisible(ctx, corrected.id, true, "Correction above the fenced revision must be visible");
    },
  },
  {
    id: "K-HIDE-2", title: "uses exact aliases and fails closed on incomparable text", needs: [],
    async run(ctx) {
      const primary = await insert(ctx, await fixtureRow(ctx, "primary digest"));
      const alias = await insert(ctx, await fixtureRow(ctx, "alias digest"));
      const unrelated = await insert(ctx, await fixtureRow(ctx, "unrelated passage"));

      await seedText(ctx, "exact", "exact", {
        digests: [await digest(ctx, "primary digest"), await digest(ctx, "alias digest", "engine-legacy")],
      });
      await expectVisible(ctx, primary.id, false, "Exact digest must hide the row");
      await expectVisible(ctx, alias.id, false, "Exact alias must hide the row");
      await expectVisible(ctx, unrelated.id, true, "Comparable digest miss must keep the row visible");

      await seedText(ctx, "shingles", "full", {
        digests: [await digest(ctx, "unrelated fact")], shingles: ["aa"], keyId: "test-key",
      });
      await expectVisible(ctx, unrelated.id, true, "Stored shingles alone must leave an unrelated row visible");

      const sha = await digest(ctx, "unrelated passage");
      await seedText(ctx, "incomparable", "exact", {
        digests: [{ ...sha, alg: "hmac", keyId: "test-key" }],
      });
      await expectVisible(ctx, unrelated.id, false, "Incomparable digest must hide the row");
    },
    followUp: {
      needs: ["vectorSuppression", "semanticRetrieval"],
      async run(ctx) {
        const near = await insert(ctx, await fixtureRow(ctx, "near passage", 0.15));
        const far = await insert(ctx, await fixtureRow(ctx, "far passage", 0.25));
        const text = { digests: [await digest(ctx, "withheld passage")], embedding: ctx.vec(0) };
        await seedText(ctx, "exact", "exact", text);
        await expectVisible(ctx, near.id, true, "Exact-mode fact must keep a distance-only match visible");
        await seedText(ctx, "full", "full", text);
        await expectVisible(ctx, near.id, false, "Full text fact must hide a vector match");
        await expectVisible(ctx, far.id, true, "Full text fact must keep a distant row visible");
      },
    },
  },
  {
    id: "K-HIDE-3", title: "hides by receipt session", needs: [],
    async run(ctx) {
      const rows = await receiptRows(ctx);
      for (const [id, visible, message] of rows) {
        await expectVisible(ctx, id, visible, message, "recall");
      }
      const { uow, lexical, recent } = ctx.adapter;
      const readSet = { owner: ctx.owner, namespaces: [ctx.scope(null).namespace] };
      const expected = new Set(rows.filter(([, visible]) => visible).map(([id]) => id));
      await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
        const candidates = await lexical.lexical(tx, readSet, "memory", 10, {});
        equal(new Set(candidates.rows.map(({ ref }) => ref.id)), expected, "Lexical must return only receipt-visible rows");
        const page = await recent.recent(tx, readSet, { cursor: null, limit: 10 });
        equal(new Set(page.items.map(({ id }) => id)), expected, "Recent must return only receipt-visible rows");
      });
    },
    followUp: {
      needs: ["semanticRetrieval"],
      async run(ctx) {
        const rows = await receiptRows(ctx);
        const { uow, vector } = ctx.adapter;
        check(vector, "Semantic retrieval requires a vector port");
        const readSet = { owner: ctx.owner, namespaces: [ctx.scope(null).namespace] };
        const expected = new Set(rows.filter(([, visible]) => visible).map(([id]) => id));
        await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
          const result = await vector.vector(tx, readSet, new Float32Array(ctx.vec(1)), "test", 10);
          equal(new Set(result.rows.map(({ ref }) => ref.id)), expected, "Vector must return only receipt-visible rows");
        });
      },
    },
  },
  {
    id: "K-HIDE-4", title: "keeps memory rows visible inside a window", needs: [],
    async run(ctx) {
      const memory = await insert(ctx, { ...await fixtureRow(ctx, "memory inside window"), source: captureSource },
        [{ ...evidence("inside", 15), client, sessionId }]);
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "window"), kind: "window", client, window: { startMs: 10, endMs: 20 },
      });

      await expectVisible(ctx, memory.id, true, "Window fact must keep a memory with an inside receipt visible");
      const scope = ctx.scope(null);
      const { memories, uow } = ctx.adapter;
      const query = [{ textHash: await ctx.hash("memory inside window") }];
      await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
        const { hiddenIds, blockedPositions, blockedSession } =
          await memories.readWritePolicy(tx, scope, query, captureSource, "full");
        equal({ hiddenIds, blockedPositions, blockedSession },
          { hiddenIds: [], blockedPositions: [], blockedSession: false }, "Window fact must leave write policy open");
      });
    },
  },
  {
    id: "K-WRITE-1", title: "blocks exact digests in both write modes", needs: [],
    async run(ctx) {
      const content = await fixtureRow(ctx, "withheld text");
      const retained = await fixtureRow(ctx, "retained text");
      const hidden = await insert(ctx, content);
      const visible = await insert(ctx, retained);
      const withheld = await digest(ctx, content.text);
      await seedText(ctx, "exact", "exact", { digests: [withheld] });
      await seedText(ctx, "unrelated-text", "exact", { digests: [await digest(ctx, "unrelated fact")] });
      const { uow, memories } = ctx.adapter;
      const scope = ctx.scope(null);
      const query = [
        { textHash: content.textHash },
        { textHash: retained.textHash },
        { textHash: await ctx.hash("new normalization"), legacyHash: content.textHash },
      ];
      await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
        for (const mode of /** @type {const} */ (["hash", "full"])) {
          const policy = await memories.readWritePolicy(tx, scope, query, source, mode);
          equal(policy.blockedPositions, [0, 2], "Exact digest must block the primary and legacy query positions");
          check(policy.matches[1].some((match) => match.kind === "stored" && match.match === "exact" &&
            match.id === visible.id && !policy.hiddenIds.includes(match.id)), "Visible exact duplicate must be retained in write policy");
          equal(new Set(policy.hiddenIds), new Set([hidden.id]), "Text-hidden duplicate must report its ID");
          const duplicates = await memories.findDuplicates(tx, scope, query, { nearDistance: 0 });
          check(duplicates[1].some((match) => match.kind === "stored" && match.match === "exact" && match.id === visible.id),
            "Visible exact duplicate must be retained in duplicate results");
          check(duplicates.every((group) => group.every((match) => match.kind !== "stored" || match.id !== hidden.id)),
            "Text-hidden row must be absent from duplicate results");
        }
      });
    },
    followUp: {
      needs: ["vectorSuppression", "semanticRetrieval"],
      async run(ctx) {
        const withheld = await digest(ctx, "withheld passage");
        await seedText(ctx, "full", "full", { digests: [withheld], embedding: ctx.vec(0) });
        const query = [
          { textHash: await ctx.hash("near passage"), embedding: ctx.vec(0.15) },
          { textHash: await ctx.hash("far passage"), embedding: ctx.vec(0.25) },
          { textHash: "sha256:" + withheld.value },
        ];
        const { uow, memories } = ctx.adapter;
        const scope = ctx.scope(null);
        await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
          const explicit = await memories.readWritePolicy(tx, scope, query, source, "hash");
          equal(explicit.blockedPositions, [2], "Hash mode must admit a distance-only match");
          const capture = await memories.readWritePolicy(tx, scope, query, captureSource, "full");
          equal(capture.blockedPositions, [0, 2], "Full mode must block a vector match and an exact match");
        });
      },
    },
  },
  {
    id: "K-WRITE-2", title: "requires a client and session for a write session block", needs: [],
    async run(ctx) {
      await seedSession(ctx);
      const { uow, memories } = ctx.adapter;
      const scope = ctx.scope(null);
      const query = [{ textHash: await ctx.hash("write candidate") }];
      await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
        const matched = await memories.readWritePolicy(tx, scope, query, captureSource, "full");
        equal(matched.blockedSession, true, "Matching capture session must be blocked");
        const explicit = await memories.readWritePolicy(tx, scope, query, { ...source, client }, "hash");
        equal(explicit.blockedSession, false, "Explicit save without a session must be admitted");
        equal(explicit.blockedPositions, [], "Explicit save without a session must have no blocked positions");
        equal(decideWrite(explicit, 0), { status: "saved" }, "Core must save the explicit candidate without a session");
        const noClient = await memories.readWritePolicy(tx, scope, query, { ...captureSource, client: null }, "full");
        equal(noClient.blockedSession, false, "Write source without a client must be admitted");
        for (const unmatched of [{ ...captureSource, sessionId: otherSession }, { ...captureSource, client: otherClient }]) {
          const policy = await memories.readWritePolicy(tx, scope, query, unmatched, "full");
          equal(policy.blockedSession, false, "Unrelated capture session must be admitted");
        }
      });
    },
  },
  {
    id: "K-SNAP-F1", title: "projects session, window and passage blocks in snapshots", needs: [],
    async run(ctx) {
      await seedSession(ctx);
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "client-window"), kind: "window", client, window: { startMs: 10, endMs: 20 },
      });
      const digests = [await digest(ctx, "matching passage")];
      await seedText(ctx, "matching-text", "exact", { digests });
      await seedText(ctx, "unrelated-text", "exact", { digests: [await digest(ctx, "another passage")] });
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "other-scope"), kind: "text", mode: "exact", text: { digests }, namespace: "other",
      });

      const { uow, suppressions } = ctx.adapter;
      const scope = ctx.scope(null);
      const occurredAtMs = [9, 10, 15, 20, 30, null];
      const passages = [{ digests, shingles: null, keyId: null }];
      await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
        const matching = await suppressions.snapshot(tx, scope, { client, sessionId, occurredAtMs, passages });
        equal(matching.blockedSession, true, "Snapshot must block its matching session");
        equal(matching.blockedMessages, [1, 2], "Client window must use half-open bounds and admit null time by default");
        equal(matching.passages.map(({ fact }) => fact.actionId), ["matching-text"], "Snapshot must return only matching scoped passages");

        const other = await suppressions.snapshot(tx, scope, { client: otherClient, sessionId, occurredAtMs });
        equal(other.blockedSession, false, "Snapshot must admit another client");
        equal(other.blockedMessages, [], "Client window must admit another client");
        equal(new Set(other.passages.map(({ fact }) => fact.actionId)), new Set(["matching-text", "unrelated-text"]),
          "Omitted passages must return every scoped text fact");
        equal((await suppressions.snapshot(tx, scope, { passages: [] })).passages.length, 0,
          "Empty candidate passages must return no text facts");
      });

      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "global-window"), kind: "window", client: null, window: { startMs: 30, endMs: 40 }, unknownTime: true,
      });
      const key = ctx.adapter.capabilities.fingerprintKey ? await ctx.adapter.keys?.userKey(ctx.owner) : null;
      await seedText(ctx, "incomparable", "exact", { digests: [{ ...digests[0], alg: "hmac", keyId: key?.id ?? "test-key" }] });
      await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
        const other = await suppressions.snapshot(tx, scope, { client: otherClient, occurredAtMs });
        equal(other.blockedMessages, [4, 5], "All-client window must block inside and unknown times");
        equal(other.blockedSession, false, "Window matching without a session must leave the session open");
        const noClient = await suppressions.snapshot(tx, scope, { occurredAtMs });
        equal(noClient.blockedMessages, [0, 1, 2, 3, 4, 5], "Client-specific window must block every position without a client");
        const incomparable = await suppressions.snapshot(tx, scope, { passages });
        equal(new Set(incomparable.passages.map(({ fact }) => fact.actionId)), new Set(["matching-text", "incomparable"]),
          "Snapshot must retain an ineligible passage fact");
      });
    },
  },
  {
    id: "K-SNAP-F3", title: "applies owner-wide window bounds without a client", needs: [],
    async run(ctx) {
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "window"), kind: "window", client: null, window: { startMs: 10, endMs: 20 },
      });
      const { uow, suppressions } = ctx.adapter;
      const scope = ctx.scope(null);
      await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
        const result = await suppressions.snapshot(tx, scope, { occurredAtMs: [9, 10, 15, 20, 21] });
        equal(result.blockedMessages, [1, 2], "Owner-wide window must use half-open bounds without a client");
      });
    },
  },
  {
    id: "K-SNAP-F4", title: "applies the unknown time flag without a client", needs: [],
    async run(ctx) {
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "window"), kind: "window", client: null, window: { startMs: 10, endMs: 20 },
      });
      const { uow, suppressions } = ctx.adapter;
      const scope = ctx.scope(null);
      const candidates = { occurredAtMs: [null] };
      const snapshot = () => uow.run(ctx.owner, { readOnly: true }, (tx) => suppressions.snapshot(tx, scope, candidates));
      equal((await snapshot()).blockedMessages, [], "Owner-wide window must admit unknown time by default");
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "unknown-window"), kind: "window", client: null, window: { startMs: 30, endMs: 40 }, unknownTime: true,
      });
      equal((await snapshot()).blockedMessages, [0], "Owner-wide window must block unknown time when enabled");
    },
  },
  {
    id: "K-SNAP-F5", title: "blocks positions without a client only inside a client-specific window", needs: [],
    async run(ctx) {
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "window"), kind: "window", client, window: { startMs: 10, endMs: 20 },
      });
      const { uow, suppressions } = ctx.adapter;
      const scope = ctx.scope(null);
      await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
        const result = await suppressions.snapshot(tx, scope, { occurredAtMs: [9, 10, 15, 20, 21, null] });
        equal(result.blockedMessages, [1, 2],
          "A client-specific window must block clientless times inside [start, end) and admit times outside it");
      });
    },
  },
  {
    id: "K-SNAP-F5u", title: "blocks an unknown time without a client when a client-specific window covers unknown times", needs: [],
    async run(ctx) {
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "window"), kind: "window", client, window: { startMs: 10, endMs: 20 }, unknownTime: true,
      });
      const { uow, suppressions } = ctx.adapter;
      const scope = ctx.scope(null);
      await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
        const result = await suppressions.snapshot(tx, scope, { occurredAtMs: [null, 21] });
        equal(result.blockedMessages, [0], "An unknown time without a client must be blocked when the window covers unknown times");
      });
    },
  },
  {
    id: "K-SNAP-F6", title: "admits a known client outside the window's client scope", needs: [],
    async run(ctx) {
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "window"), kind: "window", client, window: { startMs: 10, endMs: 20 }, unknownTime: true,
      });
      const { uow, suppressions } = ctx.adapter;
      const scope = ctx.scope(null);
      await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
        const result = await suppressions.snapshot(tx, scope, { client: otherClient, occurredAtMs: [15, null] });
        equal(result.blockedMessages, [], "Client-specific window must admit a different client");
      });
    },
  },
  {
    id: "K-SNAP-F7", title: "admits clientless messages when no window facts apply", needs: [],
    async run(ctx) {
      await seedSession(ctx);
      const { uow, suppressions } = ctx.adapter;
      const scope = ctx.scope(null);
      await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
        const result = await suppressions.snapshot(tx, scope, { sessionId, occurredAtMs: [15, null] });
        equal(result.blockedMessages, [], "A snapshot without window facts must have no blocked messages");
        equal(result.blockedSession, false, "A snapshot without a client must have no session block");
      });
    },
  },
  {
    id: "K-FACTSFOR-1", title: "returns matching and ineligible facts for the current row", needs: [],
    async run(ctx) {
      const memory = await insert(ctx, await fixtureRow(ctx, "current memory"), [{ ...evidence("receipt", 15), client, sessionId }]);
      const missing = "missing-memory";
      for (const [actionId, memoryId] of [["identity", memory.id], ["missing", missing], ["unrelated", "other-memory"]]) {
        await ctx.harness.seedFact(ctx.owner, { ...factBase(ctx, actionId), kind: "identity", memoryId });
      }
      const sha = await digest(ctx, "current memory");
      await seedText(ctx, "exact", "exact", { digests: [sha] });
      await seedText(ctx, "unrelated-text", "exact", { digests: [await digest(ctx, "unrelated text")] });
      await seedText(ctx, "incomparable", "exact", { digests: [{ ...sha, alg: "hmac", keyId: "test-key" }] });
      await seedSession(ctx);
      await ctx.harness.seedFact(ctx.owner, {
        ...factBase(ctx, "window"), kind: "window", client, window: { startMs: 10, endMs: 20 },
      });

      const { uow, suppressions } = ctx.adapter;
      const scope = ctx.scope(null);
      await uow.run(ctx.owner, { readOnly: true }, async (tx) => {
        const facts = await suppressions.factsFor(tx, scope, { memoryId: memory.id });
        check(facts !== "ineligible", "Store must classify facts for the current row");
        equal(facts.map(({ fact }) => fact.actionId).sort(), ["exact", "identity", "incomparable", "session"],
          "factsFor must include ineligible facts and exclude unrelated facts");

        const absent = await suppressions.factsFor(tx, scope, { memoryId: missing });
        check(absent !== "ineligible", "Store must classify facts for a missing row");
        equal(absent.map(({ fact }) => fact.actionId), ["missing"], "Missing row must return only its identity facts");
      });
    },
  },
  {
    id: "K-HASH-1", title: "uses the factory session hash to compare plain receipts", needs: [],
    async run(ctx) {
      if (ctx.sessionRefs !== "hashed") return "needs hashed session refs";
      const matching = { ...evidence("matching", 10), client, sessionId };
      const yes = await insert(ctx, await fixtureRow(ctx, "hashed receipt match"), [matching]);
      const no = await insert(ctx, await fixtureRow(ctx, "hashed receipt miss"), [{ ...matching, sessionId: otherSession }]);
      await seedSession(ctx);
      await expectVisible(ctx, yes.id, false, "Hashed session fact must hide the matching receipt");
      await expectVisible(ctx, no.id, true, "Hashed session fact must keep a different receipt visible");
    },
  },
];
