// Qualification policy only. Keep errors distinct from incomplete upkeep.
export function classifyDaemonIdle({ result, rawIndex, rawReadCoverage, deadlineReached = false }) {
  const rebuilding = !result.ok && result.error?.code === 'index_unavailable' &&
    ['rebuilding', 'missing'].includes(result.error.details?.coverage?.maintenance?.state);
  if (!result.ok && !rebuilding) throw Error('qualification_upkeep_failed');
  const coverage = result.ok ? result.value.coverage : result.error.details.coverage;
  const rawComplete = rawIndex === undefined ? rawReadCoverage === 'included' : rawIndex.coverage === 'complete';
  const memory = coverage?.byType?.memory;
  const idle = !rebuilding && coverage?.maintenance?.state === 'ready' && Number.isSafeInteger(memory?.eligible) && memory.indexed === memory.eligible && rawComplete;
  return { idle, report: idle || deadlineReached, exitCode: idle ? 0 : deadlineReached ? 2 : null, coverage };
}
