// Every automatic write goes through the service. A status read alone never
// acknowledges an admission because it lacks the session and payload binding.
export async function dispatchCapture(service, scope, selection, message, signal, recovering) {
  try {
    signal.throwIfAborted();
    const admission = await service.enqueueCapture(scope, { ...selection, messages: [message] });
    if (admission.status === 'paused') return { status: 'blocked', reason: 'authority_changed' };
    if (admission.status === 'blocked') return { status: 'blocked', reason: 'capture_refused' };
    if (!['accepted', 'duplicate'].includes(admission.status)) return { status: 'blocked', reason: 'capture_refused' };
    const prior = recovering && await service.captureStatus(scope, selection.eventId, { client: selection.client });
    if (prior?.status === 'failed' && ['capture_paused', 'capture_disabled', 'capture_evidence_closed'].includes(prior.code)) {
      return refusal(prior.code);
    }
    signal.throwIfAborted();
    const outcome = await service.runCapture(scope, selection, { signal });
    if (outcome.status === 'done' && (outcome.result || outcome.code)) {
      return { status: 'done', ...(outcome.code && { code: outcome.code }) };
    }
    if (outcome.status === 'processing' || outcome.status === 'duplicate') return { status: 'processing' };
    if (outcome.status === 'paused') return { status: 'blocked', reason: 'authority_changed' };
    return refusal(outcome.code);
  } catch (error) {
    if (signal.aborted) return { status: 'blocked', reason: 'cancelled' };
    return refusal(error.code);
  }
}

function refusal(code) {
  if (code === 'storage_busy' || code === 'commit_outcome_unknown') return { status: 'busy' };
  if (['capture_disabled', 'capture_paused', 'capture_evidence_closed', 'revision_conflict'].includes(code)) {
    return { status: 'blocked', reason: 'authority_changed' };
  }
  return { status: 'blocked', reason: 'capture_refused' };
}
