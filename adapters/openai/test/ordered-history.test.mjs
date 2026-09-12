import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { historyCases } from '../../../evaluations/history-cases.mjs';
import { scoreHistoryAudit } from '../../../evaluations/history-score.mjs';
import { runOrderedHistoryAudit, projectOrderedHistoryAudit, ORDERED_HISTORY_VERSION, ORDERED_HISTORY_MAPPING } from '../../../evaluations/ordered-history-runner.mjs';
import { scoreOrderedHistoryAudit, orderedHistoryReviewVersion } from '../../../evaluations/ordered-history-score.mjs';

const directory = () => mkdtempSync(join(tmpdir(), 'cairn-ordered-history-test-'));
const ref = (memory) => ({ memoryId: memory.id, revision: memory.revision });
const historical = (report) => report.evidence.cases.flatMap((entry) => entry.windows.flatMap((window) =>
  (window.records ?? []).filter((record) => record.memory.state === 'historical').map((record) => ({ historyId: entry.id, record }))));
const temporal = (report) => report.evidence.cases.find((entry) => entry.id === 'H2-across-window-update');
const failed = (score) => {
  assert.equal(score.status, 'failed');
  assert.equal(score.metrics.histories, 4); assert.equal(score.metrics.windows, 6);
  assert.equal(score.metrics.requiredFacts, 9); assert.equal(score.metrics.queries, 7);
};

// Handwritten source-text scripts exercise the actual public core. These choices
// and the all-true review fixtures below are not independent semantic evidence.
function model(options = {}) {
  const calls = []; const diagnostics = []; let extraction = 0;
  const result = { contextWindow: 100000, countTokens: () => 1, calls, diagnostics,
    onDiagnostic: (event) => diagnostics.push(event),
    async extract({ input }) {
      calls.push({ method: 'extract', input: structuredClone(input) }); extraction++;
      if (extraction === options.failExtraction) throw new Error('Synthetic extraction failure');
      const messages = input.messages; const item = (content, index) => ({ content, kind: 'fact', confidence: 0.8, sourceIndices: [index] });
      const confirmed = messages.findIndex((m) => m.content.startsWith('Confirmed update:'));
      if (confirmed >= 0) return { items: [item('Harbor review is now Monday.', confirmed)] };
      if (messages[0].content.startsWith('Could')) return { items: options.repeatProposal
        ? [item('Harbor team review happens on Friday.', 1)] : [] };
      if (messages[0].content.startsWith('Harbor uses Go. Juniper')) return { items: [item('Harbor uses Go.', 0), item('Juniper uses Python.', 0),
        item('Harbor adopted SQLite.', 3), item('SQLite deployment completion is unknown.', 4)] };
      return { items: messages.filter((m) => m.role === 'user' && !m.content.startsWith('Temporary chat'))
        .map((m) => item(m.content, m.index)) };
    },
    async reconcile({ input }) {
      calls.push({ method: 'reconcile', input: structuredClone(input) });
      if (options.failReconcile) throw new Error('Synthetic reconcile failure');
      if (options.noTransitions) return { transitions: [] };
      return { transitions: [{ replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0],
        relation: 'supersedes', valueChange: 'changed', adoption: 'explicit' }] };
    },
    async classify({ input }) {
      calls.push({ method: 'classify', input: structuredClone(input) });
      if (options.failClassification) throw new Error('Synthetic classification failure');
      return { items: input.memories.map((memory) => ({ memoryId: memory.id, parentIds: [],
        ...(options.fileMemories ? { newL1: { title: `Topic: ${memory.content}`, parentL2Ids: [] } } : {}) })) };
    },
    async select({ input }) {
      calls.push({ method: 'select', input: structuredClone(input) });
      if (options.failRecall) throw new Error('Synthetic recall failure');
      return { refs: input.maps.flatMap((map) => map.items.flatMap((entry) => entry.type === 'unfiled'
        ? [{ namespaceIndex: map.namespaceIndex, ...entry.ref }]
        : entry.type === 'ref' && entry.ref.childType === 'memory'
          ? [{ namespaceIndex: map.namespaceIndex, memoryId: entry.ref.childId, revision: entry.ref.childRevision }] : [])) };
    },
    async rank({ input }) {
      calls.push({ method: 'rank', input: structuredClone(input) });
      const relevant = (content) => input.query.includes('languages') ? /uses (Go|Python)/u.test(content)
        : input.query.includes('database') ? /SQLite/u.test(content) : input.query.includes('editor') ? /editor/u.test(content)
          : input.query.includes('language') ? /uses Go/u.test(content) : input.query.includes('now') ? /now Monday/u.test(content) : /Friday/u.test(content);
      return { refs: input.candidates.filter((candidate) => relevant(candidate.memory.content))
        .map((candidate) => ({ namespaceIndex: candidate.namespaceIndex, ...ref(candidate.memory) })) };
    },
  };
  return result;
}

function reviews(report) {
  const v1Review = { version: 'conversation-history-review-v1', reviewerType: 'agent', assertions: [], currentness: [], retention: [], relevance: [], answers: [] };
  const required = [
    ['Harbor review is now Monday.'], ['Harbor review is now Monday.'],
    ['Harbor uses Go.', 'Juniper uses Python.', 'Harbor adopted SQLite.', 'SQLite deployment completion is unknown.'],
    ['For Harbor work, my preferred editor is VS Code.', 'Harbor uses Go.', 'Harbor team review happens on Friday.'],
  ];
  for (const [index, entry] of report.v1Projection.cases.entries()) {
    const seen = new Set();
    for (const window of entry.windows) for (const record of window.records ?? []) {
      const key = JSON.stringify(ref(record.memory)); if (seen.has(key)) continue; seen.add(key);
      v1Review.assertions.push({ historyId: entry.id, ...ref(record.memory), supported: true });
    }
    const final = entry.windows.at(-1).records;
    for (const record of final) v1Review.currentness.push({ historyId: entry.id, ...ref(record.memory), status: 'current' });
    for (const [requiredIndex, content] of required[index].entries()) {
      const record = final.find((r) => r.memory.content === content); assert.ok(record, content);
      v1Review.retention.push({ historyId: entry.id, requiredIndex, retained: true, evidence: [ref(record.memory)] });
    }
    for (const query of entry.recalls) {
      v1Review.answers.push({ historyId: entry.id, queryId: query.id, answered: true });
      for (const record of query.result.value.memories) v1Review.relevance.push({ historyId: entry.id, queryId: query.id, ...ref(record.memory), relevant: true });
    }
  }
  const seen = new Set(); const assertions = [];
  for (const { historyId, record } of historical(report)) {
    const key = JSON.stringify([historyId, record.memory.id, record.memory.revision]); if (seen.has(key)) continue; seen.add(key);
    assertions.push({ historyId, ...ref(record.memory), supported: true, retirementJustified: true });
  }
  return { v1Review, historyReview: { version: orderedHistoryReviewVersion, reviewerType: 'agent', assertions } };
}
let baseline;
const positive = () => baseline ??= (async () => { const scripted = model();
  const report = await runOrderedHistoryAudit({ model: scripted, directory: directory(), readDiagnostics: () => scripted.diagnostics });
  return { report, calls: scripted.calls };
})();

test('H1 all seven original source, evaluator and failed-evidence files remain byte-identical', () => {
  const pinned = {
    'evaluations/history-cases.mjs': '13c2bc8b0492054869c9aab94de14a3438b08cbc81d2e9140f89f38fe6f4383f',
    'evaluations/history-rubric.mjs': 'c84b060d8b37f10ca9d0511bad254fff922814e796c88835ba878bf0452e9e75',
    'evaluations/history-runner.mjs': '614b67d252611836c3bf9b2f4e6a17d5053cfa60ac70a053af063df90b004429',
    'evaluations/history-score.mjs': '62c5c2ed3b6ef4a713824d6c6fb39fb714071f5dab46846eee46d727739832f7',
    'evaluations/results/conversation-history-v1.json': 'b3244a104c483f029fc9751c68cf9766798c5cfc54e2cce5e95d6f19e93c14a8',
    'evaluations/results/conversation-history-v1-review.json': '323e2d94ddeb9117c95a825fc73af022408ff0b214691f98d44649bf2a1eb9cd',
    'docs/evidence/conversation-history-accounting.json': '8394f3c61f5855dbed585701fb67f206748b6e14e9dce5d73a4aae45f9a53299',
  };
  for (const [filename, hash] of Object.entries(pinned)) assert.equal(createHash('sha256').update(readFileSync(new URL(`../../../${filename}`, import.meta.url))).digest('hex'), hash, filename);
  const original = JSON.parse(readFileSync(new URL('../../../evaluations/results/conversation-history-v1.json', import.meta.url), 'utf8'));
  const originalReview = JSON.parse(readFileSync(new URL('../../../evaluations/results/conversation-history-v1-review.json', import.meta.url), 'utf8'));
  assert.equal(scoreHistoryAudit(original, originalReview).status, 'failed');
});

test('H2 actual ordered captures retain Friday history, source receipts and relation through cold reopen', async () => {
  const { report } = await positive();
  assert.deepEqual(Object.keys(report).sort(), ['evidence', 'ordering', 'sourceVersion', 'v1Projection', 'version']);
  assert.equal(report.version, ORDERED_HISTORY_VERSION); assert.equal(report.sourceVersion, 'conversation-history-v1');
  assert.deepEqual(report.ordering, ORDERED_HISTORY_MAPPING); assert.ok(Object.isFrozen(ORDERED_HISTORY_MAPPING));
  assert.equal(report.evidence.status, 'completed'); assert.equal(report.evidence.cases.length, 4);
  assert.equal(report.evidence.cases.reduce((n, entry) => n + entry.windows.length, 0), 6);
  for (const entry of report.evidence.cases) for (const window of entry.windows) {
    assert.deepEqual(window.causal, { streamId: `conversation-history-v1-${entry.id}`, sequence: window.index + 1 });
    assert.equal(window.status, 'completed'); assert.deepEqual(window.records, window.reopenedRecords);
  }
  const changing = temporal(report); const initial = changing.windows[0].records[0];
  const final = changing.windows[2]; const old = final.records.find((r) => r.memory.id === initial.memory.id);
  const current = final.records.find((r) => r.memory.state === 'active');
  assert.equal(old.memory.state, 'historical'); assert.equal(current.memory.content, 'Harbor review is now Monday.');
  assert.deepEqual(old.receipts, initial.receipts); assert.equal(old.receipts[0].eventId, 'h2-1');
  assert.equal(old.supersession.previousRevision, initial.memory.revision);
  assert.equal(old.supersession.replacement.memoryId, current.memory.id); assert.equal(old.supersession.evidenceAvailable, true);
  assert.deepEqual(old.supersession.receiptIds, current.receipts.map((r) => r.id)); assert.equal(current.receipts[0].eventId, 'h2-5');
  assert.deepEqual(final.capture.value.reconciliation, { status: 'applied', reason: null, retiredCount: 1 });
  assert.deepEqual(report.v1Projection.cases[1].windows[2].records.map((r) => r.memory.id), [current.memory.id]);
});

test('H2 projection is exact and detached; removing history never mutates retained raw evidence', async () => {
  const { report } = await positive(); const candidate = structuredClone(report); const before = structuredClone(candidate.evidence);
  assert.deepEqual(candidate.v1Projection, projectOrderedHistoryAudit(candidate.evidence));
  candidate.v1Projection.cases[1].windows[2].records[0].memory.content = 'Projection edit';
  candidate.v1Projection.cases[0].windows[0].messages[0].content = 'Projection source edit';
  assert.deepEqual(candidate.evidence, before);
  assert.equal(candidate.v1Projection.version, 'conversation-history-v1');
  for (const entry of candidate.v1Projection.cases) for (const window of entry.windows) {
    assert.equal(Object.hasOwn(window, 'causal'), false);
    for (const record of window.records ?? []) { assert.equal(record.memory.state, 'active'); assert.equal(Object.hasOwn(record, 'supersession'), false); }
  }
});

test('H3 model inputs contain fixed source text and legitimate references, never evaluation or ordering oracles', async () => {
  const { calls } = await positive();
  const forbidden = new Set(['required', 'requiredIndex', 'forbidden', 'expectedIds', 'review', 'historyReview', 'retention', 'assertions', 'currentness', 'answers', 'oracleIds', 'causal', 'streamId']);
  const inspect = (value) => { if (!value || typeof value !== 'object') return;
    for (const [key, child] of Object.entries(value)) { assert.equal(forbidden.has(key), false, key); inspect(child); } };
  for (const call of calls) inspect(call.input);
  assert.equal(calls.filter((c) => c.method === 'extract').length, 6); assert.equal(calls.filter((c) => c.method === 'reconcile').length, 1);
  for (const call of calls.filter((c) => ['extract', 'reconcile'].includes(c.method))) {
    for (const entry of historyCases) assert.equal(JSON.stringify(call.input).includes(entry.id), false);
    const ids = (value) => { if (!value || typeof value !== 'object') return;
      for (const [key, child] of Object.entries(value)) { assert.ok(!['id', 'memoryId', 'revision', 'namespace', 'eventId', 'sessionId'].includes(key), key); ids(child); } };
    ids(call.input);
  }
  const runner = readFileSync(new URL('../../../evaluations/ordered-history-runner.mjs', import.meta.url), 'utf8');
  for (const forbiddenImport of ['history-rubric', 'history-score', 'ordered-history-score', 'history-v1-review']) assert.equal(runner.includes(forbiddenImport), false);
});

test('H2 caller-supplied cases, ordering and unsafe directories reject before stores or model work', async () => {
  const scripted = model();
  for (const patch of [{ cases: historyCases }, { cases: [...historyCases].reverse() }, { ordering: {} }, { causal: {} }, { extra: true },
    { model: null }, { onProgress: 'not-function' }, { readDiagnostics: [] }]) {
    const dir = directory(); await assert.rejects(runOrderedHistoryAudit({ model: scripted, directory: dir, ...patch })); assert.deepEqual(readdirSync(dir), []);
  }
  for (const kind of ['symbol', 'nonenumerable', 'prototype']) {
    const dir = directory(); const options = { model: scripted, directory: dir };
    if (kind === 'symbol') options[Symbol('unknown')] = true;
    if (kind === 'nonenumerable') Object.defineProperty(options, 'unknown', { value: true });
    if (kind === 'prototype') Object.setPrototypeOf(options, { unknown: true });
    await assert.rejects(runOrderedHistoryAudit(options)); assert.deepEqual(readdirSync(dir), []);
  }
  const occupied = directory(); writeFileSync(join(occupied, 'synthetic'), 'occupied');
  const permissive = directory(); chmodSync(permissive, 0o755);
  const parent = directory(); const target = directory(); const linked = join(parent, 'link'); symlinkSync(target, linked);
  for (const dir of [occupied, permissive, linked]) await assert.rejects(runOrderedHistoryAudit({ model: scripted, directory: dir }));
  assert.equal(scripted.calls.length, 0);
});

test('H4 positive mechanical reviews combine raw history checks with unchanged v1 scoring and fixed denominators', async () => {
  const { report } = await positive(); const labels = reviews(report); const result = scoreOrderedHistoryAudit(report, labels);
  assert.equal(result.status, 'passed', JSON.stringify(result));
  assert.deepEqual(result.v1Score, scoreHistoryAudit(report.v1Projection, labels.v1Review));
  assert.deepEqual(result.metrics, { histories: 4, windows: 6, requiredFacts: 9, queries: 7, historicalAssertions: 1, justifiedHistoricalAssertions: 1, retirements: 1 });
  for (const malformed of [undefined, null, {}, { evidence: { cases: [] } }, { evidence: 'bad' }]) failed(scoreOrderedHistoryAudit(malformed));
});

test('H4 malformed review options return finite failed scores with all frozen denominators', async () => {
  const { report } = await positive(); const valid = reviews(report);
  for (const options of [null, false, 0, 'invalid', [], () => {}, { ...valid, unknown: true },
    { v1Review: null, historyReview: null }, { v1Review: [], historyReview: {} },
    new Proxy({}, { ownKeys() { throw new Error('SYNTHETIC_PRIVATE_OPTION_ERROR'); } }),
    { get v1Review() { throw new Error('SYNTHETIC_PRIVATE_OPTION_ERROR'); }, historyReview: {} }]) {
    const result = scoreOrderedHistoryAudit(report, options);
    failed(result); assert.ok(Array.isArray(result.errors)); assert.ok(result.errors.length > 0);
    assert.doesNotThrow(() => JSON.stringify(result));
    assert.equal(JSON.stringify(result).includes('SYNTHETIC_PRIVATE_OPTION_ERROR'), false);
    for (const value of Object.values(result.metrics)) assert.equal(Number.isFinite(value), true);
  }
});

test('H4 actual deduplication can grow active revisions and receipts before later historical retirement', async () => {
  // Scripted repeat extraction tests lifecycle accounting only; it does not
  // establish semantic support for the proposition in this proposal window.
  const report = await runOrderedHistoryAudit({ model: model({ repeatProposal: true }), directory: directory() });
  assert.equal(report.evidence.status, 'completed');
  const windows = temporal(report).windows;
  const initial = windows[0].records[0];
  const repeated = windows[1].records.find((r) => r.memory.id === initial.memory.id);
  assert.equal(repeated.memory.state, 'active'); assert.equal(repeated.memory.content, initial.memory.content);
  assert.ok(repeated.memory.revision > initial.memory.revision);
  assert.equal(repeated.receipts.length, initial.receipts.length + 1);
  assert.ok(repeated.receipts.some((r) => r.eventId === 'h2-4' && r.excerpt === historyCases[1].windows[1][1].content));
  const retired = windows[2].records.find((r) => r.memory.id === initial.memory.id);
  assert.equal(retired.memory.state, 'historical'); assert.deepEqual(retired.receipts, repeated.receipts);
  assert.equal(retired.supersession.previousRevision, repeated.memory.revision);
  const result = scoreOrderedHistoryAudit(report, reviews(report));
  assert.equal(result.status, 'passed', JSON.stringify(result));
});

test('H4 classified successor preserves its committed supersession revision independently of current filing revision', async () => {
  const report = await runOrderedHistoryAudit({ model: model({ fileMemories: true }), directory: directory() });
  assert.equal(report.evidence.status, 'completed', JSON.stringify(report));
  const final = temporal(report).windows[2];
  const old = final.records.find((record) => record.memory.state === 'historical');
  const successor = final.records.find((record) => record.memory.id === old.supersession.replacement.memoryId);
  assert.equal(final.capture.value.admission.memories.find((memory) => memory.id === successor.memory.id).revision, 1);
  assert.equal(old.supersession.replacement.revision, 1);
  assert.equal(old.supersession.replacement.currentRevision, 2);
  assert.equal(successor.memory.revision, 2); assert.equal(successor.memory.filing.status, 'filed');
  const labels = reviews(report);
  const score = scoreOrderedHistoryAudit(report, labels);
  assert.equal(score.status, 'passed', JSON.stringify(score));
  const forged = structuredClone(report);
  const altered = temporal(forged).windows[2];
  for (const records of [altered.records, altered.reopenedRecords])
    records.find((record) => record.memory.state === 'historical').supersession.replacement.revision = 2;
  forged.v1Projection = projectOrderedHistoryAudit(forged.evidence);
  failed(scoreOrderedHistoryAudit(forged, labels));
  for (const mutate of [
    (memories) => memories.splice(0, memories.length),
    (memories) => memories.push(structuredClone(memories[0])),
    (memories) => { memories[0].revision = 2; },
    (memories) => { memories[0].revision = '1'; },
    (memories) => { memories[0].extra = true; },
  ]) {
    const candidate = structuredClone(report);
    mutate(temporal(candidate).windows[2].capture.value.admission.memories);
    candidate.v1Projection = projectOrderedHistoryAudit(candidate.evidence);
    failed(scoreOrderedHistoryAudit(candidate, labels));
  }
});

test('H4 reconciliation retirement counts above the core five-transition bound reject', async () => {
  const candidate = structuredClone((await positive()).report); const labels = reviews(candidate);
  temporal(candidate).windows[2].capture.value.reconciliation.retiredCount = 6;
  candidate.v1Projection = projectOrderedHistoryAudit(candidate.evidence);
  failed(scoreOrderedHistoryAudit(candidate, labels));
});

test('H4 projection-only omission, recall tampering and historical relabeling cannot conceal raw evidence', async () => {
  const { report } = await positive(); const labels = reviews(report);
  for (const mutate of [
    (r) => { r.v1Projection.cases[0].windows[0].records = []; },
    (r) => { r.v1Projection.cases[0].windows[0].capture.value.admission.memories = []; },
    (r) => { r.v1Projection.cases[1].recalls[0].result.value.memories = []; },
    (r) => { r.v1Projection.cases[1].windows[2].status = 'failed'; },
    (r) => { const old = structuredClone(historical(r)[0].record); old.memory.state = 'active'; r.v1Projection.cases[1].windows[2].records.push(old); },
  ]) { const candidate = structuredClone(report); mutate(candidate); failed(scoreOrderedHistoryAudit(candidate, labels)); }
});

test('H4 raw omission, source mutation and forged supersession fail even with a freshly matching projection', async () => {
  const { report } = await positive(); const labels = reviews(report);
  const mutations = [
    (r) => { temporal(r).windows[2].records = temporal(r).windows[2].records.filter((x) => x.memory.state !== 'historical'); },
    (r) => { historical(r)[0].record.memory.state = 'active'; },
    (r) => { historical(r)[0].record.memory.content = 'Rewritten Friday'; },
    (r) => { historical(r)[0].record.memory.namespace.ownerId = 'foreign'; },
    (r) => { historical(r)[0].record.receipts[0].excerpt = 'Fabricated old source'; },
    (r) => { historical(r)[0].record.receipts = structuredClone(temporal(r).windows[2].records.find((x) => x.memory.state === 'active').receipts); },
    (r) => { historical(r)[0].record.supersession.replacement.memoryId = historical(r)[0].record.memory.id; },
    (r) => { historical(r)[0].record.supersession.replacement.memoryId = r.evidence.cases[0].windows[0].records[0].memory.id; },
    (r) => { historical(r)[0].record.supersession.replacement.revision += 1; },
    (r) => { historical(r)[0].record.supersession.replacement.currentRevision += 1; },
    (r) => { historical(r)[0].record.supersession.replacement.state = 'historical'; },
    (r) => { historical(r)[0].record.supersession.previousRevision += 1; },
    (r) => { historical(r)[0].record.supersession.receiptIds = [historical(r)[0].record.receipts[0].id]; },
    (r) => { historical(r)[0].record.supersession.receiptIds = ['forged']; },
    (r) => { historical(r)[0].record.supersession.evidenceAvailable = false; },
    (r) => { temporal(r).windows[2].capture.value.reconciliation = { status: 'complete_no_change', reason: null, retiredCount: 0 }; },
    (r) => { temporal(r).windows[2].capture.value.reconciliation.retiredCount = 2; },
    (r) => { temporal(r).windows[2].causal.sequence = 1; },
    (r) => { temporal(r).windows[2].messages[0].content = 'Changed source'; },
    (r) => { r.evidence.cases.reverse(); },
    (r) => { temporal(r).windows.reverse(); },
  ];
  for (const [index, mutate] of mutations.entries()) {
    const candidate = structuredClone(report); mutate(candidate);
    for (const entry of candidate.evidence.cases) for (const window of entry.windows) window.reopenedRecords = structuredClone(window.records);
    candidate.v1Projection = projectOrderedHistoryAudit(candidate.evidence);
    const score = scoreOrderedHistoryAudit(candidate, labels); assert.equal(score.status, 'failed', `tamper ${index}: ${JSON.stringify(score)}`);
    assert.equal(score.metrics.requiredFacts, 9); assert.equal(score.metrics.queries, 7);
  }
});

test('H4 engine historical metadata cannot substitute for complete independent semantic review labels', async () => {
  const { report } = await positive();
  for (const mutate of [
    (labels) => { delete labels.historyReview; }, (labels) => { labels.historyReview.assertions = []; },
    (labels) => { labels.historyReview.assertions.push(structuredClone(labels.historyReview.assertions[0])); },
    (labels) => { labels.historyReview.assertions[0].supported = false; },
    (labels) => { labels.historyReview.assertions[0].retirementJustified = false; },
    (labels) => { labels.historyReview.assertions[0].memoryId = 'foreign'; },
    (labels) => { labels.historyReview.assertions[0].revision += 1; },
    (labels) => { labels.historyReview.assertions[0].supported = 'true'; },
    (labels) => { labels.historyReview.assertions[0].metadataApproved = true; },
    (labels) => { labels.historyReview.reviewerType = 'evaluated-model'; },
    (labels) => { delete labels.v1Review; },
  ]) { const labels = reviews(report); mutate(labels); failed(scoreOrderedHistoryAudit(report, labels)); }
});

test('H3 capture and classification failures retain attempts and halt affected later windows without repair', async () => {
  for (const options of [{ failExtraction: 3 }, { failClassification: true }, { failReconcile: true }]) {
    const report = await runOrderedHistoryAudit({ model: model(options), directory: directory() });
    assert.equal(report.evidence.status, 'failed');
    const entry = options.failClassification ? report.evidence.cases[0] : temporal(report);
    const index = options.failClassification ? 0 : options.failReconcile ? 2 : 1;
    assert.equal(entry.windows[index].status, 'failed'); assert.ok(Object.hasOwn(entry.windows[index], 'capture'));
    assert.ok(Array.isArray(entry.windows[index].records)); assert.ok(entry.windows.slice(index + 1).every((w) => w.status === 'not_run'));
    assert.ok(entry.recalls.every((r) => r.status === 'not_run')); failed(scoreOrderedHistoryAudit(report));
  }
});

test('H3 unresolved reconciliation remains a retained failed window, not a completed repaired run', async () => {
  const scripted = model();
  scripted.countTokens = (text) => text.includes('"candidates"') && text.includes('"items"') ? 6001 : 1;
  const report = await runOrderedHistoryAudit({ model: scripted, directory: directory() });
  const window = temporal(report).windows[2];
  assert.equal(window.capture.ok, true);
  assert.deepEqual(window.capture.value.reconciliation, { status: 'unresolved', reason: 'context_budget', retiredCount: 0 });
  assert.equal(window.status, 'failed'); assert.equal(report.evidence.status, 'failed');
  assert.equal(window.records.length, 2); assert.ok(window.records.every((r) => r.memory.state === 'active'));
  assert.ok(temporal(report).recalls.every((r) => r.status === 'not_run'));
  failed(scoreOrderedHistoryAudit(report));
});

test('H4 ranking Monday above still-active Friday cannot replace the required historical transition', async () => {
  const report = await runOrderedHistoryAudit({ model: model({ noTransitions: true }), directory: directory() });
  assert.equal(report.evidence.status, 'completed');
  assert.ok(temporal(report).windows[2].records.every((r) => r.memory.state === 'active'));
  assert.equal(temporal(report).recalls[0].result.value.memories[0].memory.content, 'Harbor review is now Monday.');
  const labels = reviews(report);
  assert.equal(scoreHistoryAudit(report.v1Projection, labels.v1Review).status, 'passed');
  failed(scoreOrderedHistoryAudit(report, labels));
});

test('H3 callback failures retain completed capture evidence, sanitize errors and halt remaining work globally', async () => {
  for (const kind of ['progress', 'diagnostics', 'diagnostics-shape']) {
    let count = 0; const marker = 'SYNTHETIC_PRIVATE_CALLBACK_ERROR';
    const options = { model: model(), directory: directory() };
    if (kind === 'progress') options.onProgress = async () => { if (++count === 3) throw new Error(marker); };
    else options.readDiagnostics = async () => { if (++count === 3) { if (kind === 'diagnostics-shape') return {}; throw new Error(marker); } return []; };
    const report = await runOrderedHistoryAudit(options); assert.equal(report.evidence.status, 'failed');
    const window = temporal(report).windows[0]; assert.equal(window.capture.ok, true); assert.ok(window.records.length > 0); assert.equal(window.status, 'failed');
    assert.ok(temporal(report).windows.slice(1).every((w) => w.status === 'not_run'));
    assert.ok(report.evidence.cases.slice(2).every((entry) => entry.windows.every((w) => w.status === 'not_run') && entry.recalls.every((r) => r.status === 'not_run')));
    assert.equal(JSON.stringify(report).includes(marker), false); failed(scoreOrderedHistoryAudit(report));
  }
});

test('H3 failed recall envelopes remain attempted failures with fixed denominator accounting', async () => {
  const report = await runOrderedHistoryAudit({ model: model({ failRecall: true }), directory: directory() });
  assert.equal(report.evidence.status, 'failed');
  for (const entry of report.evidence.cases) for (const query of entry.recalls) { assert.equal(query.status, 'failed'); assert.equal(query.result.ok, false); }
  failed(scoreOrderedHistoryAudit(report));
});
