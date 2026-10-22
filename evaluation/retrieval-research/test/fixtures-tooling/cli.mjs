import { spawn } from 'node:child_process';
import { open, readFile } from 'node:fs/promises';
import { join } from 'node:path';

// Explicit file descriptors avoid nested Node test IPC and keep all child
// output in the owned workspace, even on hosts with restricted pipe capture.
export async function runCli(workspace, args) {
  const stdoutPath = join(workspace.path, 'child-stdout.log'), stderrPath = join(workspace.path, 'child-stderr.log');
  const stdout = await open(stdoutPath, 'w'), stderr = await open(stderrPath, 'w');
  const env = { ...process.env };
  delete env.NODE_TEST_CONTEXT;
  try {
    const child = spawn(process.execPath, args, { env, stdio: ['ignore', stdout.fd, stderr.fd] });
    const code = await new Promise((resolve, reject) => { child.once('error', reject); child.once('close', resolve); });
    return { code, stdout: await readFile(stdoutPath, 'utf8'), stderr: await readFile(stderrPath, 'utf8') };
  } finally { await stdout.close(); await stderr.close(); }
}
