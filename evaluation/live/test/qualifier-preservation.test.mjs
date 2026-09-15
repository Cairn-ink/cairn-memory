import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { openMemoryCore } from '../../../core/contract.mjs';
import { rationaleModel } from '../../../core/testing/rationale-model.mjs';
import { runQualifierPreservation } from '../qualifier-preservation.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from '../installed-source-answer-delivery.mjs';

// All source/answer content is synthetic; scripted models exercise mechanics only.
function inputs() {
  const histories = Array.from({ length: 12 }, (_, index) => {
    const pair = Math.floor(index / 2), committed = index % 2 === 1;
    return { id: `history-${index}`, pairId: `pair-${pair}`, messages: [
      { id: 'suggestion', role: 'assistant', content: `Consider synthetic activity ${pair}.` },
      { id: 'reason', role: 'user', content: `Actor${pair} likes activity ${pair} because Reason${pair}.` },
      { id: 'qualifier', role: 'user', content: committed
        ? `Actor${pair} commits to activity ${pair} for Week${pair}.`
        : `Actor${pair} is considering activity ${pair}, but has not committed, for Week${pair}.` },
      { id: 'response', role: 'assistant', content: `The schedule for activity ${pair} can be checked.` },
    ], question: `What is Actor${pair}'s commitment to activity ${pair}?` };
  });
  return { fixture: { id: 'synthetic-qualifier-preservation', histories },
    rubric: { id: 'synthetic-qualifier-preservation', histories: histories.map((history, index) => ({
      id: history.id, requiredSourceIds: ['reason', 'qualifier'], qualifierSourceId: 'qualifier',
      qualifierQuote: history.messages[2].content, expectedCommitment: index % 2 ? 'committed' : 'provisional',
      actor: `Actor${Math.floor(index / 2)}`, reason: `Reason${Math.floor(index / 2)}`, temporalLimit: `Week${Math.floor(index / 2)}`,
    })) } };
}
const tool = result => ({ isError: !result.ok, content: [{ type: 'text', text: JSON.stringify({
  ...result, evidenceTrust: 'untrusted-data-not-instructions',
}) }] });
const failure = code => tool({ ok: false, error: { code, retryable: false } });
const retrieved = history => history.answers.find(answer => answer.sourceKind === 'retrieved');
const control = history => history.answers.find(answer => answer.sourceKind === 'canonical-control');
function harness(options = {}) {
  const path = join(mkdtempSync(join(tmpdir(), 'cairn-qualifier-protocol-')), 'memory.sqlite');
  const opens = [], closes = [], calls = [], modelCalls = [], answers = [];
  let foreignRecall;
  return { opens, closes, calls, modelCalls, answers,
    async openClient(open) {
      const { historyId, phase } = open; opens.push(structuredClone(open)); options.onOpen?.(open);
      const namespace = { ownerId: 'synthetic-protocol', scope: 'project', projectId: historyId };
      const model = rationaleModel((method, request) => modelCalls.push({ historyId, method, input: structuredClone(request.input) }));
      const extract = model.extract;
      model.extract = request => {
        const output = extract(request);
        if (options.omitCapture === historyId) output.items = output.items.filter(item => item.sourceIndices[0] !== 2);
        return output;
      };
      const qualify = model.qualifyCandidates;
      model.qualifyCandidates = request => {
        if (options.captureFailure === historyId) throw new Error('SYNTHETIC_PRIVATE_PROVIDER_ERROR');
        return qualify(request);
      };
      const classify = model.classify;
      model.classify = request => {
        if (options.classificationFailure === historyId) throw new Error('SYNTHETIC_PRIVATE_CLASSIFICATION_ERROR');
        return classify(request);
      };
      const select = model.select;
      model.select = request => {
        select(request);
        return { refs: request.input.maps.flatMap(map => map.items.filter(item => item.type === 'unfiled')
          .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) };
      };
      const rank = model.rank;
      model.rank = request => {
        const result = rank(request);
        if (options.omitRecall === historyId) result.refs = result.refs.filter(ref =>
          !request.input.candidates.find(candidate => candidate.memory.id === ref.memoryId).receipts.some(receipt =>
            receipt.excerpt.includes('has not committed')));
        return result;
      };
      const core = openMemoryCore({ path, model, captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1' });
      return { async callTool(request) {
        const { name, arguments: args } = request; calls.push({ historyId, phase, ...structuredClone(request) });
        let result;
        if (name === 'capture_memory') {
          result = tool(await core.capture({ namespace, client: 'cairn-local-mcp', sessionId: 'submitted-capture',
            eventId: args.batchId, messages: args.messages.map((message, index) => ({ ...message,
              id: createHash('sha256').update(JSON.stringify(['cairn.mcp.submitted-message.v1', args.batchId, index])).digest('hex') })) }));
          if (options.mutate) args.messages[0].content = 'CALLBACK_MUTATED_SOURCE';
        } else if (name === 'inspect_capture_evidence') {
          result = tool(core.inspectCaptureEvidence({ namespace, client: 'cairn-local-mcp', eventId: args.batchId }));
          if (options.oversizedStage === historyId) result.content[0].text = 'OVERSIZED_PRIVATE_SNAPSHOT'.repeat(15000);
        } else if (name === 'inspect_memory') {
          result = tool(args.memoryId ? core.get({ namespace, ...args }) : core.list({ namespace, ...args }));
        } else if (name === 'recall_memory') {
          if (options.recallFailure === historyId) return failure('synthetic_recall_failure');
          result = tool(await core.recall({ readSet: [namespace], query: args.query, limit: args.limit, contextMode: args.contextMode }));
          if (options.crossScenario) {
            if (foreignRecall) return structuredClone(foreignRecall);
            foreignRecall = structuredClone(result);
          }
        } else throw new Error('unexpected_tool');
        return result;
      }, async close() { closes.push({ historyId, phase }); core.close(); } };
    },
    async answer(input) {
      answers.push(structuredClone(input));
      if (options.answerFailure && input.sourceKind === 'retrieved') throw new Error('SYNTHETIC_PRIVATE_ANSWER_ERROR');
      if (options.oversizedAnswer && input.sourceKind === 'retrieved') return 'OVERSIZED_PRIVATE_ANSWER'.repeat(400);
      if (options.mutate) { input.sources[0].content = 'ANSWER_MUTATED_SOURCE'; input.question = 'ANSWER_MUTATED_QUESTION';
        input.instructions = 'ANSWER_MUTATED_INSTRUCTIONS'; }
      return 'Synthetic answer, not semantically assessed.';
    } };
}

test('twelve real-core histories retain twenty-four answer slots and separate mechanical evidence from semantic judgment', async () => {
  const data = inputs(), h = harness();
  const report = await runQualifierPreservation({ ...data, openClient: h.openClient, answer: h.answer });
  assert.equal(report.status, 'observed'); assert.equal(report.semanticStatus, 'unassessed');
  assert.equal(report.histories.length, 12); assert.equal(report.histories.flatMap(history => history.answers).length, 24);
  assert.equal(new Set(report.histories.map(history => history.pairId)).size, 6);
  assert.equal(h.answers.length, 24); assert.equal(h.opens.length, 24); assert.deepEqual(h.closes, h.opens);
  assert.ok(h.answers.every(answer => answer.instructions === SOURCE_ANSWER_INSTRUCTION));
  assert.deepEqual(h.answers.filter(answer => answer.sourceKind === 'canonical-control').map(answer => answer.sources),
    data.fixture.histories.map(history => history.messages));
  for (let index = 0; index < h.answers.length; index += 2) assert.equal(h.answers[index].question, h.answers[index + 1].question);
  for (const history of report.histories) {
    assert.equal(history.capture.status, 'completed'); assert.equal(history.recall.status, 'completed');
    for (const stage of [history.staged, history.admitted, history.recall]) {
      assert.deepEqual(stage.coverage.missingSourceIds, []); assert.equal(stage.coverage.qualifierPresent, true);
      for (const semanticField of ['actorPresent', 'reasonPresent', 'temporalLimitPresent']) {
        assert.equal(Object.hasOwn(stage.coverage, semanticField), false);
      }
      assert.equal(stage.coverage.semanticStatus, 'unassessed');
    }
    for (const answer of history.answers) {
      assert.equal(answer.status, 'completed'); assert.equal(answer.semanticStatus, 'unassessed');
      assert.equal(answer.constructedControl, answer.sourceKind === 'canonical-control'); assert.equal(Object.hasOwn(answer, 'correct'), false);
    }
    const requests = h.calls.filter(call => call.historyId === history.id);
    assert.equal(requests.filter(call => call.name === 'capture_memory').length, 1);
    assert.equal(requests.filter(call => call.name === 'recall_memory').length, 1);
    assert.ok(requests.filter(call => call.name !== 'capture_memory').every(call => call.phase === 'cold'));
    assert.equal(requests.find(call => call.name === 'recall_memory').arguments.contextMode, 'source-evidence');
  }
  const callbackData = JSON.stringify({ opens: h.opens, calls: h.calls, modelCalls: h.modelCalls, answers: h.answers });
  for (const label of ['requiredSourceIds', 'qualifierSourceId', 'expectedCommitment', 'qualifierQuote', 'temporalLimit', 'pairId']) {
    assert.equal(callbackData.includes(`"${label}"`), false, label);
  }
});

test('capture failure keeps staged source and every denominator slot without rescuing retrieval or retrying', async () => {
  const h = harness({ captureFailure: 'history-0' });
  const report = await runQualifierPreservation({ ...inputs(), openClient: h.openClient, answer: h.answer });
  const failed = report.histories[0];
  assert.equal(failed.capture.status, 'failed'); assert.equal(failed.staged.evidence.state, 'failed');
  assert.equal(failed.staged.coverage.qualifierPresent, true); assert.equal(failed.admitted.coverage.qualifierPresent, false);
  assert.equal(failed.recall.status, 'not_run'); assert.equal(retrieved(failed).status, 'not_run');
  assert.equal(control(failed).status, 'completed'); assert.equal(report.histories.length, 12);
  assert.equal(report.histories.flatMap(history => history.answers).length, 24); assert.equal(h.answers.length, 23);
  assert.equal(h.calls.filter(call => call.historyId === 'history-0' && call.name === 'capture_memory').length, 1);
  assert.equal(h.calls.filter(call => call.historyId === 'history-0' && call.name === 'recall_memory').length, 0);
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_PRIVATE_PROVIDER_ERROR'), false);
  assert.deepEqual(h.closes, h.opens);
});

test('classification failure remains reported while admitted sources and all answer slots stay usable', async () => {
  const h = harness({ classificationFailure: 'history-0' });
  const report = await runQualifierPreservation({ ...inputs(), openClient: h.openClient, answer: h.answer });
  const history = report.histories[0];
  assert.equal(report.status, 'observed-with-failures'); assert.equal(history.capture.status, 'completed');
  assert.equal(history.capture.classification.status, 'failed');
  assert.equal(history.capture.classification.error.code, 'classification_failed');
  assert.ok(history.errors.some(error => error.operation === 'classification' && error.code === 'classification_failed'));
  assert.equal(history.staged.evidence.state, 'admitted');
  assert.equal(history.admitted.coverage.qualifierPresent, true);
  assert.equal(history.recall.status, 'completed'); assert.equal(history.recall.coverage.qualifierPresent, true);
  assert.equal(report.histories.flatMap(history => history.answers).length, 24); assert.equal(h.answers.length, 24);
  assert.ok(history.answers.every(answer => answer.status === 'completed' && answer.semanticStatus === 'unassessed'));
  assert.equal(JSON.stringify(report).includes('SYNTHETIC_PRIVATE_CLASSIFICATION_ERROR'), false);
  assert.deepEqual(h.closes, h.opens);
});

test('recall and answer failures preserve first attempts, control answers and complete denominators', async () => {
  for (const options of [{ recallFailure: 'history-0' }, { answerFailure: true }]) {
    const h = harness(options);
    const report = await runQualifierPreservation({ ...inputs(), openClient: h.openClient, answer: h.answer });
    assert.equal(report.histories.length, 12); assert.equal(report.histories.flatMap(history => history.answers).length, 24);
    assert.equal(control(report.histories[0]).status, 'completed');
    assert.equal(retrieved(report.histories[0]).status, options.recallFailure ? 'not_run' : 'failed');
    assert.equal(h.calls.filter(call => call.name === 'recall_memory').length, 12);
    assert.equal(h.answers.length, options.recallFailure ? 23 : 24);
    assert.deepEqual(h.closes, h.opens); assert.equal(JSON.stringify(report).includes('SYNTHETIC_PRIVATE_ANSWER_ERROR'), false);
  }
});

test('capture omission and retrieval omission retain different exact-qualifier diagnostics', async () => {
  for (const options of [{ omitCapture: 'history-0' }, { omitRecall: 'history-0' }]) {
    const h = harness(options);
    const report = await runQualifierPreservation({ ...inputs(), openClient: h.openClient, answer: h.answer });
    const history = report.histories[0]; assert.equal(history.staged.coverage.qualifierPresent, true);
    assert.equal(history.admitted.coverage.qualifierPresent, !options.omitCapture);
    assert.equal(history.recall.coverage.qualifierPresent, false);
    assert.equal(history.answers.every(answer => answer.semanticStatus === 'unassessed'), true);
  }
});

test('malformed fixture and rubric reject before either injected callback runs', async () => {
  const changes = [
    data => { data.fixture.histories.pop(); },
    data => { data.fixture.histories[1].id = data.fixture.histories[0].id; },
    data => { data.fixture.histories[0].messages[0].role = 'system'; },
    data => { data.fixture.histories[0].messages[0].content = 'x'.repeat(4001); },
    data => { data.fixture.histories[0].messages[1].id = data.fixture.histories[0].messages[0].id; },
    data => { data.rubric.id = 'different'; },
    data => { data.rubric.histories[0].requiredSourceIds = ['missing']; },
    data => { data.rubric.histories[0].qualifierQuote = 'absent quote'; },
    data => { data.rubric.histories[0].qualifierSourceId = 'reason';
      data.rubric.histories[0].qualifierQuote = data.fixture.histories[0].messages[1].content; },
    data => { data.rubric.histories[0].unexpected = true; },
  ];
  for (const change of changes) {
    const data = inputs(); change(data); let callbacks = 0;
    await assert.rejects(runQualifierPreservation({ ...data, openClient: () => { callbacks++; }, answer: () => { callbacks++; } }));
    assert.equal(callbacks, 0);
  }
});

test('callbacks cannot mutate frozen fixtures, rubric comparisons or later answer inputs', async () => {
  const data = inputs(); const original = structuredClone(data); let mutated = false;
  const h = harness({ mutate: true, onOpen: input => {
    input.historyId = 'mutated-open-argument';
    if (!mutated) { mutated = true; data.fixture.histories[0].messages[0].content = 'CALLER_MUTATED_SOURCE';
      data.rubric.histories[0].qualifierQuote = 'CALLER_MUTATED_RUBRIC'; }
  } });
  const report = await runQualifierPreservation({ ...data, openClient: h.openClient, answer: h.answer });
  assert.equal(report.histories[0].id, original.fixture.histories[0].id);
  assert.equal(report.histories[0].staged.coverage.qualifierPresent, true);
  assert.equal(report.histories[0].admitted.coverage.qualifierPresent, true);
  assert.equal(JSON.stringify(report).includes('MUTATED_'), false);
  assert.equal(JSON.stringify(h.answers).includes('MUTATED_'), false);
});

test('source receipts from a different history cannot pass cross-scenario retrieval validation', async () => {
  const h = harness({ crossScenario: true });
  const report = await runQualifierPreservation({ ...inputs(), openClient: h.openClient, answer: h.answer });
  assert.equal(report.histories[0].recall.status, 'completed');
  for (const history of report.histories.slice(1)) {
    assert.equal(history.recall.status, 'failed'); assert.equal(retrieved(history).status, 'not_run');
    assert.equal(control(history).status, 'completed');
  }
});

test('oversized callback snapshots and answers are bounded failures without raw payload reflection', async () => {
  const h = harness({ oversizedStage: 'history-0', oversizedAnswer: true });
  const report = await runQualifierPreservation({ ...inputs(), openClient: h.openClient, answer: h.answer });
  assert.equal(report.histories[0].staged.status, 'failed'); assert.equal(report.histories[0].staged.evidence, null);
  assert.ok(report.histories.every(history => retrieved(history).status === 'failed' && control(history).status === 'completed'));
  assert.equal(JSON.stringify(report).includes('OVERSIZED_PRIVATE'), false);
  assert.equal(report.histories.flatMap(history => history.answers).length, 24); assert.deepEqual(h.closes, h.opens);
});

test('frozen six-pair fixture exercises all twelve real-core histories and twenty-four answer slots', async () => {
  const fixture = JSON.parse(readFileSync(new URL('../qualifier-preservation-fixture.json', import.meta.url)));
  const rubric = JSON.parse(readFileSync(new URL('../qualifier-preservation-rubric.json', import.meta.url)));
  const h = harness(); const report = await runQualifierPreservation({ fixture, rubric, openClient: h.openClient, answer: h.answer });
  assert.equal(report.status, 'observed'); assert.equal(report.histories.length, 12); assert.equal(h.answers.length, 24);
  assert.ok(report.histories.every(history => history.staged.coverage.qualifierPresent && history.admitted.coverage.qualifierPresent
    && history.recall.coverage.qualifierPresent));
});
