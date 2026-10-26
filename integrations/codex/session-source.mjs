import { openSource, readBytes } from './source.mjs';
import { MAX_LINE, verifyHeader, interactiveSession } from './parser.mjs';

// Hook input has no reliable cli/exec discriminator. Read only the bounded
// session_meta header at its authorized path, and bind it to this session.
// Missing, partial, unsafe and unsupported sources fail closed.
export async function sessionSourceMetadata(path, sessionId, options = {}) {
  let file;
  try {
    if (options.signal?.aborted) return null;
    file = await (options.openSource ?? openSource)(path);
    const size = (await file.stat()).size;
    const parts = [];
    for (let start = 0; start < Math.min(size, MAX_LINE); start += 4096) {
      if (options.signal?.aborted) return null;
      const bytes = await readBytes(file, start, Math.min(size, MAX_LINE, start + 4096));
      const newline = bytes.indexOf(10);
      parts.push(newline < 0 ? bytes : bytes.subarray(0, newline));
      if (newline < 0) continue;
      const header = Buffer.concat(parts);
      let qualifiedCreatorVersion = options.qualifiedCreatorVersion ?? null;
      try { verifyHeader(header, sessionId, options); }
      catch (error) {
        if (error.message !== 'creator_unqualified' || await options.qualifyCreator?.(error.version) !== true) return null;
        verifyHeader(header, sessionId, { qualifiedCreatorVersion: error.version });
        qualifiedCreatorVersion = error.version;
      }
      const meta = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(header)).payload;
      if (options.signal?.aborted) return null;
      return { source: meta.source, interactive: interactiveSession(meta),
        formatAuthority: { format:verifyHeader(header,sessionId,{ qualifiedCreatorVersion:qualifiedCreatorVersion ?? undefined }),
          sessionId,creatorVersion:meta.cli_version,qualifiedCreatorVersion } };
    }
  } catch { /* Refuse capture and injection without verified source evidence. */ }
  finally { await file?.close(); }
  return null;
}

// Preserve the released hosted projection exactly. Metadata is an additive
// trusted-code helper; it does not qualify a host or grant permission to read.
export async function sessionSource(path, sessionId, options = {}) {
  const result = await sessionSourceMetadata(path,sessionId,options);
  return result && { source:result.source,interactive:result.interactive };
}
