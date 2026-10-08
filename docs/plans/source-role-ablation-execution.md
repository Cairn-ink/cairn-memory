# One-shot source-role extraction experiment transport

Status: contract frozen before implementation; bounded offline implementation
and corrected primary full gates passed on both exact runtimes. Candidate
delivery and two independent reviews remain pending. No authentic ledger
mutation or provider execution.
Base `4c77d0749cb0c8689d8f4a16e2a2922b80ff9199`; worktree
`source-role-ablation-guard`, branch `feat/source-role-ablation-guard`, dependent
PR target `test/source-role-ablation`. If N28 review changes its candidate,
integrate those corrections and repeat affected gates before delivery/activation.

## Goal and decision

Test whether the frozen N28 attribution-aware extraction prompt retains direct
episodes better without unsupported promotion or useful assistant-evidence loss.
The twelve synthetic cases, two exact prompts and rubric remain unchanged.
This is a prospective extraction-only development experiment, not a new
LongMemEval score, a default change, or a replay of the completed fixed30 run.

The user permits reasonable scoped experiments within cumulative US$400. Primary
sets this experiment's subordinate reservation ceiling to US$2 and retains US$30
protected. No replenishment, reset, retry or hidden transport. Existing generic
guards correctly deny indexed extraction; do not spoof a pair grant or relax
that denial. Add a distinct extraction-only capability reusing existing guarded
reservation, bounded response, settlement and halt machinery.

## Acceptance

- N29A — Authority: provision a separately named create-only private/fsynced
  capability on the existing bound embedding ledger, under its writer exclusion.
  Validate the original policy, complete v4 budget ancestry and exact fully
  settled current ordered-history checkpoint. Bind authorization/execution IDs,
  immutable N28 assets/rubric/compiler plus operator/runtime identities, model,
  caps, the alternating 24-slot order and exact expected count/generation body
  digests. A separately exclusive durable one-shot claim is consumed before
  returning a live guard, including zero-send constructor failure. Partial,
  forged, stale or conflicting files fail without repair. No ledger schema,
  cap transition, historical mutation, old grant reuse or generic indexed grant.
- N29B — State: only the next frozen slot can open, with at most one active
  scope/request. Permit exactly one count then at most one generation, both
  `cairn_extract` using indexed windows and the frozen baseline model/schema.
  Validate exact serialized body digests, input/prompt/model/schema before
  reservation. Seal the slot on completion/refusal; no duplicate/retry/reorder,
  restart or substitution. Reject classify/rank/qualification/Mem0/answer/judge,
  foreign or delayed scope callbacks and generation before successful count.
  All 24 slots remain in results, including refused and not-run positions.
- N29C — Accounting: use the existing guard send/parse/settle path and bound
  ledger, not duplicated HTTP/accounting. At most 48 physical requests and
  2,000,000 microUSD newly reserved; preflight the full conservative planned
  reservation and require cumulative plus experiment ceiling <=370,000,000.
  Revalidate immutable grant files immediately before each reservation, after
  request snapshot callbacks; revalidate the complete owned historical witness
  inside the existing bound ledger transaction. No new ledger callback is added.
  Pending/foreign rows, overrun, unknown
  transport, malformed response or failed settlement halt all remaining work.
  Structural extraction refusal after settled HTTP may seal that arm and continue
  the next frozen slot. Unknown actual costs remain fully reserved, not zero or
  refunded. A transport timeout here is a global stop, not benchmark continuation.
- N29D — Operator: a narrow programmatic operator requires explicit trusted
  key, one-attempt transport, ledger configuration and expected capability; no
  environment discovery, automatic fetch, arbitrary prompt/model/case overrides
  or implicit grant creation. Reuse `prepareSourceRoleArm`; select frozen prompt
  before checking `checkExtractionFits` on the actual adapter model and invoking
  `callModel`. Use real guarded count/generation, not scripted counts as evidence.
  Compile with `extractedWindowItems` and exact original source bindings. The
  existing N28 compiler remains fake-only. No core, production prompt, adapter
  schema, admission, classification, recall or host-default change.
- N29E — Evidence/privacy: retain bounded private per-slot output sufficient for
  later independent blind semantic review and canonical source coverage; it is
  synthetic source/interpretation, not authenticated truth. Preserve refusal,
  not-run, accounting and invocation status separately. Credentials, headers,
  raw provider errors and arbitrary exceptions never enter report or logs.
  Runtime/asset and canonical request pins must be checked before dispatch;
  report persistence failure halts, and cannot turn a consumed claim into replay.
  Do not import rubric/gold into model-facing compilation or transport. No score,
  advancement or production promotion is inferred from fake HTTP or source-only
  coverage. All 24 future results need independent blinded semantic review under
  the unchanged N28 criteria before any quality decision.
- N29F — Observable verification: retain preimplementation RED for absent new
  authority and unchanged generic indexed denial; then exercise the actual
  adapter -> guard -> synthetic ledger path with 24 slots / 48 sends. Test
  count/generation order and body/prompt/input/schema/model drift, grant replay,
  constructor race, partial/stale grant, late callbacks, scope/cap exhaustion,
  protected budget boundaries, no send before reserve, usage/unknown/settlement
  failures and exact historical prefix preservation. Assert successful/refused/
  not-run denominators, no secret canaries and zero unexpected owned residue on
  success/failure. Use canonical owned workspace runner, exact Node22.16.0 and
  24.15.0, flags before files. Existing generic/pair/mixed denials and behavior
  must remain unchanged; full contributor and affected guard/LME suites apply.
- N29G — Delivery/activation: primary inspects actual diff, runs affected full
  gates, mechanically cross-checks all delivery paths by two routes, commits a
  candidate, gets separate non-author Standards and Spec reviews, and checks
  latest-head CI/mergeability. No merge/release/deploy. Only after acceptance may
  primary freeze an execution envelope, read current cumulative budget/pins,
  issue a fresh one-shot grant under existing user authority and run once. That
  operational preflight and live evidence are not part of the offline pass.

## Scope and ownership

Delegated actual GPT-6.1 Sol/high owns implementation/focused controls. Primary
owns this contract, architectural scope, direct acceptance, delivery and any
future live launch. Two independent non-author reviewers own final review axes.

Allowed files: `evaluation/experiment-budget/request-guard.mjs`, new
`evaluation/source-role-ablation/operator.mjs`, focused tests
`evaluation/experiment-budget/test/source-role-ablation-guard.test.mjs` and
`evaluation/longmemeval/test/source-role-ablation-operator.test.mjs`, this plan,
`docs/experiment-request-guard.md`, `docs/limitations.md`, the approved test-only
`evaluation/experiment-budget/test/source-role-ablation-fixture.mjs`, and only
the approved existing test-list append in `package.json`, and the corresponding
exact-script expectation in `integrations/client/test/pairing-guards.test.mjs`.
Total ten paths after the primary integration correction below.
No changes to N28 frozen assets/compiler/rubric, dependencies, other scripts,
ledger schema, other worktrees or authentic artifacts. Read-only shared dependency
links are setup only; never install/rebuild/update/remove links or their targets.

Prefer a distinct typed internal extraction-only profile in the existing guard
engine. Do not present this as a Cairn/Mem0 pair or create a parallel settlement
implementation. Trace changed constructors/routes and their old callers/tests.
Record actual exits, retained failed checks, exact file scope, review and any
scope escalation here. Stop after two unsuccessful correction rounds on the same
failure and hand that diagnosis to primary. Paid credentials/ledger access are
not delegated in this packet.

## Implementation checkpoint

Primary approved two narrow scope additions before use: the non-test shared
`evaluation/experiment-budget/test/source-role-ablation-fixture.mjs` builds only
authentic synthetic 50/100/200/v2/v3/v4 ancestry and isolated child controls;
`package.json` only appends the new guard test to the existing explicit
`test:experiment-request-guard` list. The operator test is discovered by the
existing LongMemEval glob. Total delivery scope is nine files; three existing
read-only dependency symlinks are setup, not delivery. No dependency, N28 asset,
ledger API/schema, production prompt or shared-engine default changed.

The new async preparation/authorization/factory APIs derive wire pins through
unchanged `compileSourceRoleArm` and its fixed fake transport, loaded lazily only
on the new path. `constructBenchmarkGuard` has a distinct `sourceRole` profile;
generic, deadline, qualified-pair and mixed callers retain their prior option
shapes and authority. The new profile uses the same send/parse/settle function,
bound witness and existing ancestry checks, not parallel accounting. Its only
additional guard methods are slot scope, halt and waiting for already-started
guarded-route settlement. The private operator checks fit on its actual guarded
adapter after frozen prompt selection, then uses real `callModel` and
`extractedWindowItems`; it imports no evaluator rubric.

Per-slot persistence is inside scope advancement. Callback input says pending;
returned state says persisted only after callback resolution, or failed after
rejection. Successful persistence followed by a guard/history failure is execution
halt, not persistence failure. The trusted callback's resolution is an observation,
not independent proof of durable fsync; a private writer and operational envelope
still need separate acceptance before any paid activation.

The actual-operator offline evaluator bridge is
`retainedCoverage(row.caseOrdinal, {...row, caps: report.protocol.caps})`. Tests
cover canonical JSON-loaded expected grants, all 24 unchanged caps, independently
known retained/omitted direct-event passages and unknown semantic review blocking
advance. `not_run` remains separate and is rejected by the frozen rubric; halted
execution cannot be aggregated as a complete 24. Later persisted-report readers
must validate all five own-data cap keys and values before projecting them in the
frozen order; N28's existing JSON-order-sensitive equality is not changed or
treated as semantic evidence. Unknown fields must not be silently discarded.

## Focused evidence and retained failures

All focused invocations use keyless `env -i`, exact Node22.16.0/24.15.0 PATH,
`TMPDIR=/tmp` and `NODE_DISABLE_COMPILE_CACHE=1`. The canonical command is:

```sh
node tools/testing/run.mjs --test-concurrency=1 \
  evaluation/experiment-budget/test/source-role-ablation-guard.test.mjs \
  evaluation/longmemeval/test/source-role-ablation-operator.test.mjs
```

Flags precede files. The two runtime binaries are
`/home/chichieh/.nvm/versions/node/v22.16.0/bin/node` and
`/home/chichieh/.nvm/versions/node/v24.15.0/bin/node`.

- Preimplementation authority RED: Node22 actual exit 1, one failed assertion
  because the two new exports were undefined. Existing W10 indexed-denial control,
  selected with flags before files, actual exit 0, 1/1.
- First integrated 24/48 control: actual exit 1 (`policy_mismatch`); the source-role
  v4 verifier needed the authentic snapshot as its fifth argument. Source-role-only
  correction then actual exit 0, 1/1; old callers were unchanged.
- Expanded operator check: actual exit 1, 6/7. The test incorrectly expected
  `paid_work_halted` for an overrun that also fails the post-scope boundary check;
  the retained observation is `execution_halted`. The assertion now distinguishes
  that from ordinary unknown-transport global stop, without weakening accounting.
- Historical pre-final focused runs: both runtimes actual exit 0, 18/18, 0 skip.
  Final-byte runs below supersede these after the rubric bridge and invocation
  status refinement; no historical pass is claimed as final-byte evidence.

The controlled deadline child preserves genuine core-created abort provenance
while shortening only the real invocation's timer scheduling after 24 fixed offline
serialization preparations. One HTTP promise deliberately ignores abort and later
resolves: durable unknown settlement precedes persistence, pending count is 0,
23 slots are not-run, close succeeds, and late completion changes no row or send.
This is cooperative lifecycle evidence, not a measured 30-second latency result.
Other controls cover actual 48 sends, reserve-before-fetch, exact historical prefix,
process claim race, zero-send post-claim failure, malformed/stale/partial grants,
wire drift, scope ordering/overlap/late callbacks, protected budget, transactional
foreign row inserted between outer verification and reserve, malformed usage,
priced overrun, real failed SQLite settlement, persistence failures and secret
canary exclusion. Exact owned success/failure fixture directories are removed.

Final focused checks below ran serially on the same final production/test bytes.
An earlier Node22 outer-residue check briefly overlapped a focused invocation;
it is historical only. The final outer checks were rerun serially after both
focused suites. None is latency evidence.

| Final check | Node22.16.0 | Node24.15.0 |
| --- | --- | --- |
| Two new focused files | actual exit 0; 18/18, 0 skip | actual exit 0; 18/18, 0 skip |
| Existing W10 generic indexed denial | actual exit 0; 1/1 | actual exit 0; 1/1 |
| Owned outer runner lifecycle | actual exit 0 | actual exit 0 |
| Nested success / intentional failure | actual exits 0 / 1 | actual exits 0 / 1 |
| Residue after success / failure | 0 / 0; outer removed | 0 / 0; outer removed |

The outer lifecycle control runs the existing canonical runner with the focused
`--test-name-pattern='N29F owned child failure'`, followed by canonical `--script`
mode on the test-only fixture helper with `--fixture-child intentional-failure`
and a nonexistent file inside that exact fresh owned workspace. It checks each
actual child exit, directory entries after each process and final workspace
removal. No historical cleanup or shared-link mutation is involved.

The file manifest is mechanically cross-checked through `git diff --name-only`
plus `git ls-files --others --exclude-standard`, independently against
`git status --porcelain=v1 -z`, excluding only the three named dependency setup
links. Both routes agree on nine delivery paths. `package.json` parsing also
confirms the new guard test's explicit CI list and the operator's existing LME
glob. N28 six-file hashes remain identical to the frozen base.

Author focused acceptance N29A–F is verified with the stated synthetic/private
writer limitations. N29G, full contributor gates and independent Standards/Spec
review remain primary-owned and pending. No paid activation is inferred.

### Preimplementation transaction-boundary clarification

The worker identified that `openBoundEmbeddingExperimentBudget.authorize` runs
at construction, while `openHandle` verifies path identity and the complete
accounting witness inside each reserve/settle transaction. Primary inspected
those functions and chose to retain that existing boundary: grant files are
checked synchronously immediately before reserve, after caller snapshot effects;
the ledger itself is checked transactionally. This is not an atomic transaction
spanning arbitrary filesystem grant files and SQLite. A hostile same-user process
that replaces both trusted files/tokens is outside the existing guard's threat
model. No new beforeReserve callback, ledger API or schema is justified for this
single-operator experiment. This clarification precedes implementation and tests;
tests must retain both grant-file refusal and transactional foreign-history
refusal, without claiming filesystem/DB atomicity.

### Primary full-gate integration correction

The first primary full generic suite retained actual exit 1: 580/581 passed.
Its only failure was the exact script-registration assertion in
`integrations/client/test/pairing-guards.test.mjs`: the newly approved guard test
was appended to `package.json`, but this separate expected-command list was not
updated. Primary minimized it with the canonical client runner and
`--test-name-pattern='thin guard entry preserves'` before the test path: actual
exit 1, one reproducible failure. Both actual and expected strings differ only
by the new test path; preceding environment-preservation and swallowed-violation
checks passed. This rules out ordering or runner behavior for this observation.

Primary took the bounded integration-correction exception: append only that
exact new test path to the existing expectation, retaining strict equality and
the immutable historical fixture. Scope grows from nine to ten files. No
runtime, environment guard or other script changes. The original failure stays
in `/tmp/cairn-n29-primary-gates.2rUpc6Qj/results.json` and its generic log; the
corrected full gates will use a separate revision output directory. This is a
test-registration repair, not a demonstrated product-memory improvement.

### Corrected primary integration verification

The minimized script-registration check passed on Node22.16.0 and24.15.0,
actual exit 0, 1/1 each. The corrected full harness completed all 24 commands
with actual exit 0; command results/logs and stable before/after ten-file hashes
are retained under `/tmp/cairn-n29-primary-gates.2rUpc6Qj/revision-1/`.

On each runtime: generic 581/581, ledger 67/67, request guard 345/345,
portable native gateway 85/85, LongMemEval 318/318, OpenAI adapter 332/332,
workspace lifecycle 25/25, all with zero failures/skips. JSON validation,
maintainer validation and budget/guard/ingestion demos each exited 0.
Direct canonical-runner concurrency flags precede file paths; the unchanged
OpenAI npm script retains its own concurrency. These are synthetic correctness
gates, not isolated latency measurements. N30 private offline work used separate
owned fixtures concurrently and did not mutate this worktree.

Primary directly inspected all ten files. The full harness independently matched
`git diff` plus untracked paths against porcelain status, excluding only the
three named read-only dependency symlinks. All ten hashes stayed unchanged while
gates ran; only this evidence/status append follows those checks. The candidate
commit must match the other nine tested hashes; postcommit focused checks and
independent Standards/Spec reviews remain required before push. No TypeScript
gate exists, no live capability was issued and no paid output is inferred.
