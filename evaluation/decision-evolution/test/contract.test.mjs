import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import { runDecisionEvolution, scoreDecisionEvolution, validateFixture } from '../contract.mjs';

const read = (name) => JSON.parse(readFileSync(fileURLToPath(new URL(`../${name}`, import.meta.url)), 'utf8'));
const fixture = read('fixture.json');
const rubric = read('rubric.json');
const scoredRun = () => ({ fixtureVersion: fixture.version,
  responses: rubric.expectations.map(({ caseId, questionId, state, evidence, nonFinal, reasons, updates }) => ({
    caseId, questionId, response: structuredClone({ status: 'answered', state, evidence,
      nonFinal, reasons, updates }),
  })) });
const score = (run) => scoreDecisionEvolution({ fixture, rubric, run });
const change = (questionId, mutate) => {
  const run = scoredRun();
  mutate(run.responses.find((item) => item.questionId === questionId).response);
  return score(run);
};

test('fixture has distinct bilingual dev and heldout families, source-only fields, and late ingestion', () => {
  assert.equal(validateFixture(fixture), true);
  assert.deepEqual(new Set(fixture.cases.map((item) => item.split)), new Set(['dev', 'heldout']));
  for (const split of ['dev', 'heldout']) {
    assert.deepEqual(new Set(fixture.cases.filter((item) => item.split === split)
      .map((item) => item.language)), new Set(['en', 'zh-TW']));
  }
  const late = fixture.cases.find((item) => item.id === 'heldout-late-older-en');
  assert.ok(late.events[2].occurredAt < late.events[1].occurredAt);
  assert.ok(late.events[2].ingestedAt > late.events[1].ingestedAt);
  const poisoned = structuredClone(fixture);
  poisoned.cases[0].expected = { choice: 'B' };
  assert.throws(() => validateFixture(poisoned), /invalid case/);
});

test('runner exposes only source case/question and retains unknown and incomplete callback outcomes', async () => {
  const seen = [];
  const run = await runDecisionEvolution({ fixture, split: 'dev', answer: async (input) => {
    seen.push(input);
    assert.deepEqual(Object.keys(input).sort(), ['caseId', 'events', 'language', 'question']);
    assert.ok(!JSON.stringify(input).includes('supersedes'));
    if (input.question.id === 'q1') throw new Error('synthetic callback failure');
    return { status: 'incomplete' };
  } });
  assert.equal(seen.length, 4);
  const result = score(run);
  assert.equal(result.counts.unknown, 1);
  assert.equal(result.counts.incomplete, 7); // Four reserved cases were never run.
  assert.equal(result.counts.diagnostic_pass, 0);
});

test('structural golden diagnostic is complete but is not a semantic accuracy claim', () => {
  const result = score(scoredRun());
  assert.equal(result.diagnosticOnly, true);
  assert.equal(result.counts.diagnostic_pass, 8);
  assert.equal(result.counts.diagnostic_fail, 0);
  const rearranged = scoredRun();
  rearranged.responses[0].response.state = {
    basis: 'supported', commitment: 'adopted', choice: 'B', actor: 'Maya',
  };
  assert.equal(score(rearranged).counts.diagnostic_pass, 8);
});

test('explicit update requires replacement -> predecessor, independent of ingest order', () => {
  const reversed = change('q1', (answer) => {
    answer.updates[0] = { from: 'd1', to: 'd4', type: 'supersedes' };
  });
  assert.equal(reversed.results.find((item) => item.questionId === 'q1').checks.updates, false);
  const missing = change('q8', (answer) => { answer.updates = []; });
  assert.equal(missing.results.find((item) => item.questionId === 'q8').checks.updates, false);
  const invented = change('q5', (answer) => {
    answer.updates = [{ from: 'h3', to: 'h2', type: 'supersedes' }];
  });
  assert.equal(invented.results.find((item) => item.questionId === 'q5').checks.updates, false);
});

test('tentative B is not adopted and considering is not tentative', () => {
  const adopted = change('q2', (answer) => {
    answer.state.choice = 'B';
    answer.nonFinal = [];
  });
  assert.equal(adopted.results.find((item) => item.questionId === 'q2').checks.state, false);
  assert.equal(adopted.results.find((item) => item.questionId === 'q2').checks.nonFinal, false);
  const conflated = change('q1', (answer) => { answer.nonFinal[0].stage = 'tentative'; });
  assert.equal(conflated.results.find((item) => item.questionId === 'q1').checks.nonFinal, false);
});

test('other actor may be cited but cannot supply queried actor’s reason or update', () => {
  assert.equal(score(scoredRun()).results.find((item) => item.questionId === 'q4').checks.actorScope, true);
  const wrongReason = change('q4', (answer) => { answer.reasons[0].evidence = ['d10']; });
  assert.equal(wrongReason.results.find((item) => item.questionId === 'q4').checks.actorScope, false);
  const wrongState = change('q7', (answer) => {
    answer.state.actor = 'Ivo'; answer.state.choice = 'B';
  });
  assert.equal(wrongState.results.find((item) => item.questionId === 'q7').checks.actorScope, false);
});

test('reason failure and partial challenge do not imply a new choice', () => {
  const inventedSwitch = change('q3', (answer) => {
    answer.state.choice = 'B'; answer.updates = [{ from: 'd8', to: 'd7', type: 'supersedes' }];
  });
  assert.equal(inventedSwitch.results.find((item) => item.questionId === 'q3').checks.state, false);
  assert.equal(inventedSwitch.results.find((item) => item.questionId === 'q3').checks.updates, false);
  const erasedSurvivingReason = change('q6', (answer) => {
    answer.reasons = answer.reasons.filter((reason) => reason.status !== 'active');
  });
  assert.equal(erasedSurvivingReason.results.find((item) => item.questionId === 'q6').checks.reasons, false);
});

test('absent response and explicit abstention remain separate denominators', () => {
  const run = scoredRun();
  run.responses.pop();
  run.responses[0].response = { status: 'unknown' };
  const result = score(run);
  assert.equal(result.counts.incomplete, 1);
  assert.equal(result.counts.unknown, 1);
  assert.equal(result.counts.diagnostic_pass, 6);
});
