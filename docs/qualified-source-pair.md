# Qualified source-pair generation (offline)

`qualifiedSourcePairProtocol` and `runQualifiedSourcePair` in
`evaluation/longmemeval/public-comparison.mjs` compare two source exposures:
qualified first-prefix receipts and qualified indexed-window receipts. Both use
`source-bound-v2` qualification, the same prepared-v2 history/question,
namespace, V2 answer instruction, declared answer model and four limits. This
is a two-arm generation interface, not the legacy three-arm comparison, an
official score or a paid-run capability.

The pure protocol helper accepts exactly `{history, question, namespace,
answerModel, limits, armOrder}`. The runner additionally requires exactly
`{cores, answer, countTokens, execution}`. `cores` is exactly
`{qualifiedPrefix, indexedWindows}`; each core exposes `list`, `capture`,
`recall`, `get` and must be a different object. Configure the first core with
`captureQualification: 'source-bound-v2'` and no indexed policy, and the second
with `captureQualification: 'source-bound-v2'` plus
`captureSourcePolicy: 'indexed-windows-v1'`. For an actual experiment, use
separate fresh physical stores too: distinct core objects do not guarantee
isolation. The runner checks each namespace for active memories at execution
time, but cannot attest that a store was never used.

`armOrder` is exactly one permutation of `['qualified-prefix',
'indexed-windows']`. The report always lists arms in that canonical order,
while `attemptedOrder` records scope callbacks actually entered. A later
campaign must balance order across cases. The protocol binds the shared raw
source turns and ordered source maps, each arm's actual plan schema and capture
payload digests, declared settings and deterministic case-scope IDs. SHA-256
uses UTF-8 JSON of a domain and recursively key-sorted plain-object value;
array order is preserved. Neither protocol digest nor plan metadata authenticates
an arbitrary callback, its model configuration, source origin or a corpus.
Later scoring needs a separately trusted expected protocol or roster binding.

The execution port has exactly `withCaseScope` and `isHalted`. It enters
`{phase:'generation', caseId:scopeId}` once per arm, sequentially. The scope
handle must report matching `case-deadline-scope-v1` identity and an active
status before work. A local `timed_out`/`blocked` scope records an arm timeout
only while the global guard stays live. A global halt, invalid scope contract or
scope-wrapper failure emits a finite `halted` report, preserves any earlier arm
and blocks later work; it cannot resume or retry. The runner checks scope and
global state around core, count and answer callbacks and closes its local
callback fence when the scope returns. This does not sandbox arbitrary direct
fetches, cancel already-running injected functions or impose a total arm
wall-clock deadline. The future shared guard must own request accounting and
all generation scopes followed by matching scoring scopes in one schedule.

Each arm ingests only completed batches under its own policy, then checks
current active recall against exhaustive authoritative `get` receipts. Prefix
excerpts must equal the actual host-derived retained message; indexed excerpts
must equal a catalog window for the same message. Client, session, message,
role, namespace, revision and globally unique receipt IDs are enforced.
Memory prose, arbitrary substrings, concatenations, source labels and reference
answers never become answer evidence. Whole candidate items are packed under a
synchronous local token estimate, with candidate/selected/omitted counts and
retrieved/packed source-session IDs. The question and output also face the
same ceilings; this estimate is not provider-fit proof. Callback usage reports
answer work only, not extraction, recall, counting, scoring or total spend.

The report schema is `cairn-longmemeval-qualified-source-pair-v1` with the
embedded `cairn-longmemeval-qualified-source-pair-protocol-v1`, both canonical
arms, finite halt reason and `semanticCoverage: 'unassessed'`. The old official
scorer rejects this schema before a judge call. The separate strict offline
scorer below now accepts it; fully guarded transport, a fresh frozen roster
and resource caps remain required before any paid comparison or answer-quality
claim. Source dates are
metadata; capture is still source-time-unaware. Repeated identical window text
proves catalog membership, not a unique raw offset or semantic support.

Synthetic tests exercise both orders, separate stores and a cold reopen,
shared-store refusal, source-only answer requests, exact protocol digests and
halt/fence failures. They use no downloaded LongMemEval corpus, provider key
or operator ledger.

## Separate official-style scoring (offline)

`scoreQualifiedSourcePair` and `aggregateQualifiedSourceScores` in
`evaluation/longmemeval/qualified-source-scoring.mjs` accept only this
two-arm protocol. The scorer requires a separately trusted `expectedProtocol`,
the exact N report, its evaluator record, a judge callback (or explicitly
`undefined`), `judgeTimeoutMs` and the same `withCaseScope`/`isHalted` execution
port. An optional evaluator-bound reference-rendering capability preserves the
pinned Python text for numeric/list references. The protocol's own digest is
checked but is not a signature or a substitute for that independent binding.
The old three-arm scorer and aggregate still reject N/P reports.

Scoring enters the two matching scope IDs in `protocol.armOrder`, phase
`scoring`, after all generation scopes. It reuses the pinned upstream official
prompt, request and parser, including the parser's substring-`yes` behavior.
No reference answer or evaluator labels go to generation. Failed generation,
unverified non-string references and absent judges still consume their scoring
scope slots without a judge request. A generation-wide halt skips scoring.
Within a valid live scope, a failed generation keeps its original failure
reason even if that scope is locally timed out; a completed generation's local
timeout takes precedence over compatibility or missing-judge outcomes.
Contract failure, global halt or wrapper exit failure blocks later scoring;
already exited judgments remain. The `attempted` bit records actual judge
invocation, not scope entry. The backup judge timeout aborts locally but does
not prove transport settlement; a future actual guard must own every request,
deadline and late response.

The scorer emits `cairn-longmemeval-qualified-source-scoring-v1` with exact
two-arm judgments, safe finite reasons and source-session overlap diagnostics,
not raw answers, references or judge text. Session overlap is not proof of
semantic support or causality. The separate
`cairn-longmemeval-qualified-source-aggregate-v1` uses a fixed nonempty roster:
missing or unresolved cases stay in each arm's denominator. Accuracy divides
by resolved cases, coverage by the fixed roster, and fixed-N lower/upper bounds
place unresolved cases as all wrong/all correct; they are not confidence
intervals. The common paired denominator includes only cases where both arms
resolve. Six-type macro accuracy appears only for six present, fully resolved
types. Synthetic real-N, Python sidecar and fake-HTTP guard tests establish
schema/scheduling/accounting interoperability, not model accuracy, balanced
roster outcomes, a new capture grant, or paid authorization.
