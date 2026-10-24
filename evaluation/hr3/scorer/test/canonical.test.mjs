import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, claim, value, instant, interval, scope, UnknownEquivalence } from '../canonical.mjs';
import { claim as makeClaim, quantity, scoped, universal, text } from './fixtures.mjs';

test('NFKC, whitespace, Unicode composition and dictionary aliases', () => {
  assert.equal(normalizeText('  Ａ\t e\u0301\n '), 'A é');
  assert.deepEqual(value(text('ＴＷ')), value(text('臺灣')));
  assert.deepEqual(value(text('pro')), value(text('專業')));
  assert.notDeepEqual(value(text('monthly')), value(text('per month')));
});
test('exact rational units, arbitrary precision, negative and zero decimals', () => {
  assert.deepEqual(value(quantity('0.1', 'm')), value(quantity('10', '公分')));
  assert.deepEqual(value(quantity('60', 's')), value(quantity('1', '分鐘')));
  assert.deepEqual(value(quantity('25', '%')), value(quantity('.25', '1')));
  assert.deepEqual(value(quantity('-0.00', 'USD')), value(quantity('0', '美元')));
  assert.notDeepEqual(value(quantity('9007199254740993')), value(quantity('9007199254740992')));
  assert.notDeepEqual(value(quantity('1', 'USD')), value(quantity('1', 'TWD')));
});
test('range units and open/unbounded endpoints, no float rounding', () => {
  const range = { type: 'Range', lower: '0.1', upper: '0.2', lowerClosed: false, upperClosed: true, unit: 'm' };
  assert.deepEqual(value(range), value({ ...range, lower: '10', upper: '20', unit: 'cm' }));
  assert.notDeepEqual(value(range), value({ ...range, lowerClosed: true }));
  assert.deepEqual(value({ ...range, lower: null, lowerClosed: true }), value({ ...range, lower: null, lowerClosed: false }));
  assert.throws(() => value({ ...range, upper: '0.05' }), /Empty range/);
});
test('equivalent date offsets and bare Taipei dates, exact fractional seconds', () => {
  assert.deepEqual(instant('2026-10-25'), instant('2026-10-24T16:00:00Z'));
  assert.deepEqual(instant('2026-10-25T00:00:00+08:00'), instant('2026-10-24T16:00:00.000Z'));
  assert.deepEqual(instant('2026-10-25T00:00:00.123400+08:00'), instant('2026-10-24T16:00:00.1234Z'));
  assert.deepEqual(instant('1979-07-02'), instant('1979-07-01T15:00:00Z'));
  assert.throws(() => instant('1979-07-01'), /nonexistent Asia\/Taipei midnight/);
  assert.notDeepEqual(instant('2026-10-24T16:00:00.1234000001Z'), instant('2026-10-24T16:00:00.1234Z'));
  assert.throws(() => instant('2026-02-30'), /Invalid calendar/);
  assert.throws(() => instant('2026-10-25T25:00:00Z'), /Invalid time/);
  assert.throws(() => instant('October 25, 2026'), UnknownEquivalence);
  assert.throws(() => instant('2026-10-25T00:00:00'), UnknownEquivalence);
});
test('half-open intervals and null endpoints are preserved', () => {
  assert.deepEqual(interval({ from: '2026-10-25', to: null }), interval({ from: '2026-10-24T16:00:00Z', to: null }));
  assert.throws(() => interval({ from: '2026-10-25', to: '2026-10-25' }), /half-open/);
  assert.notDeepEqual(interval({ from: null, to: '2026-10-26' }), interval({ from: null, to: '2026-10-25' }));
});
test('extensional scope paraphrases expand to the same 12 cells', () => {
  const dnf = { any: ['free', 'pro'].map(plan => ({ all: [{ field: 'plan', values: [plan] }, { field: 'country', values: ['台灣'] }] })) };
  assert.deepEqual(scope(dnf), scope(scoped('Taiwan')));
  assert.equal(scope(universal()).length, 12);
  assert.equal(scope(scoped()).length, 4);
  assert.deepEqual(scope({ any: [{ all: [{ field: 'country', values: ['JP', 'TW', 'TW'] }] }] }), scope({ any: [scoped('TW').any[0], scoped('JP').any[0]] }));
  assert.throws(() => scope(scoped('Formosa')), UnknownEquivalence);
  assert.throws(() => scope({ any: [{ all: [{ field: 'country', values: ['TW'] }, { field: 'country', values: ['JP'] }] }] }), /Empty scope/);
});
test('unordered duplicate qualifiers collapse, contradictions stay distinct', () => {
  const c = makeClaim();
  c.qualifiers = [{ key: 'audience', value: text('TW') }, { key: 'audience', value: text('台灣') }];
  assert.equal(claim(c).qualifiers.length, 1);
  c.qualifiers.push({ key: 'audience', value: text('JP') });
  assert.equal(claim(c).qualifiers.length, 2);
});
