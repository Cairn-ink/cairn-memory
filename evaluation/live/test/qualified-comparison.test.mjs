import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../../../core/contract.mjs';
import { runQualifiedComparison, QUALIFIED_COMPARISON_CANDIDATES } from '../qualified-comparison.mjs';

// Development-only sources; no held-out file or evaluator propositions are read.
const sources = () => ({ version: 'qualified-reconciliation-holdout-v1', cases: Array.from({ length: 8 }, (_, index) => ({
  id: `Q${String(index + 1).padStart(2, '0')}`, language: index < 4 ? 'en' : 'zh',
  windows: ['first', 'second'].map((position, window) => ({ messages: [{ id: `dev-${index}-${position}`, role: 'user',
    content: index < 4 ? `Development setting ${index} is ${window ? 'blue' : 'red'}.`
      : `開發測試設定${index}是${window ? '藍色' : '紅色'}。` }] })),
  query: index < 4 ? 'What is the development setting?' : '開發測試設定是甚麼？',
})) });
const directory = () => mkdtempSync(join(tmpdir(), 'cairn-qualified-comparison-test-'));
function scripted(calls, { failExtract = false, transportFailure } = {}) {
  return { contextWindow: 100000, countTokens: () => 1,
    extract: ({ input }) => {
      calls.push({ method: 'extract', input: structuredClone(input) });
      if (transportFailure) { transportFailure(); throw Error('PRIVATE_FAILURE'); }
      if (failExtract) return { items: [{ invalid: true }] };
      return { items: input.messages.map(message => ({ content: message.content, kind: 'fact', confidence: 0.8, sourceIndices: [message.index] })) };
    },
    reconcile: ({ input }) => {
      calls.push({ method: 'reconcile', input: structuredClone(input) });
      return { transitions: [{ replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0],
        relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' }] };
    },
    classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }),
    select: ({ input }) => ({ refs: input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')
      .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }),
    rank: ({ input }) => ({ refs: input.candidates.map(candidate => ({ namespaceIndex: candidate.namespaceIndex,
      memoryId: candidate.memory.id, revision: candidate.memory.revision })) }),
  };
}
function setup(overrides = {}) {
  const calls = []; const opens = []; const checkpoints = []; const answers = [];
  const model = scripted(calls);
  const factory = options => {
    opens.push({ ...options });
    return openMemoryCore({ path: options.path, ...(options.withModel ? { model } : {}) });
  };
  const options = { sources: sources(), directory: directory(), candidates: { baseline: factory, qualified: factory },
    answer: async input => { answers.push(structuredClone(input)); return { text: 'Development-only scripted answer.' }; },
    persist: async event => { checkpoints.push(event); }, shouldHalt: () => false, ...overrides };
  return { options, calls, opens, checkpoints, answers };
}

test('paired schedule uses 16 independent SQLite arms, cold snapshots and source-only answers', async () => {
  const run = setup(); const report = await runQualifiedComparison(run.options);
  assert.equal(report.status, 'completed', JSON.stringify(report));
  assert.deepEqual(report.candidates, QUALIFIED_COMPARISON_CANDIDATES);
  assert.equal(report.arms.length, 16);
  assert.equal(run.answers.length, 16);
  assert.equal(run.calls.filter(call => call.method === 'extract').length, 32);
  assert.equal(run.opens.length, 80);
  assert.equal(run.opens.filter(open => !open.withModel).length, 32);
  assert.equal(new Set(run.opens.map(open => open.path)).size, 16);
  for (let index = 0; index < 8; index++) {
    assert.deepEqual(report.arms.slice(index * 2, index * 2 + 2).map(entry => entry.arm),
      index % 2 === 0 ? ['baseline', 'qualified'] : ['qualified', 'baseline']);
  }
  for (const entry of report.arms) {
    assert.equal(entry.status, 'completed');
    for (const window of entry.windows) {
      assert.deepEqual(window.records, window.reopenedRecords);
      assert.equal(window.sourceBindingsValid, true);
      assert.ok(Number.isFinite(window.durationMs));
    }
    assert.equal(entry.windows[1].records.filter(record => record.memory.state === 'historical').length, 1);
    assert.equal(entry.recall.result.value.memories.length, 1);
  }
  assert.ok(run.checkpoints[0].report.arms.every(entry => entry.status === 'not_run'
    && entry.windows.every(window => window.status === 'not_run') && entry.recall.status === 'not_run' && entry.answer.status === 'not_run'));
  assert.deepEqual(run.checkpoints.map(event => event.sequence), run.checkpoints.map((_, index) => index));
  assert.equal(run.checkpoints.at(-1).stage, 'final');
  assert.ok(run.answers.every(input => Object.keys(input).sort().join(',') === 'evidence,query'));
  for (const call of run.calls) {
    const encoded = JSON.stringify(call.input);
    for (const hidden of ['baseline', 'qualified', 'Q01', 'expected', 'rubric', 'namespace', 'sessionId', 'eventId']) assert.ok(!encoded.includes(hidden));
  }
});

test('closed source/config validation rejects malformed cases and evaluator fields before any work', async () => {
  const patches = [null, {}, { rubric: {} }, { answer: null }, { shouldHalt: null }];
  for (const patch of patches) {
    const run = setup(); const options = patch === null ? null : { ...run.options, ...patch };
    if (patch && !Object.keys(patch).length) options.sources = {};
    await assert.rejects(runQualifiedComparison(options), /invalid_comparison_options/);
    assert.equal(run.opens.length, 0); assert.equal(run.checkpoints.length, 0);
  }
  for (const mutate of [s => s.cases.reverse(), s => s.cases.pop(), s => s.cases[0].windows.pop(),
    s => { s.cases[0].language = 'zh'; }, s => { s.cases[0].expected = 'secret rubric'; },
    s => { s.cases[0].windows[0].messages[0].role = 'system'; },
    s => { s.cases[0].windows[0].messages = Array(1); }]) {
    const run = setup(); mutate(run.options.sources);
    await assert.rejects(runQualifiedComparison(run.options), /invalid_comparison_options/);
    assert.equal(run.opens.length, 0);
  }
  const run = setup(); run.options[Symbol('extra')] = true;
  await assert.rejects(runQualifiedComparison(run.options), /invalid_comparison_options/);
});

test('unsafe directories reject without creating databases', async () => {
  for (const mode of ['occupied', 'permissions', 'relative']) {
    const run = setup();
    if (mode === 'occupied') writeFileSync(join(run.options.directory, 'sentinel'), 'preserve');
    if (mode === 'permissions') chmodSync(run.options.directory, 0o755);
    if (mode === 'relative') run.options.directory = '.';
    await assert.rejects(runQualifiedComparison(run.options), /unsafe_comparison_directory/);
    assert.equal(run.opens.length, 0);
  }
});

test('malformed capture is retained without retries; independent scheduled arms continue', async () => {
  const run = setup(); const brokenCalls = [];
  run.options.candidates.baseline = options => openMemoryCore({ path: options.path,
    ...(options.withModel ? { model: scripted(brokenCalls, { failExtract: true }) } : {}) });
  const report = await runQualifiedComparison(run.options);
  assert.equal(report.status, 'incomplete'); assert.equal(report.arms.length, 16);
  assert.equal(brokenCalls.length, 8);
  for (const entry of report.arms.filter(entry => entry.arm === 'baseline')) {
    assert.equal(entry.status, 'incomplete'); assert.equal(entry.windows[0].capture.ok, false);
    assert.equal(entry.windows[1].status, 'not_run'); assert.equal(entry.recall.status, 'not_run'); assert.equal(entry.answer.status, 'not_run');
  }
  assert.ok(report.arms.filter(entry => entry.arm === 'qualified').every(entry => entry.status === 'completed'));
});

test('latched transport failure globally halts despite core returning a sanitized envelope', async () => {
  let halted = false; const calls = []; const run = setup({ shouldHalt: () => halted });
  run.options.candidates.baseline = options => openMemoryCore({ path: options.path,
    ...(options.withModel ? { model: scripted(calls, { transportFailure: () => { halted = true; } }) } : {}) });
  const report = await runQualifiedComparison(run.options);
  assert.equal(report.status, 'halted'); assert.equal(calls.length, 1);
  assert.equal(report.arms[0].windows[0].capture.ok, false);
  assert.ok(report.arms.slice(1).every(entry => entry.status === 'not_run'));
  assert.ok(!JSON.stringify(report).includes('PRIVATE_FAILURE'));
});

test('persistence failure stops calls, retains partial observations and is never retried', async () => {
  for (const stopAt of [0, 2]) {
    const run = setup(); let attempts = 0;
    run.options.persist = async event => { attempts++; if (event.sequence === stopAt) throw Error('PRIVATE_FAILURE'); };
    const report = await runQualifiedComparison(run.options);
    assert.equal(report.status, 'halted'); assert.equal(attempts, stopAt + 1);
    assert.ok(report.errors.some(error => error.code === 'comparison_persistence_failed'));
    assert.equal(run.calls.filter(call => call.method === 'extract').length, stopAt === 0 ? 0 : 1);
    if (stopAt) assert.ok(report.arms[0].windows[0].reopenedRecords.length);
    assert.ok(report.arms.slice(1).every(entry => entry.status === 'not_run'));
  }
});

test('answer failures preserve prior evidence and stop globally without a second answer', async () => {
  const run = setup(); let answers = 0;
  run.options.answer = async () => { answers++; throw Error('PRIVATE_FAILURE'); };
  const report = await runQualifiedComparison(run.options);
  assert.equal(report.status, 'halted'); assert.equal(answers, 1);
  assert.equal(report.arms[0].recall.status, 'completed');
  assert.equal(report.arms[0].answer.status, 'incomplete');
  assert.ok(report.arms.slice(1).every(entry => entry.status === 'not_run'));
  assert.ok(!JSON.stringify(report).includes('PRIVATE_FAILURE'));
});

test('operator prehalt and throwing factory stop globally with all scheduled identities retained', async () => {
  const run = setup({ shouldHalt: () => true });
  const report = await runQualifiedComparison(run.options);
  assert.equal(report.status, 'halted'); assert.ok(report.arms.every(entry => entry.status === 'not_run'));
  assert.equal(run.opens.length, 0); assert.deepEqual(readdirSync(run.options.directory), []);
  const broken = setup(); broken.options.candidates.baseline = () => { throw Error('PRIVATE_FAILURE'); };
  const failed = await runQualifiedComparison(broken.options);
  assert.equal(failed.status, 'halted'); assert.ok(failed.arms.slice(1).every(entry => entry.status === 'not_run'));
});

test('failed recall retains its envelope and never fabricates an answer or retries', async () => {
  const run = setup(); let selections = 0;
  run.options.candidates.baseline = options => {
    const model = scripted([]);
    model.select = () => { selections++; throw Error('PRIVATE_FAILURE'); };
    return openMemoryCore({ path: options.path, ...(options.withModel ? { model } : {}) });
  };
  const report = await runQualifiedComparison(run.options);
  assert.equal(report.status, 'incomplete'); assert.equal(selections, 8);
  for (const entry of report.arms.filter(entry => entry.arm === 'baseline')) {
    assert.equal(entry.recall.result.ok, false); assert.equal(entry.answer.status, 'not_run');
    assert.ok(entry.windows.every(window => window.status === 'completed'));
  }
  assert.equal(run.answers.length, 8);
});

test('close failure globally halts and retains capture observations', async () => {
  const run = setup();
  run.options.candidates.baseline = options => {
    const core = openMemoryCore({ path: options.path, model: scripted([]) });
    return { ...core, close: () => { core.close(); throw Error('PRIVATE_FAILURE'); } };
  };
  const report = await runQualifiedComparison(run.options);
  assert.equal(report.status, 'halted');
  assert.equal(report.arms[0].windows[0].capture.ok, true);
  assert.ok(report.arms[0].windows[0].records.length);
  assert.ok(report.arms[0].windows[0].errors.some(error => error.code === 'comparison_close_failed'));
  assert.ok(report.arms.slice(1).every(entry => entry.status === 'not_run'));
});

test('detached persistence and halted callback after intent cannot alter evidence or start model work', async () => {
  const run = setup(); let halted = false;
  run.options.shouldHalt = () => halted;
  run.options.persist = async event => {
    event.report.arms[0].namespace.ownerId = 'mutated-checkpoint';
    if (event.stage.endsWith('/before')) halted = true;
  };
  const report = await runQualifiedComparison(run.options);
  assert.equal(report.status, 'halted'); assert.equal(run.opens.length, 0);
  assert.equal(report.arms[0].namespace.ownerId, 'synthetic-qualified-comparison');
  assert.ok(report.arms[0].windows.every(window => window.status === 'not_run'));
});
