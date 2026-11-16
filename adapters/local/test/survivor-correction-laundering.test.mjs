import test from 'node:test';
import assert from 'node:assert/strict';
import { layouts, label, paired, correction, rows, noEcho, forgottenText,
  correctAndScan, readAndScan } from './fixtures/survivor-correction.mjs';
import { checkpoint, bytes } from './fixtures/forget-episode-assertions.mjs';

for (const options of layouts) for (const operation of ['forget', 'correct']) {
  test('survivor cannot adopt exact forgotten sibling wording ' + label(options) + ' ' + operation, { concurrency: false }, async t => {
    const f = await paired(t, options, operation);
    checkpoint(f); const before = rows(f), oldBytes = bytes(f);
    const result = await f.core.correct(correction(f, forgottenText));
    noEcho(result, f.needles);
    assert.deepEqual(result, { ok: false, error: { code: 'memory_suppressed', retryable: false } });
    assert.deepEqual(rows(f), before, 'fingerprint refusal writes no row');
    assert.deepEqual(bytes(f), oldBytes, 'fingerprint refusal leaves database and WAL unchanged');
  });
  test('survivor accepts caller text containing shared message ' + label(options) + ' ' + operation, { concurrency: false }, async t => {
    const f = await paired(t, options, operation);
    // main's behaviour: the same text typed again by the caller; nothing hidden is read out
    const content = 'Caller introduction: ' + f.receipt.excerpt + ' :caller conclusion.';
    const memory = await correctAndScan(t, f, content, true);
    await readAndScan(f, memory, [forgottenText, 'forgetneedle', f.survivor.content]);
  });
}
