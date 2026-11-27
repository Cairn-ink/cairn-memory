import { compareUtf8, RELATION_LIMIT } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock } from "./context-assembly-cases.mjs";
import { check, equal, fixtureEmbedding, readDump, rejects, source } from "./support.mjs";

/** @import { ItemRef, MemoryRow, SaveOptions, Scope } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @import { MemoryServiceDeps } from "@cairn-ink/core/service" */

const emptySupersession = { supersededBy: null, supersedes: [] };

/** @param {CaseContext} ctx @param {Partial<MemoryServiceDeps["storage"]>} [overrides] */
function service(ctx, overrides) {
  const countTokens = () => 0;
  let time = 1_700_000_000_000;
  return createMemoryService({
    storage: { name: "relation-hint-conformance", ...ctx.adapter, ...overrides },
    clock: { ...assemblyClock(), nowMs: () => ++time },
    config: {},
    model: { model: "unused", contextWindow: 1, countTokens, async call() { throw new Error("Unexpected model call"); } },
    embedder: ctx.adapter.capabilities.embeddingRequiredOnInsert ? {
      model: "fixture-only", dimensions: ctx.embeddingDimensions ?? 1,
      async embed(texts) {
        return texts.map(() => {
          const embedding = fixtureEmbedding(ctx);
          check(embedding, "Expected a fixture embedding");
          return Float32Array.from(embedding.vector);
        });
      },
    } : null,
    gate: { async assertOpen() {} },
    tokens: { countTokens },
  });
}

/** @param {Pick<MemoryRow, "id" | "revision">} row */
const hint = ({ id, revision }) => ({ id, expectedRevision: revision });

/** @param {Scope} scope @param {string} id @returns {ItemRef} */
const ref = ({ namespace }, id) => ({ type: "memory", namespace, id });

/** @param {ReturnType<typeof service>} api @param {Scope} scope @param {string} text */
async function seed(api, scope, text) {
  const result = await api.save(scope, text, source);
  check(result.status === "saved" && !Object.hasOwn(result, "relations"), "Expected a plain new memory");
  return result.item;
}

/** @param {CaseContext} ctx @param {Scope} scope @param {readonly string[]} ids */
async function state({ adapter: { uow, memories, supersession, conflicts }, harness }, scope, ids) {
  const relations = await uow.run(scope.owner, { readOnly: true }, async tx => {
    const links = [];
    for (const id of ids) {
      links.push({
        supersession: await supersession?.read(tx, scope, id),
        incoming: await supersession?.incomingCount(tx, scope, id),
        conflicts: await conflicts?.list(tx, scope, id),
        degree: await conflicts?.degree(tx, scope, id),
      });
    }
    return { links, indexRevision: await memories.indexRevision?.(tx) };
  });
  return { ...relations, dump: await readDump(harness) };
}

/** @param {CaseContext} ctx @param {Scope} scope @param {readonly MemoryRow[]} rows @param {() => Promise<void>} act */
async function unchanged(ctx, scope, rows, act) {
  const ids = rows.map(row => row.id);
  const before = await state(ctx, scope, ids);
  await act();
  equal(await state(ctx, scope, ids), before, "Refused save changed the stored state");
}

/** @type {readonly ConformanceCase[]} */
export const relationHintCases = [
  {
    id: "K-RELH-1", title: "retires a replacement target and excludes it from search", needs: ["supersession"],
    async run(ctx) {
      const { uow, supersession, hydrate } = ctx.adapter;
      check(supersession, "Expected the supersession port");
      const api = service(ctx);
      const scope = ctx.scope(null);
      const old = await seed(api, scope, "The orchid shelf sits upstairs.");
      const find = () => api.find(scope, "orchid", { kinds: ["memory"] });
      const recall = () => api.recall(scope, "orchid", { cursor: null, limit: 10, mode: "search" });
      equal((await find()).memories.map(row => row.id), [old.id], "Predecessor must be findable before replacement");
      equal((await recall()).items.map(row => row.id), [old.id], "Predecessor must be recallable before replacement");

      const result = await api.save(scope, "The orchid shelf moved downstairs.", source, "fact", { relations: { replaces: hint(old) } });
      check(result.status === "saved", "Expected a new replacement");
      const next = result.item;
      equal(result.relations, { replaced: old.id, contradicts: [] }, "Save response lost the replacement link");
      await uow.run(scope.owner, { readOnly: true }, async tx => {
        equal(await supersession.read(tx, scope, old.id), { supersededBy: next.id, supersedes: [] }, "Predecessor link differs");
        equal(await supersession.read(tx, scope, next.id), { supersededBy: null, supersedes: [old.id] }, "Replacement link differs");
        const rows = await hydrate.hydrate(tx, { owner: scope.owner, namespaces: [scope.namespace] }, [ref(scope, old.id)], "read");
        equal(rows.map(({ memory }) => [memory?.id, memory?.historical, memory?.revision]),
          [[old.id, true, old.revision + 1]], "Predecessor must be historical at its next revision");
      });
      equal((await find()).memories.map(row => row.id), [next.id], "Find must return only the current memory");
      equal((await recall()).items.map(row => row.id), [next.id], "Recall must return only the current memory");
    },
  },
  {
    id: "K-RELH-2", title: "writes revision-bound conflicts from both ends and counts repeats once", needs: ["conflictEdges"],
    async run(ctx) {
      const { uow, conflicts } = ctx.adapter;
      check(conflicts, "Expected the conflict port");
      const api = service(ctx);
      const scope = ctx.scope(null);
      /** @type {MemoryRow[]} */
      const targets = [];
      for (let n = 0; n < RELATION_LIMIT; n++) targets.push(await seed(api, scope, `Fixture proposition ${n}.`));
      const options = { relations: { contradicts: targets.map(hint) } };
      const text = "The registry describes a contrary proposition.";
      const first = await api.save(scope, text, source, "fact", options);
      check(first.status === "saved", "Expected a new MCP save");
      const ids = targets.map(({ id }) => id);
      equal(first.relations, { replaced: null, contradicts: ids }, "MCP save response lost conflicts");

      const repeat = await api.save(scope, text, { ...source, kind: "web" }, "fact", options);
      check(repeat.status === "duplicate" && repeat.item.id === first.item.id, "Expected a web duplicate at the edge limit");
      equal(repeat.relations, first.relations, "Repeated links must remain in the result");
      const web = await api.save(scope, "The web gives an independent account.", { ...source, kind: "web" }, "fact", {
        relations: { contradicts: [hint(targets[0])] },
      });
      check(web.status === "saved", "Expected a new web save");
      const plugin = await api.save(scope, web.item.text, { ...source, kind: "plugin" }, "fact", {
        relations: { contradicts: [hint(targets[0])] },
      });
      check(plugin.status === "duplicate" && plugin.item.id === web.item.id, "Expected the plugin to reuse the web row");
      /** @param {MemoryRow} row @param {string} [source] */
      const edge = (row, source = "explicit-hint") => ({ memoryId: row.id, revision: row.revision, relation: "contradicts", source });
      await uow.run(scope.owner, { readOnly: true }, async tx => {
        equal(await conflicts.list(tx, scope, first.item.id), targets.map(target => edge(target))
          .sort((a, b) => compareUtf8(a.memoryId, b.memoryId)), "MCP conflicts differ");
        equal(await conflicts.degree(tx, scope, first.item.id), RELATION_LIMIT, "Repeat counted as an extra edge");
        for (const target of targets.slice(1)) {
          equal(await conflicts.list(tx, scope, target.id), [edge(first.item)], "A target lacks its reverse edge");
        }
        const webEdges = [edge(targets[0]), edge(targets[0], "inferred-hint")];
        equal(await conflicts.list(tx, scope, web.item.id), webEdges, "Web or plugin source differs");
        equal(await conflicts.list(tx, scope, targets[0].id), [edge(first.item), edge(web.item), edge(web.item, "inferred-hint")]
          .sort((a, b) => compareUtf8(a.memoryId, b.memoryId) || compareUtf8(a.source, b.source)), "Reverse sourced edges differ");
      });
    },
  },
  {
    id: "K-RELH-3", title: "gives the same response for all unavailable targets", needs: ["supersession", "conflictEdges"],
    async run(ctx) {
      const api = service(ctx);
      const scope = ctx.scope(null);
      const old = await seed(api, scope, "An available predecessor.");
      const forgotten = await seed(api, scope, "A coral marker to erase.");
      const foreign = await seed(api, { ...scope, owner: ctx.otherOwner }, "Another owner keeps this.");
      const elsewhere = await seed(api, ctx.scope("another-project"), "Another namespace keeps this.");
      const hidden = await seed(api, scope, "An identity-fenced endpoint.");
      equal((await api.forget(scope, forgotten.id, source)).status, "forgotten", "Forget fixture failed");
      await ctx.harness.seedFact(scope.owner, {
        ...scope, kind: "identity", memoryId: hidden.id, origin: "forget", actionId: "hide-relation-fixture",
      });
      equal((await api.read(scope, { type: "memory", id: hidden.id })).status, "not_found", "Suppressed target must be hidden");
      const baseline = await state(ctx, scope, [old.id, hidden.id]);
      const index = baseline.indexRevision === undefined ? {} : { indexRevision: baseline.indexRevision };
      for (const target of [{ id: "unknown-memory", expectedRevision: 1 }, ...[forgotten, foreign, elsewhere, hidden].map(hint)]) {
        await unchanged(ctx, scope, [old, forgotten, foreign, elsewhere, hidden], async () => {
          const result = await api.save(scope, "A proposed replacement with an unavailable target.", source, "fact", {
            relations: { replaces: hint(old), contradicts: [target] },
          });
          equal(result, { status: "not_found", ...index }, "Unavailable targets must give the same response");
        });
      }
    },
  },
  {
    id: "K-RELH-4", title: "rejects historical targets, stale revisions, and historical duplicates", needs: ["supersession", "conflictEdges"],
    async run(ctx) {
      const api = service(ctx);
      const scope = ctx.scope(null);
      const old = await seed(api, scope, "The old owner of the bicycle was Mina.");
      const next = await api.save(scope, "The bicycle now belongs to Leon.", source, "fact", { relations: { replaces: hint(old) } });
      check(next.status === "saved", "Expected a replacement for the historical fixture");
      const current = await seed(api, scope, "The bicycle rack is empty.");
      await unchanged(ctx, scope, [old, next.item, current], async () => {
        await rejects(() => api.save(scope, "A proposed update to history.", source, "fact", {
          relations: { replaces: hint({ ...old, revision: old.revision + 1 }) },
        }), "memory_historical");
        await rejects(() => api.save(scope, "A proposal using a stale guard.", source, "fact", {
          relations: { contradicts: [hint({ ...current, revision: current.revision + 1 })] },
        }), "memory_conflict");
        await rejects(() => api.save(scope, old.text, source, "fact", {
          relations: { contradicts: [hint(current)] },
        }), "invalid_input");
      });
    },
  },
  {
    id: "K-RELH-5", title: "rejects malformed hints before reading storage and rejects self-links", needs: ["supersession", "conflictEdges"],
    async run(ctx) {
      const api = service(ctx);
      const scope = ctx.scope(null);
      const target = await seed(api, scope, "The office plant is a fern.");
      const valid = hint(target);
      const noStorage = service(ctx, { uow: { ...ctx.adapter.uow, async run() { throw new Error("Malformed save reached storage"); } } });
      const malformed = [
        null, [], {}, { replaces: undefined, contradicts: undefined },
        { replaces: null }, { replaces: { id: target.id } },
        { replaces: { ...valid, id: " bad-id" } }, { replaces: { ...valid, expectedRevision: 0 } },
        { contradicts: null }, { contradicts: [] }, { contradicts: Array(1) },
        { contradicts: [{ id: "", expectedRevision: 1 }] },
        { contradicts: [{ ...valid, expectedRevision: 1.5 }] },
        { contradicts: Array.from({ length: RELATION_LIMIT + 1 }, (_, index) => ({ ...valid, id: `target-${index}` })) },
        { contradicts: [valid, valid] }, { replaces: valid, contradicts: [valid] },
      ];
      for (const relations of malformed) {
        const options = /** @type {SaveOptions} */ (/** @type {unknown} */ ({ relations }));
        equal(await noStorage.save(scope, "A malformed proposal.", source, "fact", options),
          { status: "invalid" }, "Malformed hints must return the input error result");
      }

      await unchanged(ctx, scope, [target], async () => {
        await rejects(() => api.save(scope, target.text, source, "fact", { relations: { replaces: valid } }), "invalid_input");
        await rejects(() => api.save(scope, target.text, source, "fact", {
          relations: { contradicts: [valid] },
          receipt: { client: "fixture", sessionId: "fixture-session", messageId: "self-link", occurredAtMs: 100, role: "user" },
        }), "invalid_input");
      });
    },
  },
  {
    id: "K-RELH-6", title: "rolls back a sixth incoming supersession", needs: ["supersession"],
    async run(ctx) {
      const { uow, supersession } = ctx.adapter;
      check(supersession, "Expected the supersession port");
      const api = service(ctx);
      const scope = ctx.scope(null);
      const next = await seed(api, scope, "A consolidated account of the incident.");
      /** @type {MemoryRow[]} */
      const previous = [];
      for (let n = 0; n <= RELATION_LIMIT; n++) previous.push(await seed(api, scope, `Prior account number ${n}.`));
      /** @param {MemoryRow} old */
      const replace = old => api.save(scope, next.text, source, "fact", { relations: { replaces: hint(old) } });
      for (const old of previous.slice(0, RELATION_LIMIT)) {
        const result = await replace(old);
        check(result.status === "duplicate" && result.item.id === next.id, "Expected supersession on the reused row");
      }
      equal(await uow.run(scope.owner, { readOnly: true }, tx => supersession.incomingCount(tx, scope, next.id)),
        RELATION_LIMIT, "Replacement must start at the incoming limit");
      await unchanged(ctx, scope, [next, ...previous], () => rejects(() => replace(previous[RELATION_LIMIT]), "supersession_limit"));
    },
  },
  {
    id: "K-RELH-7", title: "rolls back both kinds of links when either conflict endpoint is full", needs: ["supersession", "conflictEdges"],
    async run(ctx) {
      const api = service(ctx);
      const scope = ctx.scope(null);
      const old = await seed(api, scope, "A candidate for retirement.");
      const peer = await seed(api, scope, "A candidate conflict peer.");
      const targets = [];
      for (let n = 0; n < RELATION_LIMIT; n++) targets.push(await seed(api, scope, `Contrary testimony ${n}.`));
      const full = await api.save(scope, "A report with maximum conflicting accounts.", source, "fact", {
        relations: { contradicts: targets.map(hint) },
      });
      check(full.status === "saved", "Expected a memory with five edges");
      await unchanged(ctx, scope, [old, peer, full.item, ...targets], async () => {
        await rejects(() => api.save(scope, full.item.text, source, "fact", {
          relations: { contradicts: [hint(peer)] },
        }), "conflict_limit");
        await rejects(() => api.save(scope, "A new report that cannot be linked.", source, "fact", {
          relations: { replaces: hint(old), contradicts: [hint(full.item)] },
        }), "conflict_limit");
      });
    },
  },
  {
    id: "K-RELH-8", title: "paused and suppressed saves leave both relation stores unchanged", needs: ["supersession", "conflictEdges"],
    async run(ctx) {
      const api = service(ctx);
      const scope = ctx.scope(null);
      const old = await seed(api, scope, "A proposed predecessor for a withheld save.");
      const peer = await seed(api, scope, "A proposed peer for a withheld save.");
      const erased = await seed(api, scope, "Amaranth grows alongside the river.");
      equal((await api.forget(scope, erased.id, source)).status, "forgotten", "Forget fixture failed");
      const options = { relations: { replaces: hint(old), contradicts: [hint(peer)] } };
      await api.setPause(scope.owner, true);
      await unchanged(ctx, scope, [old, peer], async () => {
        equal((await api.save(scope, "An unrelated suggestion.", source, "fact", options)).status, "paused", "Save must honor pause");
      });
      await api.setPause(scope.owner, false);
      await unchanged(ctx, scope, [old, peer], async () => {
        const result = await api.save(scope, erased.text, source, "fact", options);
        check(result.status === "suppressed" && !Object.hasOwn(result, "relations"), "Suppression must withhold the save and its links");
      });
    },
  },
  {
    id: "K-RELH-9", title: "links a duplicate row and removes its links on forget", needs: ["supersession", "conflictEdges"],
    async run(ctx) {
      const { uow, memories, supersession, conflicts, hydrate } = ctx.adapter;
      check(supersession && conflicts, "Expected both relation ports");
      const api = service(ctx);
      const scope = ctx.scope(null);
      const old = await seed(api, scope, "The store used to close at sunset.");
      const peer = await seed(api, scope, "The store sometimes stays open all night.");
      const current = await seed(api, scope, "The store closes at six.");
      const duplicate = await api.save(scope, current.text, source, "fact", {
        relations: { replaces: hint(old), contradicts: [hint(peer)] },
      });
      check(duplicate.status === "duplicate" && duplicate.item.id === current.id, "Expected the existing row");
      equal(duplicate.relations, { replaced: old.id, contradicts: [peer.id] }, "Duplicate response lost links");
      await uow.run(scope.owner, { readOnly: true }, async tx => {
        equal((await supersession.read(tx, scope, old.id)).supersededBy, current.id, "Predecessor must point to the duplicate");
        equal((await conflicts.list(tx, scope, peer.id)).map(edge => [edge.memoryId, edge.revision]),
          [[current.id, duplicate.item.revision]], "Conflict must point to the written duplicate revision");
      });

      equal((await api.forget(scope, current.id, source)).status, "forgotten", "Replacement forget failed");
      const ids = [old.id, peer.id, current.id];
      await uow.run(scope.owner, { readOnly: true }, async tx => {
        for (const id of ids) {
          equal(await supersession.read(tx, scope, id), emptySupersession, "Supersession retained a forgotten id");
          equal(await conflicts.list(tx, scope, id), [], "Conflict list retained a forgotten id");
          equal(await conflicts.degree(tx, scope, id), 0, "Forget retained a stored conflict");
        }
        equal(await supersession.incomingCount(tx, scope, current.id), 0, "Forget retained a stored supersession");
        if (supersession.readMany) {
          equal(await supersession.readMany(tx, scope, ids), new Map(ids.map(id => [id, emptySupersession])), "Batched supersession retained a forgotten id");
        }
        if (conflicts.readMany) {
          equal(await conflicts.readMany(tx, scope, ids), new Map(ids.map(id => [id, []])), "Batched conflicts retained a forgotten id");
        }
        const items = await hydrate.hydrate(tx, { owner: scope.owner, namespaces: [scope.namespace] },
          ids.map(id => ref(scope, id)), "read");
        const survivingOld = items.find(({ ref }) => ref.id === old.id)?.memory;
        check(survivingOld?.historical && survivingOld.revision === old.revision + 1, "Forget changed the predecessor's historical revision");
        check(items.every(({ ref }) => ref.id !== current.id), "Read hydration retained the forgotten row");
        const page = await memories.exportPage(tx, scope, { limit: 10, cursor: null });
        check(page.items.some(row => row.id === old.id && row.historical) &&
          page.items.every(row => row.id !== current.id), "Export lost the historical row or retained the forgotten row");
      });
    },
  },
  {
    id: "K-RELH-10", title: "requires the requested relation store when its capability is off",
    needs: ["supersession"], needsOff: ["conflictEdges"],
    async run(ctx) {
      const api = service(ctx);
      const scope = ctx.scope(null);
      const target = await seed(api, scope, "A conflict target without a conflict store.");
      await unchanged(ctx, scope, [target], () => rejects(() => api.save(scope, "A proposed conflict.", source, "fact", {
        relations: { contradicts: [hint(target)] },
      }), "capability_unavailable"));
    },
    followUp: {
      needs: ["conflictEdges"], needsOff: ["supersession"],
      async run(ctx) {
        const api = service(ctx);
        const scope = ctx.scope(null);
        const target = await seed(api, scope, "A replacement target without a supersession store.");
        await unchanged(ctx, scope, [target], () => rejects(() => api.save(scope, "A proposed replacement.", source, "fact", {
          relations: { replaces: hint(target) },
        }), "capability_unavailable"));
      },
    },
  },
];
