import test from 'node:test';
import { compatibilityCase } from './fixtures/receipt-event-time-compatibility.mjs';

test('main a6ec0e0e: all values on event-time layouts 51/52/53', t => compatibilityCase(t, 'event'));
