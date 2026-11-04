import { cells } from './fixtures.mjs';
import { average, metrics, bootstrap, percentile, decide } from './statistics.mjs';
import { checkSafety } from './safety.mjs';
import { PROTOCOL } from './registration.mjs';

function aggregate(rows) {
  const groups = new Map();
  for (const row of rows) { const group = groups.get(row.query) ?? []; group.push(row); groups.set(row.query, group); }
  return [...groups].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([query, group]) => ({ query,
    A: Object.fromEntries(['recall5','recall12','ndcg12'].map(m => [m, average(group.map(r => r.A[m]))])),
    B: Object.fromEntries(['recall5','recall12','ndcg12'].map(m => [m, average(group.map(r => r.B[m]))])) }));
}
function summarize(rows, id, options) {
  if (!rows.length) return { status: 'not_run', delta: null, uncertainty: null, count: 0 };
  const result = { status: 'observed', count: rows.length };
  for (const metric of ['recall5','recall12','ndcg12']) {
    const A = average(rows.map(r => r.A[metric])), B = average(rows.map(r => r.B[metric]));
    result[metric] = { A, B, delta: average(rows.map(r => r.B[metric] - r.A[metric])) };
    if (metric !== 'recall5') Object.assign(result[metric], bootstrap(rows.map(r => [r.A[metric], r.B[metric]]),
      { seed: `${PROTOCOL.bootstrap.seed}/${id}/${metric}`, resamples: options.resamples ?? PROTOCOL.bootstrap.resamples }));
  }
  return { ...result, delta: result.recall12.delta, uncertainty: result.recall12.uncertainty };
}
export function analyze({ fixture, labels, inventory, observations, safetyObservations = {}, provider = 'fake', resamples, externalGates }) {
  const problems = [], byPair = new Map(), cellMap = new Map(cells().map(c => [c.id, c]));
  const queries = new Map(fixture.queries.map(q => [q.id, q]));
  const expected = new Map(labels.flatMap(row => row.queries.map(q => [`${row.cell}/${q.id}`, { ...q, cell: row.cell }])));
  for (const o of observations) {
    const key = `${o.cell}/${o.query}`;
    if (!expected.has(key) || byPair.has(key)) problems.push({ code: 'unknown_or_duplicate_pair', key });
    else byPair.set(key, o);
  }
  const scored = [], controls = [], negatives = [];
  for (const [key, label] of expected) {
    const o = byPair.get(key), q = queries.get(label.id);
    if (!o) { problems.push({ code: 'missing_pair', key }); continue; }
    const valid = ['A', 'B'].every(arm => o[arm]?.ok === true && o[arm].coverage === 'complete' && o[arm].evidenceVerified === true
      && Array.isArray(o[arm].ranking) && new Set(o[arm].ranking).size === o[arm].ranking.length && o[arm].ranking.length <= 12)
      && o.A.effective === 'lexical' && o.B.effective === 'hybrid' && o.B.semanticCoverage === 'complete'
      && o.B.queryEmbeddingAttempts === 1 && o.B.preset === 'rrf-k10' && o.B.degradedReason === null && o.B.providerIdentityVerified === true;
    if (!valid) { problems.push({ code: 'invalid_or_degraded_pair', key }); continue; }
    const cell = cellMap.get(o.cell), eligibleIds = new Set(fixture.documents.filter(d => d.minWorld <= cell.world && cell.types.includes(d.type) && d.intents.includes(cell.intent)).map(d => d.id));
    if ([...o.A.ranking, ...o.B.ranking].some(id => !eligibleIds.has(id))) { problems.push({ code: 'ineligible_or_unknown_return', key }); continue; }
    if (q.control) { controls.push(o); continue; }
    if (q.negative) { negatives.push(o); continue; }
    if (!label.relevant.length) { problems.push({ code: 'positive_without_gold', key }); continue; }
    const A = metrics(o.A.ranking, label.relevant), B = metrics(o.B.ranking, label.relevant);
    scored.push({ cell: o.cell, query: o.query, relevant: label.relevant, A, B,
      delta: Object.fromEntries(['recall5','recall12','ndcg12'].map(metric => [metric, B[metric] - A[metric]])),
      misses: { A: label.relevant.filter(id => !o.A.ranking.includes(id)), B: label.relevant.filter(id => !o.B.ranking.includes(id)) } });
  }
  const strata = {};
  for (const s of inventory.strata.filter(s => s.id !== 'cross-language')) {
    const members = new Set(s.positive);
    const rows = scored.filter(r => {
      const cell = cellMap.get(r.cell);
      return members.has(r.query) && (s.kind === 'primary' ? r.cell === s.cell
        : s.kind === 'slice' ? cell.world === s.world && cell.schema === s.schema && cell.intent === s.intent : true);
    });
    strata[s.id] = { ...summarize(aggregate(rows), s.id, { resamples }), exact: s.exact, scheduledPositiveQueries: s.positive.length, scheduledNegativeQueries: s.negative.length };
    if (!rows.length) problems.push({ code: 'missing_stratum', id: s.id });
  }
  // Equal-weight direction means, with paired draws stratified by direction.
  const directions = ['cross-zh-en', 'cross-en-zh'].map(id => strata[id]);
  if (directions.every(s => s?.recall12)) {
    const cross = { status: 'observed', count: directions.reduce((sum, d) => sum + d.count, 0), exact: false };
    for (const metric of ['recall5','recall12','ndcg12']) {
      const delta = average(directions.map(s => s[metric].delta));
      cross[metric] = { A: average(directions.map(s => s[metric].A)), B: average(directions.map(s => s[metric].B)), delta };
      if (metric !== 'recall5') {
        const draws = directions[0][metric].draws.map((d, i) => (d + directions[1][metric].draws[i]) / 2);
        const sorted = [...draws].sort((a, b) => a - b), ci = [percentile(sorted, .025), percentile(sorted, .975)];
        Object.assign(cross[metric], { draws, ci, uncertainty: Math.max(Math.abs(delta - ci[0]), Math.abs(ci[1] - delta)), resamples: draws.length,
          seed: PROTOCOL.bootstrap.seed, method: 'equal-weight direction-stratified paired draws' });
      }
    }
    strata['cross-language'] = { ...cross, delta: cross.recall12.delta, uncertainty: cross.recall12.uncertainty };
  } else strata['cross-language'] = { status: 'not_run', delta: null, uncertainty: null };
  const primary = inventory.strata.filter(s => s.kind === 'primary').map(s => strata[s.id]);
  const macro = Object.fromEntries(['recall5','recall12','ndcg12'].map(metric => [metric, {
    A: primary.every(s => s[metric]) ? average(primary.map(s => s[metric].A)) : null,
    B: primary.every(s => s[metric]) ? average(primary.map(s => s[metric].B)) : null,
    delta: primary.every(s => s[metric]) ? average(primary.map(s => s[metric].delta)) : null,
  }]));
  const safety = checkSafety(safetyObservations), complete = problems.length === 0;
  const decision = decide({ macroRecallDelta: macro.recall12.delta, macroNdcgDelta: macro.ndcg12.delta, strata, safety, complete, provider, externalGates });
  return { status: complete ? 'analyzed' : 'incomplete', complete, provider, macro, strata, safety, decision, problems, controls, negatives,
    perQuery: scored, observations, summary: `${provider === 'fake' ? 'Fake correctness evidence only. ' : ''}${complete ? 'All scheduled pairs observed.' : 'Missing, invalid or degraded pairs prevent a quality pass.'} Decision: ${decision.quality}; enablement: ${decision.enablement}.` };
}
