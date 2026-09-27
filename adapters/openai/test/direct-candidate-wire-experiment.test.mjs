import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { compileQualificationCandidates, createQualificationCandidateSnapshot } from '../../../core/qualification-candidates.mjs';
import { createQualificationTextCatalog } from '../../../core/qualification-text-catalog.mjs';
import { decodeQualificationEvidencePool } from '../qualification-evidence-pool.mjs';
import { compileDirectCandidates, decodeDirectCandidates,
  directCandidateSchema, measureCandidateRequest } from '../../../evaluation/qualification-wire/direct-candidates.mjs';
import { buildDirectCandidateReport, syntheticOutputWire, verifyActualBaseline,
  syntheticSnapshot } from '../../../evaluation/qualification-wire/report.mjs';

const FIELDS = ['subject', 'property', 'scope', 'applies', 'value', 'attribution', 'commitment'];
const bad = (wire, snapshot) => assert.throws(() => compileDirectCandidates(wire, snapshot),
  /invalid_direct_candidate_output|invalid_model_output/u);

function wires(snapshot) {
  const direct = { wireVersion: 'direct-candidates-v1', qualifications: {} };
  const pool = { wireVersion: 'evidence-pool-v1', qualifications: {} };
  for (const item of snapshot.input.items) {
    const id = item.candidates[0].candidateIndex;
    const fields = Object.fromEntries(FIELDS.map(field => [field, { value: field === 'attribution'
      ? 'direct' : field === 'commitment' ? 'adopted' : field === 'value' ? 'synthetic value' : null,
    evidenceIndices: ['value', 'attribution', 'commitment'].includes(field) ? [id] : [] }]));
    direct.qualifications[`item_${item.itemIndex}`] = { itemIndex: item.itemIndex, ...fields };
    pool.qualifications[`item_${item.itemIndex}`] = { itemIndex: item.itemIndex, pool: [id],
      ...Object.fromEntries(FIELDS.map(field => [field, { value: fields[field].value,
        evidenceSlots: fields[field].evidenceIndices.map(() => 0) }])) };
  }
  return { direct, pool };
}

test('W1 per-item direct schema retains exact fields, known minimum and original candidate enums', () => {
  const full = syntheticSnapshot('unicode800', 5);
  const schema = directCandidateSchema(full.input);
  assert.deepEqual(schema.properties.wireVersion.enum, ['direct-candidates-v1']);
  assert.deepEqual(schema.properties.qualifications.required, ['item_0', 'item_1', 'item_2', 'item_3', 'item_4']);
  const visit = node => { if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual(node.required, Object.keys(node.properties));
    }
    Object.values(node).forEach(visit);
  }; visit(schema);
  for (let index = 0; index < 5; index++) {
    const ids = full.input.items[index].candidates.map(candidate => candidate.candidateIndex);
    assert.deepEqual(schema.$defs[`item_${index}_knownRefs`].items.enum, ids);
    assert.deepEqual(schema.$defs[`item_${index}_unknownRefs`].items.enum, ids);
    assert.equal(schema.$defs[`item_${index}_knownRefs`].minItems, 1);
    assert.equal(schema.$defs[`item_${index}_unknownRefs`].minItems, 0);
    assert.equal(schema.$defs[`item_${index}_knownRefs`].maxItems, 4);
    assert.deepEqual(schema.properties.qualifications.properties[`item_${index}`].properties.value,
      { $ref: `#/$defs/item_${index}_text160` });
  }
  assert.equal(JSON.stringify(schema).includes('uniqueItems'), false,
    'Duplicate rejection is local, not an undocumented provider keyword');
});

test('W2 direct and pool wires compile identically through the actual core for 1/5, reordered and rebased sources', () => {
  const cases = [syntheticSnapshot('short', 1), syntheticSnapshot('ascii800', 5),
    syntheticSnapshot('unicode800', 5)];
  const full = syntheticSnapshot('unicode800', 5);
  cases.push({ items: [full.items[1], full.items[3]], candidates: [full.candidates[1], full.candidates[3]],
    input: { items: [1, 3].map((source, local) => ({ ...full.input.items[source], itemIndex: local })) } });
  cases.push({ items: [full.items[4]], candidates: [full.candidates[4]],
    input: { items: [{ ...full.input.items[4], itemIndex: 0 }] } });
  for (const snapshot of cases) {
    const { direct, pool } = wires(snapshot);
    const expected = compileQualificationCandidates(
      decodeQualificationEvidencePool(snapshot.input, pool), snapshot);
    assert.deepEqual(compileDirectCandidates(direct, snapshot), expected);
    const reversed = structuredClone(direct);
    reversed.qualifications = Object.fromEntries(Object.entries(reversed.qualifications).reverse());
    assert.deepEqual(compileDirectCandidates(reversed, snapshot), expected);
    for (const entry of expected) for (const anchor of entry.qualification.anchors) {
      assert.equal(entry.receipts[anchor.receiptIndex].excerpt.slice(anchor.start, anchor.end), anchor.text);
    }
  }
});

test('W2 actual Unicode source windows and later receipts retain four exact global anchors', () => {
  const snapshot = syntheticSnapshot('unicode800', 1);
  assert.equal(snapshot.candidates[0].length, 20);
  assert.equal(snapshot.candidates[0][1].text.includes('🚋'), true);
  const { direct, pool } = wires(snapshot);
  const originalIds = [0, 1, 4, 19];
  direct.qualifications.item_0.subject = { value: 'User', evidenceIndices: originalIds };
  pool.qualifications.item_0.pool = originalIds;
  pool.qualifications.item_0.subject = { value: 'User', evidenceSlots: [0, 1, 2, 3] };
  for (const field of ['value', 'attribution', 'commitment']) {
    pool.qualifications.item_0[field].evidenceSlots = [0];
  }
  const actual = compileDirectCandidates(direct, snapshot);
  const baseline = compileQualificationCandidates(decodeQualificationEvidencePool(snapshot.input, pool), snapshot);
  assert.deepEqual(actual, baseline);
  assert.deepEqual(actual[0].qualification.anchors.map(anchor => [anchor.receiptIndex, anchor.start, anchor.end]),
    originalIds.map(id => { const candidate = snapshot.candidates[0][id];
      return [candidate.receiptIndex, candidate.start, candidate.end]; }));
  assert.equal(actual[0].qualification.anchors[1].text.includes('🚋'), true);
  assert.equal(actual[0].qualification.anchors[3].receiptIndex, 3);
});

test('W2 malformed original IDs, items, values and data shapes are refused without repair', () => {
  const snapshot = syntheticSnapshot('unicode800', 5);
  const original = wires(snapshot).direct;
  const mutate = change => { const value = structuredClone(original); change(value); bad(value, snapshot); };
  for (const change of [
    value => { value.wireVersion = 'evidence-pool-v1'; },
    value => { delete value.qualifications.item_1; },
    value => { value.qualifications.item_9 = value.qualifications.item_0; },
    value => { value.qualifications.item_0.itemIndex = 1; },
    value => { value.qualifications = Object.values(value.qualifications); },
    value => { value.qualifications.item_0.value.evidenceIndices = [0, 0]; },
    value => { value.qualifications.item_0.value.evidenceIndices = [1000]; },
    value => { value.qualifications.item_0.value.evidenceIndices = [20]; },
    value => { value.qualifications.item_0.value.evidenceIndices = []; },
    value => { for (const field of FIELDS) value.qualifications.item_0[field].evidenceIndices = []; },
    value => { value.qualifications.item_0.value.evidenceIndices = [0, 1, 2, 3, 4]; },
    value => { value.qualifications.item_0.subject.evidenceIndices = [1, 2, 3, 4]; },
    value => { value.qualifications.item_0.value.value = 17; },
    value => { value.qualifications.item_0.attribution.value = 'authorized'; },
    value => { value.qualifications.item_0.scope.value = 'x'.repeat(121); },
    value => { value.qualifications.item_0.extra = true; },
    value => { delete value.qualifications.item_0.value; },
  ]) mutate(change);
  // Five distinct anchors across individually legal fields still exceed core's budget.
  mutate(value => { const entry = value.qualifications.item_0;
    [entry.subject, entry.property, entry.scope, entry.applies, entry.value]
      .forEach((field, index) => { field.value = 'Known'; field.evidenceIndices = [index]; }); });
  let getterCalls = 0;
  const accessor = structuredClone(original);
  Object.defineProperty(accessor.qualifications.item_0, 'value', { enumerable: true,
    get() { getterCalls++; return original.qualifications.item_0.value; } });
  bad(accessor, snapshot); assert.equal(getterCalls, 0);
  const sparse = structuredClone(original);
  sparse.qualifications.item_0.value.evidenceIndices = Array(1);
  bad(sparse, snapshot);
  assert.throws(() => decodeDirectCandidates(snapshot.input, new Date()), /invalid_direct_candidate_output/u);
});

test('W3/W4 deterministic synthetic report separates prompt/schema, actual baseline and modeled alternate', async () => {
  const inherited = globalThis.fetch;
  globalThis.fetch = () => { throw new Error('global_fetch_forbidden'); };
  try {
    const first = await buildDirectCandidateReport();
    const second = await buildDirectCandidateReport();
    assert.deepEqual(first, second);
    // Current mechanics include the revised shared guide. The historical
    // pre-clarification report digest was 1a122f3b5b37c8f7c5a6a072543db38288ba2ef5c574e836ec47c1a5b7da2772.
    assert.equal(createHash('sha256').update(JSON.stringify(first)).digest('hex'),
      '0d51d4febb34a547ff07049ec09b547d73efc78af2f94fa0e7e0272ef08a0230');
    assert.equal(first.fixtures.length, 8);
    for (const row of first.fixtures) {
      assert.deepEqual(row.candidateCounts,
        Array(row.itemCount).fill(row.kind === 'short' ? 1 : row.kind === 'ascii200' ? 4
          : row.kind === 'ascii800' ? 16 : 20));
      assert.equal(row.direct.modeledOnly, true);
      const source = syntheticSnapshot(row.kind, row.itemCount);
      for (let index = 0; index < row.itemCount; index++) for (let receipt = 0;
        receipt < source.items[index].receipts.length; receipt++) {
        assert.equal(source.candidates[index].filter(candidate => candidate.receiptIndex === receipt)
          .map(candidate => candidate.text).join(''), source.items[index].receipts[receipt].excerpt);
        if (row.kind !== 'short') assert.equal(source.items[index].receipts[receipt].excerpt.length,
          row.kind === 'ascii200' ? 200 : 800);
      }
      assert.equal(row.baseline.actualFakeHttpCalls, (row.baseline.qualifierPairs ?? 0) * 2);
      assert.equal(row.baseline.actualWholeRefusalCalls, 0);
      assert.equal(row.baseline.wholeInline.evidence,
        row.baseline.mode === 'whole-inline' ? 'actual-fake-http' : 'modeled-only');
      assert.equal(row.baseline.wholeCatalog.evidence,
        row.baseline.mode === 'whole-catalog' ? 'actual-fake-http' : 'modeled-only');
      assert.equal(row.schemaOnly.promptSha256, row.baseline.wholeInline.promptSha256);
      assert.notEqual(row.schemaOnly.schemaSha256, row.baseline.wholeInline.schemaSha256);
      assert.equal(row.schemaOnly.schemaSha256,
        measureCandidateRequest(syntheticSnapshot(row.kind, row.itemCount).input, 'direct').schemaSha256);
      assert.equal(row.baseline.outputTokens.compactWithinLimit, true);
      assert.equal(row.direct.outputTokens.compactWithinLimit, true);
      if (row.itemCount === 5) {
        assert.equal(row.baseline.outputTokens.maximalLabelsWithinLimit, false);
        assert.equal(row.direct.outputTokens.maximalLabelsWithinLimit, false);
        const snapshot = syntheticSnapshot(row.kind, row.itemCount);
        const direct = syntheticOutputWire(snapshot.input, 'direct', true);
        const pool = syntheticOutputWire(snapshot.input, 'baseline', true);
        assert.deepEqual(compileDirectCandidates(direct, snapshot),
          compileQualificationCandidates(decodeQualificationEvidencePool(snapshot.input, pool), snapshot));
      }
    }
    const intermediate = first.fixtures.find(row => row.kind === 'ascii200' && row.itemCount === 5);
    assert.equal(intermediate.baseline.mode, 'whole-inline');
    assert.equal(intermediate.direct.mode, 'singleton-preflight');
    assert.equal(intermediate.baseline.qualifierPairs, 1);
    assert.equal(intermediate.direct.qualifierPairs, 5);
    assert.ok(first.fixtures.some(row => row.baseline.mode === 'singleton-preflight'));
  } finally { globalThis.fetch = inherited; }
});

test('W3 fitting repeated-text catalog baseline matches actual adapter fake-HTTP bytes', async () => {
  const snapshot = createQualificationCandidateSnapshot(Array.from({ length: 5 }, (_, itemIndex) => ({
    content: `Synthetic claim ${itemIndex}`, kind: 'fact', confidence: 0.8,
    receipts: Array.from({ length: 4 }, (_, receiptIndex) => ({ client: 'synthetic',
      sessionId: `session-${itemIndex}`, eventId: `event-${itemIndex}-${receiptIndex}`,
      role: 'user', excerpt: 'R'.repeat(800) })),
  })));
  const inline = measureCandidateRequest(snapshot.input, 'baseline');
  const catalog = createQualificationTextCatalog(snapshot.input).catalog;
  const measured = measureCandidateRequest(catalog, 'baseline');
  assert.ok(inline.countBodyTokens > 6000);
  assert.ok(measured.countBodyTokens <= 6000 && measured.logicalTokens <= 6000);
  assert.equal(await verifyActualBaseline(catalog, measured), 2);
});
