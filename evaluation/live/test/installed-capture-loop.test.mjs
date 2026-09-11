import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { CAPTURE_LOOP_FIXTURE, CAPTURE_LOOP_VERSION, inspectCaptureLoopStage,
  runInstalledCaptureLoop } from '../installed-capture-loop.mjs';

// Only explicit public artifact fixture selectors are read. No provider key or
// user profile is used; every HTTP response below is independently scripted.
const required = ['CAIRN_NODE', 'CAIRN_EXECUTABLE', 'CAIRN_ARTIFACT', 'CAIRN_ARTIFACT_SHA256'];
const missing = required.filter(key => !process.env[key]);
const installedGate = { skip: missing.length ? `set ${missing.join(', ')} for installed offline gate` : false,
  timeout: 120_000 };
const paraphrase = 'The Harbor team holds its review on Friday.';
const ok = value => ({ ok: true, value });
const error = code => ({ ok: false, error: { code, retryable: false } });

function fakeSession(mode = 'success') {
  const calls = [];
  return {
    calls,
    getState: () => ({ requestCount: calls.length, evidenceKind: 'scripted-offline-no-provider' }),
    async request(route, encoded) {
      const body = JSON.parse(encoded);
      calls.push({ route, model: body.model, format: body.text?.format?.name });
      if (route === '/responses/input_tokens') {
        return Response.json({ object: 'response.input_tokens', input_tokens: 100 });
      }
      assert.equal(route, '/responses');
      const input = JSON.parse(body.input[0].content[0].text);
      let output;
      if (body.text.format.name === 'cairn_extract') {
        assert.equal(body.model, 'gpt-5.4-mini-2026-03-17');
        output = { items: mode === 'empty' ? [] : [{ content: paraphrase, kind: 'fact', confidence: 1,
          sourceIndices: mode === 'wrong-source' ? [99] : [0] }] };
      } else if (body.text.format.name === 'cairn_classify') {
        output = { items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) };
      } else if (body.text.format.name === 'cairn_select') {
        const refs = input.maps.flatMap(map => map.items.flatMap(item => {
          if (item.type === 'unfiled') return [{ namespaceIndex: map.namespaceIndex, ...item.ref }];
          if (item.type === 'ref' && item.ref.childType === 'memory') return [{ namespaceIndex: map.namespaceIndex,
            memoryId: item.ref.childId, revision: item.ref.childRevision }];
          return [];
        }));
        output = { refs: refs.slice(0, 1) };
      } else {
        assert.equal(body.text.format.name, 'cairn_rank');
        output = { refs: input.candidates.slice(0, 1).map(item => ({ namespaceIndex: item.namespaceIndex,
          memoryId: item.memory.id, revision: item.memory.revision })) };
      }
      return Response.json({ object: 'response', model: body.model, status: 'completed', error: null,
        incomplete_details: null, output: [{ type: 'message', role: 'assistant', status: 'completed',
          content: [{ type: 'output_text', text: JSON.stringify(output) }] }],
        usage: { input_tokens: 100, output_tokens: 10, total_tokens: 110 } });
    },
  };
}

function installedOptions(session) {
  return { session, nodePath: process.env.CAIRN_NODE, cairnExecutable: process.env.CAIRN_EXECUTABLE,
    cairnArtifact: process.env.CAIRN_ARTIFACT, cairnArtifactSha256: process.env.CAIRN_ARTIFACT_SHA256,
    privateDirectory: mkdtempSync(join(tmpdir(), 'cairn-installed-capture-test-')) };
}

function mechanicalFixture() {
  const namespace = { ownerId: 'synthetic-owner', scope: 'project', projectId: 'synthetic-project' };
  const before = { memory: { id: 'memory-1', revision: 1, namespace, content: paraphrase },
    receipts: [{ id: 'source-receipt', client: CAPTURE_LOOP_FIXTURE.client,
      sessionId: CAPTURE_LOOP_FIXTURE.sessionId, eventId: CAPTURE_LOOP_FIXTURE.messageId,
      role: 'user', excerpt: CAPTURE_LOOP_FIXTURE.content }] };
  const after = { memory: { ...before.memory, revision: 2, content: CAPTURE_LOOP_FIXTURE.replacement },
    receipts: [{ id: 'correction-receipt', client: 'cairn-local-mcp', sessionId: 'explicit-tool',
      eventId: 'correction', role: 'user', excerpt: CAPTURE_LOOP_FIXTURE.replacement }] };
  const recall = memories => ok({ memories, coverage: 'complete',
    namespaces: [{ namespace, mapExhausted: true, fetchExhausted: true }] });
  const list = memories => ok({ memories });
  const read = item => ({ recall: recall([item]), current: ok(item), list: list([item.memory]) });
  return {
    A: { capture: ok({ admission: { memories: [before.memory] } }), memories: [before], source: CAPTURE_LOOP_FIXTURE },
    B: { ...read(before), isolation: { list: list([]), get: error('memory_not_found'),
      correct: error('memory_not_found'), forget: ok({ forgotten: false }), after: ok(before) },
    projectIsolation: { list: list([]), get: error('memory_not_found'),
      correct: error('memory_not_found'), forget: ok({ forgotten: false }), after: ok(before) } },
    C: { ...read(before), mutation: ok({ memory: after.memory }), after: ok(after),
      mutationArguments: { memoryId: before.memory.id, expectedRevision: 1, content: CAPTURE_LOOP_FIXTURE.replacement },
      list: list([after.memory]), stale: error('revision_conflict') },
    D: read(after),
    E: { ...read(after), mutation: ok({ forgotten: true }), after: error('memory_not_found'),
      mutationArguments: { memoryId: after.memory.id, expectedRevision: 2 },
      list: list([]), stale: error('revision_conflict') },
    F: { recall: recall([]), after: error('memory_not_found'), list: list([]) },
  };
}

test('mechanical lifecycle accepts original provenance differing from paraphrase, never claims semantic proof', () => {
  const records = mechanicalFixture();
  const state = {};
  assert.notEqual(records.A.memories[0].memory.content, records.A.memories[0].receipts[0].excerpt);
  for (const stage of ['A', 'B', 'C', 'D', 'E', 'F']) {
    const verdict = inspectCaptureLoopStage(stage, records[stage], state);
    assert.equal(verdict.passedAutomated, true, stage);
    assert.equal(verdict.semanticReviewRequired, true, stage);
    if (stage === 'A') assert.deepEqual(state, {}, 'producer identity must not authorize consumer mutation');
  }
  assert.deepEqual(state, { memoryId: 'memory-1', revision: 2 });
});

test('capture rejects empty admissions, unbound source metadata and explicit unsupported semantic judgments', () => {
  assert.equal(inspectCaptureLoopStage('A', mechanicalFixture().A, {}).passedAutomated, true);
  const variants = [
    r => { r.capture.value.admission.memories = []; r.memories = []; },
    r => { r.capture = error('extraction_failed'); },
    r => { r.capture.value.admission.memories[0].id = 'unbound-id'; },
    r => { r.memories[0].receipts = []; },
    ...['client', 'sessionId', 'eventId', 'role', 'excerpt'].map(field =>
      r => { r.memories[0].receipts[0][field] = 'wrong-source'; }),
    r => { r.semanticReview = { supported: false }; },
    r => { r.semanticReview = { requiredFact: false }; },
  ];
  for (const mutate of variants) {
    const record = structuredClone(mechanicalFixture().A);
    // Break aliases between the returned claim and admission envelope first.
    record.capture = structuredClone(record.capture);
    mutate(record);
    const state = {};
    assert.equal(inspectCaptureLoopStage('A', record, state).passedAutomated, false);
    assert.deepEqual(state, {});
  }
});

test('fresh consumer rejects stale, foreign or receipt-mismatched evidence and isolation leaks', () => {
  assert.equal(inspectCaptureLoopStage('B', mechanicalFixture().B, {}).passedAutomated, true);
  for (const mutate of [
    r => { r.recall = error('invalid_model_output'); },
    r => { r.recall.value.memories[0].memory.revision = 99; },
    r => { r.recall.value.memories[0].memory.namespace.ownerId = 'foreign-owner'; },
    r => { r.recall.value.memories[0].receipts[0].excerpt = 'unsupported'; },
    r => { r.isolation.list.value.memories = [{ id: 'leaked' }]; },
    r => { r.isolation.get = r.current; },
    r => { r.isolation.correct = ok({ memory: r.current.value.memory }); },
    r => { r.isolation.forget.value.forgotten = true; },
    r => { r.isolation.after.value.memory.content = 'foreign overwrite'; },
    r => { r.projectIsolation.list.value.memories = [{ id: 'project-leak' }]; },
    r => { r.projectIsolation.get = r.current; },
    r => { r.projectIsolation.correct = ok({ memory: r.current.value.memory }); },
    r => { r.projectIsolation.forget.value.forgotten = true; },
    r => { r.projectIsolation.after.value.memory.content = 'foreign project overwrite'; },
  ]) {
    const record = JSON.parse(JSON.stringify(mechanicalFixture().B));
    mutate(record);
    const state = {};
    assert.equal(inspectCaptureLoopStage('B', record, state).passedAutomated, false);
    assert.deepEqual(state, {});
  }
});

test('correction must actually advance the consumer-observed revision and preserve replacement evidence', () => {
  assert.equal(inspectCaptureLoopStage('C', mechanicalFixture().C,
    { memoryId: 'memory-1', revision: 1 }).passedAutomated, true);
  for (const mutate of [
    r => { r.mutation.value.memory.revision = 1; },
    r => { r.mutation.value.memory.content = paraphrase; },
    r => { r.after.value.receipts = []; },
    r => { r.stale = ok({ memory: r.after.value.memory }); },
    r => { r.current.value.memory.revision = 99; },
    r => { r.list.value.memories.push({ id: 'active-Friday-duplicate' }); },
    r => { r.mutationArguments.expectedRevision = 99; },
    r => { r.mutationArguments.memoryId = 'producer-oracle-id'; },
  ]) {
    const record = JSON.parse(JSON.stringify(mechanicalFixture().C));
    mutate(record);
    const state = { memoryId: 'memory-1', revision: 1 };
    assert.equal(inspectCaptureLoopStage('C', record, state).passedAutomated, false);
    assert.deepEqual(state, { memoryId: 'memory-1', revision: 1 });
  }
  const record = mechanicalFixture().D;
  assert.equal(inspectCaptureLoopStage('D', record, { memoryId: 'memory-1', revision: 1 }).passedAutomated, false);
});

test('forgetting requires a true mutation and rejected stale guard, not a successful no-op', () => {
  assert.equal(inspectCaptureLoopStage('E', mechanicalFixture().E,
    { memoryId: 'memory-1', revision: 2 }).passedAutomated, true);
  for (const mutate of [
    r => { r.mutation.value.forgotten = false; },
    r => { r.mutation = ok({}); },
    r => { r.after = r.current; },
    r => { r.stale = ok({ forgotten: true }); },
    r => { r.list.value.memories = [r.current.value.memory]; },
    r => { r.mutationArguments.expectedRevision = 1; },
    r => { r.mutationArguments.memoryId = 'unobserved-id'; },
  ]) {
    const record = JSON.parse(JSON.stringify(mechanicalFixture().E));
    mutate(record);
    assert.equal(inspectCaptureLoopStage('E', record, { memoryId: 'memory-1', revision: 2 }).passedAutomated, false);
  }
});

test('empty recall only means absence with completed coverage and confirmed missing target', () => {
  assert.equal(inspectCaptureLoopStage('F', mechanicalFixture().F, {}).passedAutomated, true);
  for (const mutate of [
    r => { r.recall = error('model_timeout'); },
    r => { r.recall.value.coverage = 'budget_exhausted'; },
    r => { r.recall.value.namespaces[0].mapExhausted = false; },
    r => { r.recall.value.namespaces[0].fetchExhausted = false; },
    r => { r.recall.value.namespaces = []; },
    r => { r.recall.value.memories.push({ memory: { id: 'forgotten' } }); },
    r => { r.after = error('storage_error'); },
    r => { r.list = error('storage_error'); },
  ]) {
    const record = JSON.parse(JSON.stringify(mechanicalFixture().F));
    mutate(record);
    assert.equal(inspectCaptureLoopStage('F', record, {}).passedAutomated, false);
  }
  assert.equal(inspectCaptureLoopStage('unknown', {}, {}).passedAutomated, false);
});

test('actual installed capture and five fresh stdio consumers complete only mechanical offline gate', installedGate, async () => {
  const session = fakeSession();
  const report = await runInstalledCaptureLoop(installedOptions(session));
  assert.equal(report.version, CAPTURE_LOOP_VERSION);
  assert.equal(report.status, 'mechanical_pass_pending_semantic_review', JSON.stringify(report));
  assert.deepEqual(report.stages.map(stage => [stage.stage, stage.status]),
    ['A', 'B', 'C', 'D', 'E', 'F'].map(stage => [stage, 'completed']));
  assert.equal(new Set(report.stages.slice(1).map(stage => stage.consumerSessionId)).size, 5);
  assert.ok(report.stages.every(stage => stage.verdict.semanticReviewRequired));
  const captured = report.stages[0].memories[0];
  assert.equal(captured.memory.content, paraphrase);
  assert.equal(captured.receipts[0].excerpt, CAPTURE_LOOP_FIXTURE.content);
  assert.notEqual(captured.memory.content, captured.receipts[0].excerpt);
  assert.equal(report.stages[1].isolation.get.error.code, 'memory_not_found');
  assert.equal(report.stages[1].isolation.forget.value.forgotten, false);
  assert.equal(report.stages[1].projectIsolation.get.error.code, 'memory_not_found');
  assert.equal(report.stages[1].projectIsolation.forget.value.forgotten, false);
  assert.equal(report.stages[2].stale.error.code, 'revision_conflict');
  assert.equal(report.stages[4].stale.error.code, 'revision_conflict');
  assert.equal(report.stages[4].mutation.value.forgotten, true);
  assert.equal(report.stages[5].recall.value.coverage, 'complete');
  assert.deepEqual(report.stages[5].recall.value.memories, []);
  assert.equal(report.stages[5].after.error.code, 'memory_not_found');
  assert.equal(report.provenance.artifactSha256, process.env.CAIRN_ARTIFACT_SHA256);
  assert.ok(report.provenance.sourceHashes['core/contract.mjs']);
  assert.ok(report.provenance.sourceHashes['adapters/openai/index.mjs']);
  assert.ok(session.calls.some(call => call.format === 'cairn_extract'));
  assert.ok(session.calls.some(call => call.format === 'cairn_select'));
  assert.ok(session.calls.some(call => call.format === 'cairn_rank'));
});

for (const mode of ['empty', 'wrong-source']) {
  test(`actual installed ${mode} capture fails before any stdio consumer or recall`, installedGate, async () => {
    const session = fakeSession(mode);
    const report = await runInstalledCaptureLoop(installedOptions(session));
    assert.equal(report.status, 'failed');
    assert.equal(report.stages[0].stage, 'A');
    assert.equal(report.stages[0].status, 'failed');
    assert.deepEqual(report.stages[0].memories, []);
    assert.ok(report.stages.slice(1).every(stage => stage.status === 'not_run'));
    assert.equal(session.calls.filter(call => call.route === '/responses').length, 1);
    assert.equal(session.calls.some(call => ['cairn_select', 'cairn_rank'].includes(call.format)), false);
  });
}
