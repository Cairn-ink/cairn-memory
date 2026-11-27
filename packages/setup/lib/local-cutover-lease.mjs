import { spawn, spawnSync } from 'node:child_process';
import { once } from 'node:events';
import { createInterface } from 'node:readline';
import { setTimeout as delay } from 'node:timers/promises';
import { darwinExclusion } from './local-cutover-darwin.mjs';

// The explicit checkout entry point uses Linux leases on a local filesystem.
// Acquire a write lease briefly to prove there are no preexisting handles,
// then downgrade to a read lease to allow the I2 readers while fencing writers.
// The helper owns the only raw fd here and never imports SQLite. The lease is
// released on stdin EOF (including setup SIGKILL). Any attempted write open
// breaks the proof, even if the kernel has not yet released the lease.
const helper = String.raw`
import errno, fcntl, os, signal, stat, sys

broken = False
def on_break(*_):
    global broken
    broken = True

signal.signal(signal.SIGIO, on_break)
path = sys.argv[1]
try:
    fd = os.open(path, os.O_RDONLY | os.O_NOFOLLOW | os.O_NONBLOCK)
    pinned = os.fstat(fd)
    if not stat.S_ISREG(pinned.st_mode) or pinned.st_uid != os.getuid() or stat.S_IMODE(pinned.st_mode) != 0o600 or pinned.st_nlink != 1:
        raise OSError(errno.EINVAL, 'unsafe')
    fcntl.fcntl(fd, fcntl.F_SETLEASE, fcntl.F_WRLCK)
    fcntl.fcntl(fd, fcntl.F_SETLEASE, fcntl.F_RDLCK)
    print('ready', flush=True)
    for _ in sys.stdin:
        current = os.stat(path, follow_symlinks=False)
        same = (current.st_dev, current.st_ino, current.st_ctime_ns, current.st_mtime_ns, current.st_size) == (
            pinned.st_dev, pinned.st_ino, pinned.st_ctime_ns, pinned.st_mtime_ns, pinned.st_size)
        held = fcntl.fcntl(fd, fcntl.F_GETLEASE) == fcntl.F_RDLCK
        print('ready' if same and held and not broken else 'lost', flush=True)
except OSError as error:
    print('busy' if error.errno == errno.EAGAIN else 'unavailable', flush=True)
`;

export const cutoverRefusal = code => Object.assign(new Error(code), { code });

async function withLinuxLease(path, work) {
  const child = spawn('/usr/bin/python3', ['-I', '-u', '-c', helper, path], {
    env: {}, stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout });
  const exit = new Promise(resolve => child.once('close', resolve));
  child.on('error', () => {});
  child.stdin.on('error', () => {});
  async function status() {
    try {
      const signal = AbortSignal.timeout(5000);
      const event = await Promise.race([once(lines, 'line', { signal }), exit.then(() => [])]);
      if (event[0] === 'ready') return;
      if (event[0] === 'busy') throw cutoverRefusal('cutover_store_busy');
      if (event[0] === 'lost') throw cutoverRefusal('cutover_lease_lost');
    } catch (error) {
      if (error.code?.startsWith('cutover_')) throw error;
    }
    throw cutoverRefusal('cutover_lease_unavailable');
  }
  try {
    await status();
    return await work(async () => {
      const pending = status();
      child.stdin.write('\n');
      await pending;
    });
  } finally {
    lines.close();
    child.stdin.end();
    const timer = new AbortController();
    try {
      await Promise.race([exit, delay(1000, undefined, { signal: timer.signal }).then(() => child.kill('SIGKILL'))]);
    } finally { timer.abort(); }
    await exit;
  }
}

// Atomic exchange leaves no instant in which an old SQLite opener can create
// a fresh database at the registered pathname. Both names are in one private
// directory. There is no non-atomic fallback.
function exchangeFiles(source, retired, identity) {
  const result = spawnSync('/usr/bin/python3', ['-I', '-c', `
import ctypes, os, signal, sys
libc = ctypes.CDLL(None, use_errno=True)
# Stop a pending helper if setup dies. Recovery must be the only process
# that can perform a second exchange for the same names.
if libc.prctl(1, signal.SIGKILL, 0, 0, 0) or os.getppid() != int(sys.argv[3]):
    sys.exit(1)
source = os.stat(sys.argv[1], follow_symlinks=False)
if f'{source.st_dev}:{source.st_ino}' != sys.argv[4]:
    sys.exit(1)
exchange = libc.renameat2
exchange.argtypes = (ctypes.c_int, ctypes.c_char_p, ctypes.c_int, ctypes.c_char_p, ctypes.c_uint)
if exchange(-100, os.fsencode(sys.argv[1]), -100, os.fsencode(sys.argv[2]), 2):
    raise OSError(ctypes.get_errno(), 'renameat2')
`, source, retired, String(process.pid), identity], { env: {}, stdio: 'ignore', timeout: 5000, killSignal: 'SIGKILL' });
  if (result.error || result.status !== 0) throw cutoverRefusal('cutover_exchange_unavailable');
}

const linuxExclusion = Object.freeze({ withColdStoreLease: withLinuxLease, exchange: exchangeFiles });

const macOSExclusion = darwinExclusion(cutoverRefusal);

export function localCutoverExclusion(platform = process.platform) {
  if (platform === 'linux' && process.platform === 'linux') return linuxExclusion;
  if (platform === 'darwin' && process.platform === 'darwin') return macOSExclusion;
  throw cutoverRefusal('cutover_platform');
}

export function withColdStoreLease(path, work) {
  return localCutoverExclusion().withColdStoreLease(path, work);
}

export function exchange(source, retired, identity) {
  return localCutoverExclusion().exchange(source, retired, identity);
}
