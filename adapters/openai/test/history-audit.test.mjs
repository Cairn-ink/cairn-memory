import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { historyCases, historyVersion } from '../../../evaluations/history-cases.mjs';
import { historyRubric } from '../../../evaluations/history-rubric.mjs';
import { runHistoryAudit } from '../../../evaluations/history-runner.mjs';
import { scoreHistoryAudit } from '../../../evaluations/history-score.mjs';

const directory = () => mkdtempSync(join(tmpdir(), 'cairn-history-offline-'));
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });

// Handwritten scripts exercise the actual core, not a provider or semantic judge.
function scriptedModel({ failExtraction = null, failRecall = false } = {}) {
  const calls = [];
  const diagnostics = [];
  let extraction = 0;
  return {
    calls,
    diagnostics,
    onDiagnostic: event => diagnostics.push(event),
    contextWindow: 100_000,
    countTokens: () => 1,
    async extract({ input }) {
      calls.push({ method: 'extract', input: structuredClone(input) });
      extraction++;
      if (extraction === failExtraction) throw new Error('scripted extraction failure');
      const messages = input.messages;
      const item = (content, index) => ({ content, kind: 'fact', confidence: 1, sourceIndices: [index] });
      if (messages.length === 8) return { items: [item('Harbor review is now Monday.', 5)] };
      if (messages.length === 24) return { items: [0, 11, 23].map(index => item(messages[index].content, index)) };
      if (messages.length === 5) return { items: [item('Harbor uses Go.', 0), item('Juniper uses Python.', 0),
        item('Harbor adopted SQLite.', 3), item('SQLite deployment completion is unknown.', 4)] };
      if (messages[0].content.startsWith('Could')) return { items: [] };
      if (messages[0].content.startsWith('Confirmed')) return { items: [item('Harbor review is now Monday.', 0)] };
      return { items: [item(messages[0].content, 0)] };
    },
    async classify({ input }) {
      calls.push({ method: 'classify', input: structuredClone(input) });
      return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
    },
    async select({ input }) {
      calls.push({ method: 'select', input: structuredClone(input) });
      if (failRecall) throw new Error('scripted recall failure');
      return { refs: input.maps.flatMap(map => map.items.flatMap(item => {
        if (item.type === 'unfiled') return [{ namespaceIndex: map.namespaceIndex, ...item.ref }];
        if (item.type === 'ref' && item.ref.childType === 'memory') return [{ namespaceIndex: map.namespaceIndex,
          memoryId: item.ref.childId, revision: item.ref.childRevision }];
        return [];
      })) };
    },
    async rank({ input }) {
      calls.push({ method: 'rank', input: structuredClone(input) });
      const query = input.query;
      const relevant = content => query.includes('languages') ? /uses (Go|Python)/u.test(content)
        : query.includes('database') ? /SQLite/u.test(content)
          : query.includes('editor') ? /editor/u.test(content)
            : query.includes('language') ? /uses Go/u.test(content)
              : query.includes('now') ? /now Monday/u.test(content) : /Friday/u.test(content);
      return { refs: input.candidates.filter(item => relevant(item.memory.content))
        .map(item => ({ namespaceIndex: item.namespaceIndex, ...ref(item.memory) })) };
    },
  };
}

test('frozen model-facing histories contain six bounded windows and no evaluator propositions', () => {
  assert.equal(historyCases.length, 4);
  assert.equal(historyCases.reduce((n, entry) => n + entry.windows.length, 0), 6);
  assert.equal(historyCases[3].windows[0].length, 24);
  for (const entry of historyCases) {
    assert.deepEqual(Object.keys(entry).sort(), ['id', 'queries', 'windows']);
    for (const window of entry.windows) {
      assert.ok(window.length >= 1 && window.length <= 24);
      assert.ok(window.reduce((n, message) => n + message.content.length, 0) <= 20_000);
    }
    for (const query of entry.queries) assert.deepEqual(Object.keys(query).sort(), ['id', 'query']);
  }
  const runnerSource = readFileSync(new URL('../../../evaluations/history-runner.mjs', import.meta.url), 'utf8');
  assert.equal(runnerSource.includes('history-rubric'), false);
});

let baselinePromise;
function baseline() {
  baselinePromise ??= (async () => {
    const model = scriptedModel();
    const report = await runHistoryAudit({ model, directory: directory() });
    return { report, calls: model.calls };
  })();
  return baselinePromise;
}

function reviewFor(report) {
  const review = { version: 'conversation-history-review-v1', reviewerType: 'agent', assertions: [], currentness: [],
    retention: [], relevance: [], answers: [] };
  const requiredContent = {
    'H1-within-window-update': ['Harbor review is now Monday.'],
    'H2-across-window-update': ['Harbor review is now Monday.'],
    'H3-entities-and-negation': ['Harbor uses Go.', 'Juniper uses Python.', 'Harbor adopted SQLite.',
      'SQLite deployment completion is unknown.'],
    'H4-positioned-24-messages': ['For Harbor work, my preferred editor is VS Code.', 'Harbor uses Go.',
      'Harbor team review happens on Friday.'],
  };
  for (const entry of report.cases) {
    const seen = new Set();
    for (const window of entry.windows) for (const item of window.records ?? []) {
      const key = JSON.stringify(ref(item.memory));
      if (!seen.has(key)) {
        seen.add(key);
        review.assertions.push({ historyId: entry.id, ...ref(item.memory), supported: true });
      }
    }
    const records = entry.windows.at(-1).records;
    // Deliberately hand-authored accounting labels, not a semantic judgment:
    // the temporal negative below changes this old Friday label to stale.
    for (const item of records) review.currentness.push({ historyId: entry.id, ...ref(item.memory),
      status: entry.id === 'H2-across-window-update' && item.memory.content.includes('Friday')
        ? 'historical' : 'current' });
    const rubric = historyRubric.find(item => item.id === entry.id);
    assert.equal(requiredContent[entry.id].length, rubric.required.length);
    for (let requiredIndex = 0; requiredIndex < rubric.required.length; requiredIndex++) {
      const item = records.find(item => item.memory.content === requiredContent[entry.id][requiredIndex]);
      assert.ok(item, `scripted baseline must retain ${entry.id}:${requiredIndex}`);
      review.retention.push({ historyId: entry.id, requiredIndex, retained: true, evidence: [ref(item.memory)] });
    }
    for (const query of entry.recalls) {
      review.answers.push({ historyId: entry.id, queryId: query.id, answered: true });
      for (const item of query.result.value.memories) {
        review.relevance.push({ historyId: entry.id, queryId: query.id, ...ref(item.memory), relevant: true });
      }
    }
  }
  return review;
}

test('actual core sequentially captures six windows and retains cold-reopened original receipts', async () => {
  const { report, calls } = await baseline();
  assert.equal(report.version, historyVersion);
  assert.equal(report.cases.length, 4);
  const windows = report.cases.flatMap(entry => entry.windows);
  assert.equal(windows.length, 6);
  assert.ok(windows.every(window => window.status === 'completed'));
  assert.ok(windows.every(window => window.reopenPersisted === true));
  assert.ok(windows.every(window => window.receiptBindingsValid === true));
  assert.equal(calls.filter(call => call.method === 'extract').length, 6);
  const changing = report.cases.find(entry => entry.id === 'H2-across-window-update');
  const old = changing.windows[0].records[0];
  const persisted = changing.windows[2].records.find(item => item.memory.id === old.memory.id);
  assert.deepEqual(persisted, old, 'runner must not silently correct or remove the earlier captured assertion');
  assert.equal(old.receipts[0].eventId, 'h2-1');
  assert.equal(old.receipts[0].excerpt, historyCases[1].windows[0][0].content);
  assert.ok(changing.windows[2].records.some(item => item.memory.content === 'Harbor review is now Monday.'));
  assert.ok(report.cases.every(entry => entry.recalls.every(query => query.status === 'completed')));
  const summary = scoreHistoryAudit(report, reviewFor(report));
  assert.equal(summary.status, 'passed', JSON.stringify(summary));
});

test('model input contains only source messages, live core records and questions, never evaluator oracles', async () => {
  const { calls } = await baseline();
  const forbiddenKeys = new Set(['required', 'requiredIndex', 'forbidden', 'expectedIds', 'forbiddenIds',
    'review', 'retention', 'assertions', 'currentness', 'answers', 'oracleIds']);
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) {
      assert.equal(forbiddenKeys.has(key), false, key);
      visit(child);
    }
  };
  calls.forEach(call => visit(call.input));
  for (const call of calls.filter(call => call.method === 'extract')) {
    assert.deepEqual(Object.keys(call.input), ['messages']);
    assert.ok(call.input.messages.every(message =>
      Object.keys(message).sort().join(',') === 'content,index,role'));
  }
});

test('failed capture keeps its window and all unrun successors without evaluator repairs', async () => {
  const model = scriptedModel({ failExtraction: 3 });
  const report = await runHistoryAudit({ model, directory: directory(), readDiagnostics: () => model.diagnostics });
  const entry = report.cases.find(entry => entry.id === 'H2-across-window-update');
  assert.equal(entry.windows.length, 3);
  assert.equal(entry.windows[0].status, 'completed');
  assert.equal(entry.windows[1].status, 'failed');
  assert.notEqual(entry.windows[2].status, 'completed');
  assert.equal(entry.windows[1].capture.ok, false);
  assert.ok(entry.windows[1].diagnostics.some(event => event.stage === 'extract'));
  assert.ok(entry.recalls.every(query => query.status !== 'completed'));
  const summary = scoreHistoryAudit(report);
  assert.notEqual(summary.status, 'passed');
  assert.equal(summary.metrics.requiredFacts, 9);
  assert.equal(summary.metrics.queries, 7);
  const observed = new Set(report.cases.flatMap(history => history.windows.flatMap(window =>
    (window.records ?? []).map(item => JSON.stringify([history.id, ...Object.values(ref(item.memory))])))));
  assert.equal(summary.metrics.assertions, observed.size, 'failed/unrun history must not erase already observed assertions');
  const lastObserved = report.cases.reduce((count, history) => count
    + (history.windows.findLast(window => Array.isArray(window.records))?.records.length ?? 0), 0);
  assert.equal(summary.metrics.finalAssertions, lastObserved, 'latest observed state remains reportable after failure');
});

test('absent malformed or empty reports retain all frozen fact and query denominators', async () => {
  const malformedRecall = structuredClone((await baseline()).report);
  malformedRecall.cases[0].recalls[0].result.value.memories = {};
  for (const report of [undefined, null, {}, { cases: [] }, { cases: 'malformed' }, malformedRecall]) {
    const summary = scoreHistoryAudit(report);
    assert.equal(summary.status, 'failed');
    assert.equal(summary.metrics.requiredFacts, 9);
    assert.equal(summary.metrics.queries, 7);
  }
});

test('failed model recall remains failure rather than completed absence', async () => {
  const report = await runHistoryAudit({ model: scriptedModel({ failRecall: true }), directory: directory() });
  assert.ok(report.cases.flatMap(entry => entry.recalls).every(query => query.status === 'failed'));
  assert.ok(report.cases.flatMap(entry => entry.recalls).every(query => query.result.ok === false));
  assert.notEqual(scoreHistoryAudit(report).status, 'passed');
});

test('observer and diagnostic failures retain completed window evidence and cannot report success', async () => {
  const good = (await baseline()).report;
  assert.equal(scoreHistoryAudit(good, reviewFor(good)).status, 'passed');
  for (const mode of ['progress-throw', 'progress-reject', 'diagnostic-throw',
    'diagnostic-reject', 'diagnostic-uncloneable', 'diagnostic-not-array']) {
    let observations = 0;
    const marker = 'PRIVATE_OBSERVER_FAILURE_MUST_NOT_ESCAPE';
    const options = { model: scriptedModel(), directory: directory() };
    if (mode.startsWith('progress')) {
      options.onProgress = () => {
        if (++observations === 3) {
          if (mode === 'progress-reject') return Promise.reject(new Error(marker));
          throw new Error(marker);
        }
      };
    } else {
      options.readDiagnostics = () => {
        if (++observations === 3) {
          if (mode === 'diagnostic-throw') throw new Error(marker);
          if (mode === 'diagnostic-reject') return Promise.reject(new Error(marker));
          if (mode === 'diagnostic-not-array') return {};
          return [() => marker];
        }
        return [];
      };
    }
    const report = await runHistoryAudit(options);
    assert.equal(report.status, 'failed', mode);
    const earlier = report.cases.find(entry => entry.id === 'H1-within-window-update');
    assert.equal(earlier.windows[0].capture.ok, true, mode);
    assert.ok(earlier.windows[0].records.length > 0, mode);
    const failed = report.cases.find(entry => entry.id === 'H2-across-window-update');
    assert.equal(failed.windows[0].capture.ok, true, mode);
    assert.ok(failed.windows[0].records.length > 0, mode);
    assert.equal(failed.windows[0].status, 'failed', mode);
    assert.equal(failed.windows[0].error.code,
      mode.startsWith('progress') ? 'history_progress_failed' : 'history_diagnostics_failed', mode);
    assert.ok(failed.windows.slice(1).every(window => window.status === 'not_run'), mode);
    assert.ok(failed.recalls.every(query => query.status === 'not_run'), mode);
    assert.ok(report.cases.slice(2).every(entry => entry.windows.every(window => window.status === 'not_run')
      && entry.recalls.every(query => query.status === 'not_run')), mode);
    assert.equal(options.model.calls.filter(call => call.method === 'extract').length, 2, mode);
    assert.equal(JSON.stringify(report).includes(marker), false, mode);
    assert.notEqual(scoreHistoryAudit(report).status, 'passed', mode);
  }
});

test('source mismatch, incomplete coverage and unrun records cannot pass despite approving labels', async () => {
  const { report } = await baseline();
  for (const [index, mutate] of [
    r => { r.cases[0].windows[0].records[0].receipts[0].excerpt = 'forged source text'; },
    r => { r.cases[0].windows[0].records[0].receipts[0].eventId = 'foreign-source'; },
    r => { r.cases[0].windows[0].receiptBindingsValid = false; },
    r => { delete r.cases[0].windows[0].capture.value.classification; },
    r => { r.cases[0].windows[0].capture.value.classification = { status: 'skipped', reason: 'invented' }; },
    r => { r.cases[0].windows[0].reopenPersisted = false; },
    r => { r.cases[0].windows[0].status = 'unrun'; },
    r => { r.cases[0].recalls[0].result.value.coverage = 'budget_exhausted'; },
    r => { r.cases[0].recalls[0].result.value.namespaces[0].mapExhausted = false; },
    r => { r.cases[0].recalls[0].status = 'failed'; },
  ].entries()) {
    const candidate = structuredClone(report);
    const review = reviewFor(candidate);
    assert.equal(scoreHistoryAudit(candidate, review).status, 'passed');
    mutate(candidate);
    assert.notEqual(scoreHistoryAudit(candidate, review).status, 'passed', `evidence mutation ${index}`);
  }
});

test('missing duplicate foreign invalid and self-grading labels cannot pass', async () => {
  const { report } = await baseline();
  for (const mutate of [
    review => { review.reviewerType = 'evaluated-model'; },
    review => { review.assertions.pop(); },
    review => { review.assertions.push(structuredClone(review.assertions[0])); },
    review => { review.currentness.pop(); },
    review => { review.currentness[0].status = 'approved'; },
    review => { review.retention.pop(); },
    review => { review.retention[0].evidence = []; },
    review => { review.retention[0].requiredIndex = 999; },
    review => { review.relevance.pop(); },
    review => { review.relevance.push(structuredClone(review.relevance[0])); },
    review => { review.answers.pop(); },
    review => { review.answers[0].answered = 'yes'; },
    review => { review.assertions[0].memoryId = 'foreign'; },
    review => { review.assertions[0].supported = 'true'; },
    review => { review.assertions[0].modelVerdict = 'passed'; },
  ]) {
    const review = reviewFor(report);
    assert.equal(scoreHistoryAudit(report, review).status, 'passed');
    mutate(review);
    assert.notEqual(scoreHistoryAudit(report, review).status, 'passed');
  }
  assert.notEqual(scoreHistoryAudit(report).status, 'passed');
});

test('returned receipts must remain bound to the final stored assertion, not any valid source in the history', async () => {
  const { report } = await baseline();
  for (const mutate of [
    entry => { entry.recalls[0].result.value.memories[0].receipts[0].id = 'fabricated-receipt-id'; },
    entry => {
      const other = entry.windows[0].records.find(item => item.memory.content === 'Harbor adopted SQLite.');
      entry.recalls[0].result.value.memories[0].receipts = structuredClone(other.receipts);
    },
  ]) {
    const candidate = structuredClone(report);
    const review = reviewFor(candidate);
    assert.equal(scoreHistoryAudit(candidate, review).status, 'passed');
    mutate(candidate.cases.find(entry => entry.id === 'H3-entities-and-negation'));
    assert.notEqual(scoreHistoryAudit(candidate, review).status, 'passed');
  }
});

test('matching forged snapshots cannot widen the frozen namespace or turn deleted rows into current assertions', async () => {
  const { report } = await baseline();
  for (const mutate of [
    memory => { memory.namespace.ownerId = 'foreign-owner'; },
    memory => { memory.namespace.projectId = 'foreign-project'; },
    memory => { memory.state = 'deleted'; },
  ]) {
    const candidate = structuredClone(report);
    const review = reviewFor(candidate);
    assert.equal(scoreHistoryAudit(candidate, review).status, 'passed');
    const entry = candidate.cases[0];
    for (const item of entry.windows[0].records) mutate(item.memory);
    entry.windows[0].reopenedRecords = structuredClone(entry.windows[0].records);
    for (const query of entry.recalls) for (const item of query.result.value.memories) mutate(item.memory);
    assert.notEqual(scoreHistoryAudit(candidate, review).status, 'passed');
  }
});

test('historically supported assertion still fails when reviewed stale as current truth', async () => {
  const { report } = await baseline();
  const review = reviewFor(report);
  assert.equal(scoreHistoryAudit(report, review).status, 'passed');
  const old = review.currentness.find(label => label.status === 'historical');
  assert.ok(old);
  assert.equal(review.assertions.find(label => label.historyId === old.historyId
    && label.memoryId === old.memoryId && label.revision === old.revision).supported, true);
  old.status = 'stale';
  assert.notEqual(scoreHistoryAudit(report, review).status, 'passed');
});
