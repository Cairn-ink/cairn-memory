// One admission clock for opening, scans, item writes, verification and GC.
// Estimates are local to this quantum; no host timing assumptions or timers.
export function maintenanceQuantum({ now, cutoff, maxMs, attribution }) {
  const reserve = Math.max(50, Math.min(250, maxMs * 0.15));
  // A scan is a batch, not a document. Sharing its estimate with an item can
  // prevent every quantum from admitting even one cheap item after opening.
  const estimates = new Map();
  return {
    cutoff, reserve,
    admit: (kind = 'item') => cutoff - now() > reserve + (estimates.get(kind) ?? 10),
    async measureAsync(work, kind = 'item') {
      const start = now();
      try { return await work(); }
      finally { estimates.set(kind, Math.max(estimates.get(kind) ?? 10, 2 * (now() - start))); }
    },
    measure(work, kind = 'item', diagnosticKind) {
      const start = now();
      const operation = diagnosticKind ?? (kind==='verification' || kind==='verification-reset' ? 'verify' : kind==='verify-scan' ? 'scan' : kind);
      const result = attribution ? attribution.measure(operation,work,true,start,now) : work();
      // High-water mark, doubled rather than averaged: cheap rows cannot hide
      // the cost of an expensive row already observed in the same quantum.
      estimates.set(kind, Math.max(estimates.get(kind) ?? 10, 2 * (attribution ? attribution.elapsed : now() - start)));
      return result;
    }
  };
}
