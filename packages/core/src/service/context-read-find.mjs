import { validateObject } from "../capture/validate.mjs";
import { CoreError } from "../errors.mjs";
import { fuseCandidates } from "../retrieval/fusion.mjs";
import { REPRESENTATION_VERSION, TOKENIZER_VERSION } from "../retrieval/tokenize.mjs";
import { entry } from "./entry.mjs";
import { assertContextVisible, contextCardVerdict, hasContextCardLoader, legacyContextCard, legacyRef, responseBytes, snapshotContextCall } from "./context-read-evidence.mjs";
import { checkRow } from "./context-read-fetch.mjs";
import { CONTEXT_HORIZON, contextReadSet, findCandidatesInput, itemRef, readSetBinding,
  namespaceSlot } from "./context-read-input.mjs";
import { CONTEXT_VERSION, isReadMac, newRankingId, readTokenSigner } from "./context-read-tokens.mjs";

/** @import { CallOptions, ClockAndHash, ContextCandidateDiagnostics, ContextReadSet, FindCandidatesInput,
  FindCandidatesResult, ContextIndexObservation, ContextReadRef, ContextReadStore, ContextReadType,
  ReadContractStorage, StoredDocumentCardRecord, Tx } from "../ports/index.d.ts" */
/** @typedef {Awaited<ReturnType<ContextReadStore["snapshotState"]>>} Generations */
/** @typedef {FindCandidatesResult["items"]} Items */
/** @typedef {{ items: Items, diagnostics: ContextCandidateDiagnostics, token: Cursor }} Ranking */
/** @typedef {{v: 1, r: string, b: string, c: string, a: string, g: string, e: number, p: number}} Cursor */
/** @typedef {ReturnType<typeof readTokenSigner>} Signer */

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
    const data = validateObject(value, cursorFields);
    const { v, r, b, c, a, g, e, p } = data;
    if (Object.keys(data).length !== cursorFields.length || v !== 1 || typeof r !== "string" || !r || r.length > 200 ||
        !isReadMac(b) || !isReadMac(c) || !isReadMac(a) || !isReadMac(g) ||
        typeof e !== "number" || !Number.isSafeInteger(e) || typeof p !== "number" ||
        !Number.isSafeInteger(p) || p < 1 || p > CONTEXT_HORIZON) throw new CoreError("invalid_cursor");
    return { v, r, b, c, a, g, e, p };
  } catch {
    throw new CoreError("invalid_cursor");
  }
}

/** @param {readonly ContextReadType[]} types @param {boolean} semantic @param {boolean} available
 * @returns {ContextCandidateDiagnostics} */
function preflight(types, semantic, available) {
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
    trace: { requested: semantic ? "hybrid" : "lexical", effective: "lexical", ...config,
      timings: { maintenanceMs: 0, lexicalMs: 0, semanticPreflightMs: 0, embeddingMs: 0, fusionMs: 0 } },
  };
}

/** @param {ContextCandidateDiagnostics} diagnostics @param {readonly ContextReadType[]} types
 * @param {ContextIndexObservation} observed @param {number | null} matched */
function completeCoverage(diagnostics, types, observed, matched) {
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
  coverage.depths.lexical = CONTEXT_HORIZON;
  coverage.omitted.lexical = matched === null ? null : Math.max(0, matched - CONTEXT_HORIZON);
  coverage.omitted.horizon = 0;
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

/** @param {{storage: Pick<ReadContractStorage<StoredDocumentCardRecord>, "contextRead" | "fence" | "uow" | "capabilities" | "documentCards">,
 * clock: ClockAndHash}} deps
 */
export function findCandidatesMethod({ storage, clock }) {
  const { contextRead: store, fence, uow, documentCards } = storage;
  const cardsEnabled = hasContextCardLoader(documentCards);
  const documentCardsOnly = storage.capabilities.documentCards && !storage.capabilities.cards;
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
    /** @type {CallOptions} */ options, /** @type {boolean} */ forAssembly) => {
    const readSet = contextReadSet(value);
    const input = findCandidatesInput(args);
    if (!store || storage.capabilities.contextRead !== true) throw new CoreError("capability_unavailable");
    const { query, types, intent, semantic, cursor, limit } = input;
    const selection = { types, intent };
    const deadlineAtMs = Math.min(clock.monotonicMs() + input.deadlineMs, options.deadlineAtMs ?? Infinity);
    const stopped = () => options.signal?.aborted || clock.monotonicMs() >= deadlineAtMs;
    const diagnostics = preflight(types, semantic, store.maintenanceAvailable);
    const unavailable = () => {
      if (stopped()) {
        diagnostics.channels.lexical = { state: "timeout", causes: ["timeout"] };
        diagnostics.coverage.stops.deadline = true;
      }
      return { diagnostics, code: /** @type {const} */ ("index_unavailable") };
    };
    const portOptions = { signal: options.signal, deadlineAtMs };

    if (cursor === undefined) {
      if (semantic) return { diagnostics, code: /** @type {const} */ ("invalid_input") };
      if (stopped()) return unavailable();
      if (store.prepareLexical) {
        const started = clock.monotonicMs();
        try {
          diagnostics.trace.maintenance = await store.prepareLexical(readSet, selection, portOptions);
        } catch (error) {
          if (error instanceof CoreError && error.code === "index_unavailable") return unavailable();
          throw error;
        } finally {
          diagnostics.trace.timings.maintenanceMs = clock.monotonicMs() - started;
        }
      }
    }

    return uow.run(readSet.owner, { readOnly: true }, async tx => {
      const signer = readTokenSigner(await store.identity(tx));
      const request = await signer.bind("ranking-request", [readSetBinding(readSet), query, types, intent, semantic]);
      const configuration = await signer.bind("ranking-config", [config, diagnostics.trace.requested, diagnostics.trace.effective]);
      const access = await signer.bind("access", readSet.accessGenerations);
      if (cursor !== undefined) {
        const token = cursorPayload(await signer.decode("cursor", cursor));
        if (token.b !== request || token.c !== configuration) throw new CoreError("invalid_cursor");
        expireRankings();
        const ranking = rankings.get(token.r);
        if (!ranking || token.a !== access || token.g !== ranking.token.g || token.e !== ranking.token.e ||
            token.p >= ranking.items.length) throw new CoreError("cursor_stale");
        const current = await store.observeIndex(tx, readSet, selection);
        if (!current.ready || await signer.bind("index", current.indexState) !== token.g) throw new CoreError("cursor_stale");
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
        lexical = await store.lexical(tx, readSet, selection, query, CONTEXT_HORIZON, portOptions);
      } catch (error) {
        if (error instanceof CoreError && error.code === "index_unavailable") return unavailable();
        throw error;
      } finally {
        diagnostics.trace.timings.lexicalMs = clock.monotonicMs() - started;
      }
      if (stopped()) return unavailable();

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
      const fused = fuseCandidates(accepted, [], { preset: config.preset });
      if (fused.mode !== "lexical") throw new CoreError("internal_error");
      const items = fused.rows.map(({ qualified: ref, fusionScore, channels }, i) => ({ ref, rank: i + 1, fusionScore, channels }));
      diagnostics.trace.timings.fusionMs = clock.monotonicMs() - fusionStarted;
      const coverage = types.includes("card") && !cardsEnabled && documentCardsOnly && !accepted.some(({ ref }) => ref.type === "card")
        ? { ...observed, byType: { ...observed.byType, card: { eligible: 0, indexed: 0 } } } : observed;
      completeCoverage(diagnostics, types, coverage, accepted.length === lexical.rows.length ? lexical.matched : null);

      // Assembly consumes the qualified horizon and its namespace fence in
      // the search snapshot (legacy context-read-facade.mjs:773–796).
      if (forAssembly) {
        await assertContextVisible(fence, tx, readSet, fenceRefs(items), intent, "evidence_unavailable");
        /** @type {FindCandidatesResult} */
        const result = { ...diagnostics, items, version: CONTEXT_VERSION, nextCursor: null };
        return { result, generations: structuredClone(generations) };
      }

      const ranking = structuredClone(/** @type {Ranking} */ ({
        items, diagnostics, token: { v: 1, r: newRankingId(), b: request, c: configuration, a: access,
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
  }, undefined, ([readSet, input, options, forAssembly]) => {
    const [set, request, call] = snapshotContextCall([readSet, input, options]);
    return /** @type {[ContextReadSet, FindCandidatesInput, CallOptions, boolean]} */ ([set, request, call, forAssembly]);
  });

  /** @param {ContextReadSet} readSet @param {FindCandidatesInput} input @param {CallOptions} options @param {boolean} forAssembly */
  async function search(readSet, input, options, forAssembly) {
    const result = await run(readSet, input, options, forAssembly);
    if ("code" in result) throw Object.assign(new CoreError(result.code), { diagnostics: result.diagnostics });
    return result;
  }
  return {
    /** @type {NonNullable<import("../ports/host.d.ts").MemoryService["findCandidates"]>} */
    findCandidates: async (readSet, input, options = {}) => (await search(readSet, input, options, false)).result,
    /** @param {ContextReadSet} readSet @param {FindCandidatesInput} input @param {CallOptions} options */
    async findForAssembly(readSet, input, options) {
      const { result, generations } = await search(readSet, input, options, true);
      if (generations === undefined) throw new CoreError("internal_error");
      return { result, generations };
    },
  };
}
