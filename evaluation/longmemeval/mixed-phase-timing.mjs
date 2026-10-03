// Evaluation-only projection of the adapter's closed, content-free vocabulary.
const stages = new Set(['extract', 'classify', 'select', 'selectChecklist', 'rank',
  'reconcile', 'qualify', 'qualifyCandidates', 'interpretEpisode', 'relate', 'reviewBasis']);
const phases = new Set(['prepare', 'count_transport', 'count_body', 'count_validation',
  'generation_transport', 'generation_body', 'output_validation']);
const outcomes = new Set(['completed', 'failed', 'aborted']);
const keys = ['version', 'stage', 'phase', 'outcome', 'elapsedMs'];
const capacity = 64;

export function nextPhaseEventCount(count) {
  return Number.isSafeInteger(count) && count >= 0 && count < Number.MAX_SAFE_INTEGER
    ? count + 1 : null;
}

function project(event) {
  if (!event || typeof event !== 'object' || Array.isArray(event)
    || Object.getPrototypeOf(event) !== Object.prototype) return null;
  const own = Reflect.ownKeys(event);
  if (own.length !== keys.length || keys.some(key => !own.includes(key))) return null;
  const value = {};
  for (const key of keys) {
    const descriptor = Object.getOwnPropertyDescriptor(event, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) return null;
    value[key] = descriptor.value;
  }
  return value.version === 1 && stages.has(value.stage) && phases.has(value.phase)
    && outcomes.has(value.outcome) && Number.isFinite(value.elapsedMs)
    && !Object.is(value.elapsedMs, -0) && value.elapsedMs >= 0
    && value.elapsedMs <= 2_147_483_647 ? value : null;
}

export function createMixedPhaseTimingObserver() {
  const ring = new Array(capacity);
  let totalEventCount = 0, retainedEventCount = 0, cursor = 0, closed = false;
  return Object.freeze({
    onPhaseTiming(event) {
      if (closed) return;
      try {
        const value = project(event);
        if (!value) return;
        const next = nextPhaseEventCount(totalEventCount);
        if (next === null) { closed = true; return; }
        ring[cursor] = value;
        cursor = (cursor + 1) % capacity;
        retainedEventCount = Math.min(capacity, retainedEventCount + 1);
        totalEventCount = next;
        if (totalEventCount === Number.MAX_SAFE_INTEGER) closed = true;
      } catch { /* Observation cannot replace a model outcome. */ }
    },
    close() { closed = true; },
    snapshot() {
      const start = retainedEventCount === capacity ? cursor : 0;
      return { version: 1, sample: 'last', capacity, totalEventCount, retainedEventCount,
        omittedEventCount: totalEventCount - retainedEventCount,
        events: Array.from({ length: retainedEventCount }, (_, index) =>
          ({ ...ring[(start + index) % capacity] })) };
    },
  });
}
