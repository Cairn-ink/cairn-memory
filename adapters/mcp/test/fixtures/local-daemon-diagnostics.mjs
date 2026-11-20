// Line-aware, bounded diagnostics. Drop an entire oversized or sensitive line,
// including a credential marker split across stderr chunks.
import { StringDecoder } from 'node:string_decoder';
const bounded = value => {
  const bytes = Buffer.from(value); let start = Math.max(0, bytes.length - 2048);
  while (start < bytes.length && (bytes[start] & 0xc0) === 0x80) start++;
  return bytes.subarray(start).toString();
};
export function daemonStderrTail() {
  const decoder = new StringDecoder('utf8');
  let pending = '', tail = '', oversized = false;
  function line() {
    if (!oversized && !/sk-|ghp_|Bearer|token=|crn_pat_/.test(pending)) {
      tail = bounded(tail + pending + '\n');
    }
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
    read() {
      if (!oversized && pending && !/sk-|ghp_|Bearer|token=|crn_pat_/.test(pending)) return bounded(tail + pending);
      return tail;
    },
  };
}
