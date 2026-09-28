// Cleanup from the launch ledger alone. Every candidate is an exact path
// derived from a harness session (a Claude ID the harness generated, or a
// Codex thread the orchestrator saw its own process report), and every path
// passes the same filesystem rules as source reads. Hook events play no part.
import { join, sep } from 'node:path';
import { claudeProjectDir, defaultFs, expectedSourcePaths, ownerLaunch, verifyPlainEntry } from './source-access.mjs';

/** Harness-owned host sessions, each resolved back to its launch. */
export function ownedSessions(ledger) {
  const sessions = [];
  const refused = [];
  const seen = new Set();
  for (const run of ledger?.runs ?? []) {
    if (!run.launch) continue;
    const id = run.host === 'claude' ? run.launch.sessionId : run.binding?.threadId;
    if (!id) continue;
    const owner = ownerLaunch(ledger, run.host, id);
    if (!owner.run) { refused.push({ session: id, reason: owner.reason }); continue; }
    if (seen.has(`${run.host}:${id}`)) continue;
    seen.add(`${run.host}:${id}`);
    sessions.push({ host: run.host, id, launch: owner.run.launch });
  }
  return { sessions, refused };
}

export async function planCleanup({ ledger, home, runRoot, fs = defaultFs, uid = process.getuid?.() }) {
  const { sessions, refused } = ownedSessions(ledger);
  const files = [];
  const directories = [];
  const consider = async (path, kind, session) => {
    const entry = await verifyPlainEntry(path, kind, { fs, uid });
    if (entry.ok) (kind === 'file' ? files : directories).push({ path, host: session.host, session: session.id });
    else if (entry.reason !== 'source_unavailable') refused.push({ path, reason: entry.reason });
  };
  const projectDirs = new Map();
  for (const session of sessions) {
    for (const path of expectedSourcePaths(session.host, home, session.launch, session.id)) {
      await consider(path, 'file', session);
    }
    if (session.host !== 'claude') continue;
    await consider(join(home, '.claude', 'todos', `${session.id}-agent-${session.id}.json`), 'file', session);
    for (const name of ['session-env', 'file-history']) await consider(join(home, '.claude', name, session.id), 'directory', session);
    // The per-project directory is a candidate only for working directories inside the run root.
    if (session.launch.cwd.startsWith(runRoot + sep)) projectDirs.set(claudeProjectDir(home, session.launch.cwd), session);
  }
  for (const [path, session] of projectDirs) await consider(path, 'directory', session);
  return { sessions: sessions.map(({ host, id }) => ({ host, id })), files, directories, refused };
}

/** Unlink planned files, then remove planned directories only if empty; never recursive. */
export async function applyCleanup(plan, { fs = defaultFs, uid = process.getuid?.() } = {}) {
  const deleted = [];
  const kept = [];
  for (const { path } of plan.files) {
    // Re-verify immediately before each removal.
    const entry = await verifyPlainEntry(path, 'file', { fs, uid });
    if (!entry.ok) { kept.push({ path, reason: entry.reason }); continue; }
    await fs.unlink(path);
    deleted.push(path);
  }
  for (const { path } of [...plan.directories].sort((a, b) => b.path.length - a.path.length)) {
    const entry = await verifyPlainEntry(path, 'directory', { fs, uid });
    if (!entry.ok) { kept.push({ path, reason: entry.reason }); continue; }
    if ((await fs.readdir(path)).length) { kept.push({ path, reason: 'directory_not_empty' }); continue; }
    await fs.rmdir(path);
    deleted.push(`${path}/`);
  }
  return { deleted, kept };
}
