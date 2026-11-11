// Only resolve the installed MCP vector and forward to the engine's operator
// CLI. The engine owns previews, deletion, lineage and copy fences.
import { spawn } from 'node:child_process';
import { readDescriptor, vectorArguments, withLocalLock } from './local-descriptor.mjs';
import { SetupError } from './errors.mjs';

// The engine owns a 600-second retry budget. Allow another 30 seconds for
// SQLite close/checkpoint and process shutdown. Metadata list/preview have no
// retry loop; two minutes leaves ample room for their bounded storage work.
const ENGINE_DELETE_BUDGET_MS = 600000;
const DELETE_WATCHDOG_MS = ENGINE_DELETE_BUDGET_MS + 30000;
const INSPECT_WATCHDOG_MS = 120000;
const CONTINUE = 'rerun the same command to continue';
const MAX_PROGRESS_LINES = 4096; // More than the engine's 10-minute/250ms loop.
const MAX_PROGRESS_LENGTH = 96;
const count = '(?:0|[1-9]\\d{0,2}(?:,\\d{3}){0,5})';
const progressPattern = new RegExp(`^${count}/${count} prepared$`);

// Decode complete lines only. Oversized lines are discarded through their
// newline without accumulating them; arbitrary diagnostics never escape.
export function createProgressFilter(forward) {
  let diagnostic = '', dropping = false, progressLines = 0;
  const progress = text => {
    if (progressLines >= MAX_PROGRESS_LINES || text.length > MAX_PROGRESS_LENGTH) return;
    if (text === 'storage busy; waiting to retry' || text === CONTINUE || progressPattern.test(text)) {
      progressLines++; forward(text + '\n');
    }
  };
  return {
    get bufferedLength() { return diagnostic.length; },
    push(chunk) {
      for (const character of chunk) {
        if (character === '\n') {
          if (!dropping) progress(diagnostic);
          diagnostic = ''; dropping = false;
        } else if (!dropping) {
          if (diagnostic.length + character.length > MAX_PROGRESS_LENGTH) { diagnostic = ''; dropping = true; }
          else diagnostic += character;
        }
      }
    },
  };
}

export function validateRawOptions(options, selection) {
  const [, operation, ...ids] = selection.argv;
  if (!['list', 'delete'].includes(operation) ||
      (operation === 'list' ? ids.length !== 0 : ids.length !== 1 || selection.client ||
        !ids[0] || ids[0].length > 200 || /[\s\x00-\x1f\x7f*?%\[\]]/u.test(ids[0]) || ids[0].startsWith('-')) ||
      options.localCapture !== undefined || options.dailyCap !== undefined || options.captureExec !== undefined)
    throw new SetupError('local_raw_arguments', 2);
}

async function invoke(vector, args, client, deleting, { env, write, onChild }) {
  return new Promise(resolve => {
    const child = spawn(vector.node, args, { detached: process.platform !== 'win32',
      env: { HOME: env.HOME, PATH: env.PATH ?? '/usr/bin:/bin', TMPDIR: env.TMPDIR, LANG: 'C.UTF-8' },
      stdio: ['ignore', 'pipe', 'pipe'] });
    let buffer = '', failed = false, timedOut = false;
    const kill = () => { failed = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const timer = setTimeout(() => { timedOut = true; kill(); },
      deleting ? DELETE_WATCHDOG_MS : INSPECT_WATCHDOG_MS);
    const progress = createProgressFilter(text => process.stderr.write(text));
    child.stderr?.setEncoding('utf8');
    child.stderr?.on('data', chunk => progress.push(chunk));
    const tracking = Promise.resolve(onChild(child.pid)).catch(kill);
    const line = text => {
      if (!text || failed) return;
      try {
        const row = JSON.parse(text);
        // raw list's optional client filter operates on metadata from the
        // engine. Errors are never filtered and JSON lines stay copyable.
        if (!client || row.ok === false || row.client === (client === 'claude' ? 'claude-code' : 'codex'))
          write.literal(JSON.stringify(row));
      } catch { kill(); }
    };
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', chunk => {
      buffer += chunk;
      let end;
      while ((end = buffer.indexOf('\n')) >= 0) {
        if (end > 65536) { kill(); return; }
        line(buffer.slice(0, end)); buffer = buffer.slice(end + 1);
      }
      if (buffer.length > 65536) kill();
    });
    child.on('error', () => { failed = true; });
    child.on('close', async code => {
      clearTimeout(timer); line(buffer); await tracking;
      try { await onChild(null); } catch { failed = true; }
      if (failed || !Number.isInteger(code)) {
        const resumable = timedOut && deleting;
        if (resumable) process.stderr.write(CONTINUE + '\n');
        write.literal(JSON.stringify({ ok: false, error: { code: 'raw_command_failed', retryable: resumable } }));
        resolve(resumable ? 3 : 1);
      } else resolve(code);
    });
  });
}

export async function rawLocal(options, selection, detection, context) {
  const { descriptor, states } = detection;
  if (detection.descriptorError) throw new SetupError('local_recovery_required', 2);
  if (detection.union !== 'local' || !descriptor || descriptor.state !== 'installed' ||
      (selection.client && (!descriptor.clients[selection.client] || states[selection.client].cloud)))
    throw new SetupError('local_raw_unavailable', 2);
  const [, operation, id] = selection.argv;
  return withLocalLock(detection.root, async onChild => {
    const current = await readDescriptor(detection.root);
    if (JSON.stringify(current) !== JSON.stringify(descriptor)) throw new SetupError('local_recovery_required', 2);
    const receipt = current.clients[selection.client ?? Object.keys(current.clients).find(client => current.clients[client])];
    const vector = receipt.vector;
    const [executable, ...flags] = vectorArguments(detection.root, vector);
    return invoke(vector, [executable, 'raw', operation, ...flags,
      ...(operation === 'delete' ? ['--conversation', id, ...(options.yes ? ['--yes'] : [])] : [])],
    selection.client, operation === 'delete' && options.yes === true, { ...context, onChild });
  });
}
