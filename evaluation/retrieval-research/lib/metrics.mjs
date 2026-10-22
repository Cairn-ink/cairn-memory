import { CATEGORIES, compareIds, eligibleMemory, atScale, labelEntries } from './fixture.mjs';

export const average = values => values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
export function summarizeQueries(queries, { requireAllCategories = false } = {}) {
  const scored = queries.filter(query => CATEGORIES.includes(query.category) && query.recall12 != null);
  const categories = Object.fromEntries(CATEGORIES.map(category => {
    const selected = queries.filter(query => query.category === category && query.recall12 != null);
    return [category, { n: selected.length, recall12: average(selected.map(query => query.recall12)),
      recall24: average(selected.map(query => query.recall24).filter(value => value != null)),
      allRequired12: average(selected.map(query => Number(query.allRequired12))),
      allRequired24: average(selected.map(query => query.allRequired24).filter(value => value != null).map(Number)) }];
  }));
  const represented = Object.values(categories).filter(category => category.n);
  const complete = represented.length === CATEGORIES.length;
  const macro = key => requireAllCategories && !complete ? null : average(represented.map(category => category[key]).filter(value => value != null));
  const numericMean = select => average(scored.map(select).filter(value => typeof value === 'number'));
  return { n: represented.reduce((sum, category) => sum + category.n, 0), categoryCount: represented.length, complete, categories,
    macroRecall12: macro('recall12'), macroRecall24: macro('recall24'), macroAllRequired12: macro('allRequired12'), macroAllRequired24: macro('allRequired24'),
    supporting: { meanReturned12: numericMean(query => query.counts12?.returned), meanReturned24: numericMean(query => query.counts24?.returned),
      meanNonRequired12: numericMean(query => query.counts12?.nonRequired), meanNonRequired24: numericMean(query => query.counts24?.nonRequired),
      meanHardNegative12: numericMean(query => query.hardNegative12), hardNegativeHitRate12: numericMean(query => query.hardNegative12 == null ? null : Number(query.hardNegative12 > 0)) } };
}

export function scoreGroups(groups, ranked, available24 = true) {
  const bestRanks = groups.map(group => {
    const ranks = group.members.map(member => ranked.indexOf(member.memory) + 1).filter(rank => rank > 0);
    return { fact: group.fact, rank: ranks.length ? Math.min(...ranks) : null, fidelity: group.fidelity };
  });
  const recall = k => groups.length ? bestRanks.filter(group => group.rank != null && group.rank <= k).length / groups.length : null;
  const recall12 = recall(12), recall24 = available24 ? recall(24) : null;
  return { recall12, recall24, allRequired12: recall12 == null ? null : recall12 === 1,
    allRequired24: recall24 == null ? null : recall24 === 1, bestRanks };
}

function memberAtScale(member, scale) { return member.namespace === 'target' && (member.scale === 'S300' || scale === 'S1000' && member.scale === 'S1000-extra'); }
function filteredGroups(label, scale) {
  return label.groups.map(group => {
    const members = group.members.filter(member => memberAtScale(member, scale));
    return { ...group, members, fidelity: members.some(member => member.where === 'body') ? 'body-covered' : 'span-only' };
  });
}
function range(values) { return values.length ? { mean: average(values), min: Math.min(...values), max: Math.max(...values) } : null; }

export function scoreRankings(fixture, rankings) {
  if (rankings?.format !== 'hr1-rankings-v1') throw new Error('rankings_format');
  const { run } = rankings;
  if (!run || !['dev', 'test'].includes(run.split) || !['S300', 'S1000'].includes(run.scale) || !run.arm || !rankings.queries || Array.isArray(rankings.queries)) throw new Error('rankings_run_schema');
  const a0 = /^A0-(default|paged)$/.test(run.arm);
  if (run.status === 'unavailable' || run.status === 'failed') {
    return { run: structuredClone(run), ok: false, failures: [{ code: 'run_unavailable', error: run.error ?? null }], queries: [],
      summary: summarizeQueries([], { requireAllCategories: true }), strata: {}, diagnostics: [], costs: rankings.costs ?? {} };
  }
  if (a0 && (!Number.isInteger(run.store) || run.store < 0 || run.store > 4)) throw new Error('a0_store_required_0_to_4');
  if (!a0 && run.store != null) throw new Error('store_only_for_a0');
  const available24 = run.arm !== 'A0-default';
  const labels = labelEntries(fixture.labels).filter(label => !label.dropped && label.split === run.split);
  const expectedIds = labels.map(label => label.id).sort(compareIds);
  if (JSON.stringify(Object.keys(rankings.queries).sort(compareIds)) !== JSON.stringify(expectedIds)) throw new Error('rankings_query_set_mismatch');
  const failures = [];
  for (const filename of new Set([...Object.keys(run.fixtureHashes ?? {}), ...Object.keys(fixture.hashes ?? {})])) {
    if (fixture.hashes?.[filename] !== run.fixtureHashes?.[filename]) failures.push({ code: 'fixture_hash_mismatch', filename });
  }
  const memoryMap = new Map(fixture.corpus.memories.map(memory => [memory.id, memory]));
  const inspectRanking = (ranked, label, channel = 'final', max = 24) => {
    if (!Array.isArray(ranked) || ranked.length > max || new Set(ranked).size !== ranked.length || ranked.some(id => typeof id !== 'string')) throw new Error(`invalid_ranking:${label.id}:${channel}`);
    for (const id of ranked) {
      const memory = memoryMap.get(id);
      if (!memory) { failures.push({ code: 'unknown_memory', query: label.id, channel, memory: id }); continue; }
      if (memory.namespace === 'foreign') failures.push({ code: 'foreign_leakage', query: label.id, channel, memory: id });
      if (!eligibleMemory(memory, label.intent) || !atScale(memory, run.scale)) failures.push({ code: 'ineligible_memory', query: label.id, channel, memory: id });
    }
  };
  const strataRows = {};
  const stratum = (key, label, groups, ranked) => {
    if (!groups.length) return;
    (strataRows[key] ??= []).push({ id: label.id, category: label.category, ...scoreGroups(groups, ranked, available24) });
  };
  const queries = [...labels].sort((a, b) => compareIds(a.id, b.id)).map(label => {
    const result = rankings.queries[label.id];
    inspectRanking(result.ranked, label);
    if (a0 && (!Array.isArray(result.errors) || result.errors.length)) failures.push({ code: 'a0_query_error', query: label.id, errors: result.errors ?? null });
    if (run.arm === 'A0-default' && result.ranked.length > 12) throw new Error(`a0_default_limit:${label.id}`);
    const diagnostic = !CATEGORIES.includes(label.category);
    const groups = filteredGroups(label, run.scale);
    if (!diagnostic && groups.some(group => !group.members.length)) failures.push({ code: 'empty_required_group', query: label.id });
    const requiredIds = new Set(groups.flatMap(group => group.members.map(member => member.memory)));
    const hardNegativeIds = new Set(label.hardNegatives);
    const counts = k => ({ returned: result.ranked.slice(0, k).length, nonRequired: result.ranked.slice(0, k).filter(id => !requiredIds.has(id)).length,
      hardNegatives: result.ranked.slice(0, k).filter(id => hardNegativeIds.has(id)).length });
    const channels = {};
    for (const [name, ranked] of Object.entries(result.channels ?? {})) {
      inspectRanking(ranked, label, name, 50);
      channels[name] = diagnostic ? { recall12: null, recall24: null, allRequired12: null, allRequired24: null, bestRanks: [], requiredGroupCoverage: null }
        : { ...scoreGroups(groups, ranked), requiredGroupCoverage: scoreGroups(groups, ranked).bestRanks.filter(group => group.rank != null).length };
    }
    let union = null;
    if (result.channels) {
      const ids = [...new Set(Object.values(result.channels).flat())];
      if (result.unionSize !== ids.length) failures.push({ code: 'union_size_mismatch', query: label.id });
      union = { size: ids.length, requiredGroups: diagnostic ? null : groups.filter(group => group.members.some(member => ids.includes(member.memory))).length, groupCount: diagnostic ? null : groups.length };
    }
    const scores = diagnostic ? { recall12: null, recall24: null, allRequired12: null, allRequired24: null, bestRanks: [] } : scoreGroups(groups, result.ranked, available24);
    const row = { id: label.id, family: label.family, category: label.category, lang: label.lang, intent: label.intent, diagnostic,
      ...scores, counts12: counts(12), counts24: available24 ? counts(24) : null, hardNegative12: counts(12).hardNegatives,
      ranked: result.ranked, channels, union,
      rawChannelScores: result.channelScores ?? result.scores ?? null,
      ...(a0 ? { pages: result.pages, scannedRows: result.scannedRows, coverage: result.coverage, errors: result.errors } : {}) };
    if (!diagnostic) {
      stratum(`language:${label.lang}`, label, groups, result.ranked);
      for (const fidelity of ['body-covered', 'span-only']) stratum(`fidelity:${fidelity}`, label, groups.filter(group => group.fidelity === fidelity), result.ranked);
      const memberKeys = new Set(groups.flatMap(group => group.members.map(member => `${group.fact}:${member.memory}`)));
      if (label.category === 'C3' && label.overlap.filter(overlap => memberKeys.has(`${overlap.fact}:${overlap.memory}`)).every(overlap => overlap.T1.count === 0)) {
        stratum('C3:zero-overlap', label, groups, result.ranked);
      }
      // A group with alternative members of different span counts appears in
      // each applicable count stratum. The reached group retains all supports.
      for (const count of [1, 2, 3]) stratum(`span-count:${count}`, label, groups.filter(group => group.members.some(member => (member.spanCount ?? memoryMap.get(member.memory)?.spans.length) === count)), result.ranked);
      stratum(`scale:${run.scale}`, label, groups, result.ranked);
      stratum('required-span', label, groups.filter(group => group.members.some(member => member.where === 'span')), result.ranked);
    }
    return row;
  });
  for (const key of ['fidelity:body-covered', 'fidelity:span-only', 'C3:zero-overlap', ...[1, 2, 3].map(count => `span-count:${count}`)]) strataRows[key] ??= [];
  const strata = Object.fromEntries(Object.entries(strataRows).map(([key, rows]) => [key, { ...summarizeQueries(rows), queries: rows }]));
  return { run: structuredClone(run), ok: failures.length === 0, failures, queries, summary: summarizeQueries(queries, { requireAllCategories: true }),
    strata, diagnostics: queries.filter(query => query.diagnostic), costs: rankings.costs ?? {} };
}

export function summarizeA0(runs) {
  const groups = new Map();
  for (const run of runs.filter(result => /^A0-(default|paged)$/.test(result.run.arm))) {
    const key = JSON.stringify([run.run.arm, run.run.scale, run.run.split, run.run.config]);
    (groups.get(key) ?? (groups.set(key, []), groups.get(key))).push(run);
  }
  return [...groups.values()].map(stores => {
    const indexes = stores.map(store => store.run.store).sort((a, b) => a - b);
    const complete = JSON.stringify(indexes) === '[0,1,2,3,4]';
    return { arm: stores[0].run.arm, scale: stores[0].run.scale, split: stores[0].run.split, config: stores[0].run.config,
      stores: indexes, complete, ok: complete && stores.every(store => store.ok),
      macroRecall12: range(stores.map(store => store.summary.macroRecall12).filter(value => value != null)),
      macroRecall24: range(stores.map(store => store.summary.macroRecall24).filter(value => value != null)),
      macroAllRequired12: range(stores.map(store => store.summary.macroAllRequired12).filter(value => value != null)),
      macroAllRequired24: range(stores.map(store => store.summary.macroAllRequired24).filter(value => value != null)),
      supporting: Object.fromEntries(Object.keys(stores[0].summary.supporting).map(metric => [metric, range(stores.map(store => store.summary.supporting[metric]).filter(value => value != null))])),
      queries: Object.fromEntries(stores[0].queries.map(query => [query.id, Object.fromEntries(['recall12', 'recall24', 'pages', 'scannedRows', 'coverage'].map(metric =>
        [metric, range(stores.map(store => store.queries.find(row => row.id === query.id)?.[metric]).filter(value => typeof value === 'number'))]))])) };
  });
}

export function scoreRuns(fixture, rankings, { withoutForeign } = {}) {
  if (withoutForeign && withoutForeign.length !== rankings.length) throw new Error('isolation_run_count_mismatch');
  const runs = rankings.map((ranking, index) => {
    const result = scoreRankings(fixture, ranking);
    result.isolation = withoutForeign ? { status: 'checked', ...checkIsolation(ranking, withoutForeign[index]) } : { status: 'not-checked', ok: null };
    if (result.isolation.ok === false) { result.ok = false; result.failures.push({ code: 'foreign_isolation_mismatch', queries: result.isolation.mismatches }); }
    return result;
  }), a0 = summarizeA0(runs);
  return { format: 'hr1-scores-v1', fixtureHashes: fixture.hashes ?? {}, ok: runs.every(run => run.ok) && a0.every(group => group.ok), runs, a0 };
}

export function checkIsolation(withForeign, withoutForeign) {
  if (JSON.stringify([withForeign.run.arm, withForeign.run.config, withForeign.run.model, withForeign.run.scale, withForeign.run.split, withForeign.run.store]) !==
    JSON.stringify([withoutForeign.run.arm, withoutForeign.run.config, withoutForeign.run.model, withoutForeign.run.scale, withoutForeign.run.split, withoutForeign.run.store])) throw new Error('isolation_run_configuration_mismatch');
  const queries = [...new Set([...Object.keys(withForeign.queries), ...Object.keys(withoutForeign.queries)])].sort(compareIds);
  const mismatches = queries.filter(id => JSON.stringify(withForeign.queries[id]?.ranked) !== JSON.stringify(withoutForeign.queries[id]?.ranked));
  return { ok: mismatches.length === 0, mismatches };
}
