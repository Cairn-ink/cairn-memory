import test from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import { readFile } from 'node:fs/promises';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { loadFixture, armDocuments, armQueries, eligibleMemory, writeJson } from '../lib/fixture.mjs';
import { factsView } from '../tools/facts-view.mjs';
import { assignSplit, splitSummary, splitViolations } from '../tools/split.mjs';
import { buildLabels, categoryChecks, refreshLabel } from '../tools/labels.mjs';
import { applyAudit } from '../tools/apply-audit.mjs';
import { validateFixture, publicApiPreflight } from '../tools/validate.mjs';
import { toyFixture, tokenizers } from './fixtures-tooling/toy.mjs';
import { runCli } from './fixtures-tooling/cli.mjs';

test('facts view allowlist excludes every memory ID, corpus body and span text', () => {
  const fixture = toyFixture();
  fixture.corpus.memories[0].secret = 'PRIVATE_CORPUS_SENTINEL';
  const view = factsView(fixture), text = JSON.stringify(view);
  for (const memory of fixture.corpus.memories) {
    assert.equal(text.includes(memory.id), false);
    assert.equal(text.includes(memory.content), false);
    for (const span of memory.spans) assert.equal(text.includes(span.text), false);
  }
  assert.equal(text.includes('PRIVATE_CORPUS_SENTINEL'), false);
  assert.equal(view.facts.some(fact => fact.id.startsWith('extra-')), false);
  const span = view.facts.find(fact => fact.id === 'new-12');
  assert.equal(span.actualCoverage, 'span-only'); assert.equal(span.memoryCount, 1);
  assert.equal(view.facts.find(fact => fact.id === 'absent-0').actualCoverage, 'absent');
});

test('loadFixture hashes bytes; early pipeline and facts-view CLI use an owned workspace', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-tools-' }), fixture = toyFixture();
  await writeJson(join(workspace.path, 'hr1-facts.json'), fixture.facts);
  await writeJson(join(workspace.path, 'hr1-corpus.json'), fixture.corpus);
  const loaded = await loadFixture(workspace.path);
  assert.equal(loaded.queries, null); assert.equal(Object.keys(loaded.hashes).length, 2);
  assert.match(loaded.hashes['hr1-corpus.json'], /^[a-f0-9]{64}$/);
  const command = await runCli(workspace, ['evaluation/retrieval-research/tools/facts-view.mjs', '--fixture', workspace.path]);
  assert.equal(command.code, 0, command.stderr);
  assert.equal(JSON.parse(command.stdout).ok, true);
  assert.deepEqual(JSON.parse(await readFile(join(workspace.path, 'hr1-facts-view.json'), 'utf8')), factsView(fixture));
});

test('all fixture CLIs work with W4b tokenizers; validator prints JSON and exits 0 only on pass', async t => {
  const workspace = createTestWorkspace(t, { prefix: 'hr1-pipeline-' }), fixture = toyFixture();
  for (const [key, suffix] of Object.entries({ facts: 'facts', corpus: 'corpus', queries: 'queries', audit: 'label-audit' })) {
    await writeJson(join(workspace.path, `hr1-${suffix}.json`), fixture[key]);
  }
  for (const tool of ['facts-view', 'split', 'labels', 'apply-audit', 'validate']) {
    const command = await runCli(workspace, [`evaluation/retrieval-research/tools/${tool}.mjs`, '--fixture', workspace.path]);
    assert.equal(command.code, 0, `${tool}: ${command.stderr} ${command.stdout}`);
    assert.equal(JSON.parse(command.stdout).ok, true, tool);
  }
  const loaded = await loadFixture(workspace.path);
  assert.equal(Object.keys(loaded.hashes).length, 7);
  loaded.corpus.memories[0].content = 'x'.repeat(4001);
  await writeJson(join(workspace.path, 'hr1-corpus.json'), loaded.corpus);
  const failed = await runCli(workspace, ['evaluation/retrieval-research/tools/validate.mjs', '--fixture', workspace.path]);
  assert.equal(failed.code, 1); assert.equal(JSON.parse(failed.stdout).ok, false);
});

test('arm projections enforce namespace, scale, lifecycle, explicit spans and the evaluator-input barrier', () => {
  const fixture = toyFixture();
  const documents = armDocuments(fixture, { namespace: 'target', scale: 'S300', intent: 'current', include: 'body' });
  assert.equal(documents.length, 280);
  for (const doc of documents) assert.deepEqual(Object.keys(doc).sort(), ['docId', 'kind', 'memoryId', 'text']);
  assert.equal(documents[0].memoryId, fixture.corpus.memories[1].id);
  assert.equal(armDocuments(fixture, { namespace: 'target', scale: 'S300', intent: 'history', include: 'both' }).length, 600);
  assert.equal(armDocuments(fixture, { namespace: 'target', scale: 'S1000', intent: 'history', include: 'spans' }).length, 1000);
  assert.equal(armDocuments(fixture, { namespace: 'foreign', scale: 'S1000', intent: 'history', include: 'body' }).length, 100);
  for (const memory of [{ state: 'historical' }, { state: 'awaiting-review' }, { state: 'current', awaitingReview: true }]) {
    assert.equal(eligibleMemory(memory, 'current'), false); assert.equal(eligibleMemory(memory, 'history'), true);
  }
  for (const memory of [{ state: 'deleted' }, { deleted: true }, { deletedAt: 'now' }]) assert.equal(eligibleMemory(memory, 'history'), false);
  assert.equal(eligibleMemory({ state: 'rejected' }, 'current'), true);
  assert.throws(() => armDocuments(fixture, { namespace: 'target', scale: 'S3', intent: 'current', include: 'body' }), /invalid_scale/);
  const queries = armQueries(fixture, { split: 'test', categories: ['C1'] });
  assert.equal(queries.length, 14); assert.deepEqual(Object.keys(queries[0]).sort(), ['intent', 'queryId', 'text']);
  fixture.labels.queries.find(label => label.id === queries[0].queryId).dropped = true;
  assert.equal(armQueries(fixture, { split: 'test', categories: ['C1'] }).length, 13);
});

test('family split is seeded, input-order independent and respects every quota', () => {
  const queries = toyFixture().queries.queries;
  const assignment = assignSplit(queries, { seed: 17 });
  assert.deepEqual(assignSplit([...queries].reverse(), { seed: 17 }), assignment);
  assert.deepEqual(assignSplit(queries, { seed: 17 }), assignment);
  assert.notDeepEqual(assignSplit(queries, { seed: 18 }), assignment);
  assert.deepEqual(splitViolations(splitSummary(queries, assignment)), []);
  assert.throws(() => assignSplit(queries.map(query => ({ ...query, family: 'one-family' }))), /split_infeasible/);
  assert.throws(() => assignSplit(queries, { maxNodes: 1 }), /split_search_limit/);
});

test('join produces one eligible group per fact, group fidelity, per-member overlaps and real hard negatives', () => {
  const fixture = toyFixture();
  const current = fixture.labels.queries.find(label => label.id === 'q-C6-00');
  const history = fixture.labels.queries.find(label => label.id === 'q-C6-01');
  assert.equal(current.groups.length, 2); assert.equal(history.groups.length, 3);
  const span = fixture.labels.queries.find(label => label.id === 'q-C1-12');
  assert.equal(span.groups[0].fidelity, 'span-only'); assert.equal(span.groups[0].members[0].where, 'span');
  assert.equal(span.overlap[0].T1.count > 0, true); assert.equal(span.overlap[0].T1Plus.count > 0, true);
  assert.equal(current.hardNegatives.length > 0, true);
  const requiredIds = new Set(current.groups.flatMap(group => group.members.map(member => member.memory)));
  assert.equal(current.hardNegatives.some(id => requiredIds.has(id)), false);
  assert.equal(fixture.labels.queries.every(label => label.checks[label.category].pass === true), true);
  assert.equal(span.checks.C1.witnesses[0].members[0].where, 'span');
  assert.equal(fixture.labels.queries.find(label => label.id === 'q-C2-00').checks.C2.witnesses[0].members[0].where, 'body');
});

test('C1/C2 search authorized supporting text; C2 requires a longer contiguous Han run', () => {
  const fixture = toyFixture(), query = fixture.queries.queries.find(query => query.id === 'q-C2-00');
  const label = fixture.labels.queries.find(label => label.id === query.id), memory = fixture.corpus.memories.find(memory => memory.id === label.groups[0].members[0].memory);
  memory.spans[0].text = 'other supporting wording';
  memory.content = '觀測';
  assert.equal(categoryChecks(fixture, query, label).C2.pass, false);
  memory.content = 'different body';
  assert.equal(categoryChecks(fixture, query, label).C1.pass, false);
  memory.content = '新的觀測方案';
  assert.equal(categoryChecks(fixture, query, label).C2.pass, true);
});

test('C1/C2 accept a span-only alternative in a body-covered group and retain every supporting span', () => {
  const fixture = toyFixture(), query = fixture.queries.queries.find(query => query.id === 'q-C2-00');
  const body = fixture.corpus.memories.find(memory => memory.expresses.some(expression => expression.fact === 'new-0'));
  body.content = 'A paraphrased decision'; body.spans[0].text = 'A paraphrased source';
  const alternative = fixture.corpus.memories.find(memory => memory.expresses.some(expression => expression.fact === 'near-0'));
  alternative.content = 'A separate paraphrased note'; alternative.spans[0].text = 'first support without the distinctive wording';
  alternative.spans.push({ ...alternative.spans[0], id: `${alternative.id}#s2`, text: 'KEY_shared 新的觀測方案' });
  alternative.expresses.push(...alternative.spans.map(span => ({ fact: 'new-0', where: 'span', span: span.id })));
  const labels = buildLabels(fixture, tokenizers);
  for (const id of ['q-C1-00', query.id]) {
    const label = labels.queries.find(label => label.id === id), member = label.groups[0].members.find(member => member.memory === alternative.id);
    assert.equal(label.groups[0].fidelity, 'body-covered'); assert.equal(label.checks[label.category].pass, true);
    assert.deepEqual(member.spans, alternative.spans.map(span => span.id)); assert.equal(Object.hasOwn(member, 'span'), false);
    assert.equal(label.checks[label.category].witnesses[0].members.some(witness => witness.memory === alternative.id && witness.span === alternative.spans[1].id), true);
  }
  const before = labels.queries.find(label => label.id === query.id);
  const audited = applyAudit({ ...fixture, labels }, { overrides: [
    { query: query.id, action: 'remove-member', detail: { fact: 'new-0', memory: alternative.id }, reason: 'Recheck the alternative.' },
    { query: query.id, action: 'add-member', detail: { fact: 'new-0', memory: alternative.id, where: 'span', spans: alternative.spans.map(span => span.id) }, reason: 'Both spans independently support the fact.' },
  ] }, tokenizers).queries.find(label => label.id === query.id);
  assert.deepEqual(audited.groups, before.groups); assert.equal(audited.checks.C2.pass, true);
});

test('public API preflight rejects duplicate bodies within a namespace as fixture incompatibilities', () => {
  const fixture = toyFixture(), [first, second] = fixture.corpus.memories;
  second.content = first.content;
  const result = validateFixture(fixture, tokenizers);
  assert.equal(result.ok, false);
  assert.equal(result.errors.some(error => error.code === 'fixture_incompatibility:duplicate_body'), true);
  assert.equal(result.statistics.publicApi.incompatibilities.some(item => item.memories?.includes(first.id) && item.memories.includes(second.id)), true);
  const foreign = structuredClone(second); foreign.id = 'foreign-copy'; foreign.namespace = 'foreign'; foreign.scale = 'foreign'; foreign.state = 'current';
  foreign.spans = foreign.spans.map((span, i) => ({ ...span, id: `${foreign.id}#s${i + 1}` }));
  assert.equal(publicApiPreflight([{ ...first, state: 'current' }, foreign]).ok, true);
  second.content = `  ${first.content.toUpperCase()}  `;
  assert.equal(publicApiPreflight([first, second]).incompatibilities[0].code, 'duplicate_body');
  assert.equal(publicApiPreflight([{ ...first, content: '\u0000' }]).incompatibilities[0].code, 'public_admission_rejected');
});

test('category checks reject invalid C3–C8 and FOREIGN structures', () => {
  for (const [category, mutate] of [
    ['C3', (fixture, query) => { query.lang = 'en'; }],
    ['C4', (fixture, query) => { query.lang = 'en'; }],
    ['C5', (fixture, query) => { query.requiredFacts = query.requiredFacts.slice(0, 1); }],
    ['C6', (fixture, query) => { fixture.facts.facts.find(fact => fact.id === 'reason-0').reasonFor = 'old-0'; }],
    ['C7', (fixture, query) => { fixture.corpus.memories.filter(memory => memory.expresses.some(expression => ['near-0', 'cross-0', 'reason-0'].includes(expression.fact))).forEach(memory => { memory.scale = 'S1000-extra'; }); }],
    ['C8', (fixture, query) => { fixture.facts.facts.find(fact => fact.id === query.requiredFacts[0]).rendered = true; }],
    ['FOREIGN', (fixture, query) => { fixture.facts.families.find(family => family.id === query.family).role = 'target'; }],
  ]) {
    const fixture = toyFixture(), query = fixture.queries.queries.find(query => query.category === category);
    mutate(fixture, query);
    const label = buildLabels(fixture, tokenizers).queries.find(label => label.id === query.id);
    assert.equal(label.checks[category].pass, false, category);
  }
});

test('C5 rejects a single eligible memory expressing every required fact', () => {
  const fixture = toyFixture(), query = fixture.queries.queries.find(query => query.id === 'q-C5-00');
  const memory = fixture.corpus.memories.find(memory => memory.expresses.some(expression => expression.fact === query.requiredFacts[0]));
  memory.expresses.push({ fact: query.requiredFacts[1], where: 'body', span: memory.spans[0].id });
  assert.equal(buildLabels(fixture, tokenizers).queries.find(label => label.id === query.id).checks.C5.pass, false);
});

test('audit supports all six actions, keeps the original and reasons, and refreshes checks', () => {
  const fixture = toyFixture(), id = 'q-C1-00';
  const label = fixture.labels.queries.find(label => label.id === id), support = label.groups[0].members[0].memory;
  const negative = label.hardNegatives[0];
  const overrides = [
    { query: id, action: 'remove-member', detail: { fact: 'new-0', memory: support }, reason: 'Adjudicate support.' },
    { query: id, action: 'add-member', detail: { fact: 'new-0', memory: support, where: 'body' }, reason: 'Restore valid support.' },
    { query: id, action: 'remove-hard-negative', detail: { memory: negative }, reason: 'Recheck near miss.' },
    { query: id, action: 'add-hard-negative', detail: { memory: negative }, reason: 'Confirmed same entity.' },
    { query: id, action: 'recategorize', detail: { category: 'C7' }, reason: 'Near miss category.' },
    { query: id, action: 'drop-query', detail: {}, reason: 'Independent audit removal.' },
  ];
  const before = structuredClone(fixture.labels), audited = applyAudit(fixture, { overrides }, tokenizers);
  assert.deepEqual(audited.original, before); assert.deepEqual(fixture.labels, before);
  const result = audited.queries.find(label => label.id === id);
  assert.equal(result.dropped, true); assert.equal(result.category, 'C7'); assert.equal(result.audit.length, 6); assert.equal(result.checks.C7.pass, true);
  assert.throws(() => applyAudit(fixture, { overrides: [{ ...overrides[0], reason: ' ' }] }, tokenizers), /audit_reason_required/);
  assert.throws(() => applyAudit(fixture, { overrides: [{ ...overrides[1] }] }, tokenizers), /invalid_add_member/);
  assert.throws(() => applyAudit({ ...fixture, labels: audited }, { overrides: [] }, tokenizers), /already_applied/);
});

test('full validator passes a complete toy fixture and independently detects stale labels', () => {
  const fixture = toyFixture(), summary = validateFixture(fixture, tokenizers);
  assert.equal(summary.ok, true, JSON.stringify(summary.errors));
  assert.equal(summary.statistics.spanOnlyGroupShare, 0.4);
  assert.equal(summary.statistics.byNamespaceScale['target:S1000'].count, 1000);
  const view = factsView(fixture); view.memories = fixture.corpus.memories;
  assert.equal(validateFixture(fixture, tokenizers, { view }).errors.some(error => error.code === 'facts_view:generated_mismatch'), true);
  fixture.labels.queries[0].overlap[0].T1.count++;
  assert.equal(validateFixture(fixture, tokenizers).errors.some(error => error.code === 'labels:join_or_audit_mismatch'), true);
});

test('validator enforces schema/references, quotas, languages, fidelity, spans, extras and foreign duplicates', () => {
  const cases = [
    ['memory:content', fixture => { fixture.corpus.memories[0].content = 'x'.repeat(4001); }],
    ['expression:fact', fixture => { fixture.corpus.memories[0].expresses[0].fact = 'nonexistent'; }],
    ['span:metadata', fixture => { fixture.corpus.memories[0].spans[0].text = 'x'.repeat(801); }],
    ['memory:span_count', fixture => { fixture.corpus.memories[0].spans = []; }],
    ['split:C1:query_quota', fixture => { fixture.split['fam-6'] = 'dev'; fixture.split['fam-7'] = 'dev'; fixture.split['fam-8'] = 'dev'; }],
    ['corpus:language_distribution', fixture => { fixture.corpus.memories.filter(memory => memory.scale === 'S1000-extra').forEach(memory => { memory.lang = 'zh'; }); }],
    ['groups:span_only_band', fixture => { fixture.labels.queries.forEach(label => label.groups.forEach(group => group.members.forEach(member => { member.where = 'body'; }))); }],
    ['extras:length_match', fixture => { fixture.corpus.memories.filter(memory => memory.scale === 'S1000-extra').forEach(memory => { memory.content = 'x'; }); }],
    ['extras:template_share', fixture => { fixture.corpus.memories.filter(memory => memory.scale === 'S1000-extra').forEach(memory => { memory.authoring = 'template'; }); }],
    ['foreign:no_rendered_near_duplicate', fixture => { fixture.facts.facts.forEach(fact => { fact.nearDuplicateOf = null; }); }],
    ['queries:C4_balanced_directions', fixture => { fixture.queries.queries.filter(query => query.category === 'C4').forEach(query => { query.lang = 'zh'; }); }],
    ['category:check_failed', fixture => { fixture.labels.queries.find(label => label.category === 'C1').checks.C1.pass = false; }],
    ['spans:distribution_match', fixture => { fixture.corpus.memories.filter(memory => memory.id.startsWith('opaque-02')).forEach(memory => { memory.spans.push({ ...memory.spans[0], id: `${memory.id}#s2` }); }); }],
  ];
  for (const [code, mutate] of cases) {
    const fixture = toyFixture(); mutate(fixture);
    const result = validateFixture(fixture, tokenizers);
    assert.equal(result.ok, false, code); assert.equal(result.errors.some(error => error.code === code), true, `${code}: ${JSON.stringify(result.errors)}`);
  }
  for (const malformed of [{}, { facts: { families: [null] } }, { corpus: { memories: [null] } }]) assert.equal(validateFixture(malformed, tokenizers).ok, false);
});

test('audited labels must pass category checks again and overrides cannot hide quota loss', () => {
  const fixture = toyFixture();
  const query = fixture.queries.queries.find(query => query.id === 'q-C1-00');
  fixture.audit = { overrides: [{ query: query.id, action: 'recategorize', detail: { category: 'C4' }, reason: 'Intentional invalid audit for test.' }] };
  fixture.labels = applyAudit(fixture, fixture.audit, tokenizers);
  const summary = validateFixture(fixture, tokenizers);
  assert.equal(summary.errors.some(error => error.code === 'labels:join_or_audit_mismatch'), false);
  assert.equal(summary.errors.some(error => error.code === 'category:check_failed'), true);
  assert.equal(summary.errors.some(error => error.code === 'queries:category_total'), true);
  const label = fixture.labels.queries.find(label => label.id === query.id);
  refreshLabel(fixture, query, label, tokenizers);
  assert.equal(label.checks.C4.pass, false);
});
