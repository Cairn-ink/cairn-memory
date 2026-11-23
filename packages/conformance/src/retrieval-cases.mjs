import { assertAdapterCapabilities, compareSortKey, compareUtf8 } from "@cairn-ink/core";
import { check, equal, evidence, projectReceipt, rejects, row } from "./support.mjs";

/** @typedef {import("./index.d.mts").CaseContext} Context */
/** @typedef {import("@cairn-ink/core/ports").ItemRef} ItemRef */
/** @typedef {import("@cairn-ink/core/ports").MemoryRow} MemoryRow */
/** @typedef {import("@cairn-ink/core/ports").Receipt} Receipt */
/** @typedef {import("@cairn-ink/core/ports").Scope} Scope */
/** @typedef {import("@cairn-ink/core/ports").InsertRow} InsertRow */
/** @typedef {[string, Scope["namespace"], bigint, string]} RecentProjection */

// Float32 roundoff can move cosine distances slightly outside [0, 2].
const COSINE_DISTANCE_TOLERANCE = 1e-6;

/** @param {Scope} scope @param {string} id @returns {ItemRef} */
const memoryRef = ({ namespace }, id) => ({ type: "memory", id, namespace });

/** @param {ItemRef} ref */
const projectRef = ({ type, id, namespace }) => [type, id, namespace];

/** @param {MemoryRow} row @returns {RecentProjection} */
const projectRecent = ({ id, scope, updatedAtUs, text }) => [id, scope.namespace, updatedAtUs, text];

/** @param {RecentProjection[]} rows */
function groupRecent(rows) {
  /** @type {Set<RecentProjection>[]} */
  const groups = [];
  for (const [i, current] of rows.entries()) {
    const previous = rows[i - 1];
    if (previous && current[0] === previous[0] && current[2] === previous[2]) {
      groups[groups.length - 1].add(current);
    } else {
      groups.push(new Set([current]));
    }
  }
  return groups;
}

/** @param {Context} ctx @param {Scope} scope @param {InsertRow} content @param {bigint} time @param {Receipt[]} [receipts] */
async function insert(ctx, scope, content, time, receipts = []) {
  const { adapter: { uow, memories }, harness } = ctx;
  const { id } = await uow.run(scope.owner, {}, (tx) => memories.insert(tx, scope, content, receipts, 1));
  await harness.setWriteTime(scope, id, time);
  return { ref: memoryRef(scope, id), updatedAtUs: time, text: content.text };
}

/** @param {Context} ctx @param {Scope} scope @param {ItemRef} ref */
async function hide({ harness }, scope, { id }) {
  await harness.seedFact(scope.owner, {
    ...scope, kind: "identity", memoryId: id, origin: "forget", actionId: "withhold",
  });
}

/** @param {Context} ctx @param {Scope} scope @param {ItemRef} ref */
async function erase({ adapter: { uow, memories } }, scope, { id }) {
  await uow.run(scope.owner, {}, (tx) => memories.erase(tx, scope, id));
}

/** @param {{ref: ItemRef, updatedAtUs: bigint}} a @param {{ref: ItemRef, updatedAtUs: bigint}} b */
function newestFirst(a, b) {
  return compareSortKey(b.updatedAtUs, a.updatedAtUs) || compareUtf8(b.ref.id, a.ref.id);
}

/** @param {Context} ctx */
async function refFixture(ctx) {
  const first = ctx.scope(null);
  const second = ctx.scope("shared");
  const readSet = { owner: ctx.owner, namespaces: [first.namespace, second.namespace] };
  const dated = [evidence("late", 90), evidence("unknown", null), evidence("early", 20)];
  const { ref: empty } = await insert(ctx, first, await row(ctx, "unreferenced"), 3002n);
  const { ref: withReceipts } = await insert(ctx, second, await row(ctx, "referenced"), 3001n, dated);
  const { ref: hidden } = await insert(ctx, first, await row(ctx, "private"), 3000n);
  const { ref: erased } = await insert(ctx, second, await row(ctx, "removed"), 3000n);
  const { ref: outside } = await insert(ctx, ctx.scope("outside"), await row(ctx, "elsewhere"), 3000n);
  await hide(ctx, first, hidden);
  await erase(ctx, second, erased);
  const missing = memoryRef(first, crypto.randomUUID());
  const refs = [withReceipts, outside, hidden, missing, empty, erased, { ...empty, type: /** @type {const} */ ("card") }];
  return { readSet, refs, visible: [withReceipts, empty], dated };
}

/** @type {import("./index.d.mts").ConformanceCase[]} */
export const retrievalCases = [
  {
    id: "K-RET-1", title: "ranks lexical matches in the visible read set", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories, lexical }, owner } = ctx;
      const second = ctx.scope("\u{10000}");
      const first = ctx.scope("\uE000");
      const third = ctx.scope("outside");
      const readSet = { owner, namespaces: [second.namespace, first.namespace] };
      const tied = await row(ctx, "orchard apple");
      const otherTied = ctx.adapter.capabilities.embeddingRequiredOnInsert ? await row(ctx, tied.text) : tied;
      const a = await insert(ctx, second, tied, 5002n);
      const b = await insert(ctx, first, otherTied, 5002n);
      const c = await insert(ctx, first, await row(ctx, "orchard orchard pear"), 5001n);
      await insert(ctx, first, await row(ctx, "copper kettle"), 5003n);
      await insert(ctx, third, await row(ctx, "orchard plum"), 5005n);
      await insert(ctx, { ...second, owner: ctx.otherOwner }, await row(ctx, "orchard peach"), 5006n);
      const hidden = await insert(ctx, second, await row(ctx, "orchard cherry"), 5007n);
      const erased = await insert(ctx, first, await row(ctx, "orchard quince"), 5008n);
      await hide(ctx, second, hidden.ref);
      await erase(ctx, first, erased.ref);

      await uow.run(owner, { readOnly: true }, async (tx) => {
        const refKey = (/** @type {ItemRef} */ ref) => JSON.stringify(projectRef(ref));
        const expected = new Set([a.ref, b.ref, c.ref].map(refKey));
        const full = await lexical.lexical(tx, readSet, "orchard", 10, {});
        for (const depth of [10, 2, 1]) {
          const { rows, matched } = depth === 10 ? full : await lexical.lexical(tx, readSet, "orchard", depth, {});
          equal(matched, true, "Lexical did not report matches");
          for (const { score } of rows) check(Number.isFinite(score), "Lexical score must be finite");
          const refs = new Set(rows.map(({ ref }) => refKey(ref)));
          if (depth === 10) {
            equal(refs, expected, "Lexical returned the wrong refs");
          } else {
            equal(rows.length, depth, "Lexical depth returned the wrong number of matches");
            const cutoff = full.rows[depth - 1].score;
            const top = new Set(full.rows.filter(({ score }) => score >= cutoff).map(({ ref }) => refKey(ref)));
            check([...refs].every((ref) => top.has(ref)), "Lexical depth returned a ref below its score cutoff");
            check(full.rows.every(({ ref, score }) => score <= cutoff || refs.has(refKey(ref))),
              "Lexical depth skipped a ref above its score cutoff");
          }
          equal(refs.size, rows.length, "Lexical repeated a ref");
          for (const [i, { ref, score, updatedAtUs }] of rows.entries()) {
            const stored = await memories.get(tx, ctx.scope(ref.namespace), ref.id);
            check(stored, "A lexical ref did not resolve in its namespace");
            equal([ref.namespace, updatedAtUs], [stored.scope.namespace, stored.updatedAtUs], "Lexical row metadata");
            if (i > 0) check(rows[i - 1].score >= score, "Lexical scores increased");
          }
        }
      });
    },
  },
  {
    id: "K-RET-2", title: "reports no lexical match for empty, stopword, and unseen queries", needs: [],
    async run(ctx) {
      const { adapter: { uow, lexical }, owner } = ctx;
      const scope = ctx.scope(null);
      await insert(ctx, scope, await row(ctx, "the violet meadow"), 5001n);
      await uow.run(owner, { readOnly: true }, async (tx) => {
        for (const query of ["", "the and", "zucchini"]) {
          const { rows, matched } = await lexical.lexical(tx, { owner, namespaces: [scope.namespace] }, query, 3, {});
          equal(rows.length, 0, "Empty lexical result contained rows");
          equal(matched, false, "An empty lexical result reported a match");
        }
      });
    },
  },
  {
    id: "K-RET-3", title: "orders vector candidates and counts coverage by model and dimension", needs: ["semanticRetrieval"],
    async run(ctx) {
      const { adapter: { uow, vector }, owner } = ctx;
      check(vector, "Semantic retrieval was enabled without a vector port");
      const first = ctx.scope(null);
      const second = ctx.scope("shared");
      const readSet = { owner, namespaces: [first.namespace, second.namespace] };
      const near = await insert(ctx, first, await row(ctx, "near", 0.1), 6001n);
      const tied = [
        await insert(ctx, first, await row(ctx, "first tie", 0.5), 6002n),
        await insert(ctx, second, await row(ctx, "second tie", 0.5), 6002n),
        await insert(ctx, first, await row(ctx, "older tie", 0.5), 6001n),
      ].sort(newestFirst);
      const far = await insert(ctx, second, await row(ctx, "far", 1.2), 6003n);
      const hidden = await insert(ctx, first, await row(ctx, "hidden", 0.01), 6004n);
      const erased = await insert(ctx, second, await row(ctx, "erased", 0.02), 6005n);
      await insert(ctx, ctx.scope("outside"), await row(ctx, "elsewhere", 0), 6006n);
      await insert(ctx, { ...first, owner: ctx.otherOwner }, await row(ctx, "other owner", 0), 6007n);
      await hide(ctx, first, hidden.ref);
      await erase(ctx, second, erased.ref);
      const query = new Float32Array(ctx.vec(0));
      /** @param {import("@cairn-ink/core/ports").Tx} tx @param {Float32Array} queryVector @param {number} depth */
      const search = async (tx, queryVector, depth) => {
        const result = await vector.vector(tx, readSet, queryVector, "test", depth);
        for (const { distance } of result.rows) {
          check(Number.isFinite(distance) && distance >= -COSINE_DISTANCE_TOLERANCE && distance <= 2 + COSINE_DISTANCE_TOLERANCE,
            "Vector distance must be finite and between 0 and 2 with float32 tolerance");
        }
        return result;
      };

      await uow.run(owner, { readOnly: true }, async (tx) => {
        const { rows, coverage } = await search(tx, query, 10);
        equal([coverage.eligible, coverage.embedded, coverage.complete], [5, 5, true], "Complete vector coverage");
        equal(rows.map(({ ref }) => projectRef(ref)), [near, ...tied, far].map(({ ref }) => projectRef(ref)),
          "Complete vector coverage returned the wrong refs");
      });

      const requiresEmbedding = ctx.adapter.capabilities.embeddingRequiredOnInsert;
      if (!requiresEmbedding) await insert(ctx, first, await row(ctx, "missing vector"), 6008n);
      const eligible = requiresEmbedding ? 6 : 7;
      const otherModel = await row(ctx, "other model", 0.03);
      check(otherModel.embedding, "Wrong-model fixture must have a vector");
      await insert(ctx, second, {
        ...otherModel, embedding: { ...otherModel.embedding, model: "other" },
      }, 6009n);

      await uow.run(owner, { readOnly: true }, async (tx) => {
        const result = await search(tx, query, 10);
        equal([result.coverage.eligible, result.coverage.embedded], [eligible, 5], "Vector eligible and embedded counts");
        equal(result.coverage.complete, false, "Incomplete vector coverage was reported complete");
        const expected = [near, ...tied, far];
        equal(result.rows.map(({ ref, updatedAtUs }) => [projectRef(ref), updatedAtUs]),
          expected.map(({ ref, updatedAtUs }) => [projectRef(ref), updatedAtUs]), "Vector refs or order");
        const distances = [0.1, 0.5, 0.5, 0.5, 1.2];
        for (const [i, candidate] of result.rows.entries()) {
          check(Math.abs(candidate.distance - distances[i]) < 1e-6, "Unexpected cosine distance");
        }
        const capped = await search(tx, query, 2);
        equal(capped.rows.map(({ ref }) => projectRef(ref)), expected.slice(0, 2).map(({ ref }) => projectRef(ref)),
          "Vector depth did not return the first two candidates");
        equal([capped.coverage.eligible, capped.coverage.embedded, capped.coverage.complete], [eligible, 5, false],
          "Vector depth changed coverage");
        const wider = new Float32Array(query.length + 1);
        wider.set(query);
        const mismatch = await search(tx, wider, 10);
        equal([mismatch.coverage.eligible, mismatch.coverage.embedded, mismatch.coverage.complete], [eligible, 0, false],
          "Mismatched vector query coverage");
        equal(mismatch.rows.length, 0, "Mismatched vector query returned rows");
      });
    },
  },
  {
    id: "K-RET-9", title: "pages visible recent memories across namespaces and ties", needs: [],
    async run(ctx) {
      const { adapter: { uow, recent }, owner } = ctx;
      const first = ctx.scope(null);
      const second = ctx.scope("shared");
      const readSet = { owner, namespaces: [first.namespace, second.namespace] };
      const visible = [
        await insert(ctx, first, await row(ctx, "oldest"), 7000n),
        await insert(ctx, first, await row(ctx, "first tie"), 7001n),
        await insert(ctx, second, await row(ctx, "second tie"), 7001n),
        await insert(ctx, first, await row(ctx, "third tie"), 7001n),
        await insert(ctx, second, await row(ctx, "newest"), 7002n),
      ].sort(newestFirst);
      const hidden = await insert(ctx, second, await row(ctx, "hidden"), 7003n);
      const erased = await insert(ctx, first, await row(ctx, "erased"), 7004n);
      await insert(ctx, ctx.scope("outside"), await row(ctx, "elsewhere"), 7005n);
      await hide(ctx, second, hidden.ref);
      await erase(ctx, first, erased.ref);

      /** @param {string | null} cursor */
      const read = (cursor) => uow.run(owner, { readOnly: true }, (tx) => recent.recent(tx, readSet, { cursor, limit: 2 }));
      const readers = [[await read(null)], [await read(null)]];
      for (const [index, missingCursor] of [
        "Missing recent first-page continuation", "Missing recent second-page continuation",
      ].entries()) {
        for (const pages of readers) {
          const { nextCursor } = pages[index];
          check(nextCursor !== null, missingCursor);
          pages.push(await read(nextCursor));
        }
      }
      const expected = groupRecent(visible.map(({ ref, updatedAtUs, text }) => [ref.id, ref.namespace, updatedAtUs, text]));
      for (const pages of readers) {
        equal(pages[2].nextCursor, null, "Final recent page had a continuation");
        equal(pages.map(({ items }) => items.length), [2, 2, 1], "Recent page sizes");
        const seen = groupRecent(pages.flatMap(({ items }) => items.map(projectRecent)));
        equal(seen, expected, "Recent pages did not contain exactly the visible rows in order");
      }
      await rejects(() => read(""), "invalid_cursor");
      await rejects(() => read("%%%"), "invalid_cursor");
      await rejects(() => uow.run(owner, { readOnly: true }, (tx) =>
        recent.recent(tx, readSet, { cursor: null, limit: 0 })), "invalid_input");
    },
  },
  {
    id: "K-SNAP-1", title: "binds state tokens to the owner revision and read set", needs: [],
    async run(ctx) {
      const { adapter: { uow, memories, snapshot }, owner, otherOwner } = ctx;
      const readSet = { owner, namespaces: [null, "shared"], clients: ["one", "two"] };
      const capture = () => uow.run(owner, { readOnly: true }, async (tx) => {
        const token = await snapshot.stateToken(tx, readSet);
        await snapshot.assertUnchanged(tx, readSet, token);
        return token;
      });
      /** @param {string} token @param {import("@cairn-ink/core/ports").RetrievalScope} [scope] */
      const confirm = (token, scope = readSet) =>
        uow.run(owner, { readOnly: true }, (tx) => snapshot.assertUnchanged(tx, scope, token));
      const token = await capture();
      equal(await capture(), token, "State token changed without writes");
      await confirm(token);
      await confirm(token, { owner, namespaces: ["shared", null], clients: ["two", "one"] });

      const other = ctx.scope("outside");
      const content = await row(ctx, "snapshot write");
      const otherContent = ctx.adapter.capabilities.embeddingRequiredOnInsert ? await row(ctx, content.text) : content;
      const rolledBack = new Error("rollback");
      try {
        await uow.run(owner, {}, async (tx) => {
          await memories.insert(tx, other, content, [], 1);
          throw rolledBack;
        });
        check(false, "Snapshot fixture did not roll back");
      } catch (error) {
        equal(error === rolledBack, true, "Unexpected rollback error");
      }
      await confirm(token);
      await uow.run(otherOwner, {}, (tx) => memories.insert(tx, { ...other, owner: otherOwner }, otherContent, [], 1));
      equal(await capture(), token, "State token changed after another owner's write");
      await confirm(token);
      await rejects(() => confirm(token, { ...readSet, namespaces: [null] }), "cursor_stale");
      await rejects(() => confirm(token, { ...readSet, clients: ["one"] }), "cursor_stale");
      await rejects(() => confirm("%%%"), "invalid_cursor");
      const { id } = await uow.run(owner, {}, (tx) => memories.insert(tx, other, content, [], 1));
      const afterInsert = await capture();
      await rejects(() => confirm(token), "cursor_stale");
      await ctx.harness.setWriteTime(other, id, 8001n);
      const afterTime = await capture();
      await rejects(() => confirm(afterInsert), "cursor_stale");
      await hide(ctx, other, memoryRef(other, id));
      await capture();
      await rejects(() => confirm(afterTime), "cursor_stale");
    },
  },
  {
    id: "K-HYD-1", title: "hydrates visible refs in input order with receipts and source dates", needs: [],
    async run(ctx) {
      const { adapter: { uow, hydrate }, owner } = ctx;
      const { readSet, refs, visible, dated } = await refFixture(ctx);
      const expected = [
        { ref: projectRef(visible[0]), memory: [visible[0].id, visible[0].namespace, "referenced"],
          receipts: new Set(dated.map(projectReceipt)), sourceDates: [20, 90] },
        { ref: projectRef(visible[1]), memory: [visible[1].id, visible[1].namespace, "unreferenced"],
          receipts: new Set(), sourceDates: [null, null] },
      ];
      await uow.run(owner, { readOnly: true }, async (tx) => {
        for (const [input, ordered] of /** @type {const} */ ([
          [refs, expected], [refs.slice().reverse(), expected.slice().reverse()],
        ])) {
          for (const intent of /** @type {const} */ (["recall", "read", "export"])) {
            const items = await hydrate.hydrate(tx, readSet, input, intent);
            equal(items.map(({ ref }) => projectRef(ref)), ordered.map(({ ref }) => ref),
              "Hydrate refs did not preserve the visible input order");
            equal(items.map(({ memory }) => memory && [memory.id, memory.scope.namespace, memory.text]),
              ordered.map(({ memory }) => memory), "Hydrate did not return the referenced memories");
            equal(items.map(({ receipts }) => receipts && new Set(receipts.map(projectReceipt))),
              ordered.map(({ receipts }) => receipts), "Hydrate receipts were missing or changed");
            equal(items.map(({ sourceDates }) => sourceDates && [sourceDates.firstMs, sourceDates.lastMs]),
              ordered.map(({ sourceDates }) => sourceDates), "Hydrate source dates");
          }
        }
      });
    },
  },
  {
    id: "K-HYD-2", title: "hydrates historical rows for read and export and drops them for recall and fence",
    needs: ["supersession"], pending: "awaiting the supersession suite",
    async run(ctx) {
      const { adapter: { uow, supersession, hydrate, fence, memories }, owner } = ctx;
      check(supersession, "Supersession was enabled without a supersession port");
      const scope = ctx.scope(null);
      const readSet = { owner, namespaces: [scope.namespace] };
      const { ref } = await insert(ctx, scope, await row(ctx, "historical"), 9001n);
      await uow.run(owner, {}, (tx) => supersession.markHistorical(tx, scope, ref.id, 2));
      await uow.run(owner, { readOnly: true }, async (tx) => {
        for (const intent of /** @type {const} */ (["read", "export"])) {
          const items = await hydrate.hydrate(tx, readSet, [ref], intent);
          equal(items.map(({ ref, memory }) => [projectRef(ref), memory?.historical]), [[projectRef(ref), true]],
            "Hydrate dropped a historical row");
        }
        equal((await hydrate.hydrate(tx, readSet, [ref], "recall")).length, 0, "Recall included a historical row");
        equal((await fence.assertVisible(tx, readSet, [ref])).length, 0, "Fence included a historical row");
        const page = await memories.exportPage(tx, scope, { cursor: null, limit: 2 });
        equal(page.items.map(({ id }) => id), [ref.id], "Export page dropped a historical row");
      });
    },
  },
  {
    id: "K-FEN-1", title: "returns the still-visible refs in input order", needs: [],
    async run(ctx) {
      const { adapter: { uow, fence }, owner } = ctx;
      const { readSet, refs, visible } = await refFixture(ctx);
      await uow.run(owner, { readOnly: true }, async (tx) => {
        for (const [input, ordered] of [[refs, visible], [refs.slice().reverse(), visible.slice().reverse()]]) {
          equal((await fence.assertVisible(tx, readSet, input)).map(projectRef), ordered.map(projectRef),
            "Fence did not return exactly the visible refs in input order");
        }
      });
    },
  },
  {
    id: "K-CAP-2", title: "exposes the vector port exactly when semantic retrieval is enabled", needs: [],
    requests: { semanticRetrieval: true },
    async run({ adapter }) {
      assertAdapterCapabilities(adapter);
      if (adapter.capabilities.semanticRetrieval) check(adapter.vector != null, "Vector port was missing");
      else check(adapter.vector == null, "Vector port was present with its flag off");
    },
    followUp: {
      needs: [], needsOff: ["semanticRetrieval"],
      async run({ adapter }) {
        assertAdapterCapabilities(adapter);
        check(adapter.vector == null, "Vector port was present with its flag off");
      },
    },
  },
];
