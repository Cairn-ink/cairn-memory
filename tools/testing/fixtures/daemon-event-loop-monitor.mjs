// Qualification only. Installed inside a supervised candidate, never preloaded
// through execArgv, imported by production, or listed in the artifact inventory.
import { monitorEventLoopDelay, performance } from 'node:perf_hooks';
export function installDaemonSliceMonitor() {
  const histogram = monitorEventLoopDelay({ resolution: 10 }); histogram.enable();
  let phase = 'first_activation', previous = performance.now();
  const blocks = [], maxima = {};
  const sample = () => {
    const now = performance.now(), gap = now - previous; previous = now;
    const block = Math.max(gap, histogram.max / 1e6); histogram.reset();
    maxima[phase] = Math.max(maxima[phase] ?? 0, block);
    if (block >= 50) blocks.push({ phase, at_ms: now, block_ms: block });
  };
  const timer = setInterval(sample, 5);
  return {
    phase(value) { sample(); phase = value; maxima[phase] ??= 0; },
    report() {
      sample(); const slice_max_ms = Math.max(0, ...Object.values(maxima));
      return { slice_max_ms, per_phase_ms: { ...maxima }, longest_blocks: [...blocks].sort((a,b) => b.block_ms-a.block_ms).slice(0,10),
        t_ms: Math.max(30000, 3 * slice_max_ms), t_ok: slice_max_ms <= 10000 };
    },
    close() { clearInterval(timer); histogram.disable(); },
  };
}
