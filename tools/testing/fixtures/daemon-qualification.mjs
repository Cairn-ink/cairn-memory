import { spawn } from 'node:child_process';
import { readdir, lstat } from 'node:fs/promises';
import { join, resolve, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeDirectory } from '../../../adapters/mcp/local-daemon-state.mjs';
import { workspace, until, ok } from '../../../adapters/mcp/test/local-daemon-support.mjs';
import { verifiedOwner, localProcessIdentity, processStart, startAwareAlive } from '../../../adapters/mcp/local-daemon-liveness.mjs';

import { qualificationStderr } from './qualification-stderr.mjs';
const commands = new Set();
async function command(file, args, diagnostic = text => process.stderr.write(text)) {
  const child = spawn(file, args, { env: {}, stdio: ['ignore', 'pipe', 'pipe'] });
  let stdout = ''; const stderr = qualificationStderr();
  child.stdout.on('data', b => { stdout += b; }); child.stderr.on('data', b => stderr.write(b));
  const live = child.pid ? processStart(child.pid) : null;
  const owner = live ? { ...localProcessIdentity(), pid: child.pid, start: live.start } : null;
  const done = new Promise((resolve, reject) => { child.once('error', reject); child.once('close', (code, signal) => resolve({ code, signal })); });
  const job = { child, owner, done }; commands.add(job);
  let rc; try { rc = await done; } catch { throw Error('qualification_child_spawn_failed'); } finally { commands.delete(job); }
  if (rc.code !== 0) {
    diagnostic(stderr.read());
    throw Error('qualification_child_failed:' + JSON.stringify(rc));
  }
  return stdout;
}
export const daemonStoreCommand = async (action, path, n, ns) => JSON.parse(await command(process.execPath,
  [fileURLToPath(new URL('./daemon-store.mjs', import.meta.url)), action, path, String(n ?? 0), ...(ns ? [ns.ownerId, ns.projectId ?? ''] : [])]));
export async function createDaemonQualification(args) {
  if (args.length !== 2 || !['--store','--synthetic'].includes(args[0]) ||
      args[0] === '--synthetic' && (!/^[1-9]\d*$/.test(args[1]) || !Number.isSafeInteger(Number(args[1])))) throw Error('usage: --store PATH | --synthetic MESSAGES');
  const cleanup = [], t = { after(fn) { cleanup.push(fn); }, diagnostic() {} };
  const w = await workspace(t);
  await runtimeDirectory({ root: join(w.root, 'run') });
  let closing;
  const handlers = new Map();
  const close = () => closing ??= (async () => {
    try {
      for (const { child, owner } of commands) if (owner && startAwareAlive(owner)) child.kill('SIGTERM');
      await Promise.all([...commands].map(async ({ child, owner, done }) => {
        const timer = setTimeout(() => { if (owner && startAwareAlive(owner)) child.kill('SIGKILL'); }, 2000);
        try { await done.catch(() => {}); } finally { clearTimeout(timer); }
      }));
      for (const entry of w.children) if (!entry.exit && entry.role === 'per-session') entry.process.stdin.end();
      for (const fn of cleanup.reverse()) await fn();
    } finally { for (const [signal, handler] of handlers) process.off(signal, handler); }
  })();
  for (const [signal, code] of [['SIGTERM',143],['SIGINT',130]]) {
    const handler = () => { void close().then(() => process.exit(code), () => { console.error('qualification_cleanup_failed'); process.exit(1); }); };
    handlers.set(signal, handler); process.once(signal, handler);
  }
  try {
    let source;
    if (args[0] === '--synthetic') {
      source = join(w.root, 'synthetic-input.sqlite'); await daemonStoreCommand('seed', source, Number(args[1]));
    } else source = resolve(args[1]);
    // SQLite files are copied only by a separate cp process. Never open source.
    await command('/bin/cp', ['--', source, w.path]);
    for (const name of await readdir(dirname(source))) {
      if (name.startsWith(basename(source) + '.') || ['-wal','-shm','-journal'].some(suffix => name === basename(source)+suffix)) {
        const from = join(dirname(source),name); if (!(await lstat(from)).isFile()) continue;
        await command('/bin/cp', ['--', from, w.path + name.slice(basename(source).length)]);
      }
    }
    const before = await daemonStoreCommand('inspect', w.path);
    w.args.splice(0, w.args.length, '--db', w.path, '--owner', before.namespace.ownerId,
      ...(before.namespace.projectId ? ['--project', before.namespace.projectId] : []));
    return { w, before, close };
  } catch (error) { await close(); throw error; }
}
export async function stopQualificationOwner(w, descriptor) {
  if (verifiedOwner(descriptor.owner)) process.kill(descriptor.owner.pid, 'SIGTERM');
  await until(() => !verifiedOwner(descriptor.owner), 'createDaemonQualification daemon drains', 7000);
}
export const daemonQualificationQuery = { query: 'synthetic cobalt telescope engineering', types: ['memory'], intent: 'current', semantic: false };
export { until as waitQualification, ok as qualificationValue };
export { command as qualificationCommand };

// Entrypoints catch failures so Node never prints path-bearing exception stacks.
export function reportQualificationFailure(error, write = text => process.stderr.write(text)) {
  const message = String(error?.message ?? '');
  const code = /^qualification_[a-z_]+$/.test(message) || /^qualification_child_failed:\{\"code\":(?:null|-?\d+),\"signal\":(?:null|\"[A-Z0-9]+\")\}$/.test(message) ? message : 'qualification_failed';
  write(code + '\n');
  process.exitCode = 1;
}
