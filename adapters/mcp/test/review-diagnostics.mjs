import { constants } from 'node:os';

// Filter whole lines before taking the byte tail, so truncation cannot remove
// the sensitive prefix and leave the rest of that line in a failure report.
export function reviewExitError(completed, { code, signal, stderr }) {
  const exitCode = completed?.code ?? code;
  const childSignal = completed?.code < 0
    ? Object.entries(constants.signals).find(([, value]) => value === -completed.code)?.[0] ?? -completed.code
    : signal;
  const safe = [completed?.output ?? '', stderr].join('\n').split(/\r\n|[\r\n]/)
    .filter(line => !/sk-|ghp_|Bearer|token=|crn_pat_/i.test(line)).join('\n');
  const bytes = Buffer.from(safe);
  let start = Math.max(0, bytes.length - 2048);
  // Begin on a UTF-8 boundary without increasing the byte bound.
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return Error(`review exited before prompt: exit code ${exitCode}, signal ${childSignal ?? 'none'}; ` +
    `PTY supervisor exit code ${code}, signal ${signal ?? 'none'}; PTY tail:\n${bytes.subarray(start).toString()}`);
}
