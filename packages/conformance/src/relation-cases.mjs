import { canonicalPair, compareUtf8, planConflictInsert, planSupersede, RELATION_LIMIT } from "@cairn-ink/core";
import { check, equal, rejects, row } from "./support.mjs";

/** @import { ConflictEdge, ItemRef, Scope, Tx } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @typedef {{id: string, revision: number}} Endpoint */

const emptySupersession = { supersededBy: null, supersedes: [] };

/** @param {Scope} scope @param {string} id @returns {ItemRef} */
const ref = (scope, id) => ({ type: "memory", namespace: scope.namespace, id });

/** @param {Endpoint} first @param {Endpoint} second @param {"explicit-hint" | "inferred-hint"} [source] */
function conflict(first, second, source = "explicit-hint") {
  const [left] = canonicalPair(first.id, second.id);
  const endpoints = left === first.id ? { left: first, right: second } : { left: second, right: first };
  return { ...endpoints, relation: /** @type {const} */ ("contradicts"), source };
}

/** @param {CaseContext} ctx @param {Tx} tx @param {Scope} scope @param {readonly string[]} names */
async function insert(ctx, tx, scope, names) {
  const rows = [];
  for (const name of names) rows.push(await ctx.adapter.memories.insert(tx, scope, await row(ctx, name), [], 1));
  return rows;
}

/** @param {unknown} value @param {string} erased */
function assertNoForgottenRelation(value, erased) {
  check(value !== null && typeof value === "object", "Expected a hydrated or exported memory");
  check(Reflect.get(value, "supersededBy") !== erased, "Read surface retained the forgotten replacement");
  for (const field of ["supersedes", "conflictsWith"]) {
    const links = Reflect.get(value, field);
    if (Array.isArray(links)) {
      check(links.every((link) => link !== erased && link?.memoryId !== erased), `Read surface retained a forgotten id in ${field}`);
    }
  }
}

/** @type {readonly ConformanceCase[]} */
export const relationCases = [
  {
    id: "K-REL-1", title: "records supersession and keeps historical memories out of recall",
    needs: ["supersession"], requests: { semanticRetrieval: true },
    async run(ctx) {
      const { adapter: { uow, supersession, memories, hydrate, fence, lexical, vector, recent }, owner } = ctx;
      check(supersession, "Supersession port is missing");
      const scope = ctx.scope(null);
      const selection = { owner, namespaces: [scope.namespace] };
      const original = await row(ctx, "shared topic original", 0);
      const next = await row(ctx, "shared topic replacement", 0.25);
      const { previous, replacement } = await uow.run(owner, {}, async (tx) => ({
        previous: await memories.insert(tx, scope, original, [], 1),
        replacement: await memories.insert(tx, scope, next, [], 2),
      }));
      const refs = [ref(scope, previous.id), ref(scope, replacement.id)];
      await uow.run(owner, { readOnly: true }, async (tx) => {
        const result = await lexical.lexical(tx, selection, "shared topic", 10, {});
        check(result.rows.some(({ ref }) => ref.id === previous.id), "Fixture was never a lexical candidate");
        if (vector) {
          const result = await vector.vector(tx, selection, new Float32Array(ctx.vec(0)), "test", 10);
          check(result.rows.some(({ ref }) => ref.id === previous.id), "Fixture was never a vector candidate");
        }
      });
      await uow.run(owner, {}, async (tx) => {
        planSupersede(await memories.get(tx, scope, previous.id), previous.revision, next.textHash,
          await supersession.incomingCount(tx, scope, replacement.id));
        await supersession.record(tx, scope, { previous, replacement }, [], 3);
        await supersession.markHistorical(tx, scope, previous.id, 3);
      });
      await uow.run(owner, { readOnly: true }, async (tx) => {
        equal(await supersession.read(tx, scope, previous.id), { supersededBy: replacement.id, supersedes: [] }, "Previous link differs");
        equal(await supersession.read(tx, scope, replacement.id), { supersededBy: null, supersedes: [previous.id] }, "Replacement link differs");
        equal(await supersession.incomingCount(tx, scope, replacement.id), 1, "Incoming count differs");

        equal((await lexical.lexical(tx, selection, "shared topic", 10, {})).rows.map(({ ref }) => ref.id),
          [replacement.id], "Lexical recall included a historical row");
        if (vector) {
          const result = await vector.vector(tx, selection, new Float32Array(ctx.vec(0)), "test", 10);
          equal(result.rows.map(({ ref }) => ref.id), [replacement.id], "Vector recall included a historical row");
          equal(result.coverage.eligible, 1, "Vector coverage counted a historical row");
        }
        const page = { cursor: null, limit: 10 };
        equal((await recent.recent(tx, selection, page)).items.map(({ id }) => id), [replacement.id], "Recent included a historical row");
        equal(await fence.assertVisible(tx, selection, refs), [refs[1]], "Fence included a historical row");
        equal((await hydrate.hydrate(tx, selection, refs, "recall")).map(({ ref }) => ref), [refs[1]], "Recall hydrated a historical row");
        for (const intent of /** @type {const} */ (["read", "export"])) {
          const items = await hydrate.hydrate(tx, selection, [refs[0]], intent);
          equal(items.map(({ ref, memory }) => [ref, memory?.historical, memory?.revision, memory?.updatedAtMs]),
            [[refs[0], true, previous.revision + 1, 3]], "Hydration lost the historical row or its updated metadata");
        }
        const exported = (await memories.exportPage(tx, scope, page)).items.find(({ id }) => id === previous.id);
        check(exported?.historical && exported.revision === previous.revision + 1, "Export lost the historical row or its revision");
      });
    },
  },
  {
    id: "K-REL-2", title: "refuses a second supersession for the same previous memory", needs: ["supersession"],
    async run(ctx) {
      const { adapter: { uow, supersession }, owner } = ctx;
      check(supersession, "Supersession port is missing");
      const scope = ctx.scope(null);
      const [previous, replacement, other] = await uow.run(owner, {}, async (tx) => {
        const rows = await insert(ctx, tx, scope, ["old", "replacement", "other"]);
        await supersession.record(tx, scope, { previous: rows[0], replacement: rows[1] }, ["receipt"], 2);
        return rows;
      });
      await rejects(() => uow.run(owner, {}, (tx) => supersession.record(tx, scope, { previous, replacement: other }, [], 3)), "invalid_ref");
      await uow.run(owner, { readOnly: true }, async (tx) => {
        equal((await supersession.read(tx, scope, previous.id)).supersededBy, replacement.id, "Duplicate record overwrote the replacement");
        equal(await supersession.incomingCount(tx, scope, other.id), 0, "Duplicate record created a second edge");
      });
    },
  },
  {
    id: "K-REL-3", title: "rejects the sixth incoming supersession using the stored count", needs: ["supersession"],
    async run(ctx) {
      const { adapter: { uow, supersession, memories }, owner } = ctx;
      check(supersession, "Supersession port is missing");
      const scope = ctx.scope(null);
      const names = Array.from({ length: RELATION_LIMIT + 1 }, (_, i) => `previous ${i}`);
      const [replacement, ...previousRows] = await uow.run(owner, {}, (tx) => insert(ctx, tx, scope, ["replacement", ...names]));
      const replacementTextHash = await ctx.hash("replacement");
      /** @param {Endpoint} previous */
      const retire = (previous) => uow.run(owner, {}, async (tx) => {
        planSupersede(await memories.get(tx, scope, previous.id), previous.revision, replacementTextHash,
          await supersession.incomingCount(tx, scope, replacement.id));
        await supersession.record(tx, scope, { previous, replacement }, [], 2);
        await supersession.markHistorical(tx, scope, previous.id, 2);
      });
      const accepted = previousRows.slice(0, RELATION_LIMIT);
      for (const previous of accepted) await retire(previous);
      await rejects(() => retire(previousRows[RELATION_LIMIT]), "supersession_limit");
      await uow.run(owner, { readOnly: true }, async (tx) => {
        equal(await supersession.incomingCount(tx, scope, replacement.id), RELATION_LIMIT, "Incoming count changed after refusal");
        equal((await supersession.read(tx, scope, replacement.id)).supersedes, accepted.map(({ id }) => id).sort(compareUtf8),
          "Previous ids are missing or out of byte order");
      });
    },
  },
  {
    id: "K-REL-4", title: "lists canonical conflicts from both endpoints and ignores stale revisions",
    needs: ["conflictEdges"], requests: { supersession: true },
    async run(ctx) {
      const { adapter: { uow, memories, conflicts, supersession }, owner } = ctx;
      check(conflicts, "Conflict port is missing");
      const scope = ctx.scope(null);
      const rows = await uow.run(owner, {}, (tx) => insert(ctx, tx, scope, ["one", "two", "three"]));
      const edge = conflict(rows[0], rows[1]);
      const { left, right } = edge;
      const inferred = conflict(left, right, "inferred-hint");
      const other = conflict(left, rows[2]);
      await uow.run(owner, {}, async (tx) => {
        equal(await conflicts.insert(tx, scope, inferred, 2), { inserted: true }, "Inferred edge was not inserted");
        equal(await conflicts.insert(tx, scope, other, 2), { inserted: true }, "Third endpoint was not inserted");
        equal(await conflicts.insert(tx, scope, edge, 2), { inserted: true }, "Explicit edge was not inserted");
        equal(await conflicts.insert(tx, scope, edge, 3), { inserted: false }, "Duplicate edge was inserted");
        equal(await conflicts.degree(tx, scope, left.id), 3, "Degree lost a source or counted a duplicate");
        equal(await conflicts.degree(tx, scope, right.id), 2, "Right endpoint degree differs");
        const explicit = { relation: edge.relation, source: edge.source };
        const inferredHint = { relation: inferred.relation, source: inferred.source };
        equal(await conflicts.list(tx, scope, left.id), [
          { memoryId: right.id, revision: right.revision, ...explicit },
          { memoryId: right.id, revision: right.revision, ...inferredHint },
          { memoryId: rows[2].id, revision: rows[2].revision, ...explicit },
        ].sort((a, b) => compareUtf8(a.memoryId, b.memoryId) || compareUtf8(a.source, b.source)), "Conflict order or edge metadata differs");
        equal(await conflicts.list(tx, scope, right.id), [
          { memoryId: left.id, revision: left.revision, ...explicit },
          { memoryId: left.id, revision: left.revision, ...inferredHint },
        ], "Symmetric conflict list differs");
        equal(await conflicts.invalidate(tx, scope, rows[2].id), 1, "Invalidate returned the wrong count");
        equal(await conflicts.degree(tx, scope, rows[2].id), 0, "Invalidate retained an edge");

        const editedLeft = await memories.replaceContent(tx, scope, left.id, left.revision, await row(ctx, "edited left"), null, 4);
        equal(await conflicts.list(tx, scope, right.id), [], "List returned an edge with a stale left revision");
        equal(await conflicts.degree(tx, scope, right.id), 2, "Degree ignored stale rows");
        const newLeft = { id: left.id, revision: editedLeft.revision };
        equal(await conflicts.insert(tx, scope, conflict(newLeft, right), 4), { inserted: true }, "Revised edge shared the old primary key");
        const editedRight = await memories.replaceContent(tx, scope, right.id, right.revision, await row(ctx, "edited right"), null, 5);
        equal(await conflicts.list(tx, scope, left.id), [], "List returned an edge with a stale right revision");
        if (supersession) {
          const newRight = { id: right.id, revision: editedRight.revision };
          await conflicts.insert(tx, scope, conflict(newLeft, newRight), 5);
          equal((await conflicts.list(tx, scope, right.id)).length, 1, "Fixture lacks a live conflict before retirement");
          await supersession.markHistorical(tx, scope, left.id, 6);
          equal(await conflicts.list(tx, scope, right.id), [], "List returned a historical endpoint");
          equal(await conflicts.degree(tx, scope, right.id), 0, "Retirement did not delete every touching conflict");
        }
      });
    },
  },
  {
    id: "K-REL-5", title: "rejects a sixth conflict using both endpoints' stored degrees", needs: ["conflictEdges"],
    async run(ctx) {
      const { adapter: { uow, conflicts }, owner } = ctx;
      check(conflicts, "Conflict port is missing");
      const scope = ctx.scope(null);
      const names = Array.from({ length: RELATION_LIMIT + 1 }, (_, i) => `target ${i}`);
      const [center, ...targets] = await uow.run(owner, {}, (tx) => insert(ctx, tx, scope, ["center", ...names]));
      /** @param {Endpoint} target */
      const add = (target) => uow.run(owner, {}, async (tx) => {
        const degreeAfter = new Map([
          [center.id, (await conflicts.degree(tx, scope, center.id)) + 1],
          [target.id, (await conflicts.degree(tx, scope, target.id)) + 1],
        ]);
        const [pair] = planConflictInsert(target.id, [center.id], degreeAfter);
        const edge = conflict(center, target);
        equal([edge.left.id, edge.right.id], pair, "Store inputs differ from the planner's canonical pair");
        equal(await conflicts.insert(tx, scope, edge, 2), { inserted: true }, "Planned conflict did not insert");
      });
      for (const target of targets.slice(0, RELATION_LIMIT)) await add(target);
      await rejects(() => add(targets[RELATION_LIMIT]), "conflict_limit");
      await uow.run(owner, { readOnly: true }, async (tx) => {
        equal(await conflicts.degree(tx, scope, center.id), RELATION_LIMIT, "Degree changed after refusal");
        equal(await conflicts.degree(tx, scope, targets[RELATION_LIMIT].id), 0, "Refused target gained an edge");
      });
    },
  },
  {
    id: "K-REL-6", title: "batches relation reads in scope and isolates owners", needs: ["supersession"],
    requests: { conflictEdges: true },
    async run(ctx) {
      const { adapter: { uow, supersession, conflicts }, owner, otherOwner } = ctx;
      check(supersession, "Supersession port is missing");
      const scope = ctx.scope(null);
      const otherNamespace = ctx.scope("project\u0000other");
      const foreignScope = { ...scope, owner: otherOwner };
      /** @param {Scope} selection */
      const seed = (selection) => uow.run(selection.owner, {}, async (tx) => {
        const [previous, replacement] = await insert(ctx, tx, selection, ["old value", "new value"]);
        await supersession.record(tx, selection, { previous, replacement }, [], 2);
        await conflicts?.insert(tx, selection, conflict(previous, replacement), 2);
        return [previous.id, replacement.id];
      });
      const [previous, replacement] = await seed(scope);
      const unrelated = [...await seed(otherNamespace), ...await seed(foreignScope), "unknown-memory-id"];
      const ids = [replacement, ...unrelated, previous, replacement];
      await uow.run(owner, { readOnly: true }, async (tx) => {
        const singles = new Map();
        /** @type {Map<string, ConflictEdge[]>} */
        const lists = new Map();
        for (const id of ids) {
          singles.set(id, await supersession.read(tx, scope, id));
          if (conflicts) lists.set(id, await conflicts.list(tx, scope, id));
        }
        equal(singles.get(previous), { supersededBy: replacement, supersedes: [] }, "Control supersession is missing");
        if (conflicts) equal(lists.get(previous)?.map(({ memoryId }) => memoryId), [replacement], "Control conflict is missing");
        for (const id of unrelated) {
          equal(singles.get(id), emptySupersession, "Supersession leaked an out-of-scope id");
          if (conflicts) equal(lists.get(id), [], "Conflict leaked an out-of-scope id");
        }
        if (supersession.readMany) {
          equal(await supersession.readMany(tx, scope, ids), singles, "Batch supersession results differ from single reads");
          equal(await supersession.readMany(tx, scope, []), new Map(), "Empty supersession batch produced entries");
        }
        if (conflicts?.readMany) {
          equal(await conflicts.readMany(tx, scope, ids), lists, "Batch conflict results differ from single lists");
          equal(await conflicts.readMany(tx, scope, []), new Map(), "Empty conflict batch produced entries");
        }
      });
    },
  },
  {
    id: "K-REL-7", title: "erases previous and replacement ids while preserving historical state", needs: ["supersession"],
    async run(ctx) {
      const { adapter: { uow, supersession, memories, hydrate }, owner } = ctx;
      check(supersession, "Supersession port is missing");
      const scope = ctx.scope(null);
      const selection = { owner, namespaces: [scope.namespace] };
      for (const forgotten of /** @type {const} */ (["replacement", "previous"])) {
        const { erased, survivor } = await uow.run(owner, {}, async (tx) => {
          const [previous, replacement] = await insert(ctx, tx, scope, [`former ${forgotten}`, `new ${forgotten}`]);
          await supersession.record(tx, scope, { previous, replacement }, [], 2);
          await supersession.markHistorical(tx, scope, previous.id, 2);
          const erased = forgotten === "replacement" ? replacement.id : previous.id;
          const survivor = forgotten === "replacement" ? previous.id : replacement.id;
          const before = await supersession.read(tx, scope, survivor);
          check(before.supersededBy === erased || before.supersedes.includes(erased), "Fixture lacks the link to forget");
          equal(await memories.erase(tx, scope, erased), true, "Forget did not erase the requested endpoint");
          equal(await supersession.read(tx, scope, survivor), emptySupersession, "Forget did not clear the link in the same transaction");
          equal(await supersession.incomingCount(tx, scope, replacement.id), 0, "Forget left a stored supersession row");
          return { erased, survivor };
        });
        await uow.run(owner, { readOnly: true }, async (tx) => {
          const ids = [erased, survivor];
          for (const id of ids) equal(await supersession.read(tx, scope, id), emptySupersession, "Read retained a forgotten supersession");
          if (supersession.readMany) {
            equal(await supersession.readMany(tx, scope, ids), new Map(ids.map((id) => [id, emptySupersession])),
              "Batched read retained a forgotten supersession");
          }
          for (const intent of /** @type {const} */ (["read", "export"])) {
            const items = await hydrate.hydrate(tx, selection, ids.map((id) => ref(scope, id)), intent);
            equal(items.map(({ ref }) => ref.id), [survivor], "Hydrate returned an erased memory or dropped its survivor");
            if (forgotten === "replacement") equal(items[0].memory?.historical, true, "Forgetting a replacement restored its predecessor");
            assertNoForgottenRelation(items[0].memory, erased);
          }
          const { items } = await memories.exportPage(tx, scope, { cursor: null, limit: 10 });
          check(items.some(({ id }) => id === survivor), "Export lost the surviving row");
          for (const memory of items) {
            check(memory.id !== erased, "Export returned an erased memory");
            assertNoForgottenRelation(memory, erased);
          }
        });
      }
    },
  },
  {
    id: "K-REL-8", title: "erases a conflict endpoint from every read surface", needs: ["conflictEdges"],
    async run(ctx) {
      const { adapter: { uow, conflicts, memories, hydrate }, owner } = ctx;
      check(conflicts, "Conflict port is missing");
      const scope = ctx.scope(null);
      const selection = { owner, namespaces: [scope.namespace] };
      const [erased, survivor] = await uow.run(owner, {}, async (tx) => {
        const [first, second] = await insert(ctx, tx, scope, ["forget this", "keep this"]);
        await conflicts.insert(tx, scope, conflict(first, second), 2);
        equal((await conflicts.list(tx, scope, second.id)).map(({ memoryId }) => memoryId), [first.id], "Fixture lacks the conflict to forget");
        equal(await memories.erase(tx, scope, first.id), true, "Forget did not erase the conflict endpoint");
        equal(await conflicts.degree(tx, scope, first.id), 0, "Forget did not delete the stored conflict in the same transaction");
        equal(await conflicts.list(tx, scope, second.id), [], "Forget did not clear the conflict in the same transaction");
        return [first.id, second.id];
      });
      await uow.run(owner, { readOnly: true }, async (tx) => {
        const ids = [erased, survivor];
        for (const id of ids) equal(await conflicts.list(tx, scope, id), [], "List retained a forgotten conflict");
        if (conflicts.readMany) {
          equal(await conflicts.readMany(tx, scope, ids), new Map(ids.map((id) => [id, []])), "Batch list retained a forgotten conflict");
        }
        for (const intent of /** @type {const} */ (["read", "export"])) {
          const items = await hydrate.hydrate(tx, selection, ids.map((id) => ref(scope, id)), intent);
          equal(items.map(({ ref }) => ref.id), [survivor], "Hydrate returned an erased memory or lost the surviving endpoint");
          assertNoForgottenRelation(items[0].memory, erased);
        }
        const { items } = await memories.exportPage(tx, scope, { cursor: null, limit: 10 });
        equal(items.map(({ id }) => id), [survivor], "Export returned an erased memory or lost the surviving endpoint");
        assertNoForgottenRelation(items[0], erased);
      });
    },
  },
];
