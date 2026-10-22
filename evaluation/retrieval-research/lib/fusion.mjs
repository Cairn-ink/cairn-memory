import { rankScores } from './bm25.mjs';
import { tokenizeT1 } from './tokenize.mjs';

export const CONFIRMATORY = Object.freeze({
  A3: Object.freeze({ method: 'rrf', k: 60, depth: 12, weights: Object.freeze([0.45, 0.45]) }),
  'F-RRF60': Object.freeze({ method: 'rrf', k: 60, depth: 24, weights: Object.freeze([0.5, 0.5]) }),
  'F-RRF10': Object.freeze({ method: 'rrf', k: 10, depth: 24, weights: Object.freeze([0.5, 0.5]) }),
  'F-MM': Object.freeze({ method: 'mm', depth: 24, weights: Object.freeze([0.5, 0.5]) }),
});
export function explorationGrid() {
  const configs = [];
  for (const k of [1, 10, 60]) for (const depth of [12, 24, 50]) for (const alpha of [0.5, 0.6, 0.4])
    configs.push({ name: `G-RRF-k${k}-d${depth}-a${alpha}`, method: 'rrf', k, depth, weights: [alpha, 1 - alpha] });
  for (const alpha of [0.3, 0.4, 0.5, 0.6, 0.7])
    configs.push({ name: `G-MM-d50-a${alpha}`, method: 'mm', depth: 50, weights: [alpha, 1 - alpha] });
  for (const w of [0.1, 0.2, 0.3, 0.4, 0.5])
    configs.push({ name: `G-MP-w${w}`, method: 'mempalace', depth: 50, w });
  return configs;
}
export function fuse(lexical, semantic, config, { text = '', documents = [], tokenize = tokenizeT1 } = {}) {
  const lex = lexical.slice(0, config.depth), sem = semantic.slice(0, config.depth);
  const channels = { lex: lex.map(row => row.memoryId), sem: sem.map(row => row.memoryId) };
  const scores = new Map([...lex, ...sem].map(row => [row.memoryId, 0]));
  if (config.method === 'mempalace') {
    const query = new Set(tokenize(text)), byMemory = new Map();
    for (const doc of documents) {
      const tokens = new Set(tokenize(doc.text));
      const overlap = [...query].filter(t => tokens.has(t)).length / Math.max(1, query.size);
      byMemory.set(doc.memoryId, Math.max(overlap, byMemory.get(doc.memoryId) ?? 0));
    }
    scores.clear();
    for (const row of sem) scores.set(row.memoryId, -(1 - row.score) * (1 - config.w * (byMemory.get(row.memoryId) ?? 0)));
  } else {
    [lex, sem].forEach((rows, channel) => {
      const min = rows.length ? Math.min(...rows.map(row => row.score)) : 0;
      const max = rows.length ? Math.max(...rows.map(row => row.score)) : 0;
      rows.forEach((row, index) => {
        const value = config.method === 'rrf' ? 1 / (config.k + index + 1) :
          max === min ? 0 : (row.score - min) / (max - min);
        scores.set(row.memoryId, scores.get(row.memoryId) + config.weights[channel] * value);
      });
    });
  }
  return { rows: rankScores([...scores].map(([memoryId, score]) => ({ memoryId, score }))).slice(0, 24),
    channels, unionSize: new Set([...channels.lex, ...channels.sem]).size };
}
