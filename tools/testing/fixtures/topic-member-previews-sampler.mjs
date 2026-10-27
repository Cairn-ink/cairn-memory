// SQLite-free child: only fixed procfs counters, never caller-selected files.
import { readFileSync, readdirSync } from 'node:fs';
import { performance } from 'node:perf_hooks';

const pid = Number(process.argv[2]);
if (!Number.isSafeInteger(pid) || pid < 1) throw Error('invalid_pid');
const stamp = () => performance.timeOrigin + performance.now();
function sample() {
  const startedAt = stamp(), tasks = [];
  let vmstat = null, error = null;
  try {
    for (const name of readdirSync(`/proc/${pid}/task`)) {
      if (!/^\d+$/.test(name)) continue;
      try {
        const [runNs, waitNs, slices] = readFileSync(`/proc/${pid}/task/${name}/schedstat`, 'utf8').trim().split(/\s+/).map(Number);
        tasks.push({ tid: Number(name), runNs, waitNs, slices });
      } catch { /* A terminating Worker can disappear between list and read. */ }
    }
    const text = readFileSync('/proc/vmstat', 'utf8');
    vmstat = Object.fromEntries([...text.matchAll(/^(pswpin|pswpout|pgmajfault) (\d+)$/gm)].map(m => [m[1], Number(m[2])]));
  } catch { error = 'proc_unavailable'; }
  return { startedAt, finishedAt: stamp(), tasks, vmstat, error };
}
// The child owns a bounded ring. No periodic IPC or host allocation occurs
// while observing. An overflow is explicit diagnostic unavailability.
const capacity = 16384, ring = new Array(capacity);
let count = 0, cursor = 0;
function collect() { ring[cursor] = sample(); cursor = (cursor + 1) % capacity; count = Math.min(count + 1, capacity); }
function send(value) {
  return new Promise(resolve => {
    if (!process.connected) return resolve(false);
    // Only one send may be in flight. Even when send returns false, wait for
    // its callback before queuing another payload (IPC backpressure).
    process.send(value, error => resolve(!error));
  });
}
collect();
const timer = setInterval(collect, 10);
let transferring = false;
process.on('message', async message => {
  if (message.type !== 'flush' || transferring) return;
  transferring = true;
  try {
    collect();
    const ordered = Array.from({ length: count }, (_, i) => ring[(cursor - count + i + capacity) % capacity]);
    const before = ordered.findLastIndex(s => s.finishedAt <= message.startedAt);
    const selected = ordered.slice(Math.max(0, before));
    for (let i = 0; i < selected.length; i += 128) {
      if (!await send({ type: 'samples', id: message.id, samples: selected.slice(i, i + 128) })) return;
    }
    await send({ type: 'flush', id: message.id, unavailable: before < 0 });
  } finally { transferring = false; }
});
process.on('disconnect', () => { clearInterval(timer); process.exitCode = 0; });
await send({ type: 'ready' });
