// One layout slice of the native worker-ports matrix; the cases live in
// core/testing/content-safety-s2h-worker-ports-cases.mjs. Event-time layouts
// count toward the family gate (170 cases each); the safety layout does not.
// The cases module comes first so the shared test clock loads first, as before.
import { workerPortCases } from '../testing/content-safety-s2h-worker-ports-cases.mjs';
import test from 'node:test';
import { familyGate } from '../testing/receipt-event-time-gates.mjs';

for (const [name, fn] of workerPortCases([{version:33,family:'event-time'}], familyGate('native worker-ports event-time v33', 170))) test(name, fn);
