import assert from 'node:assert/strict';
import test from 'node:test';
import { join } from 'node:path';
import { openMemoryCore } from '../index.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

// Frozen in the plan before execution. These are scripted interpretations,
// not a semantic classifier, a provider, or a second decision engine.
const sources = Object.freeze({
  A: { role: 'user', text: 'For my work notes this year, I choose A because A supports offline work.',
    content: 'For my work notes this year, I choose A.', value: 'A', commitment: 'adopted' },
  premise: { role: 'user', text: 'A supports offline work.', value: 'offline', commitment: 'unknown' },
  backup: { role: 'user', text: 'Keep a paper backup even if the tool changes.', value: 'paper', commitment: 'adopted' },
  proposed: { role: 'assistant', text: 'You could use B for your work notes this year.', value: 'B', commitment: 'unknown', attribution: 'proposed' },
  considered: { role: 'user', text: 'I am considering B for my work notes this year, not choosing it.', value: 'B', commitment: 'considered' },
  challenge: { role: 'user', text: 'I checked: A cannot work offline.', value: 'online', commitment: 'unknown' },
  B: { role: 'user', text: 'For my work notes this year, I now choose B.', value: 'B', commitment: 'adopted' },
  quote: { role: 'user', text: 'For history only: last spring I said "I choose A"; this is not a new choice.',
    value: 'A', commitment: 'unknown', attribution: 'quoted' },
});
const namespace = { ownerId: 'synthetic-decision-timeline', scope: 'personal', projectId: null };
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const ref = memory => ({ memoryId: memory.id, revision: memory.revision });
const expected = memory => ({ memoryId: memory.id, expectedRevision: memory.revision });
const get = (core, id) => ok(core.get({ namespace, memoryId: id, includeQualification: true }));

function scriptedModel(calls) {
  const definitions = Object.entries(sources);
  const find = text => {
    const row = definitions.find(([, source]) => (source.content ?? source.text) === text);
    assert.ok(row, `unregistered synthetic interpretation: ${text}`);
    return row;
  };
  const methods = {
    extract: ({ input }) => ({ items: input.messages.map(message => {
      const source = definitions.find(([, entry]) => entry.text === message.content)?.[1];
      assert.ok(source);
      return { content: source.content ?? source.text, kind: 'context', confidence: 0.5, sourceIndices: [message.index] };
    }) }),
    qualifyCandidates: ({ input }) => ({ qualifications: input.items.map(item => {
      const [key, source] = find(item.content);
      const values = { subject: 'I', property: key === 'backup' ? 'backup rule' : ['premise', 'challenge'].includes(key) ? 'offline support' : 'tool choice',
        scope: 'work notes', applies: key === 'quote' ? 'last spring' : 'this year', value: source.value,
        attribution: source.attribution ?? 'direct', commitment: source.commitment };
      return { itemIndex: item.itemIndex, ...Object.fromEntries(Object.entries(values).map(([field, value]) => [field,
        { value, evidenceIndices: [item.candidates[0].candidateIndex] }])) };
    }) }),
    classify: ({ input }) => ({ items: input.memories.map(memory => ({ memoryId: memory.id, parentIds: [] })) }),
    relate: ({ input }) => {
      const locate = key => input.memories.find(memory => memory.receipts.some(receipt => receipt.excerpt === sources[key].text));
      const A = locate('A'), premise = locate('premise'), challenge = locate('challenge');
      const edge = (from, to, relation) => ({ from: from.index, to: to.index, relation, fromReceipt: 0, toReceipt: 0 });
      return { edges: [...(A && premise ? [edge(premise, A, 'supports-decision')] : []),
        ...(premise && challenge ? [edge(challenge, premise, 'challenges-premise')] : [])] };
    },
    // Cold selection uses only the request-visible catalog and query, never
    // warm IDs, the conversation, or an expected source roster.
    select: ({ input }) => ({ refs: input.maps.flatMap(map => map.items
      .filter(item => item.type === 'unfiled' && item.label.includes(input.query))
      .map(item => ({ namespaceIndex: map.namespaceIndex, ...item.ref }))) }),
    rank: ({ input }) => ({ refs: input.candidates.slice(0, input.limit).map(candidate => ({
      namespaceIndex: candidate.namespaceIndex, memoryId: candidate.memory.id, revision: candidate.memory.revision })) }),
  };
  return { contextWindow: 8192, countTokens: () => 1,
    ...Object.fromEntries(Object.entries(methods).map(([method, run]) => [method, request => {
      calls.push({ method, input: structuredClone(request.input) }); return run(request);
    }])) };
}

function fixture(t) {
  const workspace = createTestWorkspace(t, { prefix: 'cairn-decision-timeline-' });
  const path = join(workspace.path, 'memory.sqlite');
  const calls = [];
  let closeCurrent;
  const open = () => {
    const core = openMemoryCore({ path, model: scriptedModel(calls), captureQualification: 'source-bound-v2', captureRationale: 'source-bound-v1' });
    let closed = false;
    closeCurrent = () => { if (!closed) { core.close(); closed = true; } };
    workspace.defer(closeCurrent);
    return core;
  };
  return { core: open(), calls, reopen() { closeCurrent(); return open(); } };
}
async function capture(core, key) {
  const source = sources[key];
  const result = ok(await core.capture({ namespace, client: 'synthetic-client', sessionId: 'timeline', eventId: key,
    messages: [{ id: key, role: source.role, content: source.text }] }));
  assert.equal(result.admission.memories.length, 1);
  assert.equal(result.classification.status, 'applied');
  assert.equal(result.rationale.status, 'reviewed');
  const detail = get(core, result.admission.memories[0].id);
  assert.deepEqual(detail.receipts.map(({ role, excerpt }) => ({ role, excerpt })), [{ role: source.role, excerpt: source.text }]);
  assert.equal(detail.qualification.commitment, source.commitment);
  assert.equal(detail.qualification.attribution, source.attribution ?? 'direct');
  assert.ok(detail.qualification.anchors.some(anchor => anchor.text === source.text));
  return detail.memory;
}
async function throughChallenge(core) {
  const memories = {};
  for (const key of ['A', 'premise', 'backup', 'proposed', 'considered', 'challenge']) memories[key] = await capture(core, key);
  const report = ok(core.getRationale({ namespace, ...ref(memories.A) }));
  assert.equal(report.status, 'reconfirmation-suggested');
  assert.equal(report.edges.length, 2);
  assert.deepEqual(report.edges.map(edge => edge.relation).sort(), ['challenges-premise', 'supports-decision']);
  assert.ok(report.edges.some(edge => edge.from === memories.premise.id && edge.to === memories.A.id && edge.relation === 'supports-decision'));
  assert.ok(report.edges.some(edge => edge.from === memories.challenge.id && edge.to === memories.premise.id && edge.relation === 'challenges-premise'));
  assert.deepEqual(report.sources.flatMap(source => source.receipts.map(receipt => receipt.excerpt)).sort(),
    ['A', 'premise', 'challenge'].map(key => sources[key].text).sort());
  assert.equal(get(core, memories.A.id).memory.state, 'active');
  return { memories, report };
}
async function coldRecall(core, calls, query, expectedExcerpt, rationale) {
  const start = calls.length;
  const result = ok(await core.recall({ readSet: [namespace], query, contextMode: 'rationale-evidence' }));
  assert.equal(result.memories.length, 1);
  const selected = result.memories[0];
  assert.deepEqual(selected.rationale, rationale);
  assert.ok(selected.rationale.sources.some(source => source.receipts.some(receipt => receipt.excerpt === expectedExcerpt)));
  const reads = calls.slice(start);
  assert.deepEqual(reads.map(call => call.method), ['select', 'rank']);
  assert.deepEqual(reads[1].input.candidates[0].rationale, rationale);
  return result;
}

test('DT2–DT6 tentative B, challenged A, trusted adopted B and late historical quote survive cold sessions', async t => {
  const f = fixture(t); let core = f.core;
  const { memories: m, report } = await throughChallenge(core);
  const snapshot = () => Object.values(m).map(memory => get(core, memory.id));
  const before = snapshot();
  const mapBefore = ok(core.map({ namespace }));
  const invalid = core.bindQualifiedClaim({ namespace, ...expected(m.A), slotId: null, singleClaim: false });
  assert.equal(invalid.ok, false); assert.equal(invalid.error.code, 'invalid_input');
  const refusal = ok(core.transitionQualified({ namespace, predecessor: expected(m.A), replacement: expected(m.considered) }));
  assert.equal(refusal.status, 'unresolved'); assert.equal(refusal.reason, 'binding_missing');
  assert.equal(refusal.retiredCount, 0); assert.deepEqual(snapshot(), before);
  assert.deepEqual(ok(core.map({ namespace })), mapBefore);
  core = f.reopen();
  assert.deepEqual(ok(core.getRationale({ namespace, ...ref(m.A) })), report);
  await coldRecall(core, f.calls, 'choose A', sources.A.text, report);

  m.B = await capture(core, 'B');
  const originalA = get(core, m.A.id), originalB = get(core, m.B.id);
  // TRUSTED embedded identity and single-claim attestation, not host inference.
  const binding = ok(core.bindQualifiedClaim({ namespace, ...expected(m.A), slotId: null, singleClaim: true }));
  ok(core.bindQualifiedClaim({ namespace, ...expected(m.B), slotId: binding.slotId, singleClaim: true }));
  const transition = ok(core.transitionQualified({ namespace, predecessor: expected(m.A), replacement: expected(m.B) }));
  assert.equal(transition.status, 'applied'); assert.equal(transition.retiredCount, 1);
  const historicalA = get(core, m.A.id);
  assert.equal(historicalA.memory.state, 'historical');
  assert.deepEqual(historicalA.receipts, originalA.receipts);
  assert.deepEqual(historicalA.qualification, originalA.qualification);
  assert.equal(historicalA.supersession.replacement.memoryId, m.B.id);
  assert.deepEqual(historicalA.supersession.receiptIds, originalB.receipts.map(receipt => receipt.id));
  for (const key of ['proposed', 'considered', 'backup']) assert.equal(get(core, m[key].id).memory.state, 'active');
  m.quote = await capture(core, 'quote');
  const Bbefore = get(core, m.B.id), quoteBefore = get(core, m.quote.id);
  const lateRefusal = ok(core.transitionQualified({ namespace, predecessor: expected(m.B), replacement: expected(m.quote) }));
  assert.equal(lateRefusal.reason, 'binding_missing'); assert.equal(lateRefusal.retiredCount, 0);
  assert.deepEqual(get(core, m.B.id), Bbefore); assert.deepEqual(get(core, m.quote.id), quoteBefore);

  core = f.reopen(); const coldStart = f.calls.length;
  assert.deepEqual(get(core, m.B.id), Bbefore); assert.deepEqual(get(core, m.A.id), historicalA);
  assert.deepEqual(get(core, m.quote.id), quoteBefore);
  const historyRef = ref(historicalA.memory);
  const history = ok(core.fetch({ namespace, refs: [historyRef], view: 'historical', contextMode: 'source-evidence' }));
  assert.equal(history.items.length, 1); assert.equal(history.items[0].memory.currentness, 'historical');
  assert.deepEqual(history.items[0].receipts.map(receipt => receipt.excerpt), [sources.A.text]);
  const unsupported = core.fetch({ namespace, refs: [historyRef], view: 'historical', contextMode: 'rationale-evidence' });
  assert.equal(unsupported.ok, false); assert.equal(unsupported.error.code, 'invalid_input');
  const unknownReason = ok(core.getRationale({ namespace, ...ref(m.B) }));
  assert.equal(unknownReason.status, 'unassessed'); assert.deepEqual(unknownReason.edges, []);
  assert.equal(unknownReason.sources.length, 1);
  await coldRecall(core, f.calls, 'choose B', sources.B.text, unknownReason);
  assert.ok(f.calls.slice(coldStart).every(call => ['select', 'rank'].includes(call.method)));
  assert.equal(get(core, m.backup.id).memory.state, 'active');
  const backup = ok(core.fetch({ namespace, refs: [ref(m.backup)], contextMode: 'source-evidence' }));
  assert.equal(backup.items.length, 1);
  assert.deepEqual(backup.items[0].receipts.map(receipt => receipt.excerpt), [sources.backup.text]);
});

for (const action of ['correct', 'forget']) test(`DT7 ${action} challenge invalidates prior context without confirming A`, async t => {
  const f = fixture(t); let core = f.core;
  const { memories: m } = await throughChallenge(core);
  const A = get(core, m.A.id), backup = get(core, m.backup.id);
  if (action === 'correct') ok(core.correct({ namespace, ...expected(m.challenge),
    content: 'The earlier offline check was inconclusive.', kind: 'context',
    receipt: { client: 'synthetic-client', sessionId: 'correction', eventId: 'correct', role: 'user', excerpt: 'The earlier offline check was inconclusive.' } }));
  else ok(core.forget({ namespace, ...expected(m.challenge) }));
  core = f.reopen(); const start = f.calls.length;
  const report = ok(core.getRationale({ namespace, ...ref(m.A) }));
  assert.equal(report.status, 'unassessed');
  assert.deepEqual(report.edges.map(edge => edge.relation), ['supports-decision']);
  assert.equal(report.sources.length, 2);
  assert.ok(!JSON.stringify(report).includes(sources.challenge.text));
  const recalled = await coldRecall(core, f.calls, 'choose A', sources.A.text, report);
  assert.ok(!JSON.stringify(recalled).includes(sources.challenge.text));
  assert.deepEqual(get(core, m.A.id), A); assert.deepEqual(get(core, m.backup.id), backup);
  if (action === 'correct') {
    const corrected = get(core, m.challenge.id);
    assert.equal(corrected.memory.content, 'The earlier offline check was inconclusive.');
    assert.ok(corrected.receipts.some(receipt => receipt.excerpt === 'The earlier offline check was inconclusive.'));
  } else {
    const forgotten = core.get({ namespace, memoryId: m.challenge.id });
    assert.equal(forgotten.ok, false); assert.equal(forgotten.error.code, 'memory_not_found');
  }
  assert.ok(f.calls.slice(start).every(call => ['select', 'rank'].includes(call.method)));
});
