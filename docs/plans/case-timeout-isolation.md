# Prospective case-timeout isolation

Status: acceptance frozen before implementation. User explicitly authorized the
new policy on 2026-09-22. Fixed implementation base for slice G:
`e1dc7a2d20ee896707431d60d444bcc743a41555` (PR195). Existing main was inspected
at `83a10c3b7664b1f67485a19e7d84d24dcb3041a5`; dependent branches are permitted.

Goal: a lightweight reliable memory layer with an honest measurable benchmark.
This policy prevents a recognized timeout in one prospective benchmark case
from automatically discarding every other preselected case. It is not a memory
quality fix, retry policy, production deadline change or new spending grant.
The old halted v2 run and its seventh slot must not be resumed/retried/relabelled.

## Sequence and ownership

1. G — one-shot authorized guard with case/phase isolation; implementation Sol/high.
2. R — public pilot/session/CLI integration, policy identity, failure artifacts,
   resume/merge separation and end-to-end tests on the accepted G candidate.
3. Freeze a new roster and protocol before any scored call, review methodology,
   verify actual remaining cumulative ledger and one-attempt transport, then
   execute only within the already authorized US$50/5,000-request campaign.
4. Retain every failure, publish denominators/coverage/cost separately from
   semantic accuracy; inspect remaining product shortcomings from that evidence.

Primary owns architecture, acceptance, direct verification, fixed commits and
independent Standards/Spec review. No merge, publication or deployment is part
of G/R delivery. No paid/provider call, real key, corpus inspection or existing
campaign-ledger mutation belongs to G/R implementation/tests. Record actual
delegation models; costs/timing unavailable from runtime must stay unknown.

## G acceptance — minimal trusted guard primitive

### G1: Default preservation and explicit new capability

All existing constructors, errors, request bytes, attempt shapes, model/token/
timeout/price bounds and whole-run halt behavior remain unchanged by default.
Add a separate authorizer/factory for `case-deadline-v1`; no existing benchmark
file is retrofitted and no presence of a file implicitly enables the policy.
Neither ordinary memory clients nor default benchmark sessions opt in.

The operator supplies the existing benchmark token, ledger/policy, a bounded
new execution ID, authorization ID, exact expected checkpoint and an ordered
schedule of `(phase, caseId)` entries: all generation cases, then their scoring
entries in identical order. Duplicate/reordered/unknown entries fail closed.
New cases retain source-free opaque IDs; no question/evidence content is stored.
Use bounded ASCII identifiers, existing safe binding writers/checks, detached
frozen snapshots and exact-key validation. Snapshot caller fields once.

### G2: New-run baseline and one-shot use, never budget reset

Authorize under the existing SQLite writer lock against an open fully settled
ledger; checkpoint counters must match exactly. The immutable new binding pins
the entire historical attempt prefix (including its outcomes/costs, via a
canonical digest), original limits, benchmark token/policy and schedule.
Historical terminal `unknown` attempts are allowed ONLY as pinned, already
charged history: the actual campaign has such entries, so forbidding all old
unknowns is not an acceptable implementation. Null/unsettled or overrun refuses.

Identical provisioning is idempotent; mismatched/partial/symlink/unsafe binding
refuses without overwrite or repair. Guard construction exclusively consumes
a durable run-specific mode-0600 claim before any provider work. A second guard,
restart or crash cannot consume it again, even with zero requests or an edited
pilot checkpoint. No automatic deletion, refund, replenishment, ledger copying,
schema migration, global allowance change or generic clear/reset API.

Implementation may use a bounded execution-ID-derived binding/claim filename
beside the existing ledger. Preserve all existing files. Document the same
operator-controlled-file threat boundary as existing guards, not protection
against a malicious same-user process replacing both tokens and files.

### G3: Recognize deadlines without trusting error strings

In `core/model-call.mjs`, mark only signals aborted by its actual existing
30,000ms timer in a module-private WeakSet immediately before abort. Expose a
read-only internal predicate, not a public core barrel/exported setter. Do not
change timing, results, method behavior or signal propagation. Brand identity
cannot be supplied by source text, a diagnostic callback, reason string or a
caller-created AbortController.

Only (a) an external abort with that exact genuine core-deadline signal or
(b) the benchmark guard's own elapsed transport timer can be a case timeout.
Record the first actual termination cause before settlement; do not relabel
transport errors, malformed/oversized/invalid responses, token-bound failures,
arbitrary cancellation or forged diagnostic/error/reason as a timeout just
because the signal later aborts. All other uncertain failures remain global.
Defaults retain their old behavior even for a branded timeout.

### G4: One session, closed case scopes, irreversible failed case

Provide a guard-owned async case-scope entrypoint on the new factory only.
Freeze the complete case/phase order in its capability, not per fetch. There
is at most one active scope and one paid request in flight. Each send is bound
to that scope using async-local identity; no out-of-scope/closed/old callback
may reserve or send in a later scope. Generation permits Cairn/answer routes;
scoring permits judge only. No arbitrary case names, revisiting, phase jump,
concurrent scope/send, cloning token or free-form unhalt may grant work.

A recognized timeout seals that case permanently, denies all remaining sends
in that case (including its later scoring scope), and retains its full unknown
reservation with null actual cost. The timeout never becomes success because
a reply arrives late. Read-only scope/timeout snapshots let the runner persist
the case failure; they must contain only fixed enum/IDs/phase and no raw errors.

The scope operation must encompass durable artifact/checkpoint writes. Only
normal operation completion, zero in-flight requests and exact ledger
reconciliation allow the next scheduled scope; operation/persistence exception
is globally fatal. The guard does not silently persist benchmark files itself.
Scoring entries for failed cases may execute a no-send blocked-artifact write,
but can never call a provider. Case halt and sticky global halt are distinct;
legacy `isHalted()` semantics remain unchanged, and the new API documents both.

### G5: Ledger and safety anomalies stay globally fatal

At construction, before reservation and at case boundary, compare the pinned
historical prefix plus this guard's exact owned attempts with the durable
ledger (IDs, channel, reservation, outcome, actual cost, totals and state).
Foreign settled or unsettled attempts, edits to old history, missing records,
settlement failure, overrun, binding changes or inconsistent accounting cause
sticky global halt and no further paid sends. Reservations never decrease.
Preserve existing single-operator race limitations; do not claim multi-process
isolation from two separate check/reserve transactions.

Private opt-mode accounting may add only a bounded termination enum and case/
phase attribution, with corresponding privacy documentation. Ordinary attempt
objects and public core results remain unchanged. Late replies cannot resettle,
write memory, clear global halt, change case attribution or add reservations.

### G6: Required evidence and integration contract

Tests use fresh synthetic ledgers/stores and fake HTTP only. Demonstrate a
meaningful pre-implementation RED for the new explicit API/behavior (not a
missing-import failure), then GREEN. Cover real core -> adapter -> new guard
timeout -> persisted-boundary simulation -> next preselected case success;
nonzero count delay and timely positive control; default guard still halts;
forged reason/code/diagnostic and ordinary abort remain global; native fetch and
body-read timeouts isolate only when their timer owns termination; malformed/
oversized/count-overlimit/usage errors and settlement/foreign-ledger anomalies
stay global; concurrency, delayed/old callbacks, double consumption, unsafe
bindings, historical unknown baseline, restart/crash and repeated case/phase.

Verify the next-case invariant by exact provider-call counts, immutable failure
and reservation records, unchanged prior memory/case state, and zero sends for
all denials. Use virtual timers for deadlines. At least one real-core path
must prove a late reply cannot admit after the next case starts.

Run focused and full request-guard, budget, core, OpenAI and live-offline suites,
their relevant offline demos, generic tests and JSON/plugin validation on Node
22.16 and 24.15; no TypeScript gate exists. Update the explicit request-guard test
script so CI exercises the new tests. Primary reruns critical/full gates and
both independent reviewers inspect the same final committed candidate.

### Pre-implementation design clarifications

Independent Sol/high design inspection identified ambiguities resolved before
implementation acceptance; these clarify G, not a new spending authority:

- A schedule has 2–1,000 entries: a nonempty generation half with unique case
  IDs, followed by the same IDs in the same order in the scoring half. Case IDs
  match `[a-z0-9][a-z0-9._-]{0,127}`; execution and authorization IDs match
  `[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}`. R checks membership in its prepared roster.
- No revisiting means no repeated `(phase, caseId)`. A timed-out generation's
  scheduled scoring callback still runs once with provider access disabled.
- Zero in-flight means no guard send awaiting settlement and every owned ledger
  attempt terminal. A non-cooperative underlying transport promise may remain
  pending after cancellation; physical provider completion is not provable.
- Each ALS scope carries an explicit open/closed state and must match the active
  object. Closing the callback fences later descendants; ALS alone is not a fence.
- Callback resolution is the trusted runner's persistence attestation. G proves
  callback completion and ledger reconciliation, not artifact fsync. R owns the
  actual writes inside that callback; there is no separate advance/reset method.
- The new guard's `isHalted()` means sticky global halt only. Case seals are
  separately readable; opt-only attempt metadata does not change old guard shapes.
- Historical digest bytes are SHA-256 of canonical JSON for reservation-ordered
  `{attemptId, channel, reservedMicroUsd, outcome, actualMicroUsd}` rows, including
  explicit nulls. Pinned limits/count/totals/open state are verified separately.
  Current rows must equal that prefix plus exact owned rows in the same order.
- Claim creation uses exclusive/no-follow open, file fsync and directory fsync.
  Any partial existing claim remains consumed; invalid inputs are checked before
  claiming, and no parse/repair/delete path can make a claim reusable.
  Identical authorizer provisioning is idempotent only before consumption;
  afterwards it refuses even with zero sends. Thus a future CLI dry-run cannot
  present an already consumed execution as runnable. A running guard's internal
  verification still accepts its own immutable claim.
- G prevents reuse of an execution capability, not a deliberately newly authorized
  execution, renamed question or malicious same-user file rewriting. Excluding
  all prior frozen cases is the next-run roster/operator responsibility.

Accepted API sketch: `authorizeCaseDeadlineCapability`,
`createCaseDeadlineExperimentRequestGuard`, `withCaseScope({phase,caseId}, fn)`,
`caseTimeouts()` and `caseScopeSnapshot()`. The callback receives a read-only
`snapshot()` accessor. Scope IDs must exactly match the next frozen entry;
callback return values are unchanged. A callback may catch a globally fatal
send and persist its artifacts, but no subsequent scope may start. Uncaught
operation/persistence and reconciliation exceptions remain globally fatal.

## R integration requirements reserved for the next slice

The future CLI must validate explicit policy/authorization/execution options
before any ledger write/key discovery; dry-run authorizes/verifies the immutable
capability but never consumes it. Bind identity across manifest/checkpoint/
generation/scoring/report/aggregate; absent identity remains legacy only.
Do not upgrade/resume old runs. New policy v1 is live-process-only and refuses
all paid resume after interruption; a consumed claim never authorizes a new
session. Merge only matching effective policy versions and validated artifacts.

Wrap each complete generation/scoring step (including durable failure records)
in its frozen scope. Timed-out cases remain fixed-roster failures/unresolved,
never zero-cost skips or deleted denominators, while later preselected cases
can run. Preserve previously observed partial results truthfully; do not invent
scores for missing answers/judgments or silently count a timeout as completed.
Keep global-safety stops distinct and retain all accumulated costs. No changed
judge rubric, answer prompt, model, context bound, retries or timeout defaults.

## G implementation and supervision record

| Packet | Actual owner/model | Scope and evidence | Primary intervention / remaining delivery |
| --- | --- | --- | --- |
| Architecture and acceptance | Primary | Frozen G1–G6 above, direct source/diff inspection and primary dual-runtime gates | Clarified observed causality, persistence attestation, historical unknowns, one-shot consumption and future R boundaries |
| Read-only design audit | `case_timeout_guard_design`, Sol/high | Pre-implementation review of G state/persistence boundaries; separately inspected the future R draft | No implementation; clarification decisions recorded above |
| G implementation | `case_timeout_guard_impl`, Sol/high | New capability, core signal provenance, ordered guard scopes, privacy docs and synthetic tests; worker request-guard matrix 128/128 on both runtimes | Primary required actual SQLite capture instead of an admission boolean, real boundary files instead of an array, synchronous-failure timing coverage, and default scheduling preservation; no takeover or model escalation |

The meaningful RED reached the new explicit authorizer/factory/scope API and
real reservation/unknown settlement, then case B failed with the legacy
`paid_work_halted`. It was not an import/export failure. The scaffold diff hash
was `9dc509b027adcdb733add037d926063979f853f83df4491685629d05e4c56601`.
A local command/failure note is retained for delivery. It is a summarized
terminal record, not a committed copy of the temporary scaffold.

Entrypoints inspected: the internal core predicate is used by the experimental
guard only and is not re-exported from a public core barrel. Existing guards
retain their routes, record shapes and default halt/timer semantics. G adds no
live session/CLI/runner/merge call site; those are R, not delivered by this slice.
The explicit request-guard package script includes the new conformance suite.
No provider calls, real key, corpus or campaign ledger were used in G.
Worker elapsed/token/cost telemetry was not captured and is not inferred from
the model label. Primary verification and both fixed-commit review results are
recorded in the delivery PR; a worker's green report alone is not acceptance.

The first fixed candidate received two independent Sol/high reviews. Spec found
one missing forged-diagnostic regression. Standards found a native storage-error
escape at claim consumption and suggested reducing duplicated request wrappers.
The same implementation owner received the two required corrections plus a
primary-requested changelog entry. The wrapper refactor is deferred: keeping
the opt-only branches explicit preserves the independently exercised legacy
timer scheduling and avoids expanding this safety-sensitive correction.
Final acceptance requires fresh affected gates and both review axes on the
corrected commit; the first candidate's green matrix is not its substitute.
