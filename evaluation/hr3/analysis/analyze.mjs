import { adaptScore, scoreVectors, absoluteEstimands } from './adapter.mjs';
import { bootstrap, lineageSensitivity } from './bootstrap.mjs';
import { interval, boundarySupplement } from './statistics.mjs';
import { decision } from './decision.mjs';
import { TYPES } from './design.mjs';

// Offline analysis of finalized A-4 results. The caller supplies all frozen
// allocation metadata, validity gates and reviewed shared-key robustness.
// Explicit calibration authorization prevents engineering-pilot CI reporting.
export function analyzeScores({ observations, resolutions, split, planned, gates, calibrated = false, draws = 10000, engineeringSmoke = false }) {
  if (!calibrated) throw Error('A-1.1: uncalibrated engineering pilots cannot report intervals or inference');
  if (draws !== 10000 && !engineeringSmoke) throw Error('Reduced draws require engineeringSmoke=true');
  const records = observations.map(o => adaptScore(o, resolutions));
  const data = scoreVectors(records, { split, planned });
  const primary = bootstrap(data, { draws }), sensitivity = lineageSensitivity(data, { draws });
  const final = records.filter(r => r.checkpoint === 4);
  const observedValid = Object.fromEntries(['T', 'U', 'O'].map(arm => {
    const attempted = final.filter(r => r.arm === arm);
    const plannedN = planned.reduce((n, l) => n + l.families.length, 0);
    const unique = new Set(attempted.map(r => r.family));
    if (attempted.length !== plannedN || unique.size !== plannedN || attempted.some(r => !planned.some(l => l.id === r.lineage && l.families.includes(r.family)))) return [arm, 0];
    return [arm, attempted.filter(r => r.valid).length / plannedN];
  }));
  const effectiveGates = { ...gates, validFinalShare: observedValid };
  const panels = [];
  if (final.some(r => r.arm === 'P')) for (const type of [undefined, ...TYPES]) {
    const pRecords = final.filter(r => r.arm === 'P' && (!type || r.type === type));
    const required = planned.filter(l => !type || l.type === type).flatMap(l => l.families);
    if (required.some(f => !pRecords.some(r => r.family === f))) {
      panels.push({ type: type ?? 'overall', status: 'partial-no-completed-design-ci', denominator: pRecords.length, required: required.length });
      continue;
    }
    const dataP = scoreVectors(records, { split, planned, estimands: absoluteEstimands('P', type) });
    const result = bootstrap(dataP, { draws });
    result.intervals = result.replicates.map(r => interval(r, true));
    panels.push({ qualification: 'P: the pinned product under the frozen public-operation agent and shared research extraction', type: type ?? 'overall', result,
      denominator: pRecords.length, boundarySupplements: ['C', 'O', 'R', 'J'].map(c => boundarySupplement(pRecords.filter(r => r.scores[c] === 1).length, pRecords.length)) });
  }
  return { certificationEligible: false, engineeringSmoke, primary, sensitivity, gates: effectiveGates,
    decision: split === 'test' && !engineeringSmoke ? decision(primary, effectiveGates) : 'Inconclusive', panels };
}
