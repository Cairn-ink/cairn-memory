// One layout slice of the native worker-ports matrix; the cases live in
// core/testing/content-safety-s2h-worker-ports-cases.mjs. Event-time layouts
// count toward the family gate (170 cases each); the safety layout does not.
import { registerWorkerPortCases } from '../testing/content-safety-s2h-worker-ports-cases.mjs';
import { familyGate } from '../testing/receipt-event-time-gates.mjs';

registerWorkerPortCases([23,33].map(version=>({version,family:'event-time'})),familyGate('native worker-ports event-time v23 v33',340));
