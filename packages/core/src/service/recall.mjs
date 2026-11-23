import { validateObject } from "../capture/validate.mjs";
import { FUSION_PRESETS } from "../decisions.mjs";
import { CoreError } from "../errors.mjs";
import { normalizeForHash, prepareCoreText } from "../privacy/text.mjs";
import { canonicalKey } from "../retrieval/bm25.mjs";
import { fuseHosted, fuseHostedLexicalOnly } from "../retrieval/fusion.mjs";
import { encodeCursor, pageLimit } from "../retrieval/hosted-paging.mjs";
import { entry, scopeOf } from "./entry.mjs";
import { readCursor, readSet, readStateToken, recentPage } from "./reads.mjs";

/** @typedef {import("../ports/common.d.ts").ItemRef} ItemRef */
/** @typedef {import("../ports/common.d.ts").MemoryRow} MemoryRow */

/** @param {string} query */
async function queryDigest(query) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(query));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {import("./index.d.mts").MemoryServiceDeps} deps */
export function recallMethod({ storage, embedQuery, gate }) {
  const { uow, snapshot, lexical, vector, capabilities, hydrate, fence } = storage;

  return entry(async (input, raw, options) => {
    const scope = scopeOf(input);
    if (typeof raw !== "string") throw new CoreError("invalid_input");
    const query = prepareCoreText(raw);
    const { cursor, limit: requestedLimit, mode } = validateObject(options, ["cursor", "limit", "mode"]);
    if (requestedLimit !== undefined && typeof requestedLimit !== "number") throw new CoreError("invalid_input");
    if (mode !== "search" && mode !== "plugin") throw new CoreError("invalid_input");
    const limit = pageLimit(requestedLimit);
    const binding = ["recall-v2", scope.owner, scope.namespace, await queryDigest(query), mode, limit];

    if (!query) {
      const position = readCursor(cursor, binding, 1);
      const [inner] = position ?? [];
      if (position && (typeof inner !== "string" || !inner)) throw new CoreError("cursor_stale");
      const result = await recentPage(storage, scope, { cursor: inner ?? null, limit });
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
    if (positionPath !== "lexical" && embedQuery && capabilities.semanticRetrieval === true && vector) {
      const text = normalizeForHash(query);
      try {
        // Hosted search itself has no pause check (index.ts:65–83,119–133).
        // A closed send gate or failed query embed leaves lexical search available on the first page.
        await gate.assertOpen(scope.owner, "dispatch");
        embedding = await embedQuery.embedQuery(scope.owner, text, { budgetClass: "recall" });
      } catch {
        embedding = null;
      }
    }
    if (positionPath === "hybrid" && !embedding) throw new CoreError("cursor_stale");

    const readScope = readSet(scope);
    const hostedPool = FUSION_PRESETS.hosted.pool;
    // Fetch enough lexical rows for the hybrid pool and for lexical fallback, including lookahead.
    const lexicalDepth = Math.max(embedding ? hostedPool : 0, offset + limit + 1);
    /** @param {ItemRef} ref */
    const isScopedMemory = ref => ref.type === "memory" && ref.namespace === scope.namespace;

    const { rows, nextCursor } = await uow.run(scope.owner, { readOnly: true }, async tx => {
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
      return { rows, nextCursor };
    });

    if (!rows.length) return { items: [], nextCursor, scores: [] };
    return uow.run(scope.owner, { readOnly: true }, async tx => {
      const refs = rows.map(row => row.ref);
      const hydrated = await hydrate.hydrate(tx, readScope, refs, "recall");
      /** @type {Map<string, MemoryRow>} */
      const memories = new Map();
      for (const { ref, memory } of hydrated) {
        if (isScopedMemory(ref) && memory?.id === ref.id && memory.scope.owner === scope.owner &&
            memory.scope.namespace === ref.namespace) {
          memories.set(canonicalKey(ref), memory);
        }
      }
      const visible = new Set((await fence.assertVisible(tx, readScope, refs)).map(canonicalKey));
      /** @type {MemoryRow[]} */
      const items = [];
      /** @type {number[]} */
      const scores = [];
      for (const { ref, score } of rows) {
        const key = canonicalKey(ref);
        const memory = memories.get(key);
        if (memory && visible.has(key)) {
          items.push(memory);
          scores.push(score);
        }
      }
      return { items, nextCursor, scores };
    });
  });
}
