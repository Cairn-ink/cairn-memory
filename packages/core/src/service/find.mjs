import { isWellFormedText, validateDenseArray, validateObject } from "../capture/validate.mjs";
import { FUSION_PRESETS } from "../decisions.mjs";
import { CoreError } from "../errors.mjs";
import { prepareCoreText } from "../privacy/text.mjs";
import { fuseHostedWithCards } from "../retrieval/fusion.mjs";
import { documentCardFindItem, documentCardVisible, visibleDocumentCardRows } from "../routing/index.mjs";
import { entry, entryError, scopeOf } from "./entry.mjs";
import { recallSearch } from "./recall.mjs";
import { readSet, visibleRawSegments } from "./reads.mjs";

/** @typedef {import("../ports/host.d.ts").MemoryService} MemoryService */
/** @typedef {import("../ports/retrieval.d.ts").RetrievalScope} RetrievalScope */
/** @typedef {import("../ports/host.d.ts").Layer} Layer */
/** @typedef {import("../ports/common.d.ts").MemoryRow} MemoryRow */
/** @typedef {import("../ports/retrieval.d.ts").RawSegment} RawSegment */
/** @typedef {import("./index.d.mts").MemoryServiceDeps["storage"]} StorageAdapter */
/** @typedef {import("../ports/common.d.ts").Scope} Scope */
/** @typedef {import("../ports/common.d.ts").ItemRef} ItemRef */
/** @typedef {import("../ports/unit-of-work.d.ts").Tx} Tx */
/** @typedef {import("../routing/index.mjs").DocumentCardFindItem} DocumentCardFindItem */
/** @typedef {NonNullable<StorageAdapter["documentCards"]>} CardStore */
/** @typedef {NonNullable<CardStore["visibilityInputs"]>} CardVisibilityLoader */

/** @param {unknown} value */
function timeBound(value) {
  if (value === undefined) return value;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value < 0) {
    throw new CoreError("invalid_input");
  }
  return value;
}

/** @param {unknown} value */
function findOptions(value) {
  const { limit = 8, kinds = ["memory", "card"], clients, sinceMs, untilMs } =
    validateObject(value, ["limit", "kinds", "clients", "sinceMs", "untilMs"]);
  if (Object.getPrototypeOf(value) !== Object.prototype ||
      typeof limit !== "number" || !Number.isInteger(limit) || limit < 1 || limit > 20) {
    throw new CoreError("invalid_input");
  }

  const requested = validateDenseArray(kinds, 1, 3);
  if (!requested.every(kind => kind === "memory" || kind === "card" || kind === "raw") ||
      new Set(requested).size !== requested.length) throw new CoreError("invalid_input");

  /** @type {Pick<RetrievalScope, "clients" | "window">} */
  const filters = {};
  if (clients !== undefined) {
    const list = validateDenseArray(clients, 1, Number.MAX_SAFE_INTEGER);
    if (!list.every(isWellFormedText) || list.includes("")) throw new CoreError("invalid_input");
    filters.clients = [...new Set(list)];
  }

  const since = timeBound(sinceMs);
  const until = timeBound(untilMs);
  if (since !== undefined && until !== undefined && since >= until) throw new CoreError("invalid_input");
  if (since !== undefined || until !== undefined) {
    filters.window = { sinceMs: since, untilMs: until };
  }
  return { limit, requested, filters };
}

/** @param {boolean} [requested] @returns {Layer} */
function notSearched(requested) {
  return requested
    ? { status: "not_searched", count: 0, code: "capability_unavailable" }
    : { status: "not_searched", count: 0 };
}

/** @param {CardStore | undefined} store */
function cardVisibilityLoader(store) {
  return typeof store?.visibilityInputs === "function" ? store.visibilityInputs.bind(store) : undefined;
}

/**
 * @param {CardStore} store @param {CardVisibilityLoader} load
 * @param {Tx} tx @param {Scope} scope @param {ItemRef} ref
 */
async function readVisibleCard(store, load, tx, scope, ref) {
  if (ref.type !== "card" || ref.namespace !== scope.namespace) return null;
  const card = await store.get(tx, scope, ref.id);
  if (!card || card.id !== ref.id) return null;
  const [input] = await load(tx, scope, [ref]);
  if (!input || input.card.id !== ref.id || input.card.scope.owner !== scope.owner ||
      input.card.scope.namespace !== scope.namespace) return null;
  const verdict = await documentCardVisible({
    ...input, requestedScope: scope, card: { ...card, canonicalSessionKey: input.card.canonicalSessionKey },
  });
  return verdict.visible ? { card, memoryStates: input.memoryStates } : null;
}

/** @param {import("./index.d.mts").MemoryServiceDeps} deps @returns {MemoryService["find"]} */
export function findMethod(deps) {
  const searchMemories = recallSearch(deps);
  const { storage: { uow, fence, raw, capabilities, documentCards, documentCardCandidates }, embedQuery } = deps;
  /** @type {(...args: Parameters<MemoryService["find"]>) => ReturnType<MemoryService["find"]>} */
  const find = entry(async (input, rawQuery, options) => {
    const scope = scopeOf(input);
    if (rawQuery !== null && typeof rawQuery !== "string") throw new CoreError("invalid_input");
    const { limit, requested, filters } = findOptions(options);
    const query = prepareCoreText(rawQuery ?? "");
    const rawRequested = requested.includes("raw");
    const rawAvailable = capabilities.rawArchive && raw;
    const searchRaw = rawRequested && query && rawAvailable;
    const cardRequested = requested.includes("card");
    const loadCardVisibility = cardVisibilityLoader(documentCards);
    const cardAvailable = capabilities.documentCardSearch && documentCardCandidates && loadCardVisibility;
    const searchCards = cardRequested && query && cardAvailable;
    /** @type {Float32Array | undefined} */
    let queryVector;
    /** @type {string | undefined} */
    let queryModel;

    /** @type {MemoryRow[]} */
    let memories = [];
    let memory = notSearched();
    if (requested.includes("memory")) {
      try {
        // Capture this request's vector as memory search computes it.
        const search = (searchRaw || searchCards) && embedQuery ? recallSearch({
          ...deps,
          embedQuery: {
            async embedQuery(owner, text, options) {
              const embedding = await embedQuery.embedQuery(owner, text, options);
              queryVector = embedding.vector;
              if (searchCards) queryModel = embedding.model;
              return embedding;
            },
          },
        }) : searchMemories;
        ({ items: memories } = await search(scope, query, { cursor: null, limit, mode: "search" }, filters));
        memory = { status: "ok", count: memories.length };
      } catch (error) {
        memory = { status: "unavailable", count: 0, code: entryError(error).code };
      }
    }
    /** @type {RawSegment[]} */
    let segments = [];
    let rawLayer = notSearched(rawRequested && !rawAvailable);
    if (searchRaw) {
      const readScope = readSet(scope, filters);
      try {
        ({ segments, layer: rawLayer } = await uow.run(scope.owner, { readOnly: true }, async tx => {
          const result = await searchRaw.raw(tx, readScope, query, "search", queryVector ? { limit, queryVector } : { limit });
          const segments = await visibleRawSegments(result.segments, readScope, tx, fence);
          /** @type {Layer} */
          const layer = { status: "ok", count: segments.length };
          if (result.coverage.complete === false) layer.code = "index_unavailable";
          return { segments, layer };
        }));
      } catch (error) {
        rawLayer = { status: "unavailable", count: 0, code: entryError(error).code };
      }
    }
    /** @type {DocumentCardFindItem[]} */
    let cards = [];
    let card = notSearched(cardRequested && query.length > 0 && !cardAvailable);
    if (searchCards && documentCards && documentCardCandidates && loadCardVisibility) {
      const readScope = readSet(scope, filters);
      const pool = FUSION_PRESETS.hosted.pool;
      try {
        cards = await uow.run(scope.owner, { readOnly: true }, async tx => {
          const words = await documentCardCandidates.lexical(tx, readScope, query, pool, {});
          const semantic = queryVector && queryModel
            ? await documentCardCandidates.vector(tx, readScope, queryVector, queryModel, pool)
            : null;
          const vectorRows = semantic?.coverage.complete === true ? semantic.rows : null;
          const refs = [...words.rows, ...(semantic?.rows ?? [])].map(({ ref }) => ref);
          const inputs = await loadCardVisibility(tx, scope, refs);
          const byRef = new Map(refs.map((ref, i) => [ref, inputs[i]]));
          /** @param {ItemRef} ref */
          const load = ref => {
            const input = byRef.get(ref);
            return input && ref.namespace === scope.namespace ? { ...input, requestedScope: scope } : null;
          };
          const { rows: cardLexical } = await visibleDocumentCardRows(words.rows, load);
          const cardVector = vectorRows && (await visibleDocumentCardRows(vectorRows, load)).rows;
          const { rows } = fuseHostedWithCards(
            { memoryLexical: [], memoryVector: [], cardLexical, cardVector },
            { offset: 0, limit, floor: false },
          );
          const items = [];
          for (const { ref } of rows) {
            const visible = await readVisibleCard(documentCards, loadCardVisibility, tx, scope, ref);
            if (visible) items.push(documentCardFindItem(visible.card, query));
          }
          return items;
        });
        card = { status: "ok", count: cards.length };
      } catch (error) {
        card = { status: "unavailable", count: 0, code: entryError(error).code };
      }
    }
    return {
      memories, cards, raw: segments,
      layers: { memory, card, raw: rawLayer },
    };
  });
  // A null query leaves both the raw and card arrays empty.
  return /** @type {MemoryService["find"]} */ (find);
}

/** @param {Pick<StorageAdapter, "uow" | "hydrate" | "fence" | "documentCards">} storage
 * @returns {MemoryService["read"]} */
export function readMethod({ uow, hydrate, fence, documentCards }) {
  /** @type {(...args: Parameters<MemoryService["read"]>) => ReturnType<MemoryService["read"]>} */
  const read = entry(async (input, target) => {
    const scope = scopeOf(input);
    const { type, id } = validateObject(target, ["type", "id"]);
    if ((type !== "memory" && type !== "card") || typeof id !== "string") throw new CoreError("invalid_input");
    /** @type {ItemRef} */
    const ref = { type, id, namespace: scope.namespace };
    if (type === "card") {
      const load = cardVisibilityLoader(documentCards);
      if (!documentCards || !load) throw new CoreError("capability_unavailable");
      return uow.run(scope.owner, { readOnly: true }, async tx => {
        const visible = await readVisibleCard(documentCards, load, tx, scope, ref);
        if (!visible) return { status: "not_found" };
        const { card: { id, title, body, date, origin, sourceMessage, sourceMemories }, memoryStates } = visible;
        const sourceMemoryIds = sourceMemories.filter(({ id }) => {
          const state = memoryStates.get(id)?.status;
          return state === "visible" || state === "historical";
        }).map(({ id }) => id);
        return {
          status: "found",
          card: { id, title, body, date, origin: origin ?? null, sourceClient: sourceMessage?.client ?? null, sourceMemoryIds },
        };
      });
    }
    if (!hydrate) throw new CoreError("capability_unavailable");

    const readScope = readSet(scope);
    /** @param {import("../ports/common.d.ts").ItemRef} candidate */
    const isRequested = candidate => candidate.type === type && candidate.id === id &&
      candidate.namespace === scope.namespace;
    /** @param {import("../ports/retrieval.d.ts").HydratedItem} candidate */
    const matches = ({ ref, memory }) => isRequested(ref) && memory?.id === id &&
      memory.scope.owner === scope.owner && memory.scope.namespace === scope.namespace;

    const initial = await uow.run(scope.owner, { readOnly: true }, tx =>
      hydrate.hydrate(tx, readScope, [ref], "read"));
    return uow.run(scope.owner, { readOnly: true }, async tx => {
      const hydrated = await hydrate.hydrate(tx, readScope, [ref], "read");
      const visible = await fence.assertVisible(tx, readScope, [ref], "read");
      const result = hydrated.find(matches);
      if (!result?.memory || !visible.some(isRequested) || !initial.some(matches)) return { status: "not_found" };
      return {
        status: "found", item: result.memory, receipts: result.receipts ?? [], sourceDates: result.sourceDates ?? null,
      };
    });
  });
  return /** @type {MemoryService["read"]} */ (read);
}
