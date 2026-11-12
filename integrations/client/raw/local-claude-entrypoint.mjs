import { openSource, readBytes } from '../../codex/source.mjs';

// The host has already authorized this exact transcript. Inspect complete lines
// only, through the same no-symlink, owner-checked source open as capture.
export async function claudeHeadlessSource(path) {
  let file;
  try {
    file = await openSource(path);
    const end = Math.min((await file.stat()).size, 65536);
    const bytes = await readBytes(file, 0, end);
    let start = 0;
    for (let at = 0; at < bytes.length; at++) {
      if (bytes[at] !== 10) continue;
      const line = bytes.subarray(start, at); start = at + 1;
      let row;
      try { row = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(line)); }
      catch { continue; }
      if (row && !Array.isArray(row) && typeof row.entrypoint === 'string') return row.entrypoint.startsWith('sdk-');
    }
  } catch { /* Missing, partial or unreadable metadata does not exclude capture. */ }
  finally { await file?.close(); }
  return false;
}
