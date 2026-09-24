# Fresh reliability development smoke

Fixed base: `2b2467400c68a8cc8c1601044deda350efc87718` (native Hermes recovery).
Branch: `test/fresh-reliability-smoke`. Primary owns scope, acceptance and any
paid launch; a GPT-6 Sol/high worker owns the bounded maintainer implementation.
No implementation or launch before the dependency's reviews and exact-head CI
pass. Planning and read-only preparation may proceed while that CI runs.

## Goal and checkpoint

The goal remains a lightweight, source-backed memory layer usable by Hermes
and other harnesses, with reliability measured against existing solutions, not
100% semantic accuracy. The master sequence is the proposed
[comparative plan](https://github.com/Cairn-ink/cairn-memory/pull/205): mechanical
repair (S1), trace/navigation (S2), matched comparator (S3), installed growth
(S4), and honest preview/onboarding (S5).

The native candidate passed independent Standards and Spec review and primary
22-case installed pinned-Hermes tests on Node 22.16 and 24.15. Exact-head CI
is still pending at this plan freeze. The separate read-only S1 audit mapped
canonical source refs, observable partial admission, initial classification
journal, explicit bounded recovery, repeat/stale/correct/delete/namespace guards
and late-write fencing to existing core/MCP/native tests. Once final CI passes,
accept that finite mechanical gate, not semantic truth or all S1–S5 milestones.
Repeat-safe means stored-state safety, not exactly-once provider cost; explicit
no-op classification can cost another request. The raw initial journal stays
unchanged while its public view becomes unknown after a revision change.

Historical 30-case results stay fixed: Cairn 15 correct, 8 wrong, 7 unresolved;
full history 19/8/3. No old case may be rerun, replaced or relabeled here.

## Decision: measure the repaired baseline before more architecture

Run a separately identified six-case **development plumbing smoke**, one per
existing LongMemEval question type, using the existing public pilot and three
arms unchanged. It is not a held-out competition, a full benchmark, proof of
improvement over the old cohort, or an accuracy promotion gate. Full history
is a reference, not Mem0. Fixed arm order and existing paired blocking remain
limitations; they must be corrected before S3, not silently hidden here.

This runner exercises embedded shared-core default capture and recall using
the current fixes. It does **not** opt into native v2 qualification, explicit
recovery, or `captureDeadlineMs`; the native/installed mechanical evidence is
separate. Do not reuse the old installed launcher as if it forwarded these
new settings. Do not combine legacy qualification guards with the current
ledger by weakening their limits. A later installed real-model flow requires
its own fully guarded path; this packet does not claim that flow.

## Acceptance, frozen before implementation

- F1 Fresh selection: use the already retained 500-case source with verified
  digest; exclude the prior 82 reserved/used cases, not merely the old30.
  Rank remaining IDs within each type by SHA-256 of
  `cairn-s1-fresh-smoke-2026-09-25:` plus the source question ID; bytewise
  hexadecimal/ID tie-break, select exactly one per type. Selection uses ID and
  type only, never answer, history length, estimated cost or observed results.
  Execution uses prepared dataset order. Freeze membership and prepared,
  reference-sidecar and exclusion hashes privately before calls. Do not replace
  a selected case that is expensive, invalid or fails.
- F2 Reuse: invoke existing reviewed public-pilot CLI and its source/evaluator
  separation, answer-v2 boundary and `case-deadline-v1` one-shot capability.
  Enable existing bounded transport diagnostics. Preserve extraction,
  classification, recall, answer/judge models, prompts and scorer. Record exact
  clean runtime SHA and existing model IDs; agent-worker upgrades do not silently
  change evaluation models. Confirm current official provider pricing before
  any paid launch. No scorer, model adapter, core or production change.
- F3 Accounting: reuse the original ledger/run and existing benchmark, request
  allowance and budget-extension grants. Current recorded reserved total is
  US$79.389500 of operational US$100; user cumulative ceiling is US$200. Recheck
  actual settled accounting read-only. This phase cap is US$12 / 2,000 requests,
  or lower if the full frozen projection permits. Count every failed/unknown
  attempt conservatively. Refuse before launch if all six cannot fit either
  phase or remaining operational allowance. No limit increase/reset/refund,
  retry, old capability reuse or automatic resume. Only genuine per-case
  timeout may isolate a case; accounting/authority anomalies stop the round.
- F4 Launch boundary: keyless preflight verifies source/selection/artifact/
  runtime hashes, exact ledger checkpoint and new output/capability/claim
  identities. It must not read credentials or mutate ledger/claims. After
  independent review, primary alone may launch once. A create-only launch
  marker is consumed before credential read or delegate import; any later
  failure remains terminal. Read only the previously authorized local key in
  memory after all gates, forward no unrelated environment, and sanitize CLI
  output. Keep corpus IDs/text, answers, private paths and credentials out of
  public docs/reports. Private artifacts retain all results and failure details.
- F5 Offline proof: use synthetic prepared inputs/ledgers and fake transport to
  test deterministic/disjoint selection, wrong hash/roster/checkpoint/runtime,
  projection over cap, duplicate/consumed launch, symlinks/permissions, no-key
  dry-run, exact delegate flags, output redaction, timeout continuation and
  global halt. Prove actual CLI delegation with fake HTTP, not just argv mocks.
  Never touch the real ledger or key in worker tests.
- F6 Interpretation: report all six fixed-N outcomes per arm, completed and
  judged counts, correct/wrong/unresolved separately, phase errors, reserved
  and known/unknown costs, truncation and candidate/packed observations. The
  internal completion checkpoint is at least 95% in every arm (6/6 for this
  small N), not 95% accuracy. A failed checkpoint blocks scale-up, not continued
  read-only diagnosis. Preserve every failure and do not tune on or rerun this
  roster. No superiority claim from six cases or unlike historical cohorts.

## Scope and delivery

Allowlist: this plan; new maintainer-only `evaluation/live/reliability-smoke.mjs`
and `evaluation/live/reliability-smoke-cli.mjs`; focused new tests under
`evaluation/live/test/`; technical `docs/fresh-reliability-smoke.md`; narrow
`docs/limitations.md` and `ROADMAP.md` gate/status entries. Private artifact
preparation belongs in a new operator directory, never the repository. Reuse
existing preparation/scoring/guard modules without editing them. If the existing
interfaces cannot satisfy the contract, report the specific gap to primary
before broadening code, not to the user unless new authority is needed.

Worker reads CONTRIBUTING and applicable scripts documentation before execution;
traces preparation, CLI, case-capability and shared-ledger call sites; records
commands and failures. Run generic, JSON/strict plugin, live-evidence-offline,
LongMemEval and public comparison demo gates on both supported Node runtimes.
Primary inspects actual diff and personally reruns key integrated paths.
Freeze scoped candidate; independent Standards and Spec review the same full
fixed-base diff. Fix/reverify/rereview before dependent draft PR and exact-head
CI. No merge, publication or deployment.

Before paid execution, separately freeze the private launch identity/checkpoint,
hashes and exact reviewed runner SHA and verify its dry-run with independent
review. Paid permission already exists inside the cumulative user ceiling; do
not ask again merely to take this scoped step. Missing credentials or a budget
anomaly halts paid work, while safe in-scope offline work can continue.

## Resume protocol

Read this plan, current worktree/HEAD/status, dependency PR and exact-head CI,
then the latest evidence record before acting. Record actual owner/model/effort,
candidate, tests/reviews, private artifact pointers and next command after each
gate. Never infer a launch did not happen from a missing final report: inspect
the durable marker and ledger. Retain all failures and checkpoint history.

Next after the smoke: diagnose observed stages without rerunning its cases;
advance to matched fresh comparator preparation if completion permits, or
repair the specific failure under a new frozen contract. S2 navigation proposals
remain separately measured, not an excuse to postpone this first measurement.
