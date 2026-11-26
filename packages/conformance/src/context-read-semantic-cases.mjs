import { createMemoryService } from "@cairn-ink/core/service";
import { assemblyClock, fixtureCount, formatAssembly } from "./context-assembly-cases.mjs";
import { check, equal, evidence, rejects, row, source } from "./support.mjs";

/** @import { CallOptions, ContextCandidateDiagnostics, ContextMemoryRef, ContextReadSet, FindCandidatesInput, HydratedItem,
  ReadContractStorage, Receipt, VectorRow } from "@cairn-ink/core/ports" */
/** @import { CaseContext, ConformanceCase } from "./index.d.mts" */

const model = "test";
const lexicalText = "Migration route for the petrel is unknown.";
const semanticText = "Albatrosses follow predictable ocean corridors.";

/** @param {CaseContext} ctx */
function fixture(ctx) {
  const storage = /** @type {ReadContractStorage} */ (ctx.adapter);
  const { contextRead, vector, hydrate } = storage;
  check(contextRead && vector && hydrate, "Expected lexical, vector and hydration ports");
  const scope = ctx.scope(null);
  /** @type {ContextReadSet} */
  const set = { owner: scope.owner, namespaces: [scope.namespace], accessGenerations: [1] };
  /** @type {FindCandidatesInput} */
  const request = { query: "  PETREL  route  ", types: ["memory"], intent: "current" };
  const controls = { model, fail: false, hang: false, forceIncomplete: false, keepCoverageAcrossModels: false, embedCalls: 0,
    /** @type {AbortSignal | undefined} */ lastSignal: undefined, /** @type {VectorRow[]} */ staleRows: [],
    /** @type {number | undefined} */ lastDeadline: undefined,
    /** @type {HydratedItem[]} */ staleMemories: [],
  };
  /** @type {WeakSet<object>} */
  const lexicalTransactions = new WeakSet();
  /** @type {WeakSet<object>} */
  const vectorTransactions = new WeakSet();
  let activeTransactions = 0;
  const clock = assemblyClock();
  const assemblyDeps = { clock, contextReadFormat: formatAssembly, contextReadCounter: { count: fixtureCount } };
  const service = createMemoryService({
    storage: { ...storage, uow: { run(owner, options, operation) {
      return storage.uow.run(owner, options, async tx => {
        activeTransactions++;
        try { return await operation(tx); }
        finally { activeTransactions--; }
      });
    } }, contextRead: { ...contextRead, lexical(tx, ...args) {
      lexicalTransactions.add(tx);
      return contextRead.lexical(tx, ...args);
    } }, vector: { async vector(tx, ...args) {
      if (!controls.keepCoverageAcrossModels) check(lexicalTransactions.has(tx), "Lexical and vector must share a transaction");
      vectorTransactions.add(tx);
      if (controls.keepCoverageAcrossModels) args[2] = model;
      const { rows, coverage } = await vector.vector(tx, ...args);
      return { rows: [...controls.staleRows, ...rows], coverage: { ...coverage, complete: coverage.complete && !controls.forceIncomplete } };
    } }, hydrate: { async hydrate(tx, readSet, refs, intent) {
      check(vectorTransactions.has(tx), "Vector candidates must hydrate in their retrieval transaction");
      const current = await hydrate.hydrate(tx, readSet, refs, intent);
      const stale = controls.staleMemories.filter(({ ref }) =>
        refs.some(candidate => candidate.id === ref.id && candidate.namespace === ref.namespace && candidate.type === ref.type));
      return [...current, ...stale];
    } } }, ...assemblyDeps, config: {},
    model: { model: "unused", contextWindow: 1, countTokens: () => 0,
      async call() { throw new Error("Unexpected model call"); } },
    embedder: { model, dimensions: ctx.vec(0).length,
      async embed() { throw new Error("Unexpected insert embedder call"); } },
    gate: { async assertOpen() {} }, tokens: { countTokens: () => 0 },
    embedQuery: { async embedQuery(owner, text, options) {
      controls.embedCalls++;
      equal(activeTransactions, 0, "Embedding dispatch must run outside a storage transaction");
      equal([owner, text, options.budgetClass], [scope.owner, "petrel route", "recall"], "Expected recall query preparation and budget");
      controls.lastSignal = options.signal;
      controls.lastDeadline = options.deadlineAtMs;
      if (controls.fail) throw new Error("Embedding provider failure");
      if (controls.hang) await new Promise(() => {});
      return { model: controls.model, vector: new Float32Array(ctx.vec(0)) };
    } },
  });
  const { findCandidates, fetchEvidence, readContext } = service;
  check(findCandidates && fetchEvidence && readContext, "Expected Context Read service entries");

  /** @param {string} text @param {number} distance @param {string} [embeddingModel] @param {typeof scope} [target]
   * @param {Receipt[]} [receipts] */
  async function insert(text, distance, embeddingModel = model, target = scope, receipts = []) {
    const input = await row(ctx, text, distance);
    check(input.embedding, "Expected a fixed embedding");
    input.embedding.model = embeddingModel;
    const { id, revision } = await storage.uow.run(target.owner, { pauseLock: true }, tx =>
      storage.memories.insert(tx, target, input, receipts, 1));
    return { type: /** @type {const} */ ("memory"), scope: target, id, revision };
  }

  /** @param {ContextMemoryRef} memory */
  async function retainStaleCandidate({ type, id, scope: { namespace } }) {
    const ref = { type, id, namespace };
    const items = await storage.uow.run(scope.owner, { readOnly: true }, tx => hydrate.hydrate(tx, set, [ref], "recall"));
    check(items.length === 1 && items[0].memory, "Expected a visible memory before withholding");
    controls.staleMemories.push(...items);
    controls.staleRows.push({ ref, distance: 0, updatedAtUs: 1n });
  }

  return { controls, scope, set, request, assemblyDeps, insert, service, retainStaleCandidate,
    /** @param {Partial<FindCandidatesInput>} [overrides] @param {CallOptions} [options] */
    find: (overrides, options) => findCandidates(set, { ...request, ...overrides }, options),
    /** @param {Partial<import("@cairn-ink/core/ports").ReadContextInput>} [overrides] @param {CallOptions} [options] */
    read: (overrides, options) => readContext(set, { ...request, raw: false, ...overrides }, options),
    /** @param {string} snapshot */
    fetch: snapshot => fetchEvidence(set, { snapshot }),
  };
}

const needs = /** @type {ConformanceCase["needs"]} */ (["contextRead", "semanticRetrieval"]);

/** @param {ReturnType<typeof fixture>} f @param {ContextMemoryRef} visible @param {ContextMemoryRef} hidden */
async function expectOnlyVisible(f, visible, hidden) {
  const found = await f.find();
  equal(found.items.map(({ ref }) => ref), [visible], "Find drops the hidden vector candidate before fusion");
  equal(found.coverage.depths.semantic, 1, "Only the visible candidate contributes to fusion");
  const read = await f.read();
  equal(read.assembly.items.map(({ ref }) => ref.id), [visible.id], "Context Read delivers only visible evidence");
  check(read.snapshot, "Expected a snapshot for the visible evidence");
  equal((await f.fetch(read.snapshot)).items.map(({ ref }) => ref), [visible], "The new snapshot references only visible evidence");
  const { fetchEvidence } = f.service;
  check(fetchEvidence, "Expected evidence fetch");
  await rejects(() => fetchEvidence(f.set, { refs: [hidden], intent: "current" }), "evidence_unavailable");
}

/** @type {readonly ConformanceCase[]} */
export const CONTEXT_READ_SEMANTIC_CASES = [
  {
    id: "T-CONTEXT-SEMANTIC-1",
    title: "fuses an otherwise unsearchable memory and fetches it without embedding again",
    needs,
    async run(ctx) {
      const f = fixture(ctx);
      const lexical = await f.insert(lexicalText, 1);
      const semantic = await f.insert(semanticText, 0);
      const words = await f.find({ semantic: false });
      equal(words.items.map(({ ref }) => ref), [lexical], "Lexical retrieval has no semantic-only match");
      equal(f.controls.embedCalls, 0, "Explicit lexical retrieval never embeds");
      const found = await f.find({ semantic: true });
      equal(found.items.map(({ ref }) => ref), [lexical, semantic], "Hybrid retrieval includes both memories in rank order");
      equal(found.items[1].channels, { lexical: null, semantic: { rank: 1, rawScore: 1 } }, "The close match enters through vectors");
      equal(found.channels.semantic, { state: "ready", causes: [] }, "Complete coverage enables the channel");
      equal([found.trace.requested, found.trace.effective, found.trace.embedder], ["hybrid", "hybrid", model], "Trace records actual mode and model");
      equal([found.coverage.depths.semantic, found.coverage.omitted.semantic], [2, 0], "Trace records vector depth and omissions");
      equal(found.coverage.byType.memory, { eligible: 2, indexed: 2, embedded: 2, scanned: 2,
        embeddedFraction: 1, scannedFraction: 1 }, "Vector coverage counts visible memories");
      equal(f.controls.embedCalls, 1, "Find embeds once");
      const read = await f.read();
      equal(read.diagnostics.candidates.trace.effective, "hybrid", "Omission enables hybrid read with a query embedder");
      equal(read.assembly.items.map(({ ref }) => ref.id), [lexical.id, semantic.id], "Assembly includes the semantic-only memory");
      equal(f.controls.embedCalls, 2, "Read embeds once");
      check(read.snapshot, "Expected a snapshot");
      equal((await f.fetch(read.snapshot)).items.map(({ ref }) => ref), [lexical, semantic], "Qualified refs survive fetch");
      equal(f.controls.embedCalls, 2, "Fetch never embeds");
    },
  },
  {
    id: "T-CONTEXT-SEMANTIC-2",
    title: "keeps lexical ranking when model coverage is incomplete or selection is historical",
    needs,
    async run(ctx) {
      const f = fixture(ctx);
      const lexical = await f.insert(lexicalText, 1, "other-model");
      await f.insert(semanticText, 0);
      const partial = await f.find();
      equal(partial.items.map(({ ref }) => ref), [lexical], "Partial coverage cannot contribute vector rows");
      equal(partial.channels.semantic, { state: "absent", causes: ["absent"] }, "Incomplete coverage is absent");
      equal(partial.trace.effective, "lexical", "Partial coverage uses lexical ranking");
      equal(partial.coverage.byType.memory, { eligible: 2, indexed: 2, embedded: 1, scanned: 2,
        embeddedFraction: 0.5, scannedFraction: 1 }, "Partial coverage reports real counts");
      const history = await f.find({ intent: "history", semantic: true });
      equal(history.items.map(({ ref }) => ref), [lexical], "History keeps lexical ranking");
      equal(history.channels.semantic, { state: "absent", causes: ["absent"] }, "History has no semantic channel");
      equal(f.controls.embedCalls, 1, "History never embeds");
    },
  },
  {
    id: "T-CONTEXT-SEMANTIC-3",
    title: "delivers lexical evidence after an embedding error or timeout",
    needs,
    async run(ctx) {
      const f = fixture(ctx);
      const lexical = await f.insert(lexicalText, 1);
      await f.insert(semanticText, 0);
      f.controls.fail = true;
      const failed = await f.find();
      equal(failed.channels.semantic, { state: "unavailable", causes: ["unavailable"] }, "Provider failures are content-free");
      equal(failed.items.map(({ ref }) => ref), [lexical], "Embedding failure keeps lexical evidence");
      f.controls.fail = false;
      f.controls.hang = true;
      // AbortSignal.timeout is unrefed in Node. Model a pending transport handle.
      const pending = setTimeout(() => {}, 1000);
      const read = await f.read({ deadlineMs: 600 }).finally(() => clearTimeout(pending));
      equal(read.diagnostics.candidates.channels.semantic, { state: "unavailable", causes: ["timeout"] }, "Embedding timeout is distinguishable");
      check(f.controls.lastSignal?.aborted && read.diagnostics.candidates.trace.timings.embeddingMs > 0, "Embedding timeout cancels and records elapsed time");
      equal(read.assembly.items.map(({ ref }) => ref.id), [lexical.id], "Embedding timeout leaves time to assemble lexical evidence");
      equal(f.controls.embedCalls, 2, "Timeout does not retry the embedding");
    },
  },
  {
    id: "T-CONTEXT-SEMANTIC-4",
    title: "drops forgotten, suppressed and other-owner vector rows and fences assembly delivery",
    needs,
    async run(ctx) {
      const f = fixture(ctx);
      const forgotten = await f.insert("Shearwaters breed on offshore islands.", 0.5);
      const suppressed = await f.insert("Fulmars glide across northern waters.", 0.6);
      const foreign = await f.insert("Prions forage at the surface.", 0.7, model, { ...f.scope, owner: ctx.otherOwner });
      const visible = await f.insert(semanticText, 0);
      const prior = await f.read();
      check(prior.snapshot, "Expected a snapshot before forget");
      equal((await f.service.forget(f.scope, forgotten.id, source)).status, "forgotten", "Forget removes a previously visible memory");
      await ctx.harness.seedFact(ctx.owner, { ...f.scope, kind: "identity", origin: "forget", actionId: "withhold", memoryId: suppressed.id });
      f.controls.staleRows = [forgotten, suppressed, foreign].map(({ type, id, scope }) =>
        ({ ref: { type, id, namespace: scope.namespace }, distance: 0, updatedAtUs: 1n }));
      equal((await f.find()).items.map(({ ref }) => ref), [visible], "Hydration qualifies only the visible memory");
      equal((await f.read()).assembly.items.map(({ ref }) => ref.id), [visible.id], "Assembly delivers only visible evidence");
      await rejects(() => f.fetch(/** @type {string} */ (prior.snapshot)), "snapshot_stale");
    },
  },
  {
    id: "T-CONTEXT-SEMANTIC-5",
    title: "continues a retained semantic ranking only while its model and channel state match",
    needs,
    async run(ctx) {
      const f = fixture(ctx);
      await f.insert(lexicalText, 1);
      const semantic = await f.insert(semanticText, 0);
      f.controls.keepCoverageAcrossModels = true;
      const first = await f.find({ limit: 1 });
      check(first.nextCursor, "Expected a semantic cursor");
      const resume = () => f.find({ cursor: first.nextCursor ?? undefined });
      equal((await resume()).items.map(({ ref }) => ref), [semantic], "Unchanged model and state continue");
      f.controls.model = "replacement-model";
      await rejects(resume, "cursor_stale");
      f.controls.model = model;
      f.controls.forceIncomplete = true;
      await rejects(resume, "cursor_stale");
    },
  },
  {
    id: "T-CONTEXT-SEMANTIC-6",
    title: "rejects a forgotten vector-only memory even when retrieval and hydration are stale",
    needs,
    async run(ctx) {
      const f = fixture(ctx);
      const forgotten = await f.insert(semanticText, 0);
      const visible = await f.insert(lexicalText, 1);
      equal((await f.find({ semantic: false })).items.map(({ ref }) => ref), [visible], "The forgotten memory has no lexical match");
      const prior = await f.read();
      check(prior.snapshot && prior.assembly.items.some(({ ref }) => ref.id === forgotten.id), "The memory was reachable through vectors");
      await f.retainStaleCandidate(forgotten);
      equal((await f.service.forget(f.scope, forgotten.id, source)).status, "forgotten", "Forget erases the vector-only memory");
      await expectOnlyVisible(f, visible, forgotten);
      await rejects(() => f.fetch(/** @type {string} */ (prior.snapshot)), "snapshot_stale");
    },
  },
  {
    id: "T-CONTEXT-SEMANTIC-7",
    title: "rejects a session-fenced vector-only memory",
    needs,
    async run(ctx) {
      const f = fixture(ctx);
      const receipt = evidence("fixture-message", 1);
      const { client, sessionId } = receipt;
      const fenced = await f.insert(semanticText, 0, model, f.scope, [receipt]);
      const visible = await f.insert(lexicalText, 1);
      equal((await f.find({ semantic: false })).items.map(({ ref }) => ref), [visible], "The fenced memory has no lexical match");
      await f.retainStaleCandidate(fenced);
      const sessionKeyHash = ctx.sessionRefs === "hashed" ? ctx.harness.hashSessionKey?.(client, sessionId) : undefined;
      if (ctx.sessionRefs === "hashed") check(sessionKeyHash, "Expected a hash for the test session");
      const session = sessionKeyHash ? { client, sessionKeyHash } : { client, sessionId };
      await ctx.harness.seedFact(ctx.owner, { ...f.scope, origin: "forget", actionId: "fence-source", kind: "session", session });
      await expectOnlyVisible(f, visible, fenced);
    },
  },
  {
    id: "T-CONTEXT-SEMANTIC-8",
    title: "rejects a vector neighbour of a forgotten memory with different text",
    needs: [...needs, "fingerprintKey", "vectorSuppression"],
    async run(ctx) {
      const f = fixture(ctx);
      const forgotten = await f.insert("Fulmars breed on rocky islands.", 0);
      const neighbour = await f.insert(semanticText, 0.05);
      const visible = await f.insert(lexicalText, 1);
      equal((await f.find({ semantic: false })).items.map(({ ref }) => ref), [visible], "The neighbour has no lexical match");
      await f.retainStaleCandidate(neighbour);
      equal((await f.service.forget(f.scope, forgotten.id, source)).status, "forgotten", "Forget records a full suppression");
      await expectOnlyVisible(f, visible, neighbour);
    },
  },
  {
    id: "T-CONTEXT-SEMANTIC-9",
    title: "reports semantic state, depth and ranks in find and context diagnostics",
    needs: [...needs, "inspect"],
    async run(ctx) {
      const f = fixture(ctx);
      await f.insert(lexicalText, 1);
      await f.insert(semanticText, 0);
      const storage = /** @type {ReadContractStorage} */ (ctx.adapter);
      const { findCandidates, readContext } = createMemoryService({ storage, profile: "keyless-local", ...f.assemblyDeps });
      check(findCandidates && readContext, "Expected keyless Context Read entries");
      /** @param {ContextCandidateDiagnostics} diagnostics @param {ContextCandidateDiagnostics["channels"]["semantic"]} channel
       * @param {number} depth */
      function expect(diagnostics, channel, depth) {
        equal(diagnostics.channels.semantic, channel, "Every candidate diagnostics payload reports semantic state and causes");
        equal(diagnostics.coverage.depths.semantic, depth, "Semantic depth counts only candidates contributed to fusion");
      }
      const disabled = { state: /** @type {const} */ ("disabled"), causes: /** @type {const} */ (["disabled", "absent"]) };
      expect(await findCandidates(f.set, f.request), disabled, 0);
      expect((await readContext(f.set, { ...f.request, raw: false })).diagnostics.candidates, disabled, 0);
      /** @param {Partial<FindCandidatesInput>} options
       * @param {ContextCandidateDiagnostics["channels"]["semantic"]} channel @param {number} depth */
      async function both(options, channel, depth) {
        const found = await f.find(options);
        expect(found, channel, depth);
        const read = await f.read(options);
        expect(read.diagnostics.candidates, channel, depth);
        return { found, read };
      }
      await both({ semantic: false }, disabled, 0);
      equal(f.controls.embedCalls, 0, "Disabled reads do not dispatch");
      const absent = { state: /** @type {const} */ ("absent"), causes: /** @type {const} */ (["absent"]) };
      await both({ intent: "history" }, absent, 0);
      equal(f.controls.embedCalls, 0, "Historical reads do not dispatch");
      f.controls.forceIncomplete = true;
      await both({}, absent, 0);
      f.controls.forceIncomplete = false;
      f.controls.fail = true;
      await both({}, { state: "unavailable", causes: ["unavailable"] }, 0);
      f.controls.fail = false;
      const deadlineAtMs = f.assemblyDeps.clock.monotonicMs() + 1000;
      const ready = /** @type {const} */ ({ state: "ready", causes: [] });
      const found = await f.find({}, { deadlineAtMs });
      expect(found, ready, 2);
      check(f.controls.lastDeadline !== undefined && f.controls.lastDeadline <= deadlineAtMs, "Find embedding shares the caller's read deadline");
      const read = await f.read({}, { deadlineAtMs });
      expect(read.diagnostics.candidates, ready, 2);
      check(f.controls.lastDeadline !== undefined && f.controls.lastDeadline <= deadlineAtMs, "Context embedding shares the caller's read deadline");
      const ranks = found.items.map(({ channels }) => ({ lexical: channels.lexical?.rank ?? null, semantic: channels.semantic?.rank ?? null }));
      equal(ranks.filter(({ lexical, semantic }) => lexical === null && semantic !== null).length, 1, "Find identifies the semantic-only candidate");
      equal(read.diagnostics.candidates.ranks, ranks, "Context diagnostics preserve each candidate's channel ranks");
    },
  },
];
