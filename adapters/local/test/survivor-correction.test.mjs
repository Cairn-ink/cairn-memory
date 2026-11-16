import test from 'node:test';
import { layouts, label, paired, correctAndScan, readAndScan } from './fixtures/survivor-correction.mjs';

for (const options of layouts) for (const operation of ['forget', 'correct'])
  test('same-message survivor can be corrected after sibling ' + operation + ' ' + label(options), { concurrency: false }, async t => {
    const f = await paired(t, options, operation);
    // Main accepts on 29/33; on 48/53 the correction assertion fails with memory_suppressed.
    const memory = await correctAndScan(t, f);
    await readAndScan(f, memory);
    await f.reopen();
    await readAndScan(f, memory);
  });
