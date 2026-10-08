import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { compileSourceRoleArm, prepareSourceRoleArm } from '../../source-role-ablation/compiler.mjs';
import { sourceRoleCases } from '../../source-role-ablation/cases.mjs';
import { sourceRoleRubric, retainedCoverage, advancementEvidence, evaluatorMarker } from '../../source-role-ablation/rubric.mjs';
import { extractedWindowItems } from '../../../core/source-windows.mjs';
import { createTestWorkspace } from '../../../tools/testing/workspace.mjs';

const asset = name => readFileSync(new URL(`../../source-role-ablation/${name}`, import.meta.url));
const manifest = JSON.parse(asset('frozen-manifest.json'));
const item = sourceIndices => ({ content: 'Synthetic structural control, not a semantic judgment.',
  kind: 'fact', confidence: 0.7, sourceIndices });
const compile = (caseOrdinal, arm, items) => compileSourceRoleArm({ caseOrdinal, arm, scriptedOutput: { items } });
const review = { status: 'independent-blind-reviewed', reviewedSlots: 24,
  baselineUnsupportedPromotions: 1, candidateUnsupportedPromotions: 0 };

test('N28A/B/E exact frozen assets, twelve scenarios and alternating fixed 24 slots', () => {
  assert.equal(sourceRoleCases.length, 12);
  assert.equal(sourceRoleRubric.length, 12);
  for (const [name, digest] of Object.entries(manifest.sha256)) {
    assert.equal(createHash('sha256').update(asset(name)).digest('hex'), digest, name);
  }
  assert.deepEqual(asset('baseline.md'), readFileSync(new URL('../../../core/prompts/extract-source-windows.md', import.meta.url)));
  assert.equal(manifest.slots.length, 24);
  for (let index = 0; index < 24; index++) {
    const ordinal = Math.floor(index / 2) + 1;
    assert.deepEqual(manifest.slots[index], { slot: index + 1, ordinal,
      arm: (index % 2 === 0) === (ordinal % 2 === 1) ? 'baseline' : 'candidate' });
  }
  assert.equal(sourceRoleCases[4].capture.messages.length, 21);
  assert.equal(sourceRoleRubric[4].eligibleDirectEpisodes.length, 21);
  assert.equal(sourceRoleRubric[4].beyondCapacity, true);
  assert.equal(sourceRoleRubric[10].requiredAssistantEvidence.length, 1);
  assert.equal(sourceRoleRubric[11].requiredAssistantEvidence.length, 1);
  assert.equal(sourceRoleRubric[6].contextEvidence[0].claimedSpeaker, 'user');
  assert.equal(sourceRoleRubric[6].contextEvidence[0].claimSubject, 'neighbor Ivo');
  assert.ok(Object.isFrozen(sourceRoleCases[0].capture.messages[0]));
});

test('N28C actual bounded extraction preparation and offline compilation', async () => {
  const prepared = prepareSourceRoleArm({ caseOrdinal: 1, arm: 'baseline' });
  assert.equal(prepared.catalog.entries[0].role, 'user');
  const result = await compileSourceRoleArm({ caseOrdinal: 1, arm: 'baseline', scriptedOutput: { items: [] } });
  assert.equal(result.status, 'completed');
  assert.equal(result.httpBodies.length, 2);
});

test('N28C/F both arms use actual fit, same catalog/schema/model and exact count/generation payload', async () => {
  const measured = [];
  for (const { ordinal } of sourceRoleCases) {
    const baseline = prepareSourceRoleArm({ caseOrdinal: ordinal, arm: 'baseline' });
    const candidate = prepareSourceRoleArm({ caseOrdinal: ordinal, arm: 'candidate' });
    assert.deepEqual(candidate.catalog, baseline.catalog);
    assert.deepEqual(candidate.request.input, baseline.request.input);
    assert.ok(candidate.localInputTokens > baseline.localInputTokens);
    assert.ok(candidate.localInputTokens <= 6000);
    measured.push({ ordinal, baseline: baseline.localInputTokens, candidate: candidate.localInputTokens,
      delta: candidate.localInputTokens - baseline.localInputTokens });
    let baselineSchema;
    for (const arm of ['baseline', 'candidate']) {
      const prepared = arm === 'baseline' ? baseline : candidate;
      const result = await compile(ordinal, arm, [item([0])]);
      assert.equal(result.status, 'completed', `${ordinal}:${arm}:${result.code}`);
      assert.deepEqual(result.caps, manifest.caps);
      assert.equal(result.envelopeText, prepared.envelopeText);
      assert.equal(JSON.parse(result.envelopeText).system, prepared.request.system);
      const count = JSON.parse(result.httpBodies[0].bodyText);
      const generation = JSON.parse(result.httpBodies[1].bodyText);
      assert.deepEqual(result.httpBodies.map(body => body.endpoint), ['/v1/responses/input_tokens', '/v1/responses']);
      assert.deepEqual(generation, { ...count, max_output_tokens: 1024, store: false, stream: false });
      assert.equal(count.instructions, prepared.request.system);
      assert.equal(count.model, manifest.model);
      assert.equal(count.truncation, 'disabled');
      assert.deepEqual(JSON.parse(count.input[0].content[0].text), prepared.request.input);
      if (arm === 'baseline') baselineSchema = count.text.format;
      else assert.deepEqual(count.text.format, baselineSchema);
      const sourceIndexSchema = count.text.format.schema.properties.items.items.properties.sourceIndices.items;
      assert.equal(sourceIndexSchema.minimum, 0);
      assert.equal(sourceIndexSchema.maximum, prepared.catalog.entries.length - 1);
      assert.ok(!JSON.stringify(result.httpBodies).includes(evaluatorMarker));
      assert.ok(!JSON.stringify(result.httpBodies).includes('eligibleDirectEpisodes'));
      const receipt = result.items[0].receipts[0], entry = prepared.catalog.entries[0];
      assert.equal(receipt.eventId, entry.id);
      assert.equal(receipt.role, entry.role);
      assert.equal(receipt.excerpt, entry.content);
    }
  }
  console.log('N28 actual local input measurements:', JSON.stringify(measured));
});

test('N28D boundary anchor needs union of validated original windows, not matching summary words', async () => {
  const prepared = prepareSourceRoleArm({ caseOrdinal: 2, arm: 'candidate' });
  const anchor = sourceRoleRubric[1].eligibleDirectEpisodes[0];
  assert.ok(anchor.start < prepared.catalog.entries[0].end && anchor.end > prepared.catalog.entries[0].end);
  const firstOnly = await compile(2, 'candidate', [item([0])]);
  const both = await compile(2, 'candidate', [item([0, 1])]);
  assert.equal(retainedCoverage(2, firstOnly).directRetained, 0);
  assert.equal(retainedCoverage(2, both).directRetained, 1);
  assert.equal(retainedCoverage(2, both).semanticCorrectness, 'unassessed');
  assert.ok(!both.items[0].content.includes('orchard tram'));
  assert.throws(() => retainedCoverage(1, both), /invalid_coverage_result/);
  for (const mutate of [
    result => { result.passages[0].end++; }, result => { result.passages[0].excerpt = 'fabricated excerpt'; },
    result => { result.passages[0].messageId = 'foreign source'; }, result => { result.arm = 'unknown'; },
    result => { result.status = 'refused'; }, result => { result.passages.push(result.passages[0]); },
  ]) {
    const forged = structuredClone(both); mutate(forged);
    assert.throws(() => retainedCoverage(2, forged), /invalid_coverage_result/);
  }
});

test('N28D capacity omission remains separate and useful assistant explanation survives correction', async () => {
  const twenty = await compile(5, 'candidate', Array.from({ length: 5 }, (_, group) =>
    item(Array.from({ length: 4 }, (_, offset) => group * 4 + offset))));
  assert.equal(twenty.status, 'completed');
  assert.equal(twenty.passages.length, 20);
  assert.equal(retainedCoverage(5, twenty).directRetained, 20);
  assert.equal(retainedCoverage(5, twenty).directTotal, 21);
  const correction = await compile(12, 'candidate', [item([0, 1, 2])]);
  assert.equal(retainedCoverage(12, correction).assistantRetained, 1);
  assert.equal(retainedCoverage(12, correction).directRetained, 1);
  assert.deepEqual(correction.items[0].receipts.map(receipt => receipt.role), ['assistant', 'user', 'user']);
});

test('N28F bad source selections and malformed later items refuse the entire arm, empty remains valid', async () => {
  const badOutputs = [
    [item([-1])], [item([2])], [item([0.5])], [item(['0'])], [item([0, 0])],
    [item([0]), { ...item([1]), kind: 'unsupported-kind' }],
    [item([0]), { ...item([1]), content: 'x'.repeat(601) }],
    [{ ...item([0]), role: 'assistant' }], [item([0, 1, 0, 1, 0])],
    Array.from({ length: 6 }, () => item([0])),
  ];
  for (const items of badOutputs) {
    const result = await compile(1, 'candidate', items);
    assert.equal(result.status, 'refused', JSON.stringify(items));
    assert.equal(result.code, 'invalid_model_output');
    assert.deepEqual(result.items, []);
    assert.deepEqual(result.passages, []);
    assert.equal(retainedCoverage(1, result).directRetained, 0);
  }
  const empty = await compile(1, 'candidate', []);
  assert.equal(empty.status, 'completed');
  assert.deepEqual(empty.items, []);
  const prepared = prepareSourceRoleArm({ caseOrdinal: 1, arm: 'candidate' });
  assert.throws(() => extractedWindowItems({ items: [item([0]), { ...item([1]), sourceIndices: [999] }] },
    prepared.snapshot, prepared.catalog), error => error.code === 'invalid_model_output');
});

test('N28E fixed-denominator advancement requires independently reviewed candidate promotions and assistant coverage', async () => {
  const rows = [];
  for (const { ordinal } of sourceRoleCases) for (const arm of ['baseline', 'candidate']) {
    const indices = ordinal === 11 ? [0] : ordinal === 12 ? [0, 1, 2] : [];
    const result = await compile(ordinal, arm, indices.length ? [item(indices)] : []);
    rows.push({ ...retainedCoverage(ordinal, result), arm });
  }
  const candidate1 = await compile(1, 'candidate', [item([0])]);
  const candidate3 = await compile(3, 'candidate', [item([0])]);
  for (const [ordinal, result] of [[1, candidate1], [3, candidate3]]) {
    rows[rows.findIndex(row => row.ordinal === ordinal && row.arm === 'candidate')] = { ...retainedCoverage(ordinal, result), arm: 'candidate' };
  }
  const accepted = advancementEvidence(rows, review);
  assert.equal(accepted.additionalDirect, 2);
  assert.equal(accepted.baselineUnsupportedPromotions, 1);
  assert.equal(accepted.candidateRequiredMissing, 0);
  assert.equal(accepted.decision, 'eligible-for-separate-review-not-prompt-promotion');
  assert.equal(advancementEvidence(rows).decision, 'do-not-advance');
  assert.equal(advancementEvidence(rows, { ...review, candidateUnsupportedPromotions: 1 }).decision, 'do-not-advance');
  const mutated = mutate => { const copy = structuredClone(rows); mutate(copy); return copy; };
  for (const mutation of [
    copy => { copy[0].directTotal = 999; }, copy => { copy[0].directRetained = 2; },
    copy => { copy[0].directRetained = 0.5; }, copy => { copy[0].beyondCapacity = true; },
    copy => { copy[0].status = 'unknown'; }, copy => { copy[0] = copy[1]; },
    copy => { copy[1].status = 'refused'; }, copy => { copy[0].extra = true; },
    copy => { copy.find(row => row.ordinal === 5).directRetained = 21; },
  ]) assert.throws(() => advancementEvidence(mutated(mutation), review), /invalid_ablation_rows/);
  assert.throws(() => advancementEvidence(rows.slice(1), review), /invalid_ablation_rows/);
  assert.throws(() => advancementEvidence(rows, { ...review, reviewedSlots: 23 }), /invalid_semantic_review/);
  let getterCalls = 0;
  assert.throws(() => advancementEvidence(rows, { ...review,
    get candidateUnsupportedPromotions() { getterCalls++; return 0; } }), /invalid_semantic_review/);
  assert.equal(getterCalls, 0);
  assert.equal(advancementEvidence(mutated(copy => { copy[1].capsUnchanged = false; }), review).decision, 'do-not-advance');
  const lostBoth = mutated(copy => {
    for (const row of copy.filter(row => row.ordinal === 11)) row.assistantRetained = 0;
  });
  assert.equal(advancementEvidence(lostBoth, review).assistantLoss, false);
  assert.equal(advancementEvidence(lostBoth, review).candidateRequiredMissing, 1);
  assert.equal(advancementEvidence(lostBoth, review).decision, 'do-not-advance');
  const increasedFailure = mutated(copy => { copy.find(row => row.ordinal === 7 && row.arm === 'candidate').status = 'refused'; });
  assert.equal(advancementEvidence(increasedFailure, review).candidateStructuralFailures, 1);
  assert.equal(advancementEvidence(increasedFailure, review).decision, 'do-not-advance');
  const overCapacityOnly = mutated(copy => { copy.find(row => row.ordinal === 5 && row.arm === 'candidate').directRetained = 20; });
  assert.equal(advancementEvidence(overCapacityOnly, review).additionalDirect, 2);
  assert.equal(advancementEvidence(overCapacityOnly, review).overCapacity.candidateRetained, 20);
  const ceiling = mutated(copy => {
    for (const row of copy) row.directRetained = row.beyondCapacity ? 20 : row.directTotal;
  });
  assert.equal(advancementEvidence(ceiling, review).additionalDirect, 0);
  assert.equal(advancementEvidence(ceiling, review).decision, 'do-not-advance');
});

test('N28G model-facing modules cannot import rubric or accept live transport/key/prompt overrides', async () => {
  for (const file of ['cases.mjs', 'compiler.mjs']) {
    const source = asset(file).toString();
    assert.doesNotMatch(source, /from\s+['"][^'"]*rubric/u);
    assert.doesNotMatch(source, /process\.env|globalThis\.fetch|process\.argv/u);
  }
  let getterCalls = 0;
  const bad = { caseOrdinal: 1, arm: 'candidate', get fetchImpl() { getterCalls++; throw new Error('must-not-run'); } };
  assert.throws(() => prepareSourceRoleArm(bad), /invalid_source_role_options/);
  assert.equal(getterCalls, 0);
  for (const extra of ['fetchImpl', 'apiKey', 'system', 'model']) {
    await assert.rejects(compileSourceRoleArm({ caseOrdinal: 1, arm: 'candidate', scriptedOutput: { items: [] },
      [extra]: 'forbidden override' }), /invalid_source_role_options/);
  }
});

test('N28F owned workspace cleanup on successful and deliberately failed offline operations', async () => {
  for (const fail of [false, true]) {
    const workspace = createTestWorkspace(null, { prefix: 'cairn-n28-offline-' });
    let observedFailure = false;
    try {
      if (fail) await compileSourceRoleArm({ caseOrdinal: 13, arm: 'candidate', scriptedOutput: { items: [] } });
      else assert.equal((await compile(1, 'baseline', [])).status, 'completed');
    } catch (error) { observedFailure = true; assert.match(error.message, /invalid_source_role_options/); }
    finally { await workspace.cleanup(); }
    assert.equal(observedFailure, fail);
    assert.equal(existsSync(workspace.path), false);
  }
});
