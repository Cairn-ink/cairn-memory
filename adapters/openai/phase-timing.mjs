const stages = new Set(['extract', 'classify', 'select', 'selectChecklist', 'rank',
  'reconcile', 'qualify', 'qualifyCandidates', 'interpretEpisode', 'relate', 'reviewBasis']);
const phases = new Set(['prepare', 'count_transport', 'count_body', 'count_validation',
  'generation_transport', 'generation_body', 'output_validation']);
const outcomes = new Set(['completed', 'failed', 'aborted']);
const maximumMs = 2_147_483_647;
const noOp = () => {};
const clock = () => {
  try {
    const value = performance.now();
    return Number.isFinite(value) ? value : null;
  } catch { return null; }
};

/** One optional, content-free phase clock per adapter invocation. */
export function createPhaseTiming(onPhaseTiming, stage, signal) {
  if (onPhaseTiming === undefined) return Object.freeze({ start: () => noOp });
  const seen = new Set();
  const emit = (phase, outcome, started) => {
    if (!stages.has(stage) || !phases.has(phase) || !outcomes.has(outcome)) return;
    const ended = clock();
    if (started === null || ended === null) return;
    const duration = ended - started;
    const elapsedMs = Math.min(maximumMs, Math.max(0, duration));
    try {
      const result = onPhaseTiming(Object.freeze({ version: 1, stage, phase, outcome, elapsedMs }));
      // A returned native Promise may override its own catch property.
      Promise.prototype.then.call(Promise.resolve(result), undefined, noOp);
    } catch { /* Observation must not replace an operation result. */ }
  };
  return Object.freeze({ start(phase, watchAbort = true) {
    if (!phases.has(phase) || seen.has(phase) || seen.size >= 7) return noOp;
    seen.add(phase);
    const started = clock();
    let settled = false;
    let abort;
    const finish = (outcome) => {
      if (settled) return;
      settled = true;
      if (abort) signal.removeEventListener('abort', abort);
      emit(phase, outcome, started);
    };
    if (watchAbort && signal instanceof AbortSignal) {
      abort = () => finish('aborted');
      if (signal.aborted) abort();
      else signal.addEventListener('abort', abort, { once: true });
    }
    return finish;
  } });
}
