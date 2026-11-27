import { createCaptureDeadline } from "../capture/deadline.mjs";
import { identifier, revision, validateObject } from "../capture/validate.mjs";
import { NEAR_DUPLICATE_DISTANCE } from "../decisions.mjs";
import { CoreError } from "../errors.mjs";
import { planConflictInsert, planSupersede } from "../memory-policy/index.mjs";
import { RELATION_LIMIT } from "../memory-policy/relation-limits.mjs";
import { normalizeForHash } from "../privacy/text.mjs";
import { judgeMemoryRelations } from "../relations/judge.mjs";
import { compareSortKey, compareUtf8 } from "../utf8.mjs";
import { entry, scopeOf } from "./entry.mjs";
import { validWriteEmbedding } from "./writes.mjs";

/** @import { ItemRef, MemoryRow, MemoryService, Scope, Tx } from "../ports/index.d.ts" */
/** @import { MemoryServiceDeps } from "./index.d.mts" */
/** @typedef {NonNullable<MemoryService["judgeRelations"]>} JudgeRelations */

export const RELATION_JUDGE_MIN_DISTANCE = NEAR_DUPLICATE_DISTANCE;
export const RELATION_JUDGE_MAX_DISTANCE = 0.45;
export const RELATION_JUDGE_CANDIDATES = RELATION_LIMIT;
export const RELATION_JUDGE_DEPTH = 16;

const INFERRED_HINT = "inferred-hint";

/** @param {Scope} scope @param {string} id @returns {ItemRef} */
const memoryRef = ({ namespace }, id) => ({ type: "memory", namespace, id });

/** @param {MemoryRow} row */
const endpoint = ({ id, revision }) => ({ id, revision });

/** @param {"stale" | "no_candidates" | "incomplete_coverage"} reason */
const skippedResult = reason => /** @type {const} */ ({ status: "skipped", reason });
const pausedResult = Object.freeze({ status: "paused" });
const pausedBeforeSend = new CoreError("capture_paused");
const staleBeforeSend = new CoreError("snapshot_stale");

/** @param {MemoryServiceDeps} deps */
export function relationJudgeMethods({ storage, model, embedder, gate, clock, config, diagnostics }) {
  const { uow, pause, hydrate, fence, vector, supersession, conflicts, memories, capabilities } = storage;

  /** @type {JudgeRelations} */
  const judgeRelations = entry(async (scope, { id, revision: expectedRevision }, options = {}) => {
    if (!model || !supersession || !conflicts || !vector || !embedder || capabilities.semanticRetrieval !== true) {
      throw new CoreError("capability_unavailable");
    }

    const { owner, namespace } = scope;
    const selection = { owner, namespaces: [namespace] };
    const ref = memoryRef(scope, id);
    const embeddingModel = embedder.model;

    /** @param {Tx} tx @param {ItemRef[]} refs */
    async function currentRows(tx, refs) {
      const rows = await hydrate.hydrate(tx, selection, refs, "read");
      const visible = new Set((await fence.assertVisible(tx, selection, refs, "read"))
        .filter(ref => ref.type === "memory" && ref.namespace === namespace).map(ref => ref.id));
      /** @type {Map<string, MemoryRow>} */
      const current = new Map();
      for (const { ref, memory } of rows) {
        if (ref.type === "memory" && ref.namespace === namespace && visible.has(ref.id) &&
            memory?.id === ref.id && memory.scope.owner === owner && memory.scope.namespace === namespace &&
            !memory.historical) current.set(ref.id, memory);
      }
      return current;
    }

    /** @param {number} generation @param {ReturnType<typeof endpoint>[]} [candidates] */
    const recheckBeforeSend = (generation, candidates = []) => uow.run(owner, { readOnly: true, pauseLock: true }, async tx => {
      const state = await pause.get(tx, owner);
      if (state.paused || state.generation !== generation) return pausedResult;
      const rows = await currentRows(tx, [ref, ...candidates.map(row => memoryRef(scope, row.id))]);
      if (rows.get(id)?.revision !== expectedRevision || candidates.some(row => rows.get(row.id)?.revision !== row.revision)) {
        return skippedResult("stale");
      }
    });

    /** @param {{ query: Float32Array; generation: number }} [fallback] */
    const discover = fallback => uow.run(owner, { readOnly: true, pauseLock: true }, async tx => {
      const state = await pause.get(tx, owner);
      if (state.paused || (fallback && state.generation !== fallback.generation)) return pausedResult;
      const memory = (await currentRows(tx, [ref])).get(id);
      if (memory?.revision !== expectedRevision) return skippedResult("stale");
      const stored = memory.embedding?.model === embeddingModel ? memory.embedding : null;
      const query = stored ? new Float32Array(stored.vector) : fallback?.query;
      if (!query) return /** @type {const} */ ({ status: "embed", text: memory.text, generation: state.generation });

      const { rows, coverage } = await vector.vector(tx, selection, query, embeddingModel, RELATION_JUDGE_DEPTH);
      if (!coverage.complete) return skippedResult("incomplete_coverage");
      const nearby = rows.filter(({ ref, distance }) => ref.type === "memory" && ref.id !== id &&
        distance > RELATION_JUDGE_MIN_DISTANCE && distance <= RELATION_JUDGE_MAX_DISTANCE)
        .sort((a, b) => a.distance - b.distance || compareSortKey(b.updatedAtUs, a.updatedAtUs) ||
          compareUtf8(b.ref.id, a.ref.id))
        .slice(0, RELATION_JUDGE_CANDIDATES);
      if (!nearby.length) return skippedResult("no_candidates");
      const hydrated = await currentRows(tx, nearby.map(({ ref }) => ref));
      const candidates = nearby.flatMap(({ ref }) => {
        const row = hydrated.get(ref.id);
        return row ? [row] : [];
      });
      if (!candidates.length) return skippedResult("no_candidates");
      return /** @type {const} */ ({ status: "ready", memory, candidates, generation: state.generation });
    });

    let discovery = await discover();
    if (discovery.status === "embed") {
      await gate.assertOpen(owner, "dispatch");
      const blocked = await recheckBeforeSend(discovery.generation);
      if (blocked) return blocked;
      checkCallOptions(options, clock);
      const [query] = await embedder.embed([normalizeForHash(discovery.text)], options);
      if (!validWriteEmbedding(query, embedder.dimensions)) throw new CoreError("embedding_failed");
      discovery = await discover({ query, generation: discovery.generation });
    }
    if (discovery.status !== "ready") {
      if (discovery.status === "embed") throw new CoreError("internal_error");
      return discovery;
    }
    const { memory, candidates, generation } = discovery;
    const remaining = checkCallOptions(options, clock);
    const deadline = createCaptureDeadline(Math.min(config.deadlines?.reconcile ?? 30_000, remaining), clock);
    let verdicts;
    try {
      verdicts = await judgeMemoryRelations(model, memory, candidates, {
        gate, owner, deadline, signal: options.signal, onDiagnostic: options.onDiagnostic ?? diagnostics,
        // The window after refresh is the host gate's dispatch await plus a synchronous section.
        async refresh() {
          const blocked = await recheckBeforeSend(generation, candidates);
          if (blocked?.status === "paused") throw pausedBeforeSend;
          if (blocked) throw staleBeforeSend;
        },
      });
    } catch (error) {
      if (error === pausedBeforeSend) return pausedResult;
      if (error === staleBeforeSend) return skippedResult("stale");
      throw error;
    }

    return uow.run(owner, { pauseLock: true }, async tx => {
      const state = await pause.get(tx, owner);
      if (state.paused || state.generation !== generation) return pausedResult;
      const rows = await currentRows(tx, [ref, ...verdicts.map(({ predecessorIndex }) =>
        memoryRef(scope, candidates[predecessorIndex].id))]);
      const replacement = rows.get(id);
      if (replacement?.revision !== expectedRevision) return skippedResult("stale");

      const superseded = [];
      const contradicts = [];
      let skipped = 0;
      for (const relation of /** @type {const} */ (["supersedes", "contradicts"])) {
        for (const verdict of verdicts) {
          if (verdict.relation !== relation) continue;
          const original = candidates[verdict.predecessorIndex];
          const candidate = rows.get(original.id);
          if (candidate?.revision !== original.revision) {
            skipped++;
            continue;
          }
          if (relation === "supersedes") {
            const incoming = await supersession.incomingCount(tx, scope, id);
            try {
              planSupersede(candidate, candidate.revision, replacement.textHash, incoming);
            } catch (error) {
              if (!(error instanceof CoreError) || !["invalid_ref", "supersession_limit"].includes(error.code)) throw error;
              skipped++;
              continue;
            }
            const now = clock.nowMs();
            await supersession.record(tx, scope, { previous: endpoint(candidate), replacement: endpoint(replacement) }, [], now);
            await supersession.markHistorical(tx, scope, candidate.id, now);
            superseded.push(candidate.id);
            continue;
          }

          const existing = await conflicts.list(tx, scope, id);
          const increment = existing.some(edge => edge.memoryId === candidate.id && edge.revision === candidate.revision &&
            edge.relation === "contradicts" && edge.source === INFERRED_HINT) ? 0 : 1;
          const degreeAfter = new Map([
            [id, await conflicts.degree(tx, scope, id) + increment],
            [candidate.id, await conflicts.degree(tx, scope, candidate.id) + increment],
          ]);
          let leftId;
          try {
            [[leftId]] = planConflictInsert(id, [candidate.id], degreeAfter);
          } catch (error) {
            if (!(error instanceof CoreError) || error.code !== "conflict_limit") throw error;
            skipped++;
            continue;
          }
          const ends = [endpoint(replacement), endpoint(candidate)];
          if (leftId !== id) ends.reverse();
          const [left, right] = ends;
          const { inserted } = await conflicts.insert(tx, scope, { left, right, relation, source: INFERRED_HINT }, clock.nowMs());
          if (inserted) contradicts.push(candidate.id);
        }
      }
      const indexRevision = await memories.committedIndexRevision?.(tx);
      return { status: "judged", superseded, contradicts, skipped, ...(indexRevision === undefined ? {} : { indexRevision }) };
    });
  }, undefined, ([scope, memory, options]) => {
    const fields = validateObject(memory, ["id", "revision"]);
    return [scopeOf(scope), { id: identifier(fields.id), revision: revision(fields.revision) }, options && { ...options }];
  });

  return { judgeRelations };
}

/** @param {import("../ports/index.d.ts").CallOptions} options @param {MemoryServiceDeps["clock"]} clock */
function checkCallOptions({ signal, deadlineAtMs }, clock) {
  if (signal?.aborted) throw new CoreError("model_cancelled");
  if (deadlineAtMs === undefined) return Infinity;
  if (!Number.isFinite(deadlineAtMs)) throw new CoreError("invalid_input");
  const remaining = Math.floor(deadlineAtMs - clock.monotonicMs());
  if (remaining < 1) throw new CoreError("model_timeout");
  return remaining;
}
