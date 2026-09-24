# Fresh reliability development smoke

Fixed base: `2b2467400c68a8cc8c1601044deda350efc87718` (native Hermes recovery).
Branch: `test/fresh-reliability-smoke`. Primary owns scope, acceptance and any
paid launch; a GPT-6 Sol/high worker owns the bounded maintainer implementation.
Implementation began only after the dependency's reviews and exact-head CI
passed. Paid launch remains a separate primary-owned one-shot step.

Official model pages checked on 2026-09-25: [GPT-4.1 mini](https://developers.openai.com/api/docs/models/gpt-4.1-mini)
lists standard text input/output US$0.40/1.60 per million tokens and snapshot
`gpt-4.1-mini-2025-04-14`; [GPT-4o](https://developers.openai.com/api/docs/models/gpt-4o)
lists US$2.50/10.00 and snapshot `gpt-4o-2024-08-06`. These match the existing
guard's memory/answer and judge rates. Cache discounts are not assumed; count
requests with unknown billed cost remain conservatively reserved. Documentation
does not establish account access, remaining provider credits or actual billing.

## Goal and checkpoint

The goal remains a lightweight, source-backed memory layer usable by Hermes
and other harnesses, with reliability measured against existing solutions, not
100% semantic accuracy. The master sequence is the proposed
[comparative plan](https://github.com/Cairn-ink/cairn-memory/pull/205): mechanical
repair (S1), trace/navigation (S2), matched comparator (S3), installed growth
(S4), and honest preview/onboarding (S5).

The native candidate passed independent Standards and Spec review and primary
22-case installed pinned-Hermes tests on Node 22.16 and 24.15. Dependency PR
#216 at `2b2467400c68a8cc8c1601044deda350efc87718` passed all 17 exact-head
CI checks (run `36072917284`, attempt 1); the primary accepted the finite S1
mechanical gate. The separate read-only S1 audit mapped
canonical source refs, observable partial admission, initial classification
journal, explicit bounded recovery, repeat/stale/correct/delete/namespace guards
and late-write fencing to existing core/MCP/native tests. This accepts only
that finite mechanical gate, not semantic truth or all S1–S5 milestones.
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
  The wrapper's dry-run omits case-deadline and transport-diagnostic delegate
  flags, because the existing delegate can provision a missing capability with
  those flags. It independently verifies the new capability, claim and launch
  marker are absent and compares ledger and grant names before and after
  delegation. This read-only dry-run does not prove capability issuance. Launch
  supplies the complete one-shot case-deadline flags and bounded diagnostics;
  synthetic fake-HTTP tests must verify the actual delegate schedule/checkpoint.
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

## Implementation evidence checkpoint

### First-review correction contract (before implementation)

Both reviews inspected `a30f256` over the original fixed base. Standards found
one low naming heuristic: the output collector called `capture` can be confused
with memory capture. Rename it to reveal its bounded-output purpose. Spec found
an F4 retention gap: a delegate preflight failure after the outer launch marker
can precede creation of its output directory, losing the captured diagnostic.
Primary accepts both findings. No paid launch has happened.

Within the same allowed wrapper/tests/technical docs, preserve terminal
post-marker failures in a new create-only private 0600 artifact in the plan's
0700 directory. Retain bounded phase/exit/diagnostic information even when the
delegate created no output; retain the marker and prohibit relaunch. Redact the
actual provided credential from retained diagnostics as well as public output;
do not persist raw arbitrary exception messages. Dry-run and pre-marker
rejections remain read-only and must not create failure artifacts. A collision
or failure to persist must remain an explicit terminal error, never overwrite
an artifact, reissue authority or retry. Verify these boundaries with fake
delegate failures, thrown errors, missing output, synthetic credentials and
duplicate launch, then rerun affected gates on both runtimes and both full-base
independent review axes. No core, model, scorer, ledger or provider change.

Owner: GPT-6 Sol/high bounded maintainer worker; fixed base
`2b2467400c68a8cc8c1601044deda350efc87718`. The candidate commit is the
worktree `HEAD` handed to primary after freeze; independent review and a paid
launch have not yet occurred. The primary privately audited the six-case
source/preparation/evaluator/sidecar mapping and an open, settled shared ledger;
no private IDs, paths or source-derived digests are recorded here. The frozen
six-case reservation projection is 1,172 requests and 6,781,960 micro-USD,
within the US$12/2,000 phase ceiling and remaining recorded operational
allowance. Projection is a bound, not an invoice or score.

The worker's synthetic fake-HTTP tests prove actual public-pilot CLI
delegation, read-only keyless dry-run, closed selection and hashes, phase
projection refusal, one-shot marker and case claim, 0644 authorized-key file
preservation, fixed output redaction, global unknown halt and genuine core
deadline isolation with later-case continuation. The default embedded path
has at most extract plus initial classify per batch, two selects plus one rank
per recall, three answers and three judges; each Cairn model method makes at
most one count and one generation request. Thus `4b+12` requests and the
existing reservation formula bound a case with `b` capture batches. The
public runner's phase projection check and cumulative ledger guard remain in
force; no new guard or model path was added.

Node 22.16 and 24.15 each passed the final focused eight-case synthetic test
file. On each runtime, the broader live-evidence-offline suite passed at the
preceding candidate state (342 tests: 312 passed, 30 existing skips); the
later changes were confined to focused test assertions and fixture coverage.
Generic tests passed 112/112, LongMemEval passed 75/75, JSON and strict
marketplace/plugin validation passed, and the synthetic public comparison
demo completed. One intermediate focused assertion used a nonexistent
`summary.blocked` field; it was corrected to the actual `generationBlocked`
and `halted` fields before the full gates. No unresolved gate failure remains.
The only allowed next delivery step is the primary's direct diff acceptance,
fixed-base independent Standards/Spec reviews and affected-gate rerun on the
frozen candidate. The primary owns the private launch-plan generation and any
eventual paid launch after those gates.

Executed on Node 22.16: `npm test`, `npm run validate`,
`npm run validate --prefix tools/plugin-validation`,
`npm run test:longmemeval`, `npm run demo:longmemeval-public`,
`npm run test:live-evidence-offline`, and
`node --test evaluation/live/test/reliability-smoke.test.mjs`. Node 24.15 ran
the same underlying scripts through its absolute `node` binary, and strict
validation through its own `npm-cli.js`. Offline `npm ci --prefix` installed
the isolated OpenAI, MCP and plugin-validation tooling; no dependency manifests
or locks changed.
