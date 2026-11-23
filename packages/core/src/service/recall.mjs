import { validateObject } from "../capture/validate.mjs";
import { DEFAULT_FUSION_PRESET, FUSION_PRESETS, VECTOR_ONLY_FLOOR } from "../decisions.mjs";
import { CoreError } from "../errors.mjs";
import { normalizeForHash, prepareCoreText } from "../privacy/text.mjs";
import { canonicalKey } from "../retrieval/bm25.mjs";
import { fuseCandidates, fuseHosted, fuseHostedLexicalOnly } from "../retrieval/fusion.mjs";
import { encodeCursor, pageLimit } from "../retrieval/hosted-paging.mjs";
import { entry, scopeOf } from "./entry.mjs";
import { readCursor, readSet, readStateToken, recentPage } from "./reads.mjs";

/** @typedef {import("../ports/retrieval.d.ts").LexicalRow} LexicalRow */
/** @typedef {import("../ports/retrieval.d.ts").VectorRow} VectorRow */
/** @typedef {import("../ports/common.d.ts").ItemRef} ItemRef */
/** @typedef {import("../ports/common.d.ts").MemoryRow} MemoryRow */

/** @param {string} query */
async function queryDigest(query) {
  const digest = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(query));
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, "0")).join("");
}

/** @param {LexicalRow[]} lexical @param {VectorRow[] | null} vector
 * @param {{ offset: number, limit: number, floor: boolean }} page
 * @param {keyof typeof FUSION_PRESETS} preset
 */
function rankPage(lexical, vector, page, preset) {
  if (preset === DEFAULT_FUSION_PRESET.hosted) {
    return vector === null ? fuseHostedLexicalOnly(lexical, page) : fuseHosted(lexical, vector, page);
  }

  const semantic = vector?.map(row => ({ ref: row.ref, score: -row.distance })) ?? [];
  const { rows } = fuseCandidates(lexical, semantic, {
    preset, semanticState: vector === null ? "disabled" : "ready", coverageComplete: vector !== null,
  });
  const kept = page.floor ? rows.filter(row => row.channels.lexical !== null ||
    (row.channels.semantic !== null && -row.channels.semantic.rawScore <= VECTOR_ONLY_FLOOR)) : rows;
  return { rows: kept.slice(page.offset, page.offset + page.limit), total: kept.length };
}

/** @param {import("./index.d.mts").MemoryServiceDeps} deps */
export function recallMethod({ storage, embedQuery, gate, config }) {
  const { uow, snapshot, lexical, vector, capabilities, hydrate, fence } = storage;
  const preset = config.fusionPreset ?? DEFAULT_FUSION_PRESET.hosted;

  return entry(async (input, raw, options) => {
    const scope = scopeOf(input);
    if (typeof raw !== "string") throw new CoreError("invalid_input");
    const query = prepareCoreText(raw);
    const { cursor, limit: requestedLimit, mode } = validateObject(options, ["cursor", "limit", "mode"]);
    if (requestedLimit !== undefined && typeof requestedLimit !== "number") throw new CoreError("invalid_input");
    if (mode !== "search" && mode !== "plugin") throw new CoreError("invalid_input");
    const limit = pageLimit(requestedLimit);
    const binding = ["recall-v1", scope.owner, scope.namespace, await queryDigest(query), mode, limit, preset];

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

    const position = readCursor(cursor, binding, 2);
    const [positionToken, offset = 0] = position ?? [];
    if (position && (typeof positionToken !== "string" || !positionToken || !Number.isSafeInteger(position[1]) ||
        offset < 0 || offset > Number.MAX_SAFE_INTEGER - limit - 1)) {
      throw new CoreError("cursor_stale");
    }
    if (!lexical || !hydrate) throw new CoreError("capability_unavailable");

    let embedding = null;
    if (embedQuery && capabilities.semanticRetrieval === true && vector) {
      const text = normalizeForHash(query);
      try {
        // Hosted search itself has no pause check (index.ts:65–83,119–133).
        // A closed send gate or a failed query embed leaves lexical search available.
        await gate.assertOpen(scope.owner, "dispatch");
        embedding = await embedQuery.embedQuery(scope.owner, text, { budgetClass: "recall" });
      } catch {
        embedding = null;
      }
    }

    const readScope = readSet(scope);
    const hostedPool = FUSION_PRESETS.hosted.pool;
    const engine = FUSION_PRESETS["rrf-k60-d12"];
    // Fetch enough lexical rows for the hybrid pool and for lexical fallback, including lookahead.
    const lexicalDepth = preset === DEFAULT_FUSION_PRESET.hosted
      ? Math.max(embedding ? hostedPool : 0, offset + limit + 1)
      : engine.unionMaximum;
    const vectorDepth = preset === DEFAULT_FUSION_PRESET.hosted ? hostedPool : engine.depth;
    /** @param {ItemRef} ref */
    const isScopedMemory = ref => ref.type === "memory" && ref.namespace === scope.namespace;

    return uow.run(scope.owner, { readOnly: true }, async tx => {
      const token = await readStateToken(snapshot, tx, readScope, positionToken);
      const words = await lexical.lexical(tx, readScope, query, lexicalDepth, {});
      const semantic = embedding && vector
        ? await vector.vector(tx, readScope, embedding.vector, embedding.model, vectorDepth)
        : null;
      const { rows, total } = rankPage(
        words.rows.filter(row => isScopedMemory(row.ref)),
        semantic?.coverage.complete === true ? semantic.rows.filter(row => isScopedMemory(row.ref)) : null,
        { offset, limit, floor: mode === "plugin" }, preset,
      );
      const refs = rows.map(row => row.ref);
      const hydrated = refs.length ? await hydrate.hydrate(tx, readScope, refs, "recall") : [];
      /** @type {Map<string, MemoryRow>} */
      const memories = new Map();
      for (const { ref, memory } of hydrated) {
        if (isScopedMemory(ref) && memory?.id === ref.id && memory.scope.owner === scope.owner &&
            memory.scope.namespace === ref.namespace) {
          memories.set(canonicalKey(ref), memory);
        }
      }
      const nextOffset = offset + limit;
      const nextCursor = nextOffset < total ? encodeCursor([...binding, token, nextOffset]) : null;
      const visible = new Set((refs.length ? await fence.assertVisible(tx, readScope, refs) : []).map(canonicalKey));
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
