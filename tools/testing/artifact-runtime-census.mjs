import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';
import { readdir, lstat } from 'node:fs/promises';
import { constants, existsSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../../', import.meta.url));
const parent = existsSync('/run/user/' + process.getuid?.()) ? '/run/user/' + process.getuid() : '/tmp/cairn-' + process.getuid?.();
const runtime = join(parent, 'cairn-memory');
// Only known protocol filenames can be shown. Unknown uid-private names are
// compared for leaks, but never displayed verbatim.
const runtimeName = /^(?:identity-v1\.key(?:\.tmp-[a-f0-9]{24})?|test-key-[a-f0-9]{24}|[dp]-[a-f0-9]{32}\.(?:json|stamp|log|sock|lock|takeover\.lock)(?:\.(?:owner|reap)-[a-f0-9-]{36})*(?:\.tmp-[a-f0-9]{24})?)$/;
export const displayName = name => runtimeName.test(name) ? name : '<redacted>';
export async function runtimeSnapshot(directory = runtime) {
  try {
    const entries = [];
    for (const name of (await readdir(directory)).sort()) {
      let info; try { info = await lstat(join(directory, name), { bigint: true }); }
      catch (error) { if (error.code === 'ENOENT') continue; throw error; }
      entries.push({ name, inode: String(info.ino), dev: String(info.dev), mode: String(info.mode), uid: String(info.uid), gid: String(info.gid), links: String(info.nlink),
        size: String(info.size), mtime: String(info.mtimeNs), ctime: String(info.ctimeNs) });
    }
    return { entries };
  } catch (error) { return error.code === 'ENOENT' ? { entries: [], diagnostic: 'runtime_folder_missing' } : { diagnostic: 'runtime_snapshot_failed' }; }
}
export function runtimeDifference(before, after) {
  const a = new Map(before.entries.map(entry => [entry.name, entry])), b = new Map(after.entries.map(entry => [entry.name, entry]));
  return { added: [...b.keys()].filter(name => !a.has(name)), removed: [...a.keys()].filter(name => !b.has(name)),
    changed: [...a.keys()].filter(name => b.has(name) && JSON.stringify(a.get(name)) !== JSON.stringify(b.get(name))) };
}
async function supervised(file) {
  const environment = { ...process.env }; delete environment.NODE_TEST_CONTEXT;
  const child = spawn(process.execPath, [join(root, 'tools/testing/run.mjs'), file], { cwd: root, env: environment, stdio: ['ignore', 'pipe', 'pipe'] });
  // Child output can contain absolute paths. This diagnostic job emits only its
  // own bounded, redacted per-file result, while preserving the child's status.
  child.stdout.resume(); child.stderr.resume();
  return new Promise(resolve => {
    child.once('error', () => resolve({ code: 1, diagnostic: 'runtime_test_spawn_failed' }));
    child.once('close', (code, signal) => resolve({ code, ...(signal ? { diagnostic: 'runtime_test_signal' } : {}) }));
  });
}
export async function runCensus({ files, snapshot = runtimeSnapshot, run = supervised, intervalMs = 0, write = text => process.stdout.write(text) } = {}) {
  files ??= (await readdir(join(root, 'packaging/test'))).filter(name => name.endsWith('.test.mjs')).sort().map(name => join(root, 'packaging/test', name));
  let code = 0; const leaks = [];
  let started = false;
  for (const file of files) {
    if (started && intervalMs) await delay(intervalMs);
    started = true;
    const sample = async () => { try { return await snapshot(); } catch { return { diagnostic: 'runtime_snapshot_failed' }; } };
    const before = await sample();
    const result = await run(file); // Existing runner owns process-group cleanup.
    const after = await sample();
    const row = { file: basename(file), rc: result.code, observed_difference: true };
    const diagnostic = before.diagnostic ?? after.diagnostic ?? result.diagnostic;
    if (diagnostic) row.diagnostic = diagnostic;
    if (before.entries && after.entries) {
      const delta = runtimeDifference(before, after);
      for (const kind of ['added', 'changed', 'removed']) row[kind] = delta[kind].map(displayName);
      // The uid's identity key persists across tests under the scheduling lease.
      const sharedKey = delta.added.includes('identity-v1.key') && after.entries.some(entry =>
        entry.name === 'identity-v1.key' && entry.mode === String(constants.S_IFREG | 0o600) && entry.uid === String(process.getuid?.()));
      if (sharedKey) row.shared_identity_key_created = true;
      row.leak = delta.added.some(name => name !== 'identity-v1.key' || !sharedKey);
      if (row.leak) row.outcome = 'RED';
      if (row.leak) leaks.push(row.file);
    }
    if (result.code !== 0 && code === 0) code = result.code ?? 1;
    write(JSON.stringify(row) + '\n');
  }
  return { code: code || (leaks.length ? 1 : 0), leaks };
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.exitCode = (await runCensus({ ...(process.argv.length > 2 ? { files: process.argv.slice(2) } : {}) })).code; }
  catch { process.stdout.write('runtime_census_failed\n'); process.exitCode = 1; }
}
