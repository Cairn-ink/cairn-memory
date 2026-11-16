import test from 'node:test';
import { layouts, label } from './fixtures/survivor-correction.mjs';
import { hostedPair, correctHostedAndScan } from './fixtures/survivor-correction-paths.mjs';

for (const options of layouts.filter(o => o.layout >= 48)) for (const operation of ['forget', 'correct'])
  for (const source of ['same', 'different'])
    test('hosted own-receipt survivor cites ' + source + ' message after sibling ' + operation + ' ' + label(options),
      { concurrency: false }, async t => {
        const f = await hostedPair(t, options, operation, true);
        // main's outcome: an own-receipt marker does not deny the receipt-less Memory preflight.
        await correctHostedAndScan(t, f, source);
      });
