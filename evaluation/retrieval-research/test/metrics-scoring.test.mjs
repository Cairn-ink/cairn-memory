import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { loadFixture, writeJson, readJson } from '../lib/fixture.mjs';
import { scoreGroups, scoreRankings, scoreRuns, checkIsolation } from '../lib/metrics.mjs';
import { toyFixture, rankingsFor } from './fixtures-tooling/toy.mjs';
import { runCli } from './fixtures-tooling/cli.mjs';

test('hand-computed group metrics use prefixes of one deduplicated ranking', () => {
  const groups = [
    { fact: 'f1', fidelity: 'body-covered', members: [{ memory: 'a' }, { memory: 'b' }] },
    { fact: 'f2', fidelity: 'span-only', members: [{ memory: 'c' }] },
  ];
  const ranked = ['b', ...Array.from({ length: 11 }, (_, i) => `x${i}`), 'c'];
  const result = scoreGroups(groups, ranked);
  assert.equal(result.recall12, 0.5); assert.equal(result.recall24, 1);
  assert.equal(result.allRequired12, false); assert.equal(result.allRequired24, true);
  assert.deepEqual(result.bestRanks.map(group => group.rank), [1, 13]);
  assert.equal(scoreGroups([], ranked).recall12, null);
  assert.equal(scoreGroups(groups, ranked, false).recall24, null);
});

test('scoring reports equal-category macro, non-required counts, hard negatives and C8/FOREIGN diagnostics', () => {
  const fixture = toyFixture();
  const ranking = rankingsFor(fixture, { ranking: label => label.category === 'C5' ? [label.groups[0].members[0].memory, label.hardNegatives[0]] : [] });
  const result = scoreRankings(fixture, ranking);
  assert.equal(result.ok, true); assert.equal(result.summary.n, 98);
  assert.equal(result.summary.macroRecall12, 0.5 / 7);
  const row = result.queries.find(query => query.category === 'C5');
  assert.equal(row.recall12, 0.5); assert.equal(row.hardNegative12, 1);
  assert.deepEqual(row.counts12, { returned: 2, nonRequired: 1, hardNegatives: 1 });
  assert.equal(result.diagnostics.every(query => query.recall12 === null), true);
  assert.equal(result.diagnostics.some(query => query.category === 'C8'), true);
  assert.equal(result.diagnostics.some(query => query.category === 'FOREIGN'), true);
  assert.equal(result.strata['C3:zero-overlap'].n, 14);
});

test('fidelity is group-based and queries lacking a stratum are omitted; empty strata are null', () => {
  const fixture = toyFixture();
  const query = fixture.labels.queries.find(query => query.id === 'q-C5-12');
  query.groups[1].members[0].where = 'body';
  const ranking = rankingsFor(fixture, { ranking: label => label.id === query.id ? [label.groups[0].members[0].memory] : [] });
  const result = scoreRankings(fixture, ranking);
  const span = result.strata['fidelity:span-only'].queries.find(row => row.id === query.id);
  const body = result.strata['fidelity:body-covered'].queries.find(row => row.id === query.id);
  assert.equal(span.recall12, 1); assert.equal(body.recall12, 0);
  assert.equal(result.queries.find(row => row.id === query.id).recall12, 0.5);
  assert.equal(result.strata['span-count:2'].n, 0); assert.equal(result.strata['span-count:2'].macroRecall12, null);
  assert.equal(result.strata['fidelity:span-only'].queries.some(row => row.id === 'q-C1-06'), false);
});

test('fusion channels report best ranks and group coverage before fusion', () => {
  const fixture = toyFixture(), ranking = rankingsFor(fixture, { arm: 'A3', config: 'A3', model: 'e5-small' });
  for (const result of Object.values(ranking.queries)) {
    result.channels = { lex: result.ranked, sem: [] }; result.unionSize = result.ranked.length;
  }
  const scored = scoreRankings(fixture, ranking), query = scored.queries.find(query => query.category === 'C5');
  assert.equal(query.union.requiredGroups, 2); assert.equal(query.channels.lex.requiredGroupCoverage, 2);
  assert.deepEqual(query.channels.lex.bestRanks.map(group => group.rank), [1, 2]);
  assert.deepEqual(query.channels.sem.bestRanks.map(group => group.rank), [null, null]);
  ranking.queries[query.id].unionSize++;
  assert.equal(scoreRankings(fixture, ranking).failures.some(failure => failure.code === 'union_size_mismatch'), true);
});

test('foreign leakage, including diagnostic queries and internal channels, is a hard failure', () => {
  const fixture = toyFixture(), ranking = rankingsFor(fixture), foreign = fixture.corpus.memories.find(memory => memory.namespace === 'foreign').id;
  const control = fixture.labels.queries.find(label => label.category === 'FOREIGN' && label.split === 'test');
  ranking.queries[control.id].ranked = [foreign];
  const scores = scoreRuns(fixture, [ranking]);
  assert.equal(scores.ok, false); assert.equal(scores.runs[0].failures.some(failure => failure.code === 'foreign_leakage'), true);
  ranking.queries[control.id].ranked = [];
  ranking.queries[control.id].channels = { lex: [], sem: [foreign] }; ranking.queries[control.id].unionSize = 1;
  assert.equal(scoreRankings(fixture, ranking).ok, false);
  const clean = rankingsFor(fixture);
  assert.equal(checkIsolation(clean, structuredClone(clean)).ok, true);
  assert.equal(checkIsolation(clean, ranking).ok, true); // final target rankings are identical
  ranking.queries[control.id].ranked = [foreign];
  assert.deepEqual(checkIsolation(clean, ranking).mismatches, [control.id]);
});

test('ranking schema, complete query sets, eligible IDs, scale and fixture hashes are checked', () => {
  const fixture = toyFixture(), ranking = rankingsFor(fixture), id = Object.keys(ranking.queries)[0];
  ranking.queries[id].ranked = ['duplicate', 'duplicate'];
  assert.throws(() => scoreRankings(fixture, ranking), /invalid_ranking/);
  ranking.queries[id].ranked = Array.from({ length: 25 }, (_, i) => `unknown-${i}`);
  assert.throws(() => scoreRankings(fixture, ranking), /invalid_ranking/);
  delete ranking.queries[id]; assert.throws(() => scoreRankings(fixture, ranking), /query_set_mismatch/);
  const historical = fixture.corpus.memories.find(memory => memory.state === 'historical');
  const wrong = rankingsFor(fixture, { ranking: () => [historical.id] });
  assert.equal(scoreRankings(fixture, wrong).failures.some(failure => failure.code === 'ineligible_memory'), true);
  const extra = fixture.corpus.memories.find(memory => memory.scale === 'S1000-extra');
  const s300 = rankingsFor(fixture, { scale: 'S300', ranking: () => [extra.id] });
  assert.equal(scoreRankings(fixture, s300).ok, false);
  const mismatch = rankingsFor(fixture); mismatch.run.fixtureHashes = { 'hr1-corpus.json': 'wrong' };
  assert.equal(scoreRankings(fixture, mismatch).failures[0].code, 'fixture_hash_mismatch');
});

test('unavailable ranking records retain failures and paired isolation mismatches fail scoring', () => {
  const fixture = toyFixture(), failed = rankingsFor(fixture);
  failed.run.status = 'unavailable'; failed.run.error = 'synthetic model failure'; failed.queries = {};
  const unavailable = scoreRuns(fixture, [failed]);
  assert.equal(unavailable.ok, false); assert.equal(unavailable.runs[0].failures[0].code, 'run_unavailable');
  const input = rankingsFor(fixture), without = structuredClone(input);
  const id = Object.keys(without.queries)[0]; without.queries[id].ranked = [];
  const scores = scoreRuns(fixture, [input], { withoutForeign: [without] });
  assert.equal(scores.ok, false); assert.equal(scores.runs[0].failures.some(failure => failure.code === 'foreign_isolation_mismatch'), true);
  assert.equal(scoreRuns(fixture, [input], { withoutForeign: [input] }).runs[0].isolation.ok, true);
});

test('A0 reports mean and range across exactly stores 0–4; default recall@24 unavailable', () => {
  const fixture = toyFixture();
  const inputs = Array.from({ length: 5 }, (_, store) => rankingsFor(fixture, { arm: 'A0-default', store,
    ranking: label => store < 2 ? label.groups.flatMap(group => group.members.filter(member => member.namespace === 'target').map(member => member.memory)) : [] }));
  const scores = scoreRuns(fixture, inputs);
  assert.equal(scores.ok, true); assert.deepEqual(scores.a0[0].macroRecall12, { mean: 0.4, min: 0, max: 1 });
  assert.equal(scores.a0[0].macroRecall24, null); assert.equal(scores.runs[0].summary.macroRecall24, null);
  assert.equal(scoreRuns(fixture, inputs.slice(0, 4)).ok, false);
  assert.equal(scoreRuns(fixture, [inputs[0], ...inputs.slice(0, 4)]).ok, false);
});

test('score CLI writes versioned scores and exits nonzero for foreign leakage', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-score-' }), fixture = toyFixture();
  for (const [key, suffix] of Object.entries({ facts: 'facts', corpus: 'corpus', queries: 'queries', split: 'split', labels: 'labels', audit: 'label-audit' })) {
    await writeJson(join(workspace.path, `hr1-${suffix}.json`), fixture[key]);
  }
  const loaded = await loadFixture(workspace.path), input = join(workspace.path, 'rankings.json'), output = join(workspace.path, 'scores.json');
  const rankings = rankingsFor(loaded);
  await writeJson(input, rankings);
  const args = ['evaluation/retrieval-research/score.mjs', '--fixture', workspace.path, '--out', output, input];
  const command = await runCli(workspace, args);
  assert.equal(command.code, 0, command.stderr);
  assert.equal(JSON.parse(command.stdout).ok, true); assert.equal((await readJson(output)).format, 'hr1-scores-v1');
  rankings.queries[Object.keys(rankings.queries)[0]].ranked = [loaded.corpus.memories.find(memory => memory.namespace === 'foreign').id];
  await writeJson(input, rankings);
  const failed = await runCli(workspace, args);
  assert.equal(failed.code, 1, failed.stderr); assert.equal(JSON.parse(failed.stdout).ok, false);
});
