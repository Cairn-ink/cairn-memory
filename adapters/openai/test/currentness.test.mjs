import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { currentnessCases } from '../../../evaluations/currentness-cases.mjs';
import { currentnessRubric } from '../../../evaluations/currentness-rubric.mjs';
import { CURRENTNESS_ORDERING, CURRENTNESS_REPORT_VERSION, runCurrentnessAudit } from '../../../evaluations/currentness-runner.mjs';
import { currentnessReportDigest, currentnessReviewVersion, scoreCurrentnessAudit } from '../../../evaluations/currentness-score.mjs';
import { captureAuditSnapshot } from '../../../evaluations/capture-audit-support.mjs';

const directory = () => mkdtempSync(join(tmpdir(), 'cairn-currentness-test-'));
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });
const records = window => window.snapshots.flatMap(snapshot => snapshot.records);
const failed = score => {
  assert.equal(score.status, 'failed', JSON.stringify(score));
  for (const [key, value] of Object.entries({ cases: 7, windows: 15, queries: 9, requiredFacts: 19, forbiddenFacts: 15 })) assert.equal(score.metrics[key], value, key);
  assert.ok(score.errors.length); assert.doesNotThrow(() => JSON.stringify(score));
  for (const value of Object.values(score.metrics)) assert.ok(Number.isFinite(value));
};

// These source-text decisions and all-true labels test mechanics, not model quality.
// The model never reads the case list, rubric, review, namespace keys or case IDs.
function model(options = {}) {
  const calls = []; let extraction = 0;
  const record = (method, input) => calls.push({ method, input: structuredClone(input) });
  return { calls, contextWindow: 100000, countTokens: () => 1,
    async extract({ input }) {
      record('extract', input); extraction++;
      if (extraction === options.failExtraction) throw new Error('PRIVATE_SYNTHETIC_FAILURE');
      if (input.messages.some(m => /only a proposal|uncertain and not confirmed/u.test(m.content))) return { items: [] };
      return { items: input.messages.filter(m => m.role === 'user').map(m => ({
        content: m.content, kind: /quoted note|retrospective|disagreement/u.test(m.content) ? 'context' : 'fact',
        confidence: 0.8, sourceIndices: [m.index],
      })) };
    },
    async reconcile({ input }) {
      record('reconcile', input);
      if (options.failReconcile) throw new Error('PRIVATE_SYNTHETIC_FAILURE');
      if (options.noTransitions) return { transitions: [] };
      const transitions = [];
      for (const item of input.items) {
        const predecessor = item.content.startsWith('Confirmed update:')
          ? input.candidates.find(c => c.content === 'Harbor team review happens on Friday.')
          : item.content === 'Harbor deployment now happens on Monday, replacing Wednesday.'
            ? input.candidates.find(c => c.content === 'Harbor deployment happens on Wednesday.') : undefined;
        if (predecessor) transitions.push({ replacementIndex: item.index, predecessorIndex: predecessor.index, evidenceIndices: item.sourceIndices });
      }
      return { transitions };
    },
    async classify({ input }) {
      record('classify', input);
      if (options.failClassification) throw new Error('PRIVATE_SYNTHETIC_FAILURE');
      return { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [],
        ...(options.unfiled ? {} : { newL1: { title: `Topic ${createHash('sha256').update(memory.content).digest('hex').slice(0, 16)}`, parentL2Ids: [] } }) })) };
    },
    async select({ input }) {
      record('select', input);
      if (options.failRecall) throw new Error('PRIVATE_SYNTHETIC_FAILURE');
      return { refs: input.maps.flatMap(map => map.items.flatMap(entry => entry.type === 'unfiled'
        ? [{ namespaceIndex: map.namespaceIndex, ...entry.ref }]
        : entry.type === 'ref' && entry.ref.childType === 'memory'
          ? [{ namespaceIndex: map.namespaceIndex, memoryId: entry.ref.childId, revision: entry.ref.childRevision }] : [])) };
    },
    async rank({ input }) {
      record('rank', input);
      const relevant = content => input.query.includes('deployment') ? content.startsWith('Harbor deployment')
        : input.query.includes('Alice and Bob') ? /^(Alice|Bob|Their disagreement)/u.test(content)
          : !/deployment|retrospective|quoted note/u.test(content);
      return { refs: input.candidates.filter(c => relevant(c.memory.content)).map(c => ({ namespaceIndex: c.namespaceIndex, ...ref(c.memory) })) };
    },
  };
}

// Separate evaluator-only synthetic labels; never passed to any model port.
function review(report, allowWrongStateEvidence = false) {
  const value = { version: currentnessReviewVersion, reviewerType: 'agent', reportDigest: currentnessReportDigest(report), assertions: [], required: [], forbidden: [], queries: [] };
  const requiredBodies = [
    [/^Confirmed update:/u, /Friday/u], [/Friday/u], [/^Alice/u, /^Bob/u],
    [/^Harbor team review/u, /^Harbor deployment now/u, /^Juniper/u, /Wednesday/u],
    [/Friday/u, /Monday/u], [/^Harbor team review/u], [/^Harbor team review/u],
  ];
  for (const [caseIndex, entry] of report.cases.entries()) {
    const seen = new Set();
    for (const window of entry.windows) for (const snapshot of window.snapshots ?? []) for (const { memory } of snapshot.records) {
      const identity = { caseId: entry.id, namespaceKey: snapshot.key, ...ref(memory) }; const key = JSON.stringify(identity);
      if (!seen.has(key)) value.assertions.push({ ...identity, supported: true, currentnessValid: true, retirementJustified: memory.state === 'historical' ? true : null });
      seen.add(key);
    }
    const rubric = currentnessRubric[caseIndex];
    rubric.required.forEach((requirement, requiredIndex) => {
      let evidence = [];
      if (requirement.kind === 'memory') {
        const snapshot = entry.windows.at(-1).snapshots.find(s => s.key === requirement.namespaceKey);
        const match = snapshot.records.find(r => (allowWrongStateEvidence || r.memory.state === requirement.state) && requiredBodies[caseIndex][requiredIndex].test(r.memory.content));
        assert.ok(match, `${entry.id} required ${requiredIndex}`);
        evidence = [{ namespaceKey: snapshot.key, ...ref(match.memory) }];
      }
      value.required.push({ caseId: entry.id, requiredIndex, met: true, evidence });
    });
    rubric.forbidden.forEach((_, forbiddenIndex) => value.forbidden.push({ caseId: entry.id, forbiddenIndex, absent: true }));
    for (const recall of entry.recalls) value.queries.push({ caseId: entry.id, queryId: recall.id, answered: true,
      relevance: recall.result.value.memories.map(({ memory }) => ({ ...ref(memory), relevant: true })) });
  }
  return value;
}
let cached;
const positive = () => cached ??= (async () => {
  const scripted = model(); const dir = directory(); const report = await runCurrentnessAudit({ model: scripted, directory: dir });
  assert.equal(report.status, 'completed', JSON.stringify(report)); return { report, calls: scripted.calls, dir };
})();

test('N1 frozen new sources and seven prior evidence files remain byte-identical', () => {
  const pins = {
    'evaluations/currentness-cases.mjs': 'c03e3cbe8911d6afb73282ad748b4caf36922018b8fde7b94d02707f30853da2',
    'evaluations/currentness-rubric.mjs': '19eb813ba3a070f75ed03e2b144cc4ec6786e6014403c815de365180e2166805',
    'evaluations/history-cases.mjs': '13c2bc8b0492054869c9aab94de14a3438b08cbc81d2e9140f89f38fe6f4383f',
    'evaluations/history-rubric.mjs': 'c84b060d8b37f10ca9d0511bad254fff922814e796c88835ba878bf0452e9e75',
    'evaluations/history-runner.mjs': '614b67d252611836c3bf9b2f4e6a17d5053cfa60ac70a053af063df90b004429',
    'evaluations/history-score.mjs': '62c5c2ed3b6ef4a713824d6c6fb39fb714071f5dab46846eee46d727739832f7',
    'evaluations/results/conversation-history-v1.json': 'b3244a104c483f029fc9751c68cf9766798c5cfc54e2cce5e95d6f19e93c14a8',
    'evaluations/results/conversation-history-v1-review.json': '323e2d94ddeb9117c95a825fc73af022408ff0b214691f98d44649bf2a1eb9cd',
    'docs/evidence/conversation-history-accounting.json': '8394f3c61f5855dbed585701fb67f206748b6e14e9dce5d73a4aae45f9a53299',
  };
  for (const [path, digest] of Object.entries(pins)) assert.equal(createHash('sha256').update(readFileSync(new URL(`../../../${path}`, import.meta.url))).digest('hex'), digest, path);
  for (const value of [currentnessCases, currentnessRubric]) {
    const frozen = v => { if (v && typeof v === 'object') { assert.ok(Object.isFrozen(v)); Object.values(v).forEach(frozen); } }; frozen(value);
  }
});

test('N2 actual captures, MOC filing and cold reopen preserve two justified retirements', async () => {
  const { report } = await positive();
  assert.deepEqual(Object.keys(report).sort(), ['cases', 'ordering', 'sourceVersion', 'status', 'version']);
  assert.equal(report.version, CURRENTNESS_REPORT_VERSION); assert.deepEqual(report.ordering, CURRENTNESS_ORDERING);
  assert.equal(report.cases.length, 7); assert.equal(report.cases.flatMap(c => c.windows).length, 15); assert.equal(report.cases.flatMap(c => c.recalls).length, 9);
  for (const entry of report.cases) {
    const sequences = new Map();
    for (const window of entry.windows) {
      const sequence = (sequences.get(window.namespaceKey) ?? 0) + 1; sequences.set(window.namespaceKey, sequence);
      assert.deepEqual(window.causal, { streamId: `currentness-v1-${entry.id}-${window.namespaceKey}`, sequence });
      assert.deepEqual(window.snapshots, window.reopenedSnapshots); assert.equal(window.receiptBindingsValid, true); assert.equal(window.reopenPersisted, true);
      assert.deepEqual(window.messages, currentnessCases.find(c => c.id === entry.id).windows[window.index].messages);
    }
  }
  for (const caseIndex of [0, 3]) {
    const entry = report.cases[caseIndex]; const window = entry.windows.at(-1); const old = records(window).find(r => r.memory.state === 'historical');
    const successor = records(window).find(r => r.memory.id === old.supersession.replacement.memoryId);
    assert.equal(old.supersession.replacement.revision, 1); assert.equal(successor.memory.revision, 2);
    assert.equal(window.capture.value.admission.memories.find(m => m.id === successor.memory.id).revision, 1);
    assert.equal(old.supersession.replacement.currentRevision, 2); assert.equal(old.supersession.replacement.state, 'active');
    assert.deepEqual(old.receipts, records(entry.windows[0]).find(r => r.memory.id === old.memory.id).receipts);
    assert.deepEqual(old.supersession.receiptIds, successor.receipts.map(r => r.id));
    assert.equal(window.capture.value.reconciliation.retiredCount, 1);
  }
  assert.equal(scoreCurrentnessAudit(report, { review: review(report) }).status, 'passed');
});

test('N5 attributed quotation and injection context may remain active without adopting their schedules', async () => {
  const { report } = await positive();
  for (const index of [5, 6]) {
    const entry = report.cases[index]; const final = records(entry.windows.at(-1));
    assert.equal(final.length, 2); assert.ok(final.every(r => r.memory.state === 'active'));
    assert.ok(final.some(r => r.memory.kind === 'context')); assert.equal(entry.windows.at(-1).capture.value.reconciliation.retiredCount, 0);
  }
  const labels = review(report); assert.equal(labels.required.length, 19); assert.equal(labels.forbidden.length, 15);
  assert.equal(scoreCurrentnessAudit(report, { review: labels }).status, 'passed');
});

test('N2 two namespaces share an actual database but retain and recall only their own evidence', async () => {
  const { report, dir } = await positive(); const entry = report.cases[4];
  const database = new DatabaseSync(join(dir, `${entry.id}.sqlite`), { readOnly: true });
  try { assert.equal(database.prepare('SELECT DISTINCT project_id FROM memories').all().length, 2); } finally { database.close(); }
  assert.deepEqual(entry.windows[0].snapshots[0], entry.windows[1].snapshots[0]);
  assert.equal(entry.windows[0].snapshots[1].records.length, 0);
  for (const recall of entry.recalls) {
    const ns = entry.namespaces.find(n => n.key === recall.namespaceKey).namespace;
    assert.equal(recall.result.value.memories.length, 1);
    assert.deepEqual(recall.result.value.memories[0].memory.namespace, ns);
    assert.match(recall.result.value.memories[0].memory.content, recall.namespaceKey === 'primary' ? /Friday/u : /Monday/u);
  }
});

test('N3 model ports receive sources and legitimate navigation refs, never evaluator or ordering oracles', async () => {
  const { calls } = await positive(); const forbidden = new Set(['required', 'forbidden', 'review', 'assertions', 'requiredIndex', 'namespaceKey', 'caseId', 'causal', 'streamId', 'reportDigest']);
  const walk = (value, hidden = forbidden) => { if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { assert.ok(!hidden.has(key), key); walk(child, hidden); } };
  for (const call of calls) {
    walk(call.input);
    if (['extract', 'reconcile'].includes(call.method)) {
      for (const entry of currentnessCases) assert.ok(!JSON.stringify(call.input).includes(entry.id));
      walk(call.input, new Set(['id', 'memoryId', 'revision', 'namespace', 'eventId', 'sessionId']));
    }
  }
  assert.equal(calls.filter(c => c.method === 'extract').length, 15);
  const source = readFileSync(new URL('../../../evaluations/currentness-runner.mjs', import.meta.url), 'utf8');
  for (const name of ['currentness-rubric', 'currentness-score', 'currentness-review']) assert.ok(!source.includes(name));
});

test('N2 strict options and unsafe directories reject before file creation or model calls', async () => {
  const scripted = model();
  for (const patch of [{ cases: currentnessCases }, { cases: [...currentnessCases].reverse() }, { ordering: {} }, { model: null }, { onProgress: 1 }, { readDiagnostics: [] }]) {
    const dir = directory(); await assert.rejects(runCurrentnessAudit({ model: scripted, directory: dir, ...patch })); assert.deepEqual(readdirSync(dir), []);
  }
  for (const kind of ['symbol', 'nonenumerable', 'prototype']) {
    const dir = directory(); const options = { model: scripted, directory: dir };
    if (kind === 'symbol') options[Symbol('unknown')] = true;
    if (kind === 'nonenumerable') Object.defineProperty(options, 'unknown', { value: true });
    if (kind === 'prototype') Object.setPrototypeOf(options, { unknown: true });
    await assert.rejects(runCurrentnessAudit(options)); assert.deepEqual(readdirSync(dir), []);
  }
  const occupied = directory(); writeFileSync(join(occupied, 'synthetic'), 'occupied');
  const permissive = directory(); chmodSync(permissive, 0o755);
  const link = join(directory(), 'link'); symlinkSync(directory(), link);
  for (const dir of [occupied, permissive, link]) await assert.rejects(runCurrentnessAudit({ model: scripted, directory: dir }));
  assert.equal(scripted.calls.length, 0);
});

test('N3 failed capture, classification, judgment and recall retain attempted and not-run identities', async () => {
  for (const options of [{ failExtraction: 2 }, { failClassification: true }, { failReconcile: true }, { failRecall: true }]) {
    const report = await runCurrentnessAudit({ model: model(options), directory: directory() });
    assert.equal(report.status, 'failed'); assert.equal(report.cases.flatMap(c => c.windows).length, 15); assert.equal(report.cases.flatMap(c => c.recalls).length, 9);
    assert.ok(report.cases[0].windows.some(w => w.status === 'failed') || report.cases[0].recalls.some(q => q.status === 'failed'));
    assert.ok(!JSON.stringify(report).includes('PRIVATE_SYNTHETIC_FAILURE'));
    if (!options.failClassification && !options.failRecall) assert.equal(report.cases[4].status, 'completed');
    failed(scoreCurrentnessAudit(report, { review: {} }));
  }
});

test('N3 callback failures preserve the attempted window and globally retain not-run operations', async () => {
  for (const key of ['onProgress', 'readDiagnostics']) {
    const report = await runCurrentnessAudit({ model: model(), directory: directory(), [key]: () => { throw new Error('PRIVATE_SYNTHETIC_FAILURE'); } });
    assert.equal(report.status, 'failed'); assert.notEqual(report.cases[0].windows[0].status, 'not_run');
    assert.ok(report.cases.slice(1).every(c => c.windows.every(w => w.status === 'not_run') && c.recalls.every(q => q.status === 'not_run')));
    assert.equal(report.cases.flatMap(c => c.windows).length, 15); assert.equal(report.cases.flatMap(c => c.recalls).length, 9);
    assert.ok(!JSON.stringify(report).includes('PRIVATE_SYNTHETIC_FAILURE'));
  }
});

test('N3 shared snapshot pagination retains already observed records and receipts when later pages fail', () => {
  const namespace = { ownerId: 'synthetic', scope: 'personal' };
  const memory = { id: 'synthetic-memory', revision: 1 }; const firstReceipt = { id: 'synthetic-receipt' };
  for (const failure of ['receipt', 'list']) {
    const observed = [];
    const core = {
      list({ cursor }) {
        if (cursor) throw new Error('synthetic later list page');
        return { memories: [memory], ...(failure === 'list' ? { nextCursor: 'next-list' } : {}) };
      },
      get({ receiptCursor }) {
        if (receiptCursor) throw new Error('synthetic later receipt page');
        return { memory, receipts: [firstReceipt], ...(failure === 'receipt' ? { nextReceiptCursor: 'next-receipt' } : {}) };
      },
    };
    assert.throws(() => captureAuditSnapshot(core, namespace, observed, value => value), /synthetic later/u);
    assert.deepEqual(observed, [{ memory, receipts: [firstReceipt] }]);
  }
});

test('N4 malformed reports and review accessors fail finitely with fixed denominators', async () => {
  const { report } = await positive();
  for (const candidate of [null, {}, [], { ...report, cases: [] }]) failed(scoreCurrentnessAudit(candidate, { review: {} }));
  for (const options of [null, [], false, {}, { review: null }, { review: review(report), unknown: true },
    new Proxy({}, { ownKeys() { throw new Error('PRIVATE_SYNTHETIC_FAILURE'); } }),
    { get review() { throw new Error('PRIVATE_SYNTHETIC_FAILURE'); } }]) {
    const result = scoreCurrentnessAudit(report, options); failed(result); assert.ok(!JSON.stringify(result).includes('PRIVATE_SYNTHETIC_FAILURE'));
  }
});

test('N4 raw source, namespace, reopen, admission and relation tampering cannot be self-certified', async () => {
  const { report } = await positive();
  const hiddenRawField = r => {
    const window = r.cases[0].windows[1];
    for (const snapshots of [window.snapshots, window.reopenedSnapshots]) {
      Object.defineProperty(snapshots[0].records[0], 'hidden', { value: 'undeclared raw evidence', enumerable: false });
    }
  };
  const mutations = [
    r => r.cases.reverse(),
    r => r.cases[0].windows[1].messages[0].content = 'Forged source',
    r => r.cases[0].windows[1].causal.sequence = 3,
    r => r.cases[0].windows[1].reopenedSnapshots[0].records.pop(),
    r => records(r.cases[0].windows[1]).find(x => x.memory.state === 'historical').supersession.replacement.revision = 2,
    r => records(r.cases[0].windows[1]).find(x => x.memory.state === 'historical').supersession.receiptIds = ['forged'],
    r => records(r.cases[0].windows[1]).find(x => x.memory.state === 'historical').supersession.replacement.memoryId = 'foreign',
    r => records(r.cases[0].windows[1]).find(x => x.memory.state === 'historical').memory.content = 'Altered predecessor',
    r => records(r.cases[0].windows[1]).find(x => x.memory.state === 'active').receipts[0].excerpt = 'Forged receipt',
    r => r.cases[0].windows[1].capture.value.admission.memories = [],
    r => r.cases[0].windows[1].capture.value.admission.memories.push(structuredClone(r.cases[0].windows[1].capture.value.admission.memories[0])),
    r => r.cases[0].windows[1].capture.value.admission.memories[0].revision = 2,
    r => r.cases[0].windows[1].capture.value.reconciliation.retiredCount = 6,
    r => r.cases[4].windows[1].snapshots[0].records[0].memory.revision++,
    r => r.cases[4].recalls[0].result.value.memories = structuredClone(r.cases[4].recalls[1].result.value.memories),
    r => r.cases[0].windows[1].snapshots.push({ key: 'forged', namespace: { ownerId: 'foreign', scope: 'personal' }, records: [] }),
    r => r.cases[0].windows[1].snapshots[0].records = records(r.cases[0].windows[1]).filter(x => x.memory.state !== 'historical'),
    r => records(r.cases[0].windows[1]).find(x => x.memory.state === 'historical').memory.state = 'active',
    r => delete records(r.cases[0].windows[1]).find(x => x.memory.state === 'historical').supersession,
    r => r.cases[0].windows[1].snapshots[0].records = records(r.cases[0].windows[1]).filter(x => x.memory.state !== 'active'),
    r => r.cases[0].windows[1].capture.value.admission.memories[0].unknown = true,
    r => r.cases[4].windows[1].snapshots[1].records[0].receipts = structuredClone(r.cases[4].windows[1].snapshots[0].records[0].receipts),
    r => r.cases[0].recalls[0].result.value.memories = [],
    hiddenRawField,
  ];
  for (const [index, mutate] of mutations.entries()) {
    const candidate = structuredClone(report); const labels = review(candidate); mutate(candidate);
    // Hidden fields are installed on both copies explicitly: structuredClone
    // would strip them and stop exercising the exact raw wrapper contract.
    if (index !== 3 && mutate !== hiddenRawField) for (const c of candidate.cases) for (const w of c.windows) w.reopenedSnapshots = structuredClone(w.snapshots);
    labels.reportDigest = currentnessReportDigest(candidate);
    failed(scoreCurrentnessAudit(candidate, { review: labels }));
  }
});

test('N5 digest binding, complete assertion labels and final-memory evidence are mandatory', async () => {
  const { report } = await positive();
  const mutations = [
    l => l.reportDigest = '0'.repeat(64), l => l.assertions.pop(), l => l.assertions.push(l.assertions[0]),
    l => l.assertions.find(a => a.retirementJustified === true).retirementJustified = false,
    l => l.assertions[0].supported = false, l => l.assertions[0].currentnessValid = false,
    l => l.assertions.find(a => a.retirementJustified === null).retirementJustified = true,
    l => l.required[0].evidence = [], l => l.required[0].met = false,
    l => l.required[1].evidence = [{ namespaceKey: 'primary', ...ref(records(report.cases[0].windows[0])[0].memory) }],
    l => l.required.find(r => r.evidence.length === 0).evidence = [{ namespaceKey: 'primary', memoryId: 'forged', revision: 1 }],
    l => l.forbidden[0].absent = false, l => l.queries[0].answered = false,
    l => l.queries[0].relevance.pop(), l => l.queries[0].relevance[0].relevant = false,
    l => l.required.push(l.required[0]), l => l.forbidden.pop(), l => l.queries.pop(),
    l => { const original = l.assertions[0].caseId; l.assertions[0].caseId = { toJSON: () => original }; },
    l => { const original = l.assertions[0].revision; l.assertions[0].revision = { toJSON: () => original }; },
    l => l.assertions[0][Symbol('unknown')] = true,
    l => Object.defineProperty(l.assertions[0], 'unknown', { value: true }),
    l => { const original = l.required[0].evidence[0].memoryId; l.required[0].evidence[0].memoryId = { toJSON: () => original }; },
    l => { const original = l.forbidden[0].caseId; l.forbidden[0].caseId = { toJSON: () => original }; },
    l => { const original = l.queries[0].relevance[0].revision; l.queries[0].relevance[0].revision = { toJSON: () => original }; },
    l => l[Symbol('unknown')] = true,
    l => Object.defineProperty(l, 'unknown', { value: true }),
  ];
  assert.equal(currentnessReportDigest(report), createHash('sha256').update(JSON.stringify(report), 'utf8').digest('hex'));
  for (const mutate of mutations) { const labels = review(report); mutate(labels); failed(scoreCurrentnessAudit(report, { review: labels })); }
  failed(scoreCurrentnessAudit(report, { review: { version: currentnessReviewVersion, reviewerType: 'agent', reportDigest: currentnessReportDigest(report), status: 'passed' } }));
});

test('N6 unfiled actual-core route also passes mechanical review without manual supersede or repair', async () => {
  const report = await runCurrentnessAudit({ model: model({ unfiled: true }), directory: directory() });
  assert.equal(report.status, 'completed'); assert.equal(scoreCurrentnessAudit(report, { review: review(report) }).status, 'passed');
});

test('N4 complete_no_change and confident metadata cannot replace the required physical retirements', async () => {
  const report = await runCurrentnessAudit({ model: model({ noTransitions: true }), directory: directory() });
  assert.equal(report.status, 'completed');
  assert.ok(report.cases.every(c => c.windows.every(w => w.capture.value.reconciliation.retiredCount === 0)));
  // Fresh labels reference this report's real IDs, but cannot turn active rows
  // into the required history merely by claiming that every requirement is met.
  const labels = review(report, true);
  failed(scoreCurrentnessAudit(report, { review: labels }));
});
