import test from 'node:test';
import assert from 'node:assert/strict';
import { materializeUnit, deliveredIndex, resolveCitation, coveredSpans, covers } from '../citations.mjs';
import { fixture, citation } from './fixtures.mjs';

const resolve = (unit, quote, occurrence = 1) => resolveCitation(citation(unit.item, quote, { occurrence }), deliveredIndex([unit]));
test('normalization maps fullwidth, ligatures, combining characters and whitespace', () => {
  const { submission } = fixture(), unit = submission.delivered[0];
  const raw = '  Ａ\t\tcaused\nＢ.  ';
  unit.segments[0].text = raw;
  assert.equal(materializeUnit(unit).text, 'A caused B.');
  assert.equal(resolve(unit, 'Ａ caused Ｂ.').ok, false);
  const r = resolve(unit, 'A caused B.');
  assert.equal(r.start, 0);
  assert.equal(r.end, 11);
  assert(covers({ origin: 'turn-1', start: 2, end: raw.length - 2, text: raw.slice(2, -2) }, coveredSpans([r])));
  assert(covers({ origin: 'turn-1', start: 0, end: raw.length, text: raw }, coveredSpans([r])));
  unit.segments[0].text = 'ﬃ e\u0301';
  assert.equal(materializeUnit(unit).text, 'ffi é');
  assert(!covers({ origin: 'turn-1', start: 0, end: 1, text: 'ﬃ' }, coveredSpans([resolve(unit, 'f')])));
  assert(covers({ origin: 'turn-1', start: 0, end: 1, text: 'ﬃ' }, coveredSpans([resolve(unit, 'ffi')])));
});
test('receipt truncation is 800 UTF-16 code units; raw offsets are not reused', () => {
  const { submission } = fixture(), unit = submission.delivered[0];
  unit.segments[0].text = 'x'.repeat(799) + '😀' + 'tail';
  assert.equal(materializeUnit(unit).text.length, 800);
  assert.equal(resolve(unit, '😀').ok, false);
  assert.equal(resolve(unit, 'tail').ok, false);
  assert.equal(resolve(unit, 'x'.repeat(799)).ok, true);
  unit.segments[0].text = 'ﬃ'.repeat(267);
  assert.equal(materializeUnit(unit).text.length, 800);
  const r = resolve(unit, 'f', 800);
  assert(!covers({ origin: 'turn-1', start: 266, end: 267, text: 'ﬃ' }, coveredSpans([r])));
});
test('elision never bridges missing original text', () => {
  const { submission } = fixture(), unit = submission.delivered[0];
  unit.segments = [{ origin: 'turn-1', start: 0, text: 'A' }, { origin: 'turn-1', start: 10, text: 'B' }];
  const r = resolve(unit, 'AB');
  assert.equal(r.ok, true);
  assert(!covers({ origin: 'turn-1', start: 0, end: 11, text: 'A caused B.' }, coveredSpans([r])));
  assert(covers({ origin: 'turn-1', start: 10, end: 11, text: 'B' }, coveredSpans([r])));
});
test('legitimate delivered aliases resolve; missing and ambiguous aliases do not', () => {
  const { submission } = fixture(), unit = submission.delivered[0];
  const alias = { intent: 'history', item: 27, unit: 'body', source: null };
  unit.aliases.push(alias);
  const d = deliveredIndex([unit]);
  assert.equal(resolveCitation({ ...citation(), ...alias }, d).ok, true);
  assert.equal(resolveCitation(citation(99), d).error, 'not_delivered');
  assert.throws(() => deliveredIndex([unit, { ...unit }]), /Ambiguous/);
  assert.equal(resolveCitation(citation(0, 'secret undelivered text'), d).ok, false);
});
test('unambiguous occurrences resolve; overlapping interpretation is referred', () => {
  const { submission } = fixture(), unit = submission.delivered[0];
  unit.normalize = false;
  unit.segments[0].text = 'aaaa';
  assert.equal(resolve(unit, 'aa', 1).start, 0);
  assert.equal(resolve(unit, 'aa', 2).ambiguous, true);
  assert.equal(resolve(unit, 'aa', 3).ambiguous, true);
  assert.equal(resolve(unit, 'aa', 4).ok, false);
  unit.segments[0].text = 'aa xx aa';
  assert.equal(resolve(unit, 'aa', 2).start, 6);
});
test('normalization runs after selection and before truncation', () => {
  const { submission } = fixture(), unit = submission.delivered[0];
  unit.segments = [{ origin: 'turn-1', start: 8, text: '  Ａ   Ｂ  ' }];
  unit.truncate = 2;
  assert.equal(materializeUnit(unit).text, 'A ');
  assert.equal(resolve(unit, 'A B').ok, false);
  assert.equal(resolve(unit, 'A').start, 0);
});
test('mapping rejects source text substitution and maps clusters across segments', () => {
  const { submission } = fixture(), unit = submission.delivered[0];
  const r = resolve(unit, 'A caused B.');
  assert(!covers({ origin: 'turn-1', start: 0, end: 11, text: 'B caused A.' }, coveredSpans([r])));
  unit.segments = [{ origin: 'turn-1', start: 0, text: 'e' }, { origin: 'turn-1', start: 1, text: '\u0301' }];
  assert.equal(materializeUnit(unit).text, 'é');
  assert(covers({ origin: 'turn-1', start: 0, end: 2, text: 'e\u0301' }, coveredSpans([resolve(unit, 'é')])));
});
