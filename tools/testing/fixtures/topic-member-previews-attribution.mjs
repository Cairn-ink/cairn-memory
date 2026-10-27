import { PerformanceObserver, performance } from 'node:perf_hooks';
import { fork } from 'node:child_process';

export const resourceKeys = ['majorPageFault','minorPageFault','voluntaryContextSwitches',
  'involuntaryContextSwitches','userCPUTime','systemCPUTime'];
export const resourceDelta = (a, b) => Object.fromEntries(resourceKeys.map(k => [k, b[k] - a[k]]));
export const resourceSnapshot = () => ({ heapUsed: process.memoryUsage().heapUsed, resources: process.resourceUsage() });
export function observeGC() {
  const entries = [];
  const add = records => { for (const e of records) entries.push({ kind: e.detail.kind,
    startedAt: performance.timeOrigin + e.startTime, durationMs: e.duration }); };
  const observer = new PerformanceObserver(list => add(list.getEntries()));
  observer.observe({ type: 'gc' });
  return { entries, drain() { add(observer.takeRecords()); return entries; }, close() { observer.disconnect(); } };
}
const overlaps = (a, b, start, end) => a < end && start < b;
export function schedulerAttribution(samples, block, hostTid, workerTids = []) {
  const before = samples.findLast(s => s.finishedAt <= block.startedAt);
  const after = samples.find(s => s.startedAt >= block.finishedAt);
  const selected = samples.filter(s => s === before || s === after ||
    overlaps(s.startedAt, s.finishedAt, block.startedAt, block.finishedAt) ||
    s.startedAt >= block.startedAt && s.startedAt <= block.finishedAt);
  const threads = [hostTid, ...new Set(workerTids)].map(tid => {
    const points = selected.flatMap(s => {
      const task = s.tasks.find(t => t.tid === tid);
      return task ? [{ startedAt: s.startedAt, finishedAt: s.finishedAt, ...task }] : [];
    });
    const first = points[0], last = points.at(-1);
    const bracketed = Boolean(first && last && first.finishedAt <= block.startedAt && last.startedAt >= block.finishedAt);
    return { tid, role: tid === hostTid ? 'host' : 'worker', bracketed,
      // Enclosing interval includes boundary noise; unbracketed is a partial
      // observation, never silently treated as zero or extrapolated.
      runQueueMs: points.length > 1 ? (last.waitNs - first.waitNs) / 1e6 : null,
      cpuMs: points.length > 1 ? (last.runNs - first.runNs) / 1e6 : null, points };
  });
  const a = before?.vmstat, b = after?.vmstat;
  return { intervalMs: 10, samples: selected, threads,
    vmstatDelta: a && b ? Object.fromEntries(['pswpin','pswpout','pgmajfault'].map(k => [k, b[k] - a[k]])) : null,
    maximumSampleGapMs: selected.length > 1 ? Math.max(...selected.slice(1).map((s,i) => s.startedAt - selected[i].startedAt)) : null };
}
export function attributeBlock(block, { gc = [], samples = [], workerReads = [], workerThreads = [], workerLifecycle = [], phases = [], hostTid = process.pid } = {}) {
  const a = block.attribution;
  a.hostGC = gc.filter(e => overlaps(e.startedAt, e.startedAt + e.durationMs, block.startedAt, block.finishedAt));
  a.workerReads = workerReads.filter(r => overlaps(r.startedAt, r.finishedAt, block.startedAt, block.finishedAt));
  a.workerThreads = workerThreads;
  a.workerLifecycle = workerLifecycle.filter(e => overlaps(e.startedAt, e.finishedAt ?? block.finishedAt, block.startedAt, block.finishedAt));
  a.scheduler = schedulerAttribution(samples, block, hostTid, [...workerThreads, ...workerReads].map(r => r.tid).filter(Number.isInteger));
  const gcMs = a.hostGC.reduce((n,e) => n + Math.max(0, Math.min(block.finishedAt, e.startedAt + e.durationMs) - Math.max(block.startedAt, e.startedAt)), 0);
  const host = a.scheduler.threads[0];
  const phaseNames = [block.phaseStart, block.phaseEnd, ...phases.filter(p => p.at >= block.startedAt && p.at <= block.finishedAt).map(p => p.phase)];
  const signals = [];
  if (gcMs >= block.gapMs / 2) signals.push('host-gc');
  if (phaseNames.some(p => /validation|membership/.test(p))) signals.push('harness-sync');
  if (host.bracketed && host.runQueueMs >= block.gapMs / 2) signals.push('run-queue');
  if (a.resources.majorPageFault > 0) signals.push('page-fault');
  if (a.workerLifecycle.some(e => e.operation === 'terminate') || phaseNames.some(p => /close/.test(p))) signals.push('worker-join-or-close');
  a.signals = signals;
  a.classification = signals[0] ?? 'unattributed';
  return block;
}

// One child per measuring process, reused across attempts. Only the active
// observation's samples are retained. Flush is an IPC rendezvous, not a sleep.
export async function startSampler() {
  const child = fork(new URL('./topic-member-previews-sampler.mjs', import.meta.url), [String(process.pid)],
    { execArgv: [], env: {}, stdio: ['ignore','ignore','ignore','ipc'] });
  let samples = [], latest, nextId = 0, unavailable = false, collecting = false;
  const waiters = new Map();
  const exited = new Promise(resolve => {
    child.once('exit', (code, signal) => resolve({ code, signal }));
    child.once('error', () => resolve({ code: null, signal: null, error: 'sampler_failed' }));
  });
  child.on('error', () => { unavailable = true; for (const resolve of waiters.values()) resolve(null); waiters.clear(); });
  child.on('exit', () => { unavailable = true; for (const resolve of waiters.values()) resolve(null); waiters.clear(); });
  child.on('message', m => {
    if (m.sample) { latest = m.sample; if (collecting) samples.push(latest); }
    const resolve = waiters.get(m.id ?? 'ready');
    if (resolve) { waiters.delete(m.id ?? 'ready'); resolve(m.sample); }
  });
  async function rendezvous(id, send) {
    if (unavailable) return null;
    let timer;
    try { return await new Promise(resolve => {
      waiters.set(id, resolve);
      timer = setTimeout(() => { waiters.delete(id); unavailable = true; resolve(null); }, 5000);
      send?.();
    }); } finally { clearTimeout(timer); }
  }
  await rendezvous('ready');
  return { begin() { samples = latest ? [latest] : []; collecting = true; },
    async finish() {
      const id = nextId++;
      await rendezvous(id, () => child.send({ type: 'flush', id }));
      collecting = false;
      return { samples, unavailable };
    },
    async close() {
      if (child.connected) child.disconnect();
      const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
      try { return await exited; } finally { clearTimeout(timer); }
    } };
}
