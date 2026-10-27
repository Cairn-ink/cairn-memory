import { lstat, mkdir, open, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { codexHome, inspectCodexServers, runCodex, snapshot, codexEnvironmentCause } from './codex.mjs';
import { sameVector, vectorArguments, boundedJSON, pidIsDead, localFilesystemError } from './local-descriptor.mjs';
import { observedVector } from './local-claude.mjs';
import { tomlString } from './output.mjs';
import { SetupError } from './errors.mjs';

export const codexAddArguments = (root, vector) => ['mcp', 'add', 'cairn-local', '--', vector.node, ...vectorArguments(root, vector)];
export const codexSnippet = (root, vector) => '[mcp_servers."cairn-local"]\ncommand = ' + tomlString(vector.node) +
  '\nargs = [' + vectorArguments(root, vector).map(tomlString).join(', ') + ']';
export async function checkCodexLock(home) {
  const path = join(home, '.cairn-setup.lock');
  try { await lstat(path); }
  catch (error) { if (error.code === 'ENOENT') return; throw localFilesystemError(error, 'codex_mcp_unverified'); }
  let stale = false;
  try { stale = pidIsDead((await boundedJSON(path, 1024, { privateFile: true })).pid); } catch { /* Hosted locks are empty. */ }
  throw new SetupError(stale ? 'codex_lock_stale' : 'codex_lock', 2, { path, local: true });
}
async function withCodexLock(home, work) {
  try {
  await mkdir(home, { recursive: true, mode: 0o700 });
  const info = await lstat(home);
  if (!info.isDirectory() || info.isSymbolicLink() || (process.getuid && info.uid !== process.getuid()) ||
      (info.mode & 0o022)) throw new SetupError('codex_directory');
  const path = join(home, '.cairn-setup.lock'); let lock;
  try { lock = await open(path, 'wx', 0o600); }
  catch (error) {
    if (error.code !== 'EEXIST') throw error;
    await checkCodexLock(home);
    throw new SetupError('codex_lock', 2, { path, local: true });
  }
  try {
    await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }) + '\n');
    await lock.sync(); return await work();
  } finally { await lock.close(); await rm(path); }
  } catch (error) { throw localFilesystemError(error, 'codex_mcp_unverified'); }
}
export async function codexCapabilities(env) {
  for (const [args, pattern] of [[['mcp', 'add', '--help'], /--\s+<?COMMAND>/u],
    [['mcp', 'remove', '--help'], /./u], [['mcp', 'list', '--help'], /./u]]) {
    const result = await runCodex(args, { env });
    if (result.error || result.status !== 0 || !pattern.test(result.stdout)) return false;
  }
  return true;
}
export async function registerCodex({ root, checkpoint, env = process.env, write, t, inspection, capable }) {
  const home = dirname(checkpoint.destination), { desired } = checkpoint;
  try {
    const original = await lstat(codexHome(env));
    if (!original.isDirectory() || original.isSymbolicLink() || (process.getuid && original.uid !== process.getuid()) || (original.mode & 0o022)) throw new SetupError('codex_directory');
  } catch (error) { if (error.code !== 'ENOENT') throw localFilesystemError(error, 'codex_mcp_unverified'); }
  const manual = () => { write(t('local_manual_codex')); write.literal(codexSnippet(root, desired)); };
  if (!(capable ?? await codexCapabilities(env))) { write(t('codex_mcp_required')); manual(); return 'manual'; }
  return withCodexLock(home, async () => {
    await snapshot(join(home, 'config.toml'));
    const result = await runCodex(codexAddArguments(root, desired), { env: { ...env, CODEX_HOME: home } });
    let verified = false, environmentCause;
    if (!result.error && result.status === 0) {
      try {
        const entries = await inspectCodexServers({ ...inspection, home, env });
        const local = entries.filter(entry => entry.name === 'cairn-local');
        verified = local.length === 1 && sameVector(observedVector(root, local[0]), desired);
      } catch (error) { environmentCause = codexEnvironmentCause(error); }
    }
    if (!verified) { manual(); if (environmentCause) write(t(environmentCause)); throw new SetupError('codex_mcp_unverified'); }
    return 'done';
  });
}
export async function detachCodex({ env = process.env, home = codexHome(env), inspection, write, t }) {
  return withCodexLock(home, async () => {
    await snapshot(join(home, 'config.toml'));
    const result = await runCodex(['mcp', 'remove', 'cairn-local'], { env: { ...env, CODEX_HOME: home } });
    if (result.error || result.status !== 0) throw new SetupError('codex_mcp_unverified');
    let entries;
    try { entries = await inspectCodexServers({ ...inspection, home, env }); } catch (error) {
      const cause = codexEnvironmentCause(error);
      if (cause) write(t(cause));
      throw new SetupError('codex_mcp_unverified');
    }
    if (entries.some(entry => entry.name === 'cairn-local')) throw new SetupError('codex_mcp_unverified');
  });
}
