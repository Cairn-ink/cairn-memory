import assert from 'node:assert/strict';
import test from 'node:test';
import { createQueryExcerpt, QUERY_EXCERPT_VERSION } from '../query-excerpt.mjs';

const points = (text) => [...text];
const prefix = (text) => points(text).slice(0, 120).join('');

// Deliberately brute-force every window, independently of the runtime's sliding
// window. Offsets originate in the original string, never its case-folded form.
function oracle(query, content) {
  const body = points(content);
  if (body.length <= 120) return content;
  const terms = new Set([...query.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => m[0].toLowerCase()));
  const matches = [...content.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({
    term: m[0].toLowerCase(), start: points(content.slice(0, m.index)).length,
    end: points(content.slice(0, m.index + m[0].length)).length,
  }));
  let bestStart = 0;
  let bestScore = 0;
  for (let start = 0; start <= body.length - 120; start++) {
    const covered = new Set(matches.filter((m) => m.start >= start && m.end <= start + 120 && terms.has(m.term))
      .map((m) => m.term));
    if (covered.size > bestScore) { bestScore = covered.size; bestStart = start; }
  }
  return body.slice(bestStart, bestStart + 120).join('');
}

function check(query, content) {
  const excerpt = createQueryExcerpt(query)(content);
  assert.equal(excerpt, oracle(query, content));
  assert.ok(points(excerpt).length <= 120);
  assert.ok(content.includes(excerpt), 'excerpt must be a contiguous original substring');
  assert.equal(createQueryExcerpt(query)(content), excerpt, 'stable tie-breaking');
  return excerpt;
}

test('query excerpt exposes a stable policy version and reusable pure factory', () => {
  assert.ok(typeof QUERY_EXCERPT_VERSION === 'string' && QUERY_EXCERPT_VERSION.length > 0 ||
    Number.isSafeInteger(QUERY_EXCERPT_VERSION));
  const excerpt = createQueryExcerpt('Lantern');
  assert.equal(typeof excerpt, 'function');
  const first = `${'noise '.repeat(40)}Lantern Friday`;
  const second = `${'different '.repeat(25)}Lantern Tuesday`;
  assert.equal(excerpt(first), oracle('Lantern', first));
  assert.equal(excerpt(second), oracle('Lantern', second));
  assert.equal(excerpt(first), oracle('Lantern', first));
});

test('short bodies are unchanged and absent overlap preserves the exact prefix', () => {
  for (const body of ['', 'Lantern Friday', 'x'.repeat(120), '😀'.repeat(120)]) {
    assert.equal(check('Lantern', body), body);
  }
  for (const query of ['', '!? 😀', 'missing', '42']) {
    const body = 'original unmatching text. '.repeat(12);
    assert.equal(check(query, body), prefix(body));
  }
});

test('hidden middle and tail evidence beat repeated common-word prefix noise', () => {
  for (const suffix of ['', ' later filler.'.repeat(20)]) {
    const content = `${'meeting '.repeat(25)}Lantern meeting Friday.${suffix}`;
    const excerpt = check('What day is the Lantern meeting?', content);
    // Earliest ties may end immediately after Lantern. Navigation identifies
    // the candidate; only subsequent authoritative fetch carries the fact.
    assert.ok(excerpt.includes('Lantern'));
  }
});

test('distinct query terms score once regardless of query or content repetition', () => {
  const body = `${'alpha '.repeat(28)}${'.'.repeat(140)}beta gamma`;
  const normal = check('alpha beta gamma', body);
  const repeated = check(`${'alpha '.repeat(40)}beta gamma`, body);
  assert.equal(normal, repeated);
  assert.ok(normal.includes('beta gamma'));
  assert.ok(!normal.includes('alpha'));
});

test('equal scores choose earliest possible window, not first matching character', () => {
  const body = `${'.'.repeat(140)}Lantern${'.'.repeat(150)}Lantern${'.'.repeat(130)}`;
  const excerpt = check('Lantern', body);
  assert.equal(excerpt, `${'.'.repeat(113)}Lantern`);
  assert.equal(check('Lantern', `Lantern${'.'.repeat(250)}Lantern`), `Lantern${'.'.repeat(113)}`);
});

test('tokens crossing either window boundary do not earn partial-token credit', () => {
  const body = `alpha${'.'.repeat(111)}bravo${'.'.repeat(125)}alpha bravo`;
  const excerpt = check('alpha bravo', body);
  assert.ok(excerpt.endsWith('alpha bravo'));
  const oversized = 'z'.repeat(121);
  const onlyOversized = `${'.'.repeat(130)}${oversized}`;
  assert.equal(check(oversized, onlyOversized), prefix(onlyOversized));
});

test('whole maximal letter-number tokens match, substrings and stemming do not', () => {
  const hidden = `${'padding '.repeat(25)}lantern123 running`;
  assert.equal(check('lantern run 123', hidden), prefix(hidden));
  assert.ok(check('LANTERN123', hidden).includes('lantern123'));
  assert.ok(check('RUNNING', hidden).includes('running'));
  assert.ok(check('2026', `${'padding '.repeat(25)}2026`).includes('2026'));
});

test('case folding matches Unicode letters without changing original output offsets', () => {
  for (const [query, word] of [['ÉCOLE', 'école'], ['𐐀', '𐐨'], ['İ', 'İ'], ['ΩΜΕΓΑ', 'ωμεγα']]) {
    const body = `${'😀.'.repeat(90)}${word}${'🌿'.repeat(40)}`;
    assert.ok(check(query, body).includes(word));
  }
});

test('no normalization, accent folding or language-specific substring segmentation is implied', () => {
  for (const [query, word] of [['Lantern', 'Ｌａｎｔｅｒｎ'], ['café', 'cafe'], ['café', 'cafe\u0301'],
    ['記憶', '我的記憶系統'], ['straße', 'STRASSE']]) {
    const body = `${'.'.repeat(160)}${word}`;
    assert.equal(check(query, body), prefix(body));
  }
  const body = `${'.'.repeat(160)}我的記憶系統`;
  assert.ok(check('我的記憶系統', body).includes('我的記憶系統'));
});

test('emoji and astral code points remain intact at both excerpt boundaries', () => {
  const body = `${'😀'.repeat(130)}Lantern ${'𐐨'.repeat(45)} ${'🌿'.repeat(130)}`;
  const excerpt = check('Lantern', body);
  assert.equal(points(excerpt).length, 120);
  assert.equal(excerpt.isWellFormed(), true);
  assert.ok(excerpt.includes('Lantern'));
});

test('maximum admitted UTF-16 bounds work without widening the navigation window', () => {
  const query = `${'x '.repeat(1996)}Lantern `;
  assert.equal(query.length, 4000);
  const body = `${'.'.repeat(3993)}Lantern`;
  assert.equal(body.length, 4000);
  assert.ok(check(query, body).endsWith('Lantern'));
  const astralBody = `${'😀'.repeat(1996)} Lantern`;
  assert.equal(astralBody.length, 4000);
  assert.ok(check(query, astralBody).endsWith('Lantern'));
});

test('fixed-seed bounded mixtures agree with independent exhaustive window scoring', () => {
  let seed = 0x91ab23;
  const next = (n) => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const pieces = ['alpha', 'Beta', '42', '𐐨', '😀', '我的記憶', 'école', '.', ' ', '---', 'omega'];
  const queries = ['alpha Beta', '42 école', '我的記憶 𐐀', 'alpha alpha omega', 'missing', '😀'];
  for (let fixture = 0; fixture < 60; fixture++) {
    let body = '';
    for (let item = 0; item < 65; item++) body += `${pieces[next(pieces.length)]}${item % 3 === 0 ? '' : ' '}`;
    check(queries[next(queries.length)], body);
  }
});
