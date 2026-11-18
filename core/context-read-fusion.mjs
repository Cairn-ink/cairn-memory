import { canonicalKey, rankScores } from './context-read-bm25.mjs';
import { COMPACT_MEMORY_MAX_ITEMS } from './context-read-input.mjs';

export const RRF_PRESETS = Object.freeze({
  'rrf-k60-d12': Object.freeze({ k: 60, depth: 12, weights: Object.freeze([0.45, 0.45]), unionMaximum: 24 }),
  'rrf-k60-d12-moc-v1': Object.freeze({ k: 60, depth: 12, weights: Object.freeze([0.45, 0.45, 0.10]), unionMaximum: 36 }),
  'rrf-k10': Object.freeze({ k: 10, depth: 24, weights: Object.freeze([0.5, 0.5]), unionMaximum: 48 }),
});

const compactDepth = { depth: COMPACT_MEMORY_MAX_ITEMS, unionMaximum: 2 * COMPACT_MEMORY_MAX_ITEMS };
export const COMPACT_RRF_PRESETS = Object.freeze({
  'rrf-k60-d64-compact': Object.freeze({ ...RRF_PRESETS['rrf-k60-d12'], ...compactDepth }),
  'rrf-k60-d64-moc-compact': Object.freeze({ ...RRF_PRESETS['rrf-k60-d12-moc-v1'], ...compactDepth }),
  'rrf-k10-d64-compact': Object.freeze({ ...RRF_PRESETS['rrf-k10'], ...compactDepth }),
});

/** Channels are already ranked. Canonical ordering resolves raw-score ties too.
 * Semantic coverage must be complete and preflighted by the caller; gaps,
 * degraded/absent/disabled semantic always preserve the BM25 ranking.
 */
export function fuseCandidates(lexical, semantic, { preset = 'rrf-k60-d12', limit = 24,
  semanticState = 'disabled', coverageComplete = false, moc = [] } = {}) {
  const compact = Object.hasOwn(COMPACT_RRF_PRESETS, preset);
  const config = compact ? COMPACT_RRF_PRESETS[preset] : RRF_PRESETS[preset];
  const horizon = compact ? config.depth : 24;
  if (!config || !Number.isSafeInteger(limit) || limit < 1 || limit > horizon) throw new TypeError('invalid_fusion');
  function channel(rows, depth) {
    const keys = new Set();
    for (const row of rows) {
      const key = canonicalKey(row);
      if (!Number.isFinite(row.score) || keys.has(key)) throw new TypeError('invalid_channel');
      keys.add(key);
    }
    return rankScores([...rows]).slice(0, depth);
  }
  const withMoc = preset === 'rrf-k60-d12-moc-v1';
  if (!withMoc && (semanticState !== 'ready' || !coverageComplete)) {
    const rows = channel(lexical, horizon);
    return { mode: 'lexical', preset, unionSize: rows.length, rows: rows.slice(0, limit).map((row, i) => ({
      ...row, fusionScore: null, channels: { lexical: { rank: i + 1, rawScore: row.score }, semantic: null },
    })) };
  }
  const channels = [channel(lexical, config.depth), channel(semanticState === 'ready' && coverageComplete ? semantic : [], config.depth),
    ...(withMoc ? [channel(moc, config.depth)] : [])], scores = new Map();
  channels.forEach((rows, c) => rows.forEach((row, index) => {
    const key = canonicalKey(row);
    if (!scores.has(key)) scores.set(key, { ...row, score: 0, channels: { lexical: null, semantic: null, ...(withMoc ? { moc: null } : {}) } });
    const item = scores.get(key);
    item.score += config.weights[c] * (1 / (config.k + index + 1));
    item.channels[['lexical', 'semantic', 'moc'][c]] = { rank: index + 1, rawScore: row.score };
  }));
  return { mode: 'hybrid', preset, unionSize: scores.size,
    rows: rankScores([...scores.values()]).slice(0, limit).map(row => ({ ...row, fusionScore: row.score })) };
}
