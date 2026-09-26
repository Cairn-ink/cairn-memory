import assert from 'node:assert/strict';
import test from 'node:test';
import { setImmediate } from 'node:timers/promises';

import { prepareMixedComparison } from '../mixed-generation.mjs';
import { packMixedAnswer } from '../mixed-answer.mjs';
import { officialJudgeRequest } from '../official-scoring.mjs';
import { completionOnce, trackedTransport } from '../mixed-transport.mjs';
import { sourceRow, syntheticMixedFixture } from '../testing/mixed-fixture.mjs';

const descriptors = () => ({ nativeArtifact: { sourceTreeSha256: '1'.repeat(64),
  dependencyLockSha256: '2'.repeat(64) },
nativeConfiguration: { configurationSha256: '3'.repeat(64), configuration: {} },
cairnRuntimeArtifactSha256: '4'.repeat(64) });

test('M2/M3 source-only preparation freezes exact public projection and fixed roster', () => {
  const row = sourceRow();
  const result = prepareMixedComparison({ sourceCases: [row], armOrders: [['mem0', 'cairn']],
    ...descriptors() });
  assert.deepEqual(Object.keys(result), ['schemaVersion', 'manifest', 'roster', 'counts', 'preflight']);
  assert.equal(result.counts.fixedN, 1);
  assert.deepEqual(result.counts.batchCounts, [1]);
  assert.equal(result.preflight[0].status, 'ready');
  assert.deepEqual(result.roster[0].armOrder, ['mem0', 'cairn']);
  assert.equal(Object.isFrozen(result.roster[0].arms[0]), true);
  row.question.text = 'caller mutation after preparation';
  assert.equal(result.preflight[0].status, 'ready');
});

test('M2 duplicate IDs, evaluator labels, getters and overwidth arrays reject pre-work', () => {
  const row = sourceRow();
  assert.throws(() => prepareMixedComparison({ sourceCases: [row, row],
    armOrders: [['cairn', 'mem0'], ['mem0', 'cairn']], ...descriptors() }),
  { code: 'invalid_source_cases' });
  assert.throws(() => prepareMixedComparison({ sourceCases: [{ ...row, answer: 'label' }],
    armOrders: [['cairn', 'mem0']], ...descriptors() }), { code: 'invalid_source_cases' });
  const getter = { ...row, question: { ...row.question } };
  Object.defineProperty(getter.question, 'text', { enumerable: true,
    get() { assert.fail('getter must not run'); } });
  assert.throws(() => prepareMixedComparison({ sourceCases: [getter],
    armOrders: [['cairn', 'mem0']], ...descriptors() }), { code: 'invalid_source_cases' });
  const extra = [row]; extra.extra = 1;
  assert.throws(() => prepareMixedComparison({ sourceCases: extra,
    armOrders: [['cairn', 'mem0']], ...descriptors() }), { code: 'invalid_source_cases' });
});

test('M2/P errors become fixed-N preflight failure after valid identity', () => {
  const row = sourceRow();
  row.history.sessions[0].date = '2025/01/01 (Wed) 09:00';
  const result = prepareMixedComparison({ sourceCases: [row],
    armOrders: [['cairn', 'mem0']], ...descriptors() });
  assert.equal(result.counts.fixedN, 1);
  assert.equal(result.preflight[0].status, 'failed');
  assert.equal(result.preflight[0].caseDigest, null);
  assert.equal(result.counts.batchCounts[0], 0);
});

for (const [stage, deadlineMs] of [['answer', 180_000], ['judge', 60_000]]) {
  test(`M7c real X ${stage} deadline owns timeout without competing runner timer`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    let started;
    const entered = new Promise(resolve => { started = resolve; });
    let releasePhysical;
    let dispatches = 0;
    const fixture = syntheticMixedFixture(t, { artifact: descriptors().nativeArtifact,
      configuration: descriptors().nativeConfiguration,
      sourceCases: [sourceRow()], armOrders: [['cairn', 'mem0']],
      fetchImpl: () => { dispatches++; started();
        return new Promise(resolve => { releasePhysical = resolve; }); } });
    const guard = fixture.guard;
    t.after(() => guard.close());
    const schedule = guard.mixedSourcePairCapability.schedule;
    if (stage === 'judge') {
      for (const item of schedule.slice(0, 2)) {
        const result = await guard.withCaseScope({ phase: item.phase, caseId: item.caseId },
          async () => null);
        assert.equal(result.status, 'completed');
      }
    }
    const item = stage === 'answer' ? schedule[0] : schedule[2];
    const identity = { phase: item.phase, caseId: item.caseId };
    const request = stage === 'answer'
      ? packMixedAnswer({ question: { text: 'Synthetic?', date: '2024-01-02 10:00' },
        units: [], countTokens: () => 10 }).request
      : officialJudgeRequest('Synthetic reference and response?');
    const work = guard.withCaseScope(identity, async () => {
      const transport = trackedTransport();
      try {
        await assert.rejects(completionOnce({ guard, stage, request,
          apiKey: 'synthetic-only', timeoutMs: stage === 'answer' ? 200_000 : deadlineMs,
          transport }));
      } finally { await transport.drain(); }
    });
    await entered;
    t.mock.timers.tick(deadlineMs);
    const outcome = await work;
    assert.equal(outcome.status, 'failed');
    assert.equal(outcome.reason, 'deadline');
    assert.equal(guard.isHalted(), false);
    const attempt = guard.attempts().at(-1);
    assert.equal(attempt.stage, stage);
    assert.equal(attempt.outcome, 'unknown');
    assert.equal(attempt.actualMicroUsd, null);
    assert.ok(attempt.reservedMicroUsd > 0);
    const settledAttempts = guard.attempts();
    const settledScopes = guard.caseOutcomes().scopes;
    releasePhysical(Response.json({ object: 'chat.completion', model: request.model,
      choices: [{ index: 0, finish_reason: 'stop', message: { role: 'assistant', content: 'yes' } }],
      usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 } }));
    await setImmediate();
    assert.deepEqual(guard.attempts(), settledAttempts);
    assert.deepEqual(guard.caseOutcomes().scopes, settledScopes);
    assert.equal(dispatches, 1);
  });
}
