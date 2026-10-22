import test from 'node:test';
import assert from 'node:assert/strict';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import * as fixtureAPI from '../lib/fixture.mjs';
import { checkIsolation } from '../lib/metrics.mjs';
import { explorationGrid } from '../lib/fusion.mjs';
import { isolationFixture, parseCLI, runRankings } from '../run.mjs';
import { runLatency } from '../latency.mjs';
import { toyFixture, fakeEmbedder } from './fixtures-arms/toy.mjs';

const arms = ['A0-default', 'A0-paged', 'A0b', 'A1', 'A1+', 'A1t', 'A2',
  'A3', 'F-RRF60', 'F-RRF10', 'F-MM', 'A5-spans', 'A5-both'];
const identity = run => [run.arm, run.config, run.model, run.scale, run.split, run.store];
function nearDuplicates(split = 'dev') {
  const fixture = toyFixture();
  fixture.split['hidden-family'] = split;
  fixture.corpus.memories.push(...fixture.corpus.memories.filter(m => m.namespace === 'target').map(memory => ({
    ...memory, id: `foreign-${memory.id}`, namespace: 'foreign', scale: 'foreign',
    content: `${memory.content} FOREIGN_ONLY_BODY`,
    spans: [{ id: `foreign-${memory.id}#s1`, text: `${memory.content} FOREIGN_ONLY_SPAN` }],
  })));
  return fixture;
}
function options(workspace, overrides = {}) {
  return { fixtureDir: workspace.path, split: 'dev', scale: 'S300', arms, models: ['e5-small'],
    out: join(workspace.path, 'with'), cacheDir: join(workspace.path, 'cache'),
    storeDir: join(workspace.path, 'stores'), threads: 1, ...overrides };
}
async function selectionFile(workspace, fixture, overrides = {}) {
  const path = join(workspace.path, 'selection.json');
  await writeFile(path, JSON.stringify({ format: 'hr1-selection-v1', sourceSplit: 'dev', scale: 'S1000',
    status: 'ready', easeCheck: { saturated: false }, comparator: { arm: 'A1' }, fixtureHashes: fixture.hashes,
    nominated: { local: { model: 'e5-small', menu: 'A3' } }, ...overrides }));
  return path;
}
function observedAPI(fixture) {
  const seen = [];
  return { seen, api: { ...fixtureAPI, async loadFixture() { return fixture; },
    armQueries(input, opts) { seen.push(input); return fixtureAPI.armQueries(input, opts); },
    armDocuments(input, opts) { seen.push(input); return fixtureAPI.armDocuments(input, opts); },
  } };
}
function assertFiltered(seen, source) {
  assert.ok(seen.length > 1);
  for (const input of seen) {
    assert.notEqual(input, source);
    assert.equal(input.hashes, source.hashes);
    assert.ok(input.corpus.memories.every(memory => memory.namespace !== 'foreign'));
    assert.ok(input.corpus.memories.flatMap(memory => memory.spans).every(span => !span.id.startsWith('foreign')));
  }
}
async function diskFixture(workspace) {
  const fixture = nearDuplicates('test'), dir = join(workspace.path, 'toy');
  await mkdir(dir);
  const paths = [];
  for (const [suffix, value] of Object.entries({ facts: { facts: [] }, corpus: fixture.corpus,
    queries: fixture.queries, split: fixture.split, labels: { queries: [] }, 'label-audit': { overrides: [] },
    'facts-view': { facts: [] } })) {
    const path = join(dir, `hr1-${suffix}.json`);
    await writeFile(path, JSON.stringify(value)); paths.push(path);
  }
  return { dir, paths, fixture: await fixtureAPI.loadFixture(dir) };
}

test('isolation flag validates strictly; default returns the unchanged fixture and variant preserves hashes', () => {
  const args = ['--fixture-dir', '/tmp/toy', '--split', 'dev', '--scale', 'S300', '--arms', 'A1', '--out', '/tmp/out'];
  assert.equal(parseCLI(args).isolationVariant, 'with-foreign');
  for (const variant of ['with-foreign', 'without-foreign'])
    assert.equal(parseCLI([...args, '--isolation-variant', variant]).isolationVariant, variant);
  assert.throws(() => parseCLI([...args, '--isolation-variant', 'other']), /invalid_isolation_variant/);
  const source = nearDuplicates(), bytes = JSON.stringify(source);
  assert.equal(isolationFixture(source), source);
  assert.equal(isolationFixture(source, 'with-foreign'), source);
  const variant = isolationFixture(source, 'without-foreign');
  assert.equal(variant.hashes, source.hashes);
  assert.equal(variant.queries, source.queries);
  assert.deepEqual(variant.corpus.memories, source.corpus.memories.filter(memory => memory.namespace !== 'foreign'));
  assert.equal(JSON.stringify(source), bytes);
  assert.throws(() => isolationFixture(source, 'other'), /invalid_isolation_variant/);
});

for (const [scale, split] of [['S300', 'dev'], ['S1000', 'test']]) {
  test(`paired ${scale}/${split} rankings agree for every arm, including five frozen A0 stores`, async t => {
    const workspace = createTestWorkspace(t, { prefix: 'hr1-isolation-rank-' }), fixture = nearDuplicates(split);
    const sourceBytes = JSON.stringify(fixture), selectionPath = await selectionFile(workspace, fixture);
    const selectedArms = [...arms, ...(split === 'dev' ? explorationGrid().map(config => config.name) : [])];
    const opts = options(workspace, { scale, split, arms: selectedArms, selectionPath });
    const baseline = observedAPI(fixture), counterpart = observedAPI(fixture), embedders = [];
    const embedderFactory = () => { const embedder = fakeEmbedder(); embedders.push(embedder); return embedder; };
    const normal = await runRankings(opts, { fixtureAPI: baseline.api, embedderFactory });
    const without = await runRankings({ ...opts, isolationVariant: 'without-foreign', out: join(workspace.path, 'without') },
      { fixtureAPI: counterpart.api, embedderFactory });
    assert.equal(normal.outputs.length, selectedArms.length + 8);
    assert.equal(without.outputs.length, normal.outputs.length);
    assert.ok(baseline.seen.every(input => input === fixture));
    assertFiltered(counterpart.seen, fixture);
    for (let i = 0; i < normal.outputs.length; i++) {
      const a = normal.outputs[i], b = without.outputs[i];
      assert.equal(a.run.status, 'complete', `${a.run.arm}: ${a.run.error}`);
      assert.equal(b.run.status, 'complete', `${b.run.arm}: ${b.run.error}`);
      assert.equal(a.run.isolationVariant, 'with-foreign');
      assert.equal(b.run.isolationVariant, 'without-foreign');
      assert.deepEqual(identity(a.run), identity(b.run));
      assert.deepEqual(checkIsolation(a, b), { ok: true, mismatches: [] });
      assert.equal(JSON.stringify(a.queries), JSON.stringify(b.queries));
      assert.deepEqual(b.run.fixtureHashes, fixture.hashes);
      if (a.run.snapshot) assert.deepEqual(a.run.snapshot, b.run.snapshot);
      assert.ok(Object.values(b.queries).some(query => query.ranked.length > 0), b.run.arm);
      for (const query of Object.values(b.queries)) {
        assert.ok(query.ranked.every(id => !id.startsWith('foreign')));
        if (query.errors) assert.deepEqual(query.errors, []);
      }
    }
    assert.ok(embedders.every(embedder => embedder.calls.every(call => call.texts.every(text => !text.includes('FOREIGN_ONLY')))));
    const expectedBodies = fixtureAPI.armDocuments(fixture, { namespace: 'target', scale, intent: 'history', include: 'body' });
    const expectedSpans = fixtureAPI.armDocuments(fixture, { namespace: 'target', scale, intent: 'history', include: 'spans' });
    for (const output of without.outputs.filter(output => output.run.arm === 'A0-default')) {
      const { snapshot } = output.run, db = new DatabaseSync(snapshot.path, { readOnly: true });
      try {
        assert.deepEqual(Object.keys(snapshot.mapping).sort(), expectedBodies.map(doc => doc.memoryId).sort());
        assert.deepEqual(db.prepare('SELECT content FROM memories').all().map(row => row.content).sort(), expectedBodies.map(doc => doc.text).sort());
        assert.deepEqual([...new Set(db.prepare('SELECT excerpt FROM receipts').all().map(row => row.excerpt))].sort(),
          [...new Set(expectedSpans.map(doc => doc.text))].sort());
      } finally { db.close(); }
    }
    assert.equal(JSON.stringify(fixture), sourceBytes);
  });
}

test('latency shares the pre-projection filter and preserves paired run identities across arm types', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-isolation-latency-' }), fixture = nearDuplicates();
  const selectionPath = await selectionFile(workspace, fixture), opts = options(workspace, { selectionPath });
  const baseline = observedAPI(fixture), counterpart = observedAPI(fixture);
  const normal = await runLatency(opts, { fixtureAPI: baseline.api, embedderFactory: () => fakeEmbedder() });
  const without = await runLatency({ ...opts, isolationVariant: 'without-foreign', out: join(workspace.path, 'without') },
    { fixtureAPI: counterpart.api, embedderFactory: () => fakeEmbedder() });
  assert.equal(normal.runs.length, arms.length + 8);
  assert.equal(without.runs.length, normal.runs.length);
  assert.ok(baseline.seen.every(input => input === fixture));
  assertFiltered(counterpart.seen, fixture);
  for (let i = 0; i < normal.runs.length; i++) {
    const a = normal.runs[i], b = without.runs[i];
    assert.deepEqual(identity(a.run), identity(b.run));
    assert.equal(a.run.isolationVariant, 'with-foreign');
    assert.equal(b.run.isolationVariant, 'without-foreign');
    assert.equal(a.failures, 0); assert.equal(b.failures, 0);
    assert.deepEqual(b.samples.map(({ queryId, pass }) => [queryId, pass]), a.samples.map(({ queryId, pass }) => [queryId, pass]));
    assert.deepEqual(b.run.fixtureHashes, fixture.hashes);
  }
});

test('without-foreign retains frozen selection gates and source bytes for rankings and latency', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-isolation-frozen-' }), { dir, paths, fixture } = await diskFixture(workspace);
  const originalBytes = await Promise.all(paths.map(path => readFile(path)));
  const opts = options(workspace, { fixtureDir: dir, split: 'test', arms: ['A1'], isolationVariant: 'without-foreign' });
  for (const run of [runRankings, runLatency]) {
    await assert.rejects(run(opts), /frozen_selection_required/);
    const selectionPath = await selectionFile(workspace, fixture, { status: 'blocked' });
    await assert.rejects(run({ ...opts, selectionPath }), /selection_not_ready_for_test/);
    await selectionFile(workspace, fixture, { fixtureHashes: { altered: 'hash' } });
    await assert.rejects(run({ ...opts, selectionPath }), /selection_fixture_hash_mismatch/);
    await selectionFile(workspace, fixture);
    const result = await run({ ...opts, selectionPath, out: join(workspace.path, run.name + '.json') });
    const record = result.outputs?.[0] ?? result.runs[0];
    assert.equal(record.run.isolationVariant, 'without-foreign');
    assert.deepEqual(record.run.fixtureHashes, fixture.hashes);
  }
  assert.deepEqual(await Promise.all(paths.map(path => readFile(path))), originalBytes);
  assert.deepEqual((await fixtureAPI.loadFixture(dir)).hashes, fixture.hashes);
});

test('actual rankings and latency CLI accept both isolation variants with a frozen toy fixture', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-isolation-cli-' }), { dir, fixture } = await diskFixture(workspace);
  const selectionPath = await selectionFile(workspace, fixture), env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  for (const script of ['run.mjs', 'latency.mjs']) for (const variant of ['with-foreign', 'without-foreign']) {
    const name = `${script}-${variant}`, out = join(workspace.path, name + '.json');
    const stdoutPath = join(workspace.path, name + '.stdout'), stderrPath = join(workspace.path, name + '.stderr');
    const stdout = openSync(stdoutPath, 'w'), stderr = openSync(stderrPath, 'w');
    let child;
    try {
      child = spawnSync(process.execPath, [fileURLToPath(new URL('../' + script, import.meta.url)), '--fixture-dir', dir,
        '--split', 'test', '--scale', 'S300', '--arms', 'A1', '--selection', selectionPath, '--out', out,
        ...(variant === 'without-foreign' ? ['--isolation-variant', variant] : [])], { env, stdio: ['ignore', stdout, stderr] });
    } finally { closeSync(stdout); closeSync(stderr); }
    assert.equal(child.error?.code, undefined);
    assert.equal(child.status, 0, readFileSync(stderrPath, 'utf8'));
    assert.equal(JSON.parse(await readFile(out, 'utf8')).run.isolationVariant, variant);
  }
});

test('unavailable ranking and latency records also identify the isolation variant', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-isolation-unavailable-' }), fixture = nearDuplicates();
  for (const run of [runRankings, runLatency]) {
    const result = await run(options(workspace, { arms: ['A2'], isolationVariant: 'without-foreign',
      out: join(workspace.path, run.name + '.json') }), {
      fixtureAPI: observedAPI(fixture).api, embedderFactory() { throw new Error('synthetic failure'); },
    });
    const record = result.outputs?.[0] ?? result.runs[0];
    assert.equal(record.run.status, 'unavailable');
    assert.equal(record.run.isolationVariant, 'without-foreign');
  }
});
