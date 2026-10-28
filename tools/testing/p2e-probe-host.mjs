// Synthetic authority for a public capabilities probe. No semantic/provider
// ports are supplied, and no credentials or fixture contents are logged.
export function createContextReadHost(configuration) {
  return { authorize(request) {
    return request.method === 'getContextIndexStatus' || request.method === 'findCandidates'
      || request.method === 'contextRead' || request.method === 'fetchCandidateEvidence' ? configuration.requestBinding : null;
  }, isCurrent() { return true; } };
}
