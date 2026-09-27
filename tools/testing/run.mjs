import { spawn } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { setTimeout as delay } from 'node:timers/promises';
import { createTestWorkspace } from './workspace.mjs';

// On Linux the child owns a process group. Check live members, excluding zombies
// already terminated but awaiting their host's reaper. Escaped/detached sessions
// and uncatchable SIGKILL/host shutdown are outside this test runner's contract.
function groupAlive(group) {
  for (const name of readdirSync('/proc')) {
    if (!/^\d+$/.test(name)) continue;
    let stat;
    try { stat = readFileSync(`/proc/${name}/stat`, 'utf8'); }
    catch (error) { if (error.code === 'ENOENT' || error.code === 'ESRCH') continue; throw error; }
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ');
    if (Number(fields[2]) === group && fields[0] !== 'Z' && fields[0] !== 'X') return true;
  }
  return false;
}

function signalGroup(child, signal, grouped) {
  try { if (grouped) process.kill(-child.pid, signal); else child.kill(signal); }
  catch (error) { if (error.code !== 'ESRCH') throw error; }
}

async function finishGroup(child) {
  if (!groupAlive(child.pid)) return;
  signalGroup(child, 'SIGTERM', true);
  for (let attempt = 0; attempt < 100; attempt++) {
    if (!groupAlive(child.pid)) return;
    if (attempt === 40) signalGroup(child, 'SIGKILL', true);
    await delay(50);
  }
  throw new Error('test_children_still_running_workspace_retained');
}

const workspace = createTestWorkspace(null, { prefix: 'cairn-test-run-' });
const args = process.argv.slice(2);
const scriptMode = args[0] === '--script';
const grouped = process.platform === 'linux';
let child;
let termination;
let escalation;
let childrenStopped = true;
let cleaning = false;
const signalExitCode = signal => ({ SIGINT: 130, SIGTERM: 143, SIGHUP: 129 })[signal];
const handlers = new Map(['SIGINT', 'SIGTERM', 'SIGHUP'].map(signal => [signal, () => {
  termination ??= signal;
  if (cleaning) { process.exitCode = signalExitCode(termination); return; }
  if (child?.pid) signalGroup(child, signal, grouped);
  escalation ??= setTimeout(() => { if (child?.pid) signalGroup(child, 'SIGKILL', grouped); }, 2000);
}]));
for (const [signal, handler] of handlers) process.on(signal, handler);
try {
  if (scriptMode && (!args[1] || args[1].startsWith('-'))) throw new Error('test_script_path_required');
  const env = { ...process.env, TMPDIR: workspace.path, TMP: workspace.path, TEMP: workspace.path };
  // A wrapper launched by node:test starts a new runner, not a recursive test
  // worker. This internal marker would otherwise silently skip its test files.
  delete env.NODE_TEST_CONTEXT;
  child = spawn(process.execPath, scriptMode ? args.slice(1) : ['--test', ...args], {
    cwd: process.cwd(), stdio: 'inherit', detached: grouped,
    env,
  });
  childrenStopped = false;
  const result = await new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code, signal) => resolve({ code, signal }));
  });
  if (grouped && child.pid) await finishGroup(child);
  childrenStopped = true;
  process.exitCode = termination ? signalExitCode(termination)
    : result.code ?? (result.signal ? 1 : 0);
} catch (error) {
  // A failed spawn creates no child. A failed process-group check deliberately
  // retains scratch instead of removing data beneath an unverified live child.
  if (!child?.pid) childrenStopped = true;
  console.error(error);
  process.exitCode = 1;
} finally {
  cleaning = true;
  clearTimeout(escalation);
  try {
    if (childrenStopped) {
      try { await workspace.cleanup(); }
      catch (error) { console.error(error); process.exitCode = 1; }
    }
  } finally { for (const [signal, handler] of handlers) process.off(signal, handler); }
}
