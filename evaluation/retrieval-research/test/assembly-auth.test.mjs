import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { runCli } from './fixtures-tooling/cli.mjs';
import { FILES, sha256, inputManifest, authenticateFixture } from '../assembly/auth.mjs';

// Mirror the HR-1 shapes with tiny authored data; no retrieval or test-split run.
function toy() {
  const memory = (id, state = 'current', namespace = 'target') => ({ id, state, namespace, scale: namespace === 'target' ? 'S300' : 'foreign', content: 'hello', spans: [{ id: `${id}#z9`, text: 'hello world' }] });
  const queries = ['C1', 'C2', 'C8', 'FOREIGN'].map((category, i) => ({ id: `q${i}`, family: 'f', category, lang: 'en', intent: 'current', text: 'hello', requiredFacts: [`fact${i}`] }));
  return { corpus: { version: 'hr1-fixture-v2', memories: [memory('m1'), memory('m2'), memory('old', 'historical'), memory('foreign', 'current', 'foreign')] },
    queries: { version: 'hr1-fixture-v2', queries }, split: { f: 'dev' },
    labels: { queries: queries.map(query => ({ ...query, split: 'dev', groups: [{ fact: query.requiredFacts[0], members: [{ memory: 'm1', where: 'body', spans: ['m1#z9'], scale: 'S300', namespace: 'target' }] }] })) } };
}
async function writeToy(workspace, modifyFixture = () => {}) {
  const fixture = toy(); modifyFixture(fixture);
  const dir = join(workspace.path, 'fixture'), rankings = join(workspace.path, 'rankings'), hashes = {};
  await mkdir(dir); await mkdir(join(rankings, 'lexical-S1000'), { recursive: true });
  const contents = { 'hr1-corpus.json': fixture.corpus, 'hr1-queries.json': fixture.queries, 'hr1-split.json': fixture.split, 'hr1-labels.json': fixture.labels };
  for (const name of FILES) {
    const bytes = `${JSON.stringify(contents[name] ?? { version: 'hr1-fixture-v2' })}\n`;
    await writeFile(join(dir, name), bytes); hashes[name] = sha256(bytes);
  }
  await writeFile(join(dir, 'FROZEN.md'), FILES.map(name => `| \`${name}\` | \`${hashes[name]}\` |`).join('\n'));
  const ranking = { format: 'hr1-rankings-v1', run: { split: 'dev', scale: 'S1000', arm: 'A1', config: 'BM25-T1', model: null, lexical: null, status: 'complete', store: null, fixtureHashes: hashes },
    queries: Object.fromEntries(fixture.queries.queries.map(query => [query.id, { ranked: ['m1', 'm2'] }])) };
  return { dir, rankings, ranking };
}
async function invoke(workspace, inputs) {
  await writeFile(join(inputs.rankings, 'lexical-S1000/A1.json'), JSON.stringify(inputs.ranking));
  return runCli(workspace, ['evaluation/retrieval-research/assembly/run.mjs', '--fixture-dir', inputs.dir, '--rankings', inputs.rankings,
    '--split', 'dev', '--scale', 'S1000', '--arms', 'P-top,P-cover', '--rankings-select', 'A1', '--budgets', '128', '--overheads', '0,8', '--out', join(workspace.path, 'cells')]);
}

test('toy dev CLI runs assembly, scoring and report end to end; all dev output is exploratory', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2-toy-' }), inputs = await writeToy(workspace);
  const result = await invoke(workspace, inputs);
  assert.equal(result.code, 0, result.stderr); assert.equal(JSON.parse(result.stdout).cells, 4);
  const scored = await runCli(workspace, ['evaluation/retrieval-research/assembly/score.mjs', '--fixture-dir', inputs.dir, '--cells', join(workspace.path, 'cells'), '--out', join(workspace.path, 'scores.json')]);
  assert.equal(scored.code, 0, scored.stderr);
  const report = await runCli(workspace, ['evaluation/retrieval-research/assembly/report.mjs', '--scores', join(workspace.path, 'scores.json'), '--out', join(workspace.path, 'report.json'), '--markdown', join(workspace.path, 'report.md')]);
  assert.equal(report.code, 0, report.stderr);
  const content = JSON.parse(await readFile(join(workspace.path, 'report.json')));
  assert.equal(content.outcome, 'inconclusive');
  assert.equal(content.outcomeReason, 'primary_cell_absent');
  assert.ok(content.comparisons.every(comparison => comparison.designation === 'exploratory'));
  const cellPath = join(workspace.path, 'cells/P-top--A1--O0--B128.json');
  const cell = JSON.parse(await readFile(cellPath)); cell.queries[0].admitted[0].cost++;
  await writeFile(cellPath, JSON.stringify(cell));
  const corrupt = await runCli(workspace, ['evaluation/retrieval-research/assembly/score.mjs', '--fixture-dir', inputs.dir, '--cells', join(workspace.path, 'cells'), '--out', join(workspace.path, 'bad-scores.json')]);
  assert.equal(corrupt.code, 1); assert.match(corrupt.stderr, /cell_unit_cost_or_id/);
});

const refusals = [
  ['split', input => { input.ranking.run.split = 'test'; }, /rankings_split/],
  ['scale', input => { input.ranking.run.scale = 'S300'; }, /rankings_scale/],
  ...['arm', 'model', 'config', 'lexical'].map(key => [key, input => { input.ranking.run[key] = 'wrong'; }, /rankings_configuration/]),
  ['status', input => { input.ranking.run.status = 'failed'; }, /rankings_incomplete/],
  ['missing status', input => { delete input.ranking.run.status; }, /rankings_incomplete/],
  ['unexpected store', input => { input.ranking.run.store = 0; }, /rankings_incomplete/],
  ['hash disagreement', input => { input.ranking.run.fixtureHashes['hr1-corpus.json'] = '0'.repeat(64); }, /rankings_fixture_hash_mismatch/],
  ['hash set', input => { delete input.ranking.run.fixtureHashes['hr1-facts.json']; }, /rankings_fixture_hash_set/],
  ['missing scored query', input => { delete input.ranking.queries.q0; }, /rankings_query_set/],
  ['unexpected query', input => { input.ranking.queries.extra = { ranked: [] }; }, /rankings_query_set/],
  ['duplicate candidate', input => { input.ranking.queries.q0.ranked = ['m1', 'm1']; }, /invalid_ranking/],
  ['non-string candidate', input => { input.ranking.queries.q0.ranked = [42]; }, /invalid_ranking/],
  ['unknown candidate', input => { input.ranking.queries.q0.ranked = ['missing']; }, /unknown_memory/],
  ['foreign candidate', input => { input.ranking.queries.q0.ranked = ['foreign']; }, /target_namespace/],
  ['historical under current intent', input => { input.ranking.queries.q0.ranked = ['old']; }, /ineligible_memory/],
  ['horizon', input => { input.ranking.queries.q0.ranked = Array.from({ length: 25 }, (_, i) => `id${i}`); }, /invalid_ranking/],
  ['format', input => { input.ranking.format = 'wrong'; }, /rankings_format/],
];
for (const [name, mutate, error] of refusals) test(`authentication CLI refuses ${name}, exit 1`, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2-refuse-' }), inputs = await writeToy(workspace);
  mutate(inputs); const result = await invoke(workspace, inputs);
  assert.equal(result.code, 1, result.stderr); assert.match(result.stderr, error);
});
for (const name of FILES) test(`authentication CLI recomputes ${name}, exit 1`, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2-hash-' }), inputs = await writeToy(workspace);
  await writeFile(join(inputs.dir, name), `${await readFile(join(inputs.dir, name), 'utf8')} `);
  const result = await invoke(workspace, inputs);
  assert.equal(result.code, 1); assert.match(result.stderr, /fixture_hash_mismatch/);
});
for (const fields of [{ deleted: true }, { awaitingReview: true }, { status: 'awaiting_review' }, { state: 'deleted' }, { scale: 'invalid' }]) test(`authentication CLI refuses eligibility ${JSON.stringify(fields)}`, async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2-eligible-' });
  const inputs = await writeToy(workspace, fixture => { Object.assign(fixture.corpus.memories[0], fields); });
  const result = await invoke(workspace, inputs);
  assert.equal(result.code, 1); assert.match(result.stderr, /ineligible_memory/);
});

test('frozen input manifest independently matches the seven original fixture bytes', async () => {
  const manifest = await inputManifest();
  const fixture = await authenticateFixture(new URL('../fixtures/', import.meta.url).pathname);
  assert.deepEqual(fixture.hashes, manifest.fixtureHashes);
  assert.equal(Object.keys(manifest.members).length, 3);
});

test('member digest authentication refuses changed or unlisted toy bytes with exit 1', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2-member-' });
  for (const members of [{ 'toy.json': '0'.repeat(64) }, {}]) {
    const result = await runCli(workspace, ['--input-type=module', '-e', `import { authenticateMember } from './evaluation/retrieval-research/assembly/auth.mjs'; authenticateMember(Buffer.from('toy'), 'toy.json', ${JSON.stringify({ members })});`]);
    assert.equal(result.code, 1); assert.match(result.stderr, /ranking_member_hash_mismatch/);
  }
});

test('incomplete FROZEN manifest refuses with exit 1', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2-frozen-' }), inputs = await writeToy(workspace);
  await writeFile(join(inputs.dir, 'FROZEN.md'), 'not a frozen manifest');
  const result = await invoke(workspace, inputs);
  assert.equal(result.code, 1); assert.match(result.stderr, /frozen_manifest_files/);
});

test('history intent allows historical support and a zero-span item contributes only its body', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr2-history-' });
  const inputs = await writeToy(workspace, fixture => {
    for (const query of fixture.queries.queries) query.intent = 'history';
    for (const label of fixture.labels.queries) label.intent = 'history';
    fixture.corpus.memories[1].spans = [];
  });
  inputs.ranking.queries.q0.ranked = ['old', 'm2'];
  const result = await invoke(workspace, inputs);
  assert.equal(result.code, 0, result.stderr);
  const cell = JSON.parse(await readFile(join(workspace.path, 'cells/P-top--A1--O0--B128.json')));
  assert.deepEqual(cell.queries[0].admitted.map(unit => unit.id), ['old#body', 'old#z9', 'm2#body']);
});
