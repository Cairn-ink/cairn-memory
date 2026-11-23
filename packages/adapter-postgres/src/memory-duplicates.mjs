import { compareUtf8 } from "../../core/src/index.mjs";
import { readCandidate, storageHash } from "./memory-rows.mjs";

/** @import { DuplicateQuery, MemoryMatch, Scope } from "../../core/src/ports/index.d.ts" */
/** @import { CandidateEntry, Query } from "./memory-rows.mjs" */
/** @import { readVisibility } from "./memory-visibility.mjs" */

/** @typedef {Awaited<ReturnType<typeof readVisibility>>} Visibility */

// Bound transfer and privacy checks per incoming vector.
const NEAR_CANDIDATE_LIMIT = 32;

/** @param {DuplicateQuery} query */
export function exactHashes({ textHash, legacyHash }) {
  return legacyHash === undefined ? [storageHash(textHash)] : [storageHash(textHash), storageHash(legacyHash)];
}

/** @param {Query} query @param {string} owner @param {string} columns
 * @param {readonly string[]} hashes @param {string | undefined} excluded */
export async function exactCandidates(query, owner, columns, hashes, excluded) {
  if (!hashes.length) return [];
  const { rows } = await query(`SELECT ${columns} FROM memories
    WHERE user_id = $1 AND text_hash = ANY($2::text[]) AND ($3::text IS NULL OR id <> $3)`, [owner, hashes, excluded ?? null]);
  return rows;
}

/** @param {DuplicateQuery["embedding"]} embedding */
function nearVector(embedding) {
  if (embedding?.length !== 1536) return null;
  const vector = embedding.map(Math.fround);
  return vector.every(Number.isFinite) && vector.some(value => value !== 0) ? JSON.stringify(vector) : null;
}

/** @param {Query} query @param {Scope} scope @param {string | null} ns @param {Visibility} visibility
 * @param {DuplicateQuery[]} batch @param {boolean} near @param {number} threshold @param {string | undefined} excluded */
export async function duplicateMatches(query, scope, ns, visibility, batch, near, threshold, excluded) {
  const hashes = batch.map(exactHashes);
  const exactRows = await exactCandidates(query, scope.owner,
    visibility.candidateColumns(scope.namespace, { exact: true, distance: batch.some(item => item.embedding?.length === 1536) }),
    [...new Set(hashes.flat())], excluded);
  const exact = new Map(exactRows.map(row => [storageHash(row.logical_hash), readCandidate(row, scope.owner)]));
  const nearColumns = near ? visibility.candidateColumns(scope.namespace) : null;

  /** @type {Map<string, CandidateEntry>} */
  const entries = new Map();
  /** @param {CandidateEntry} entry @param {"exact" | "near"} match @param {number} cosine @returns {MemoryMatch} */
  function stored(entry, match, cosine) {
    const { id, revision, updatedAtUs } = entry.memory;
    entries.set(id, entry);
    return { kind: "stored", match, distance: cosine, id, revision, writeTimeUs: updatedAtUs };
  }

  /** @type {MemoryMatch[][]} */
  const matches = [];
  for (const [i, item] of batch.entries()) {
    const key = hashes[i];
    const result = [...new Set(key)].flatMap(hash => {
      const entry = exact.get(hash);
      return entry ? [stored(entry, "exact", distance(item.embedding, entry.memory.embedding?.vector) ?? 0)] : [];
    });

    const vector = near ? nearVector(item.embedding) : null;
    if (vector !== null) {
      const { rows } = await query(`SELECT ${nearColumns},
        embedding <=> $3::vector AS distance FROM memories
        WHERE user_id = $1 AND core_namespace IS NOT DISTINCT FROM $2
          AND ($4::text IS NULL OR id <> $4) AND text_hash <> ALL($5::text[])
          AND currentness IS DISTINCT FROM 'historical'
        ORDER BY embedding <=> $3::vector, updated_at DESC, id COLLATE "C" DESC LIMIT $6`,
      [scope.owner, ns, vector, excluded ?? null, key, NEAR_CANDIDATE_LIMIT]);
      for (const row of rows) {
        if (Number.isFinite(row.distance) && row.distance <= threshold) {
          result.push(stored(entries.get(row.id) ?? readCandidate(row, scope.owner), "near", row.distance));
        }
      }
    }
    for (let j = 0; j < i; j++) {
      const prior = key.includes(hashes[j][0]);
      if (!prior && !near) continue;
      const cosine = distance(item.embedding, batch[j].embedding);
      if (prior || (cosine !== undefined && cosine <= threshold)) {
        result.push({ kind: "prior", match: prior ? "exact" : "near", distance: cosine ?? 0, batchIndex: j });
      }
    }
    matches.push(result.sort(matchOrder));
  }
  const scoped = [...entries.values()].filter(({ memory }) => memory.scope.namespace === scope.namespace);
  const visible = new Set((await visibility.check(scoped)).filter(entry => !entry.hidden).map(({ memory }) => memory.id));
  return { matches, visible };
}

/** @param {ArrayLike<number> | null | undefined} a @param {ArrayLike<number> | null | undefined} b */
function distance(a, b) {
  if (!a || !b || a.length !== b.length) return undefined;
  let aa = 0;
  let bb = 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) {
    // Compare prior items at the same precision as rows persisted by pgvector.
    const x = Math.fround(a[i]);
    const y = Math.fround(b[i]);
    aa += x * x;
    bb += y * y;
    dot += x * y;
  }
  if (!aa || !bb || !Number.isFinite(dot)) return undefined;
  return 1 - Math.max(-1, Math.min(1, dot / Math.sqrt(aa * bb)));
}

/** @param {MemoryMatch} a @param {MemoryMatch} b */
function matchOrder(a, b) {
  if (a.match !== b.match) return a.match === "exact" ? -1 : 1;
  const byDistance = (a.distance ?? 0) - (b.distance ?? 0);
  if (byDistance) return byDistance;
  if (a.kind === "prior") return b.kind === "prior" ? b.batchIndex - a.batchIndex : -1;
  if (b.kind === "prior") return 1;
  if (a.writeTimeUs !== b.writeTimeUs) return a.writeTimeUs > b.writeTimeUs ? -1 : 1;
  return compareUtf8(b.id, a.id);
}
