import { readFileSync } from 'node:fs';

// Linux getrusage().ru_maxrss can retain a launcher's pre-exec high-water mark.
// VmHWM belongs to the current executable's address space and avoids that false
// attribution. Unsupported measurement is explicit, never a zero-byte success.
export function parsePeakRss(status) {
  const value = /^VmHWM:\s+(\d+)\s+kB$/m.exec(status)?.[1];
  const bytes = Number(value) * 1024;
  if (!value || !Number.isSafeInteger(bytes) || bytes <= 0) throw new Error('evaluation_measurement_failed');
  return bytes;
}

export function measurePeakRss() {
  if (process.platform !== 'linux') throw new Error('evaluation_measurement_unsupported');
  return parsePeakRss(readFileSync('/proc/self/status', 'utf8'));
}
