import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { fail } from './validation.mjs';

// Arbitrary inputs can alias ANY live SQLite store or companion. Only this
// fixed child owns their data descriptors; the host may retain O_PATH pins.
export function isolatedFileRead(path, maximum, { expected, invalid = 'invalid_input' } = {}) {
  const reject = () => { if (invalid === 'invalid_review_configuration') throw Error(invalid); fail(invalid); };
  if (!Number.isSafeInteger(maximum) || maximum < 0 || maximum > 67108864) reject();
  const input = JSON.stringify({ path, maximum, expected }, (_, value) =>
    typeof value === 'bigint' ? value.toString() : value);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./isolated-file-read-child.mjs', import.meta.url))], {
    input, encoding: 'utf8', env: {}, timeout: 5000,
    maxBuffer: 4 * Math.ceil((maximum + 1) / 3) + 16384,
  });
  if (result.error || result.status !== 0 || result.signal) reject();
  let value;
  try { value = JSON.parse(result.stdout); } catch { reject(); }
  if (value.invalid) reject();
  if (value.error) {
    const error = Object.assign(new Error(value.error.message), value.error);
    throw error;
  }
  const bytes = Buffer.from(value.bytes, 'base64');
  if (bytes.length > maximum) reject();
  const stat = Object.fromEntries(Object.entries(value.stat).map(([key, entry]) => [key, BigInt(entry)]));
  return { bytes, stat };
}
