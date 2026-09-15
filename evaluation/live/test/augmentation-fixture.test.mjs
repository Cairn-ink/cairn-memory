import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { boundedText } from '../../../core/validation.mjs';
import { runMultiWindowFidelity } from '../multi-window-fidelity.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from '../installed-source-answer-delivery.mjs';

const read = name => JSON.parse(readFileSync(new URL(`../${name}.json`, import.meta.url), 'utf8'));
const fresh = () => ({ fixture: read('augmentation-fixture'), rubric: read('augmentation-rubric') });

test('augmentation cases bind six fresh bounded histories to three one-sentence commitment contrasts', () => {
  const { fixture, rubric } = fresh();
  assert.equal(fixture.id, 'bounded-augmentation-comparison-v1'); assert.equal(rubric.id, fixture.id);
  assert.equal(fixture.histories.length, 6); assert.equal(rubric.histories.length, 6);
  const sources = fixture.histories.flatMap(h => h.windows.flat());
  assert.equal(sources.length, 108); assert.equal(new Set(sources.map(s => s.id)).size, 108);
  const pairs = new Map();
  for (const history of fixture.histories) pairs.set(history.pairId, [...(pairs.get(history.pairId) ?? []), history]);
  assert.equal(pairs.size, 3);
  for (const pair of pairs.values()) {
    assert.equal(pair.length, 2); assert.equal(pair[0].question, pair[1].question);
    const left = pair[0].windows.flat(), right = pair[1].windows.flat();
    const changes = left.flatMap((source, i) => {
      assert.equal(source.role, right[i].role);
      return source.content === right[i].content ? [] : [i];
    });
    assert.equal(changes.length, 1); assert.equal(left[changes[0]].role, 'user');
    assert.deepEqual(new Set(pair.map(h => rubric.histories.find(r => r.id === h.id).expectedCommitment)), new Set(['provisional', 'committed']));
    for (const history of pair) {
      assert.equal(history.windows.length, 3);
      for (const window of history.windows) {
        assert.equal(window.length, 6);
        assert.equal(window.filter(s => s.role === 'user').length, 5);
        assert.equal(window.filter(s => s.role === 'assistant').length, 1);
        for (const source of window) assert.equal(boundedText(source.content, 800), source.content);
      }
      const label = rubric.histories.find(r => r.id === history.id), all = history.windows.flat();
      assert.equal(label.qualifierSourceId, all[changes[0]].id);
      assert.ok(label.requiredSourceIds.length > 0 && label.requiredSourceIds.length <= 6);
      const labels = [...label.requiredSourceIds, ...label.irrelevantSourceIds];
      assert.equal(new Set(labels).size, labels.length);
      assert.ok(labels.every(id => all.some(s => s.id === id)));
      assert.ok(label.requiredSourceIds.includes(label.qualifierSourceId));
      assert.equal(history.windows.filter(w => w.some(s => label.requiredSourceIds.includes(s.id))).length, 3);
      assert.equal(all.reduce((count, s) => count + s.content.split(label.qualifierQuote).length - 1, 0), 1);
    }
  }
  const previous = ['qualifier-preservation-fixture', 'multi-window-fidelity-fixture', 'checklist-selection-fixture']
    .flatMap(name => read(name).histories.flatMap(h => h.windows?.flat() ?? h.messages));
  for (const source of sources) {
    assert.ok(!previous.some(old => old.id === source.id || old.content === source.content));
    assert.ok(source.content.length <= 800);
  }
});

test('Chinese pair contains Chinese questions and source prose, not merely translated rubric labels', () => {
  const { fixture, rubric } = fresh();
  const chinese = fixture.histories.filter(h => /\p{Script=Han}/u.test(h.question));
  assert.equal(chinese.length, 2); assert.equal(chinese[0].pairId, chinese[1].pairId);
  for (const history of chinese) {
    assert.ok(history.windows.flat().every(s => /\p{Script=Han}/u.test(s.content)));
    assert.ok(/\p{Script=Han}/u.test(rubric.histories.find(r => r.id === history.id).qualifierQuote));
  }
  // Script presence is structural only. Traditional usage, genuine absent approval,
  // lexical decoys and each relevance label require separate human-meaning review.
});

test('unchanged driver validates first, retains all failure slots and never sends rubric to callbacks', async () => {
  const value = fresh(), answers = [], opens = [];
  const result = await runMultiWindowFidelity({ ...value,
    openClient: async input => { opens.push(input); throw new Error('Synthetic unavailable client'); },
    answer: async input => { answers.push(input); return 'Synthetic control observation, not a semantic score.'; } });
  assert.equal(result.status, 'observed-with-failures'); assert.equal(result.semanticStatus, 'unassessed');
  assert.equal(result.histories.flatMap(h => h.captures).length, 18);
  assert.equal(result.histories.flatMap(h => h.answers).length, 12); assert.equal(answers.length, 6);
  assert.ok(opens.length >= 6);
  for (const open of opens) {
    assert.deepEqual(Object.keys(open).sort(), ['historyId', 'phase', 'windowIndex']);
    assert.equal(open.windowIndex, 0);
  }
  for (const [i, history] of result.histories.entries()) {
    assert.equal(history.captures[0].capture.status, 'failed');
    assert.ok(history.captures.slice(1).every(c => c.status === 'not_run'));
    assert.equal(history.recall.status, 'not_run'); assert.equal(history.snapshot.status, 'not_run');
    assert.equal(history.activeAdmittedCount, null);
    const baseline = history.answers.find(a => a.sourceKind === 'retrieved'), control = history.answers.find(a => a.constructedControl);
    assert.equal(baseline.status, 'not_run'); assert.equal(baseline.constructedControl, false);
    assert.equal(control.status, 'completed'); assert.equal(control.semanticStatus, 'unassessed');
    assert.deepEqual(answers[i], { sourceKind: 'canonical-control', instructions: SOURCE_ANSWER_INSTRUCTION,
      question: value.fixture.histories[i].question, sources: value.fixture.histories[i].windows.flat() });
  }
});

test('malformed sources, pairs and oracle bindings reject before any callback', async () => {
  const mutations = [v => v.fixture.histories.pop(),
    v => { v.fixture.histories[0].windows[0][0].content = 'x'.repeat(801); },
    v => { v.fixture.histories[0].windows[0][0].content = '\ud800'; },
    v => { v.fixture.histories[0].windows[0][0].role = 'system'; },
    v => { v.fixture.histories[0].windows[0][0].id = v.fixture.histories[1].windows[0][0].id; },
    v => { v.fixture.histories[0].question += ' Different'; },
    v => { v.fixture.histories[0].windows[0][0].content += ' Another difference'; },
    v => { v.rubric.histories[0].requiredSourceIds.push('foreign'); },
    v => { v.rubric.histories[0].irrelevantSourceIds.push(v.rubric.histories[0].requiredSourceIds[0]); },
    v => { v.rubric.histories[0].qualifierQuote = 'Not present'; },
    v => { v.rubric.histories[0].expectedCommitment = 'guaranteed'; },
    v => { v.fixture.histories[0].rubric = v.rubric.histories[0]; }];
  for (const mutate of mutations) {
    const value = fresh(); mutate(value); let callbacks = 0;
    await assert.rejects(runMultiWindowFidelity({ ...value, openClient: async () => { callbacks++; }, answer: async () => { callbacks++; return 'Synthetic'; } }));
    assert.equal(callbacks, 0);
  }
});

test('callback mutation and failed constructed answer cannot alter inputs or rescue baseline failure', async () => {
  const value = fresh(), before = structuredClone(value); let answers = 0;
  const result = await runMultiWindowFidelity({ ...value, openClient: async () => { throw new Error('Synthetic failure'); },
    answer: async input => {
      assert.deepEqual(input.sources, before.fixture.histories[answers].windows.flat());
      assert.equal(input.instructions, SOURCE_ANSWER_INSTRUCTION);
      input.sources[0].content = 'Changed callback copy'; input.instructions = 'Changed'; answers++;
      if (answers === 1) throw new Error('Synthetic answer failure');
      return 'Synthetic constructed control';
    } });
  assert.deepEqual(value, before); assert.equal(answers, 6);
  assert.equal(result.histories[0].answers.find(a => a.constructedControl).status, 'failed');
  assert.ok(result.histories.every(h => h.answers.find(a => !a.constructedControl).status === 'not_run'));
});
