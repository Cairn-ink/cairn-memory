# Source-basis comparison boundary

The experimental shared-core [source-basis view](source-basis-review.md) remains
nonpersistent and semantically unassessed. This preparation supplies a closed
transport for a later frozen comparison; it does not execute that comparison.

`authorizeBasisModelsExtension({ledger, policy, authorizationId})` explicitly
creates a distinct immutable `experiment-basis-models-extension.json` beside an
existing open, settled ledger. Its capability grants only `cairn_reviewBasis`
for the existing baseline, Luna and Sol on count and generation routes. It does
not modify relation, extraction or any previous grant. Constructors require
that exact existing grant; merely installing code grants nothing.

`createBasisModelLiveSession({ledger, basisModelsExtension, apiKey, fetchImpl})`
is parent-only. Host completions and other methods are denied. The eventual
operator combines it with the separate existing relation-only session, both
using one durable ledger; consumers receive a synthetic key, never the real key.
Exact framing/schema, endpoint, prices, reservation and settlement checks reuse
the [relation model guard](rationale-model-guard.md). Prices are configured
conservative estimates, not provider invoices.

`createBasisComparisonAttempt` has fixed limits: 96 HTTP requests and 2,048,000
microUSD reservations. Count requests consume reservations too. Only relate and
reviewBasis with the three named models are admitted. It requires full remaining
headroom at startup, then validates pins and exact settled ledger deltas around
serialized, recorded sends. Read-only phases cannot send; accounting, pin,
persistence or transport errors halt queued work without retry or refund.
The aggregate ceiling is still at most US$50; a new factory cannot reset it.

The planned 48 slots compare identical source receipts across representation
and model. Manual source admission excludes extraction/retrieval quality. The
new arm should preserve original stored data across cold reopen, not retain
ephemeral proposals. All failed and unrun slots remain in the report. A separate
operator must freeze fixtures, rubric, installed archive and code before any
paid request. No operator, real grant, credential read, paid evidence, persistent
schema or default change is included here.
