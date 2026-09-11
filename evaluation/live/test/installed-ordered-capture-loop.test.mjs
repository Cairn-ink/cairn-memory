import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { chmodSync, mkdtempSync, readFileSync, readdirSync, statSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { ORDERED_CAPTURE_LOOP_FIXTURE as fixture, ORDERED_CAPTURE_LOOP_VERSION,
  inspectOrderedCaptureLoopStage, runInstalledOrderedCaptureLoop } from '../installed-ordered-capture-loop.mjs';
import { startExperimentProxy } from '../proxy.mjs';

// Only four public selectors are read. No provider key, real ledger or user data.
const selectors = ['CAIRN_NODE', 'CAIRN_EXECUTABLE', 'CAIRN_ARTIFACT', 'CAIRN_ARTIFACT_SHA256'];
const selected = Object.fromEntries(selectors.map(key => [key, process.env[key]]));
const missing = selectors.filter(key => !selected[key]);
const gate = { skip: missing.length ? `set ${missing.join(', ')} for installed offline gate` : false, timeout: 120_000 };
const directory = () => mkdtempSync(join(tmpdir(), 'cairn-installed-ordered-test-'));
const friday = 'The Harbor team holds its review on Friday.';
const monday = 'The Harbor team now holds its review on Monday.';
const extra = 'The user explicitly described a change to the review schedule.';
const stages = ['A', 'B', 'C', 'D', 'E', 'F'];
const bad = code => ({ ok: false, error: { code, retryable: false } });

// HTTP choices are source-text scripts, not measured semantic judgments. Core,
// adapter, tokenizer, proxy and every MCP consumer are actual installed code.
function fakeSession(options = {}) {
  const calls = []; let reads = 0;
  return { calls,
    getState() {
      reads++;
      if (reads === options.failBudgetRead) throw new Error('PRIVATE_SYNTHETIC_FAILURE');
      return { requestCount: calls.length, reservedMicroUsd: 0, limitMicroUsd: 1, requestCap: 200 };
    },
    async request(route, encoded) {
      const body = JSON.parse(encoded); const method = body.text?.format?.name;
      const input = JSON.parse(body.input[0].content[0].text);
      calls.push({ route, model: body.model, method, input });
      if (route === '/responses/input_tokens') return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      assert.equal(route, '/responses');
      let output;
      if (method === 'cairn_extract') {
        assert.equal(body.model, 'gpt-5.4-mini-2026-03-17');
        const update = input.messages[0].content.startsWith('Confirmed update:');
        output = { items: options.empty ? [] : [{ content: update ? monday : friday, kind: 'fact', confidence: 0.8,
          sourceIndices: options.badSource ? [99] : [0] }, ...(update && options.extra ? [{ content: extra, kind: 'context', confidence: 0.8, sourceIndices: [0] }] : [])] };
      } else if (method === 'cairn_reconcile') {
        if (options.failReconcile) return Response.json({ error: { message: 'PRIVATE_SYNTHETIC_FAILURE' } }, { status: 503 });
        output = { transitions: options.noTransition ? [] : [{ replacementIndex: 0, predecessorIndex: options.forgedPredecessor ? 99 : 0,
          evidenceIndices: options.forgedEvidence ? [99] : [0], ...(options.forgedField ? { memoryId: 'forged-memory' } : {}) }] };
      } else if (method === 'cairn_classify') {
        output = options.badClassification ? { items: [{ memoryId: 'forged-memory', parentIds: [] }] }
          : { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [], ...(options.unfiled ? {} : {
            newL1: { title: `Topic ${createHash('sha256').update(memory.content).digest('hex').slice(0, 16)}`, parentL2Ids: [] },
          }) })) };
      } else if (method === 'cairn_select') {
        output = { refs: input.maps.flatMap(map => map.items.flatMap(item => item.type === 'unfiled'
          ? [{ namespaceIndex: map.namespaceIndex, ...item.ref }]
          : item.type === 'ref' && item.ref.childType === 'memory'
            ? [{ namespaceIndex: map.namespaceIndex, memoryId: item.ref.childId, revision: item.ref.childRevision }] : [])) };
      } else {
        assert.equal(method, 'cairn_rank');
        output = { refs: input.candidates.filter(item => item.memory.content !== extra).map(item => ({ namespaceIndex: item.namespaceIndex,
          memoryId: item.memory.id, revision: item.memory.revision })) };
      }
      return Response.json({ object: 'response', model: body.model, status: 'completed', error: null, incomplete_details: null,
        output: [{ type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } });
    },
  };
}
function options(session) {
  return { session, nodePath: selected.CAIRN_NODE, cairnExecutable: selected.CAIRN_EXECUTABLE,
    cairnArtifact: selected.CAIRN_ARTIFACT, cairnArtifactSha256: selected.CAIRN_ARTIFACT_SHA256, privateDirectory: directory() };
}
const runs = new Map();
function positive(unfiled = false) {
  if (!runs.has(unfiled)) runs.set(unfiled, (async () => {
    const session = fakeSession({ unfiled, extra: true }); const configuration = options(session);
    const report = await runInstalledOrderedCaptureLoop(configuration);
    assert.equal(report.status, 'mechanical_pass_pending_semantic_review', JSON.stringify({
      directory: configuration.privateDirectory, status: report.status,
      stages: report.stages.map(({ stage, status, errors }) => ({ stage, status, errors })), errors: report.errors,
    }));
    return { report, session, directory: configuration.privateDirectory };
  })());
  return runs.get(unfiled);
}
function assertFailed(report) {
  assert.equal(report.status, 'failed'); assert.deepEqual(report.stages.map(s => s.stage), stages);
  assert.ok(!JSON.stringify(report).includes('PRIVATE_SYNTHETIC_FAILURE'));
}
function synchronizeSnapshot(snapshot) {
  // Only coherent one-page installed fixtures use this helper. Mirror a forged
  // raw row into its retained tool/list representations so cross-field equality
  // alone cannot hide a missing provenance or lifecycle validation.
  for (const record of snapshot.records) {
    const pages = snapshot.getPages.find(entry => entry.memoryId === record.memory.id).pages;
    assert.equal(pages.length, 1);
    Object.assign(pages[0].value, { memory: structuredClone(record.memory), receipts: structuredClone(record.receipts) });
    if (record.supersession) pages[0].value.supersession = structuredClone(record.supersession);
    else delete pages[0].value.supersession;
    const metadata = snapshot.listPages.flatMap(page => page.value.memories).find(item => item.id === record.memory.id);
    for (const key of Object.keys(metadata)) if (Object.hasOwn(record.memory, key)) metadata[key] = structuredClone(record.memory[key]);
  }
}

test('I1 new protocol and nine prior source/evidence SHA256 pins are unchanged', () => {
  const pins = {
    'evaluation/live/installed-ordered-fixture.mjs': '45a0e45bc8913712d4e59ab29515859057c1bc648439fd47ffa618dd764a3b01',
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
  const frozen = value => { if (value && typeof value === 'object') { assert.ok(Object.isFrozen(value)); Object.values(value).forEach(frozen); } }; frozen(fixture);
});

for (const unfiled of [false, true]) test(`I2/I3 installed ${unfiled ? 'unfiled' : 'real MOC'} capture and seven fresh MCP processes complete the lifecycle`, gate, async () => {
  const { report, session, directory: dir } = await positive(unfiled);
  assert.equal(report.version, ORDERED_CAPTURE_LOOP_VERSION); assert.deepEqual(report.fixture, fixture);
  assert.deepEqual(report.stages.map(s => [s.stage, s.status]), stages.map(s => [s, 'completed']));
  assert.ok(report.stages.every(s => s.verdict.passedAutomated && s.verdict.semanticReviewRequired));
  const [a, b, c, d, e, f] = report.stages;
  const processIds = [...report.stages.slice(1).map(s => s.consumerSessionId), b.isolation.consumerSessionId, b.projectIsolation.consumerSessionId];
  assert.equal(new Set(processIds).size, 7); assert.ok(processIds.every(id => typeof id === 'string' && id.length));
  const first = a.windows[0].snapshot.records[0]; const final = a.windows[1].snapshot.records;
  const old = final.find(r => r.memory.id === first.memory.id); const current = final.find(r => r.memory.id === old.supersession.replacement.memoryId);
  assert.equal(first.memory.content, friday); assert.equal(first.receipts[0].excerpt, fixture.first);
  assert.notEqual(first.memory.content, first.receipts[0].excerpt); assert.equal(current.memory.content, monday);
  assert.equal(old.memory.state, 'historical'); assert.deepEqual(old.receipts, first.receipts);
  assert.equal(old.supersession.replacement.revision, 1); assert.equal(current.memory.revision, unfiled ? 1 : 2);
  assert.equal(a.windows[1].capture.value.admission.memories.find(m => m.id === current.memory.id).revision, 1);
  for (const [index, window] of a.windows.entries()) {
    assert.deepEqual(window.source, fixture.windows[index]); assert.deepEqual(window.snapshot.records, window.reopenedSnapshot.records);
    assert.ok(window.snapshot.listPages.length); assert.ok(window.snapshot.getPages.length);
  }
  assert.equal(a.windows[1].capture.value.reconciliation.retiredCount, 1);
  for (const isolation of [b.isolation, b.projectIsolation]) {
    assert.deepEqual(isolation.listPages.flatMap(p => p.value.memories), []);
    assert.equal(isolation.get.error.code, 'memory_not_found'); assert.equal(isolation.correct.error.code, 'memory_not_found');
    assert.equal(isolation.forget.value.forgotten, false); assert.deepEqual(isolation.after.value.memory, b.current.value.memory);
    assert.deepEqual(isolation.historyAfter.value.supersession, b.history.value.supersession);
  }
  assert.equal(c.mutationArguments.memoryId, c.current.value.memory.id); assert.equal(c.mutationArguments.expectedRevision, c.current.value.memory.revision);
  assert.equal(c.after.value.memory.revision, current.memory.revision + 1); assert.equal(c.after.value.memory.content, fixture.correction);
  assert.equal(c.stale.error.code, 'revision_conflict'); assert.equal(e.stale.error.code, 'revision_conflict');
  for (const record of [c, d, e]) {
    assert.deepEqual(record.history.value.receipts, old.receipts);
    assert.deepEqual(record.history.value.supersession.receiptIds, []); assert.equal(record.history.value.supersession.evidenceAvailable, false);
  }
  assert.equal(e.mutation.value.forgotten, true); assert.equal(e.after.error.code, 'memory_not_found');
  assert.deepEqual(f.recall.value.memories, []); assert.equal(f.recall.value.coverage, 'complete'); assert.equal(f.after.error.code, 'memory_not_found');
  assert.deepEqual(f.history.value.supersession, { previousRevision: old.supersession.previousRevision, replacement: null, receiptIds: [], evidenceAvailable: false });
  const extraBefore = final.find(r => r.memory.content === extra); const extraAfter = f.snapshot.records.find(r => r.memory.id === extraBefore.memory.id);
  for (const field of ['id', 'content', 'revision', 'state']) assert.equal(extraAfter.memory[field], extraBefore.memory[field]);
  assert.deepEqual(extraAfter.receipts, extraBefore.receipts); assert.equal(f.snapshot.records.length, 2);
  assert.equal(report.provenance.artifactSha256, selected.CAIRN_ARTIFACT_SHA256);
  for (const path of ['core/contract.mjs', 'adapters/openai/index.mjs']) assert.ok(report.provenance.sourceHashes[path]);
  assert.ok(session.calls.some(call => call.method === 'cairn_reconcile' && call.route === '/responses'));
  assert.ok(session.calls.some(call => call.route === '/responses/input_tokens'));
  assert.equal(report.budgetBefore.requestCount, 0); assert.equal(report.budgetAfter.requestCount, session.calls.length);
  for (const file of readdirSync(dir).filter(name => name.endsWith('.json'))) assert.equal(statSync(join(dir, file)).mode & 0o777, 0o600);
  assert.equal(JSON.parse(readFileSync(join(dir, 'report.json'), 'utf8')).status, report.status);
});

test('I2 model-facing source/extraction/judgment input has no producer IDs or evaluation oracles', gate, async () => {
  const { report, session } = await positive();
  const forbidden = new Set(['expected', 'expectedIds', 'review', 'required', 'forbidden', 'assertions', 'semanticReview', 'causal', 'streamId']);
  const walk = (value, keys) => { if (value && typeof value === 'object') for (const [key, child] of Object.entries(value)) { assert.ok(!keys.has(key), key); walk(child, keys); } };
  for (const call of session.calls) {
    walk(call.input, forbidden);
    if (['cairn_extract', 'cairn_reconcile'].includes(call.method)) {
      walk(call.input, new Set(['id', 'memoryId', 'revision', 'namespace', 'sessionId', 'eventId']));
      assert.ok(!JSON.stringify(call.input).includes(report.namespace.ownerId));
    }
  }
});

test('I3 inspector recomputes all six verdicts from actual envelopes and advances state only on success', gate, async () => {
  const { report } = await positive(); const state = {};
  for (const record of report.stages) assert.deepEqual(inspectOrderedCaptureLoopStage(record.stage, record, state), {
    stage: record.stage, passedAutomated: true, semanticReviewRequired: true,
  });
  assert.equal(inspectOrderedCaptureLoopStage('unknown', {}, {}).passedAutomated, false);
});

test('I3/I5 tampered admission, history, isolation, mutation guards and forget linkage cannot pass', gate, async () => {
  const { report } = await positive();
  const matrix = {
    A: [r => r.windows[1].capture.value.reconciliation.retiredCount = 0,
      r => r.windows[1].capture.value.admission.memories = [],
      r => r.windows[1].snapshot.records.find(x => x.memory.state === 'historical').supersession.replacement.revision = 2,
      r => r.windows[1].snapshot.records.find(x => x.memory.state === 'historical').receipts = [],
      r => r.windows[1].snapshot.records.find(x => x.memory.state === 'historical').memory.state = 'active',
      r => r.windows[1].snapshot.records.find(x => x.memory.content === monday).receipts[0].role = 'assistant',
      r => r.windows[1].snapshot.records.find(x => x.memory.content === monday).receipts[0].eventId = 'forged',
      r => r.windows[1].snapshot.records.find(x => x.memory.content === extra).memory.namespace.ownerId = 'foreign-owner',
      r => r.windows[1].snapshot.records.find(x => x.memory.state === 'historical').memory.kind = 'context',
      r => r.windows[1].snapshot.records.find(x => x.memory.content === extra).memory.state = 'historical',
      r => r.windows[0].snapshot.records[0].receipts = structuredClone(r.windows[1].snapshot.records.find(x => x.memory.content === monday).receipts),
      r => r.windows[1].snapshot.records.find(x => x.memory.content === extra).receipts = structuredClone(r.windows[0].snapshot.records[0].receipts),
      r => {
        const first = r.windows[0].snapshot.records[0];
        const future = structuredClone(r.windows[1].snapshot.records.find(x => x.memory.content === monday).receipts[0]);
        future.id = 'synthetic-future-receipt'; first.receipts.push(future); first.memory.receiptCount++;
        const historical = r.windows[1].snapshot.records.find(x => x.memory.id === first.memory.id);
        historical.receipts = structuredClone(first.receipts); historical.memory.receiptCount++;
      },
      r => {
        const added = r.windows[1].snapshot.records.find(x => x.memory.content === extra);
        const earlier = structuredClone(r.windows[0].snapshot.records[0].receipts[0]); earlier.id = 'synthetic-earlier-receipt';
        added.receipts.push(earlier); added.memory.receiptCount++;
      },
      r => r.windows[1].reopenedSnapshot.records.pop()],
    B: [r => r.recall.value.coverage = 'budget_exhausted', r => r.current.value.memory.revision++,
      r => r.history.value.memory.state = 'active', r => r.isolation.get = r.current,
      r => r.projectIsolation.correct = r.current, r => r.isolation.forget.value.forgotten = true,
      r => r.projectIsolation.historyAfter.value.receipts = [], r => r.isolation.after.value.memory.content = 'Foreign overwrite'],
    C: [r => r.mutationArguments.memoryId = 'producer-oracle', r => r.mutationArguments.expectedRevision++,
      r => r.stale = r.mutation, r => r.after.value.receipts = [],
      r => r.history.value.supersession.evidenceAvailable = true,
      r => r.history.value.supersession.receiptIds = ['laundered-correction'], r => r.after.value.memory.revision--],
    D: [r => r.recall.value.memories = [], r => r.current.value.memory.content = monday,
      r => r.history.value.supersession.evidenceAvailable = true],
    E: [r => r.stale = { ok: true, value: { forgotten: true } }, r => r.mutation.value.forgotten = false,
      r => r.mutationArguments.expectedRevision--, r => r.after = r.current,
      r => r.snapshot.records = r.snapshot.records.filter(x => x.memory.content !== extra)],
    F: [r => r.recall.value.coverage = 'budget_exhausted', r => r.after = bad('storage_error'),
      r => r.history.value.supersession.replacement = { memoryId: 'forgotten-identity', revision: 1 },
      r => r.history.value.memory.state = 'active', r => r.snapshot.records = [],
      r => r.snapshot.records.find(x => x.memory.content === extra).memory.content = 'Deleted and replaced extra'],
  };
  for (const [stage, mutations] of Object.entries(matrix)) for (const [index, mutate] of mutations.entries()) {
    const state = {};
    for (const previous of report.stages.slice(0, stages.indexOf(stage))) assert.equal(inspectOrderedCaptureLoopStage(previous.stage, structuredClone(previous), state).passedAutomated, true);
    const before = structuredClone(state); const candidate = structuredClone(report.stages[stages.indexOf(stage)]); mutate(candidate);
    if (stage === 'A' && index !== mutations.length - 1) for (const window of candidate.windows) {
      synchronizeSnapshot(window.snapshot); window.reopenedSnapshot = structuredClone(window.snapshot);
    }
    assert.equal(inspectOrderedCaptureLoopStage(stage, candidate, state).passedAutomated, false, `${stage}: ${mutate}`);
    assert.deepEqual(state, before, 'failed stage cannot advance cumulative authority');
  }
});

for (const mode of ['empty', 'badSource', 'badClassification', 'noTransition', 'forgedPredecessor', 'forgedEvidence', 'forgedField', 'failReconcile']) {
  test(`I4 installed ${mode} capture fails without repair or later consumers`, gate, async () => {
    const session = fakeSession({ [mode]: true }); const report = await runInstalledOrderedCaptureLoop(options(session));
    assertFailed(report); assert.equal(report.stages[0].status, 'failed');
    assert.ok(report.stages.slice(1).every(s => s.status === 'not_run'));
    const windows = report.stages[0].windows;
    assert.equal(typeof windows.at(-1).capture.ok, 'boolean', 'retain the actual attempted capture envelope');
    assert.deepEqual(windows.map(w => w.source), fixture.windows.slice(0, windows.length));
    if (!['empty', 'badSource', 'badClassification'].includes(mode)) {
      assert.equal(windows.length, 2); assert.equal(windows[0].capture.ok, true);
      assert.equal(windows[0].snapshot.records.length, 1);
      assert.deepEqual(windows[0].snapshot.records, windows[0].reopenedSnapshot.records);
    }
    assert.equal(session.calls.some(c => ['cairn_select', 'cairn_rank'].includes(c.method)), false);
    assert.equal(session.calls.filter(c => c.route === '/responses' && c.method === 'cairn_extract').length,
      ['empty', 'badSource', 'badClassification'].includes(mode) ? 1 : 2);
    assert.ok(session.calls.filter(c => c.route === '/responses' && c.method === 'cairn_reconcile').length <= 1);
  });
}

test('I2 preflight rejects unknown options, unsafe directories and artifact mismatch before transport', gate, async () => {
  const session = fakeSession();
  for (const patch of [{ unknown: true }, { session: {} }, { startProxy: 1 }, { cairnArtifactSha256: '0'.repeat(64) }, { nodePath: '/not-a-node' }]) {
    const configuration = options(session); await assert.rejects(runInstalledOrderedCaptureLoop({ ...configuration, ...patch }));
    assert.deepEqual(readdirSync(configuration.privateDirectory), []);
  }
  for (const kind of ['symbol', 'nonenumerable', 'prototype']) {
    const configuration = options(session);
    if (kind === 'symbol') configuration[Symbol('unknown')] = true;
    if (kind === 'nonenumerable') Object.defineProperty(configuration, 'unknown', { value: true });
    if (kind === 'prototype') Object.setPrototypeOf(configuration, { unknown: true });
    await assert.rejects(runInstalledOrderedCaptureLoop(configuration)); assert.deepEqual(readdirSync(configuration.privateDirectory), []);
  }
  const occupied = directory(); writeFileSync(join(occupied, 'sentinel'), 'preserve');
  const permissive = directory(); chmodSync(permissive, 0o755);
  const linked = join(directory(), 'link'); symlinkSync(directory(), linked);
  for (const privateDirectory of [occupied, permissive, linked]) await assert.rejects(runInstalledOrderedCaptureLoop({ ...options(session), privateDirectory }));
  assert.equal(session.calls.length, 0);
});

test('I4 proxy startup, cleanup and final budget read failures return retained failed reports', gate, async () => {
  for (const kind of ['startup', 'cleanup', 'budget']) {
    const session = fakeSession({ failBudgetRead: kind === 'budget' ? 2 : undefined }); let closed = false;
    const configuration = options(session);
    configuration.startProxy = async args => {
      if (kind === 'startup') throw new Error('PRIVATE_SYNTHETIC_FAILURE');
      const proxy = await startExperimentProxy(args);
      return { ...proxy, close: async () => { await proxy.close(); closed = true; if (kind === 'cleanup') throw new Error('PRIVATE_SYNTHETIC_FAILURE'); } };
    };
    const report = await runInstalledOrderedCaptureLoop(configuration); assertFailed(report);
    if (kind === 'startup') { assert.equal(session.calls.length, 0); assert.ok(report.stages.every(s => s.status === 'not_run')); }
    else { assert.equal(closed, true); assert.ok(report.stages.every(s => s.status === 'completed')); }
  }
});

test('I4 exclusive stage/report persistence failures retain evidence without overwriting existing bytes', gate, async () => {
  for (const file of ['transport.json', 'stage-A.json', 'report.json']) {
    const session = fakeSession(); const configuration = options(session); const sentinel = 'SYNTHETIC PREEXISTING BYTES';
    configuration.startProxy = async args => {
      writeFileSync(join(configuration.privateDirectory, file), sentinel, { mode: 0o600, flag: 'wx' });
      return startExperimentProxy(args);
    };
    const report = await runInstalledOrderedCaptureLoop(configuration); assertFailed(report);
    assert.equal(readFileSync(join(configuration.privateDirectory, file), 'utf8'), sentinel);
    assert.ok(report.errors.some(error => error.code === 'ordered_persistence_failed'));
    if (file === 'transport.json') { assert.equal(session.calls.length, 0); assert.ok(report.stages.every(s => s.status === 'not_run')); }
    else {
      assert.equal(report.stages[0].windows.length, 2);
      if (file === 'stage-A.json') assert.ok(report.stages.slice(1).every(s => s.status === 'not_run'));
      else assert.ok(report.stages.every(s => s.status === 'completed'));
    }
  }
});
