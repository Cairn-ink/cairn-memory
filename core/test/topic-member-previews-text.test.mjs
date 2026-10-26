import assert from 'node:assert/strict';
import test from 'node:test';
import { GRAPHEME_CANARIES, CANARY_VERSION, previewCapability, previewCounters, transformPreview } from '../topic-member-previews-text.mjs';
import { proveGuard } from '../../tools/testing/prove-topic-member-previews-guard.mjs';
const capable = previewCapability();
const render = (source, maxChars = 72, capability = capable, counters = previewCounters()) =>
  transformPreview({ source_type: 'text', source_bytes: Buffer.byteLength(source), source: Buffer.byteLength(source) > 12000 ? null : Buffer.from(source) }, maxChars, capability, counters);
const available = (text, truncated = false) => ({ status: 'available', text, truncated });
const unavailable = reason => ({ status: 'unavailable', reason });

test('P1 exact versioned raw canaries and bundled SQLite lazy metadata guard', t => {
  assert.equal(CANARY_VERSION, 'topic-member-previews-grapheme-canaries-v1');
  assert.equal(GRAPHEME_CANARIES.length, 11); assert.ok(capable.segmenter);
  for (const [input, expected] of GRAPHEME_CANARIES) assert.deepEqual(Array.from(capable.segmenter.segment(input), p => p.segment), expected);
  t.diagnostic(JSON.stringify(proveGuard()));
});
test('P1 capability refuses every isolated canary mismatch, missing/extra segments and runtime faults', () => {
  const Native = Intl.Segmenter;
  const make = change => class {
    constructor(locale, options) { assert.equal(locale, 'und'); this.native = new Native(locale, options); }
    resolvedOptions() { return { granularity: 'grapheme' }; }
    segment(input) { return change(input, Array.from(this.native.segment(input))); }
  };
  for (const [target] of GRAPHEME_CANARIES) for (const defect of ['wrong', 'missing', 'extra', 'throw']) {
    const C = make((input, parts) => {
      if (input !== target) return parts;
      if (defect === 'throw') return { [Symbol.iterator]() { throw Error('private text'); } };
      if (defect === 'missing') return parts.slice(1);
      if (defect === 'extra') return [...parts, { segment: 'extra' }];
      return parts.map((p, i) => i ? p : { segment: 'wrong' });
    });
    const c = previewCapability(C); assert.equal(c.segmenter, null);
    assert.deepEqual(render('secret', 72, c), unavailable('segmenter_unavailable'));
  }
  for (const C of [null, class { constructor() { throw Error(); } }, class { resolvedOptions() { return { granularity: 'word' }; } }]) assert.equal(previewCapability(C).segmenter, null);
  const reduced = previewCapability(make((input, parts) => parts));
  assert.deepEqual(render('A👨‍👩‍👧‍👦B', 2, reduced), available('A👨‍👩‍👧‍👦', true));
});
test('P1 exact clusters at cuts, source N−1/N/N+1 at 1/72/80, independent byte caps', () => {
  for (const cluster of ['A', '中', '𠀀', 'か\u3099', 'e\u0301', '😀', '👍🏽', '✈️', '🇯🇵', '👨‍👩‍👧‍👦']) {
    assert.deepEqual(render('X' + cluster + 'Y', 2), available('X' + cluster, true));
    assert.deepEqual(render(cluster, 1), available(cluster));
  }
  assert.deepEqual(render('中文か\u3099Ae\u0301👨‍👩‍👧‍👦Z', 6), available('中文か\u3099Ae\u0301👨‍👩‍👧‍👦', true));
  for (const n of [1, 72, 80]) for (const length of [n - 1, n, n + 1]) {
    const source = '中'.repeat(length);
    assert.deepEqual(render(source, n), length ? available('中'.repeat(Math.min(n, length)), length > n) : unavailable('empty'));
  }
  const exact = 'a' + '\u0301'.repeat(510) + '\u093e'; // 1+1020+3=1024 bytes, one cluster
  assert.equal(Buffer.byteLength(exact), 1024);
  assert.deepEqual(render(exact), available(exact));
  assert.deepEqual(render(exact + 'Z'), available(exact, true));
  assert.deepEqual(render(exact + '\u0301'), unavailable('grapheme_too_large'));
  assert.deepEqual(render('A' + exact), available('A', true));
  assert.deepEqual(render('a' + '\u0301'.repeat(3999)), unavailable('grapheme_too_large'));
});
test('P1 whitespace first, literal markdown/no normalization, repeated whole-cluster trailing removal', () => {
  for (const source of ['  A   B  ', '\tA\r\nB\n', '\u00a0A\u3000B\ufeff', '\ufeff A\u2028\u2029B ']) assert.deepEqual(render(source), available('A B'));
  for (const source of ['', ' \t\r\n\u00a0\u3000\ufeff']) assert.deepEqual(render(source), unavailable('empty'));
  assert.deepEqual(render('\u200b'), available('\u200b'));
  assert.deepEqual(render('**ＦＵＬＬ** [link](url) e\u0301 token=secret'), available('**ＦＵＬＬ** [link](url) e\u0301 token=secret'));
  assert.deepEqual(render('A B', 2), available('A', true));
  assert.deepEqual(render('A \u0600 B', 3), available('A', true));
  assert.deepEqual(render('\u0600 B', 1), unavailable('trimmed_prefix_empty'));
  assert.deepEqual(render(' '.repeat(3000) + 'e\u0301Z', 1), available('e\u0301', true));
});
test('P1 rejection ordering, strict UTF-8/BOM/NUL, 12000 rejected decoded units accounted', () => {
  for (const source of ['界'.repeat(4000), '😀'.repeat(2000)]) assert.equal(render(source).status, 'available');
  for (const source of ['x'.repeat(12000), 'x'.repeat(12001), 'x'.repeat(4001)]) assert.deepEqual(render(source), unavailable('content_limit'));
  const counters = previewCounters(); assert.deepEqual(render('x'.repeat(12000), 72, capable, counters), unavailable('content_limit'));
  assert.equal(counters.decodedUnits, 12000); assert.equal(counters.normalizationUnits, 0); assert.equal(counters.segmentationUnits, 0);
  assert.equal(counters.temporaryPayloadPeak, 36000);
  for (const source of [Buffer.from([0xc0,0xaf]), Buffer.from([0xed,0xa0,0x80]), Buffer.from('A\0B')]) assert.deepEqual(transformPreview({ source_type: 'text', source_bytes: source.length, source }, 72, capable, previewCounters()), unavailable('invalid_text'));
  for (const source_type of ['null', 'blob', 'integer']) assert.deepEqual(transformPreview({ source_type, source_bytes: 20000, source: null }, 72, capable, previewCounters()), unavailable('invalid_text'));
  for (const row of [{ source_type: 'text', source_bytes: 12001, source: Buffer.from('x') }, { source_type: 'blob', source_bytes: 1, source: Buffer.from('x') }, { source_type: 'text', source_bytes: 1, source: null }]) assert.throws(() => transformPreview(row, 72, capable, previewCounters()), { code: 'unsupported_database' });
});
