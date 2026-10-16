import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { createQualificationCandidateSnapshot, compileQualificationCandidates } from '../../../core/qualification-candidates.mjs';
import { createCaptureDeadline } from '../../../core/capture-deadline.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';
import { prepareClaimLocalCommitment, compileClaimLocalCommitment, refineClaimLocalCommitment } from '../claim-local-commitment.mjs';

// All interpretations below are SCRIPTED structural controls, not model quality.
const fields = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const namespace = { ownerId: 'claim-local-scripted', scope: 'personal', projectId: null };
const receipt = (excerpt, eventId = 'source') => ({ client: 'synthetic', sessionId: 'session', eventId, role: 'user', excerpt });
function fixture(sources = ['The sensor reads 12. I choose the evening inspection.'], contentPrefix = 'UNSHOWN mixed summary') {
  const snapshot = createQualificationCandidateSnapshot(sources.map((source, index) => ({
    content: `${contentPrefix} ${index}`, kind: 'fact', confidence: 0.9, receipts: [receipt(source, `source-${index}`)],
  })));
  const original = { qualifications: snapshot.input.items.map(item => ({ itemIndex: item.itemIndex,
    ...Object.fromEntries(fields.map(field => [field, {
      value: ({ subject: 'sensor', property: 'reading', scope: null, applies: null, value: '12', attribution: 'direct', commitment: 'adopted' })[field],
      evidenceIndices: field === 'scope' || field === 'applies' ? [] : [item.candidates[0].candidateIndex],
    }])),
  })) };
  return { snapshot, original };
}
const proposal = (value = 'unknown', itemIndex = 0, evidenceIndices = [0]) => ({ commitments: [{ itemIndex, commitment: { value, evidenceIndices } }] });
const ok = result => { assert.equal(result.ok, true, JSON.stringify(result)); return result.value; };
const invalid = fn => assert.throws(fn, { code: 'invalid_model_output' });
const [major, minor] = process.versions.node.split('.').map(Number);
const sqlite = { skip: major < 22 || (major === 22 && minor < 16)
  ? 'SQLite integration requires Node >=22.16; pure qualification tests remain enabled.' : false };

test('C2 source-only request binds exact descriptors/candidates and hides summary, prior stance and metadata', () => {
  const { snapshot, original } = fixture();
  const prepared = prepareClaimLocalCommitment(snapshot, original);
  assert.deepEqual(prepared.request.input, { items: [{ itemIndex: 0,
    selectedClaim: { subject: 'sensor', property: 'reading', scope: null, applies: null, value: '12' },
    candidates: snapshot.input.items[0].candidates,
  }] });
  assert.deepEqual(Object.keys(prepared.request).sort(), ['input', 'maxOutputTokens', 'system']);
  assert.equal(prepared.request.maxOutputTokens, 1024);
  assert.match(prepared.request.system, /unverified/i);
  assert.match(prepared.request.system, /numeric/i);
  assert.match(prepared.request.system, /quoted|reported/i);
  assert.ok(!JSON.stringify(prepared.request.input).includes('UNSHOWN'));
  assert.ok(!JSON.stringify(prepared.request.input).includes('adopted'));
  assert.ok(Object.isFrozen(prepared.request.input.items[0].selectedClaim));
  original.qualifications[0].subject.value = 'later mutation';
  assert.equal(prepared.originalOutput.qualifications[0].subject.value, 'sensor');
  assert.equal(prepared.schema.additionalProperties, false);
  assert.equal(prepared.schema.properties.commitments.minItems, 1);
  assert.equal(prepared.schema.properties.commitments.maxItems, 1);
});

test('C3 changes only commitment and its citations; original is retained, detached and immutable', () => {
  const { snapshot, original } = fixture(); const before = structuredClone(original);
  const prepared = prepareClaimLocalCommitment(snapshot, original);
  const result = compileClaimLocalCommitment(prepared, proposal());
  const expected = structuredClone(before); expected.qualifications[0].commitment.value = 'unknown';
  assert.deepEqual(result.originalOutput, before);
  assert.deepEqual(result.candidateOutput, expected);
  assert.deepEqual(result.compiledItems, compileQualificationCandidates(expected, snapshot));
  assert.deepEqual(original, before);
  assert.notEqual(result.candidateOutput, original);
  assert.ok(Object.isFrozen(prepared.originalOutput));
  invalid(() => compileClaimLocalCommitment(prepared, { commitments: [] }));
  assert.deepEqual(prepared.originalOutput, before);
});

test('C2/C5 one through five items accept reversed output order but reject altered snapshots and originals', () => {
  for (let count = 1; count <= 5; count++) {
    const { snapshot, original } = fixture(Array.from({ length: count }, (_, i) => `Own source ${i}.`));
    const prepared = prepareClaimLocalCommitment(snapshot, original);
    const commitments = snapshot.input.items.map(item => proposal('unknown', item.itemIndex, [item.candidates[0].candidateIndex]).commitments[0]);
    const result = compileClaimLocalCommitment(prepared, { commitments: commitments.reverse() });
    assert.deepEqual(result.candidateOutput.qualifications.map(q => q.itemIndex), original.qualifications.map(q => q.itemIndex));
    assert.equal(prepared.schema.properties.commitments.maxItems, count);
  }
  const { snapshot, original } = fixture();
  assert.throws(() => prepareClaimLocalCommitment({ items: [], candidates: [], input: { items: [] } }, original));
  const forged = structuredClone(snapshot); forged.candidates[0][0].text = 'forged';
  assert.throws(() => prepareClaimLocalCommitment(forged, original));
  const malformed = structuredClone(original); malformed.qualifications[0].subject.evidenceIndices = [99];
  assert.throws(() => prepareClaimLocalCommitment(snapshot, malformed));
});

test('C5 strict bounded refinements reject shape, item-map and own-candidate failures without repairing them', () => {
  const { snapshot, original } = fixture(['First source.', 'Second source.']);
  const prepared = prepareClaimLocalCommitment(snapshot, original);
  const valid = { commitments: [proposal().commitments[0], proposal('adopted', 1, [1]).commitments[0]] };
  const bad = [null, [], {}, { commitments: [] }, { ...valid, rationale: 'extra' },
    { commitments: [valid.commitments[0], valid.commitments[0]] },
    { commitments: [valid.commitments[0]] }, { commitments: Array(2) }];
  for (const patch of [
    { itemIndex: 2 }, { itemIndex: '0' }, { itemIndex: -1 }, { extra: true },
    { commitment: { value: 'certain', evidenceIndices: [0] } },
    { commitment: { value: 'adopted', evidenceIndices: [] } },
    { commitment: { value: 'unknown', evidenceIndices: [1] } },
    { commitment: { value: 'unknown', evidenceIndices: [0, 0] } },
    { commitment: { value: 'unknown', evidenceIndices: [-1] } },
    { commitment: { value: 'unknown', evidenceIndices: ['0'] } },
    { commitment: { value: 'unknown', evidenceIndices: [0.5] } },
    { commitment: { value: 'unknown', evidenceIndices: [0, 1, 2, 3, 4] } },
    { commitment: { value: 'unknown', evidenceIndices: [0], reason: 'extra' } },
  ]) bad.push({ commitments: [{ ...valid.commitments[0], ...patch }, valid.commitments[1]] });
  for (const output of bad) invalid(() => compileClaimLocalCommitment(prepared, output));
  const getter = { commitments: valid.commitments };
  Object.defineProperty(getter, 'extra', { get() { assert.fail('must not execute getter'); } });
  invalid(() => compileClaimLocalCommitment(prepared, getter));
  assert.deepEqual(prepared.originalOutput, original);
});

test('C5 four-candidate total is enforced after merging unchanged field citations', () => {
  const { snapshot, original } = fixture(['x'.repeat(800)]);
  // Add a second exact receipt to create candidate 4 without changing old refs.
  const more = createQualificationCandidateSnapshot([{ ...snapshot.items[0], receipts: [...snapshot.items[0].receipts, receipt('fifth source', 'second')] }]);
  original.qualifications[0].subject.evidenceIndices = [0, 1, 2, 3];
  const prepared = prepareClaimLocalCommitment(more, original);
  invalid(() => compileClaimLocalCommitment(prepared, proposal('adopted', 0, [4])));
  assert.equal(compileClaimLocalCommitment(prepared, proposal('adopted', 0, [3])).compiledItems[0].qualification.anchors.length, 4);
});

test('C5 unknown may omit its citations only if some unchanged field still anchors the item', () => {
  const { snapshot, original } = fixture();
  const supported = compileClaimLocalCommitment(prepareClaimLocalCommitment(snapshot, original), proposal('unknown', 0, []));
  assert.equal(supported.compiledItems[0].qualification.commitment, 'unknown');
  for (const field of fields) original.qualifications[0][field] = {
    value: field === 'attribution' || field === 'commitment' ? 'unknown' : null,
    evidenceIndices: field === 'commitment' ? [0] : [],
  };
  const prepared = prepareClaimLocalCommitment(snapshot, original);
  invalid(() => compileClaimLocalCommitment(prepared, proposal('unknown', 0, [])));
  assert.equal(compileClaimLocalCommitment(prepared, proposal()).compiledItems[0].qualification.anchors.length, 1);
});

test('C4 SCRIPTED observation, numeric choice, attributed choice, considered and rejected survive admission and cold inspection', sqlite, async t => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  const cases = [
    ['The sensor reads 12. I choose evening inspection.', 'unknown', 'direct'],
    ['I choose 12 degrees as the operating setting.', 'adopted', 'direct'],
    ['Mara said: "I choose 12 degrees." I only report her decision.', 'adopted', 'quoted'],
    ['Mara chose 12 degrees; I report her choice without adopting it myself.', 'adopted', 'reported'],
    ['I am considering 12 degrees but have not decided.', 'considered', 'direct'],
    ['I reject 12 degrees as the operating setting.', 'rejected', 'direct'],
  ];
  const workspace = createTestWorkspace(t, { prefix: 'cairn-claim-local-test-' });
  const path = join(workspace.path, 'memory.sqlite');
  let core = openMemoryCore({ path }); workspace.defer(() => core?.close());
  const saved = [];
  for (const [index, [source, stance, attribution]] of cases.entries()) {
    const { snapshot, original } = fixture([source], `Scripted case ${index}`);
    original.qualifications[0].attribution.value = attribution;
    original.qualifications[0].property.value = index === 0 ? 'reading' : 'operating setting';
    const result = compileClaimLocalCommitment(prepareClaimLocalCommitment(snapshot, original), proposal(stance));
    const compiled = result.compiledItems[0];
    const admitted = ok(core.admit({ namespace, memory: { content: compiled.content, kind: compiled.kind },
      receipts: compiled.receipts, qualification: compiled.qualification }));
    saved.push(ok(core.get({ namespace, memoryId: admitted.memory.id, includeQualification: true })));
    assert.equal(saved.at(-1).qualification.commitment, stance);
    assert.equal(saved.at(-1).memory.content, compiled.content);
    assert.equal(saved.at(-1).qualification.value, '12');
    assert.equal(saved.at(-1).qualification.attribution, attribution);
    assert.equal(saved.at(-1).qualification.anchors[0].text, source);
  }
  core.close(); core = openMemoryCore({ path });
  assert.deepEqual(saved.map(item => ok(core.get({ namespace, memoryId: item.memory.id, includeQualification: true }))), saved);
});

test('C5/C6 injected helper makes exactly one detached bounded call and never retries invalid results', async () => {
  const { snapshot, original } = fixture(); const before = structuredClone(original); let calls = 0;
  const model = { contextWindow: 8192, countTokens: () => 1,
    refineCommitment(request) {
      calls++;
      assert.equal(request.maxOutputTokens, 1024); assert.ok(request.signal instanceof AbortSignal);
      request.input.items[0].selectedClaim.subject = 'mutated';
      return proposal();
    } };
  const result = await refineClaimLocalCommitment(model, snapshot, original);
  assert.equal(calls, 1); assert.equal(result.compiledItems[0].qualification.slot.subject, 'sensor');
  assert.deepEqual(original, before);
  model.refineCommitment = () => { calls++; return { commitments: [] }; };
  await assert.rejects(refineClaimLocalCommitment(model, snapshot, original), { code: 'invalid_model_output' });
  assert.equal(calls, 2); assert.deepEqual(original, before);
});

test('C5 helper preserves missing-model, counter, input/output bounds and cancellation failures', async () => {
  const { snapshot, original } = fixture(); let calls = 0;
  const base = { contextWindow: 8192, countTokens: () => 1, refineCommitment: () => { calls++; return proposal(); } };
  const cases = [
    [{ ...base, refineCommitment: undefined }, 'model_not_configured'],
    [{ ...base, countTokens: undefined }, 'token_count_unavailable'],
    [{ ...base, contextWindow: 8191 }, 'context_budget_exceeded'],
    [{ ...base, countTokens: () => 6001 }, 'context_budget_exceeded'],
    [{ ...base, countTokens: text => text.includes('"commitments"') ? 1025 : 1 }, 'invalid_model_output'],
    [{ ...base, refineCommitment: () => { throw new DOMException('scripted cancellation', 'AbortError'); } }, 'model_cancelled'],
    [{ ...base, refineCommitment: () => { throw Error('scripted provider failure'); } }, 'qualification_failed'],
    [{ ...base, refineCommitment: () => ({ commitments: 'x'.repeat(40001) }) }, 'invalid_model_output'],
  ];
  for (const [model, code] of cases) await assert.rejects(refineClaimLocalCommitment(model, snapshot, original), { code });
  assert.equal(calls, 1, 'only the output-token-overflow case invokes the base model');
});

test('C5 timeout aborts one pending call; expired deadline and malformed baseline dispatch nothing', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { snapshot, original } = fixture(); let calls = 0, signal, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const model = { contextWindow: 8192, countTokens: () => 1, refineCommitment(request) {
    calls++; signal = request.signal; entered(); return new Promise(() => {});
  } };
  const pending = refineClaimLocalCommitment(model, snapshot, original);
  await started; t.mock.timers.tick(30000);
  await assert.rejects(pending, { code: 'model_timeout' }); assert.equal(signal.aborted, true); assert.equal(calls, 1);
  const deadline = { expired: () => true, check() { throw Object.assign(Error(), { code: 'model_timeout' }); } };
  await assert.rejects(refineClaimLocalCommitment(model, snapshot, original, deadline), { code: 'model_timeout' });
  await assert.rejects(refineClaimLocalCommitment(model, snapshot, original, createCaptureDeadline(0)), { code: 'model_timeout' });
  await assert.rejects(refineClaimLocalCommitment(model, snapshot, { qualifications: [] }));
  assert.equal(calls, 1);
});

test('C5 supplied remaining deadline bounds the pending model instead of starting a fresh thirty seconds', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { snapshot, original } = fixture(); let signal, entered;
  const started = new Promise(resolve => { entered = resolve; });
  const deadline = { check() {}, expired: () => false, remainingMs: () => 17 };
  const pending = refineClaimLocalCommitment({ contextWindow: 8192, countTokens: () => 1,
    refineCommitment(request) { signal = request.signal; entered(); return new Promise(() => {}); },
  }, snapshot, original, deadline);
  await started; t.mock.timers.tick(16); assert.equal(signal.aborted, false);
  t.mock.timers.tick(1);
  await assert.rejects(pending, { code: 'model_timeout' }); assert.equal(signal.aborted, true);
});

test('C6 owned store cleanup runs after both successful and failing refinement', sqlite, async () => {
  const { openMemoryCore } = await import('../../../core/contract.mjs');
  for (const fail of [false, true]) {
    const workspace = createTestWorkspace(null, { prefix: 'cairn-claim-local-cleanup-' });
    const path = workspace.path;
    try {
      const core = openMemoryCore({ path: join(path, 'memory.sqlite') }); workspace.defer(() => core.close());
      const { snapshot, original } = fixture();
      const prepared = prepareClaimLocalCommitment(snapshot, original);
      if (fail) invalid(() => compileClaimLocalCommitment(prepared, { commitments: [] }));
      else assert.equal(compileClaimLocalCommitment(prepared, proposal()).compiledItems[0].qualification.commitment, 'unknown');
    } finally { await workspace.cleanup(); }
    assert.equal(existsSync(path), false);
  }
});
