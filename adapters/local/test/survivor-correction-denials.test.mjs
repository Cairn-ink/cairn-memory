import test from 'node:test';
import { layouts, label } from './fixtures/survivor-correction.mjs';
import { denials, refuseWithDenial } from './fixtures/survivor-correction-denials.mjs';

// main's outcome: each denial refuses with no echo or stored change.
for (const options of layouts.filter(o => o.layout >= 48)) for (const denial of denials)
  test('survivor correction refuses ' + denial + ' ' + label(options), { concurrency: false }, async t => {
    await refuseWithDenial(t, options, denial);
  });
