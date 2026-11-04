import test from 'node:test';
import { compatibilityCase } from './fixtures/receipt-event-time-compatibility.mjs';

// Split by layout so both matrix files stay below about three minutes.
for (const mode of ['old','safety']) test(`main a6ec0e0e: all values on three ${mode} layouts`, t => compatibilityCase(t, mode));
