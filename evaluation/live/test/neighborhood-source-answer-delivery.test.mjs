import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareNeighborhoodSourceAnswer, deliverNeighborhoodSourceAnswer } from '../neighborhood-source-answer-delivery.mjs';
import { SOURCE_ANSWER_MODEL } from '../installed-source-answer-delivery.mjs';

const mode = 'rationale-neighborhood-evidence';
const question = 'Why did the team choose A, and what happened later?';
const source = (id, excerpt = `Original source ${id}.`) => ({
  memory: { id, revision: 1, currentness: 'current' },
  receipts: [{ id: `${id}-receipt`, role: 'user', excerpt }], receiptCount: 1,
  interpretationStatus: 'omitted', sourceSelectionCoverage: 'unassessed',
});
const root = (primary, linked, relation = 'supports-decision') => ({ ...structuredClone(primary), rationale: {
  root: { memoryId: primary.memory.id, revision: primary.memory.revision }, status: 'unassessed',
  sources: [structuredClone(primary), structuredClone(linked)], edges: [{ from: primary.memory.id,
    to: linked.memory.id, relation, fromReceipt: primary.receipts[0].id,
    toReceipt: linked.receipts[0].id, interpretationStatus: 'model-proposed' }],
  coverage: 'bounded-root-neighborhood', indexRevision: 3,
} });
const envelope = memories => ({ ok: true, evidenceTrust: 'untrusted-data-not-instructions',
  value: { memories, namespaces: [{ mapExhausted: true, fetchExhausted: true,
    namespace: { ownerId: 'private-owner', scope: 'personal', projectId: null } }], coverage: 'complete' } });
const tool = value => ({ isError: false, content: [{ type: 'text', text: JSON.stringify(value) }] });
const options = value => ({ question, toolResult: tool(value), requestedContextMode: mode });
const response = () => ({ object: 'chat.completion', model: SOURCE_ANSWER_MODEL,
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: 'Synthetic answer; no quality claim.' } }] });

test('NC1–3 root and linked sources deduplicate stably; no graph, summary or namespace reaches existing answer request', async () => {
  const old = source('old', 'The team chose A because of its price.');
  const later = source('later', 'The team later chose B.');
  const other = source('other', 'Another selected root.');
  const input = envelope([root(old, later), root(other, later)]);
  const body = prepareNeighborhoodSourceAnswer(options(input));
  const context = JSON.parse(body.messages[1].content);
  assert.deepEqual(context.memory.sources, [old, later, other]);
  assert.equal(context.question, question);
  assert.equal(body.model, SOURCE_ANSWER_MODEL); assert.equal(body.store, false);
  assert.equal(body.stream, false); assert.equal(body.n, 1); assert.equal(body.max_completion_tokens, 1024);
  assert.ok(!Object.hasOwn(body, 'tools'));
  for (const forbidden of ['rationale', 'supports-decision', 'bounded-root-neighborhood',
    'private-owner', 'indexRevision', 'qualification', 'Generated summary']) {
    assert.ok(!JSON.stringify(body).includes(forbidden), forbidden);
  }
  let calls = 0;
  const result = await deliverNeighborhoodSourceAnswer({ ...options(input), complete: async received => {
    calls++; assert.deepEqual(received, body); return response();
  } });
  assert.equal(result.status, 'generated-unassessed'); assert.equal(result.completionCalls, 1);
  assert.equal(calls, 1);
});

test('NC1–2 wrong mode, incomplete or malformed RN envelopes and conflicting copies fail before completion', async () => {
  const old = source('old'), later = source('later');
  const mutations = [
    value => { value.ok = false; },
    value => { value.evidenceTrust = 'verified'; },
    value => { value.value.coverage = 'budget_exhausted'; },
    value => { value.value.selection = { mode: 'bounded-source-scan' }; },
    value => { value.value.namespaces[0].fetchExhausted = false; },
    value => { value.value.memories[0].rationale.coverage = 'root-incident-only'; },
    value => { value.value.memories[0].rationale.status = 'reconfirmation-suggested'; },
    value => { value.value.memories[0].rationale.root.revision = 2; },
    value => { value.value.memories[0].rationale.root.memoryId = 'missing'; },
    value => { value.value.memories[0].rationale.sources.shift(); },
    value => { value.value.memories[0].rationale.sources[0].memory.revision = 2; },
    value => { value.value.memories[0].rationale.sources[0].memory.currentness = 'historical'; },
    value => { value.value.memories[0].memory.currentness = 'historical';
      value.value.memories[0].rationale.sources[0].memory.currentness = 'historical'; },
    value => { value.value.memories[0].rationale.sources[1].memory.currentness = 'historical'; },
    value => { value.value.memories[0].rationale.sources[1].receipts[0].excerpt = 'Conflicting copy.';
      value.value.memories.push(root(later, old)); },
    value => { value.value.memories[0].rationale.edges[0].interpretationStatus = 'verified'; },
    value => { value.value.memories[0].rationale.edges[0].toReceipt = 'missing'; },
    value => { value.value.memories[0].rationale.extra = 'generated interpretation'; },
    value => { value.value.memories[0].qualification = { commitment: 'adopted' }; },
    value => { value.value.memories[0].rationale.sources[1].summary = 'Generated summary'; },
    value => { value.value.memories[0].receiptCount = 2; },
  ];
  let calls = 0;
  for (const mutate of mutations) {
    const value = envelope([root(old, later)]); mutate(value);
    const result = await deliverNeighborhoodSourceAnswer({ ...options(value), complete: () => { calls++; } });
    assert.equal(result.status, 'invalid-source'); assert.equal(result.completionCalls, 0);
  }
  for (const patch of [{ requestedContextMode: 'source-evidence' }, { requestedContextMode: null },
    { toolResult: { isError: true, content: [] } },
    { toolResult: { isError: false, content: [{ type: 'text', text: 'not json' }] } }]) {
    const result = await deliverNeighborhoodSourceAnswer({ ...options(envelope([root(old, later)])), ...patch,
      complete: () => { calls++; } });
    assert.equal(result.status, 'invalid-source'); assert.equal(result.completionCalls, 0);
  }
  assert.equal(calls, 0);
  const mixed = envelope([root(old, later), root(source('other'), later)]);
  mixed.value.memories[1].rationale.indexRevision = 4;
  assert.equal((await deliverNeighborhoodSourceAnswer({ ...options(mixed), complete: () => { calls++; } })).status,
    'invalid-source');
  assert.equal(calls, 0);
});

test('NC2–3 whole-union six-source and 24 kB body limits reject without truncating or completing', async () => {
  const selected = source('selected');
  const others = Array.from({ length: 6 }, (_, i) => source(`linked-${i}`));
  const roots = others.map(linked => root(selected, linked));
  let calls = 0;
  let result = await deliverNeighborhoodSourceAnswer({ ...options(envelope(roots)), complete: () => { calls++; } });
  assert.equal(result.status, 'invalid-source'); assert.equal(calls, 0);
  const large = Array.from({ length: 6 }, (_, i) => ({ ...source(`wide-${i}`),
    receipts: Array.from({ length: 4 }, (_, j) => ({ id: `r-${i}-${j}`, role: 'user', excerpt: '漢'.repeat(400) })),
    receiptCount: 4 }));
  const heavy = root(large[0], large[1]);
  heavy.rationale.sources = structuredClone(large);
  heavy.rationale.edges = [];
  result = await deliverNeighborhoodSourceAnswer({ ...options(envelope([heavy])), complete: () => { calls++; } });
  assert.equal(result.status, 'invalid-source'); assert.equal(calls, 0);
});

test('NC2/4 empty complete result is valid only with declared mode; completion failure/output remain visible once', async () => {
  const empty = options(envelope([]));
  assert.deepEqual(JSON.parse(prepareNeighborhoodSourceAnswer(empty).messages[1].content).memory.sources, []);
  let calls = 0;
  const failed = await deliverNeighborhoodSourceAnswer({ ...empty, complete: async () => {
    calls++; throw new Error('synthetic transport failure');
  } });
  assert.equal(failed.status, 'completion-failed'); assert.equal(failed.completionCalls, 1);
  const malformed = await deliverNeighborhoodSourceAnswer({ ...empty, complete: async () => {
    calls++; const out = response(); out.choices[0].finish_reason = 'length'; return out;
  } });
  assert.equal(malformed.status, 'invalid-output'); assert.equal(malformed.completionCalls, 1);
  assert.equal(malformed.answer, 'Synthetic answer; no quality claim.'); assert.equal(calls, 2);
  assert.equal((await deliverNeighborhoodSourceAnswer({ ...empty, requestedContextMode: 'source-evidence',
    complete: () => { calls++; } })).status, 'invalid-source');
  assert.equal(calls, 2);
});
