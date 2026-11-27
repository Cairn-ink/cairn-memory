import { canonicalPair, compareUtf8, CoreError, RELATION_LIMIT } from "@cairn-ink/core";
import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock } from "./context-assembly-cases.mjs";
import { check, equal, readDump, rejects, row, source } from "./support.mjs";

/** @import { CallOptions, DiagnosticEvent, ItemRef, ModelGate, ModelRequest, ModelStage, Receipt, Scope } from "@cairn-ink/core/ports" */
/** @import { MemoryServiceDeps } from "@cairn-ink/core/service" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */
/** @typedef {{ id: string; revision: number }} Endpoint */
/** @typedef {{ messages: unknown[]; items: unknown[]; candidates: { index: number; content: string; kind: string; receipts: unknown[] }[] }} RequestInput */
/** @typedef {(request: ModelRequest) => unknown} Reply */

const empty = { status: "judged", superseded: [], contradicts: [], skipped: 0 };
const noCandidates = { status: "skipped", reason: "no_candidates" };
const stale = { status: "skipped", reason: "stale" };
const paused = { status: "paused" };

/** @param {string} relation @param {number} [predecessorIndex] */
const verdict = (relation, predecessorIndex = 0) => ({
  replacementIndex: 0, predecessorIndex, evidenceIndices: [0], relation, valueChange: "changed", adoption: "explicit",
});

/** @param {ReturnType<typeof verdict>[]} transitions */
const output = (...transitions) => ({ transitions });

/** @param {CaseContext} ctx @param {{reply?: Reply; configure?: (deps: MemoryServiceDeps) => MemoryServiceDeps}} [options] */
function fixture(ctx, { reply = () => output(), configure = deps => deps } = {}) {
  const scope = ctx.scope(null);
  let runs = 0;
  /** @type {{ stage: ModelStage; request: ModelRequest; options: CallOptions }[]} */
  const calls = [];
  /** @type {string[][]} */
  const embeddings = [];
  /** @type {number[]} */
  const depths = [];
  /** @type {Parameters<ModelGate["assertOpen"]>[1][]} */
  const gates = [];
  const { adapter } = ctx;
  const { uow, memories, vector, supersession, conflicts } = adapter;
  check(supersession && conflicts && vector, "Judge fixture requires both relation stores and vector retrieval");

  const storage = {
    ...adapter,
    name: "judge-conformance",
    uow: {
      /** @type {typeof uow.run} */
      run(owner, options, fn) {
        return uow.run(owner, options, async tx => {
          runs++;
          try { return await fn(tx); } finally { runs--; }
        });
      },
    },
    vector: {
      /** @type {typeof vector.vector} */
      vector(tx, rs, query, model, depth) {
        depths.push(depth);
        return vector.vector(tx, rs, query, model, depth);
      },
    },
  };

  /** @type {MemoryServiceDeps} */
  const deps = {
    storage,
    clock: assemblyClock(),
    config: {},
    gate: {
      async assertOpen(owner, phase) {
        equal(owner, scope.owner, "Gate owner");
        equal(runs, 0, "Gate ran inside a transaction");
        gates.push(phase);
      },
    },
    model: {
      model: "fixture", contextWindow: 8192, countTokens: () => 1,
      async call(stage, request, options) {
        equal(runs, 0, "Model ran inside a transaction");
        calls.push({ stage, request, options });
        return reply(request);
      },
    },
    embedder: {
      model: "test", dimensions: ctx.vec(0).length,
      async embed(texts) {
        equal(runs, 0, "Embedder ran inside a transaction");
        embeddings.push([...texts]);
        return texts.map(() => new Float32Array(ctx.vec(0)));
      },
    },
    tokens: { countTokens: () => 1 },
  };
  const api = createMemoryService(configure(deps));

  /** @param {string} text @param {number} distance
   * @param {{ at?: number; scope?: Scope; receipts?: readonly Receipt[]; model?: string }} [options] */
  async function insert(text, distance, { at = 1, scope: where = scope, receipts = [], model = "test" } = {}) {
    const data = await row(ctx, text, distance);
    if (data.embedding) data.embedding.model = model;
    const { id, revision } = await uow.run(where.owner, {}, tx => memories.insert(tx, where, data, receipts, at));
    return { id, revision };
  }

  /** @param {Endpoint} memory @param {CallOptions} [options] */
  async function judge(memory, options) {
    check(api.judgeRelations, "Missing judgeRelations");
    const result = await api.judgeRelations(scope, memory, options);
    if (result.status !== "judged") return result;
    const { indexRevision, ...verdicts } = result;
    const committed = await uow.run(scope.owner, { readOnly: true }, async tx => memories.indexRevision?.(tx));
    if (indexRevision !== undefined && committed !== undefined) equal(indexRevision, committed, "Committed index revision");
    return verdicts;
  }

  /** @param {Endpoint} memory @param {string} text */
  async function edit(memory, text) {
    const data = await row(ctx, text, 0.2);
    const changed = await uow.run(scope.owner, { pauseLock: true }, tx =>
      memories.replaceContent(tx, scope, memory.id, memory.revision, data, null, 2));
    check(changed.revision > memory.revision, "Edit did not advance revision");
  }

  /** @param {Endpoint} memory */
  const read = memory => api.read(scope, { type: "memory", id: memory.id });
  /** @param {Endpoint} memory */
  const links = memory => uow.run(scope.owner, { readOnly: true }, tx => supersession.read(tx, scope, memory.id));
  /** @param {Endpoint} memory */
  const edges = memory => uow.run(scope.owner, { readOnly: true }, tx => conflicts.list(tx, scope, memory.id));
  /** @param {Endpoint} memory */
  const counts = memory => uow.run(scope.owner, { readOnly: true }, async tx => ({
    incoming: await supersession.incomingCount(tx, scope, memory.id), degree: await conflicts.degree(tx, scope, memory.id),
  }));

  /** @param {Endpoint} a @param {Endpoint} b @param {"explicit-hint" | "inferred-hint"} [source] */
  const seedConflict = (a, b, source = "inferred-hint") => {
    const [left, right] = canonicalPair(a.id, b.id)[0] === a.id ? [a, b] : [b, a];
    return uow.run(scope.owner, {}, tx => conflicts.insert(tx, scope, { left, right, relation: "contradicts", source }, 2));
  };

  /** @param {Endpoint} old @param {Endpoint} replacement */
  const seedSupersession = (old, replacement) => {
    return uow.run(scope.owner, {}, async tx => {
      await supersession.record(tx, scope, { previous: old, replacement }, [], 2);
      await supersession.markHistorical(tx, scope, old.id, 2);
    });
  };

  /** @param {number} [index] */
  function request(index = 0) {
    return /** @type {RequestInput} */ (calls[index].request.input);
  }

  return { scope, deps, api, calls, depths, gates, embeddings, insert, judge, edit, read, links, edges, counts,
    seedConflict, seedSupersession, request };
}

/** @param {CaseContext} ctx @param {Endpoint} memory */
function suppress(ctx, memory) {
  return ctx.harness.seedFact(ctx.owner, { owner: ctx.owner, namespace: null, kind: "identity",
    memoryId: memory.id, origin: "forget", actionId: "judge-suppression" });
}

/** @param {string} id @param {string} title @param {ConformanceCase["run"]} run @returns {ConformanceCase} */
function relationCase(id, title, run) {
  return { id: `K-RELJ-${id}`, title, needs: ["supersession", "conflictEdges", "semanticRetrieval"], run };
}

/** @type {readonly ConformanceCase[]} */
export const relationJudgeCases = [
  relationCase("1", "supersedes a previous row after commit without receipt provenance", async ctx => {
    /** @type {(readonly string[])[]} */
    const recorded = [];
    const f = fixture(ctx, {
      reply: () => output(verdict("supersedes")),
      configure(deps) {
        const { supersession } = deps.storage;
        check(supersession, "Missing supersession store");
        return { ...deps, storage: { ...deps.storage, supersession: { ...supersession,
          record(tx, scope, edge, receiptIds, time) {
            recorded.push(receiptIds);
            return supersession.record(tx, scope, edge, receiptIds, time);
          },
        } } };
      },
    });
    const previous = await f.insert("The studio closes at four.", 0.2);
    const saved = await f.api.save(f.scope, "The studio now closes at six.", source, "fact");
    check(saved.status === "saved", "Replacement was not explicitly saved");
    const { id, revision } = saved.item;
    const memory = { id, revision };
    equal(f.calls.length, 0, "Save invoked the judge inline");
    const embeddingCalls = f.embeddings.length;
    f.gates.length = 0;
    equal(await f.judge(memory), { ...empty, superseded: [previous.id] }, "Supersession result");
    const old = await f.read(previous);
    const current = await f.read(memory);
    check(old.status === "found" && old.item.historical && old.item.revision === previous.revision + 1, "Previous row was not retired");
    check(current.status === "found" && !current.item.historical && current.item.revision === memory.revision, "Replacement changed");
    equal(await f.links(previous), { supersededBy: memory.id, supersedes: [] }, "Supersession read");
    equal(recorded, [[]], "The judge attached receipts");
    equal(f.embeddings.length, embeddingCalls, "Stored embedding was not reused");
    equal(f.gates, ["pre-send", "dispatch", "post-send"], "Model gate phases");
  }),

  relationCase("2", "adds a revision-bound inferred contradiction visible from both ends", async ctx => {
    const f = fixture(ctx, { reply: () => output(verdict("contradicts")) });
    const previous = await f.insert("The lab is closed.", 0.2);
    const memory = await f.insert("The lab is open.", 0);
    equal(await f.judge(memory), { ...empty, contradicts: [previous.id] }, "Contradiction result");
    for (const [from, to] of [[previous, memory], [memory, previous]]) {
      equal(await f.edges(from), [{ memoryId: to.id, revision: to.revision, relation: "contradicts", source: "inferred-hint" }], "Conflict read");
      const item = await f.read(from);
      check(item.status === "found" && !item.item.historical, "Contradiction retired a row");
    }
  }),

  relationCase("3", "discards all nonwriting verdicts", async ctx => {
    const relations = ["reaffirms", "compatible", "unresolved", "historical_context"];
    const f = fixture(ctx, { reply: () => output(...relations.map(verdict)) });
    const memory = await f.insert("Current work schedule", 0);
    for (const relation of relations) await f.insert(relation, 0.2);
    const before = await readDump(ctx.harness);
    equal(await f.judge(memory), empty, "Nonwriting verdicts");
    equal(f.calls.length, 1, "Missing model call");
    equal(await readDump(ctx.harness), before, "Nonwriting verdicts changed storage");
  }),

  relationCase("4", "does not call the model for self, near duplicates, or distant memories", async ctx => {
    const f = fixture(ctx);
    const memory = await f.insert("Current route", 0);
    await f.insert("Near duplicate", 0.05);
    await f.insert("Distant memory", 0.5);
    equal(await f.judge(memory), noCandidates, "Distance band");
    equal(f.calls.length, 0, "Empty band sent a model request");
    equal(f.depths, [16], "Vector depth");
  }),

  relationCase("5", "sends exactly five by distance, microseconds, and descending id", async ctx => {
    const f = fixture(ctx);
    const memory = await f.insert("Current route", 0);
    for (let index = 0; index < 6; index++) await f.insert(`Near duplicate ${index}`, 0.05);
    await f.insert("Closest in band", 0.1);
    await f.insert("Earlier in tied distance", 0.2);
    const tie = [];
    for (const text of ["Tied first", "Tied second", "Tied third"]) {
      const item = await f.insert(text, 0.2);
      await ctx.harness.setWriteTime(f.scope, item.id, 1001n);
      tie.push({ ...item, text });
    }
    await f.insert("More distant in band", 0.3);
    await f.insert("Last in band", 0.4);
    equal(await f.judge(memory), empty, "Ranking result");
    equal(f.depths, [16], "Vector depth");
    equal(f.request().candidates.map(({ content }) => content),
      ["Closest in band", ...tie.sort((a, b) => compareUtf8(b.id, a.id)).map(item => item.text), "Earlier in tied distance"],
      "Candidate order and limit");
  }),

  relationCase("6", "sends only visible current text and ignores all hydrated receipts", async ctx => {
    const f = fixture(ctx, { configure(deps) {
      const { hydrate } = deps.storage;
      return { ...deps, storage: { ...deps.storage, hydrate: {
        async hydrate(tx, rs, refs, intent) {
          equal(intent, "read", "Hydrate intent");
          return (await hydrate.hydrate(tx, rs, refs, intent)).map(item => ({ ...item,
            receipts: item.receipts?.map(receipt => ({ ...receipt, id: "private-receipt-id", excerpt: "private excerpt" })),
          }));
        },
      } } };
    } });
    /** @type {Receipt[]} */
    const receipts = [{ client: "fixture", sessionId: "private-session", messageId: "private-message",
      role: "user", occurredAtMs: 1, excerpt: "stored excerpt" }];
    const text = "Current text for judging";
    const memory = await f.insert(text, 0, { receipts });
    await f.insert("Visible candidate", 0.25, { receipts });
    const suppressed = await f.insert("Suppressed candidate", 0.16);
    const forgotten = await f.insert("Forgotten candidate", 0.17);
    const historical = await f.insert("Historical candidate", 0.18);
    const otherOwner = { owner: ctx.otherOwner, namespace: f.scope.namespace };
    await f.insert("Other-owner candidate", 0.19, { scope: otherOwner });
    await suppress(ctx, suppressed);
    equal((await f.api.forget(f.scope, forgotten.id, source)).status, "forgotten", "Forget fixture");
    await f.seedSupersession(historical, memory);
    equal(await f.judge(memory), empty, "Visible candidate result");
    equal(f.calls[0].stage, "reconcile", "Model stage");
    equal(f.request(), {
      messages: [{ index: 0, role: "user", content: text }],
      items: [{ index: 0, content: text, kind: "fact", sourceIndices: [0] }],
      candidates: [{ index: 0, content: "Visible candidate", kind: "fact", receipts: [] }],
    }, "Provider request disclosed noncandidate data");
  }),

  relationCase("7", "pauses before sending or after the model changes the pause generation", async ctx => {
    let f = fixture(ctx, { reply: async () => {
      await f.api.setPause(f.scope.owner, true);
      return output(verdict("supersedes"));
    } });
    const memory = await f.insert("Current route", 0);
    const previous = await f.insert("Earlier route", 0.2);
    await f.api.setPause(f.scope.owner, true);
    equal(await f.judge(memory), paused, "Paused before model");
    equal(f.calls.length, 0, "Paused job called the model");
    await f.api.setPause(f.scope.owner, false);
    equal(await f.judge(memory), paused, "Paused before write");
    equal(await f.links(previous), { supersededBy: null, supersedes: [] }, "Paused job wrote a link");

    f = fixture(ctx, { reply: async () => {
      await f.api.setPause(f.scope.owner, true);
      await f.api.setPause(f.scope.owner, false);
      return output(verdict("contradicts"));
    } });
    await f.api.setPause(f.scope.owner, false);
    equal(await f.judge(memory), paused, "Changed pause generation before write");
    equal(await f.edges(previous), [], "Pause-resume during call wrote a link");
  }),

  relationCase("8", "writes nothing if the host gate closes before or after dispatch", async ctx => {
    /** @type {"pre-send" | "post-send"} */
    let closeAt = "pre-send";
    const f = fixture(ctx, {
      reply: () => output(verdict("supersedes")),
      configure: deps => ({ ...deps, gate: {
        async assertOpen(_owner, phase) {
          if (phase === closeAt) throw new CoreError("capture_paused");
        },
      } }),
    });
    const memory = await f.insert("Current route", 0);
    const previous = await f.insert("Earlier route", 0.2);
    const before = await readDump(ctx.harness);
    await rejects(() => f.judge(memory), "capture_paused");
    equal(f.calls.length, 0, "Closed gate allowed dispatch");
    closeAt = "post-send";
    await rejects(() => f.judge(memory), "capture_paused");
    equal(f.calls.length, 1, "Missing send before downstream gate closure");
    equal(await readDump(ctx.harness), before, "Closed gate allowed a write");
    equal(await f.edges(previous), [], "Closed gate persisted a conflict");
  }),

  relationCase("9", "returns stale when the committed memory revision changes in flight", async ctx => {
    /** @type {Endpoint} */
    let memory;
    const f = fixture(ctx, { reply: async () => {
      await f.edit(memory, "Edited current route");
      return output(verdict("supersedes"));
    } });
    memory = await f.insert("Current route", 0);
    const previous = await f.insert("Earlier route", 0.2);
    equal(await f.judge({ ...memory, revision: memory.revision + 1 }), stale, "Initially stale revision");
    equal(f.calls.length, 0, "Initially stale revision called the model");
    equal(await f.judge(memory), stale, "Revision changed before write");
    equal(await f.links(previous), { supersededBy: null, supersedes: [] }, "Stale job wrote a link");
  }),

  relationCase("10", "skips candidates edited, suppressed, or forgotten in flight", async ctx => {
    /** @type {Endpoint} */
    let previous;
    /** @type {(() => Promise<unknown>)[]} */
    const change = [];
    const f = fixture(ctx, { reply: async () => {
      await change.shift()?.();
      return output(verdict("contradicts"));
    } });
    const memory = await f.insert("Current route", 0);
    change.push(() => f.edit(previous, "Edited earlier route"),
      async () => equal((await f.api.forget(f.scope, previous.id, source)).status, "forgotten", "In-flight forget"),
      () => suppress(ctx, previous));

    previous = await f.insert("Earlier route", 0.2);
    equal(await f.judge(memory), { ...empty, skipped: 1 }, "Edited candidate");
    const erased = previous;
    equal(await f.judge(memory), { ...empty, skipped: 1 }, "Forgotten candidate");
    equal(await f.read(erased), { status: "not_found" }, "Forgotten memory reappeared");
    equal(await f.edges(erased), [], "Forgotten memory retained an edge");
    equal(await f.links(erased), { supersededBy: null, supersedes: [] }, "Forgotten memory retained supersession");
    equal(await f.edges(memory), [], "Surviving memory exposes the forgotten id");

    previous = await f.insert("Another earlier route", 0.2);
    equal(await f.judge(memory), { ...empty, skipped: 1 }, "Suppressed candidate");
    equal(await f.edges(memory), [], "Suppressed memory acquired an edge");
  }),

  relationCase("11", "rejects invalid model output atomically with content-free diagnostics", async ctx => {
    /** @type {DiagnosticEvent[]} */
    const events = [];
    const f = fixture(ctx, { reply: () => output(verdict("supersedes"), verdict("unresolved")) });
    const memory = await f.insert("Current route", 0);
    await f.insert("Earlier route", 0.2);
    const before = await readDump(ctx.harness);
    await rejects(() => f.judge(memory, { onDiagnostic: event => events.push(event) }), "invalid_model_output");
    equal(await readDump(ctx.harness), before, "Invalid verdict wrote a link");
    equal(events, [
      { version: 1, stage: "reconcile", layer: "core_validation", reason: "invalid_reconciliation" },
      { version: 1, stage: "reconcile", layer: "core_call", reason: "adapter_output_invalid" },
    ], "Diagnostic shape");
  }),

  relationCase("12", "skips incomplete vector coverage without sending to the model", async ctx => {
    const f = fixture(ctx);
    const memory = await f.insert("Current route", 0);
    await f.insert("Embedded earlier route", 0.2);
    await f.insert("Stale embedding model", 0.3, { model: "obsolete" });
    equal(await f.judge(memory), { status: "skipped", reason: "incomplete_coverage" }, "Partial embedding coverage");
    equal(f.calls.length, 0, "Partial coverage sent a model request");
  }),

  relationCase("13", "replays the same five candidates without duplicates or index changes", async ctx => {
    const f = fixture(ctx, { reply: () => output(...Array.from({ length: RELATION_LIMIT }, (_, i) => verdict("contradicts", i))) });
    const memory = await f.insert("Current route", 0);
    for (let i = 0; i < RELATION_LIMIT; i++) await f.insert(`Earlier route ${i}`, 0.2);
    const first = await f.judge(memory);
    check(first.status === "judged" && first.contradicts.length === RELATION_LIMIT, "First run did not reach the conflict limit");
    const before = await readDump(ctx.harness);
    equal(await f.judge(memory), empty, "Retry added or skipped links at the degree boundary");
    equal(f.request(1), f.request(0), "Replay fixture sent a different candidate set");
    equal(await f.counts(memory), { incoming: 0, degree: RELATION_LIMIT }, "Replay exceeded a relation limit");
    equal(await readDump(ctx.harness), before, "Replay wrote new state");
  }),

  relationCase("14", "does not re-supersede historical rows on a second run", async ctx => {
    const f = fixture(ctx, { reply: request => {
      const candidates = /** @type {RequestInput} */ (request.input).candidates;
      return output(...candidates.map(({ index, content }) => verdict(content === "Earlier route" ? "supersedes" : "contradicts", index)));
    } });
    const memory = await f.insert("Current route", 0);
    const previous = await f.insert("Earlier route", 0.2);
    const opposing = await f.insert("Opposing route", 0.3);
    equal(await f.judge(memory), { ...empty, superseded: [previous.id], contradicts: [opposing.id] }, "First write");
    const before = await readDump(ctx.harness);
    equal(await f.judge(memory), empty, "Retry wrote a link");
    equal(f.request(1).candidates.map(({ content }) => content), ["Opposing route"], "Retry offered a historical row");
    equal(await f.counts(memory), { incoming: 1, degree: 1 }, "Retry exceeded a relation limit");
    equal(await readDump(ctx.harness), before, "Retry changed historical state");
  }),

  relationCase("15", "counts limited verdicts and still inserts the eligible pair", async ctx => {
    const f = fixture(ctx, { reply: () => output(verdict("supersedes"), verdict("contradicts", 1),
      verdict("contradicts", 2), verdict("contradicts", 3)) });
    const memory = await f.insert("Current route", 0);
    const previous = await f.insert("Earlier route", 0.1);
    const full = await f.insert("Candidate at its degree limit", 0.2);
    const eligible = await f.insert("Eligible conflict", 0.3);
    const excess = await f.insert("Candidate past replacement limit", 0.4);
    for (let i = 0; i < RELATION_LIMIT; i++) {
      const historical = await f.insert(`Retired route ${i}`, 0.8);
      await f.seedSupersession(historical, memory);
      const distant = await f.insert(`Distant route ${i}`, 0.8);
      await f.seedConflict(full, distant);
      if (i < RELATION_LIMIT - 1) await f.seedConflict(memory, distant);
    }
    equal(await f.judge(memory), { ...empty, contradicts: [eligible.id], skipped: 3 }, "Limit handling");
    equal(await f.counts(memory), { incoming: RELATION_LIMIT, degree: RELATION_LIMIT }, "Replacement limits");
    equal(await f.counts(full), { incoming: 0, degree: RELATION_LIMIT }, "Candidate degree");
    equal(await f.links(previous), { supersededBy: null, supersedes: [] }, "Limited retirement persisted");
    equal(await f.edges(excess), [], "Excess contradiction persisted");
  }),

  relationCase("16", "requires the model, embedder, vector capability and store, and both relation stores", async ctx => {
    const f = fixture(ctx);
    const memory = await f.insert("Current route", 0);
    const { deps } = f;
    const vectorsOff = {
      ...deps.storage,
      capabilities: { ...deps.storage.capabilities, semanticRetrieval: false },
    };
    for (const unavailable of [
      { ...deps, model: null }, { ...deps, embedder: null },
      { ...deps, storage: { ...vectorsOff, vector: undefined } },
      { ...deps, storage: vectorsOff },
      ...["vector", "supersession", "conflicts"].map(port => ({ ...deps, storage: { ...deps.storage, [port]: undefined } })),
    ]) {
      const { judgeRelations } = createMemoryService(unavailable);
      check(judgeRelations, "Missing entry for capability validation");
      await rejects(() => judgeRelations(f.scope, memory), "capability_unavailable");
    }
    check(f.api.judgeRelations, "Missing entry for input validation");
    const judge = f.api.judgeRelations;
    await rejects(() => judge({ ...f.scope, owner: "" }, memory), "invalid_input");
    await rejects(() => judge(f.scope, { ...memory, id: "" }), "invalid_input");
    await rejects(() => judge(f.scope, { ...memory, revision: 0 }), "invalid_input");
    equal(f.calls.length, 0, "Invalid job called the model");
  }),

  relationCase("17", "embeds once outside the transaction if hydration omits the embedding", async ctx => {
    const f = fixture(ctx, { configure(deps) {
      const { hydrate } = deps.storage;
      return { ...deps, storage: { ...deps.storage, hydrate: {
        async hydrate(tx, rs, refs, intent) {
          return (await hydrate.hydrate(tx, rs, refs, intent)).map(item => ({
            ...item, memory: item.memory && { ...item.memory, embedding: undefined },
          }));
        },
      } } };
    } });
    const memory = await f.insert("current route", 0);
    await f.insert("Earlier route", 0.2);
    equal(await f.judge(memory), empty, "Fallback embedding");
    equal(f.embeddings, [["current route"]], "Fallback embedding count and text");
    equal(f.gates, ["dispatch", "pre-send", "dispatch", "post-send"], "Fallback gate phases");
  }),

  relationCase("18", "uses strict distance endpoints and ignores nonmemory vector references", async ctx => {
    /** @type {Endpoint} */
    let min;
    /** @type {Endpoint} */
    let max;
    const f = fixture(ctx, { configure(deps) {
      const { vector } = deps.storage;
      check(vector, "Missing vector store");
      return { ...deps, storage: { ...deps.storage, vector: {
        async vector(tx, rs, query, model, depth) {
          const result = await vector.vector(tx, rs, query, model, depth);
          /** @type {ItemRef} */
          const raw = { type: "raw", id: "raw-ref", namespace: null };
          return { ...result, rows: [
            { ref: raw, distance: 0.09, updatedAtUs: 0n },
            ...result.rows.map(item => ({ ...item, distance: item.ref.id === min.id ? 0.08 :
              item.ref.id === max.id ? 0.45 : item.distance })),
          ] };
        },
      } } };
    } });
    const memory = await f.insert("Current route", 0);
    min = await f.insert("Lower boundary", 0.08);
    max = await f.insert("Upper boundary", 0.45);
    equal(await f.judge(memory), empty, "Exact distance boundaries");
    equal(f.request().candidates.map(({ content }) => content), ["Upper boundary"], "Distance endpoint inclusion");
  }),

  relationCase("19", "retires predecessors before checking the degree of new contradictions", async ctx => {
    const f = fixture(ctx, { reply: () => output(verdict("contradicts", 1), verdict("supersedes", 0)) });
    const memory = await f.insert("Current route", 0);
    const previous = await f.insert("Earlier route", 0.2);
    const opposing = await f.insert("Opposing route", 0.3);
    await f.seedConflict(memory, previous);
    for (let i = 1; i < RELATION_LIMIT; i++) {
      const distant = await f.insert(`Distant route ${i}`, 0.8);
      await f.seedConflict(memory, distant);
    }
    equal(await f.judge(memory), { ...empty, superseded: [previous.id], contradicts: [opposing.id] }, "Supersession write order");
    equal(await f.counts(memory), { incoming: 1, degree: RELATION_LIMIT }, "Released degree was reused");
  }),

  relationCase("20", "omits the optional committed index revision when the port omits it", async ctx => {
    const f = fixture(ctx, { configure: deps => ({ ...deps, storage: {
      ...deps.storage, memories: { ...deps.storage.memories, committedIndexRevision: undefined },
    } }) });
    const memory = await f.insert("Current route", 0);
    await f.insert("Earlier route", 0.2);
    check(f.api.judgeRelations, "Missing judgeRelations");
    equal(await f.api.judgeRelations(f.scope, memory), empty, "Optional index revision");
  }),
];
