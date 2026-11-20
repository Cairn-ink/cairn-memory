import { StringDecoder } from 'node:string_decoder';
const bounded = text => {
  const bytes = Buffer.from(text); let start = Math.max(0, bytes.length - 2048);
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString('utf8');
};
// Buffer complete lines before redaction, so chunk and byte boundaries cannot
// split a credential marker or retain a suffix of an unredacted absolute path.
export function qualificationStderr() {
  const decoder = new StringDecoder('utf8');
  let pending = '', tail = '', oversized = false;
  const safe = line => line.replace(/(?:[A-Za-z]:[\\/]|\/)[\s\S]*/, '<path>');
  const accepted = () => !oversized && !/sk-|ghp_|Bearer|token=|crn_pat_/.test(pending);
  function line() {
    if (accepted()) tail = bounded(tail + safe(pending) + '\n');
    pending = ''; oversized = false;
  }
  return {
    write(bytes) {
      for (const character of decoder.write(bytes)) {
        if (character === '\n') line();
        else if (!oversized) {
          pending += character;
          if (Buffer.byteLength(pending) > 4096) { pending = ''; oversized = true; }
        }
      }
    },
    read() { return accepted() ? bounded(tail + safe(pending)) : tail; },
  };
}
