import { FUSION_PRESETS, VECTOR_ONLY_FLOOR } from "../decisions.mjs";
import { compareSortKey, compareUtf8 } from "../utf8.mjs";
import { canonicalKey, rankScores } from "./bm25.mjs";

/** @typedef {import("../ports/common.d.ts").ItemRef} ItemRef */
/** @typedef {import("../ports/retrieval.d.ts").LexicalRow} LexicalRow */
/** @typedef {import("../ports/retrieval.d.ts").VectorRow} VectorRow */
/** @typedef {(ItemRef | { ref: ItemRef }) & { score: number }} ScoredRow */
/** @typedef {{ rank: number, rawScore: number } | null} ChannelRank */
/** @typedef {{ lexical: ChannelRank, semantic: ChannelRank, moc?: ChannelRank }} ChannelRanks */
/** @typedef {{ offset: number, limit: number }} Page */
/** @typedef {{ ref: ItemRef, updatedAtUs: bigint, score: number, lexicalRank: number | null, vectorRank: number | null }} HostedRow */

export const RRF_PRESETS = Object.freeze({
  "rrf-k60-d12": Object.freeze({ k: 60, depth: 12, weights: Object.freeze([0.45, 0.45]), unionMaximum: 24 }),
  "rrf-k60-d12-moc-v1": Object.freeze({ k: 60, depth: 12, weights: Object.freeze([0.45, 0.45, 0.10]), unionMaximum: 36 }),
  "rrf-k10": Object.freeze({ k: 10, depth: 24, weights: Object.freeze([0.5, 0.5]), unionMaximum: 48 }),
});

const COMPACT_MEMORY_MAX_ITEMS = 64;
const compactDepth = { depth: COMPACT_MEMORY_MAX_ITEMS, unionMaximum: 2 * COMPACT_MEMORY_MAX_ITEMS };
export const COMPACT_RRF_PRESETS = Object.freeze({
  "rrf-k60-d64-compact": Object.freeze({ ...RRF_PRESETS["rrf-k60-d12"], ...compactDepth }),
  "rrf-k60-d64-moc-compact": Object.freeze({ ...RRF_PRESETS["rrf-k60-d12-moc-v1"], ...compactDepth }),
  "rrf-k10-d64-compact": Object.freeze({ ...RRF_PRESETS["rrf-k10"], ...compactDepth }),
});

const enginePresets = { ...RRF_PRESETS, ...COMPACT_RRF_PRESETS };
const ENGINE_HORIZON = 24;
const channelNames = /** @type {const} */ (["lexical", "semantic", "moc"]);

/** @template {ScoredRow} T @param {readonly T[]} rows @param {number} depth */
function rankChannel(rows, depth) {
  const keys = new Set();
  for (const row of rows) {
    const key = canonicalKey(row);
    if (!Number.isFinite(row.score) || keys.has(key)) throw new TypeError("invalid_channel");
    keys.add(key);
  }
  return rankScores([...rows]).slice(0, depth);
}

/**
 * @template {ScoredRow} L
 * @template {ScoredRow} S
 * @template {ScoredRow} M
 * @param {readonly L[]} lexical
 * @param {readonly S[]} semantic
 * @param {{ preset?: string, limit?: number, semanticState?: string, coverageComplete?: boolean, moc?: readonly M[] }} [opts]
 */
export function fuseCandidates(lexical, semantic, {
  preset = "rrf-k60-d12", limit = ENGINE_HORIZON, semanticState = "disabled", coverageComplete = false, moc = [],
} = {}) {
  const config = enginePresets[/** @type {keyof typeof enginePresets} */ (preset)];
  const horizon = Object.hasOwn(COMPACT_RRF_PRESETS, preset) ? config.depth : ENGINE_HORIZON;
  if (!Object.hasOwn(enginePresets, preset) || !Number.isSafeInteger(limit) || limit < 1 || limit > horizon) {
    throw new TypeError("invalid_fusion");
  }
  const withMoc = preset === "rrf-k60-d12-moc-v1";
  const semanticReady = semanticState === "ready" && coverageComplete;
  if (!withMoc && !semanticReady) {
    const rows = rankChannel(lexical, horizon);
    return { mode: /** @type {const} */ ("lexical"), preset, unionSize: rows.length, rows: rows.slice(0, limit).map((row, i) => ({
      ...row, fusionScore: null, channels: { lexical: { rank: i + 1, rawScore: row.score }, semantic: null },
    })) };
  }
  const channels = [
    rankChannel(lexical, config.depth),
    rankChannel(semanticReady ? semantic : [], config.depth),
    ...(withMoc ? [rankChannel(moc, config.depth)] : []),
  ];
  /** @type {Map<string, { row: L | S | M, score: number, channels: ChannelRanks }>} */
  const scores = new Map();
  channels.forEach((rows, c) => rows.forEach((row, index) => {
    const key = canonicalKey(row);
    let item = scores.get(key);
    if (!item) {
      item = { row, score: 0, channels: { lexical: null, semantic: null, ...(withMoc ? { moc: null } : {}) } };
      scores.set(key, item);
    }
    item.score += config.weights[c] * (1 / (config.k + index + 1));
    item.channels[channelNames[c]] = { rank: index + 1, rawScore: row.score };
  }));
  const rows = [...scores.values()].map(({ row, score, channels }) => ({ ...row, score, channels, fusionScore: score }));
  return { mode: /** @type {const} */ ("hybrid"), preset, unionSize: scores.size,
    rows: rankScores(rows).slice(0, limit) };
}

/** @param {Pick<LexicalRow, "ref" | "updatedAtUs">} a @param {Pick<LexicalRow, "ref" | "updatedAtUs">} b */
function compareHostedTie(a, b) {
  return compareSortKey(b.updatedAtUs, a.updatedAtUs) || compareUtf8(b.ref.id, a.ref.id);
}

/** @param {LexicalRow} a @param {LexicalRow} b */
const compareHostedScore = (a, b) => b.score - a.score || compareHostedTie(a, b);

/**
 * @param {readonly LexicalRow[]} lexicalRows
 * @param {readonly VectorRow[]} vectorRows
 * @param {Page & { floor?: boolean }} opts
 */
export function fuseHosted(lexicalRows, vectorRows, { offset, limit, floor = false }) {
  const { k, lexicalWeight, vectorWeight, pool } = FUSION_PRESETS.hosted;
  const lexical = [...lexicalRows].sort(compareHostedScore).slice(0, pool);
  const vector = [...vectorRows].sort((a, b) => a.distance - b.distance || compareHostedTie(a, b)).slice(0, pool);
  /** @type {Map<string, { row: HostedRow, distance?: number }>} */
  const fused = new Map();
  lexical.forEach(({ ref, updatedAtUs }, index) => {
    const lexicalRank = index + 1;
    const row = { ref, updatedAtUs, score: lexicalWeight / (k + lexicalRank), lexicalRank, vectorRank: null };
    fused.set(canonicalKey(ref), { row });
  });
  vector.forEach(({ ref, updatedAtUs, distance }, index) => {
    const vectorRank = index + 1;
    const key = canonicalKey(ref);
    const score = vectorWeight / (k + vectorRank);
    const entry = fused.get(key);
    if (entry) {
      entry.row.score += score;
      entry.row.vectorRank = vectorRank;
      entry.distance = distance;
    } else {
      fused.set(key, { row: { ref, updatedAtUs, score, lexicalRank: null, vectorRank }, distance });
    }
  });
  const rows = [...fused.values()]
    .filter(({ row, distance }) => !floor || row.lexicalRank !== null || (distance !== undefined && distance <= VECTOR_ONLY_FLOOR))
    .map(({ row }) => row)
    .sort(compareHostedScore);
  return { rows: rows.slice(offset, offset + limit), total: rows.length };
}

/** @param {readonly LexicalRow[]} rows @param {Page} opts */
export function fuseHostedLexicalOnly(rows, { offset, limit }) {
  return { rows: [...rows].sort(compareHostedScore).slice(offset, offset + limit), total: rows.length };
}
