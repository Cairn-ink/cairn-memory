import assert from 'node:assert/strict';
import { join } from 'node:path';
import test from 'node:test';
import { planCaptureMessageBatches } from '../capture-batch-planning.mjs';
import { openMemoryCore } from '../contract.mjs';
import { createCjkTokenCounter } from '../testing/cjk-token-counter.mjs';
import { createTestWorkspace } from '../../tools/testing/workspace.mjs';

test('TFI2 pure planner preserves public planner results, validation and closed-store ownership', t => {
  const workspace = createTestWorkspace(t, { prefix: 'token-fit-core-' });
  const model = { contextWindow: 8192, countTokens: createCjkTokenCounter(), extract: () => assert.fail('no model calls') };
  const modes = [{}, { captureQualification: 'source-bound-v1' }, { captureQualification: 'source-bound-v2' },
    { captureSourcePolicy: 'indexed-windows-v1', captureQualification: 'source-bound-v2' },
    { captureSourcePolicy: 'indexed-evidence-v1' },
    { captureQualification: 'source-bound-v2', captureEvidence: 'staged-v1', sessionEpisodes: { mode: 'episode-v1' } }];
  for (const [index, options] of modes.entries()) {
    const core = openMemoryCore({ path: join(workspace.path, `${index}.db`), model, ...options });
    workspace.defer(() => core.close());
    const episode = Boolean(options.sessionEpisodes);
    const input = { messages: [100, 3200, 4000, 200].map((length, i) => ({ id: `message-${i}`,
      role: i % 2 ? 'assistant' : 'user', content: '中'.repeat(length), ...(episode ? { occurredAt: null } : {}) })) };
    const settings = { model, captureQualification: options.captureQualification,
      captureSourcePolicy: options.captureSourcePolicy, episode };
    const before = structuredClone(input);
    assert.deepEqual(core.planCaptureBatches(input), { ok: true, value: planCaptureMessageBatches(input, settings) });
    assert.deepEqual(input, before);
    for (const invalid of [{ messages: [] }, { ...input, extra: true },
      { messages: [input.messages[0], input.messages[0]] },
      { messages: [{ ...input.messages[0], role: 'system' }] },
      { messages: [{ ...input.messages[0], extra: true }] }]) {
      let errorCode;
      assert.throws(() => planCaptureMessageBatches(invalid, settings), error => {
        errorCode = error.code; return errorCode === 'invalid_input';
      });
      assert.deepEqual(core.planCaptureBatches(invalid), { ok: false, error: { code: errorCode, retryable: false } });
    }
    core.close();
    assert.equal(core.planCaptureBatches(input).error.code, 'store_closed');
    assert.deepEqual(planCaptureMessageBatches(input, settings), planCaptureMessageBatches(input, settings));
  }
});
