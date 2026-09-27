import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { fixtures } from '../../../evaluation/ingestion-design/fixtures.mjs';
import { fields, combinedPrompt, prepareCombined, measureCombined, compileCombined } from '../../../evaluation/ingestion-design/combined.mjs';
import { scriptedCombined, scriptedFields } from '../../../evaluation/ingestion-design/oracle.mjs';
import { runBaseline, buildReport } from '../../../evaluation/ingestion-design/report.mjs';
const fixture = id => fixtures.find(f => f.id === id);
const clone = value => structuredClone(value);
const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const invalid = fn => assert.throws(fn, e => e.code === 'invalid_model_output');

test('combined has one coherent output contract and shared field semantics', () => {
  assert.ok(combinedPrompt.includes('Each item has exactly those five fields'));
  assert.ok(!combinedPrompt.includes('Each item has exactly content, kind, confidence, and sourceIndices'));
  assert.ok(combinedPrompt.includes('Subject is the person or thing described'));
  assert.ok(combinedPrompt.includes('Evaluate each\nfield independently'));
  assert.ok(combinedPrompt.includes('candidateIndex identifies one passage'));
});

test('frozen source catalog and request/schema do not depend on evaluator answers', () => {
  const f = fixture('proposal-adoption'), p = prepareCombined(f.input), before = measureCombined(p);
  const output = scriptedCombined(f, p);
  output.items[0].content = 'A different evaluator answer';
  output.items[0].qualification.commitment.value = 'rejected';
  compileCombined(p, output);
  assert.deepEqual(measureCombined(p), before);
  assert.throws(() => { f.input.messages[0].content = 'mutation'; }, TypeError);
  assert.throws(() => { p.candidates[0].text = 'mutation'; }, TypeError);
  assert.throws(() => { p.schema.properties.items.maxItems = 99; }, TypeError);
  assert.ok(!JSON.stringify(p.requestInput).includes('SQLite was adopted for the local prototype.'));
});

test('all fitting scripted combined results match real adapter/core qualification compilation', async () => {
  for (const f of fixtures.filter(f => !['unfit', 'five-multi-source-medium'].includes(f.id))) {
    const p = prepareCombined(f.input), result = compileCombined(p, scriptedCombined(f, p));
    const actual = await runBaseline(f, 'bounded-partition');
    assert.equal(actual.status, 'completed', f.id);
    assert.equal(digest(result), actual.compiledSha256, f.id);
    for (const metric of ['promptSha256', 'schemaSha256', 'logicalTokens', 'countBodyTokens', 'generationBodyTokens']) {
      assert.equal(actual.calls[0][metric], actual.extractionPreflight[metric], `${f.id}:${metric}`);
    }
  }
});

test('foreign and cross-source citations never yield a compiled result', () => {
  const f = fixture('proposal-adoption'), p = prepareCombined(f.input);
  for (const id of [-1, 9999, '0']) {
    const output = scriptedCombined(f, p); output.items[0].qualification.value.evidenceIndices = [id];
    invalid(() => compileCombined(p, output));
  }
  const output = scriptedCombined(f, p);
  output.items[0].sourceIndices = [0];
  invalid(() => compileCombined(p, output));
});

test('missing support, missing/extra/malformed fields and invalid extraction return no result', () => {
  const f = fixture('short-fact'), p = prepareCombined(f.input);
  const edits = [o => { o.items[0].qualification.value.evidenceIndices = []; },
    o => { delete o.items[0].qualification.scope; }, o => { o.items[0].qualification.extra = null; },
    o => { o.items[0].qualification.value.extra = 'quote'; }, o => { o.items[0].qualification = null; },
    o => { o.extra = []; }, o => { delete o.items; }, o => { o.items[0].kind = 'made-up'; },
    o => { o.items[0].sourceIndices = [0, 0]; }, o => { o.items[0].qualification.value.evidenceIndices = [0, 0]; },
    o => { o.items[0].qualification.commitment.value = 'certain'; }, o => { o.items[0].confidence = 9; }];
  for (const edit of edits) { const o = scriptedCombined(f, p); edit(o); invalid(() => compileCombined(p, o)); }
  const first = scriptedCombined(f, p).items[0], second = clone(first);
  second.qualification.value.evidenceIndices = [];
  invalid(() => compileCombined(p, { items: [first, second] })); // No partial returned array; no persistence exists.
  assert.deepEqual(compileCombined(p, { items: [] }), []); // Missing expected cards is not malformed output.
});

test('input and output ceilings refuse with no fallback or admitted result', async () => {
  const f = fixture('unfit'), p = prepareCombined(f.input);
  assert.throws(() => compileCombined(p, scriptedCombined(f, p)), e => e.code === 'context_budget_exceeded');
  for (const arm of ['legacy', 'whole-batch', 'bounded-partition']) {
    const result = await runBaseline(f, arm);
    assert.equal(result.httpCalls, 0); assert.equal(result.compiledItems, 0);
  }
  const long = fixture('five-short'), lp = prepareCombined(long.input);
  invalid(() => compileCombined(lp, scriptedCombined(long, lp, true)));
});

test('structural validation admits plausible wrong interpretation and all-unknown with anchor', () => {
  const f = fixture('uncertain-cause'), p = prepareCombined(f.input), wrong = scriptedCombined(f, p);
  wrong.items[0].content = 'DNS certainly caused the outage.';
  wrong.items[0].qualification.value.value = 'certain DNS cause';
  assert.equal(compileCombined(p, wrong).length, 1); // Citation cannot prove entailment.
  const unknown = scriptedCombined(f, p);
  for (const field of fields) unknown.items[0].qualification[field] = {
    value: ['attribution', 'commitment'].includes(field) ? 'unknown' : null,
    evidenceIndices: field === 'value' ? [0] : [] };
  assert.equal(compileCombined(p, unknown).length, 1);
  unknown.items[0].qualification.value.evidenceIndices = [];
  invalid(() => compileCombined(p, unknown));
});

test('canonical offsets survive reverse receipts, repeated roles, shared cards, whitespace and Unicode', () => {
  const input = clone(fixture('proposal-adoption').input);
  input.messages = [{ id: 'one', role: 'user', content: '界'.repeat(199) + '🚋' + 'Z'.repeat(600) + '   ' },
    { id: 'two', role: 'assistant', content: 'identical words   ' },
    { id: 'three', role: 'user', content: 'identical words   ' }];
  const p = prepareCombined(input), selected = p.candidates.filter(c => c.sourceIndex === 0).at(-1);
  assert.ok(p.candidates.every(c => c.text.isWellFormed()));
  const item = { content: 'Synthetic interpretation', kind: 'context', confidence: 0.5, sourceIndices: [2, 0],
    qualification: scriptedFields(fixture('short-fact'), selected.candidateIndex) };
  const result = compileCombined(p, { items: [item, clone(item)] });
  for (const card of result) for (const a of card.qualification.anchors) {
    assert.equal(card.receipts[a.receiptIndex].excerpt.slice(a.start, a.end), a.text);
    assert.equal(a.receiptIndex, 1);
  }
  item.sourceIndices = [1];
  item.qualification = scriptedFields(fixture('short-fact'), p.candidates.find(c => c.sourceIndex === 1).candidateIndex);
  assert.equal(compileCombined(p, { items: [item] }).length, 1);
  item.qualification.value.evidenceIndices = [p.candidates.find(c => c.sourceIndex === 2).candidateIndex];
  invalid(() => compileCombined(p, { items: [item] }));
});

test('report retains real partition/refusal work and both arms selected legal-long output failures', async () => {
  const r = await buildReport(), medium = r.fixtures.find(f => f.id === 'five-multi-source-medium');
  assert.equal(r.fixtureDenominator, 12);
  assert.equal(medium.arms[1].status, 'refused'); assert.equal(medium.arms[1].countGenerationPairs, 1);
  assert.equal(medium.arms[2].countGenerationPairs, 6);
  const five = r.fixtures.find(f => f.id === 'five-short');
  assert.ok(five.arms[2].calls.some(c => c.selectedLegalLongOutputTokens > 1024));
  assert.ok(five.arms[2].calls.some(c => c.selectedLegalLongDecodedOutputTokens > 1024));
  assert.ok(five.arms[3].selectedLegalLongOutputTokens > 1024);
  assert.equal(five.arms[3].actualHttpCalls, 0);
});
