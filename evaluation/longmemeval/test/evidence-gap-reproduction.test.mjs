import assert from 'node:assert/strict';
import test from 'node:test';
import { USER_MARKER, ASSISTANT_MARKER, writeEvidenceProbe, recallEvidenceProbe } from '../testing/evidence-gap-fixture.mjs';

test('G1 source reaches real adapter wire but assistant-only extraction loses the user receipt', async () => {
  const omitted = await writeEvidenceProbe(false);
  const included = await writeEvidenceProbe(true);
  assert.deepEqual(included.input, omitted.input, 'control changes only extractor output');
  assert.deepEqual(included.wireBytes, omitted.wireBytes, 'same actual extraction input bytes');
  for (const result of [omitted, included]) {
    assert.deepEqual(result.outcomes, ['completed']);
    assert.equal(result.assistantRetained, true);
    assert.equal(result.wire.length, 1);
    assert.ok(result.planned.flatMap(batch => batch.captureInput.messages).some(message => message.content.includes(USER_MARKER)));
    assert.ok(result.planned.flatMap(batch => batch.captureInput.messages).some(message => message.content.includes(ASSISTANT_MARKER)));
    assert.deepEqual(Object.keys(result.wire[0]).sort(), ['inputMode', 'messages']);
    assert.ok(result.wire[0].messages.some(message => message.role === 'user' && message.content.includes(USER_MARKER)));
    assert.ok(result.wire[0].messages.some(message => message.role === 'assistant' && message.content.includes(ASSISTANT_MARKER)));
    assert.equal(result.catalogs[0].semanticCoverage, 'unassessed');
  }
  assert.equal(omitted.userRetained, false);
  assert.equal(included.userRetained, true);
});

for (const mode of ['beyond', 'select-omit', 'rank-drop', 'include']) {
  test(`G2 stage-specific real recall distinguishes ${mode}`, async () => {
    const result = await recallEvidenceProbe(mode);
    const { target, trace } = result;
    const has = arrays => arrays.flat().includes(target);
    assert.equal(new Set(trace.stored).size, 217);
    assert.ok(trace.stored.includes(target));
    assert.deepEqual([...trace.enumerated].sort(), [...trace.stored].sort(), 'public enumeration matches stored set, not recall order');
    assert.equal(result.storedTargetMarker, true);
    assert.equal(trace.selectInput.length, 2, 'real recall has two bounded map/select rounds');
    assert.ok(trace.mapPackingTrials.length > 0, 'map envelope packing trials, not full physical scan, observed');
    assert.equal(has(trace.selectInput.map(row => row.ids)), mode !== 'beyond');
    assert.equal(trace.selectInput.some(row => row.targetMarker), mode !== 'beyond', 'marker visibility separate from identity');
    assert.equal(has(trace.selectOutput), ['rank-drop', 'include'].includes(mode));
    assert.equal(has(trace.rankInput.map(row => row.ids)), ['rank-drop', 'include'].includes(mode));
    assert.equal(trace.rankInput.some(row => row.targetMarker), ['rank-drop', 'include'].includes(mode));
    assert.equal(has(trace.rankOutput), mode === 'include');
    assert.equal(trace.final.includes(target), mode === 'include');
    assert.equal(result.contextHasTarget, mode === 'include');
    assert.deepEqual(result.omittedIndices, [], 'no answer-packer loss confounds stage diagnosis');
    if (mode === 'beyond') {
      assert.equal(has(trace.mapPackingTrials.map(row => row.ids)), false);
      assert.equal(result.coverage, 'budget_exhausted');
    }
  });
}

test('G4 owned fixtures clean up on coverage assertion success and failure', async () => {
  const coverageError = message => error => error.code === 'ERR_ASSERTION'
    && error.message.split('\n')[0] === message
    && error.actual === false && error.expected === true && error.operator === 'strictEqual';
  await assert.rejects(writeEvidenceProbe(false, true),
    coverageError('synthetic user source must survive cold admitted-source read'));
  await writeEvidenceProbe(true, true);
  await assert.rejects(recallEvidenceProbe('rank-drop', true),
    coverageError('synthetic stored source must survive recall and packing'));
  await recallEvidenceProbe('include', true);
});

const diagnostic = process.env.CAIRN_EVIDENCE_GAP_ASSERT;
if (diagnostic !== undefined) {
  test('G3 opt-in coverage diagnostic (intentional loss controls are red)', async () => {
    assert.ok(['write-omit', 'write-include', 'beyond', 'select-omit', 'rank-drop', 'include'].includes(diagnostic));
    if (diagnostic.startsWith('write-')) await writeEvidenceProbe(diagnostic === 'write-include', true);
    else await recallEvidenceProbe(diagnostic, true);
  });
}
