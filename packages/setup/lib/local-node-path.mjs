import { realpathSync } from 'node:fs';

// Prefer Homebrew's stable opt link only when it resolves to this exact Node.
// Missing, stale or unrelated links retain the original executable path.
export function localNodeExecutable(execPath = process.execPath, realpath = realpathSync) {
  const match = /^(\/opt\/homebrew|\/usr\/local)\/Cellar\/([^/]+)\/[^/]+\/bin\/node$/u.exec(execPath);
  if (!match) return execPath;
  const stable = `${match[1]}/opt/${match[2]}/bin/node`;
  try { return realpath(stable) === realpath(execPath) ? stable : execPath; }
  catch { return execPath; }
}
