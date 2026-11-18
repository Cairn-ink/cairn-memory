import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { openContextReader } from '../index.mjs';
import { meteredText } from '../context-read-assembly.mjs';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { assemblyFixture, controlledClock, ns, ok } from '../testing/context-read-assembly-fixture.mjs';
import { policy, refresh } from '../testing/context-read-core-fixture.mjs';

const baseline = JSON.parse(readFileSync(new URL('./fixtures/context-read/compact-64-legacy-bytes.json', import.meta.url)));
const digest = text => createHash('sha256').update(text).digest('hex');

for (const family of ['local', 'hosted']) test(`legacy lexical and hybrid read bytes around a compact read, ${family}`, async t => {
  controlledClock(t);
  const terms = Array.from({ length: baseline.corpusSize }, (_, i) => String(i).padStart(3, '0'));
  const embedder = createFakeEmbedder({ aliases: Object.fromEntries(terms.map(term => [term, 'marker'])) });
  const calls = [], counter = { id: 'legacy-unit', countTokens(text) { calls.push(text); return 1; } };
  const f = assemblyFixture(t, { embedder, selectedPolicy: policy({ family }), counter });
  const corpus = terms.map(term => {
    const body = `telescope ${term}`;
    return { id: f.admit(body).id, body };
  }).sort((a, b) => Buffer.compare(Buffer.from(a.id), Buffer.from(b.id)));
  assert.equal(ok(await f.call('refreshContextIndex', refresh())).status, 'complete');
  const reader = openContextReader({ path: f.path, contextRead: f.config }); t.after(() => reader.close());
  const query = { readSet: [ns], query: 'telescope', types: ['memory'], intent: 'current', raw: false, deadlineMs: 5000 };
  for (const row of baseline.rows.filter(row => row.family === family)) {
    for (const representation of [undefined, 'representation-v2', 'representation-v2-dated']) {
      const input = { ...query, semantic: row.semantic, ...(representation ? { representation } : {}) };
      calls.length = 0;
      const result = await f.trusted.call(reader, 'contextRead', input), value = ok(result);
      const snapshot = JSON.parse(Buffer.from(value.snapshot.split('.')[0], 'base64url'));
      const expected = corpus.slice(0, row.count);
      assert.deepEqual(snapshot.refs, expected.map(item => [0, 'memory', item.id, 1]));
      assert.deepEqual(value.diagnostics.items.map(item => item.ref.memoryId), expected.map(item => item.id));
      assert.equal(value.diagnostics.candidates.count, row.count);
      assert.equal(value.diagnostics.candidates.trace.preset, row.preset);
      assert.equal(value.diagnostics.candidates.trace.effective, row.semantic ? 'hybrid' : 'lexical');
      assert.deepEqual(value.diagnostics.candidates.coverage.depths, { lexical: row.depth, semantic: row.semantic ? row.depth : 0 });
      assert.deepEqual(value.diagnostics.candidates.coverage.omitted, row.omitted);
      assert.equal(value.diagnostics.budget.maxItems, 24);
      assert.equal(value.metered.items.length, row.count);

      // Fill only the fixture's synthetic identities, fence prefixes and the
      // generated ID-to-body permutation. Preserve every other wire byte.
      const bindings = new Map(expected.flatMap(({ id, body }, i) => [
        [id, `@ref:${i}@`], [body, `@body:${i}@`], [snapshot.fences[i].slice(0, 8), `@f:${i}@`],
      ]));
      const normalize = text => {
        if (bindings.has(text)) return bindings.get(text);
        for (const [actual, fixture] of bindings) text = text.replaceAll(JSON.stringify(actual), JSON.stringify(fixture));
        return text;
      };
      assert.equal(digest(normalize(meteredText(value.metered))), row.textSha256);
      assert.equal(digest(JSON.stringify(calls.map(normalize))), row.counterInputsSha256);
      const legacyBytes = JSON.stringify(result), legacyCalls = [...calls];
      const compact = ok(await f.trusted.call(reader, 'contextRead', { ...query, representation: 'memory-compact-v1' }));
      assert.equal(compact.metered.items.length, baseline.corpusSize);
      calls.length = 0;
      const repeated = await f.trusted.call(reader, 'contextRead', input);
      assert.equal(JSON.stringify(repeated), legacyBytes);
      assert.deepEqual(calls, legacyCalls);
    }
  }
});
