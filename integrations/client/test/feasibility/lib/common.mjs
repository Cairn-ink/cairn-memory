// Shared helpers for the disposable F0 feasibility harness. Never imported by
// `npm test`, CI or plugin runtime code.
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export const HARNESS_VERSION = 'f0-harness-1';

export const sha256 = value => createHash('sha256').update(value).digest('hex');

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function randomTag(length = 10) {
  const bytes = randomBytes(length);
  return Array.from(bytes, byte => ALPHABET[byte % ALPHABET.length]).join('');
}

export function readConfig(root) {
  return JSON.parse(readFileSync(join(root, 'config.json'), 'utf8'));
}

/** Append one small JSON line; O_APPEND keeps concurrent hook writes whole. */
export function appendRecord(root, name, record) {
  appendFileSync(join(root, 'logs', name), `${JSON.stringify({ at: new Date().toISOString(), ...record })}\n`,
    { mode: 0o600 });
}

/** Process placement, used to show whether a worker left the host's group/session. */
export function processPlacement(pid = process.pid) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    return { pid, ppid: Number(fields[1]), pgid: Number(fields[2]), sid: Number(fields[3]) };
  } catch { return { pid }; }
}

/** Sandbox evidence for the current process: seccomp mode, filters and no_new_privs. */
export function confinement() {
  const result = {};
  try {
    for (const line of readFileSync('/proc/self/status', 'utf8').split('\n')) {
      const [key, value] = line.split(':\t');
      if (['Seccomp', 'Seccomp_filters', 'NoNewPrivs'].includes(key)) result[key] = value?.trim();
    }
  } catch { /* not Linux */ }
  // Names only; values of proxy or sandbox variables are not recorded.
  result.envNames = Object.keys(process.env).filter(name => /proxy|sandbox|codex|claude/i.test(name)).sort();
  return result;
}

export function errorDetail(error) {
  return { message: String(error?.message ?? error).slice(0, 200), cause: error?.cause?.code ?? null,
    causeMessage: error?.cause?.message ? String(error.cause.message).slice(0, 200) : null };
}

export function commandName(pid) {
  try { return readFileSync(`/proc/${pid}/comm`, 'utf8').trim(); } catch { return null; }
}

/** Walk parents so hook records can name the host process that launched them. */
export function ancestry(limit = 6) {
  const chain = [];
  let pid = process.ppid;
  for (let i = 0; i < limit && pid > 1; i++) {
    chain.push({ ...processPlacement(pid), comm: commandName(pid) });
    pid = chain.at(-1).ppid;
    if (!pid) break;
  }
  return chain;
}

export async function readBoundedStdin(maxBytes = 64 * 1024, timeoutMs = 2_000) {
  const chunks = [];
  let size = 0;
  let overflow = false;
  await new Promise(resolve => {
    const timer = setTimeout(finish, timeoutMs);
    function finish() { clearTimeout(timer); process.stdin.pause(); resolve(); }
    process.stdin.on('data', chunk => {
      size += chunk.length;
      if (size > maxBytes) { overflow = true; finish(); return; }
      chunks.push(chunk);
    });
    process.stdin.once('end', finish);
    process.stdin.once('error', finish);
  });
  return { text: overflow ? '' : Buffer.concat(chunks).toString('utf8'), bytes: size, overflow };
}

/** Code-point-safe UTF-16 bound, as the proposed common profile requires. */
export function boundUtf16(text, maxUnits) {
  let length = 0;
  let out = '';
  for (const character of text) {
    if (length + character.length > maxUnits) return { text: out, truncated: true };
    out += character;
    length += character.length;
  }
  return { text: out, truncated: false };
}

export const hostClient = host => (host === 'codex' ? 'codex' : 'claude-code');

/** Versioned hash of client plus host session ID, as proposed for the new profile. */
export const wireSessionId = (host, sessionId) =>
  sha256(`cairn.f0.session.v1\0${hostClient(host)}\0${sessionId}`);
