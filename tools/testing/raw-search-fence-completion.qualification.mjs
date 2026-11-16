import test from 'node:test';
import { checkCoverage } from '../../core/test/raw-search-unbounded-fence.test.mjs';

test('full Raw inventory completes at the real host slice and preserves recent saves (2500 messages)', t => checkCoverage(t, 2500));
