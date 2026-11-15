// One layout slice of the native worker-ports matrix; the cases live in
// core/testing/content-safety-s2h-worker-ports-cases.mjs. Event-time layouts
// count toward the family gate (170 cases each); the safety layout does not.
// The cases module comes first so the shared test clock loads first, as before.
import { workerPortCases } from '../testing/content-safety-s2h-worker-ports-cases.mjs';
import assert from 'node:assert/strict';
import test from 'node:test';
import { familyGate } from '../testing/receipt-event-time-gates.mjs';

const cases = workerPortCases([{version:23,family:'event-time'}], familyGate('native worker-ports event-time v23', 170));
// Every slice registers its whole layout; an empty inventory must never pass.
assert.equal(cases.length, 170, 'worker-ports slice case count');
for (const [name, fn] of cases) test(name, fn);
