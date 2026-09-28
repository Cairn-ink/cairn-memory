// Shared helpers for the feasibility self-tests; not a test file itself.
import { randomBytes } from 'node:crypto';

/** A syntactically valid UUIDv7 whose timestamp is `millis`, like a Codex thread ID. */
export function uuidV7(millis) {
  const time = millis.toString(16).padStart(12, '0');
  const rand = randomBytes(10).toString('hex');
  return `${time.slice(0, 8)}-${time.slice(8)}-7${rand.slice(0, 3)}-8${rand.slice(3, 6)}-${rand.slice(6, 18)}`;
}
