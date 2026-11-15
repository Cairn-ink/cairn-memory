import test from 'node:test';
import assert from 'node:assert/strict';
import { get_encoding } from 'tiktoken';
import { createOpenAIEmbedder, estimateEmbeddingUsd, EMBEDDING_USD_PER_MILLION } from '../embedding.mjs';
import { contextBudget, contextReadBudgetDiagnostic } from '../../../core/context-read-budget.mjs';
import { randomUUID } from 'node:crypto';

test('embedding estimate bounds byte-level tokens at list price and rounds fractional nanodollars up', () => {
  const encoding = get_encoding('cl100k_base');
  try {
    const texts = ['synthetic ASCII', '合成的中文文字', '🧪🛰️', 'synthetic\n'.repeat(30), '<|endoftext|>'];
    const tokens = texts.reduce((n, text) => n + encoding.encode(text, [], []).length, 0);
    for (const [model, rate] of Object.entries(EMBEDDING_USD_PER_MILLION)) {
      assert.ok(estimateEmbeddingUsd(texts, { model }) >= tokens * rate / 1_000_000);
    }
    const bound = Buffer.byteLength('synthetic') + 16;
    const usdPerMillionTokens = .000001;
    const actual = bound * usdPerMillionTokens / 1_000_000;
    const estimated = estimateEmbeddingUsd(['synthetic'], { usdPerMillionTokens });
    assert.equal(estimated, 1e-9); assert.ok(estimated >= actual);
    assert.ok(estimated - actual < 1e-9);
  } finally { encoding.free(); }
});

test('valid reported usage above the input estimate records actual spend and keeps the paid result', async () => {
  const embedder = createOpenAIEmbedder({ apiKey: 'synthetic', dimensions: 1,
    endpoint: 'https://synthetic.invalid/' + randomUUID(),
    fetchImpl: async () => new Response(JSON.stringify({ object: 'list', model: 'text-embedding-3-small',
      data: [{ index: 0, embedding: [1] }], usage: { prompt_tokens: 60000000, total_tokens: 60000000 } })) });
  const dispatch = contextBudget({ budgetConfigured: true, embedder,
    policy: { family: 'hosted', maxUsd: 1, maxRequests: 10, estimateUsd: estimateEmbeddingUsd } });
  const run = () => dispatch(embedder, ['synthetic'], { budgetClass: 'query', guard() {},
    signal: new AbortController().signal, deadlineAt: performance.now() + 5000 });
  const result = await run(); assert.deepEqual(Array.from(result[0]), [1]);
  assert.equal(contextReadBudgetDiagnostic(embedder).query.usd, 1.2);
  await assert.rejects(run(), { code: 'budget_denied' });
});
