import { fail } from './validation.mjs';

const monotonicNow = process.hrtime.bigint;
const NANOS_PER_MS = 1_000_000n;

/** Private, monotonic budget belonging to exactly one capture invocation. */
export function createCaptureDeadline(milliseconds) {
  const end = monotonicNow() + BigInt(milliseconds) * NANOS_PER_MS;
  const expired = () => monotonicNow() >= end;
  const check = () => { if (expired()) fail('model_timeout'); };
  const remainingMs = (ceiling = 30_000) => {
    const left = end - monotonicNow();
    if (left <= 0n) fail('model_timeout');
    return Math.min(ceiling, Math.max(1, Math.ceil(Number(left) / Number(NANOS_PER_MS))));
  };
  return Object.freeze({ expired, check, remainingMs });
}

// A trusted local host includes opening work through an explicit private token.
// Caller data cannot forge it, and unrelated captures inherit no budget.
const invocationDeadlines = new WeakMap();
export function captureWithDeadline(core, request, deadline) {
  const invocation = {};
  invocationDeadlines.set(invocation, deadline);
  return core.captureRaw(request, invocation);
}
export const captureInvocationDeadline = (milliseconds, invocation) => invocationDeadlines.get(invocation) ??
  (milliseconds === undefined ? undefined : createCaptureDeadline(milliseconds));
