import test from 'node:test';
import assert from 'node:assert/strict';
import { layouts, label } from './fixtures/survivor-correction.mjs';
import { denials, faults, refuseWithDenial, refuseWithFault } from './fixtures/survivor-correction-denials.mjs';

for (const options of layouts.filter(o => o.layout >= 48)) {
  for (const denial of denials.filter(denial => denial.includes('canonical')))
    test('deny-only explanation repeats ' + denial + ' (expected red on main) ' + label(options),
      { concurrency: false }, async t => {
        const intercepted = await refuseWithDenial(t, options, denial);
        assert.equal(intercepted, 2, 'the old decision and deny-only explanation both deny');
      });
  for (const fault of faults)
    test('deny-only fault is reached for ' + fault + ' (expected red on main) ' + label(options),
      { concurrency: false }, async t => {
        const intercepted = await refuseWithFault(t, options, fault);
        assert.ok(intercepted > 0, 'the deny-only fault was reached');
      });
}
