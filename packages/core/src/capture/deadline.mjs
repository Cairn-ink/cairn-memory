import { CoreError } from '../errors.mjs';

/**
 * Budget for one capture invocation. The host supplies the clock used for elapsed time.
 * @param {number} milliseconds
 * @param {{ monotonicMs(): number }} clock
 */
export function createCaptureDeadline(milliseconds, clock) {
  if (!Number.isSafeInteger(milliseconds) || milliseconds < 1 || milliseconds > 120_000) {
    throw new CoreError('invalid_input');
  }
  const end = clock.monotonicMs() + milliseconds;
  const expired = () => clock.monotonicMs() >= end;
  const check = () => {
    if (expired()) throw new CoreError('model_timeout');
  };
  const remainingMs = (ceiling = 30_000) => {
    const left = end - clock.monotonicMs();
    if (left <= 0) throw new CoreError('model_timeout');
    return Math.min(ceiling, Math.max(1, Math.ceil(left)));
  };
  return Object.freeze({ expired, check, remainingMs });
}
