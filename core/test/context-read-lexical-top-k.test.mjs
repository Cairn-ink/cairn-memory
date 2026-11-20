import assert from 'node:assert/strict';
import test from 'node:test';
import { scoreBM25 } from '../context-read-bm25.mjs';
import { termFrequencies, tokenizeT1 } from '../context-read-tokenize.mjs';
import { drain, fixture, ns, request } from '../testing/context-read-fixture.mjs';

const readSet = [ns, { ...ns, scope: 'personal', projectId: null }];

function seededRandom(seed) {
  return max => {
    seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
    return Math.floor(seed / 2 ** 32 * max);
  };
}

function fullRanking(documents, query) {
  const terms = [...new Set(tokenizeT1(query))];
  const df = new Map(terms.map(term => [term, documents.filter(doc => doc.frequencies.has(term)).length]));
  const statistics = { N: documents.length, totalLength: documents.reduce((n, doc) => n + doc.length, 0), df };
  const key = ({ ref }) => [ref.namespace.ownerId, ref.namespace.scope, ref.namespace.projectId ?? '', ref.type, ref.memoryId];
  return documents.map(doc => ({ ref: doc.ref, score: scoreBM25(terms, doc, statistics) }))
    .filter(row => row.score !== null)
    .sort((a, b) => {
      if (a.score !== b.score) return b.score - a.score;
      const right = key(b);
      for (const [i, value] of key(a).entries()) {
        const order = Buffer.compare(Buffer.from(value), Buffer.from(right[i]));
        if (order) return order;
      }
      return 0;
    });
}

test('embedded lexical ranking matches a full stable sort across the cutoff', async t => {
  for (const matchCount of [0, 9, 24, 64, 173]) {
    await t.test(`${matchCount} matching documents`, t => {
      const f = fixture(t), random = seededRandom(9173 + matchCount);
      const corpus = Array.from({ length: matchCount + 17 }, (_, i) => {
        const words = i >= matchCount ? ['background'] : i % 12 ? ['orchard', 'pear'] :
          ['orchard', ...Array(random(5)).fill('orchard'), ...Array(random(5)).fill('plum')];
        return { namespace: readSet[random(readSet.length)], text: [...words, `sample${i}`].join(' ') };
      });
      for (let i = corpus.length - 1; i > 0; i--) {
        const j = random(i + 1);
        [corpus[i], corpus[j]] = [corpus[j], corpus[i]];
      }
      const documents = corpus.map(({ namespace, text }) => {
        const memory = f.admit(text, namespace);
        return { ref: { type: 'memory', namespace, revision: memory.revision, memoryId: memory.id }, ...termFrequencies(text) };
      });
      const input = request({ readSet, accessGenerations: [1, 1] }), index = f.index({ batchSize: 11 });
      drain(index, input);

      const defaultRanking = fullRanking(documents, 'orchard');
      assert.equal(defaultRanking.length, matchCount);
      assert.deepEqual(index.lexicalPage(input, 'orchard'), { rows: defaultRanking.slice(0, 24), matched: matchCount });
      if (matchCount === 173) {
        assert.ok(defaultRanking.filter(row => row.score === defaultRanking[23].score).length > 64);
      }
      for (const query of ['orchard', 'plum orchard pear pear absentword', 'absentword', 'and the !!!']) {
        const ranking = fullRanking(documents, query);
        for (const limit of [1, 7, 24, 64]) {
          assert.deepEqual(index.lexicalPage(input, query, limit),
            { rows: ranking.slice(0, limit), matched: ranking.length }, `${query}, limit ${limit}`);
        }
      }
      assert.deepEqual(index.lexicalPage(input, '!!!'), { rows: [], matched: 0 });
      assert.throws(() => index.lexicalPage(input, ''), { code: 'invalid_input' });
    });
  }
});
