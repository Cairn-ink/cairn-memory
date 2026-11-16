import test from 'node:test';
import { layouts, label } from './fixtures/survivor-correction.mjs';
import { faults, refuseWithFault } from './fixtures/survivor-correction-denials.mjs';

// main's outcome: the old Raw span refuses even without the deny-only helper.
for (const options of layouts.filter(o => o.layout >= 48)) for (const fault of faults)
  test('survivor correction preserves suppression with ' + fault + ' injection armed ' + label(options),
    { concurrency: false }, async t => {
      await refuseWithFault(t, options, fault);
    });
