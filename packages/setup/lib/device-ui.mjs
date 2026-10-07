import { spawn } from 'node:child_process';
import { release } from 'node:os';
import { writeSync } from 'node:fs';

const userCode = value => typeof value === 'string' && /^[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}-[ABCDEFGHJKLMNPQRSTUVWXYZ23456789]{4}$/u.test(value);

export function formatCode(code, { tty = Boolean(process.stdout.isTTY), env = process.env } = {}) {
  return tty && !Object.hasOwn(env, 'NO_COLOR') ? `\x1b[1;36m${code}\x1b[0m` : `[ ${code} ]`;
}

export function clipboardCommands({ platform = process.platform, env = process.env, wsl = /microsoft/iu.test(release()) } = {}) {
  // A forwarded display/SSH session is not evidence of a local clipboard.
  if (env.SSH_CONNECTION || env.SSH_CLIENT || env.SSH_TTY) return [];
  if (platform === 'darwin') return [['pbcopy', []]];
  if (platform === 'win32') return [['clip.exe', []]];
  return [
    ...(wsl ? [['clip.exe', []]] : []),
    ...(env.WAYLAND_DISPLAY && env.XDG_RUNTIME_DIR ? [['wl-copy', ['--type', 'text/plain']]] : []),
    ...(env.DISPLAY ? [['xclip', ['-selection', 'clipboard']], ['xsel', ['--clipboard', '--input']]] : []),
  ];
}

function runClipboard(command, args, input, signal) {
  return new Promise(resolve => {
    let child;
    try { child = spawn(command, args, { stdio: ['pipe', 'ignore', 'ignore'], windowsHide: true }); }
    catch { input.fill(0); resolve(false); return; }
    let failed = false, escalation;
    const stop = () => {
      failed = true;
      child.kill();
      escalation ??= setTimeout(() => child.kill('SIGKILL'), 250);
    };
    const timer = setTimeout(stop, 1500);
    signal?.addEventListener('abort', stop, { once: true });
    if (signal?.aborted) stop();
    child.on('error', () => { failed = true; });
    child.stdin.on('error', () => { failed = true; });
    child.on('close', status => {
      clearTimeout(timer); clearTimeout(escalation);
      signal?.removeEventListener('abort', stop);
      input.fill(0);
      resolve(!failed && status === 0);
    });
    child.stdin.end(input, () => input.fill(0));
  });
}

// Accept only the public device user_code, never a bearer token/proof/receipt.
// Fixed commands, no shell, no code in argv/environment/files, no child output.
export async function copyCode(code, { signal, run = runClipboard, ...options } = {}) {
  if (!userCode(code) || signal?.aborted) return false;
  for (const [command, args] of clipboardCommands(options)) {
    const input = command === 'clip.exe' ? Buffer.from(`\ufeff${code}`, 'utf16le') : Buffer.from(code, 'utf8');
    try { if (await run(command, args, input, signal)) return true; }
    catch { /* Optional convenience; never fail authorization. */ }
    finally { input.fill(0); }
    if (signal?.aborted) break;
  }
  return false;
}

export function spinner(write, remaining, saving = false, t, code, {
  tty = Boolean(process.stdout.isTTY), render = value => writeSync(1, value),
} = {}) {
  const message = () => {
    const seconds = typeof remaining === 'function' ? remaining() : remaining;
    return saving ? t('saving') : t('waiting', {
      code, time: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`,
    });
  };
  if (!tty) { write(message()); return () => {}; }
  const frames = ['⠋', '⠙', '⠹', '⠸'];
  let frame = 0;
  const draw = () => render(`\r${frames[frame++ % frames.length]} ${message()}\x1b[K`);
  draw();
  const timer = setInterval(draw, 250);
  return () => { clearInterval(timer); render('\r\x1b[K'); };
}
