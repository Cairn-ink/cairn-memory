import assert from 'node:assert/strict';
import test from 'node:test';
import { DatabaseSync } from 'node:sqlite';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { inspectEmbeddingExperimentBudgetSnapshot } from '../../experiment-budget/index.mjs';
import { runSourceRoleAblation } from '../../source-role-ablation/operator.mjs';
import { retainedCoverage, advancementEvidence } from '../../source-role-ablation/rubric.mjs';
import { grantedFixture, fakeResponse, urls, fixtureChild, settleFixture,
  denied } from '../../experiment-budget/test/source-role-ablation-fixture.mjs';

function configured(f, fetchImpl, persistSlot = async () => {}) {
  return { ledger: f.ledger, policy: f.policy, benchmarkExtension: f.benchmarkExtension,
    sourceRoleAblationCapability: f.capability, apiKey: 'synthetic-private-key-never-report', fetchImpl, persistSlot };
}

test('N29D actual adapter executes the frozen 24 slots with 48 reserved and settled HTTP calls', async t => {
  const f = await grantedFixture(t);
  // Real explicit expected-record loading preserves identity despite canonical JSON key order.
  const expectedRecord = JSON.parse(readFileSync(path.join(f.ledger.directory,
    `experiment-source-role-extraction-${f.capability.executionId}.json`), 'utf8'));
  let calls = 0;
  const persisted = [];
  const report = await runSourceRoleAblation({ ...configured(f, async (url, options) => {
    const state = inspectEmbeddingExperimentBudgetSnapshot(f.ledger);
    assert.equal(state.requestCount, f.before.requestCount + calls + 1);
    assert.equal(state.attempts.at(-1).outcome, null, 'reserve precedes every physical send');
    assert.equal(url, calls % 2 ? urls.generation : urls.count);
    const slot = f.capability.protocol.slots[Math.floor(calls / 2)];
    assert.equal(JSON.parse(options.body).text.format.name, 'cairn_extract');
    assert.equal(slot.slot, Math.floor(calls / 2) + 1);
    calls++;
    return fakeResponse(url);
  }, async row => { persisted.push(row); assert.equal(calls, row.slot * 2); }),
  sourceRoleAblationCapability: expectedRecord });
  assert.equal(calls, 48);
  assert.deepEqual(report.counts, { completed: 24, refused: 0, not_run: 0 });
  assert.equal(report.status, 'completed');
  assert.equal(report.quality, 'unassessed');
  assert.equal(persisted.length, 24);
  assert.deepEqual(report.results.map(({ slot, ordinal, arm }) => ({ slot, ordinal, arm })),
    f.capability.protocol.slots.map(({ slot, ordinal, arm }) => ({ slot, ordinal, arm })));
  const after = inspectEmbeddingExperimentBudgetSnapshot(f.ledger);
  assert.deepEqual(after.attempts.slice(0, f.before.requestCount), f.before.attempts);
  assert.equal(after.requestCount, f.before.requestCount + 48);
  assert.equal(after.reservedMicroUsd, f.before.reservedMicroUsd + 240_000);
  assert.equal(after.attempts.slice(f.before.requestCount).filter(row => row.outcome === 'succeeded').length, 48);
  assert.equal(after.attempts.slice(f.before.requestCount).filter(row => row.actualMicroUsd === null).length, 24);
  assert.equal(JSON.stringify(report).includes('synthetic-private-key-never-report'), false);
  const coverage = report.results.map(row => retainedCoverage(row.caseOrdinal, { ...row, caps: report.protocol.caps }));
  assert.equal(coverage.length, 24);
  assert.equal(coverage.every(row => row.capsUnchanged), true);
  assert.equal(coverage.every(row => row.directRetained === 0 && row.assistantRetained === 0), true);
  assert.equal(advancementEvidence(coverage, { status: 'unknown', reviewedSlots: 0,
    baselineUnsupportedPromotions: null, candidateUnsupportedPromotions: null }).decision, 'do-not-advance');
});

const item = sourceIndices => ({ content: 'Synthetic structural control, not a semantic judgment.',
  kind: 'fact', confidence: 0.7, sourceIndices });

test('N29D atomic structural refusal can continue, preserving valid bounded source-bound interpretations', async t => {
  const f = await grantedFixture(t);
  let sends = 0;
  const report = await runSourceRoleAblation(configured(f, async url => {
    sends++;
    return fakeResponse(url, sends === 2 ? { items: [item([0]), item([999])] } : { items: [item([0])] });
  }));
  assert.equal(sends, 48);
  assert.deepEqual(report.counts, { completed: 23, refused: 1, not_run: 0 });
  assert.equal(report.status, 'completed');
  assert.deepEqual(report.results[0].items, []);
  assert.deepEqual(report.results[0].passages, []);
  assert.equal(report.results[1].items.length, 1);
  assert.equal(report.results[1].passages.length, 1);
  assert.equal(report.results[1].passages[0].index, 0);
  assert.equal(report.results[1].passages[0].excerpt, report.results[1].items[0].receipts[0].excerpt);
  assert.equal(Object.isFrozen(report.results[1].items[0]), true);
  const coverage = report.results.map(row => retainedCoverage(row.caseOrdinal, { ...row, caps: report.protocol.caps }));
  assert.equal(coverage.every(row => row.capsUnchanged), true);
  const third = coverage.find(row => row.ordinal === 3 && row.arm === 'baseline');
  assert.equal(third.directRetained, 1, 'first complete direct-event message retained, unrelated event omitted');
});

test('N29C malformed counts/usage, transport loss, HTTP failure and priced overrun stop all remaining slots', async t => {
  for (const mode of ['count', 'usage', 'transport', 'http', 'overrun']) {
    const f = await grantedFixture(t, { executionId: `halt-${mode}` });
    let sends = 0;
    const report = await runSourceRoleAblation(configured(f, async url => {
      sends++;
      if (mode === 'transport') throw new Error('synthetic-private-key-never-report');
      if (mode === 'http') return new Response('synthetic-private-key-never-report', { status: 503 });
      if (mode === 'count') return Response.json({ object: 'response.input_tokens', input_tokens: 'private-invalid-value' });
      const response = fakeResponse(url);
      if (url === urls.count) return response;
      const json = await response.json();
      if (mode === 'usage') delete json.usage;
      if (mode === 'overrun') json.usage = { input_tokens: 100_000, output_tokens: 20, total_tokens: 100_020 };
      return Response.json(json);
    }));
    assert.equal(sends, ['usage', 'overrun'].includes(mode) ? 2 : 1, mode);
    assert.equal(report.status, 'halted', mode);
    assert.equal(report.reason, mode === 'overrun' ? 'execution_halted' : 'paid_work_halted', mode);
    assert.deepEqual(report.counts, { completed: 0, refused: 1, not_run: 23 }, mode);
    assert.equal(report.results[0].persistence, 'persisted', mode);
    assert.throws(() => retainedCoverage(report.results[1].caseOrdinal,
      { ...report.results[1], caps: report.protocol.caps }), /invalid_coverage_result/,
    'not_run stays distinct and cannot enter the full24 rubric as a model refusal');
    assert.equal(JSON.stringify(report).includes('synthetic-private-key-never-report'), false, mode);
    assert.equal(JSON.stringify(report).includes('private-invalid-value'), false, mode);
    const after = inspectEmbeddingExperimentBudgetSnapshot(f.ledger);
    assert.deepEqual(after.attempts.slice(0, f.before.requestCount), f.before.attempts, mode);
    assert.equal(after.reservedMicroUsd, f.before.reservedMicroUsd + sends * 5000, mode);
    assert.equal(after.attempts.at(-1).outcome, mode === 'overrun' ? 'succeeded' : mode === 'http' ? 'failed' : 'unknown', mode);
    assert.equal(after.state, mode === 'overrun' ? 'overrun' : 'open', mode);
  }
});

test('N29F owned child failure and successful execution both remove their exact workspaces', async t => {
  const failure = await grantedFixture(t);
  const failurePath = failure.workspace.path;
  await assert.rejects(fixtureChild(failure, 'intentional-failure'), error => error.actual === 1 && error.expected === 0);
  await failure.workspace.cleanup();
  assert.equal(existsSync(failurePath), false);
  const success = await grantedFixture(t);
  const successPath = success.workspace.path;
  await fixtureChild(success, 'claim');
  await success.workspace.cleanup();
  assert.equal(existsSync(successPath), false);
});

test('N29C failed durable settlement retains pending reservation and halts without exporting storage errors', async t => {
  const f = await grantedFixture(t);
  let lock;
  let lockClosed = false;
  let sends = 0;
  f.workspace.defer(() => { if (lock && !lockClosed) { lock.close(); lockClosed = true; } });
  const report = await runSourceRoleAblation(configured(f, async url => {
    sends++;
    lock = new DatabaseSync(path.join(f.ledger.directory, 'experiment-budget.sqlite'));
    lock.exec('BEGIN IMMEDIATE');
    return fakeResponse(url);
  }));
  lock.exec('ROLLBACK');
  lock.close(); lockClosed = true;
  assert.equal(sends, 1);
  assert.deepEqual(report.counts, { completed: 0, refused: 1, not_run: 23 });
  assert.equal(report.results[0].attempts[0].outcome, null);
  const after = inspectEmbeddingExperimentBudgetSnapshot(f.ledger);
  assert.equal(after.attempts.at(-1).outcome, null);
  assert.equal(after.reservedMicroUsd, f.before.reservedMicroUsd + 5000);
  assert.equal(report.status, 'halted');
  assert.equal(JSON.stringify(report).includes('sqlite'), false);
});

test('N29E actual persistence rejection differs from successful persistence followed by history refusal', async t => {
  for (const mode of ['reject', 'postcheck']) {
    const f = await grantedFixture(t, { executionId: `persist-${mode}` });
    let sends = 0;
    let persisted = 0;
    const report = await runSourceRoleAblation(configured(f, async url => { sends++; return fakeResponse(url); },
      async row => {
        assert.equal(row.persistence, 'pending');
        if (mode === 'reject') throw new Error('synthetic-private-key-never-report');
        persisted++;
        settleFixture(f, 1, 1);
      }));
    assert.equal(sends, 2);
    assert.equal(persisted, mode === 'reject' ? 0 : 1);
    assert.equal(report.reason, mode === 'reject' ? 'persistence_failed' : 'execution_halted');
    assert.equal(report.results[0].persistence, mode === 'reject' ? 'failed' : 'persisted');
    assert.deepEqual(report.counts, { completed: 1, refused: 0, not_run: 23 });
    assert.equal(JSON.stringify(report).includes('synthetic-private-key-never-report'), false);
    await assert.rejects(runSourceRoleAblation(configured(f, async url => fakeResponse(url))),
      error => ['capability_consumed', 'policy_mismatch'].includes(error.code));
  }
});

test('N29C genuine core timer settles unknown before persistence and ignores later physical fetch completion', async t => {
  const f = await grantedFixture(t);
  assert.deepEqual(await fixtureChild(f, 'core-deadline'), { shortened: 1, sends: 1, pending: 0,
    lateChanged: false, reason: 'paid_work_halted', counts: { completed: 0, refused: 1, not_run: 23 }, cleanup: 'closed' });
});

test('N29E strict operator own-data rejects getters and implicit key/fetch or case/prompt overrides', async t => {
  const f = await grantedFixture(t);
  let getters = 0;
  const accessors = configured(f, async url => fakeResponse(url));
  Object.defineProperty(accessors, 'apiKey', { enumerable: true, get() { getters++; return 'secret'; } });
  await assert.rejects(runSourceRoleAblation(accessors), /invalid_source_role_operator/);
  assert.equal(getters, 0);
  for (const key of ['apiKey', 'fetchImpl', 'persistSlot']) {
    const missing = configured(f, async url => fakeResponse(url)); delete missing[key];
    await assert.rejects(runSourceRoleAblation(missing), /invalid_source_role_operator/);
  }
  await assert.rejects(runSourceRoleAblation({ ...configured(f, async url => fakeResponse(url)), prompt: 'override' }),
    /invalid_source_role_operator/);
  assert.equal(inspectEmbeddingExperimentBudgetSnapshot(f.ledger).requestCount, f.before.requestCount);
  const claim = path.join(f.ledger.directory, `experiment-source-role-extraction-claim-${f.capability.executionId}.json`);
  assert.equal(existsSync(claim), false);
});
