import assert from 'node:assert/strict';
import test from 'node:test';
import { runOfflinePublicDemo } from '../public-demo.mjs';

test('OI1 prepared v2 → actual core → source-only three arms → isolated official-style judge', async () => {
  const result = await runOfflinePublicDemo();
  assert.equal(result.synthetic, true);
  assert.deepEqual(result.run.arms.map(arm => arm.name), ['cairn', 'full-history', 'no-memory']);
  assert.ok(result.run.arms.every(arm => arm.status === 'completed'));
  assert.deepEqual(result.run.arms.map(arm => arm.answer.text), ['Friday', 'Friday', 'I do not know']);
  const seen = result.observed;
  assert.ok(seen.extract.length > 0);
  assert.ok(seen.select.length > 0);
  assert.ok(seen.rank.length > 0);
  assert.equal(seen.answer.length, 3);
  assert.equal(seen.judge.length, 3);
  assert.ok(seen.stages.lastIndexOf('answer') < seen.stages.indexOf('judge'));
  assert.doesNotMatch(JSON.stringify(seen.answer), /GENERATED_SUMMARY_POISON|PRIVATE_LABEL|reference_answer|answer_session_ids/u);
  assert.doesNotMatch(JSON.stringify(seen.rank), /GENERATED_SUMMARY_POISON/u);
  assert.doesNotMatch(JSON.stringify(seen.extract), /What is the current launch day|2026\/09\/03/u);
  assert.match(JSON.stringify(seen.select), /2026\/09\/03/u);
  for (const request of seen.answer) {
    assert.equal(request.model, 'scripted-answer-only');
    assert.deepEqual(JSON.parse(request.messages[1].content).question,
      { text: result.question.text, date: result.question.date });
  }
  assert.equal(JSON.parse(seen.answer[2].messages[1].content).evidence.length, 0);
  assert.deepEqual(JSON.parse(seen.answer[1].messages[1].content).evidence,
    result.history.sessions.map(session => ({ sessionIndex: session.session_index,
      sessionId: session.session_id, date: session.date,
      turns: session.turns.map(({ role, content }) => ({ role, content })) })));
  assert.equal(seen.judge[0].model, 'gpt-4o-2024-08-06');
  assert.equal(seen.judge[0].max_tokens, 10);
  assert.deepEqual(result.score.arms.map(arm => arm.judgment.correct), [true, true, false]);
  assert.deepEqual(result.score.arms.map(arm => arm.referenceSessionCoverage.packed.rate), [1, 1, 0]);
  assert.equal(result.aggregate.fixedCaseCount, 1);
  assert.equal(result.aggregate.arms.cairn.overall.coverage, 1);
  assert.equal(result.aggregate.arms['no-memory'].overall.accuracy, 0);
});
