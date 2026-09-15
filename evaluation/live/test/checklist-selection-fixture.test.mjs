import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { boundedText } from '../../../core/validation.mjs';
import { runMultiWindowFidelity } from '../multi-window-fidelity.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from '../installed-source-answer-delivery.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../${name}.json`, import.meta.url), 'utf8'));
const fresh = () => ({ fixture: read('checklist-selection-fixture'), rubric: read('checklist-selection-rubric') });

test('fresh checklist fixture has three matched pairs, bounded canonical sources and independent rubric bindings', () => {
  const { fixture, rubric } = fresh();
  assert.equal(fixture.id, 'checklist-selection-comparison-v1');
  assert.equal(rubric.id, fixture.id);
  assert.equal(fixture.histories.length, 6); assert.equal(rubric.histories.length, 6);
  const sources = fixture.histories.flatMap(history => history.windows.flat());
  assert.equal(fixture.histories.flatMap(history => history.windows).length, 18);
  assert.equal(sources.length, 108);
  assert.equal(sources.filter(source => source.role === 'user').length, 90);
  assert.equal(sources.filter(source => source.role === 'assistant').length, 18);
  assert.equal(new Set(sources.map(source => source.id)).size, 108);
  const pairs = new Map();
  for (const history of fixture.histories) {
    const pair = pairs.get(history.pairId) ?? []; pair.push(history); pairs.set(history.pairId, pair);
    for (const window of history.windows) {
      assert.equal(window.length, 6);
      assert.equal(window.filter(source => source.role === 'user').length, 5);
      assert.equal(window.filter(source => source.role === 'assistant').length, 1);
    }
    for (const source of history.windows.flat()) {
      assert.ok(source.content.length <= 800);
      assert.equal(source.content, boundedText(source.content, 800));
    }
    const label = rubric.histories.find(label => label.id === history.id);
    assert.ok(label); assert.ok(label.requiredSourceIds.length > 0 && label.requiredSourceIds.length <= 6);
    const all = [...label.requiredSourceIds, ...label.irrelevantSourceIds];
    assert.equal(new Set(all).size, all.length);
    assert.ok(all.every(id => history.windows.flat().some(source => source.id === id)));
    assert.ok(label.requiredSourceIds.includes(label.qualifierSourceId));
    assert.equal(history.windows.flat().reduce((n, source) => n + source.content.split(label.qualifierQuote).length - 1, 0), 1);
    for (const field of ['actor', 'reason', 'temporalLimit']) assert.ok(typeof label[field] === 'string' && label[field].trim());
    // These prose fields require semantic review; nonempty strings are not correctness scores.
    assert.equal(history.windows.filter(window => window.some(source => label.requiredSourceIds.includes(source.id))).length, 3);
  }
  assert.equal(pairs.size, 3);
  for (const pair of pairs.values()) {
    assert.equal(pair.length, 2); assert.equal(pair[0].question, pair[1].question);
    const first = pair[0].windows.flat(), second = pair[1].windows.flat();
    const changed = first.flatMap((source, i) => {
      assert.equal(source.role, second[i].role);
      return source.content === second[i].content ? [] : [i];
    });
    assert.equal(changed.length, 1); assert.equal(first[changed[0]].role, 'user');
    assert.deepEqual(new Set(pair.map(history => rubric.histories.find(label => label.id === history.id).expectedCommitment)),
      new Set(['provisional', 'committed']));
    for (const history of pair) assert.equal(rubric.histories.find(label => label.id === history.id).qualifierSourceId,
      history.windows.flat()[changed[0]].id);
  }
});

test('new messages and IDs do not recycle either earlier paired fixture', () => {
  const { fixture } = fresh();
  const previous = ['multi-window-fidelity-fixture', 'qualifier-preservation-fixture'].flatMap(name =>
    read(name).histories.flatMap(history => history.windows ? history.windows.flat() : history.messages));
  const oldIds = new Set(previous.map(source => source.id)), oldText = new Set(previous.map(source => source.content));
  for (const source of fixture.histories.flatMap(history => history.windows.flat())) {
    assert.ok(!oldIds.has(source.id)); assert.ok(!oldText.has(source.content));
  }
});

test('unchanged diagnostic accepts fixtures while failed opens retain every slot without capture or recall', async () => {
  const { fixture, rubric } = fresh();
  const opens = [], answers = [];
  const report = await runMultiWindowFidelity({ fixture, rubric,
    openClient: async args => { opens.push(args); throw new Error('Synthetic client unavailable'); },
    answer: async args => { answers.push(args); return 'Synthetic constructed-control observation; no semantic assessment.'; } });
  assert.equal(report.status, 'observed-with-failures'); assert.equal(report.semanticStatus, 'unassessed');
  assert.equal(report.histories.flatMap(history => history.captures).length, 18);
  assert.equal(report.histories.flatMap(history => history.answers).length, 12);
  assert.equal(answers.length, 6);
  assert.ok(opens.every(open => open.windowIndex === 0 && ['capture', 'cold'].includes(open.phase)));
  for (const [index, history] of report.histories.entries()) {
    assert.equal(history.captures[0].capture.status, 'failed');
    assert.ok(history.captures.slice(1).every(capture => capture.status === 'not_run'));
    assert.equal(history.activeAdmittedCount, null); assert.equal(history.beyondSnapshotCap, null);
    assert.equal(history.recall.status, 'not_run'); assert.equal(history.snapshot.status, 'not_run');
    const retrieved = history.answers.find(answer => answer.sourceKind === 'retrieved');
    const control = history.answers.find(answer => answer.sourceKind === 'canonical-control');
    assert.equal(retrieved.status, 'not_run'); assert.equal(retrieved.constructedControl, false);
    assert.equal(control.status, 'completed'); assert.equal(control.constructedControl, true);
    assert.equal(control.semanticStatus, 'unassessed');
    assert.deepEqual(answers[index], { question: fixture.histories[index].question, instructions: SOURCE_ANSWER_INSTRUCTION,
      sources: fixture.histories[index].windows.flat(), sourceKind: 'canonical-control' });
    assert.ok(history.errors.length > 0);
  }
});

test('malformed comparison cases fail the existing validator before any injected callback', async () => {
  const mutations = [({ fixture }) => { fixture.histories.pop(); },
    ({ fixture }) => { fixture.histories[0].windows[0][0].content = 'x'.repeat(801); },
    ({ fixture }) => { fixture.histories[0].windows[0][0].content = '\ud800'; },
    ({ fixture }) => { fixture.histories[0].windows[0][0].content = '  Noncanonical source  '; },
    ({ fixture }) => { fixture.histories[0].windows[0][0].role = 'system'; },
    ({ fixture }) => { fixture.histories[0].windows[0][1].id = fixture.histories[0].windows[0][0].id; },
    ({ fixture }) => { fixture.histories[0].question += ' Changed paired question'; },
    ({ fixture }) => { fixture.histories[0].windows[0][1].content += ' Another difference.'; },
    ({ fixture }) => { fixture.histories[0].windows[1] = Array(6); },
    ({ rubric }) => { rubric.histories[0].requiredSourceIds.push('foreign-source'); },
    ({ rubric }) => { rubric.histories[0].irrelevantSourceIds.push(rubric.histories[0].requiredSourceIds[0]); },
    ({ rubric }) => { rubric.histories[0].qualifierQuote = 'Not in this source'; },
    ({ rubric }) => { rubric.histories[0].expectedCommitment = 'certain'; },
    ({ fixture, rubric }) => { fixture.histories[0].rubric = rubric.histories[0]; }];
  for (const mutate of mutations) {
    const value = fresh(); mutate(value); let callbacks = 0;
    await assert.rejects(runMultiWindowFidelity({ ...value,
      openClient: async () => { callbacks++; throw new Error('Must validate first'); },
      answer: async () => { callbacks++; return 'Must validate first'; } }));
    assert.equal(callbacks, 0);
  }
});

test('constructed controls remain detached from callback mutation and cannot rescue client failure', async () => {
  const value = fresh(), before = structuredClone(value);
  let controls = 0;
  const report = await runMultiWindowFidelity({ ...value, openClient: async () => { throw new Error('Synthetic unavailable client'); },
    answer: async args => {
      assert.deepEqual(args.sources, before.fixture.histories[controls].windows.flat());
      controls++; args.sources[0].content = 'Mutated callback copy'; args.instructions = 'Changed callback instructions';
      if (controls === 1) throw new Error('Synthetic answer failure');
      return 'Synthetic answer, not a fidelity score';
    } });
  assert.deepEqual(value, before); assert.equal(controls, 6);
  assert.equal(report.histories[0].answers.find(answer => answer.constructedControl).status, 'failed');
  assert.ok(report.histories.every(history => history.answers.find(answer => !answer.constructedControl).status === 'not_run'));
  assert.equal(report.status, 'observed-with-failures');
});
