import test from 'node:test';
import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { createLocalEmbedder, LOCAL_MODELS, cosine } from '../lib/embed-local.mjs';

test('opt-in pinned fp32 CPU e5-small and bge-m3 real-model smoke', { skip: process.env.HR1_MODEL_SMOKE !== '1', timeout: 1200000 }, async () => {
  for (const name of Object.keys(LOCAL_MODELS)) {
    const reported = new Map();
    const embedder = await createLocalEmbedder({ model: name, allowDownload: process.env.HR1_MODEL_SMOKE_DOWNLOAD !== '0', progress(event) {
      if (event.status !== 'progress') { if (event.status === 'done') console.log(`MODEL ${name} downloaded ${event.file}`); return; }
      const bucket = Math.floor((event.progress ?? 0) / 20);
      if (reported.get(event.file) === bucket) return;
      reported.set(event.file, bucket); console.log(`MODEL ${name} ${event.file} ${bucket * 20}%`);
    } });
    try {
      const texts = ['The synthetic amber launch happens on Tuesday.', '合成世界的藍色計畫改在週四上線。', 'The cedar service retains logs for thirty days.'];
      const started = performance.now();
      const docs = await embedder.embed(texts, { kind: 'document', bypassCache: true });
      const documentMs = performance.now() - started;
      const queryStarted = performance.now();
      const queries = await embedder.embed(['When is the amber launch?', '藍色計畫何時上線？'], { bypassCache: true });
      const queryMs = performance.now() - queryStarted;
      for (const vector of [...docs, ...queries]) {
        assert.equal(vector.length, LOCAL_MODELS[name].dimensions);
        assert.ok(Math.abs(cosine(vector, vector) - 1) < 1e-6);
        assert.ok(Math.abs(vector.reduce((s, v) => s + v * v, 0) - 1) < 1e-5);
      }
      const cacheText = 'Synthetic document embedding cache verification.';
      const [fresh] = await embedder.embed([cacheText], { kind: 'document' });
      const [cached] = await embedder.embed([cacheText], { kind: 'document' });
      assert.deepEqual(cached, fresh);
      if (name === 'e5-small') {
        const long = 'cedar '.repeat(600);
        await embedder.embed([long], { bypassCache: true });
        assert.ok(embedder.metadata.truncation.events.some(event => event.originalTokens > 512 && event.retainedTokens === 512));
      }
      console.log('HR1_MODEL_SMOKE ' + JSON.stringify({ ...embedder.metadata, documentCount: docs.length, documentMs,
        docsPerSecond: docs.length * 1000 / documentMs, queryMsPerRequest: queryMs / queries.length,
        peakRssBytes: process.resourceUsage().maxRSS * 1024 }));
    } finally { await embedder.close(); }
  }
});
