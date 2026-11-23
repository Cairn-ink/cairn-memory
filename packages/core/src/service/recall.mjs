import { emitDiagnostic } from "../capture/model-call.mjs";
import { validateObject } from "../capture/validate.mjs";
import { FUSION_PRESETS } from "../decisions.mjs";
import { CoreError } from "../errors.mjs";
import { normalizeForHash, prepareCoreText } from "../privacy/text.mjs";
import { canonicalKey } from "../retrieval/bm25.mjs";
import { fuseHosted, fuseHostedLexicalOnly } from "../retrieval/fusion.mjs";
import { encodeCursor, pageLimit } from "../retrieval/hosted-paging.mjs";
import { entry, scopeOf } from "./entry.mjs";
import { hydrateMemoryRows, readCursor, readSet, readStateToken, recentPage } from "./reads.mjs";

/** @typedef {import("../ports/common.d.ts").ItemRef} ItemRef */
/** @typedef {import("../ports/common.d.ts").MemoryRow} MemoryRow */

/** @param {import("./index.d.mts").MemoryServiceDeps} deps */
export function recallMethod(deps) {
  const search = recallSearch(deps);
  return entry(async (input, raw, options) => {
    const scope = scopeOf(input);
    if (typeof raw !== "string") throw new CoreError("invalid_input");
    const query = prepareCoreText(raw);
    const { cursor, limit: requestedLimit, mode } = validateObject(options, ["cursor", "limit", "mode"]);
    if (requestedLimit !== undefined && typeof requestedLimit !== "number") throw new CoreError("invalid_input");
    if (mode !== "search" && mode !== "plugin") throw new CoreError("invalid_input");
    const limit = pageLimit(requestedLimit);
    return search(scope, query, { cursor, limit, mode });
  });
}

/** @param {import("./index.d.mts").MemoryServiceDeps} deps */
export function recallSearch({ storage, embedQuery, gate, diagnostics, clock }) {
  const { uow, snapshot, lexical, vector, capabilities, hydrate, fence } = storage;
  /**
   * @param {import("../ports/common.d.ts").Scope} scope
   * @param {string} query Prepared by the service entry.
   * @param {{ cursor: unknown; limit: number; mode: "search" | "plugin" }} options
   * @param {Pick<import("../ports/retrieval.d.ts").RetrievalScope, "clients" | "window">} [filters] Used by find for its first page.
   */
  return async (scope, query, { cursor, limit, mode }, filters) => {
    // Refuse an unsupported search before any dependency call, as the other placeholders do.
    if (query && (!lexical || !hydrate)) throw new CoreError("capability_unavailable");
    const binding = ["recall-v2", scope.owner, scope.namespace, await clock.sha256Hex(query), mode, limit];

    if (!query) {
      const position = readCursor(cursor, binding, 1);
      const [inner] = position ?? [];
      if (position && (typeof inner !== "string" || !inner)) throw new CoreError("cursor_stale");
      const result = await recentPage(storage, scope, { cursor: inner ?? null, limit }, filters);
      return {
        items: result.items,
        nextCursor: result.nextCursor === null ? null : encodeCursor([...binding, result.nextCursor]),
        scores: result.items.map(() => 0),
      };
    }

    const position = readCursor(cursor, binding, 3);
    const [positionToken, offset = 0, positionPath] = position ?? [];
    if (position && (typeof positionToken !== "string" || !positionToken || !Number.isSafeInteger(position[1]) ||
        offset < 0 || offset > Number.MAX_SAFE_INTEGER - limit - 1 ||
        (positionPath !== "hybrid" && positionPath !== "lexical"))) {
      throw new CoreError("cursor_stale");
    }
    if (!lexical || !hydrate) throw new CoreError("capability_unavailable");

    let embedding = null;
    // Why this request ranks lexical-only. A declared difference from hosted, whose hybrid search fails instead.
    /** @type {string | null} */
    let fallback = null;
    if (positionPath !== "lexical") {
      if (!embedQuery || capabilities.semanticRetrieval !== true || !vector) {
        fallback = "semantic_unavailable";
      } else {
        const text = normalizeForHash(query);
        // Hosted search itself has no pause check (index.ts:65–83,119–133).
        // A closed send gate or failed query embed leaves lexical search available on the first page.
        try {
          await gate.assertOpen(scope.owner, "dispatch");
        } catch {
          fallback = "dispatch_closed";
        }
        if (!fallback) {
          try {
            embedding = await embedQuery.embedQuery(scope.owner, text, { budgetClass: "recall" });
          } catch {
            embedding = null;
          }
          if (!embedding) fallback = "embed_failed";
        }
      }
    }
    if (positionPath === "hybrid" && !embedding) throw new CoreError("cursor_stale");

    const readScope = readSet(scope, filters);
    const hostedPool = FUSION_PRESETS.hosted.pool;
    // Fetch enough lexical rows for the hybrid pool and for lexical fallback, including lookahead.
    const lexicalDepth = Math.max(embedding ? hostedPool : 0, offset + limit + 1);
    /** @param {ItemRef} ref */
    const isScopedMemory = ref => ref.type === "memory" && ref.namespace === scope.namespace;

    const { rows, nextCursor, memories, path } = await uow.run(scope.owner, { readOnly: true }, async tx => {
      const token = await readStateToken(snapshot, tx, readScope, positionToken);
      const words = await lexical.lexical(tx, readScope, query, lexicalDepth, {});
      const semantic = embedding && vector
        ? await vector.vector(tx, readScope, embedding.vector, embedding.model, hostedPool)
        : null;
      const complete = semantic?.coverage.complete === true;
      if (positionPath === "hybrid" && !complete) throw new CoreError("cursor_stale");
      const path = complete ? "hybrid" : "lexical";
      const lexicalRows = words.rows.filter(row => isScopedMemory(row.ref));
      const page = { offset, limit, floor: mode === "plugin" };
      const { rows, total } = complete
        ? fuseHosted(lexicalRows, semantic.rows.filter(row => isScopedMemory(row.ref)), page)
        : fuseHostedLexicalOnly(lexicalRows, page);
      const nextOffset = offset + limit;
      const nextCursor = nextOffset < total ? encodeCursor([...binding, token, nextOffset, path]) : null;
      const memories = await hydrateMemoryRows(hydrate, tx, readScope, rows.map(row => row.ref), "recall");
      return { rows, nextCursor, memories, path };
    });
    // One content-free event per first page that ranks lexical-only. Continuations on a lexical cursor
    // were already counted, and a hybrid continuation that loses semantics is cursor_stale instead.
    if (positionPath === undefined && path === "lexical") {
      emitDiagnostic(diagnostics, "recall", "core_retrieval", fallback ?? "coverage_incomplete");
    }

    if (!rows.length) return { items: [], nextCursor, scores: [] };
    // Rehydrate beside the fence in a fresh snapshot. A correction can keep the
    // same ref visible while changing the content ranked by the previous run.
    return uow.run(scope.owner, { readOnly: true }, async tx => {
      const refs = rows.map(row => row.ref);
      const current = await hydrateMemoryRows(hydrate, tx, readScope, refs, "recall");
      const visible = new Set((await fence.assertVisible(tx, readScope, refs)).map(canonicalKey));
      /** @type {MemoryRow[]} */
      const items = [];
      /** @type {number[]} */
      const scores = [];
      for (const { ref, score } of rows) {
        const key = canonicalKey(ref);
        const memory = current.get(key);
        if (memory && memory.revision === memories.get(key)?.revision && visible.has(key)) {
          items.push(memory);
          scores.push(score);
        }
      }
      return { items, nextCursor, scores };
    });
  };
}
