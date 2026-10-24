import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, symlink, readdir, open } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { HR2B_VERSION, fixtureProfile, loadFixture } from '../lib/fixture.mjs';
import { checkHR2bWorld, RECEIPT_HISTOGRAM } from '../lib/hr2b-world.mjs';
import { placementOf, placementQuotas } from '../lib/placement.mjs';
import { probeText } from '../assembly/calibrate-host-v2.mjs';
import { factsView } from '../tools/facts-view.mjs';
import { buildLabels, makeMember, loadTokenizers } from '../tools/labels.mjs';
import { applyAudit } from '../tools/apply-audit.mjs';
import { assignSplit } from '../tools/split.mjs';
import { validateFixture } from '../tools/validate.mjs';
import { tokenizers, toyFixture } from './fixtures-tooling/toy.mjs';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const jsonBytes = value => `${JSON.stringify(value, null, 2)}\n`;
async function command(workspace, program, args, name) {
  const path = join(workspace.path, name), fd = await open(path, 'w');
  try {
    const child = spawn(program, args, { stdio: ['ignore', fd.fd, 'inherit'], env: { ...process.env, NODE_TEST_CONTEXT: '' } });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    assert.equal(code, 0, `${program} exit ${code}`);
    return await readFile(path, 'utf8');
  } finally { await fd.close(); }
}

test('committed HR-1 facts view, split, audited labels and frozen-validator output stay byte-identical', async t => {
  const fixtureDir = join(root, 'evaluation/retrieval-research/fixtures'), fixture = await loadFixture(fixtureDir), realTokens = await loadTokenizers();
  for (const [name, actual] of [['facts-view', factsView(fixture)], ['split', assignSplit(fixture.queries.queries)],
    ['labels', applyAudit({ ...fixture, labels: buildLabels(fixture, realTokens) }, fixture.audit, realTokens)]]) {
    assert.equal(jsonBytes(actual), await readFile(join(fixtureDir, `hr1-${name}.json`), 'utf8'), name);
  }
  // No validation-result file is committed. Independently run the committed
  // c546bfc1 validator, with its original lib/tools, in an isolated tree.
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-hr1-bytes-' });
  const oldResearch = join(workspace.path, 'evaluation/retrieval-research');
  for (const dir of ['lib', 'tools']) {
    await mkdir(join(oldResearch, dir), { recursive: true });
    for (const name of (await readdir(join(root, 'evaluation/retrieval-research', dir))).filter(name => name.endsWith('.mjs'))) {
      // Newly added modules are not members of the frozen tree.
      const listed = await command(workspace, 'git', ['ls-tree', '--name-only', 'c546bfc1', `evaluation/retrieval-research/${dir}/${name}`], 'tree');
      if (!listed.trim()) continue;
      const source = await command(workspace, 'git', ['show', `c546bfc1:evaluation/retrieval-research/${dir}/${name}`], 'source');
      await writeFile(join(oldResearch, dir, name), source);
    }
  }
  await symlink(join(root, 'core'), join(workspace.path, 'core'));
  await symlink(join(root, 'evaluation/retrieval-research/node_modules'), join(oldResearch, 'node_modules'));
  const previous = await command(workspace, process.execPath, [join(oldResearch, 'tools/validate.mjs'), '--fixture', fixtureDir], 'validation');
  const current = validateFixture(fixture, realTokens, { view: factsView(fixture) });
  assert.equal(current.ok, true, JSON.stringify(current.errors));
  assert.equal(jsonBytes(current), previous);
});

function world() {
  const facts = [], families = [], memories = [], forbiddenLexicon = {}, filler = { sentences: [], ranges: [] };
  for (const [role, scale, count, familyCount] of [['target', 'S300', 160, 40], ['distractor', 'S1000-extra', 320, 40], ['foreign', 'foreign', 60, 10]]) {
    for (let i = 0; i < familyCount; i++) {
      const family = `${role}-f${i}`;
      families.push({ id: family, role, domain: 'engineering', summary: family });
      for (let j = 0; j < (role === 'foreign' ? 6 : 8); j++) {
        const id = `${family}-${j}`, rendered = role === 'foreign' || j < 7;
        facts.push({ id, family, rendered });
        if (rendered) forbiddenLexicon[id] = [`entity-${id}`];
      }
    }
    for (let i = 0; i < count; i++) {
      const id = `${role}-m${i}`, familyIndex = Math.floor(i / (count / familyCount)), family = `${role}-f${familyIndex}`;
      const bin = i / count < .2 ? 1 : i / count < .45 ? 2 : i / count < .7 ? 3 : i / count < .85 ? 4 : i / count < .95 ? 5 : 6;
      const bodyLength = i / count < .3 ? 140 : i / count < .7 ? 220 : 300;
      // Five punctuation-separated sentences. The ' a.' sequence costs two.
      const content = probeText(bodyLength - 10) + ' a. a. a. a. a.';
      const spans = Array.from({ length: role === 'foreign' ? 1 : bin }, (_, j) => ({ id: `${id}#s${j + 1}`, role: 'user',
        eventTime: `2026-08-14T09:00:0${j}Z`, text: probeText(i / count < .35 ? 50 : i / count < .75 ? 90 : 150, 'cedar') }));
      const episode = i % (count / familyCount), factIndexes = role === 'foreign' ? [episode] : [2 * (episode % 4) % 7, (2 * (episode % 4) + 1) % 7];
      const expresses = factIndexes.map(j => {
        const index = familyIndex * 7 + j, where = role === 'foreign' || index < 126 ? 'body' : 'span';
        return { fact: `${family}-${j}`, where, span: where === 'body' ? null : spans[index < 196 ? 0 : 1].id };
      });
      memories.push({ id, scale, namespace: role === 'foreign' ? 'foreign' : 'target', content, spans, expresses });
      const add = (text, where, span) => {
        const sentence = `filler-${filler.sentences.length}`;
        filler.sentences.push({ id: sentence, text });
        filler.ranges.push({ sentence, memory: id, where, span, start: 0, end: text.length });
      };
      add(content, 'body', null); spans.forEach(span => add(span.text, 'span', span.id));
    }
  }
  for (const scale of ['S300', 'S1000-extra']) {
    const spans = memories.filter(memory => memory.scale === scale).flatMap(memory => memory.spans);
    spans.forEach((span, i) => { span.text = probeText(i / spans.length < .35 ? 50 : i / spans.length < .75 ? 90 : 150, 'cedar'); });
  }
  // Re-disclose final token-band allocation in ranges after receipt lengths.
  const texts = new Map(memories.flatMap(memory => [[`${memory.id}:body:`, memory.content], ...memory.spans.map(span => [`${memory.id}:span:${span.id}`, span.text])]));
  filler.ranges.forEach((range, i) => { const text = texts.get(`${range.memory}:${range.where}:${range.span ?? ''}`); filler.sentences[i].text = text; range.end = text.length; });
  return { facts: { version: HR2B_VERSION, families, facts, forbiddenLexicon }, corpus: { version: HR2B_VERSION, memories, filler } };
}

test('HR-2b world accepts 160/320/60 long items, histograms, lengths, placement and disclosed fact-free filler', () => {
  const fixture = world(), result = checkHR2bWorld(fixture);
  assert.equal(result.ok, true, JSON.stringify(result.errors));
  assert.deepEqual(result.statistics.S300.histogram, RECEIPT_HISTOGRAM);
  assert.deepEqual(result.statistics.placement.target, { body: .45, 'first-receipt': .25, 'later-receipt': .30 });
});
for (const [code, mutate] of [
  ['hr2b:count', fixture => fixture.corpus.memories.splice(0, 30)],
  ['hr2b:receipt_order', fixture => fixture.corpus.memories.at(-1).spans[0].id = 'bad'],
  ['hr2b:receipt_order', fixture => { const m = fixture.corpus.memories.find(m => m.spans.length === 2); m.spans[0].eventTime = '2027-01-01'; }],
  ['hr2b:placement_share', fixture => fixture.corpus.memories.forEach(m => m.expresses.forEach(e => { e.where = 'body'; e.span = null; }))],
  ['hr2b:forbidden_lexicon_hit', fixture => fixture.facts.forbiddenLexicon['target-f0-0'].push('maple')],
  ['hr2b:length_range', fixture => { fixture.corpus.memories[0].content = 'short'; }],
  ['hr2b:length_band', fixture => { fixture.corpus.memories.filter(m => m.scale === 'S300').forEach(m => { m.content = probeText(220); }); }],
  ['hr2b:receipt_histogram', fixture => { fixture.corpus.memories.filter(m => m.scale === 'S300').slice(32, 70).forEach(m => { m.spans.length = 1; }); }],
  ['hr2b:inconsistent_fact_placement', fixture => { fixture.corpus.memories[3].expresses[1].where = 'span'; fixture.corpus.memories[3].expresses[1].span = fixture.corpus.memories[3].spans[0].id; }],
  ['hr2b:filler_range', fixture => { fixture.corpus.filler.ranges[0].end--; }],
  ['hr2b:undisclosed_unit', fixture => { fixture.corpus.filler.ranges = []; }],
  ['hr2b:fact_lexicon', fixture => { delete fixture.facts.forbiddenLexicon['target-f0-0']; }],
]) test(`HR-2b world refusal: ${code}`, () => {
  const fixture = world(); mutate(fixture);
  assert.ok(checkHR2bWorld(fixture).errors.some(error => error.code === code));
});

test('profile authentication rejects wrong and mixed versions and propagates HR-2b versions', async t => {
  const fixture = toyFixture();
  assert.throws(() => fixtureProfile({ facts: { version: 'future' } }), /unsupported_fixture_version/);
  fixture.corpus.version = HR2B_VERSION;
  assert.throws(() => factsView(fixture), /mixed_fixture_profiles/);
  fixture.facts.version = fixture.queries.version = fixture.labels.version = HR2B_VERSION;
  assert.equal(factsView(fixture).version, HR2B_VERSION);
  fixture.labels = buildLabels(fixture, tokenizers);
  assert.equal(fixture.labels.version, HR2B_VERSION);
  const audit = applyAudit(fixture, { overrides: [] }, tokenizers);
  assert.equal(audit.version, HR2B_VERSION);
  const result = validateFixture({ ...fixture, labels: audit, audit: { overrides: [] } }, tokenizers);
  assert.equal(result.version, HR2B_VERSION);
  assert.ok(result.errors.some(error => error.code === 'hr2b:count'));
  assert.ok(result.errors.some(error => error.code === 'hr2b:placement_quota'));
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-load-' });
  for (const key of ['facts', 'corpus']) await writeFile(join(workspace.path, `hr1-${key}.json`), jsonBytes(fixture[key]));
  assert.equal((await loadFixture(workspace.path)).version, HR2B_VERSION);
  await writeFile(join(workspace.path, 'hr1-queries.json'), jsonBytes({ version: 'hr1-fixture-v2', queries: [] }));
  await assert.rejects(loadFixture(workspace.path), /mixed_fixture_profiles/);
});

test('placement uses audited eligible members, with body before first before later across memories', () => {
  const memory = (id, state = 'current') => ({ id, state, spans: [{ id: `${id}#s1` }, { id: `${id}#s2` }] });
  const fixture = { corpus: { memories: [memory('a'), memory('b'), memory('old', 'historical')] } };
  const span = (memory, n) => ({ memory, where: 'span', spans: [`${memory}#s${n}`] });
  const members = [span('a', 2)];
  assert.equal(placementOf(fixture, members, 'current'), 'later-receipt');
  members.push(span('b', 1));
  assert.equal(placementOf(fixture, members, 'current'), 'first-receipt');
  members.push({ memory: 'b', where: 'body', spans: [] });
  assert.equal(placementOf(fixture, members, 'current'), 'body');
  assert.equal(placementOf(fixture, [span('a', 2), { memory: 'old', where: 'body', spans: [] }], 'current'), 'later-receipt');
  assert.equal(placementOf(fixture, [], 'current'), null);
  const m = fixture.corpus.memories[0]; Object.assign(m, { scale: 'S300', namespace: 'target', lang: 'en' });
  assert.deepEqual(makeMember(m, { where: 'body', span: 'a#s1' }, HR2B_VERSION).spans, []);
  assert.deepEqual(makeMember(m, { where: 'body', span: 'a#s1' }).spans, ['a#s1']);
});

test('placement quotas freeze represented guard categories and refuse every group/family/category shortage', () => {
  const queries = ['dev', 'test'].flatMap(split => Array.from({ length: 12 }, (_, i) => ({ id: `${split}${i}`, family: `f${split}${i}`, split, category: 'C1',
    groups: ['first-receipt', 'later-receipt'].flatMap(placement => Array.from({ length: 3 }, () => ({ placement }))) })));
  assert.equal(placementQuotas({ queries }).ok, true);
  assert.deepEqual(placementQuotas({ queries }).guardCategories, ['C1']);
  for (const mutate of [
    rows => { rows.filter(row => row.split === 'dev').forEach(row => { row.family = 'same'; }); },
    rows => { rows.forEach(row => { row.groups = row.groups.slice(0, 1); }); },
    rows => { rows[0].category = 'C2'; },
    rows => { rows.at(-1).category = 'C2'; },
  ]) { const rows = structuredClone(queries); mutate(rows); assert.equal(placementQuotas({ queries: rows }).ok, false); }
});

test('coordinator freezer cross-checks filesystem/Git members, prints a count and refuses an existing manifest', async t => {
  const { freezeHR2b } = await import('../tools/freeze-hr2b.mjs');
  const workspace = createTestWorkspace(t, { prefix: '.hr2-freezer-test-', parent: join(root, 'evaluation/retrieval-research/assembly') });
  const dir = join(workspace.path, 'fixture'); await mkdir(join(dir, 'build'), { recursive: true });
  await writeFile(join(dir, 'a.json'), '{}\n'); await writeFile(join(dir, 'build/b.mjs'), '// synthetic\n');
  const result = await freezeHR2b(dir);
  assert.equal(result.files, 2); assert.equal(result.gitExitCode, 0);
  const manifest = await readFile(join(dir, 'FROZEN.md'), 'utf8');
  assert.match(manifest, /a\.json/); assert.match(manifest, /build\/b\.mjs/);
  await assert.rejects(freezeHR2b(dir), /existing_manifest/);
});

test('HR-2b W3 overrides recompute placement and the frozen guard-category set', () => {
  const fact = { id: 'F', family: 'family', entities: ['KEY'], rendered: true, kind: 'fact' };
  const memories = ['a', 'b', 'c'].map((id, i) => ({ id, namespace: 'target', scale: 'S300', lang: 'en', state: 'current', content: 'KEY',
    spans: [1, 2].map(n => ({ id: `${id}#s${n}`, text: 'KEY' })),
    expresses: [{ fact: 'F', where: i === 2 ? 'body' : 'span', span: i === 2 ? null : `${id}#s${i === 0 ? 2 : 1}` }] }));
  const query = { id: 'q', family: 'family', category: 'C1', lang: 'en', intent: 'current', requiredFacts: ['F'], text: 'KEY', keyTerm: 'KEY' };
  const fixture = { facts: { version: HR2B_VERSION, facts: [fact], families: [{ id: 'family', role: 'target' }] },
    corpus: { version: HR2B_VERSION, memories }, queries: { version: HR2B_VERSION, queries: [query] }, split: { family: 'dev' } };
  fixture.labels = buildLabels(fixture, tokenizers);
  assert.equal(fixture.labels.queries[0].groups[0].placement, 'body');
  const override = memory => ({ query: 'q', action: 'remove-member', detail: { fact: 'F', memory }, reason: 'Synthetic independent audit.' });
  assert.equal(applyAudit(fixture, { overrides: [override('c')] }, tokenizers).queries[0].groups[0].placement, 'first-receipt');
  const audited = applyAudit(fixture, { overrides: [override('c'), override('b')] }, tokenizers);
  assert.equal(audited.queries[0].groups[0].placement, 'later-receipt');
  assert.deepEqual(audited.placement.guardCategories, ['C1']);
  assert.deepEqual(fixture.labels.placement.guardCategories, []);
});

test('HR-2b split CLI authenticates and emits its version with the separate deterministic seed', async t => {
  const { runCli } = await import('./fixtures-tooling/cli.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-split-cli-' }), fixture = toyFixture();
  for (const key of ['facts', 'corpus', 'queries']) {
    fixture[key].version = HR2B_VERSION;
    await writeFile(join(workspace.path, `hr1-${key}.json`), jsonBytes(fixture[key]));
  }
  const result = await runCli(workspace, ['evaluation/retrieval-research/tools/split.mjs', '--fixture', workspace.path]);
  assert.equal(result.code, 0, result.stderr);
  const split = JSON.parse(await readFile(join(workspace.path, 'hr1-split.json')));
  assert.equal(split.version, HR2B_VERSION);
  assert.equal(JSON.parse(result.stdout).seed, 'hr2b-split-v1');
  assert.equal((await loadFixture(workspace.path)).split.version, HR2B_VERSION);
});


test('legacy versionless fixture loading preserves its exact projection and hash-only facts view', async t => {
  const { sha256 } = await import('../assembly/auth.mjs');
  const workspace = createTestWorkspace(t, { prefix: 'hr2b-legacy-loader-' });
  const facts = { facts: [] }, corpus = { memories: [] }, queries = { queries: [] }, hashes = {};
  for (const [suffix, value] of Object.entries({ facts, corpus, queries })) {
    const bytes = jsonBytes(value), filename = `hr1-${suffix}.json`;
    await writeFile(join(workspace.path, filename), bytes); hashes[filename] = sha256(bytes);
  }
  const view = 'The legacy loader only hashes these bytes.\n';
  await writeFile(join(workspace.path, 'hr1-facts-view.json'), view);
  hashes['hr1-facts-view.json'] = sha256(view);
  assert.deepEqual(await loadFixture(workspace.path), { hashes, facts, corpus, queries, split: null, labels: null, audit: null });
});
