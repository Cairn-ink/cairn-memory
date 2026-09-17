import assert from 'node:assert/strict';
import test from 'node:test';
import { partitionSourcePassages } from '../source-passages.mjs';
import { createQualificationCandidateSnapshot, compileQualificationCandidates } from '../qualification-candidates.mjs';

function exactCoverage(excerpt, expectedLengths) {
  const passages = partitionSourcePassages(excerpt);
  assert.deepEqual(passages.map(({ text }) => text.length), expectedLengths);
  assert.equal(passages.map(({ text }) => text).join(''), excerpt);
  let offset = 0;
  for (const { start, end, text } of passages) {
    assert.equal(start, offset);
    assert.equal(end, start + text.length);
    assert.equal(excerpt.slice(start, end), text);
    assert.equal(text.isWellFormed(), true);
    assert.ok(text.length > 0 && text.length <= 200);
    offset = end;
  }
  assert.equal(offset, excerpt.length);
  assert.deepEqual(partitionSourcePassages(excerpt), passages);
}

test('SP1 exact UTF-16 boundaries and astral cut points', () => {
  exactCoverage('x', [1]);
  exactCoverage('x'.repeat(199), [199]);
  exactCoverage('x'.repeat(200), [200]);
  exactCoverage('x'.repeat(201), [200, 1]);
  exactCoverage('x'.repeat(800), [200, 200, 200, 200]);
  exactCoverage('x'.repeat(199) + '🚋' + 'y'.repeat(599), [199, 200, 200, 200, 1]);
  exactCoverage('x'.repeat(198) + '🚋' + 'y', [200, 1]);
});

test('SP1 preserves exact repeated, whitespace, combining and full-width source text', () => {
  exactCoverage('  Ａ\t e\u0301  same same  ', [20]);
  exactCoverage('repeat '.repeat(25) + 'repeat '.repeat(25), [200, 150]);
  exactCoverage('e\u0301'.repeat(101), [200, 2]);
});

test('SP1 rejects malformed, oversized, sparse and non-string inputs', () => {
  for (const value of [undefined, null, '', 5, {}, ['x'], Array(1), 'x'.repeat(801),
    '\ud800', 'x\udc00', 'x'.repeat(799) + '\ud800']) {
    assert.throws(() => partitionSourcePassages(value), { code: 'invalid_input' });
  }
});

test('SP2 real snapshot keeps canonical model candidates and compiled exact anchors', () => {
  const receipt = (excerpt, eventId) => ({ client: 'synthetic', sessionId: 'session', eventId,
    role: 'user', excerpt });
  const item = (receipts) => ({ content: 'Synthetic claim', kind: 'fact', confidence: 0.8, receipts });
  const source = 'a'.repeat(200) + '🚋' + 'b'.repeat(198);
  const original = [item([receipt(source, 'first'), receipt('  Ａ\tＢ  ', 'second')]),
    item([receipt(source, 'third')])];
  const snapshot = createQualificationCandidateSnapshot(original);
  assert.deepEqual(snapshot.candidates.map(group => group.map(candidate =>
    [candidate.candidateIndex, candidate.receiptIndex, candidate.start, candidate.end, candidate.text])), [
    [[0, 0, 0, 200, 'a'.repeat(200)], [1, 0, 200, 400, '🚋' + 'b'.repeat(198)],
      [2, 1, 0, 3, 'A B']],
    [[3, 0, 0, 200, 'a'.repeat(200)], [4, 0, 200, 400, '🚋' + 'b'.repeat(198)]],
  ]);
  assert.deepEqual(snapshot.input.items[0].candidates, [
    { candidateIndex: 0, role: 'user', text: 'a'.repeat(200) },
    { candidateIndex: 1, role: 'user', text: '🚋' + 'b'.repeat(198) },
    { candidateIndex: 2, role: 'user', text: 'A B' },
  ]);
  assert.ok(Object.isFrozen(snapshot));
  const field = (value, evidenceIndices) => ({ value, evidenceIndices });
  const qualification = (itemIndex, selected) => ({ itemIndex,
    subject: field(null, []), property: field(null, []), scope: field(null, []), applies: field(null, []),
    value: field('Known', [selected]), attribution: field('unknown', []), commitment: field('unknown', []) });
  const compiled = compileQualificationCandidates({ qualifications: [qualification(0, 1), qualification(1, 4)] }, snapshot);
  assert.deepEqual(compiled.map(result => result.qualification.anchors[0]), [
    { receiptIndex: 0, start: 200, end: 400, text: '🚋' + 'b'.repeat(198), fields: ['value'] },
    { receiptIndex: 0, start: 200, end: 400, text: '🚋' + 'b'.repeat(198), fields: ['value'] },
  ]);
  assert.equal(original[0].receipts[1].excerpt, '  Ａ\tＢ  ', 'caller input remains untouched');
});
