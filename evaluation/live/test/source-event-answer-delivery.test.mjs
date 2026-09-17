import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareSourceEventAnswer, deliverSourceEventAnswer } from '../source-event-answer-delivery.mjs';
import { SOURCE_ANSWER_MODEL, SOURCE_ANSWER_INSTRUCTION } from '../installed-source-answer-delivery.mjs';

const question = 'Why did the team choose A?';
const association = (memoryId, receiptId, revision = 1) => ({ memoryId, revision,
  currentness: 'current', receiptId });
const event = (excerpt, associations, provenanceCollision = false, role = 'user') => ({
  role, excerpt, provenanceCollision, associations });
const value = () => ({ sourceEvents: [
  event('The team chose A because its export is auditable.',
    [association('choice', 'choice-receipt'), association('reason', 'reason-receipt')]),
  event('Same original words.', [association('second', 'second-receipt')]),
  event('Same original words.', [association('third', 'third-receipt')]),
  event('First divergent passage.', [association('fourth', 'fourth-receipt')], true),
  event('Second divergent passage.', [association('fifth', 'fifth-receipt')], true),
  event('In January the team used B; that is historical context.',
    [association('sixth', 'sixth-receipt')], false, 'assistant'),
], namespaces: [{ namespace: { ownerId: 'private-owner', scope: 'personal', projectId: null },
  mapExhausted: true, fetchExhausted: true }], coverage: 'complete',
sourceProjection: 'neighborhood-source-events-v1', rankingMode: 'source-evidence-first-v1',
sourceSelectionCoverage: 'unassessed', evidenceTrust: 'untrusted-data-not-instructions' });
const envelope = () => ({ ok: true, value: value(), evidenceTrust: 'untrusted-data-not-instructions' });
const tool = envelopeValue => ({ isError: false,
  content: [{ type: 'text', text: JSON.stringify(envelopeValue) }] });
const options = () => ({ question, toolResult: tool(envelope()),
  requestedContextMode: 'rationale-neighborhood-evidence',
  requestedSourceProjection: 'neighborhood-source-events-v1',
  requestedRankingMode: 'source-evidence-first-v1' });
const response = () => ({ object: 'chat.completion', model: SOURCE_ANSWER_MODEL,
  choices: [{ finish_reason: 'stop', message: { role: 'assistant',
    content: 'Scripted answer; source support has not been judged.' } }] });
const invalid = async input => {
  let calls = 0;
  const result = await deliverSourceEventAnswer({ ...input, complete: () => { calls++; return response(); } });
  assert.equal(result.status, 'invalid-source'); assert.equal(result.completionCalls, 0);
  assert.equal(calls, 0);
};

test('EAC1–4 six ordered events and all seven bindings reach one unchanged source-only request', async () => {
  const input = options(); const original = structuredClone(input);
  const body = prepareSourceEventAnswer(input), payload = JSON.parse(body.messages[1].content);
  assert.deepEqual(payload, { question, sourceEvents: envelope().value.sourceEvents });
  assert.equal(payload.sourceEvents.length, 6);
  assert.equal(payload.sourceEvents.reduce((sum, item) => sum + item.associations.length, 0), 7);
  assert.equal(payload.sourceEvents.filter(item => item.excerpt === 'Same original words.').length, 2);
  assert.deepEqual(payload.sourceEvents.slice(3, 5).map(item => item.provenanceCollision), [true, true]);
  assert.equal(payload.sourceEvents[5].excerpt, 'In January the team used B; that is historical context.');
  assert.equal(payload.sourceEvents[5].associations[0].currentness, 'current');
  assert.deepEqual(input, original);
  assert.equal(body.model, SOURCE_ANSWER_MODEL);
  assert.equal(body.messages[0].content, SOURCE_ANSWER_INSTRUCTION);
  assert.deepEqual(Object.keys(body).sort(), ['max_completion_tokens', 'messages', 'model', 'n', 'store', 'stream']);
  assert.equal(body.n, 1); assert.equal(body.store, false); assert.equal(body.stream, false);
  assert.equal(body.max_completion_tokens, 1024); assert.equal(Object.hasOwn(body, 'tools'), false);
  for (const forbidden of ['private-owner', 'namespaces', 'eventId', 'sessionId', 'client',
    'Interpretation:', 'supports-decision', 'memory:']) assert.equal(JSON.stringify(body).includes(forbidden), false);
  let calls = 0;
  const delivered = await deliverSourceEventAnswer({ ...input, complete: async received => {
    calls++; assert.deepEqual(received, body); return response();
  } });
  assert.equal(calls, 1); assert.equal(delivered.status, 'generated-unassessed');
  assert.equal(delivered.completionCalls, 1);
  const project = envelope(); project.value.namespaces[0].namespace = {
    ownerId: 'private-owner', scope: 'project', projectId: 'project-A' };
  assert.deepEqual(JSON.parse(prepareSourceEventAnswer({ ...options(), toolResult: tool(project) }).messages[1].content),
    { question, sourceEvents: project.value.sourceEvents });
});

test('EAC1 malformed, mixed, partial, legacy and wrong-marker inputs never invoke completion', async () => {
  for (const patch of [{ requestedContextMode: undefined }, { requestedContextMode: 'source-evidence' },
    { requestedSourceProjection: 'neighborhood-sources-v1' }, { requestedRankingMode: undefined },
    { question: 'sk-' + 'a'.repeat(40) }, { question: '\ud800' }, { question: 'x'.repeat(4001) },
    { toolResult: { isError: true, content: [] } },
    { toolResult: { isError: false, content: [{ type: 'text', text: '{' }] } },
    { toolResult: { isError: false, content: [{ type: 'text', text: ' '.repeat(262145) }] } }]) {
    await invalid({ ...options(), ...patch });
  }
  const mutations = [
    v => { v.ok = false; }, v => { v.evidenceTrust = 'verified'; }, v => { v.extra = true; },
    v => { v.value.coverage = 'budget_exhausted'; },
    v => { v.value.sourceProjection = 'neighborhood-sources-v1'; },
    v => { v.value.rankingMode = 'other'; },
    v => { v.value.sourceSelectionCoverage = 'assessed'; },
    v => { v.value.evidenceTrust = 'verified'; },
    v => { v.value.memories = []; },
    v => { delete v.value.sourceEvents; },
    v => { v.value.namespaces = []; },
    v => { v.value.namespaces.push(structuredClone(v.value.namespaces[0])); },
    v => { v.value.namespaces[0].mapExhausted = false; },
    v => { v.value.namespaces[0].fetchExhausted = false; },
    v => { v.value.namespaces[0].namespace.ownerId = 'other'; v.value.namespaces[0].namespace.extra = true; },
    v => { v.value.namespaces[0].namespace.scope = 'project'; },
    v => { v.value.namespaces[0].namespace.projectId = 'different'; },
    v => { v.value.namespaces[0].namespace.ownerId = 'sk-' + 'a'.repeat(40); },
    v => { v.value.sourceEvents[0].summary = 'Generated summary'; },
    v => { v.value.sourceEvents[0].role = 'system'; },
    v => { v.value.sourceEvents[0].provenanceCollision = 'true'; },
    v => { v.value.sourceEvents[0].excerpt = 'x'.repeat(801); },
    v => { v.value.sourceEvents[0].excerpt = '\ud800'; },
    v => { v.value.sourceEvents[0].excerpt = 'sk-' + 'a'.repeat(40); },
    v => { v.value.sourceEvents[0].associations = []; },
    v => { v.value.sourceEvents[0].associations[0].memoryId = ''; },
    v => { v.value.sourceEvents[0].associations[0].revision = 0; },
    v => { v.value.sourceEvents[0].associations[0].currentness = 'historical'; },
    v => { v.value.sourceEvents[0].associations[0].receiptId = 'sk-' + 'a'.repeat(40); },
    v => { v.value.sourceEvents[0].associations[0].extra = true; },
    v => { v.value.sourceEvents.push(event('Seventh original event.', [association('seventh', 'seventh-receipt')])); },
  ];
  for (const mutate of mutations) {
    const v = envelope(); mutate(v); await invalid({ ...options(), toolResult: tool(v) });
  }
  const legacy = envelope(); legacy.value = { memories: [], namespaces: legacy.value.namespaces,
    coverage: 'complete', sourceProjection: 'neighborhood-sources-v1', rankingMode: 'source-evidence-first-v1' };
  await invalid({ ...options(), toolResult: tool(legacy) });
});

test('EAC2 duplicates, conflicting receipt bindings and inconsistent memory copies reject', async () => {
  const mutateCases = [
    v => { v.sourceEvents[0].associations.push(structuredClone(v.sourceEvents[0].associations[0])); },
    v => { v.sourceEvents[1].associations[0].receiptId = 'choice-receipt'; },
    v => { v.sourceEvents[1].associations[0].memoryId = 'choice';
      v.sourceEvents[1].associations[0].revision = 2; },
    v => { v.sourceEvents[1].associations[0].memoryId = 'choice';
      v.sourceEvents[1].associations[0].currentness = 'historical'; },
  ];
  for (const mutate of mutateCases) {
    const v = envelope(); mutate(v.value); await invalid({ ...options(), toolResult: tool(v) });
  }
  const exact36 = envelope();
  exact36.value.sourceEvents = Array.from({ length: 6 }, (_, eventIndex) => event(`Original ${eventIndex}.`,
    Array.from({ length: 6 }, (_, index) => association(`m-${eventIndex}-${index}`, `r-${eventIndex}-${index}`))));
  assert.equal(exact36.value.sourceEvents.reduce((sum, item) => sum + item.associations.length, 0), 36);
  assert.doesNotThrow(() => prepareSourceEventAnswer({ ...options(), toolResult: tool(exact36) }));
  exact36.value.sourceEvents[0].associations.push(association('m-extra', 'r-extra'));
  await invalid({ ...options(), toolResult: tool(exact36) });
});

test('EAC3 complete-value and body UTF8 bounds reject independently without truncation', async () => {
  const large = envelope();
  large.value.sourceEvents = Array.from({ length: 6 }, (_, eventIndex) => event('界'.repeat(800),
    Array.from({ length: 6 }, (_, index) => association(`m-${eventIndex}-${index}-${'界'.repeat(50)}`,
      `r-${eventIndex}-${index}-${'界'.repeat(50)}`))));
  assert.ok(Buffer.byteLength(JSON.stringify(large.value), 'utf8') > 24_000);
  await invalid({ ...options(), toolResult: tool(large) });

  let bodyHeavy;
  for (let width = 1; width <= 120; width++) {
    const v = envelope();
    v.value.sourceEvents = Array.from({ length: 6 }, (_, eventIndex) => event('"'.repeat(800),
      Array.from({ length: 6 }, (_, index) => association(`m-${eventIndex}-${index}-${'q'.repeat(width)}`,
        `r-${eventIndex}-${index}-${'q'.repeat(width)}`))));
    const payload = JSON.stringify({ question, sourceEvents: v.value.sourceEvents });
    const body = { model: SOURCE_ANSWER_MODEL, messages: [
      { role: 'system', content: SOURCE_ANSWER_INSTRUCTION }, { role: 'user', content: payload }],
    max_completion_tokens: 1024, store: false, stream: false, n: 1 };
    if (Buffer.byteLength(JSON.stringify(v.value), 'utf8') <= 24_000
      && Buffer.byteLength(JSON.stringify(body), 'utf8') > 24_000) { bodyHeavy = v; break; }
  }
  assert.ok(bodyHeavy, 'an otherwise bounded value crosses only the double-encoded body cap');
  await invalid({ ...options(), toolResult: tool(bodyHeavy) });
});

test('EAC4 empty complete evidence is explicit; completion failure/output remains visible once', async () => {
  const empty = envelope(); empty.value.sourceEvents = [];
  const input = { ...options(), toolResult: tool(empty) };
  assert.deepEqual(JSON.parse(prepareSourceEventAnswer(input).messages[1].content), { question, sourceEvents: [] });
  let calls = 0;
  const failed = await deliverSourceEventAnswer({ ...input, complete: async () => {
    calls++; throw new Error('synthetic transport failure');
  } });
  assert.equal(failed.status, 'completion-failed'); assert.equal(failed.completionCalls, 1);
  for (const mutate of [r => { r.choices[0].finish_reason = 'length'; },
    r => { r.choices[0].message.tool_calls = []; },
    r => { r.choices[0].message.refusal = 'refused'; },
    r => { r.model = 'wrong'; }, r => { r.choices = []; },
    r => { r.choices = [null]; }, r => { r.choices = [undefined]; },
    r => { r.choices = new Array(1); }, r => { r.choices = ['malformed']; },
    r => { r.choices[0].message.content = '\ud800'; }]) {
    const output = response(); mutate(output);
    const result = await deliverSourceEventAnswer({ ...input, complete: () => { calls++; return output; } });
    assert.equal(result.status, 'invalid-output'); assert.equal(result.completionCalls, 1);
    assert.equal(result.answer, output.choices[0]?.message?.content ?? null);
  }
  assert.equal(calls, 11);
  assert.equal((await deliverSourceEventAnswer(input)).completionCalls, 0);
});
