import assert from 'node:assert/strict';
import test from 'node:test';
import { createRareQueryLabels, RARE_QUERY_WINDOW_VERSION } from '../rare-query-preview.mjs';

// Independent exhaustive oracle: original codepoint slices, full regex matching
// at every possible start, and document-frequency sets built per memory.
function oracle(query, documents) {
  const words = text => [...text.matchAll(/[\p{L}\p{N}]+/gu)].map(match => match[0].toLowerCase());
  const wanted = new Set(words(query));
  const df = new Map();
  for (const sources of documents) for (const word of new Set(sources.flatMap(words))) {
    if (wanted.has(word)) df.set(word, (df.get(word) ?? 0) + 1);
  }
  return documents.map(sources => {
    let best = [...sources[0]].slice(0, 120).join(''), bestScore = 0;
    for (const source of sources) {
      const points = [...source], width = Math.min(120, points.length);
      const matches = [...source.matchAll(/[\p{L}\p{N}]+/gu)].map(match => ({
        word: match[0].toLowerCase(), start: [...source.slice(0, match.index)].length,
        end: [...source.slice(0, match.index + match[0].length)].length,
      }));
      for (let start = 0; start <= points.length - width; start++) {
        const covered = new Set(matches.filter(match => wanted.has(match.word)
          && match.start >= start && match.end <= start + width).map(match => match.word));
        const score = [...covered].reduce((sum, word) => sum + documents.length + 1 - df.get(word), 0);
        if (score > bestScore) { bestScore = score; best = points.slice(start, start + width).join(''); }
      }
    }
    return best;
  });
}
function check(query, documents) {
  const actual = createRareQueryLabels(query)(documents);
  assert.deepEqual(actual, oracle(query, documents));
  for (const [index, label] of actual.entries()) {
    assert.ok([...label].length <= 120);
    assert.ok(label.isWellFormed());
    assert.ok(documents[index].some(source => source.includes(label)), 'one original contiguous source, never cross-receipt synthesis');
  }
  assert.deepEqual(createRareQueryLabels(query)(documents), actual);
  return actual;
}

test('G2 integer memory DF resists generic density, counts once, and keeps short A/B anchors', () => {
  assert.equal(RARE_QUERY_WINDOW_VERSION, 'rare-query-window-v1');
  const docs = Array.from({ length: 12 }, () => ['generic other', 'generic generic other']);
  docs.push(['A interpretation', 'generic other', `${'padding '.repeat(25)}A B`]);
  assert.ok(check('generic other A B', docs).at(-1).includes('A B'));
  const repeated = docs.map(sources => sources.map(source => source.replaceAll('generic', 'generic generic generic')));
  assert.ok(check('generic generic other A B', repeated).at(-1).includes('A B'));
});

test('G2 body/receipt/earliest ties, no overlap, empty query and short sources are deterministic', () => {
  assert.deepEqual(check('anchor', [['anchor body', 'anchor receipt'], ['none', 'first anchor', 'second anchor']]),
    ['anchor body', 'first anchor']);
  const long = `${'.'.repeat(140)}A${'.'.repeat(150)}B`;
  const label = check('A B', [[long]])[0];
  assert.ok(label.includes('A')); assert.equal(label.includes('B'), false, 'single 120-point window cannot cover separated evidence');
  assert.deepEqual(check('missing', [['body prefix', 'receipt']]), ['body prefix']);
  assert.deepEqual(check('!? 😀', [['body prefix', 'receipt']]), ['body prefix']);
  assert.deepEqual(check('A', [['A', 'A other']]), ['A']);
});

test('G2 Unicode literal semantics preserve offsets, no folding/segmentation or length bias', () => {
  for (const [query, word] of [['ÉCOLE', 'école'], ['𐐀', '𐐨'], ['İ', 'İ'], ['ΩΜΕΓΑ', 'ωμεγα'], ['我的記憶', '我的記憶']]) {
    assert.ok(check(query, [[`${'😀.'.repeat(90)}${word}${'🌿'.repeat(40)}`]])[0].includes(word));
  }
  for (const [query, word] of [['café', 'cafe\u0301'], ['記憶', '我的記憶系統'], ['straße', 'STRASSE'], ['A', 'AA']]) {
    const body = `${'.'.repeat(160)}${word}`;
    assert.equal(check(query, [[body]])[0], [...body].slice(0, 120).join(''));
  }
  const oversized = `${'.'.repeat(140)}${'x'.repeat(121)}`;
  assert.equal(check('x'.repeat(121), [[oversized]])[0], oversized.slice(0, 120));
});

test('G2 fixed-seed mixtures agree with exhaustive oracle', () => {
  let seed = 0x51ac;
  const next = n => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed % n; };
  const parts = ['A', 'B', 'common', 'école', '𐐨', '我的記憶', '😀', '.'];
  for (let fixture = 0; fixture < 30; fixture++) {
    const docs = Array.from({ length: 3 }, () => Array.from({ length: 3 }, () =>
      Array.from({ length: 55 }, () => parts[next(parts.length)]).join(' ')));
    check('A B common ÉCOLE 我的記憶 𐐀', docs);
  }
});

test('G2 pure helper refuses widened bounds', () => {
  for (const docs of [Array(1025).fill(['A']), [[]], [Array(6).fill('A')], [['x'.repeat(4001)]]]) {
    assert.throws(() => createRareQueryLabels('A')(docs), { code: 'invalid_input' });
  }
  assert.throws(() => createRareQueryLabels('x'.repeat(4001)), { code: 'invalid_input' });
});
