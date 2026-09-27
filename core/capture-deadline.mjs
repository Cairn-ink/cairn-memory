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
