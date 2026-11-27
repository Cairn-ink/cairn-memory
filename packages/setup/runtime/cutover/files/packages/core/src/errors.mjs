// Error kinds and codes shared by core and every adapter.
// A CoreError message is its code only: never user text, hashes, keys, ids or SQL.

/** @type {readonly ["invalid_input", "not_found", "conflict", "paused", "denied", "unavailable", "retryable", "limit", "internal"]} */
export const ERROR_KINDS = Object.freeze([
  "invalid_input", // caller sent something malformed; do not retry
  "not_found", // the target does not exist for this owner (or is already forgotten)
  "conflict", // revision or state conflict; re-read then retry at the caller's choice
  "paused", // capture is paused for this owner
  "denied", // a privacy rule refuses the operation (suppressed, fenced, ineligible)
  "unavailable", // a required capability, key or index is not available; fail closed
  "retryable", // transient storage or provider failure; safe to retry the same request
  "limit", // a bounded operation exceeded its limit; retrying the same input fails again
  "internal", // a bug or an unexpected state
]);

/**
 * Every code an adapter or core may raise, with its kind. Adapters map their native
 * failures onto these codes; they never invent new ones without a Phase 0 change.
 */
export const ERROR_CODES = Object.freeze({
  invalid_input: "invalid_input",
  invalid_cursor: "invalid_input",
  invalid_window: "invalid_input",
  invalid_model_output: "invalid_input",
  not_found: "not_found",
  revision_conflict: "conflict",
  memory_conflict: "conflict",
  memory_historical: "conflict",
  cursor_stale: "conflict",
  snapshot_stale: "conflict",
  fact_conflict: "conflict",
  capture_paused: "paused",
  capture_evidence_closed: "paused",
  suppressed: "denied",
  session_blocked: "denied",
  lineage_fenced: "denied",
  ineligible: "denied",
  authority_required: "denied",
  fingerprint_unavailable: "unavailable",
  fingerprint_key_mismatch: "unavailable",
  raw_lineage_unavailable: "unavailable",
  local_raw_hide_anchor_missing: "unavailable",
  index_unavailable: "unavailable",
  capability_unavailable: "unavailable",
  model_unavailable: "unavailable",
  host_write_hook_failed: "unavailable",
  commit_outcome_unknown: "unavailable",
  storage_busy: "retryable",
  storage_error: "retryable",
  provider_error: "retryable",
  embedding_failed: "retryable",
  lineage_closure_limit: "limit",
  response_too_large: "limit",
  rate_limited: "limit",
  internal_error: "internal",
  // Retained engine codes
  event_payload_conflict: "conflict",
  stale_admission: "conflict",
  generation_conflict: "conflict",
  memory_suppressed: "denied",
  memory_not_found: "not_found",
  storage_transaction_active: "internal",
  // Retained hosted codes
  lock_timeout: "retryable",
  statement_timeout: "retryable",
  database_error: "internal",
  ingest_inputs_changed: "retryable",
  capture_disabled: "denied",
  // Retrieval
  context_item_too_large: "limit",
  // Capture (engine envelope: none of these are retryable)
  invalid_text: "invalid_input",
  extraction_failed: "unavailable",
  source_excluded: "denied",
  context_budget_exceeded: "limit",
  evidence_unavailable: "denied",
  model_not_configured: "unavailable",
  model_timeout: "unavailable",
  model_cancelled: "unavailable",
  token_count_unavailable: "unavailable",
  qualification_failed: "unavailable",
  reconciliation_failed: "unavailable",
  classification_failed: "unavailable",
  rationale_failed: "unavailable",
  rationale_limit: "limit",
  // Memory policy
  conflict_limit: "limit",
  supersession_limit: "limit",
  invalid_ref: "invalid_input",
  // Topics
  moc_title_conflict: "conflict",
});

/** @param {unknown} code @returns {code is keyof typeof ERROR_CODES} */
export function isErrorCode(code) {
  return typeof code === "string" && Object.hasOwn(ERROR_CODES, code);
}

const RETRYABLE_KINDS = new Set(["retryable"]);

export class CoreError extends Error {
  /** @param {keyof typeof ERROR_CODES} code */
  constructor(code) {
    if (!isErrorCode(code)) throw new TypeError("unknown_error_code");
    const kind = ERROR_CODES[code];
    super(code);
    this.name = "CoreError";
    this.code = code;
    this.kind = kind;
    this.retryable = RETRYABLE_KINDS.has(kind);
  }
}

/** @param {unknown} error */
export function isCoreError(error) {
  return error instanceof CoreError;
}

/**
 * Wraps any thrown value into a CoreError without copying its message.
 * Order: a CoreError passes through; an error whose own `code` is a known code keeps it;
 * an adapter's explicit native-code map applies next; anything else becomes `fallback`
 * (internal_error by default). Adapters MUST pass a tested map for their native codes, and map
 * only known-transient native codes (lock/serialization/connection failures) to retryable kinds.
 * @param {unknown} error
 * @param {Readonly<Record<string, keyof typeof ERROR_CODES>>} [nativeMap]
 * @param {keyof typeof ERROR_CODES} [fallback]
 */
export function toCoreError(error, nativeMap = {}, fallback = "internal_error") {
  if (error instanceof CoreError) return error;
  const code = error && typeof error === "object" && Object.hasOwn(error, "code") ? /** @type {{code: unknown}} */ (error).code : undefined;
  if (isErrorCode(code)) return new CoreError(code);
  if (typeof code === "string" && Object.hasOwn(nativeMap, code) && isErrorCode(nativeMap[code])) return new CoreError(nativeMap[code]);
  return new CoreError(fallback);
}
