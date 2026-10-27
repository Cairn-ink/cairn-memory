import { hash } from './fixtures.mjs';
import { SAFETY_CELLS } from './safety.mjs';

export const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export function metrics(ranking, relevant) {
  if (!Array.isArray(ranking) || new Set(ranking).size !== ranking.length || new Set(relevant).size !== relevant.length) throw Error('invalid_ranking_or_gold');
  if (!relevant.length) return { recall5: null, recall12: null, ndcg12: null };
  const gold = new Set(relevant);
  const recall = k => ranking.slice(0, k).filter(id => gold.has(id)).length / relevant.length;
  const discount = rank => 1 / Math.log2(rank + 1);
  const dcg = ranking.slice(0, 12).reduce((sum, id, i) => sum + (gold.has(id) ? discount(i + 1) : 0), 0);
  const ideal = Array.from({ length: Math.min(12, relevant.length) }, (_, i) => discount(i + 1)).reduce((a, b) => a + b, 0);
  return { recall5: recall(5), recall12: recall(12), ndcg12: dcg / ideal };
}
// Versioned xorshift32. Nonzero state is derived independently for each named
// stratum, so adding an unrelated report cannot shift its bootstrap stream.
export function random(seed) {
  let state = parseInt(hash(String(seed)).slice(0, 8), 16) || 1;
  return () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 4294967296; };
}
export function percentile(sorted, p) {
  const index = (sorted.length - 1) * p, lo = Math.floor(index), hi = Math.ceil(index);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (index - lo);
}
export function bootstrap(pairs, { seed, resamples = 10000 } = {}) {
  if (!pairs.length || !Number.isSafeInteger(resamples) || resamples < 1 || seed === undefined || pairs.some(p => p.length !== 2 || p.some(n => !Number.isFinite(n)))) throw Error('invalid_bootstrap');
  const differences = pairs.map(([a, b]) => b - a), delta = average(differences), next = random(seed), draws = [];
  for (let r = 0; r < resamples; r++) {
    let sum = 0;
    for (let i = 0; i < differences.length; i++) sum += differences[Math.floor(next() * differences.length)];
    draws.push(sum / differences.length);
  }
  const sorted = [...draws].sort((a, b) => a - b), ci = [percentile(sorted, .025), percentile(sorted, .975)];
  return { delta, ci, uncertainty: Math.max(Math.abs(delta - ci[0]), Math.abs(ci[1] - delta)), seed, resamples, draws };
}
export function decide({ macroRecallDelta, macroNdcgDelta, strata, safety, complete = true, provider = 'fake', externalGates = {} }) {
  const failures = [];
  if (!complete) failures.push('incomplete');
  if (!Number.isFinite(macroRecallDelta) || !(macroRecallDelta >= .02)) failures.push('macro_recall_gain');
  if (!Number.isFinite(macroNdcgDelta) || !(macroNdcgDelta >= 0)) failures.push('macro_ndcg_regression');
  for (const id of ['cross-zh-en', 'cross-en-zh', 'cross-language', 'paraphrase']) if (!(strata[id]?.delta >= .05)) failures.push(`${id}:critical_gain`);
  for (const [id, s] of Object.entries(strata)) {
    if (!Number.isFinite(s.delta) || !Number.isFinite(s.uncertainty) || s.uncertainty < 0) failures.push(`${id}:invalid`);
    else {
      if (s.delta < -Math.max(s.uncertainty, .01)) failures.push(`${id}:regression`);
      if ((s.exact || id.includes('identifier')) && s.delta < 0) failures.push(`${id}:exact_regression`);
    }
  }
  for (const [id, s] of Object.entries(safety)) if (s.status !== 'passed' || s.violations !== 0) failures.push(`safety:${id}`);
  for (const id of SAFETY_CELLS) if (!Object.hasOwn(safety, id)) failures.push(`safety:${id}:missing`);
  if (!strata['exact-identifier']) failures.push('exact-identifier:missing');
  const quality = failures.length ? 'failed' : provider === 'fake' ? 'fake_correctness_only' : 'passed';
  const enablement = quality === 'passed' && ['E.8', 'E.9'].every(k => externalGates[k] === 'passed') ? 'necessary_gate_only' : 'pending';
  return { quality, enablement, failures };
}
