import { performance } from 'node:perf_hooks';
import { createBM25 } from './bm25.mjs';
import { createTrigram } from './fts5-trigram.mjs';
import { tokenizeT1, tokenizeT1Plus } from './tokenize.mjs';
import { createDenseIndex } from './embed-local.mjs';
import { CONFIRMATORY, explorationGrid, fuse } from './fusion.mjs';
import { a0b } from './a0-core.mjs';

export const FUSION_CONFIGS = Object.freeze({ ...CONFIRMATORY,
  ...Object.fromEntries(explorationGrid().map(config => [config.name, config])) });
export const isFused = arm => Object.hasOwn(FUSION_CONFIGS, arm) || ['A5-spans', 'A5-both'].includes(arm);
export const needsModel = arm => arm === 'A2' || isFused(arm);
export const includeForArm = arm => arm === 'A5-spans' ? 'spans' : arm === 'A5-both' ? 'both' : 'body';

// documents is ONE eligible namespace/scale/intent projection. No labels or
// fixture object cross this boundary. The caller owns model lifetime.
export async function createArm({ arm, documents, embedder, lexical = 'A1', fusion = 'A3' }) {
  if (!['A1', 'A1+'].includes(lexical)) throw new Error('invalid_lexical_comparator');
  const began = performance.now();
  const tokenize = arm === 'A1' ? tokenizeT1 : arm === 'A1+' || lexical === 'A1+' ? tokenizeT1Plus : tokenizeT1;
  let index, dense, config;
  if (arm === 'A1' || arm === 'A1+' || isFused(arm)) index = createBM25(documents, { tokenize });
  else if (arm === 'A1t') index = createTrigram(documents);
  else if (!['A2', 'A0b'].includes(arm)) throw new Error(`unknown_arm:${arm}`);
  if (needsModel(arm)) {
    if (!embedder) throw new Error('embedding_model_required');
    dense = await createDenseIndex(documents, embedder);
  }
  if (isFused(arm)) {
    config = FUSION_CONFIGS[arm.startsWith('A5-') ? fusion : arm];
    if (!config || arm.startsWith('A5-') && !CONFIRMATORY[fusion]) throw new Error('invalid_fusion_configuration');
  }
  return { costs: { indexBuildMs: performance.now() - began, embedDocs: dense?.embedDocs ?? 0,
    embedMsPerDoc: dense?.embedMsPerDoc ?? 0, apiTokens: 0, apiSpendUsd: 0 },
    async search(query, { bypassCache = false } = {}) {
      if (arm === 'A0b') {
        const rows = a0b(documents, query.text); return { ranked: rows.map(row => row.memoryId), scores: rows };
      }
      if (!needsModel(arm)) {
        const rows = index.search(query.text, 24); return { ranked: rows.map(row => row.memoryId), scores: rows };
      }
      if (arm === 'A2') {
        const rows = await dense.search(query.text, 24, { bypassCache }); return { ranked: rows.map(row => row.memoryId), scores: rows };
      }
      // Tokenization happens inside this request, including when timing.
      const lex = index.search(query.text, config.depth);
      const sem = await dense.search(query.text, config.depth, { bypassCache });
      const fused = fuse(lex, sem, config, { text: query.text, documents, tokenize });
      return { ranked: fused.rows.map(row => row.memoryId), channels: fused.channels, unionSize: fused.unionSize,
        scores: { lex, sem, fused: fused.rows } };
    }, close() { index?.close?.(); } };
}
