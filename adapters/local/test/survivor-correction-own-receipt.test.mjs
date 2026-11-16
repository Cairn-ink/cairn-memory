import test from 'node:test';
import assert from 'node:assert/strict';
import { layouts, label, paired, correctAndScan, noEcho, ok } from './fixtures/survivor-correction.mjs';
import { ownReceiptFact, oldDecision, traceCorrection } from './fixtures/survivor-correction-paths.mjs';

for (const options of layouts.filter(o => o.layout >= 48)) for (const operation of [null, 'forget', 'correct'])
  test('survivor accepts own receipt fact after ' + (operation ?? 'no sibling action') + ' ' + label(options),
    { concurrency: false }, async t => {
      const f = await paired(t, options, operation);
      ownReceiptFact(f, operation === null ? 'privacy_erase' : operation === 'forget' ? 'user_forget' : 'correction_supersession');
      const allowed = operation === null;
      assert.deepEqual(oldDecision(f), allowed ? { allowed: true } : {
        allowed: false, reason: operation === 'forget' ? 'user_forget' : 'correction_supersession' });
      // main's outcome: the own-receipt-only control is accepted. With a local
      // sibling span, only that Raw-ancestry denial needs the round-7 relaxation.
      const memory = await correctAndScan(t, f, undefined, false,
        input => traceCorrection(t, () => f.core.correct(input), allowed));
      const result = await f.core.get({ namespace: f.namespace, memoryId: memory.id });
      noEcho(result, f.needles); ok(result);
    });
