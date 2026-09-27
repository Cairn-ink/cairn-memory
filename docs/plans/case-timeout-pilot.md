# R acceptance — prospective timeout-aware public pilot

Primary architecture packet. Fixed G base:
`98f64e58490f05e9a51cd047a7396cf16a84765a` on `feat/case-timeout-pilot`.
Implementation begins only after G's final independent reviews pass; public
delivery remains dependent on G's complete CI gate.
No paid work, credentials, corpus, campaign-ledger mutations, merge or release.
Use actual Sol/high implementation followed by independent dual-axis review.

## R1: Explicit trusted session and startup

Add an explicit case-deadline session factory (or exact explicit token option)
using G's validated immutable capability. Preserve the existing default factory
and all legacy shapes/behavior. The session binds scope operations and capability
identity through a module-private WeakMap. Plain custom sessions remain supported
in default mode, but cannot claim opt-in enforcement by exposing lookalike fields.
Match the entire frozen generation/scoring schedule to the selected prepared
roster before any provider call or new pilot file. Provider request bytes, model,
answer template, rubric, token bounds and timeouts do not change.

CLI opt-in is explicit via `--case-timeout-policy case-deadline-v1`,
`--case-authorization-id`, `--execution-id`, `--expected-request-count`, and
`--expected-reserved-micro-usd`. Require the complete set, reject unknown policy,
unknown fields, invalid ASCII identifiers/counts and partial flags before any
ledger write, capability provisioning or environment key access. Ordinary
`--authorization-id` still means the existing benchmark extension. New flags
are forbidden in offline merge. Dry-run verifies prepared inputs, exact schedule
and checkpoint, provisions/verifies G capability but does not consume its claim,
read a key, call a provider or reserve an attempt. Its output states the policy,
execution identity and the live-process-only restriction explicitly.

For a real opt run, validate prepared inputs, sidecar, fresh output directory and
the exact token before consuming the claim. No existing opt output is resumable,
even if its checkpoint was removed, changed to pending or marked completed.
The durable claim remains authoritative on repeated session construction.
Repeated runPublicPilot use on the same opt session is refused before output or
provider work, including use against a different directory. Invalid preflight
may consume a claim conservatively but must never authorize another attempt.

## R2: Identity and compatibility

Define one exact bounded opt-run identity containing effective policy version,
execution ID, authorization ID and a deterministic full-capability digest;
use the validated token, not caller-defined manifest metadata. Compute
the digest as SHA-256 of canonical JSON for the single-element array containing
that validated capability, matching G's claim binding. It is a local consistency
check, not authentication against an operator who can rewrite every artifact.
Retain it consistently in manifest, checkpoint, generation, scoring, report, aggregate
and private accounting/diagnostics when these artifacts exist (blocked no-send
cases may lack them). Require/read/validate these opt identities in offline merge,
not merely generation/scoring wrappers. No raw capability path/key goes to model
inputs. Absent identity means legacy only; explicit invalid/undefined/mixed
fields fail. Legacy resume refuses any opt identity before paid work. Never
retrofit old halted pilot artifacts or recompute their results under this policy.

Offline merge validates identical identity within each source run, including
blocked/failed cases and zero-scored runs. It requires matching effective policy
version across runs, not matching execution ID (disjoint genuine runs have
different executions), and retains source execution identities. A merged top
level carries only the effective policy version; each sources entry carries its
source's complete identity, never one source's execution at the merged top.
It still rejects
overlapping case IDs, mismatched model/template/limits/manifest, malformed or
incomplete artifacts before creating/chmodding output. Effective legacy and
case-deadline policy can never be pooled silently.

## R3: Whole case operations inside G scopes

Execute every generation entry, then every scoring entry in frozen order, using
G.withCaseScope({phase,caseId}, callback). Callback includes all capture/recall/
answer or scoring calls, per-case artifacts, accounting, diagnostics and durable
checkpoint transition. No callback can advance or reset guard authority.
Guard-recognized timeout snapshot, not an arbitrary error string, determines
case_timeout. Set its wrapper status failed and retain the trusted fixed reason,
phase and termination enum. Preserve any observed run/score payload truthfully.
Do not make a timeout look like completed generation merely because upstream
comparison returned a wrapper with failed arms. Already spent requests remain
in artifacts and totals, including unknown/full reserved amounts.

A generation-timeout case has no more provider sends, including scoring. Its
scheduled scoring callback may only persist the blocked artifact. Other
preselected cases proceed only after successful complete boundary persistence
and reconciliation. Global fatal send may be caught to persist its case, but no
later scope opens. Remaining global-stop artifacts can be written outside paid
scopes, with a global halted report, zero fabricated attempts and all prior cost.
Do not catch and disguise persistence/reconciliation exceptions as recoverable
timeouts; these stop with intact partial evidence, no paid resume or key reload.
A boundary-only anomaly cannot rewrite create-only case artifacts already
written. Leave them as observations, and fail the run without claiming a complete
valid-accounting report. A best-effort fixed global-failure marker/checkpoint may
record that exception separately; no successful later scope or invented report.
The ordinary globally fatal provider-send path is different: if reconciliation
succeeds and failure artifacts are durable, later blocked files/report are safe.

## R4: Denominators and partial observations

Fixed roster is unchanged. Include every timeout/failure/blocked case; no result
is deleted, retried, renamed, refunded or labeled a free successful skip.
Retain timeout counts separately from global halt and ordinary generation/scoring
failures. Keep no-score as null, not 0%.

Add an opt-only synchronous trusted `executionStop` callback to the evaluation
scorer (not core/hosted protocol), returning only null, `case_timeout`, or
`paid_work_halted`. R supplies it from the session WeakMap's guard state, never
source text/error strings. Check immediately after each judge attempt and before
subsequent callbacks. A recognized guard timeout marks the current judgment
unresolved `judge_timeout`, attempted true, and remaining judgments
`prior_judge_timeout`, attempted false without invoking judge. Global halt stops
later callbacks with `paid_work_halted`, attempted false. Invalid callback
results/throws fail closed. No-hook default behavior and actual prompt bytes
remain unchanged. The runner rechecks trusted stop state after generation too,
since comparison catches capture/answer exceptions internally.

If scoring times out after an earlier arm's valid judgment, preserve that judgment
and its genuine per-arm score record even though the case wrapper is failed.
Aggregate valid partial score records (opt mode only) without changing official
rubric, prompt or score schema. The common paired bucket still requires every
arm resolved. Timeout/missing judgments are unresolved, not automatically wrong
or correct. Generation-timeout answers are retained as observations but never
receive fabricated judgments. Offline merge must produce the same per-arm and
fixed/common denominators as original artifacts. Validate any nested run/score
identity even when its wrapper is failed, not only when completed.

Normative timeout wrapper shapes are generation `status:failed,reason:case_timeout`
with observed run when available, and scoring `status:failed,reason:case_timeout`
with the full validated three-arm partial score when available. `summary.scored`
counts only completed wrappers; opt summaries separately count generation
timeouts, scoring timeouts and partial score records. The scoring-timeout
count includes only failed scoring operations, not scoring
that was blocked by an earlier generation timeout. `partialScoreRecords` counts
failed scoring wrappers that retain a valid score payload, including one whose
judgments are all unresolved; it does not count ordinary completed mixed scores.
The official score-record
count may therefore exceed summary.scored. Recompute these fields from validated
source cases in merge; caseBlockedReason must preserve opt timeout reasons while
leaving the legacy generation_failed fallback unchanged.

## R5: Offline observable tests and delivery

Before implementation retain a real RED for expected opt behavior, not missing
imports. Use real G/session/core with fake HTTP, virtual timers and synthetic
prepared fixtures/ledgers. Test extraction with nonzero count latency followed
by genuine core deadline, persisted failed case and next preselected case
successful through scoring. Inspect exact ledger/call sets, DB state, artifacts,
fixed/common denominators and irreversible zero sends on late callbacks.
Add answer transport timeout and scoring partial-timeout integration. Test
non-timeout malformed/count/usage/accounting anomalies globally halt. Prove
persistence refusal never permits the next case. Test failed-generation no-send
scoring scope, safe dry-run twice, claim reuse and output/checkpoint edit denial,
legacy unchanged, effective-policy merge refusal and identity tampering at every
layer, including zero-score and failed-nested-payload cases.

Required primary gates on Node22.16 and24.15: request-guard, budget, core, OpenAI,
live-offline, LongMemEval, generic, relevant offline demos and JSON/plugin
validation. No TypeScript gate. Tests never read real key/corpus/ledger or make
network model calls. Update public-pilot-runner documentation, the protocol
privacy boundary and CHANGELOG for the explicit CLI behavior; add no claim of
semantic reliability or measured improvement and do not bump release versions.
Freeze commit, independent Standards/Spec review, scoped PR and all17 CI checks.
Only then prepare a NEW paid roster/freeze from untouched cases under the
existing cumulative cap; old run and all its frozen slots remain excluded.

## Ownership and evidence

The primary owns architecture, the acceptance contract, direct diff inspection,
integration checks, candidate freeze and delivery. The bounded implementation
owner is the existing `case_timeout_guard_impl` worker, actual Sol/high, chosen
for cross-layer state, durable artifacts and cancellation. Independent Standards
and Spec are separate Sol/high agents that do not implement R. No fallback or
primary takeover is planned. Worker and primary commands, final candidate SHA,
correction rounds and both independent reports will be attached to this slice's
delivery PR. Token/cost telemetry is unavailable and will not be inferred from
the model name. Synthetic-only test success is not a semantic accuracy result.

Preimplementation RED was retained for R4 specifically: the scorer accepted
the minimally wired `executionStop` option but still invoked three judges when
the test required one. On Node 22.16, the official-scoring suite had 12 passes
and this one failure (`3 !== 1`). Scaffold-diff SHA-256:
`d75df1cfb9bc3bf404938c862ef57b5555624cbdf6d648ed8c2a2bf077df6e0b`.
This is a summarized command/failure record, not a retained full scaffold, and
does not claim a preimplementation RED of the full runner integration.

Primary pre-freeze supervision corrected the acceptance evidence, not the
evaluation rubric: artifact identity equality alone did not prove rejection of
tampered companions; a collision before any spend did not establish post-spend
persistence safety; and CLI dry-run alone did not exercise the live claim path.
The worker added synthetic real-entrypoint negatives for those preconditions,
distinct-execution merge coverage, and failed/zero-score nested payload checks.
Primary inspection also required blocked scoring to persist its opt checkpoint
transition and offline merge to reject report-case reason drift from actual
wrappers. These are R1-R5 corrections, not permission or policy expansion.
An intermediate new v2 test checked nested identity on a redacted case summary
instead of its private generation/scoring wrapper; correcting that assertion is
a test defect correction, not an unexplained infrastructure retry. Elapsed and
token/cost telemetry are not inferred. Final gates and independent reports are
recorded against the delivered candidate in the PR.
