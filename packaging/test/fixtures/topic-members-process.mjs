import { spawnSync } from 'node:child_process';
import { openSync, closeSync, readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname, delimiter } from 'node:path';
import { tmpdir } from 'node:os';
import { commandInvocation } from '../../build.mjs';

// File-backed stdio also makes exact subprocess diagnostics available on hosts
// that forbid pipe IPC. No inherited application environment or credentials.
export function runMemberProcess(executable, args, cwd, userconfig, extraEnv = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'member-process-'));
  const out = join(directory, 'stdout'), err = join(directory, 'stderr');
  let stdout, stderr;
  try {
    stdout = openSync(out, 'w', 0o600); stderr = openSync(err, 'w', 0o600);
    const invocation = commandInvocation(executable, args);
    const result = spawnSync(invocation.executable, invocation.args, { cwd, timeout: 120000,
      stdio: ['ignore', stdout, stderr], env: { PATH: dirname(process.execPath) + delimiter + (process.env.PATH ?? ''),
        ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}),
        TMPDIR: directory, TMP: directory, TEMP: directory,
        npm_config_userconfig: userconfig, npm_config_audit: 'false', npm_config_fund: 'false', ...extraEnv } });
    return { ...result, stdout: readFileSync(out, 'utf8'), stderr: readFileSync(err, 'utf8') };
  } finally {
    try { if (stdout !== undefined) closeSync(stdout); }
    finally { try { if (stderr !== undefined) closeSync(stderr); }
      finally { rmSync(directory, { recursive: true, force: true }); } }
  }
}
export function memberCommand(executable, args, cwd, userconfig) {
  const result = runMemberProcess(executable, args, cwd, userconfig);
  if (result.error || result.status !== 0) throw Error(JSON.stringify({ executable, args, code: result.error?.code,
    error: result.error?.message, exitCode: result.status, signal: result.signal, stderr: result.stderr }));
  return result.stdout;
}
