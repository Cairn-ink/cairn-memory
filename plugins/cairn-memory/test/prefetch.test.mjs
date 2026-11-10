import assert from 'node:assert/strict';
import test from 'node:test';
import { installedPrompt } from '../../../integrations/codex/test/fixtures/prefetch-harness.mjs';

for (const warm of [false, true]) test(`distributed plugin prompt pre-fetch fsync ceiling (${warm ? 'warm' : 'fresh'})`, async t => {
  const result = await installedPrompt(t, { host: 'claude', warm });
  t.diagnostic(JSON.stringify({ warm, ...result }));
  assert.equal(result.code, 0); assert.equal(result.signal, null);
  assert.equal(result.stderr, ''); assert.equal(result.stdout, '');
  assert.equal(result.recallHeaders, 1);
  assert.equal(result.snapshot?.syncCalls, 0, 'prefetch_fsync_ceiling');
});

test('distributed plugin first identity keeps its durable publications before recall', async t => {
  const result = await installedPrompt(t, { host: 'claude', warm: false, seedIdentity: false });
  t.diagnostic(JSON.stringify({ firstIdentity: true, ...result }));
  assert.equal(result.code, 0); assert.equal(result.signal, null);
  assert.equal(result.stderr, ''); assert.equal(result.stdout, '');
  assert.equal(result.recallHeaders, 1);
  assert.equal(result.snapshot?.syncCalls, 6, 'identity_durable_before_fetch');
});
