import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { loadOpportunityFixture, validateOpportunityFixture, runEventStateOpportunity,
  SOURCE_SHA256, OPPORTUNITY_LIMITS } from '../event-state-opportunity.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from '../../live/installed-source-answer-delivery.mjs';
import { eventStateScriptedModel } from '../testing/event-state-scripted-model.mjs';

const sqlite = Number(process.versions.node.split('.')[0]) > 22
  || Number(process.versions.node.split('.')[0]) === 22 && Number(process.versions.node.split('.')[1]) >= 16;
const integration = { skip: !sqlite && 'node:sqlite requires Node >=22.16' };
const rubricHash = 'a644e0cadea32ee9e0e2e13ee4dd0b603cff6fbf8af70fbf8ad162395171e206';
const fixtureURL = new URL('../fixtures/event-state-opportunity-v1.json', import.meta.url);
const rubricURL = new URL('../fixtures/event-state-opportunity-v1-rubric.json', import.meta.url);
const ids = ['es-7c2a', 'es-19df', 'es-a603', 'es-5be8', 'es-d094', 'es-e731'];
const assertDelivered = (trace, received = trace.delivery.request) => {
  assert.ok(trace.recall.ok);
  assert.deepEqual(JSON.parse(received.messages[1].content).evidence, trace.recall.value.memories,
    'every returned source/rationale/edge/status must reach answer');
};
const assertChallenge = trace => {
  assert.ok(trace.cold.some(item => item.rationale.ok && item.rationale.value.edges
    .some(edge => edge.relation === 'challenges-premise')), 'expected scripted challenge must survive cold read');
};
async function run(t, options = {}) {
  const paths = [];
  const metadata = [];
  const received = [];
  const endpoint = async request => {
    received.push(structuredClone(request));
    const evidence = JSON.parse(request.messages[1].content).evidence;
    if (evidence.some(item => !item.rationale)) throw new Error('dropped-rationale-at-endpoint');
    if (options.answerFailure) throw new Error('injected-answer-failure');
    if (options.answerOutputLarge) return { text: 'x'.repeat(4001) };
    return { text: 'Scripted first answer; semantic meaning unassessed.' };
  };
  const report = await runEventStateOpportunity({
    createWorkspace: () => {
      const workspace = createTestWorkspace(t, { prefix: 'cairn-opportunity-test-' });
      paths.push(workspace.path); return workspace;
    },
    createModel: metadataValue => {
      metadata.push(metadataValue);
      return eventStateScriptedModel(options.model);
    },
    answer: async request => {
      if (options.dropEvidence) {
        // Fault in a consumer forwarding the ACTUAL helper request to an endpoint.
        const payload = JSON.parse(request.messages[1].content);
        payload.evidence = payload.evidence.map(({ rationale, ...sourceOnly }) => sourceOnly);
        request.messages[1].content = JSON.stringify(payload);
      }
      return endpoint(request);
    },
    ...(options.answerInputBytes ? { answerInputBytes: options.answerInputBytes } : {}),
  });
  for (const path of paths) await assert.rejects(access(path), { code: 'ENOENT' });
  assert.equal(paths.length, 6);
  assert.equal(report.summary.denominator, 6);
  assert.deepEqual(report.summary.cases.map(item => item.id), ids);
  assert.equal(report.summary.semanticAccuracy, 'not-measured');
  for (const value of metadata) assert.deepEqual(Object.keys(value).sort(), ['caseId', 'phase']);
  return { ...report, received, paths };
}

test('frozen six-case source and independent interpretation rubric have pinned bytes and strict shape', async () => {
  const source = await readFile(fixtureURL);
  const gold = await readFile(rubricURL);
  assert.equal(createHash('sha256').update(source).digest('hex'), SOURCE_SHA256);
  assert.equal(createHash('sha256').update(gold).digest('hex'), rubricHash);
  const fixture = await loadOpportunityFixture();
  const rubric = JSON.parse(gold);
  assert.deepEqual(fixture.cases.map(item => item.id), ids);
  assert.deepEqual(rubric.criteria.map(item => item.id), ids);
  assert.deepEqual(Object.keys(rubric).sort(), ['criteria', 'version']);
  assert.equal(rubric.version, 'event-state-opportunity-v1-rubric');
  for (const criterion of rubric.criteria) {
    assert.deepEqual(Object.keys(criterion).sort(), ['forbidden', 'id', 'required']);
    for (const field of ['required', 'forbidden']) {
      assert.ok(criterion[field].length >= 1 && criterion[field].length <= 4);
      assert.ok(criterion[field].every(text => typeof text === 'string' && text.length <= 160));
    }
  }
  assert.ok(source.length < OPPORTUNITY_LIMITS.fixtureBytes);
  const injected = structuredClone(fixture); injected.cases[0].expected = 'GOLD_CANARY';
  assert.throws(() => validateOpportunityFixture(injected), /fixture_shape/);
  const nested = structuredClone(fixture); nested.cases[0].sessions[0].rubric = {};
  assert.throws(() => validateOpportunityFixture(nested), /fixture_shape/);
  assert.ok(!/RQ\d|CQ\d|BQ\d/.test(source.toString()));
  // Gold controls explicitly reject blanket uncertainty/reconfirmation.
  for (const id of ['es-19df', 'es-a603', 'es-5be8', 'es-d094', 'es-e731']) {
    const criterion = rubric.criteria.find(item => item.id === id);
    assert.ok(criterion.forbidden.some(text => /[Uu]nknown|[Bb]lind/.test(text)));
    assert.ok(criterion.required.every(text => !['unknown', 'needs reconfirmation'].includes(text)));
  }
  const helper = await readFile(new URL('../event-state-opportunity.mjs', import.meta.url), 'utf8');
  assert.ok(!helper.includes('rubric.json'));
  assert.ok(!helper.includes('SOURCE_ANSWER_MODEL'));
});

test('real capture, cold store and first-answer path preserve source graphs without gold or foreign leakage', integration, async t => {
  const report = await run(t);
  assert.equal(report.received.length, 6);
  const rubric = JSON.parse(await readFile(rubricURL));
  for (const [index, trace] of report.traces.entries()) {
    assert.deepEqual(trace.failures, []);
    assert.ok(trace.captures.every(item => item.result.ok));
    assert.ok(trace.cold.length > 0);
    assert.ok(trace.cold.every(item => item.detail.ok && item.detail.value.qualification !== null && item.rationale.ok));
    assertDelivered(trace, report.received[index]);
    for (const inspection of trace.inspections) {
      assert.ok(inspection.ok);
      assert.deepEqual(trace.cold.find(item => item.detail.value.memory.id === inspection.value.memory.id).detail, inspection);
    }
    assert.equal(trace.delivery.calls, 1);
    assert.equal(trace.delivery.request.messages[0].content, SOURCE_ANSWER_INSTRUCTION);
    assert.equal(trace.answer.status, 'generated-unassessed');
    const target = JSON.stringify({ calls: trace.calls.filter(call => call.phase !== 'foreign-setup'),
      cold: trace.cold, recall: trace.recall, request: trace.delivery.request });
    assert.ok(!target.includes('FOREIGN_CANARY_QUARTZ'));
    for (const criterion of rubric.criteria) for (const text of [...criterion.required, ...criterion.forbidden]) {
      assert.ok(!target.includes(text), `gold criterion leaked: ${text}`);
    }
    assert.ok(trace.calls.filter(call => call.phase === 'read').every(call => ['select', 'rank'].includes(call.method)));
    for (const capture of trace.captures) assert.equal(capture.result.value.classification.status, 'applied');
  }
  assertChallenge(report.traces[0]);
  const delivered = JSON.parse(report.received[0].messages[1].content).evidence;
  assert.ok(delivered.some(item => item.rationale.status === 'reconfirmation-suggested'));
  assert.ok(delivered.some(item => item.rationale.sources.some(source => source.receipts.some(r => r.excerpt.includes('960 credits')))));
  const older = report.traces[2].cold.flatMap(item => item.detail.value.receipts);
  assert.ok(older.some(receipt => receipt.excerpt.includes('event date 2026-07-20') && receipt.createdAt !== '2026-07-20'));
  const publicText = JSON.stringify(report.summary);
  for (const text of ['Mara', 'Alder', 'FOREIGN', 'memory.sqlite', 'question', 'receipts', 'request']) assert.ok(!publicText.includes(text));
});

test('extraction, qualification, relate and classification failures remain in all six cases without retry', integration, async t => {
  for (const method of ['extract', 'qualifyCandidates', 'relate', 'classify']) {
    const report = await run(t, { model: { failMethod: method } });
    assert.ok(report.summary.cases.every(item => item.status === 'failed-or-unassessed'));
    for (const trace of report.traces) {
      const targets = trace.captures.filter(item => item.phase === 'target');
      assert.equal(trace.calls.filter(call => call.phase === 'target' && call.method === method).length, targets.length);
      assert.ok(trace.calls.filter(call => call.method === method).every(call => call.status === 'failed'));
      if (['extract', 'qualifyCandidates'].includes(method)) assert.equal(trace.delivery.calls ?? 0, 0);
      if (method === 'relate') assert.ok(trace.captures.every(item => item.result.ok && item.result.value.rationale.status === 'failed'));
    }
  }
});

test('empty selection, packing overflow, answer failure and invalid refs remain visible', integration, async t => {
  for (const options of [{ model: { emptySelection: true } }, { answerInputBytes: 1 },
    { answerFailure: true }, { answerOutputLarge: true }, { model: { oversizedOutput: true } },
    { model: { staleSelection: true } }, { model: { foreignSelection: true } }]) {
    const report = await run(t, options);
    assert.ok(report.summary.cases.every(item => item.status === 'failed-or-unassessed'));
    assert.equal(report.received.length, options.answerFailure || options.answerOutputLarge ? 6 : 0);
    if (options.answerInputBytes) assert.ok(report.traces.every(trace => trace.delivery.omitted.length > 0
      && trace.delivery.included.length === 0 && trace.failures.includes('answer-input-bound')));
    if (options.answerFailure) assert.ok(report.traces.every(trace => trace.answer.status === 'failed' && trace.delivery.calls === 1));
    if (options.answerOutputLarge) assert.ok(report.traces.every(trace => trace.answer.status === 'failed'
      && trace.failures.includes('answer-failed') && trace.delivery.calls === 1));
    if (options.model?.oversizedOutput) assert.ok(report.traces.every(trace => trace.calls
      .filter(call => call.method === 'extract').every(call => call.status === 'failed' && call.output === null)));
    if (options.model?.staleSelection || options.model?.foreignSelection) {
      assert.ok(report.traces.every(trace => !trace.recall.ok && trace.recall.error.code === 'invalid_model_output'));
    }
  }
});

test('no-edge and dropped-evidence red controls fail actual observed wiring assertions', integration, async t => {
  const noEdges = await run(t, { model: { noEdges: true } });
  assert.throws(() => assertChallenge(noEdges.traces[0]), /expected scripted challenge/);
  assert.ok(noEdges.traces[0].captures.every(item => item.result.value.rationale.inserted === 0));
  assert.ok(noEdges.traces[0].calls.filter(call => call.method === 'relate').every(call => call.output.edges.length === 0));
  const dropped = await run(t, { dropEvidence: true });
  assert.ok(dropped.summary.cases.every(item => item.failures.includes('answer-failed')));
  assert.ok(dropped.traces.every(trace => trace.answer.status === 'failed'));
  assert.throws(() => assertDelivered(dropped.traces[0], dropped.received[0]), /every returned source\/rationale/);
  assertDelivered(dropped.traces[0]); // The fault is downstream forwarding; the helper preserved the graph.
});

test('owned scratch is removed when setup fails before capture', integration, async t => {
  const paths = [];
  const report = await runEventStateOpportunity({ createWorkspace: () => {
    const workspace = createTestWorkspace(t, { prefix: 'cairn-opportunity-failure-' });
    paths.push(workspace.path); return workspace;
  }, createModel: () => { throw new Error('injected-setup-failure'); }, answer: () => assert.fail('unsafe answer') });
  assert.equal(report.summary.cases.length, 6);
  assert.ok(report.summary.cases.every(item => item.failures.includes('case-failed')));
  for (const path of paths) await assert.rejects(access(path), { code: 'ENOENT' });
});

test('E-live helper forwards exact adapter fit planning and diagnostic observers', integration, async t => {
  let fits = 0, forwarded = 0;
  const observations = [];
  const report = await runEventStateOpportunity({
    createWorkspace: () => createTestWorkspace(t, { prefix: 'cairn-event-fit-' }),
    createModel: () => ({ ...eventStateScriptedModel(), fitsQualificationRequest(request) {
      fits++; assert.equal(request.maxOutputTokens, 1024); return true;
    }, onDiagnostic() { forwarded++; }, relate() { return { edges: [
      { from: 0, to: 0, relation: 'challenges-premise', fromReceipt: 0, toReceipt: 0 },
    ] }; } }),
    answer: () => ({ text: 'Unassessed.' }), onRecord: record => { observations.push(record); },
  });
  assert.ok(fits > 0 && forwarded > 0);
  assert.ok(report.traces.every(trace => trace.diagnostics.some(event => event.layer === 'core_validation'
    && event.reason === 'invalid_rationale')));
  assert.ok(observations.some(record => record.kind === 'diagnostic'));
});

test('E-live persistence failure in diagnostic or completed case retains six and cleans scratch', integration, async t => {
  for (const kind of ['diagnostic', 'case-complete']) {
    const paths = [];
    let creates = 0;
    let caught;
    try {
      await runEventStateOpportunity({ createWorkspace: () => {
        const workspace = createTestWorkspace(t, { prefix: 'cairn-event-persist-' });
        paths.push(workspace.path); return workspace;
      }, createModel: () => { creates++; return eventStateScriptedModel({ failMethod: 'extract' }); },
      answer: () => assert.fail('no answer expected'), onRecord: record => {
        if (record.kind === kind) throw new Error('disk failed');
      } });
    } catch (error) { caught = error; }
    assert.equal(caught.message, 'opportunity_persistence_failed');
    assert.equal(caught.report.summary.denominator, 6);
    assert.equal(caught.report.traces.length, 6);
    assert.equal(creates, kind === 'diagnostic' ? 1 : 2);
    for (const path of paths) await assert.rejects(access(path), { code: 'ENOENT' });
  }
});
