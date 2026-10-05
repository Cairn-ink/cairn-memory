// Plain synthetic observation only; deliberately carries no runtime identity.
export function syntheticHttpClientFailure() {
  return { version: 1, layer: 'runtime', reason: 'native_http_invalid', httpClientError: {
    version: 1, code: 'HPE_INVALID_HEADER_TOKEN', connectionOrdinal: 2, requestCount: 1,
    connectionRequestCount: 0, phase: 'headers', stopping: false, scopeStatus: 'active',
    connectionAgeMs: 0, sinceLastResponseMs: 1,
  } };
}
