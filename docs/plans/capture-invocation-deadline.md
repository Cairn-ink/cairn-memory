# Invocation-local capture deadline (bounded S1 slice)

Fixed base: `709c8f0c2e79d57ed2e72d33723b71a637b1aede` (PR #213).
Branch: `feat/capture-invocation-deadline`. Implementation owner GPT-6 Sol/high;
primary owns architecture, acceptance and independent review. This contract
precedes implementation. Begin implementation only after exact-head PR #213 CI
passes. This slice alone does not complete S1 or establish better model accuracy.

## Decision

Add opt-in trusted constructor `captureDeadlineMs`: a safe integer from 1 through
120000 inclusive; omitted retains existing behavior, while explicit undefined,
null, invalid types and out-of-range values fail constructor validation. This
is not a capture message field, model-provided parameter or shared global clock.
The upper bound is below the existing 125-second admission lease, not a proved
Hermes response-time margin. No host default or external timeout changes here.

One monotonic context per capture invocation begins before capture's source
normalization/claim and spans extraction, qualification, reconciliation,
admission, initial classification and automatic rationale. Existing per-model
30-second ceilings still apply: use the smaller of that ceiling and remaining
invocation time, never a fresh total allowance for a later stage. Explicit
private arguments and capture-specific closures keep scope auditable; do not
use AsyncLocalStorage or let unrelated standalone calls inherit the deadline.

Check synchronous work cooperatively. SQLite and synchronous token accounting
cannot be interrupted mid-instruction, so this is not a hard wall-clock return
SLA. Check before writes and before commit to roll back work crossing the bound.
Owner-guarded failure/lease cleanup remains allowed after expiry. Do not confuse
that housekeeping with late admission, placement or rationale content commits.

## Observable acceptance

- D1 — Configuration and isolation: validate and snapshot the strict constructor
  option without changing defaults or accepting it in public message arguments.
  Give each capture its own private monotonic context. No new persistence,
  serialized field, public clock injection or cross-call state. Concurrent
  captures and standalone calls cannot inherit or extend another's deadline.
- D2 — Model boundaries: check before and after input/output token accounting,
  before actual adapter invocation (including any scheduled microtask), after
  model return and final validation. Use min(30000, remaining) for an outstanding
  call. When core aborts, mark the actual AbortSignal in the existing private
  provenance WeakSet; external aborts or provider error strings cannot forge
  that provenance. Late resolution/rejection cannot trigger later model work or
  content writes. Preserve bounded output, freshness and cancellation checks;
  do not relax existing token, call or cost ceilings or add retries.
- D3 — Transaction boundary: deadline-check before beginning and immediately
  before committing capture-owned ordinary/staged/ordered initial claims and
  final admission, initial-classification begin/placement, and rationale commit.
  Expiry must roll back the whole transaction: sources, receipts, qualifications,
  conflicts, ordered retirement/high-water, index changes and journal state.
  A check throwing after COMMIT is too late. No model call enters a transaction.
- D4 — Honest partial completion: before admission, expiry returns existing
  `model_timeout` failure and permits owner-token claim cleanup. After admission,
  keep its successful result/receipts and return an honest failed classification
  or rationale status using existing error envelopes. A not-yet-started initial
  classifier must not be recorded as successful or retroactively as attempted.
  Persist failure for an already-started attempt where possible; write failure
  stays incomplete and cannot mask the original error. Once the whole deadline
  expires, start no later model stage. A mere provider error string or the old
  per-model timeout is not authority to change this whole-invocation policy;
  ordinary non-expiry classification failure keeps best-effort rationale.
- D5 — Cleanup and compatibility: do not deadline-fence owner-token guarded
  abandonAdmission or initial-journal failure recording. Staged expiry/clock
  housekeeping may still close expired evidence; it cannot renew or recreate
  source content. Public manual finish/classify/applyPlacement/rationale calls
  retain their old contracts. Existing duplicate capture never restarts work.
  Cold inspection and correction/forget/supersession protections stay intact.
- D6 — Observable coverage: test cumulative stages individually below the old
  ceiling but beyond the whole bound; input/output counting crossing expiry;
  qualification/reconciliation expiry with zero admission; transactional expiry
  before commit; post-admission classification and rationale expiry; valid
  successful capture; concurrent independent captures; late adapter completion;
  external versus core abort provenance; default behavior and invalid inputs.
  Inspect actual synthetic store, receipts, journal and provider-call counters.
  Negative tests must prove the intended precondition/fault point was reached,
  not pass because classification, retirement or a write was skipped.

## Implementation boundaries

Initial claim variants share admissionStorage.claimAdmission's transaction;
ordered claim hooks add event/stream state and staged claims retain source data.
Final ordinary/staged admission shares finishAdmission; ordered retirement and
stream high-water hooks commit inside it. Initial classification writes through
the private journal and mocStorage.applyPlacement. Automatic rationale ends at
rationaleStorage.commit. These are the content/precommit guard points. Ordered
prepare/discover is read-only. Keep deadline checks separate from staged expiry
and owner cleanup. A private optional check on the existing transaction helper
may serve these paths; default callers remain unchanged.

Allowlist: core contract/capture/model-call/classification/automatic qualification/
candidate qualification/ordered capture/automatic rationale/rationale helpers;
core runtime/database transaction/admission/ordered/journal/MOC/rationale storage;
one small private deadline helper if needed and only its path in the artifact
manifest; new focused core tests and directly affected compatibility tests;
focused MCP/installed integration tests without exposing a new host option;
technical capture/local-store/protocol/limitations docs, CHANGELOG and this plan.
Primary-approved pre-edit clarification: the existing
`evaluation/experiment-budget/test/case-deadline-guard.test.mjs` may add a
synthetic whole-capture-deadline regression proving real core -> OpenAI adapter
-> fake-HTTP guard abort provenance and conservative settlement. This is test
coverage of D2/D6, not a guard/policy/ledger implementation change. Its existing
inclusion in `test:experiment-request-guard` needs no script change.
No schema migration, dependencies, model prompts, retrieval/query strategy,
scorer, old cohort, real ledger, host timeout/default, hosted API or product-copy
change. Any additional shared file needs primary rescoping before modification.

No provider call, automatic retry, durable explicit-recovery attempt history,
merge, publication, deployment or production data is authorized by this slice.
Native Hermes/MCP configuration adoption is a later, separately verified packet;
do not imply this opt-in core facility is already enabled for their users.

## Gates and handoff

Focused first, then BOTH Node 22.16.0 and 24.15.0: generic, JSON, strict plugin,
full core, MCP, installed artifact, store/MOC/capture/admission/history demos;
offline live-evidence, LongMemEval ingestion/comparison and request-guard suites
and demos for shared capture/cancellation regressions. Check actual request-guard
core-versus-external abort provenance, not only a returned error code. No keys or
paid calls. Keep any fixture/setup/performance failures in the evidence record.

Primary inspects final fixed-base diff and personally exercises expiry rollback,
post-admission cold state, core cancellation and key installed paths on final SHA.
Freeze a scoped commit, then separate independent Standards and Spec reviews of
that exact full diff. Resolve findings and rerun affected gates/reviews. Push a
dependent draft PR against `feat/capture-classification-journal`, observe all
exact-head remote CI checks and mergeability before ready; do not merge.

Next: explicit bounded recovery/host adoption and a newly frozen development
smoke, followed by same-condition semantic comparison. Old cases and their
failures remain fixed; mechanical timeout/rollback success is not a new score.
