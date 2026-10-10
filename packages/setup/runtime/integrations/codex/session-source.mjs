import { openSource, readBytes } from './source.mjs';
import { MAX_LINE, verifyHeader } from './parser.mjs';

// Hook input has no reliable cli/exec discriminator. Read only the bounded
// session_meta header at its authorized path, and bind it to this session.
// Missing, partial, unsafe and unsupported sources fail closed.
export async function sessionSource(path, sessionId, options = {}) {
  let file;
  try {
    file = await openSource(path);
    const size = (await file.stat()).size;
    const parts = [];
    for (let start = 0; start < Math.min(size, MAX_LINE); start += 4096) {
      const bytes = await readBytes(file, start, Math.min(size, MAX_LINE, start + 4096));
      const newline = bytes.indexOf(10);
      parts.push(newline < 0 ? bytes : bytes.subarray(0, newline));
      if (newline < 0) continue;
      const header = Buffer.concat(parts);
      try { verifyHeader(header, sessionId, options); }
      catch (error) {
        if (error.message !== 'creator_unqualified' || await options.qualifyCreator?.(error.version) !== true) return null;
        verifyHeader(header, sessionId, { qualifiedCreatorVersion: error.version });
      }
      return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(header)).payload.source;
    }
  } catch { /* Refuse capture and injection without verified source evidence. */ }
  finally { await file?.close(); }
  return null;
}
