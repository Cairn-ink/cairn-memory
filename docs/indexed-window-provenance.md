# Indexed-window provenance in offline LongMemEval evaluation

This is a separately versioned, programmatic evaluation path for the optional
`source-bound-v2` / `indexed-windows-v1` core capture mode. It can recognize an
exact stored receipt from a later canonical source window. It does not alter the
default LongMemEval ingestion, public comparison, official scorer, live runner,
paid guard or installed interface.

The entrypoints are `planIndexedWindowLongMemEvalCase` and
`ingestIndexedWindowLongMemEvalCase` in `evaluation/longmemeval/ingestion.mjs`,
and `runIndexedWindowPublicComparison` in
`evaluation/longmemeval/public-comparison.mjs`. Their option shapes match the
corresponding legacy entrypoints; no policy or validator can be supplied by a
caller. Use an explicitly configured core opened with both
`captureQualification: 'source-bound-v2'` and
`captureSourcePolicy: 'indexed-windows-v1'`. No automatic mode selection occurs.

Planning retains the deterministic source partition, case namespace, capture
client, event/message IDs, raw UTF-16 source map and original date/role. For each
batch it snapshots the exact submitted capture input in the indexed policy
domain before a callback, records that domain's payload digest, and builds the
core's bounded, host-derived window catalog from the normalized/redacted
snapshot. The plan has schema
`cairn-longmemeval-indexed-window-ingestion-plan-v1` and explicitly identifies
the qualification and source policy. A catalog failure adds
`indexed_window_preflight_failed` and blocks the entire case before any capture
callback; it does not shorten, rebatch, retry or fall back to prefix mode.
This is structural preparation, not proof that model input fits a provider
context window or that a later source fact will be extracted.

Every indexed success response—including duplicate and processing—must carry
the exact five-field `sourceWindowCatalog` metadata for that submitted batch.
The new ingestion path checks its shape and values before accepting its ordinary
status. Failure responses keep the closed legacy failure envelope and cannot
carry success metadata. A duplicate reports the submitted view, not evidence
that an earlier extraction used the same windows. Incomplete, partial and
unknown outcomes stop later batches and remain in the report denominator.
Both plans and outcomes contain private source-bearing data; they are not safe
telemetry.

The indexed comparison has schema
`cairn-longmemeval-indexed-window-public-comparison-v1` and explicitly records
the capture mode and `semanticCoverage: 'unassessed'`. It still requires a
pristine namespace, current active memories with matching revisions, an
exhaustive authoritative `get`, and matching source client/session/message/role
and receipt IDs. For this path only, a stored receipt excerpt must exactly equal
a canonical catalog window for that same source message. Arbitrary substrings,
joined windows, forged offsets and generated memory paraphrases are not answer
evidence. Repeated equal text within one source shows membership only; it does
not establish a unique raw occurrence or offset. Candidate fields sent to the
answer callback remain the legacy source-only fields.

The comparison preserves the existing answer templates, three-arm order,
counting, packing, deadlines and prior-timeout stop behavior. Source dates are
metadata; capture remains source-time-unaware. The official scorer intentionally
rejects the new report schema before calling a judge. This synthetic offline
integration is **not** a balanced paid comparison, an indexed-window quality
gain, a public benchmark result, or authorization to run a live provider. A
later protocol must freeze qualified-prefix versus qualified-window controls
and shared spend/resource ceilings before any scored claim.

Synthetic verification uses `npm run test:longmemeval`, including a real core
capture followed by a cold reopen, recall/get and answer-request inspection.
All test data are made locally; no LongMemEval corpus, keys or operator ledger
are read.
