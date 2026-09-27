# Paired ingestion semantic probe

Status, 2026-09-28: the separately reviewed paid short-source probe is complete;
[the report](../../docs/evidence/ingestion-semantic-probe.md) and
[sanitized results](results.json) retain both repetitions, original blind agent
ratings and adjudication. Decision: do not adopt combined. Useful coverage 18/24
was below baseline 19/24 despite lower request work. Same-model-family judgments
are not human labels, and repeated scenarios are not independent questions.
No engine or default changes; overall reliability and prior capacity limits
remain unresolved. The public artifact excludes raw HTTP bodies and provider,
transport and campaign identifiers; its random local blind aliases are safe
synthetic evaluation references.

This experimental library runs twelve supplied frozen synthetic scenarios twice
through each ingestion arm. It has no CLI, credential/environment lookup, corpus
loader, ledger creation, persistence/admission, retrieval, or model invocation
on import. The [acceptance contract](../../docs/plans/ingestion-semantic-probe.md)
records the original prospective protocol and completed result. Offline tests
establish containment and
plumbing only; they are not semantic results or permission for paid calls.

Baseline uses the actual source-bound-v2 snapshot, `callModel`, current OpenAI
adapter with adaptive text catalog/partition fit, `extractedItems`, and
`qualifyCandidateItems`. Combined uses the unchanged design-stage
`prepareCombined`, prompt/schema and `compileCombined`. Both receive the same
retained source window. Neither module imports the rubric or scripted oracle.
The two decompositions still expose evidence differently during qualification.

The operator creates an existing-only transport with
`createIngestionSemanticTransport({ configuration, checkpoint, historySha256,
apiKey, onRecord, fetchImpl? })`. `configuration` is the existing v2 campaign
ledger configuration; `checkpoint` has `requestCount` and `reservedMicroUsd`.
The exact initial history hash and checkpoint must match under the existing
bound ledger's transaction. Pending rows, foreign writes and budget failures
fence the run. The library creates no campaign and cannot reset or refund one.

Then call `runIngestionSemanticProbe({ fixtures, transport, onArm? })`. Fixtures
are the separately frozen source-only twelve-case array. Order alternates with
scenario index and repetition. Every started attempt returns status, stage,
compiled items, latency and its sanitized HTTP records; ordinary failures keep
their place among the 24 attempts per arm. No retry or replacement is performed.

The private operator launcher must freeze its manifest and create its one-shot
start marker **before reading a key or using network**, supply a synchronous
`onRecord` callback that durably stores each reservation/request and settled
response, and persist each `onArm` result. The `onRecord` callback must return `undefined`;
record persistence failure is fatal. Records contain bodies, HTTP status,
usage, conservative cost and timing, never raw headers or credentials. Partial
response bodies are retained up to the response-byte limit with
`responseTruncated: true`; a complete body sets it false. Credential echo,
including decoded JSON escapes, fails fatally before releasing the body to a
compiler. The operator must catch terminal errors and record unfinished frozen
attempts as not run, rather than silently shrinking the planned denominator.
Close the transport in the launcher's `finally` block.

Each arm explicitly binds its source and expected method. The guard reconstructs
baseline count/generation bodies by capturing the unchanged adapter serializer
through synthetic HTTP; this makes prompt, schema and body acceptance exact,
without maintaining a second serializer. Qualification candidates must come
from that arm's actual extracted receipts. It accepts a whole group once or
distinct core singleton groups, preserving global candidate indices. Combined
is explicitly named `evaluation_combined_v1`, never a production method.
Only POST to the fixed OpenAI `/v1/responses/input_tokens` and `/v1/responses`
endpoints is allowed, with redirects disabled. A successful bounded count grants
one matching generation; a failed count grants none. Body mutation, extra
tools/fields, foreign sources, duplicate dispatch and concurrent calls are denied.

Input limits remain 6,000 local / 7,024 provider tokens and 1,024 output tokens.
Each dispatched HTTP attempt first reserves 4,448 microUSD. Known valid
generation usage is settled at the uncached ceiling, rounded upward:
`ceil((input_tokens * 4 + output_tokens * 16) / 10)` microUSD. This follows the
pinned model's USD0.40/1.60 per million input/output rates and does not assume a
cache discount. Counts and missing/invalid usage remain unknown and retain the
reservation; reservations and observed costs are separate evidence. A known
cost above the reservation is an accounting anomaly and stops all work.
The probe is capped at US$3 reserved and 576 HTTP attempts, with 30 seconds per
call, 180 seconds per arm and 90 minutes for the probe. Response bodies are
bounded to 65,536 count / 262,144 generation bytes. Fetch and reader waits race
abort even when an injected transport ignores cancellation.

Malformed, refused, incomplete or oversized output, a bounded failed count,
ordinary non-authentication HTTP error, and an arm deadline produce failed
attempts without partial compiled output. Network failures, redirect/auth
anomalies, credential echo, request/lifecycle violations and accounting or
persistence failures stop the entire probe. The runner checks the guard's
independent fatal latch after saving the arm row because core model calls
deliberately hide untrusted provider errors. Results project final ledger
aggregates/hash only; historical campaign attempts are not included.

Arm latency is instrumented end-to-end time and includes baseline guard's
additional local serializer capture/tokenization. Report HTTP-record durations
separately; they measure guarded transactions including body reading/validation
and the pre-dispatch persistence callback, not isolated server latency. Neither
measure is a production latency benchmark or fair evidence of speed superiority.

Run `node --test adapters/openai/test/ingestion-semantic.test.mjs` with the locked
isolated OpenAI dependencies installed. The focused tests use fresh synthetic
v2 ledgers, fake HTTP and the actual core, including five real singleton
qualification partitions. That partition fixture deliberately fails the
unchanged combined fit ceiling; the test retains that failure. Run the full
OpenAI suite, root `npm test`, and `npm run validate` on Node22.16 and24.15.
No test reads a provider key, operational ledger or external corpus. Blind
semantic ratings, source entailment, usefulness and cost/result interpretation
remain separate operator work after any explicitly authorized paid experiment.
