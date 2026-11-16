import test from 'node:test';
import assert from 'node:assert/strict';
import { layouts, label, paired, correction, rows, noEcho, ok } from './fixtures/survivor-correction.mjs';
import { checkpoint, bytes } from './fixtures/forget-episode-assertions.mjs';

for (const options of layouts) for (const state of ['forgotten', 'absent'])
  test('correction preserves missing-memory refusal for ' + state + ' ' + label(options), { concurrency: false }, async t => {
    const f = await paired(t, options, null);
    if (state === 'forgotten') ok(await f.core.forget({ namespace: f.namespace,
      memoryId: f.survivor.id, expectedRevision: f.survivor.revision }));
    checkpoint(f); const before = rows(f), oldBytes = bytes(f);
    // An absent public target is memory_not_found on main; missing inside the safety decision is tested separately.
    const result = await f.core.correct(correction(f, undefined, state === 'absent' ? { memoryId: 'synthetic-absent' } : {}));
    noEcho(result, f.needles);
    assert.deepEqual(result, { ok: false, error: { code: 'memory_not_found', retryable: false } });
    assert.deepEqual(rows(f), before);
    assert.deepEqual(bytes(f), oldBytes);
  });
