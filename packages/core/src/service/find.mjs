import { isWellFormedText, validateDenseArray, validateObject } from "../capture/validate.mjs";
import { FUSION_PRESETS } from "../decisions.mjs";
import { CoreError } from "../errors.mjs";
import { prepareCoreText } from "../privacy/text.mjs";
import { canonicalKey } from "../retrieval/bm25.mjs";
import { fuseHostedLexicalOnly, fuseHostedWithCards } from "../retrieval/fusion.mjs";
import { decodeCursor, RAW_FIND_DEPTH } from "../retrieval/hosted-paging.mjs";
import { documentCardFindItem, documentCardVisible, visibleDocumentCardRows } from "../routing/index.mjs";
import { entry, entryError, scopeOf } from "./entry.mjs";
import { embedRecallQuery, recallSearch } from "./recall.mjs";
import { readSet, visibleRawSegments } from "./reads.mjs";
import { isReadMac, signedReadToken } from "./signed-read-token.mjs";

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
/** @typedef {"memory" | "card" | "raw"} Kind */
/** @typedef {{ position: string | number, state: string | null, model: string | null }} FindPosition */
/** @typedef {Awaited<ReturnType<NonNullable<import("./index.d.mts").MemoryServiceDeps["embedQuery"]>["embedQuery"]>>} Embedding */

const kindsForFind = /** @type {const} */ (["memory", "card", "raw"]);
const FIND_CURSOR_LIMIT = 8192;

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
  const { limit = 8, kinds = ["memory", "card"], clients, sinceMs, untilMs, cursors } =
    validateObject(value, ["limit", "kinds", "clients", "sinceMs", "untilMs", "cursors"]);
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
  return { limit, requested, filters, cursors: findCursors(cursors) };
}

/** @param {unknown} value */
function findCursors(value) {
  if (value === undefined) return undefined;
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype ||
      Object.keys(value).some(key => !kindsForFind.some(kind => kind === key))) {
    throw new CoreError("invalid_cursor");
  }
  return /** @type {Partial<Record<Kind, unknown>>} */ (value);
}

/** @param {import("../ports/host.d.ts").ReadTokenIdentity} identity */
function findTokens({ storeId, cursorKey }) {
  const signer = signedReadToken(cursorKey);
  /** @param {unknown[]} request */
  const bind = request => (/** @type {string} */ body) => JSON.stringify(["find-cursor-v1", storeId, request, body]);

  return {
    /** @param {string} value */
    mac: value => signer.mac(JSON.stringify(["find-state-v1", storeId, value])),
    /** @param {unknown} cursor @param {unknown[]} request @param {Kind} kind @returns {Promise<FindPosition | null>} */
    async read(cursor, request, kind) {
      if (cursor === undefined) return null;
      if (typeof cursor !== "string" || cursor.length > FIND_CURSOR_LIMIT) throw new CoreError("invalid_cursor");
      const payload = await signer.decode(cursor, bind(request));
      if (!Array.isArray(payload) || payload.length !== 3) throw new CoreError("invalid_cursor");
      const [position, state, model] = payload;
      const depth = kind === "raw" ? RAW_FIND_DEPTH : 2 * FUSION_PRESETS.hosted.pool;
      if ((model !== null && !isReadMac(model)) ||
          (kind === "memory"
            ? typeof position !== "string" || !position || state !== null
            : !Number.isSafeInteger(position) || position <= 0 || position >= depth || !isReadMac(state))) {
        throw new CoreError("invalid_cursor");
      }
      return { position, state, model };
    },

    /** @param {FindPosition} page @param {unknown[]} request */
    async write({ position, state, model }, request) {
      const token = await signer.encode([position, state, model], bind(request));
      if (token.length > FIND_CURSOR_LIMIT) throw new CoreError("context_item_too_large");
      return token;
    },
  };
}

/** @param {boolean} [requested] @returns {Layer} */
function notSearched(requested) {
  return requested
    ? { status: "not_searched", count: 0, code: "capability_unavailable" }
    : { status: "not_searched", count: 0 };
}

/** @param {unknown} error @param {boolean} paging @returns {Layer} */
function unavailable(error, paging) {
  return { status: "unavailable", count: 0, code: entryError(error).code, ...(paging && { nextCursor: null }) };
}

/** @type {typeof fuseHostedLexicalOnly} */
function findLexicalPage(rows, { offset, limit }) {
  if (offset === 0) return fuseHostedLexicalOnly(rows, { offset, limit });
  // Recall reorders the store's first limit + 1 rows to break ties. Preserve
  // that first page and consume the rest in stable store windows to avoid
  // promoting a newly seen tie across a previously delivered boundary.
  const firstWindow = rows.slice(0, limit + 1);
  const first = fuseHostedLexicalOnly(firstWindow, { offset: 0, limit });
  const delivered = new Set(first.rows.map(row => canonicalKey(row.ref)));
  const remaining = firstWindow.filter(row => !delivered.has(canonicalKey(row.ref))).concat(rows.slice(limit + 1));
  const window = remaining.slice(offset - limit, offset);
  return { rows: fuseHostedLexicalOnly(window, { offset: 0, limit }).rows, total: rows.length };
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
  const checkedCard = { ...card, title: card.title ?? null };
  const verdict = await documentCardVisible({
    ...input, requestedScope: scope, card: { ...checkedCard, canonicalSessionKey: input.card.canonicalSessionKey },
  });
  return verdict.visible ? { card: checkedCard, memoryStates: input.memoryStates } : null;
}

/** @param {import("./index.d.mts").MemoryServiceDeps} deps @returns {MemoryService["find"]} */
export function findMethod(deps) {
  const { storage, embedQuery, gate } = deps;
  const { uow, fence, raw, capabilities, documentCards, documentCardCandidates, snapshot, contextRead, inspect } = storage;
  const memoryDeps = snapshot.findMemory
    ? { ...deps, storage: { ...storage, snapshot: snapshot.findMemory } }
    : deps;
  const searchMemories = recallSearch(deps);
  const pageMemories = recallSearch(memoryDeps, findLexicalPage);
  /** @type {(...args: Parameters<MemoryService["find"]>) => ReturnType<MemoryService["find"]>} */
  const find = entry(async (input, rawQuery, options) => {
    const scope = scopeOf(input);
    if (rawQuery !== null && typeof rawQuery !== "string") throw new CoreError("invalid_input");
    const { limit, requested, filters, cursors } = findOptions(options);
    const paging = cursors !== undefined;
    const firstPage = !paging || Object.keys(cursors).length === 0;
    const query = prepareCoreText(rawQuery ?? "");
    const readScope = readSet(scope, filters);
    const clients = filters.clients?.slice().sort() ?? null;
    /** @param {Kind} kind */
    const selected = kind => firstPage ? requested.includes(kind) : cursors?.[kind] !== undefined;
    /** @param {Kind} kind */
    const binding = kind => [scope.owner, scope.namespace, query, kind, clients,
      filters.window?.sinceMs ?? null, filters.window?.untilMs ?? null, limit,
      kind === "card" ? ["card-scope-v1", null] : null];

    /** @type {Promise<ReturnType<typeof findTokens>> | undefined} */
    let tokensForRequest;
    function loadTokens() {
      const store = contextRead ?? inspect;
      if (typeof store?.identity !== "function") throw new CoreError("capability_unavailable");
      return tokensForRequest ??= uow.run(scope.owner, { readOnly: true }, async tx =>
        findTokens(await store.identity(tx)));
    }
    const rawRequested = selected("raw");
    const rawAvailable = capabilities.rawArchive && raw;
    const searchRaw = rawRequested && query && rawAvailable;
    const cardRequested = selected("card");
    const loadCardVisibility = cardVisibilityLoader(documentCards);
    const cardAvailable = capabilities.documentCardSearch && documentCardCandidates && loadCardVisibility;
    const searchCards = cardRequested && query && cardAvailable;

    /** @type {Promise<Embedding> | undefined} */
    let sharedEmbedding;
    /** @type {Embedding | undefined} */
    let firstEmbedding;
    /** @param {FindPosition} page @param {ReturnType<typeof findTokens> | undefined} tokens */
    async function rankingEmbedding(page, tokens) {
      if (page.model === null) return undefined;
      try {
        if (embedQuery) {
          sharedEmbedding ??= (async () => {
            await gate.assertOpen(scope.owner, "dispatch");
            return embedRecallQuery(embedQuery, scope.owner, query);
          })();
          const embedding = await sharedEmbedding;
          if (await tokens?.mac(embedding.model) === page.model) return embedding;
        }
      } catch {
        // A continuation needs the ranking path from its first page.
      }
      throw new CoreError("cursor_stale");
    }

    /** @type {MemoryRow[]} */
    let memories = [];
    let memory = notSearched();
    if (selected("memory")) {
      let wrongModel = false;
      try {
        const tokens = paging ? await loadTokens() : undefined;
        const request = binding("memory");
        const page = tokens ? await tokens.read(cursors?.memory, request, "memory") : null;
        if (page?.model && (!embedQuery || !capabilities.semanticRetrieval || !storage.vector)) {
          throw new CoreError("invalid_cursor");
        }
        // Capture the embedding as recall computes it and check a hybrid
        // continuation's model before sending the vector to the memory index.
        let search = paging ? pageMemories : searchMemories;
        if (embedQuery && (paging ? query : searchRaw || searchCards)) search = recallSearch({
          ...(paging ? memoryDeps : deps),
          embedQuery: {
            async embedQuery(owner, text, options) {
              sharedEmbedding ??= embedQuery.embedQuery(owner, text, options);
              const embedding = await sharedEmbedding;
              firstEmbedding = embedding;
              if (page?.model && page.model !== await tokens?.mac(embedding.model)) {
                wrongModel = true;
                throw new CoreError("invalid_cursor");
              }
              return embedding;
            },
          },
        }, paging ? findLexicalPage : undefined);
        const result = await search(scope, query, { cursor: page?.position ?? null, limit, mode: "search" }, filters);
        const inner = result.nextCursor;
        let nextCursor = null;
        if (tokens && inner !== null) {
          // Lexical fallback and recent use no embedding on later pages.
          const position = /** @type {unknown[]} */ (decodeCursor(inner));
          nextCursor = await tokens.write({
            position: inner, state: null, model: query && position.at(-1) === "hybrid" && firstEmbedding
              ? await tokens.mac(firstEmbedding.model) : null,
          }, request);
        }
        memories = result.items;
        memory = { status: "ok", count: memories.length, ...(paging && { nextCursor }) };
      } catch (error) {
        memory = unavailable(wrongModel ? new CoreError("invalid_cursor") : error, paging);
      }
    }

    /** @type {RawSegment[]} */
    let segments = [];
    let rawLayer = notSearched(rawRequested && !rawAvailable);
    if (searchRaw || cursors?.raw !== undefined) {
      try {
        const tokens = paging ? await loadTokens() : undefined;
        const request = binding("raw");
        const page = tokens ? await tokens.read(cursors?.raw, request, "raw") : null;
        if (searchRaw) {
          const embedding = page ? await rankingEmbedding(page, tokens) : firstEmbedding;
          const offset = Number(page?.position ?? 0);
          ({ segments, layer: rawLayer } = await uow.run(scope.owner, { readOnly: true }, async tx => {
            const result = await searchRaw.raw(tx, readScope, query, "search",
              { limit, ...(paging && { offset }), ...(embedding?.vector && { queryVector: embedding.vector }) });
            const state = tokens && result.page
              ? await tokens.mac(JSON.stringify([result.page.state, result.coverage.complete])) : null;
            if (page && state !== page.state) throw new CoreError("cursor_stale");
            const segments = await visibleRawSegments(result.segments, readScope, tx, fence);
            const nextCursor = tokens && state && result.page?.hasMore ? await tokens.write({
              position: offset + limit, state, model: embedding?.vector ? await tokens.mac(embedding.model) : null,
            }, request) : null;
            /** @type {Layer} */
            const layer = { status: "ok", count: segments.length, ...(paging && { nextCursor }) };
            if (result.coverage.complete === false) layer.code = "index_unavailable";
            return { segments, layer };
          }));
        } else if (page) throw new CoreError("cursor_stale");
      } catch (error) {
        rawLayer = unavailable(error, paging);
      }
    }

    /** @type {DocumentCardFindItem[]} */
    let cards = [];
    let card = notSearched(cardRequested && query.length > 0 && !cardAvailable);
    if (searchCards || cursors?.card !== undefined) {
      try {
        const tokens = paging ? await loadTokens() : undefined;
        const request = binding("card");
        const page = tokens ? await tokens.read(cursors?.card, request, "card") : null;
        if (searchCards && documentCards && documentCardCandidates && loadCardVisibility) {
          const pool = FUSION_PRESETS.hosted.pool;
          const embedding = page ? await rankingEmbedding(page, tokens) : firstEmbedding;
          const offset = Number(page?.position ?? 0);
          const result = await uow.run(scope.owner, { readOnly: true }, async tx => {
            const words = await documentCardCandidates.lexical(tx, readScope, query, pool, {});
            const semantic = embedding?.vector && embedding.model
              ? await documentCardCandidates.vector(tx, readScope, embedding.vector, embedding.model, pool)
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
              { offset: 0, limit: paging ? 2 * pool : limit, floor: false },
            );
            const hasMore = offset + limit < rows.length;
            let state = null;
            if (tokens && (page || hasMore)) {
              const generation = await documentCardCandidates.stateToken?.(tx, readScope);
              state = await tokens.mac(JSON.stringify([generation, semantic?.coverage.complete === true, rows.map(row => {
                const card = byRef.get(row.ref)?.card;
                return [row.ref, String(row.updatedAtUs), row.score, card?.title, card?.body];
              })]));
              if (page && page.state !== state) throw new CoreError("cursor_stale");
            }
            const items = [];
            for (const { ref } of rows.slice(offset, offset + limit)) {
              const visible = await readVisibleCard(documentCards, loadCardVisibility, tx, scope, ref);
              if (visible) items.push(documentCardFindItem(visible.card, query));
            }
            const nextCursor = tokens && hasMore ? await tokens.write({
              position: offset + limit, state, model: semantic && embedding ? await tokens.mac(embedding.model) : null,
            }, request) : null;
            return { items, nextCursor };
          });
          cards = result.items;
          card = { status: "ok", count: cards.length, ...(paging && { nextCursor: result.nextCursor }) };
        } else if (page) throw new CoreError("cursor_stale");
      } catch (error) {
        card = unavailable(error, paging);
      }
    }
    return { memories, cards, raw: segments, layers: { memory, card, raw: rawLayer } };
  });
  // A null query leaves both the raw and card arrays empty.
  return /** @type {MemoryService["find"]} */ (find);
}

/** @param {Pick<import("../ports/index.d.ts").StorageAdapter, "uow" | "hydrate" | "fence">} storage
 * @returns {MemoryService["read"]} */
export function readMethod({ uow, hydrate, fence }) {
  return entry(async (input, target) => {
    const scope = scopeOf(input);
    const { type, id } = validateObject(target, ["type", "id"]);
    if ((type !== "memory" && type !== "card") || typeof id !== "string") throw new CoreError("invalid_input");
    if (type === "card" || !hydrate) throw new CoreError("capability_unavailable");

    const readScope = readSet(scope);
    /** @type {import("../ports/common.d.ts").ItemRef} */
    const ref = { type, id, namespace: scope.namespace };
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
}

/** @param {Pick<StorageAdapter, "uow" | "documentCards">} storage
 * @returns {MemoryService["readCard"]} */
export function readCardMethod({ uow, documentCards }) {
  return entry(async (input, id) => {
    const scope = scopeOf(input);
    if (typeof id !== "string") throw new CoreError("invalid_input");
    const load = cardVisibilityLoader(documentCards);
    if (!documentCards || !load) throw new CoreError("capability_unavailable");
    return uow.run(scope.owner, { readOnly: true }, async tx => {
      const visible = await readVisibleCard(documentCards, load, tx, scope, { type: "card", id, namespace: scope.namespace });
      if (!visible) return { status: "not_found" };
      const { card: { title, body, date, origin, sourceMessage, sourceMemories }, memoryStates } = visible;
      const sourceMemoryIds = sourceMemories.filter(({ id }) => {
        const state = memoryStates.get(id)?.status;
        return state === "visible" || state === "historical";
      }).map(({ id }) => id);
      return {
        status: "found",
        card: { id, title, body, date, origin: origin ?? null, sourceClient: sourceMessage?.client ?? null, sourceMemoryIds },
      };
    });
  });
}
