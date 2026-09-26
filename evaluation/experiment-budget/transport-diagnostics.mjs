// Private, content-free case-deadline transport observation. No caller hook.
const SCHEMA = 'cairn-transport-phase-diagnostics-v1';
const CAPACITY = 256;
const MAX_MS = 2_147_483_647;
const ROUTES = new Set(['count', 'generation', 'answer', 'judge']);
const METHODS = new Set(['extract', 'classify', 'select', 'rank', 'unknown']);
const TERMINATIONS = new Set(['response', 'http_failure', 'invalid_response',
  'core_deadline', 'transport_deadline', 'external_abort', 'transport_failure',
  'body_failure', 'other_failure']);
const OUTCOMES = new Set(['succeeded', 'failed', 'unknown']);

const elapsed = (start) => {
  const value = performance.now() - start;
  return Number.isFinite(value) ? Math.min(MAX_MS, Math.max(0, value)) : null;
};
const freezeSnapshot = (value) => {
  for (const row of value.observations) Object.freeze(row);
  Object.freeze(value.observations);
  return Object.freeze(value);
};

export function createTransportDiagnosticsCollector() {
  let current = null;

  function closeScope() {
    if (!current || !current.open) return;
    current.open = false;
    for (const row of current.rows) {
      if (row.termination === null) row.termination = 'other_failure';
    }
  }

  function openScope(scopeOrdinal, phase) {
    if (!Number.isSafeInteger(scopeOrdinal) || scopeOrdinal < 0
      || !['generation', 'scoring'].includes(phase)) throw new Error('invalid_transport_scope');
    closeScope();
    current = { scopeOrdinal, phase, total: 0, dropped: 0, rows: [], open: true };
  }

  function start(route, method = 'unknown') {
    if (!current?.open || !ROUTES.has(route) || !METHODS.has(method)) {
      throw new Error('invalid_transport_observation');
    }
    const scope = current;
    const startTime = performance.now();
    const row = { scopeOrdinal: scope.scopeOrdinal, phase: scope.phase,
      attemptOrdinal: scope.total, route, method,
      fetchEnteredMs: null, responseAvailableMs: null, bodyCompleteMs: null,
      settledMs: null, termination: null, accountingOutcome: null };
    scope.total = Math.min(Number.MAX_SAFE_INTEGER, scope.total + 1);
    if (scope.rows.length === CAPACITY) { scope.rows.shift(); scope.dropped += 1; }
    scope.rows.push(row);
    const mark = (field) => {
      if (scope.open && current === scope && row.termination === null && row[field] === null) {
        row[field] = elapsed(startTime);
      }
    };
    return Object.freeze({
      fetchEntered() { mark('fetchEnteredMs'); },
      responseAvailable() { mark('responseAvailableMs'); },
      bodyComplete() { mark('bodyCompleteMs'); },
      settle(termination, accountingOutcome = null) {
        if (!scope.open || current !== scope || row.termination !== null) return;
        row.settledMs = elapsed(startTime);
        row.termination = TERMINATIONS.has(termination) ? termination : 'other_failure';
        row.accountingOutcome = OUTCOMES.has(accountingOutcome) ? accountingOutcome : null;
      },
      finalize() {
        if (!scope.open || current !== scope || row.termination !== null) return;
        row.termination = 'other_failure';
      },
    });
  }

  function snapshot() {
    if (!current) return null;
    return freezeSnapshot({ schemaVersion: SCHEMA, scopeOrdinal: current.scopeOrdinal,
      phase: current.phase, total: current.total, dropped: current.dropped,
      observations: current.rows.map((row) => ({ ...row })) });
  }

  function invalidate() { current = null; }

  return Object.freeze({ openScope, closeScope, start, snapshot, invalidate });
}
