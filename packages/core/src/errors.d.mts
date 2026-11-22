export type ErrorKind =
  | "invalid_input" | "not_found" | "conflict" | "paused" | "denied"
  | "unavailable" | "retryable" | "limit" | "internal";

export declare const ERROR_KINDS: readonly ErrorKind[];

export type ErrorCode =
  | "invalid_input" | "invalid_cursor" | "invalid_window" | "invalid_model_output"
  | "not_found"
  | "revision_conflict" | "memory_conflict" | "memory_historical" | "cursor_stale" | "fact_conflict"
  | "capture_paused" | "capture_evidence_closed"
  | "suppressed" | "session_blocked" | "lineage_fenced" | "ineligible"
  | "fingerprint_unavailable" | "fingerprint_key_mismatch" | "raw_lineage_unavailable"
  | "local_raw_hide_anchor_missing" | "index_unavailable" | "capability_unavailable" | "model_unavailable"
  | "commit_outcome_unknown"
  | "storage_busy" | "storage_error" | "provider_error" | "embedding_failed"
  | "lineage_closure_limit" | "response_too_large" | "rate_limited"
  | "internal_error"
  | "event_payload_conflict" | "stale_admission" | "generation_conflict"
  | "memory_suppressed" | "memory_not_found" | "storage_transaction_active"
  | "lock_timeout" | "statement_timeout" | "database_error" | "ingest_inputs_changed" | "capture_disabled"
  | "context_item_too_large" | "conflict_limit" | "supersession_limit" | "invalid_ref"
  | "extraction_failed" | "source_excluded" | "context_budget_exceeded" | "evidence_unavailable"
  | "model_not_configured" | "model_timeout" | "token_count_unavailable"
  | "qualification_failed" | "reconciliation_failed" | "classification_failed";

export declare const ERROR_CODES: Readonly<Record<ErrorCode, ErrorKind>>;

/** The message is the code only. */
export declare class CoreError extends Error {
  constructor(code: ErrorCode);
  readonly name: "CoreError";
  readonly code: ErrorCode;
  readonly kind: ErrorKind;
  readonly retryable: boolean;
}

export declare function isCoreError(error: unknown): error is CoreError;
export declare function isErrorCode(code: unknown): code is ErrorCode;
/** CoreError passes through; an own known `code` is kept; then the adapter's native map; else fallback. */
export declare function toCoreError(error: unknown, nativeMap?: Readonly<Record<string, ErrorCode>>, fallback?: ErrorCode): CoreError;
