import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { buildLabels } from '../tools/labels.mjs';
import { scoreRankings } from '../lib/metrics.mjs';
import { loadFixture, armDocuments, writeJson, readJson } from '../lib/fixture.mjs';
import { createArm } from '../lib/arms.mjs';
import { createSelection, buildReport } from '../report.mjs';
import { toyFixture, rankingsFor, tokenizers } from './fixtures-tooling/toy.mjs';
import { runCli } from './fixtures-tooling/cli.mjs';

test('review reproduction: body winners and unrelated spans give zero required-span credit; either supporting span wins', () => {
  const fixture = toyFixture();
  const memory = fixture.corpus.memories.find(memory => memory.expresses.some(expression => expression.fact === 'new-12'));
  memory.spans.push({ ...memory.spans[0], id: `${memory.id}#s2`, text: 'Another valid support.' },
    { ...memory.spans[0], id: `${memory.id}#s3`, text: 'An unrelated exchange.' });
  memory.expresses.push({ fact: 'new-12', where: 'span', span: memory.spans[1].id });
  const label = buildLabels(fixture, tokenizers).queries.find(label => label.id === 'q-C1-12');
  fixture.labels.queries = [label];
  assert.deepEqual(label.groups[0].members[0].spans, memory.spans.slice(0, 2).map(span => span.id));
  const ranking = rankingsFor(fixture, { arm: 'A5-both', config: 'A3', model: 'e5-small' });
  const result = ranking.queries[label.id];
  result.channels.sem = [memory.id]; result.channelScores.sem = { [memory.id]: 0.9 };
  result.winningDocs = { lex: { [memory.id]: `${memory.id}#body` }, sem: { [memory.id]: `${memory.id}#body` } };
  const score = () => scoreRankings(fixture, ranking);
  assert.equal(score().queries[0].recall12, 1);
  assert.equal(score().queries[0].requiredSpanCoverage.recall12, 0);
  assert.equal(score().strata['required-span'].macroRecall12, 0);
  result.winningDocs.lex[memory.id] = memory.spans[2].id;
  assert.equal(score().queries[0].requiredSpanCoverage.recall12, 0);
  result.winningDocs.lex[memory.id] = memory.spans[1].id;
  assert.equal(score().queries[0].requiredSpanCoverage.recall12, 1);
  result.winningDocs.lex[memory.id] = `${memory.id}#body`;
  result.winningDocs.sem[memory.id] = memory.spans[0].id;
  assert.equal(score().queries[0].requiredSpanCoverage.recall12, 1);
  const unrelated = fixture.corpus.memories.find(item => item.state === 'current' && item.id !== memory.id);
  result.ranked = [unrelated.id]; result.channels.lex.push(unrelated.id);
  result.channelScores.lex[unrelated.id] = 0.1; result.winningDocs.lex[unrelated.id] = `${unrelated.id}#body`; result.unionSize = 2;
  assert.equal(score().queries[0].requiredSpanCoverage.recall24, 0, 'channel-only memory is not a returned memory');
  const padding = fixture.corpus.memories.filter(item => item.namespace === 'target' && item.state === 'current' && item.id !== memory.id).slice(0, 12);
  result.ranked = [...padding.map(item => item.id), memory.id];
  result.channels.lex = result.ranked; result.unionSize = 13;
  result.channelScores.lex = Object.fromEntries(result.ranked.map(id => [id, 1]));
  result.winningDocs.lex = Object.fromEntries(result.ranked.map(id => [id, `${id}#body`]));
  assert.equal(score().queries[0].requiredSpanCoverage.recall12, 0);
  assert.equal(score().queries[0].requiredSpanCoverage.recall24, 1);
  delete result.winningDocs;
  assert.throws(score, /winning_docs_required/);
});

test('required-span coverage checks each fact group against its own supporting spans, including body-covered members', () => {
  const fixture = toyFixture(), label = fixture.labels.queries.find(label => label.id === 'q-C5-06');
  const first = fixture.corpus.memories.find(memory => memory.id === label.groups[0].members[0].memory);
  first.spans.push({ ...first.spans[0], id: `${first.id}#s2`, text: 'Support for the other required fact.' });
  label.groups[1].members = [{ ...label.groups[0].members[0], spans: [first.spans[1].id] }];
  fixture.labels.queries = [label];
  const ranking = rankingsFor(fixture, { arm: 'A5-both', config: 'A3', model: 'e5-small' });
  const score = scoreRankings(fixture, ranking);
  assert.equal(score.queries[0].recall12, 1);
  assert.equal(score.queries[0].requiredSpanCoverage.recall12, 0.5);
  assert.equal(score.strata['required-span'].macroRecall12, 0.5);
  label.groups[1].members[0].spans = [];
  assert.equal(scoreRankings(fixture, ranking).queries[0].requiredSpanCoverage.recall12, 0.5, 'a group without a supporting span remains in the denominator');
});

test('A5 producer-to-scorer integration gives no span credit when both actual channel winners are bodies', async () => {
  const fixture = toyFixture(), label = fixture.labels.queries.find(label => label.id === 'q-C1-12');
  const memory = fixture.corpus.memories.find(memory => memory.id === label.groups[0].members[0].memory);
  memory.content = 'retrieve_key '.repeat(12); memory.spans[0].text = 'A differently worded supporting statement.';
  fixture.corpus.memories = [memory]; fixture.labels.queries = [label];
  const arm = await createArm({ arm: 'A5-both', documents: armDocuments(fixture, { namespace: 'target', scale: 'S300', intent: 'current', include: 'both' }),
    embedder: { metadata: { device: 'cpu' }, async embed(texts) { return texts.map(() => [1, 0]); } } });
  try {
    const ranking = rankingsFor(fixture, { arm: 'A5-both', config: 'A3', model: 'e5-small', scale: 'S300' });
    ranking.queries[label.id] = await arm.search({ text: 'retrieve_key', intent: 'current' });
    assert.equal(ranking.queries[label.id].winningDocs.lex[memory.id], `${memory.id}#body`);
    assert.equal(ranking.queries[label.id].winningDocs.sem[memory.id], `${memory.id}#body`);
    const scored = scoreRankings(fixture, ranking);
    assert.equal(scored.ok, true); assert.equal(scored.queries[0].recall12, 1);
    assert.equal(scored.queries[0].requiredSpanCoverage.recall12, 0);
  } finally { arm.close(); }
});

test('raw score maps are mandatory, finite and complete, including diagnostics; legacy arrays are rejected', () => {
  const fixture = toyFixture(), ranking = rankingsFor(fixture);
  const control = Object.values(ranking.queries).find(result => result.ranked.length === 0);
  delete control.channelScores; control.scores = [];
  assert.throws(() => scoreRankings(fixture, ranking), /channel_scores_required/);
  control.channelScores = { lex: [] };
  assert.throws(() => scoreRankings(fixture, ranking), /invalid_channel_scores/);
  control.channelScores = { lex: {} };
  const returned = Object.values(ranking.queries).find(result => result.ranked.length);
  const id = returned.ranked[0]; returned.channelScores.lex[id] = NaN;
  assert.throws(() => scoreRankings(fixture, ranking), /invalid_channel_scores/);
  delete returned.channelScores.lex[id];
  assert.throws(() => scoreRankings(fixture, ranking), /missing_channel_score/);
  returned.channelScores.lex[id] = 2;
  const scored = scoreRankings(fixture, ranking);
  assert.deepEqual(scored.queries.find(query => query.ranked.includes(id)).rawChannelScores, returned.channelScores);
  assert.equal(scored.diagnostics.every(query => query.rawChannelScores && !Array.isArray(query.rawChannelScores.lex)), true);
});

test('alternate-label CLI rejects different bytes by default and explicitly diagnostic scoring records the actual hash', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-label-provenance-' }), fixture = toyFixture();
  for (const [key, suffix] of Object.entries({ facts: 'facts', corpus: 'corpus', queries: 'queries', split: 'split', labels: 'labels', audit: 'label-audit' })) {
    await writeJson(join(workspace.path, `hr1-${suffix}.json`), fixture[key]);
  }
  const loaded = await loadFixture(workspace.path), frozenBytes = await readFile(join(workspace.path, 'hr1-labels.json'));
  const alternate = join(workspace.path, 'alternate.json'), input = join(workspace.path, 'rankings.json'), output = join(workspace.path, 'scores.json');
  const ranking = rankingsFor(loaded); await writeJson(input, ranking);
  const args = ['evaluation/retrieval-research/score.mjs', '--fixture', workspace.path, '--labels', alternate, '--out', output, input];
  await writeFile(alternate, frozenBytes);
  assert.equal((await runCli(workspace, args)).code, 0);
  await writeFile(alternate, Buffer.concat([frozenBytes, Buffer.from('\n')]));
  const formatting = await runCli(workspace, args);
  assert.equal(formatting.code, 1); assert.match(formatting.stderr, /alternate_labels_differ_from_frozen/);
  const changed = structuredClone(loaded.labels);
  changed.queries.find(query => query.id === 'q-C1-06').groups[0].members = changed.queries.find(query => query.id === 'q-C1-07').groups[0].members;
  await writeJson(alternate, changed);
  assert.equal((await runCli(workspace, args)).code, 1);
  const diagnostic = await runCli(workspace, [...args, '--diagnostic-labels']);
  assert.equal(diagnostic.code, 0, diagnostic.stderr);
  const scores = await readJson(output), actualHash = createHash('sha256').update(await readFile(alternate)).digest('hex');
  assert.notEqual(actualHash, loaded.hashes['hr1-labels.json']);
  assert.equal(scores.fixtureHashes['hr1-labels.json'], actualHash);
  assert.deepEqual(scores.labelProvenance, { mode: 'diagnostic', actualHash, frozenHash: loaded.hashes['hr1-labels.json'] });
  assert.equal(scores.runs[0].run.fixtureHashes['hr1-labels.json'], actualHash);
  assert.equal(scores.runs[0].run.rankingFixtureHashes['hr1-labels.json'], loaded.hashes['hr1-labels.json']);
  assert.equal(scores.runs[0].summary.macroRecall12 < 1, true);
  assert.throws(() => createSelection(scores), /diagnostic_labels_not_confirmatory/);
  assert.throws(() => buildReport(scores, { format: 'hr1-selection-v1' }), /diagnostic_labels_not_confirmatory/);
  ranking.run.fixtureHashes['hr1-corpus.json'] = 'wrong-corpus'; await writeJson(input, ranking);
  const mismatch = await runCli(workspace, [...args, '--diagnostic-labels']);
  assert.equal(mismatch.code, 1);
  assert.equal((await readJson(output)).runs[0].failures.some(failure => failure.code === 'fixture_hash_mismatch' && failure.filename === 'hr1-corpus.json'), true);
});
