// Only resolve the installed MCP vector and forward to the engine's operator
// CLI. The engine owns previews, deletion, lineage and copy fences.
import { spawn } from 'node:child_process';
import { readDescriptor, vectorArguments, withLocalLock } from './local-descriptor.mjs';
import { SetupError } from './errors.mjs';

export function validateRawOptions(options, selection) {
  const [, operation, ...ids] = selection.argv;
  if (!['list', 'delete'].includes(operation) ||
      (operation === 'list' ? ids.length !== 0 : ids.length !== 1 || selection.client ||
        !ids[0] || ids[0].length > 200 || /[\s\x00-\x1f\x7f*?%\[\]]/u.test(ids[0]) || ids[0].startsWith('-')) ||
      options.localCapture !== undefined || options.dailyCap !== undefined || options.captureExec !== undefined)
    throw new SetupError('local_raw_arguments', 2);
}

async function invoke(vector, args, client, { env, write, onChild }) {
  return new Promise(resolve => {
    const child = spawn(vector.node, args, { detached: process.platform !== 'win32',
      env: { HOME: env.HOME, PATH: env.PATH ?? '/usr/bin:/bin', TMPDIR: env.TMPDIR, LANG: 'C.UTF-8' },
      stdio: ['ignore', 'pipe', 'ignore'] });
    let buffer = '', failed = false;
    const kill = () => { failed = true; try { process.kill(-child.pid, 'SIGKILL'); } catch { child.kill('SIGKILL'); } };
    const timer = setTimeout(kill, 120000);
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
        write.literal(JSON.stringify({ ok: false, error: { code: 'raw_command_failed', retryable: false } }));
        resolve(1);
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
    selection.client, { ...context, onChild });
  });
}
