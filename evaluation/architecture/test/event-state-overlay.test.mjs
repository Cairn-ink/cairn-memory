import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { loadOverlayFixture, validateOverlayFixture, OVERLAY_IDS, OVERLAY_SOURCE_SHA256,
  omitRelationshipOverlay, assertOverlayProjection, overlayArmOrder } from '../event-state-overlay.mjs';
import { runEventStateOverlayOpportunity } from '../event-state-opportunity.mjs';
import { overlayScriptedModel } from '../testing/event-state-overlay-scripted-model.mjs';
import { SOURCE_ANSWER_INSTRUCTION } from '../../live/installed-source-answer-delivery.mjs';

const sqlite = Number(process.versions.node.split('.')[0]) > 22
  || Number(process.versions.node.split('.')[0]) === 22 && Number(process.versions.node.split('.')[1]) >= 16;
const integration = { skip: !sqlite && 'node:sqlite requires Node >=22.16' };
const rubricURL = new URL('../fixtures/event-state-overlay-v1-rubric.json', import.meta.url);

test('overlay six source/rubric pins are separate, closed and fresh', async () => {
  const source = await readFile(new URL('../fixtures/event-state-overlay-v1.json', import.meta.url));
  const gold = await readFile(rubricURL);
  assert.equal(createHash('sha256').update(source).digest('hex'), OVERLAY_SOURCE_SHA256);
  assert.equal(createHash('sha256').update(gold).digest('hex'), '1566178ff6199e8fc4d29ac5025ebf540334f4b86cbeb8927779a4367262230d');
  const fixture = await loadOverlayFixture();
  assert.deepEqual(fixture.cases.map(item => item.id), OVERLAY_IDS);
  const rubric = JSON.parse(gold);
  assert.deepEqual(rubric.criteria.map(item => item.id), OVERLAY_IDS);
  for (const criterion of rubric.criteria) {
    assert.deepEqual(Object.keys(criterion).sort(), ['forbidden', 'id', 'required']);
    for (const field of ['required', 'forbidden']) {
      assert.ok(criterion[field].length >= 1 && criterion[field].length <= 4);
      assert.ok(criterion[field].every(text => typeof text === 'string' && text.length <= 160));
    }
  }
  for (const mutation of [value => { value.cases[0].expected = 'GOLD'; },
    value => { value.cases[0].sessions[0].gold = 'GOLD'; }, value => value.cases.reverse()]) {
    const value = structuredClone(fixture); mutation(value);
    assert.throws(() => validateOverlayFixture(value), /fixture_shape/);
  }
  const baseline = JSON.parse(await readFile(new URL('../fixtures/event-state-opportunity-v1.json', import.meta.url)));
  const oldMessages = baseline.cases.flatMap(item => item.sessions.flatMap(session => session.messages));
  assert.ok(fixture.cases.every(item => item.sessions.every(session => session.messages.every(message => !oldMessages.includes(message)))));
  for (const name of ['event-state-overlay.mjs', 'event-state-opportunity.mjs', 'event-state-transport.mjs']) {
    assert.ok(!(await readFile(new URL(`../${name}`, import.meta.url), 'utf8')).includes('rubric.json'));
  }
});

test('projection restores only overlay fields; lost linked receipt, reorder and shape mutations fail', () => {
  const request = { messages: [{ role: 'system', content: 'fixed' }, { role: 'user', content: JSON.stringify({
    question: 'fixed', readback: { coverage: 'fixed' }, evidence: [{ memory: { id: 'root', revision: 3 },
      receipts: [{ id: 'root-receipt', role: 'user', excerpt: 'root text' }], rationale: { status: 'reconfirmation-suggested',
        edges: [{ relation: 'challenges-premise' }], sources: [
          { memory: { id: 'linked', revision: 2 }, receipts: [{ id: 'linked-receipt', role: 'user', excerpt: 'necessary linked text' }] },
          { memory: { id: 'root', revision: 3 }, receipts: [{ id: 'root-receipt', role: 'user', excerpt: 'root text' }] },
        ], semanticSupport: 'unassessed' } }] }) }] };
  const projected = omitRelationshipOverlay(request);
  assertOverlayProjection(request, projected);
  for (const mutation of [value => value.evidence[0].rationale.sources[0].receipts.pop(),
    value => value.evidence[0].rationale.sources.reverse(), value => { value.readback.coverage = 'changed'; },
    value => { value.evidence[0].rationale.edges = []; }, value => { value.evidence[0].memory.revision++; },
    value => { value.evidence[0].rationale.sources[0].receipts[0].excerpt += '!'; }]) {
    const broken = structuredClone(projected), input = JSON.parse(broken.messages[1].content);
    mutation(input); broken.messages[1].content = JSON.stringify(input);
    assert.throws(() => assertOverlayProjection(request, broken), /overlay_projection/);
  }
  assert.ok(Object.hasOwn(JSON.parse(request.messages[1].content).evidence[0].rationale, 'edges'));
});

test('shared real capture/cold recall yields twelve independent first answers in frozen order', integration, async t => {
  const paths = [], answers = [], bindings = [], metadata = [];
  const report = await runEventStateOverlayOpportunity({
    createWorkspace: () => { const workspace = createTestWorkspace(t, { prefix: 'cairn-overlay-test-' });
      paths.push(workspace.path); return workspace; },
    createModel: value => { metadata.push(value); return overlayScriptedModel(); },
    prepareAnswers: (requests, value) => { assertOverlayProjection(requests.A, requests.B); bindings.push(value.caseId); },
    answer: (request, value) => {
      assert.ok(bindings.includes(value.caseId));
      assert.equal(request.messages.length, 2); assert.equal(request.messages[0].content, SOURCE_ANSWER_INSTRUCTION);
      answers.push({ request: structuredClone(request), ...value });
      return { text: `Independent first ${value.arm} answer; semantics unassessed.` };
    },
  });
  assert.equal(answers.length, 12); assert.equal(paths.length, 6);
  assert.equal(report.summary.semanticAccuracy, 'not-measured');
  assert.deepEqual(answers.map(item => `${item.caseId}/${item.arm}`), OVERLAY_IDS.flatMap(id => overlayArmOrder(id).map(arm => `${id}/${arm}`)));
  const gold = JSON.parse(await readFile(rubricURL));
  for (const trace of report.traces) {
    assert.deepEqual(trace.failures, []); assert.equal(trace.captures.length, 2);
    assert.ok(trace.cold.length && trace.cold.every(item => item.detail.ok && item.rationale.ok));
    const A = trace.arms.A.delivery.request, B = trace.arms.B.delivery.request;
    assert.deepEqual(JSON.parse(A.messages[1].content).evidence, trace.recall.value.memories);
    assertOverlayProjection(A, B);
    assert.equal(trace.delivery.calls, 2);
    for (const arm of ['A', 'B']) assert.equal(trace.arms[arm].answer.status, 'generated-unassessed');
    const target = JSON.stringify({ calls: trace.calls.filter(call => call.phase !== 'foreign-setup'), cold: trace.cold, arms: trace.arms });
    assert.ok(!target.includes('FOREIGN_CANARY_QUARTZ'));
    for (const criterion of gold.criteria) for (const clause of [...criterion.required, ...criterion.forbidden]) {
      assert.ok(!target.includes(clause));
    }
  }
  assert.ok(report.traces[0].cold.some(item => item.rationale.value.edges.some(edge => edge.relation === 'challenges-premise')));
  for (const value of metadata) assert.deepEqual(Object.keys(value).sort(), ['caseId', 'phase']);
  for (const path of paths) await assert.rejects(access(path), { code: 'ENOENT' });
});

test('shared upstream failure and overflow keep both six slots unavailable; ordinary answer failure stays local', integration, async t => {
  for (const options of [{ failMethod: 'extract' }, { failMethod: 'relate' }, { emptySelection: true }, { overflow: true }, { oneArm: true }]) {
    let calls = 0;
    const report = await runEventStateOverlayOpportunity({
      createWorkspace: () => createTestWorkspace(t, { prefix: 'cairn-overlay-fail-' }),
      createModel: () => overlayScriptedModel(options),
      ...(options.overflow ? { answerInputBytes: 1 } : {}),
      answer: (request, metadata) => { calls++; if (metadata.arm === 'A') throw new Error('ordinary failure');
        return { text: 'Unassessed independent first B.' }; },
    });
    assert.equal(report.traces.length, 6);
    for (const trace of report.traces) {
      assert.equal(trace.arms.A.answer.status, options.oneArm ? 'failed' : 'unavailable');
      assert.equal(trace.arms.B.answer.status, options.oneArm ? 'generated-unassessed' : 'unavailable');
    }
    assert.equal(calls, options.oneArm ? 12 : 0);
  }
});

test('paired persistence, asynchronous preparation and cleanup failures retain twelve slots and remove owned stores', integration, async t => {
  for (const fault of ['persistence', 'prepare', 'cleanup']) {
    const paths = []; let answers = 0, caught;
    try {
      await runEventStateOverlayOpportunity({
        createWorkspace: () => {
          const workspace = createTestWorkspace(t, { prefix: 'cairn-overlay-terminal-' }); paths.push(workspace.path);
          return fault === 'cleanup' ? { ...workspace, cleanup: async () => { await workspace.cleanup(); throw new Error('synthetic cleanup'); } } : workspace;
        }, createModel: () => overlayScriptedModel(),
        prepareAnswers: () => fault === 'prepare' ? Promise.resolve() : undefined,
        answer: () => { answers++; return { text: 'Unassessed.' }; },
        onRecord: record => { if (fault === 'persistence' && record.kind === 'answer-arm') throw new Error('synthetic disk'); },
      });
    } catch (error) { caught = error; }
    assert.ok(caught); assert.equal(caught.report.traces.length, 6);
    assert.ok(caught.report.traces.every(trace => trace.arms.A && trace.arms.B));
    assert.ok(caught.report.traces.slice(1).every(trace => trace.failures.includes('not-run-after-fatal')));
    assert.equal(answers, fault === 'prepare' ? 0 : fault === 'persistence' ? 1 : 2);
    for (const path of paths) await assert.rejects(access(path), { code: 'ENOENT' });
  }
});
