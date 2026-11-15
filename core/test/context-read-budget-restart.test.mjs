import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createFakeEmbedder } from '../context-read-embedder.mjs';
import { coreFixture, query, refresh, policy, ok } from '../testing/context-read-core-fixture.mjs';

function restart(path, mode, batchSize) {
  const result = spawnSync(process.execPath, [new URL('../testing/context-read-budget-restart.mjs', import.meta.url).pathname,
    path, mode, String(batchSize)], { encoding: 'utf8', timeout: 30000 });
  assert.equal(result.error, undefined);
  assert.equal(result.signal, null);
  assert.equal(result.status, 0, result.stderr + result.stdout);
  return JSON.parse(result.stdout.trim());
}

test('completed vectors persist across core and process restart with zero maintenance embeds', async t => {
  const base = createFakeEmbedder({ dimensions: 8 }); let texts = 0;
  const embedder = { ...base, id: 'synthetic-restart-budget', revision: '1', async embed(input, controls) {
    texts += input.length; return base.embed(input, controls);
  } };
  const f = coreFixture(t, { embedder, selectedPolicy: policy({ family: 'hosted' }) });
  for (let i = 0; i < 5; i++) f.admit('Synthetic persisted vector ' + i);
  ok(await f.call('refreshContextIndex', refresh())); assert.equal(texts, 5);
  f.reopen(); texts = 0;
  assert.equal(ok(await f.call('refreshContextIndex', refresh())).status, 'complete');
  assert.equal(texts, 0);
  f.context.close();
  assert.deepEqual(restart(f.path, 'finish', 16), { calls: 0, texts: 0 });
});

test('k process restarts embed at most P pending items plus one interrupted batch per restart', async t => {
  const pending = 70, k = 3, batchSize = 16;
  const f = coreFixture(t);
  for (let i = 0; i < pending; i++) f.admit('Synthetic interrupted batch vector ' + i);
  ok(await f.call('findCandidates', query({ semantic: false })));
  f.context.close();
  let total = 0;
  for (let i = 0; i < k; i++) {
    const attempt = restart(f.path, 'interrupt', batchSize);
    assert.equal(attempt.calls, 2); assert.equal(attempt.texts, batchSize * 2);
    total += attempt.texts;
  }
  const final = restart(f.path, 'finish', batchSize); total += final.texts;
  assert.equal(final.texts, pending - k * batchSize, 'completed batches were never re-embedded');
  assert.ok(total <= pending + k * batchSize, `${total} > ${pending} + ${k} * ${batchSize}`);
  assert.equal(total, 118, '70 pending texts plus exactly three discarded batches of 16');
  assert.deepEqual(restart(f.path, 'finish', batchSize), { calls: 0, texts: 0 });
});
