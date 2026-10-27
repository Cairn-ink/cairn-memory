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
const send = value => { if (process.connected) process.send(value); };
// 10ms resolves a 100ms gate with ~10 samples; IPC timestamps expose sampler
// descheduling. Sample all tasks so short-lived Workers need no registration race.
const timer = setInterval(() => send({ type: 'sample', sample: sample() }), 10);
process.on('message', message => {
  if (message.type === 'flush') send({ type: 'flush', id: message.id, sample: sample() });
});
process.on('disconnect', () => { clearInterval(timer); process.exitCode = 0; });
send({ type: 'ready', sample: sample() });
