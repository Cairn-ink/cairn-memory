import { validateObject } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { prepareCoreText } from "../privacy/text.mjs";
import { canonicalKey } from "../retrieval/bm25.mjs";
import { COMPACT_RRF_PRESETS, fuseCandidates, RRF_PRESETS } from "../retrieval/fusion.mjs";
import { REPRESENTATION_VERSION, TOKENIZER_VERSION } from "../retrieval/tokenize.mjs";
import { entry } from "./entry.mjs";
import { assertContextVisible, contextCardVerdict, hasContextCardLoader, legacyContextCard, legacyRef, responseBytes, snapshotContextCall } from "./context-read-evidence.mjs";
import { checkRow } from "./context-read-fetch.mjs";
import { COMPACT_MEMORY_MAX_ITEMS, CONTEXT_HORIZON, contextReadSet, findCandidatesInput, itemRef, readSetBinding,
  namespaceSlot } from "./context-read-input.mjs";
import { CONTEXT_VERSION, isReadMac, newRankingId, readTokenSigner } from "./context-read-tokens.mjs";
import { hydrateMemoryRows } from "./reads.mjs";
import { embedRecallQuery } from "./recall.mjs";

/** @import { CallOptions, ClockAndHash, ContextCandidateDiagnostics, ContextReadSet, FindCandidatesInput,
  FindCandidatesResult, ContextIndexObservation, ContextMemoryRef, ContextReadRef, ContextReadStore, ContextReadType,
  EmbedQuery, ItemRef, ModelGate, ReadContractStorage, StoredDocumentCardRecord, Tx } from "../ports/index.d.ts" */
/** @typedef {Awaited<ReturnType<ContextReadStore["snapshotState"]>>} Generations */
/** @typedef {FindCandidatesResult["items"]} Items */
/** @typedef {{ items: Items, diagnostics: ContextCandidateDiagnostics, token: Cursor }} Ranking */
/** @typedef {{v: 1, r: string, b: string, c: string, a: string, g: string, e: number, p: number, q?: string}} Cursor */
/** @typedef {ReturnType<typeof readTokenSigner>} Signer */
/** @typedef {Awaited<ReturnType<EmbedQuery["embedQuery"]>>} Embedding */
/** @typedef {{ result?: Promise<EmbeddingAttempt>, attempt?: EmbeddingAttempt }} QueryEmbedding */
/** @typedef {{ embedding: Embedding, elapsed: number } | { cause: "unavailable" | "timeout", elapsed: number }} EmbeddingAttempt */
/** @typedef {{ ref: ItemRef, score: number, qualified: ContextMemoryRef }} SemanticRow */
/** @typedef {Pick<ReadContractStorage<StoredDocumentCardRecord>, "contextRead" | "fence" | "uow" | "capabilities" | "documentCards"> &
 * Partial<Pick<ReadContractStorage, "vector" | "hydrate">>} Storage */

const RANKING_LIMIT = 128;
const RANKING_TTL_MS = 300_000;
const config = /** @type {const} */ ({
  family: "local", preset: "rrf-k60-d12", embedder: null,
  tokenizer: TOKENIZER_VERSION, representation: REPRESENTATION_VERSION,
});
const cursorFields = ["v", "r", "b", "c", "a", "g", "e", "p"];

/** @param {unknown} value @returns {Cursor} */
function cursorPayload(value) {
  try {
    const data = validateObject(value, [...cursorFields, "q"]);
    const { v, r, b, c, a, g, e, p, q } = data;
    const withQuery = Object.hasOwn(data, "q");
    if (Object.keys(data).length !== cursorFields.length + Number(withQuery) || (withQuery && !isReadMac(q)) ||
        v !== 1 || typeof r !== "string" || !r || r.length > 200 ||
        !isReadMac(b) || !isReadMac(c) || !isReadMac(a) || !isReadMac(g) ||
        typeof e !== "number" || !Number.isSafeInteger(e) || typeof p !== "number" ||
        !Number.isSafeInteger(p) || p < 1 || p > CONTEXT_HORIZON) throw new CoreError("invalid_cursor");
    return { v, r, b, c, a, g, e, p, ...(typeof q === "string" && { q }) };
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

const compactPreset = "rrf-k60-d64-compact";

/** @param {readonly ContextReadType[]} types @param {boolean} semantic @param {boolean} available
 * @param {ContextCandidateDiagnostics["trace"]["preset"]} preset
 * @returns {ContextCandidateDiagnostics} */
function preflight(types, semantic, available, preset) {
  return {
    channels: {
      lexical: { state: "unavailable", causes: ["unavailable"] },
      semantic: semantic ? { state: "absent", causes: ["absent"] } : { state: "disabled", causes: ["disabled", "absent"] },
    },
    coverage: {
      status: "unavailable",
      byType: Object.fromEntries(types.map(type => [type, {
        eligible: null, indexed: null, embedded: null, scanned: null, embeddedFraction: null, scannedFraction: null,
      }])),
      freshness: "unverified",
      maintenance: { available, state: "rebuilding", buildState: "rebuilding", reason: null, progress: null },
      depths: { lexical: 0, semantic: 0 },
      omitted: { lexical: null, semantic: null, horizon: null },
      stops: { deadline: false, budget: false },
    },
    trace: { requested: semantic ? "hybrid" : "lexical", effective: "lexical", ...config, preset,
      timings: { maintenanceMs: 0, lexicalMs: 0, semanticPreflightMs: 0, embeddingMs: 0, fusionMs: 0 } },
  };
}

/** @param {ContextCandidateDiagnostics} diagnostics @param {readonly ContextReadType[]} types
 * @param {ContextIndexObservation} observed @param {number | null} matched @param {number} horizon */
function completeCoverage(diagnostics, types, observed, matched, horizon) {
  const { coverage, channels } = diagnostics;
  channels.lexical = { state: "ready", causes: [] };
  coverage.status = "complete";
  coverage.freshness = "current";
  for (const type of types) {
    const counts = observed.byType[type];
    if (!counts) throw new CoreError("internal_error");
    coverage.byType[type] = { ...counts, embedded: null, scanned: 0,
      embeddedFraction: null, scannedFraction: counts.eligible === 0 ? 1 : 0 };
  }
  coverage.depths.lexical = horizon;
  coverage.omitted.lexical = matched === null ? null : Math.max(0, matched - horizon);
  coverage.omitted.horizon = 0;
}

/** @param {EmbedQuery} embedQuery @param {ModelGate | undefined} gate @param {string} owner @param {string} query
 * @param {() => number} now @param {CallOptions & {deadlineAtMs: number}} options
 * @returns {Promise<EmbeddingAttempt>} */
async function attemptEmbedding(embedQuery, gate, owner, query, now, options) {
  const started = now();
  // Reserve time for vector retrieval, lexical fallback and assembly.
  const allowance = (options.deadlineAtMs - started) / 2;
  if (allowance < 1 || options.signal?.aborted) return { cause: "timeout", elapsed: 0 };
  const timeout = AbortSignal.timeout(Math.ceil(allowance));
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout;
  const deadlineAtMs = started + allowance;
  let onAbort = () => {};
  const expired = new Promise(resolve => {
    onAbort = () => resolve(undefined);
    if (signal.aborted) onAbort();
    else signal.addEventListener("abort", onAbort, { once: true });
  });
  async function request() {
    await gate?.assertOpen(owner, "dispatch");
    if (signal.aborted || now() >= deadlineAtMs) return;
    return embedRecallQuery(embedQuery, owner, prepareCoreText(query), { signal, deadlineAtMs });
  }
  try {
    const embedding = await Promise.race([request(), expired]);
    const ended = now();
    const elapsed = ended - started;
    if (signal.aborted || ended >= deadlineAtMs) return { cause: "timeout", elapsed };
    if (embedding && typeof embedding.model === "string" && embedding.model &&
        embedding.vector instanceof Float32Array && embedding.vector.length > 0) return { embedding, elapsed };
    return { cause: "unavailable", elapsed };
  } catch (error) {
    const ended = now();
    const timeout = signal.aborted || ended >= deadlineAtMs || (error instanceof CoreError && error.code === "model_timeout");
    return { cause: timeout ? "timeout" : "unavailable", elapsed: ended - started };
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

/** @param {Storage} storage @param {Tx} tx @param {ContextReadSet} readSet @param {Embedding} embedding @param {number} horizon */
async function semanticCandidates({ vector, hydrate, fence }, tx, readSet, { vector: query, model }, horizon) {
  if (!vector || !hydrate) return;
  const result = await vector.vector(tx, readSet, query, model, horizon);
  const candidates = result.rows.filter(({ ref, distance }) =>
    ref.type === "memory" && readSet.namespaces.includes(ref.namespace) && Number.isFinite(distance));
  if (candidates.length === 0) return { rows: [], coverage: result.coverage };
  const visible = new Set((await fence.assertVisible(tx, readSet, candidates.map(({ ref }) => ref))).map(canonicalKey));
  const qualified = candidates.filter(({ ref }) => visible.has(canonicalKey(ref)));
  const memories = await hydrateMemoryRows(hydrate, tx, readSet, qualified.map(({ ref }) => ref), "recall");
  const seen = new Set();
  /** @type {SemanticRow[]} */
  const rows = [];
  for (const { ref, distance } of qualified) {
    const key = canonicalKey(ref);
    const memory = memories.get(key);
    if (!memory || memory.historical || !Number.isSafeInteger(memory.revision) || memory.revision < 1 || seen.has(key)) continue;
    seen.add(key);
    rows.push({ ref, score: 1 - distance, qualified: { type: "memory", id: ref.id, scope: memory.scope, revision: memory.revision } });
  }
  return { rows, coverage: result.coverage };
}

/** @param {Ranking} ranking @param {number} position @param {number} limit @param {Signer} signer
 * @returns {Promise<FindCandidatesResult>} */
async function page({ items, diagnostics, token }, position, limit, signer) {
  const last = Math.min(items.length, position + limit);
  for (let end = last; end > position || items.length === 0 && end === 0; end--) {
    const nextCursor = end < items.length ? await signer.encode("cursor", { ...token, p: end }) : null;
    /** @type {FindCandidatesResult} */
    const result = { version: CONTEXT_VERSION, items: items.slice(position, end), ...diagnostics, nextCursor };
    if (responseBytes({ ...result, items: result.items.map(item => ({ ...item, ref: legacyRef(item.ref, true) })) }) <= 65536) {
      return structuredClone(result);
    }
  }
  throw new CoreError("context_item_too_large");
}

/** @param {{storage: Storage, clock: ClockAndHash, embedQuery?: EmbedQuery, gate?: ModelGate}} deps
 */
export function findCandidatesMethod({ storage, clock, embedQuery, gate }) {
  const { contextRead: store, fence, uow, documentCards } = storage;
  const cardsEnabled = hasContextCardLoader(documentCards);
  const documentCardsOnly = storage.capabilities.documentCards && !storage.capabilities.cards;
  const now = () => clock.monotonicMs();
  /** @param {FindCandidatesInput} input */
  function semanticSelection({ semantic, intent, types }) {
    const hasVector = storage.capabilities.semanticRetrieval === true && !!storage.vector;
    const semanticRequested = semantic ?? (!!embedQuery && hasVector);
    const queryEmbedder = semanticRequested && hasVector && intent === "current" && types.includes("memory") ? embedQuery : undefined;
    return { semanticRequested, queryEmbedder };
  }

  /** @param {QueryEmbedding} memo @param {EmbedQuery} queryEmbedder @param {string} owner
   * @param {string} query @param {CallOptions & {deadlineAtMs: number}} options */
  function startEmbedding(memo, queryEmbedder, owner, query, options) {
    return memo.result ??= attemptEmbedding(queryEmbedder, gate, owner, query, now, options)
      .then(attempt => { memo.attempt = attempt; return attempt; });
  }

  /** @param {ContextReadSet} readSet @param {FindCandidatesInput} input
   * @param {CallOptions & {deadlineAtMs: number}} options */
  function startAssemblyEmbedding(readSet, input, options) {
    if (!store || storage.capabilities.contextRead !== true) return;
    const { queryEmbedder } = semanticSelection(input);
    if (!queryEmbedder) return;
    /** @type {QueryEmbedding} */
    const memo = {};
    // Lexical preflight can fail before find needs to join the embedding.
    void startEmbedding(memo, queryEmbedder, readSet.owner, input.query, options).catch(() => {});
    return memo;
  }

  /** @param {Tx} tx @param {ContextReadSet} readSet @param {ContextReadRef} ref
   * @param {FindCandidatesInput["intent"]} intent @param {Generations | undefined} generations */
  async function visibleCard(tx, readSet, ref, intent, generations) {
    if (cardsEnabled) return !!await contextCardVerdict(documentCards, tx, ref);
    if (!store) return false;
    const [row] = await store.evidence(tx, readSet, [ref], intent ?? "current");
    const lineageEnabled = generations?.[namespaceSlot(readSet, ref.scope)]?.lineage !== undefined;
    return !!row && legacyContextCard(row, lineageEnabled) && !checkRow(ref, row);
  }

  /** @param {Items} items */
  const fenceRefs = items => items.flatMap(({ ref }) => cardsEnabled && ref.type === "card" ? [] : [ref]);
  /** @type {Map<string, Ranking>} */
  const rankings = new Map();
  function expireRankings() {
    const now = clock.nowMs();
    for (const [id, { token }] of rankings) if (now >= token.e) rankings.delete(id);
  }
  const run = entry(async (/** @type {ContextReadSet} */ value, /** @type {FindCandidatesInput} */ args,
    /** @type {CallOptions} */ options, /** @type {boolean} */ forAssembly, /** @type {QueryEmbedding} */ memo,
    /** @type {boolean} */ compact, /** @type {number | undefined} */ maxItems) => {
    const readSet = contextReadSet(value);
    const input = findCandidatesInput(args);
    if (!store || storage.capabilities.contextRead !== true) throw new CoreError("capability_unavailable");
    const { query, types, intent, semantic, cursor, limit } = input;
    const selection = { types, intent };
    const { semanticRequested, queryEmbedder } = semanticSelection(input);
    const deadlineAtMs = Math.min(clock.monotonicMs() + input.deadlineMs, options.deadlineAtMs ?? Infinity);
    const stopped = () => options.signal?.aborted || clock.monotonicMs() >= deadlineAtMs;
    const horizon = compact ? COMPACT_MEMORY_MAX_ITEMS : CONTEXT_HORIZON;
    const preset = compact ? compactPreset : config.preset;
    const presetDepth = compact ? COMPACT_RRF_PRESETS[compactPreset].depth : RRF_PRESETS[config.preset].depth;
    const fusionDepth = Math.max(presetDepth, Math.min(horizon, maxItems ?? presetDepth));
    const diagnostics = preflight(types, semanticRequested, store.maintenanceAvailable, preset);
    const unavailable = () => {
      if (stopped()) {
        diagnostics.channels.lexical = { state: "timeout", causes: ["timeout"] };
        diagnostics.coverage.stops.deadline = true;
      }
      return { diagnostics, code: /** @type {const} */ ("index_unavailable") };
    };
    const portOptions = { signal: options.signal, deadlineAtMs };

    async function prepareSemantic() {
      if (!queryEmbedder) return;
      recordEmbedding(await startEmbedding(memo, queryEmbedder, readSet.owner, query, portOptions));
    }

    /** @param {EmbeddingAttempt} attempt */
    function recordEmbedding(attempt) {
      diagnostics.trace.timings.embeddingMs = attempt.elapsed;
      if ("cause" in attempt) diagnostics.channels.semantic = { state: "unavailable", causes: [attempt.cause] };
      else diagnostics.trace.embedder = attempt.embedding.model;
    }

    /** @param {Tx} tx */
    async function readSemantic(tx) {
      const attempt = memo.attempt;
      if (!attempt || "cause" in attempt) return;
      try {
        const result = await semanticCandidates(storage, tx, readSet, attempt.embedding, horizon);
        if (result?.coverage.complete === true && result.rows.length) diagnostics.channels.semantic = { state: "ready", causes: [] };
        return result;
      } catch {
        diagnostics.channels.semantic = { state: "unavailable", causes: ["unavailable"] };
      }
    }

    const prepareLexical = async () => {
      if (stopped()) return false;
      if (store.prepareLexical) {
        const started = clock.monotonicMs();
        try {
          diagnostics.trace.maintenance = await store.prepareLexical(readSet, selection, portOptions);
        } catch (error) {
          if (error instanceof CoreError && error.code === "index_unavailable") return false;
          throw error;
        } finally {
          diagnostics.trace.timings.maintenanceMs += clock.monotonicMs() - started;
        }
      }
      return true;
    };

    if (cursor === undefined) {
      if (semanticRequested && !embedQuery) return { diagnostics, code: /** @type {const} */ ("invalid_input") };
      if (!await prepareLexical()) return unavailable();
      if (queryEmbedder && (!forAssembly || !memo.result)) await prepareSemantic();
    }

    const rank = () => uow.run(readSet.owner, { readOnly: true }, async tx => {
      const signer = readTokenSigner(await store.identity(tx));
      const requestArgs = [readSetBinding(readSet), query, types, intent];
      const semanticArgs = [...requestArgs, semantic ?? "auto"];
      const request = await signer.bind("ranking-request", semanticRequested ? semanticArgs : [...requestArgs, false]);
      const configuration = await signer.bind("ranking-config", [config, diagnostics.trace.requested, diagnostics.trace.effective]);
      const access = await signer.bind("access", readSet.accessGenerations);
      const semanticRequest = () => signer.bind("ranking-request", [...semanticArgs, diagnostics.trace.embedder]);
      const semanticConfig = () => signer.bind("ranking-config", [config, "hybrid", diagnostics.channels.semantic.state]);
      if (cursor !== undefined) {
        const token = cursorPayload(await signer.decode("cursor", cursor));
        if (token.q === undefined) {
          if (semanticRequested || token.b !== request || token.c !== configuration) throw new CoreError("invalid_cursor");
        } else if (token.q !== (semanticRequested ? request : await signer.bind("ranking-request", semanticArgs))) {
          throw new CoreError("invalid_cursor");
        }
        expireRankings();
        const ranking = rankings.get(token.r);
        if (!ranking || token.a !== access || token.g !== ranking.token.g || token.e !== ranking.token.e ||
            token.p >= ranking.items.length) throw new CoreError("cursor_stale");
        const current = await store.observeIndex(tx, readSet, selection);
        if (!current.ready || await signer.bind("index", current.indexState) !== token.g) throw new CoreError("cursor_stale");
        if (token.q !== undefined) {
          if (!semanticRequested) throw new CoreError("cursor_stale");
          // Validate the cursor before dispatch. Recheck the index in the
          // transaction that qualifies the channel and delivers the page.
          if (queryEmbedder && !memo.result) return { embed: true };
          await readSemantic(tx);
          if (token.b !== await semanticRequest() || token.c !== await semanticConfig()) throw new CoreError("cursor_stale");
        }
        const result = await page(ranking, token.p, limit, signer);
        const generations = !cardsEnabled && result.items.some(({ ref }) => ref.type === "card")
          ? await store.snapshotState(tx, readSet, types) : undefined;
        for (const { ref } of result.items) {
          if (ref.type === "card" && !await visibleCard(tx, readSet, ref, intent, generations)) throw new CoreError("cursor_stale");
        }
        await assertContextVisible(fence, tx, readSet, fenceRefs(result.items), intent, "cursor_stale");
        return { result };
      }

      const observed = await store.observeIndex(tx, readSet, selection);
      diagnostics.coverage.maintenance = { ...observed.maintenance };
      if (!observed.ready || stopped()) return unavailable();
      const started = clock.monotonicMs();
      let lexical;
      try {
        lexical = await store.lexical(tx, readSet, selection, query, horizon, portOptions);
      } catch (error) {
        if (error instanceof CoreError && error.code === "index_unavailable") return unavailable();
        throw error;
      } finally {
        diagnostics.trace.timings.lexicalMs = clock.monotonicMs() - started;
      }
      if (stopped()) return unavailable();

      if (forAssembly && memo.result) {
        // Release the read transaction before waiting on the model. If the
        // attempt is pending, repeat lexical and vector in a shared snapshot.
        if (!memo.attempt) return { embed: true };
        recordEmbedding(memo.attempt);
      }
      const semanticResult = semanticRequested ? await readSemantic(tx) : undefined;
      const fusionStarted = clock.monotonicMs();
      const lexicalRows = lexical.rows.map(({ ref, score }) => {
        if (namespaceSlot(readSet, ref.scope) < 0 || !types.includes(ref.type)) throw new CoreError("index_unavailable");
        return { ref: itemRef(ref), qualified: ref, score };
      });
      const hasCardHits = lexicalRows.some(({ ref }) => ref.type === "card");
      const generations = forAssembly || (!cardsEnabled && hasCardHits) ? await store.snapshotState(tx, readSet, types) : undefined;
      const accepted = hasCardHits ?
        (await Promise.all(lexicalRows.map(async row =>
          row.ref.type !== "card" || await visibleCard(tx, readSet, row.qualified, intent, generations) ? row : null
        ))).filter(row => row !== null) : lexicalRows;
      const semanticState = diagnostics.channels.semantic.state;
      const fused = fuseCandidates(accepted, semanticResult?.rows ?? [], {
        preset, depth: fusionDepth, limit: horizon, semanticState, coverageComplete: semanticState === "ready",
      });
      diagnostics.trace.effective = fused.mode;
      const items = fused.rows.map(({ qualified: ref, fusionScore, channels }, i) => ({ ref, rank: i + 1, fusionScore, channels }));
      diagnostics.trace.timings.fusionMs = clock.monotonicMs() - fusionStarted;
      const coverage = types.includes("card") && !cardsEnabled && documentCardsOnly && !accepted.some(({ ref }) => ref.type === "card")
        ? { ...observed, byType: { ...observed.byType, card: { eligible: 0, indexed: 0 } } } : observed;
      completeCoverage(diagnostics, types, coverage, accepted.length === lexical.rows.length ? lexical.matched : null, horizon);
      if (compact) diagnostics.coverage.omitted.horizon = fused.unionSize - items.length;
      const memoryCoverage = diagnostics.coverage.byType.memory;
      if (semanticResult && memoryCoverage) {
        const { eligible, embedded } = semanticResult.coverage;
        const depth = semanticState === "ready" ? Math.min(semanticResult.rows.length, fusionDepth) : 0;
        diagnostics.coverage.depths.semantic = depth;
        diagnostics.coverage.omitted.semantic = Math.max(0, embedded - depth);
        Object.assign(memoryCoverage, { embedded, scanned: eligible, embeddedFraction: eligible ? embedded / eligible : 1, scannedFraction: 1 });
      }

      // Assembly consumes the qualified horizon and its namespace fence in
      // the search snapshot (legacy context-read-facade.mjs:773–796).
      if (forAssembly) {
        await assertContextVisible(fence, tx, readSet, fenceRefs(items), intent, "evidence_unavailable");
        /** @type {FindCandidatesResult} */
        const result = { ...diagnostics, items, version: CONTEXT_VERSION, nextCursor: null };
        return { result, generations: structuredClone(generations) };
      }

      const ranking = structuredClone(/** @type {Ranking} */ ({
        items, diagnostics, token: { v: 1, r: newRankingId(), b: semanticRequested ? await semanticRequest() : request,
          c: semanticRequested ? await semanticConfig() : configuration, ...(semanticRequested && { q: request }), a: access,
          g: await signer.bind("index", observed.indexState), e: clock.nowMs() + RANKING_TTL_MS, p: 0 },
      }));
      const result = await page(ranking, 0, limit, signer);
      await assertContextVisible(fence, tx, readSet, fenceRefs(result.items), intent, "evidence_unavailable");
      if (result.nextCursor !== null) {
        expireRankings();
        const oldest = rankings.keys().next().value;
        if (rankings.size >= RANKING_LIMIT && oldest !== undefined) rankings.delete(oldest);
        rankings.set(ranking.token.r, ranking);
      }
      return { result };
    });
    const ranked = await rank();
    if (!("embed" in ranked)) return ranked;
    await prepareSemantic();
    if (forAssembly && !await prepareLexical()) return unavailable();
    const continued = await rank();
    if ("embed" in continued) throw new CoreError("internal_error");
    return continued;
  }, undefined, ([readSet, input, options, forAssembly, memo, compact, maxItems]) => {
    const [set, request, call] = snapshotContextCall([readSet, input, options]);
    return /** @type {[ContextReadSet, FindCandidatesInput, CallOptions, boolean, QueryEmbedding, boolean, number | undefined]} */ (
      [set, request, call, forAssembly, memo, compact, maxItems]);
  });

  /** @param {ContextReadSet} readSet @param {FindCandidatesInput} input @param {CallOptions} options
   * @param {boolean} forAssembly @param {QueryEmbedding} [memo] @param {boolean} [compact] @param {number} [maxItems] */
  async function search(readSet, input, options, forAssembly, memo = {}, compact = false, maxItems) {
    const result = await run(readSet, input, options, forAssembly, memo, compact, maxItems);
    if ("code" in result) throw Object.assign(new CoreError(result.code), { diagnostics: result.diagnostics });
    return result;
  }
  return {
    startAssemblyEmbedding,
    /** @type {NonNullable<import("../ports/host.d.ts").MemoryService["findCandidates"]>} */
    findCandidates: async (readSet, input, options = {}) => (await search(readSet, input, options, false)).result,
    /** @param {ContextReadSet} readSet @param {FindCandidatesInput} input @param {CallOptions} options
     * @param {QueryEmbedding} memo @param {boolean} [compact] @param {number} [maxItems] */
    async findForAssembly(readSet, input, options, memo, compact, maxItems) {
      const { result, generations } = await search(readSet, input, options, true, memo, compact, maxItems);
      if (generations === undefined) throw new CoreError("internal_error");
      return { result, generations };
    },
  };
}
