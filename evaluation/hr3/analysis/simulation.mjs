import { random } from './random.mjs';
import { FROZEN, CANDIDATE_CHOICES, allocation, CONTRASTS, TYPES } from './design.mjs';
import { bootstrap, lineageSensitivity } from './bootstrap.mjs';
import { decision, simulationGates } from './decision.mjs';
import { boundarySupplement } from './statistics.mjs';

export function pairedOutcome(cell, rng) {
  const uOnly = (cell.discordance - cell.effect) / 2, tOnly = (cell.discordance + cell.effect) / 2;
  const both = FROZEN.baseline - uOnly;
  if (both < 0 || uOnly < 0 || tOnly < 0 || both + uOnly + tOnly > 1) throw Error('Infeasible paired margins');
  const p = rng.uniform(), U = p < both + uOnly, T = p < both || (p >= both + uOnly && p < both + uOnly + tOnly);
  const t = [1, 1, 1], u = [1, 1, 1];
  if (!T) t[rng.int(3)] = 0;
  if (!U) u[rng.int(3)] = 0;
  if (!T && !U && cell.guardHarm && rng.uniform() < FROZEN.guardHarmShare) { t.fill(1); u.fill(1); t[0] = 0; u[2] = 0; }
  return { t, u, T: Number(T), U: Number(U) };
}
export function powerLineage(cell, rng, m = 8) {
  // One mixture indicator per lineage, sharing the COMPLETE joint outcome,
  // including component failures and guard-harm realization.
  if (rng.uniform() < cell.icc) {
    const shared = pairedOutcome(cell, rng);
    return Array.from({ length: m }, () => shared);
  }
  return Array.from({ length: m }, () => pairedOutcome(cell, rng));
}
export function powerDataset(cell, seed) {
  const rng = random(seed), planned = allocation('test');
  const bothFailure = 1 - FROZEN.baseline - (cell.discordance + cell.effect) / 2;
  const harm = cell.guardHarm ? FROZEN.guardHarmShare * bothFailure : 0;
  return { data: { names: CONTRASTS.map(e => e.name), lineages: planned.map(l => ({ id: l.id, type: l.type,
    weights: [1 / 200, 1 / 200, 1 / 200, 1 / 200, l.multihop ? 1 / 100 : 0],
    values: powerLineage(cell, rng).map(o => [o.T - o.U, ...o.t.map((v, j) => v - o.u[j]), o.t[2] - o.u[2]]) })) },
    truth: [cell.effect, cell.effect / 3 - harm, cell.effect / 3, cell.effect / 3 + harm, cell.effect / 3 + harm] };
}
// Conditional-family coverage: fixed lineage parameters, independently drawn
// families/arms/components. Normal cells are linear analogues, not binary J.
export function coverageDataset(cell, seed) {
  const rng = random(seed), planned = allocation(cell.split), choices = CANDIDATE_CHOICES.coverage;
  const heterogeneous = cell.distribution.startsWith('hetero'), binary = cell.distribution.endsWith('bernoulli');
  const counts = Array(8).fill(0), truth = Array(13).fill(0);
  const names = [...['C', 'O', 'R', 'J'].map(c => `P absolute ${c}`),
    ...['C', 'O', 'R', 'J'].map(c => `P within-type correction ${c}`), ...CONTRASTS.map(e => e.name)];
  const lineages = planned.map(l => {
    const typeIndex = TYPES.indexOf(l.type), p = heterogeneous ? choices.heterogeneousP[typeIndex] : choices.homogeneousP;
    const mu = binary ? p ** 3 : choices.normalMean;
    const sd = heterogeneous ? choices.heterogeneousSD[typeIndex] : choices.homogeneousSD;
    const draw = () => binary ? Array.from({ length: 3 }, () => Number(rng.uniform() < p)) : Array.from({ length: 3 }, () => choices.normalMean + sd * rng.normal());
    const weights = [...Array(4).fill(1 / planned.length), ...Array(4).fill(l.type === TYPES[0] ? 1 / (planned.length / 5) : 0),
      1 / planned.length, 1 / planned.length, 1 / planned.length, 1 / planned.length, l.multihop ? 1 / planned.filter(a => a.multihop).length : 0];
    for (let j = 0; j < 8; j++) truth[j] += weights[j] * (j % 4 === 3 ? mu : binary ? p : choices.normalMean);
    return { id: l.id, type: l.type, weights, values: Array.from({ length: l.m }, () => {
      const P = draw(), T = draw(), U = draw();
      const joint = a => binary ? a[0] * a[1] * a[2] : a.reduce((s, x) => s + x, 0) / 3;
      const pj = joint(P), absolute = [...P, pj], values = [...absolute, ...absolute, joint(T) - joint(U), ...T.map((v, j) => v - U[j]), T[2] - U[2]];
      if (binary) absolute.forEach((x, j) => { counts[j] += x; if (l.type === TYPES[0]) counts[j + 4] += x; });
      return values;
    }) };
  });
  const n = planned.length * planned[0].m;
  return { data: { names, lineages }, truth, boundary: binary ? counts.map((x, j) => boundarySupplement(x, j < 4 ? n : n / 5)) : [] };
}
export function runDataset(cell, index, { draws = FROZEN.draws, seed = 'hr3-validation-v1', onProgress } = {}) {
  const generationStart = performance.now();
  const generated = cell.kind === 'power' ? powerDataset(cell, `${seed}/${cell.id}/${index}`) : coverageDataset(cell, `${seed}/${cell.id}/${index}`);
  const generationMs = performance.now() - generationStart;
  const start = performance.now();
  // Same fixed family draws in every dataset and across all estimands, and
  // the same namespace when judgment assignments are subsequently recomputed.
  const primary = bootstrap(generated.data, { draws, onProgress: onProgress && (completed => onProgress({ phase: 'primary', completed })) });
  const primaryMs = performance.now() - start, sensitivityStart = performance.now();
  const lineage = cell.kind === 'power' ? lineageSensitivity(generated.data, { draws, onProgress: onProgress && (completed => onProgress({ phase: 'lineage', completed })) }) : null;
  const lineageMs = performance.now() - sensitivityStart;
  const compact = r => r && ({ method: r.method, names: r.names, point: r.point, intervals: r.intervals });
  return { summary: { cell: cell.id, index, truth: generated.truth, primary: compact(primary), lineage: compact(lineage),
    coverage: primary.intervals.map((ci, j) => ci.raw[0] <= generated.truth[j] && ci.raw[1] >= generated.truth[j]),
    lineageCoverage: lineage?.intervals.map((ci, j) => ci.raw[0] <= generated.truth[j] && ci.raw[1] >= generated.truth[j]) ?? null,
    decision: cell.kind === 'power' ? decision(primary, simulationGates()) : null,
    boundary: generated.boundary ?? [], timings: { generationMs, primaryMs, lineageMs } },
    primary: primary.replicates, lineage: lineage?.replicates ?? [] };
}
