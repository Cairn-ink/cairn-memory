# C0a: offline reconciliation authorization primitive

Parent B2 PR #53 at `c8279bb3e55eef8263fdb8d7eecfe942bdc4011c`.
This package prepares a separately authorized experiment transport capability;
it does not grant that authorization or execute paid requests. No actual campaign
ledger, credentials, original evidence, policy binding or existing token is touched.

## R1 — exact separate opt-in

Add `authorizeReconciliationExtension({ledger, policy, extension, authorizationId})`
and `createReconciliationExperimentRequestGuard({ledger, policy, extension,
reconciliationExtension, fetchImpl})` in the existing request-guard module.
`extension` is the existing trusted extraction-extension token. Both functions
require it explicitly and validate it; no ambient token discovery or implicit
provisioning. Unknown/missing/extra fields fail closed with existing fixed errors.

The original baseline and extraction-only constructors retain their exact API
and four-method behavior. Even if a reconciliation file exists, they reject
`cairn_reconcile` count/generation before reservation or I/O. The new combined
constructor enables only baseline `gpt-4.1-mini-2025-04-14` reconcile in addition
to their existing capabilities; alternate extraction models remain extraction-
only. No new model, endpoint, reasoning mode, tool, HTTP method or payload field.

## R2 — immutable durable binding

Provision a distinct `experiment-reconciliation-extension.json`, mode0600,
exclusive creation, file+directory fsync, safe path/no symlink/hardlink, maximum
one-million-byte bounded reader. The record contains version1, bounded opaque
authorizationId, exact ledger configuration and baseline policy, exact existing
extraction token, method `cairn_reconcile`, model DEFAULT_MODEL, and creation
checkpoint `{requestCount,reservedMicroUsd}`. No keys, messages or response text.
Return a detached deeply frozen token; verification compares the expected token
with the file and original binding, not merely existence of a file.

Require the existing baseline 7024 input/1024 generation-output policy and open,
fully settled ledger while holding its existing reservation SQLite writer lock.
Verify the extraction token and checkpoint inside that protected setup. Repeated
setup with the exact same authorization is idempotent without changing counters
or checkpoint; a changed authorization/configuration fails without overwriting.
Never edit the original policy, extraction file, ledger schema, totals or history.
Do not create a new ledger. A failed partial authorization file is retained and
rejected, not repaired/reset automatically.

On construction and every request, verify both immutable tokens/files, original
binding and both settled historical reservation prefixes. Missing, malformed,
unsafe, changed, mismatched, symlinked or rolled-back state rejects before any
new reservation/transport. A matching caller-owned file/token is not proof of
human consent: only an explicitly authorized operator may provision real state.

## R3 — existing transport, accounting and bounds

Reuse existing request snapshot, tokenizer, dynamic schema comparison, request/
response limits, abort/deadline handling, ledger reservation and settlement.
No second request engine or private bypass fetch. Allow reconcile only through
the new capability and exact baseline count/generation channels; use the same
reservations/prices/bounds as that original policy, never lower them.

Require the B2 strict request-scoped schema from serialized model input. Reject
altered schema, unknown methods, alternate judgment model, extra reasoning,
oversized/invalid body, wrong URL/redirect/headers before reservation or I/O.
Core remains responsible for correlated source/authority and semantic checks.

Every accepted count/generation/host/extraction call shares the original durable
request cap and cumulative reservation ceiling, including concurrent guards and
reopening. No refunds for failures, unknown usage or interrupted calls; retain
existing usage-overrun blocking and content-free errors. No retries/fallback.
Constructors and local tokenizer never call a provider. Injected one-attempt
transport is still trusted; this is not a network sandbox or invoice guarantee.

## R4 — verification and delivery

Delegate guard implementation and independent adversarial tests separately.
Tests use only fresh synthetic temporary ledgers and fake HTTP, including actual
OpenAI adapter reconcile count→generation. Verify both old constructors' refusal,
strict combined inputs, wrong/corrupt/missing/swapped tokens, settled checkpoint
and rollback fencing, idempotent setup with unchanged old bytes/counters, exact
baseline routing and per-request reservation, concurrent handles/shared limits,
unsupported request rejection, malformed/unknown usage and abort handling.
An actual-core ordered capture through the combined guard and fake adapter must
complete automatic Friday→Monday historical transition; it is not semantic proof.

Run budget, request-guard, OpenAI, live-evidence offline, generic tests and their
applicable demos on Node22.16/24.15; JSON and pinned Claude validations; diff/link
checks. Freeze candidate, independently review Standards+Spec before push/PR.
Update changelog and guard docs with explicit operator-authorization boundaries.
Do not modify B2's statement that old guards reject reconcile.

## Subsequent C work, not completed here

C0b freezes new positive/negative currentness fixtures, an explicit source-order
adapter for unchanged conversation-history-v1 inputs/scorer, raw history/current
retention, independent labels and installed-artifact lifecycle. No original
failure, rubric or denominator is overwritten. C1 then requires explicit owner
authorization to provision this new capability in the original campaign ledger
and execute one frozen attempt under a stated local request/reservation cap.
Read actual remaining ledger state at that time; the published USD5.382264
remaining checkpoint is not proof of current availability. Never refill USD20.
No merge, release, publication, deployment or private engine changes.

## Offline verification checkpoint

Node22.16.0 and24.15.0 both passed request-guard41/41 (including14 new independent
reconciliation cases), ledger15/15, OpenAI113/113, generic31/31 and JSON validation.
Live-evidence offline passed36 with11 explicit opt-in skips. Budget/request-guard
demos and the OpenAI offline demo passed both runtimes. Pinned Claude2.1.260
marketplace and strict plugin validations, diff checks and changed local-link
checks passed. No core, provider or artifact runtime changes are included.

The actual-core/actual-adapter synthetic automatic update used10 fake HTTP calls
and125 synthetic microUSD of reservations. Additional tests verify both nonzero
authorization checkpoints, mixed Luna extraction/baseline judgment/host accounting,
and an accessor deleting authorization after the initial check but before
reservation. All must retain original counters and reject without unauthorized I/O.
These observations establish offline guard mechanics only, not paid permission,
current vendor pricing, semantic quality or an account-wide invoice cap.
