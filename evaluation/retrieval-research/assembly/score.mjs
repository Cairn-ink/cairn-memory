import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { CATEGORIES, compareIds, loadFixture, labelEntries, cliMain, requiredOption, writeJson } from '../lib/fixture.mjs';
import { average, scoreGroups } from '../lib/metrics.mjs';
import { percentile } from '../lib/stats.mjs';
import { ARMS } from './arms.mjs';
import { BUDGETS } from './run.mjs';
import { prepareItems } from './units.mjs';
import { COUNTER_ID } from './counter.mjs';
import { PROTOCOL, PROTOCOL_COMMIT, RANKINGS, authenticateFixture, authenticateRanking, selectedQueries, inputManifest, sha256, fail } from './auth.mjs';

const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
function metrics(groups, have, ranked) {
  if (!groups.length) fail('empty_required_groups');
  const covered = groups.filter(group => group.members.some(member => member.where === 'body'
    ? have.has(`${member.memory}#body`) : member.spans.some(id => have.has(id)))).length;
  const coverage = covered / groups.length, ceiling = scoreGroups(groups, ranked).recall24;
  return { groupCount: groups.length, coveredGroups: covered, coverage, allRequired: covered === groups.length, ceiling, assemblyLoss: ceiling - coverage };
}

export function summarize(rows, { requireAllCategories = false } = {}) {
  const categories = Object.fromEntries(CATEGORIES.map(category => {
    const selected = rows.filter(row => row.category === category);
    return [category, { queries: selected.length, groups: selected.reduce((sum, row) => sum + row.groupCount, 0),
      coverage: average(selected.map(row => row.coverage)), allRequired: average(selected.map(row => Number(row.allRequired))),
      ceiling: average(selected.map(row => row.ceiling)), assemblyLoss: average(selected.map(row => row.assemblyLoss)) }];
  }));
  const representedCategories = CATEGORIES.filter(category => categories[category].queries);
  const macro = field => requireAllCategories && representedCategories.length !== 7 ? null : average(representedCategories.map(category => categories[category][field]));
  const use = rows.map(row => row.tokenUse).sort((a, b) => a - b);
  return { queryCount: rows.length, groupCount: rows.reduce((sum, row) => sum + row.groupCount, 0), representedCategories,
    complete: representedCategories.length === 7, categories, macroCoverage: macro('coverage'), macroAllRequired: macro('allRequired'),
    macroCeiling: macro('ceiling'), macroAssemblyLoss: macro('assemblyLoss'), tokenUse: { p50: percentile(use, 0.5), p95: percentile(use, 0.95) } };
}

export function scoreCell(fixture, cell) {
  const run = cell?.run;
  if (cell?.format !== 'hr2-cell-v1' || !run || run.status !== 'complete' || run.protocol !== PROTOCOL || run.protocolCommit !== PROTOCOL_COMMIT || run.counter !== COUNTER_ID ||
      !ARMS.includes(run.arm) || !RANKINGS[run.ranking] || !BUDGETS.includes(run.budget) || ![0, 8].includes(run.overhead) || run.scale !== 'S1000' || !['test', 'dev'].includes(run.split)) fail('invalid_cell_run');
  if (!same(Object.keys(run.fixtureHashes ?? {}).sort(compareIds), Object.keys(fixture.hashes).sort(compareIds)) ||
      Object.entries(fixture.hashes).some(([name, hash]) => run.fixtureHashes[name] !== hash)) fail('cell_fixture_hash_mismatch');
  const expected = selectedQueries(fixture, run.split).map(query => query.id);
  if (!Array.isArray(cell.queries) || !same(cell.queries.map(row => row.id).sort(compareIds), expected)) fail('cell_query_set');
  const labels = new Map(labelEntries(fixture.labels).filter(label => !label.dropped && label.split === run.split && CATEGORIES.includes(label.category)).map(label => [label.id, label]));
  if (!same([...labels.keys()].sort(compareIds), expected)) fail('label_query_set');
  const items = new Map(prepareItems(fixture.corpus.memories).map(item => [item.id, item]));
  const strataRows = { 'fidelity:body-covered': [], 'fidelity:span-only': [] };
  const queries = cell.queries.map(row => {
    const label = labels.get(row.id);
    const query = fixture.queries.queries.find(query => query.id === row.id);
    if (label.family !== query.family || label.category !== query.category || label.intent !== query.intent || label.lang !== query.lang) fail(`label_query_metadata:${row.id}`);
    if (!Array.isArray(row.ranked) || row.ranked.length > 24 || new Set(row.ranked).size !== row.ranked.length) fail('invalid_cell_ranking');
    const units = new Map(row.ranked.flatMap(id => {
      const item = items.get(id);
      if (!item) fail(`cell_unknown_memory:${id}`);
      return [item.body, ...item.spans].map(unit => [unit.id, unit]);
    }));
    if (!Array.isArray(row.admitted)) fail('cell_admitted_required');
    const have = new Set();
    let used = 0;
    for (const admission of row.admitted) {
      const unit = units.get(admission.id);
      if (!unit || have.has(admission.id) || admission.tokens !== unit.tokens || admission.cost !== unit.tokens + run.overhead) fail('cell_unit_cost_or_id');
      have.add(admission.id); used += admission.cost;
    }
    for (const id of row.ranked) {
      const item = items.get(id);
      if (item.spans.some(span => have.has(span.id)) && !have.has(item.body.id)) fail('cell_detached_span');
    }
    if (used !== row.used || used > run.budget) fail('cell_total_cost');
    const groups = label.groups.map(group => {
      const members = group.members.filter(member => member.namespace === 'target' && ['S300', 'S1000-extra'].includes(member.scale));
      if (!members.length || members.some(member => !['body', 'span'].includes(member.where))) fail('invalid_required_group');
      return { ...group, members, fidelity: members.some(member => member.where === 'body') ? 'body-covered' : 'span-only' };
    });
    const result = { ...row, family: label.family, category: label.category, lang: label.lang, ...metrics(groups, have, row.ranked), tokenUse: used / run.budget };
    const stratum = (key, selected) => {
      if (selected.length) (strataRows[key] ??= []).push({ ...result, ...metrics(selected, have, row.ranked) });
    };
    for (const fidelity of ['body-covered', 'span-only']) stratum(`fidelity:${fidelity}`, groups.filter(group => group.fidelity === fidelity));
    stratum(`language:${label.lang}`, groups); stratum(`category:${label.category}`, groups);
    return result;
  });
  return { format: 'hr2-scored-cell-v1', ok: true, run: { ...run, expectedQueryIds: expected }, queries,
    summary: summarize(queries, { requireAllCategories: true }),
    strata: Object.fromEntries(Object.entries(strataRows).map(([key, rows]) => [key, { ...summarize(rows), queries: rows }])) };
}

export async function scoreDirectory(fixtureDir, dir) {
  const authenticated = await authenticateFixture(fixtureDir), fixture = await loadFixture(fixtureDir);
  for (const [name, hash] of Object.entries(authenticated.hashes)) if (fixture.hashes[name] !== hash) fail('fixture_changed_during_read');
  const filenames = (await readdir(dir)).filter(name => name.endsWith('.json')).sort(compareIds);
  if (!filenames.length) fail('no_cells');
  const cells = [], identities = new Set();
  for (const name of filenames) {
    const cell = JSON.parse(await readFile(join(dir, name), 'utf8')), run = cell.run;
    if (!run) fail('invalid_cell_run');
    const bytes = await readFile(run.rankingPath);
    if (sha256(bytes) !== run.rankingHash) fail('cell_ranking_hash');
    if (run.split === 'test') {
      const manifest = await inputManifest();
      if (run.rankingHash !== manifest.members[RANKINGS[run.ranking]?.member]) fail('cell_frozen_ranking_hash');
    }
    const ranking = JSON.parse(bytes);
    authenticateRanking(authenticated, ranking, { selection: run.ranking, split: run.split, scale: run.scale });
    if (!same(run.rankingRun, ranking.run)) fail('cell_ranking_metadata');
    for (const query of cell.queries) if (!same(query.ranked, ranking.queries[query.id]?.ranked)) fail('cell_ranking_changed');
    const identity = JSON.stringify([run.split, run.scale, run.ranking, run.arm, run.overhead, run.budget]);
    if (identities.has(identity)) fail('duplicate_cell');
    identities.add(identity); cells.push(scoreCell(fixture, cell));
  }
  return { format: 'hr2-scores-v1', ok: true, cells };
}

await cliMain(import.meta.url, async options => {
  if (Object.keys(options).some(key => !['_', 'fixture-dir', 'cells', 'out'].includes(key)) || options._.length) fail('unknown_score_option');
  const scores = await scoreDirectory(requiredOption(options, 'fixture-dir'), requiredOption(options, 'cells'));
  await writeJson(requiredOption(options, 'out'), scores);
  console.log(JSON.stringify({ ok: true, cells: scores.cells.length }));
});
