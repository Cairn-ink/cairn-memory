// Compare port results by projecting the needed fields into plain tuples or objects.
// Documented plain shapes may be compared whole when every field is asserted. Dumps are JSON-only.
// Cases never assume a store's write time equals nowMs. Fixed write times come only from
// harness.setWriteTime. Expected orders use those forced times and the actual ids.
import { compareSortKey, compareUtf8, NEAR_DUPLICATE_DISTANCE } from "@cairn-ink/core";
import { check, equal, evidence, projectReceipt, readDump, rejects, row, source } from "./support.mjs";

const near = { nearDistance: NEAR_DUPLICATE_DISTANCE };

/** @param {{id: string, updatedAtUs: bigint}} a @param {{id: string, updatedAtUs: bigint}} b */
function newestFirst(a, b) {
  return compareSortKey(b.updatedAtUs, a.updatedAtUs) || compareUtf8(b.id, a.id);
}

/** @type {import("./index.d.mts").ConformanceCase[]} */
export const memoryCases = [
  {
    id: "K-MEM-1", title: "finds exact duplicates only in the requested scope", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories }, owner, otherOwner } = ctx;
      const scope = ctx.scope(null);
      const content = await row(ctx, "scope");
      const query = [{ textHash: content.textHash }];
      await uow.run(owner, {}, async (tx) => {
        const inserted = await memories.insert(tx, scope, content, [], 1);
        const [matches] = await memories.findDuplicates(tx, scope, query, near);
        equal(matches.length, 1, "Expected one exact duplicate");
        const match = matches[0];
        check(match.kind === "stored", "Expected a stored match");
        equal([match.match, match.id, match.revision, match.writeTimeUs],
          ["exact", inserted.id, 1, inserted.updatedAtUs], "Stored match metadata");
        equal(await memories.findDuplicates(tx, ctx.scope("other"), query, near), [[]], "Namespace leaked");
      });
      await uow.run(otherOwner, { readOnly: true }, async (tx) => {
        equal(await memories.findDuplicates(tx, { ...scope, owner: otherOwner }, query, near), [[]], "Owner leaked");
      });
    },
  },
  {
    id: "K-MEM-3", title: "orders exact, near, prior and stored matches", needs: ["nearDuplicate"],
    async run(ctx) {
      const { adapter: { uow, memories }, harness, owner } = ctx;
      const scope = ctx.scope(null);
      const contents = await Promise.all([
        row(ctx, "exact", 0),
        row(ctx, "legacy", 0.11),
        row(ctx, "closest", 0.02),
        row(ctx, "older", 0.05),
        row(ctx, "tie one", 0.05),
        row(ctx, "tie two", 0.05),
        row(ctx, "excluded", 0.02),
        row(ctx, "outside", 0.11),
      ]);
      const [priorOne, priorTwo] = await Promise.all([ctx.hash("prior one"), ctx.hash("prior two")]);
      const saved = await uow.run(owner, {}, async (tx) => {
        // Insert in order so the fixture also works with sequential id generators.
        const saved = [];
        for (const content of contents) {
          saved.push(await memories.insert(tx, scope, content, [], 1));
        }
        return saved;
      });
      const times = [1001n, 1001n, 1001n, 1001n, 1002n, 1002n, 1003n, 1003n];
      const forced = saved.map(({ id }, i) => ({ id, updatedAtUs: times[i] }));
      for (const { id, updatedAtUs } of forced) await harness.setWriteTime(scope, id, updatedAtUs);
      const [exactRow, legacyRow, closestRow, olderRow, firstTie, secondTie, excludedRow] = forced;
      const tiedMatches = [olderRow, firstTie, secondTie].sort(newestFirst);
      await uow.run(owner, { readOnly: true }, async (tx) => {
        const batch = [
          { textHash: contents[0].textHash, embedding: ctx.vec(0) },
          { textHash: priorOne, embedding: ctx.vec(0.05) },
          { textHash: priorTwo, embedding: ctx.vec(0.05) },
          { textHash: contents[0].textHash, embedding: ctx.vec(0) },
          { textHash: contents[0].textHash, legacyHash: contents[1].textHash, embedding: ctx.vec(0) },
        ];
        const results = await memories.findDuplicates(tx, scope, batch, { ...near, excludeId: excludedRow.id });
        const matches = results[4];
        equal(matches.map((m) => [m.match, m.kind, m.kind === "prior" ? m.batchIndex : m.id]), [
          ["exact", "prior", 3], ["exact", "prior", 0],
          ["exact", "stored", exactRow.id], ["exact", "stored", legacyRow.id],
          ["near", "stored", closestRow.id], ["near", "prior", 2], ["near", "prior", 1],
          ...tiedMatches.map(({ id }) => ["near", "stored", id]),
        ], "Duplicate order, exclusion, or threshold");
        const distances = [0, 0, 0, 0.11, 0.02, 0.05, 0.05, 0.05, 0.05, 0.05];
        for (const [i, match] of matches.entries()) {
          check(match.distance !== undefined && Math.abs(match.distance - distances[i]) < 1e-6,
            "Unexpected cosine distance");
          if (match.kind === "prior") check(!("writeTimeUs" in match), "A prior carried a write timestamp");
        }
      });
    },
  },
  {
    id: "K-CAP-1", title: "omits near matches when nearDuplicate is off", needs: [], needsOff: ["nearDuplicate"],
    async run(ctx) {
      const { adapter: { uow, memories }, owner } = ctx;
      const scope = ctx.scope(null);
      const content = await row(ctx, "base", 0);
      const query = [{ textHash: await ctx.hash("near"), embedding: ctx.vec(0.05) }];
      await uow.run(owner, {}, async (tx) => {
        await memories.insert(tx, scope, content, [], 1);
        equal(await memories.findDuplicates(tx, scope, query, near), [[]], "Near matching ran with its flag off");
      });
    },
  },
  {
    id: "K-MEM-4", title: "touches duplicates and applies merges verbatim", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories }, harness, owner } = ctx;
      const scope = ctx.scope(null);
      const content = { ...await row(ctx, "touch"), origin: /** @type {const} */ ("inferred") };
      const { id, revision } = await uow.run(owner, {}, (tx) => memories.insert(tx, scope, content, [], 1));

      /**
       * @param {bigint} forcedTime @param {number} nowMs
       * @param {readonly import("@cairn-ink/core/ports").Receipt[]} receipts
       * @param {import("@cairn-ink/core/ports").DuplicateMerge} merge
       * @param {Awaited<ReturnType<typeof memories.touchDuplicate>>} expected @param {string} message
       */
      async function touch(forcedTime, nowMs, receipts, merge, expected, message) {
        await harness.setWriteTime(scope, id, forcedTime);
        const result = await uow.run(owner, {}, (tx) => memories.touchDuplicate(tx, scope, id, receipts, merge, nowMs));
        equal(result, expected, message);
        const saved = await uow.run(owner, { readOnly: true }, (tx) => memories.get(tx, scope, id));
        check(saved, "Touched row missing");
        check(saved.updatedAtUs > forcedTime, "Touch time did not advance past the forced write time");
        return saved;
      }

      await touch(100n, 2, [], { confidence: content.confidence },
        { outcome: "touched", revision }, "An identical merge should touch");
      const confidenceChanged = await touch(200n, 3, [], { confidence: 0.8 },
        { outcome: "changed", revision: revision + 1 }, "Confidence change should bump revision");
      equal([confidenceChanged.confidence, confidenceChanged.kind, confidenceChanged.origin],
        [0.8, content.kind, content.origin], "Confidence-only merge was not applied verbatim");

      const changed = await touch(300n, 4, [], { confidence: 0.6, kind: "decision", origin: "explicit" },
        { outcome: "changed", revision: revision + 2 }, "Kind and origin change should bump revision");
      equal([changed.kind, changed.origin, changed.confidence],
        ["decision", "explicit", 0.6], "Explicit merge was not applied verbatim");

      await touch(400n, 5, [{ client: "test-client", sessionId: "test-origin", messageId: "first", role: "user", occurredAtMs: null }],
        { confidence: 0.6, kind: "decision", origin: "explicit" },
        { outcome: "touched", revision: revision + 2 }, "Receipts alone should leave the revision unchanged");
      await rejects(() => uow.run(owner, {}, (tx) => memories.touchDuplicate(tx, ctx.scope("other"), id, [], { confidence: 0.8 }, 6)),
        "memory_not_found");
    },
  },
  {
    id: "K-MEM-4r", title: "touch attaches receipts, visible through hydrate", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories, hydrate }, owner } = ctx;
      const scope = ctx.scope(null);
      const content = await row(ctx, "receipt evidence");
      const first = evidence("first", 20);
      const second = evidence("second", 30);
      const id = await uow.run(owner, {}, async (tx) => {
        const { id } = await memories.insert(tx, scope, content, [first], 1);
        await memories.touchDuplicate(tx, scope, id, [second], { confidence: content.confidence }, 2);
        return id;
      });
      await uow.run(owner, { readOnly: true }, async (tx) => {
        const items = await hydrate.hydrate(tx, { owner, namespaces: [scope.namespace] },
          [{ type: "memory", namespace: scope.namespace, id }], "read");
        equal(items.map(({ ref, receipts }) => [ref.id, receipts && new Set(receipts.map(projectReceipt))]),
          [[id, new Set([first, second].map(projectReceipt))]], "Touch did not preserve both receipts");
      });
    },
  },
  {
    id: "K-MEM-5", title: "replaces content with revision and collision checks", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories }, harness, owner } = ctx;
      const scope = ctx.scope(null);
      const first = await row(ctx, "original");
      const other = await row(ctx, "collision");
      const next = { ...await row(ctx, "replacement"), kind: /** @type {const} */ ("instruction") };
      const id = await uow.run(owner, {}, async (tx) => {
        const { id } = await memories.insert(tx, scope, first, [], 1);
        await memories.insert(tx, scope, other, [], 1);
        return id;
      });
      const before = await readDump(harness);
      await uow.run(owner, {}, async (tx) => {
        equal(await memories.replaceContent(tx, scope, id, 1, { ...first, kind: "context" }, [], 2),
          { outcome: "unchanged", revision: 1 }, "Identical hash should leave the row unchanged");
      });
      equal(await readDump(harness), before, "Identical hash wrote state");
      await rejects(() => uow.run(owner, {}, (tx) => memories.replaceContent(tx, scope, id, 2, first, null, 2)),
        "revision_conflict");
      await rejects(() => uow.run(owner, {}, (tx) => memories.replaceContent(tx, scope, id, 1, other, null, 2)),
        "memory_conflict");
      await rejects(() => uow.run(owner, {}, (tx) => memories.replaceContent(tx, ctx.scope("other"), id, 1, next, null, 2)),
        "memory_not_found");
      await uow.run(owner, {}, async (tx) => {
        equal(await memories.replaceContent(tx, scope, id, 1, next, null, 2),
          { outcome: "changed", revision: 2 }, "Replacement should bump revision");
        const saved = await memories.get(tx, scope, id);
        check(saved, "Replaced row is missing");
        equal([saved.text, saved.textHash, saved.kind, saved.revision],
          [next.text, next.textHash, next.kind, 2], "Replacement fields differ");
      });
    },
  },
  {
    id: "K-MEM-5h", title: "refuses replacement of historical content", needs: ["supersession"],
    pending: "awaiting the supersession suite",
    // TODO: Exercise markHistorical when the supersession suite is added.
    async run() {},
  },
  {
    id: "K-MEM-10", title: "matches null embeddings by hash and counts near skips when enabled", needs: [],
    requests: { nearDuplicate: true },
    async run(ctx) {
      const { adapter: { uow, memories, capabilities }, harness, owner } = ctx;
      if (capabilities.embeddingRequiredOnInsert) return "requires an unembedded row for exact and near-skip checks";
      const scope = ctx.scope(null);
      const content = await row(ctx, "unembedded");
      const query = { textHash: await ctx.hash("different"), embedding: ctx.vec(0) };
      const before = (await harness.counters()).nearSkippedUnembedded ?? 0;
      await uow.run(owner, {}, async (tx) => {
        const { id } = await memories.insert(tx, scope, content, [], 1);
        const [exact] = await memories.findDuplicates(tx, scope, [{ textHash: content.textHash }], near);
        equal(exact.length, 1, "Expected an exact duplicate with null embeddings");
        check(exact[0].kind === "stored" && exact[0].match === "exact" && exact[0].id === id, "Exact duplicate differs");
      });
      equal((await harness.counters()).nearSkippedUnembedded ?? 0, before, "Exact match counted as a near skip");
      await uow.run(owner, { readOnly: true }, async (tx) => {
        const [nearMatches] = await memories.findDuplicates(tx, scope, [query], near);
        equal(nearMatches, [], "Unembedded pair appeared as a near duplicate");
      });
      equal((await harness.counters()).nearSkippedUnembedded ?? 0, before + Number(capabilities.nearDuplicate),
        "Unembedded near skip count differs");
    },
  },
  {
    id: "K-MEM-11", title: "erases a row from all memory reads", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories }, owner } = ctx;
      const scope = ctx.scope(null);
      const content = await row(ctx, "erase");
      const query = [{ textHash: content.textHash }];
      const id = await uow.run(owner, {}, async (tx) => {
        const { id } = await memories.insert(tx, scope, content, [], 1);
        equal(await memories.erase(tx, scope, id), true, "First erase should succeed");
        equal(await memories.erase(tx, scope, id), false, "Second erase should find nothing");
        return id;
      });
      await uow.run(owner, { readOnly: true }, async (tx) => {
        check(await memories.get(tx, scope, id) === null, "Erased row is still readable");
        check(await memories.readRevision(tx, scope, id) === null, "Erased row still has a revision");
        equal(await memories.findDuplicates(tx, scope, query, near), [[]], "Erased row still duplicates");
        equal((await memories.readWritePolicy(tx, scope, query, source, "full")).matches, [[]], "Erased row still matches policy");
        const page = await memories.exportPage(tx, scope, { cursor: null, limit: 2 });
        check(Array.isArray(page.items) && page.items.length === 0 && page.nextCursor === null, "Erased row still exports");
      });
    },
  },
  {
    id: "K-MEM-12", title: "pages by exact time and UTF-8 id", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories }, harness, owner } = ctx;
      const scope = ctx.scope(null);
      const times = [4004n, 4003n, 4003n, 4003n, 4002n, 4001n, 4000n];
      const rows = await Promise.all(times.map((_, i) => row(ctx, `page ${i}`)));
      const saved = await uow.run(owner, {}, async (tx) => {
        const saved = [];
        for (const content of rows) {
          saved.push(await memories.insert(tx, scope, content, [], 1));
        }
        return saved;
      });
      const forced = saved.map(({ id }, i) => ({ id, updatedAtUs: times[i] }));
      for (const { id, updatedAtUs } of forced) await harness.setWriteTime(scope, id, updatedAtUs);
      /** @param {{id: string, updatedAtUs: bigint}} item @returns {[string, bigint]} */
      const pageKey = ({ id, updatedAtUs }) => [id, updatedAtUs];
      /** @param {import("@cairn-ink/core/ports").MemoryRow} item */
      const pageRow = (item) => ({
        id: item.id,
        namespace: item.scope.namespace,
        kind: item.kind,
        origin: item.origin,
        text: item.text,
        textHash: item.textHash,
        confidence: item.confidence,
        revision: item.revision,
        createdAtMs: item.createdAtMs,
        updatedAtMs: item.updatedAtMs,
        updatedAtUs: item.updatedAtUs,
        historical: Boolean(item.historical),
        source: { kind: item.source.kind, client: item.source.client, sessionId: item.source.sessionId },
      });
      const expected = forced.sort(newestFirst).map(pageKey);
      const [originalFirst, originalSecond] = await uow.run(owner, { readOnly: true }, async (tx) => {
        const first = await memories.exportPage(tx, scope, { cursor: null, limit: 2 });
        const cursor = first.nextCursor;
        check(typeof cursor === "string" && cursor.length > 0, "Incorrect cursor termination");
        const firstItems = first.items.map(pageRow);
        const second = await memories.exportPage(tx, scope, { cursor, limit: 2 });
        return [firstItems, second.items.map(pageRow)];
      });
      await uow.run(owner, { readOnly: true }, async (tx) => {
        const seen = [];
        /** @type {string | null} */
        let cursor = null;
        for (let i = 0; i < 4; i++) {
          const page = await memories.exportPage(tx, scope, { cursor, limit: 2 });
          equal(page.items.length, i === 3 ? 1 : 2, "Unexpected page length");
          if (i === 0) equal(page.items.map(pageRow), originalFirst, "First page items changed on re-read");
          if (i === 1) equal(page.items.map(pageRow), originalSecond, "First page cursor reached different items on re-read");
          seen.push(...page.items.map(pageKey));
          cursor = page.nextCursor;
          check(i === 3 ? cursor === null : typeof cursor === "string" && cursor.length > 0, "Incorrect cursor termination");
        }
        equal(seen, expected, "Paged rows are missing, repeated, or out of order");
        await rejects(() => memories.exportPage(tx, scope, { cursor: "", limit: 2 }), "invalid_cursor");
        await rejects(() => memories.exportPage(tx, scope, { cursor: "%%%", limit: 2 }), "invalid_cursor");
        await rejects(() => memories.exportPage(tx, scope, { cursor: null, limit: 0 }), "invalid_input");
      });
    },
  },
  {
    id: "K-MEM-13", title: "applies write policy and visibility facts (provisional)", needs: [],
    requests: { vectorSuppression: true, nearDuplicate: true },
    async run(ctx) {
      const { adapter: { uow, memories, capabilities }, harness, owner } = ctx;
      const scope = ctx.scope(null);
      const owned = await row(ctx, "identity", capabilities.nearDuplicate ? 0 : null);
      const hashed = await ctx.hash("withheld digest");
      const distantDigest = await ctx.hash("withheld vector");
      const sessionSource = { ...source, client: "test-client", sessionId: "test-origin" };
      const id = await uow.run(owner, {}, async (tx) => (await memories.insert(tx, scope, owned, [], 1)).id);
      const factBase = { owner, origin: /** @type {const} */ ("forget") };
      await harness.seedFact(owner, { ...factBase, actionId: "identity", kind: "identity", memoryId: id, namespace: null });
      await harness.seedFact(owner, {
        ...factBase, actionId: "source", kind: "session",
        session: { client: sessionSource.client, sessionId: sessionSource.sessionId },
      });
      await harness.seedFact(owner, {
        ...factBase, actionId: "digest", kind: "text", mode: "exact",
        text: { digests: [{ alg: "sha256", value: hashed.slice(7), pipeline: "core", redactionVersion: 1, keyId: null }] },
      });
      await harness.seedFact(owner, {
        ...factBase, actionId: "vector", kind: "text", mode: "full",
        text: {
          digests: [{ alg: "sha256", value: distantDigest.slice(7), pipeline: "core", redactionVersion: 1, keyId: null }],
          embedding: ctx.vec(0),
        },
      });
      const query = [
        { textHash: owned.textHash },
        { textHash: hashed },
        { textHash: await ctx.hash("near withheld"), embedding: ctx.vec(0.15) },
        { textHash: await ctx.hash("far withheld"), embedding: ctx.vec(0.25) },
      ];
      const nearIdentity = capabilities.nearDuplicate
        ? [{ textHash: await ctx.hash("near identity"), embedding: ctx.vec(0.05) }]
        : null;
      await uow.run(owner, { readOnly: true }, async (tx) => {
        const policy = await memories.readWritePolicy(tx, scope, query, sessionSource, "hash");
        equal(policy.hiddenIds, [id], "Identity fact should report the hidden id");
        check(policy.matches[0].some((match) => match.kind === "stored" && match.match === "exact" && match.id === id),
          "Identity-hidden row should still appear in policy matches");
        equal((await memories.findDuplicates(tx, scope, query, near))[0], [], "Hidden row leaked into duplicate matches");
        equal(policy.blockedPositions, [1], "Hash mode should check digests only");
        equal(policy.blockedSession, true, "Matching source was not blocked");
        const otherSession = { ...sessionSource, sessionId: "other-origin" };
        const otherClient = { ...sessionSource, client: "other-client" };
        equal((await memories.readWritePolicy(tx, scope, query, otherSession, "hash")).blockedSession,
          false, "A different session of the same client was blocked");
        equal((await memories.readWritePolicy(tx, scope, query, otherClient, "hash")).blockedSession,
          false, "The same session of a different client was blocked");
        const full = await memories.readWritePolicy(tx, scope, query, source, "full");
        equal(full.blockedPositions, capabilities.vectorSuppression ? [1, 2] : [1], "Full-mode vector suppression differs");
        equal(full.blockedSession, false, "A source without a reference was blocked");
        if (nearIdentity) {
          const nearPolicy = await memories.readWritePolicy(tx, scope, nearIdentity, source, "hash");
          const matches = nearPolicy.matches[0].filter((match) => match.kind === "stored" && match.id === id);
          equal(matches.map((match) => match.match), ["near"], "Identity-hidden row should appear as a near-only policy match");
          equal(nearPolicy.hiddenIds, [id], "A hidden near-only match should report its id");
        }
      });
    },
  },
];
