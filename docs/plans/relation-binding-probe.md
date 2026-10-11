# Relation-bound first-answer diagnostic

Status: implemented offline candidate; primary acceptance and paid execution
remain pending. No operational preparation, credential lookup or provider call.
Dependency
base: `47a4eb14db3fc69d8538222f55a4b29c8ab4ec12` (PR #394 results candidate).
Worktree: `cairn-memory-worktrees/relation-binding-probe`; branch:
`experiment/relation-binding-probe`. Primary DRI owns acceptance.

Primary contract, fixed before implementation. This is not a causal finding,
Stage 2 acceptance or permission to rerun closed D01–D24, L01–L06 or the closed
16-answer format probe. A repository copy must be committed before paid work.

## Decision and prediction

Pause complementary-ranking tuning: the closed comparisons show no C-minus-B
answer gain, and the latest six consume more answer input without more correct
answers. Retain both histories. D12 demonstrates an unsupported entity join
after its relevant sources were delivered. Its natural failure has not been
reproduced; nesting, ordering, instruction and model-internal causes are unproven.

Test one generic instruction change at harness answer consumption. Prediction:
explicitly requiring supported entity/time/scope joins will reduce incorrect
bindings without making answerable relations disappear into abstention. The
alternative is no improvement, or worse known-answer usefulness. This does not
modify core MOC, storage, recall, sources or their authority.

## Acceptance contract

- RB1: Twelve freshly authored source/question cases, R01–R12, one first answer
  per arm, 24 fixed answer slots. Six genuinely supported relation questions and
  six missing/unknown/conflicting/out-of-scope relation questions. Corpus author
  independent of instruction implementation; freeze before any paid output.
  Each question asks the relation being tested, not optional background. Source
  text and evaluator-only bindings/rubric live separately. No old case reuse or
  designation as independent holdout. At most six submitted source units/case,
  4,000 Unicode source characters/case; normal untrusted quoted role text with
  explicit dates. Two entity identifiers alone do not establish identity.
- RB2: Control is the exact existing answer instruction/request builder.
  Treatment appends one versioned, generic relation-binding instruction: bind
  requested subject/property to its time and scope; use only source-supported
  joins or explicitly stated equivalences; do not borrow a neighboring entity's
  value for a missing link; preserve supported partial answers and uncertainty.
  Both keep the existing untrusted-data rule, same question/evidence/order,
  model, temperature, n=1 and output allowance. Only system instruction differs.
  No answer-specific names, gold IDs, semantic verifier or second model call.
- RB3: Closed opt-in builders/transport select the instruction consistently
  during preparation and dispatch. Never rewrite an already-accounted HTTP
  request. Default exports, existing profiles and old exact request bytes remain
  unchanged. Use existing guarded transport/accounting, not a second ledger or
  arbitrary caller-supplied system prompt. No public product/default change.
- RB4: Answer-only diagnostic with full submitted sources, not natural capture,
  cold retrieval, MOC quality or end-to-end score. Counterbalance first arm 6/6.
  Freeze and hash all 24 exact final requests; enforce 6,000 local / 7,024
  provider input and 512 output tokens including the treatment instruction.
  No source omission or post-result top-up; if the profile cannot fit, fail
  offline before launch. Each slot dispatches at most once, no retry/resume.
- RB5: Exactly at most 24 answer HTTP attempts, $0.12 request reservations at
  $0.005 each, $1 local ceiling; retain original cumulative $400 ledger and
  protected $30. Existing shared transport affordability requirements also
  apply; do not relax them. Request/case/run deadlines remain bounded. Persist
  start and exact-source identity before explicit key lookup. Accounting,
  authentication or persistence anomalies stop all; all 24 slots remain counted.
- RB6: Fresh two nonauthor blind judges give first independent verdicts using
  the full source and required requested-relation rubric. Separate requested
  correctness, unsupported/stale/severe claims and abstention on known cases.
  Missing/disagreeing judgments remain unresolved without favorable adjudication.
  Report all twelve paired outcomes, six known and six uncertainty controls,
  exact context/call/token/cost/latency differences; no pooling with old studies.
  The closed new judgment schema includes `bindingError: boolean | null`, judged
  independently for the requested entity/time/scope relation. Generic wrongness
  or an unsupported unrelated optional claim does not imply this field. Both
  judges must agree; disagreement/missing/unknown stays unassessed and blocks signal.
- RB7: Positive signal requires baseline targeted incorrect/unsupported binding
  on at least two distinct source cases, positive paired correct-answer gain,
  no newly incorrect known-answer case, no increased unsupported/stale count,
  no new severe error and no correctness/safety unknown, with all resource and
  request-integrity checks. If baseline lacks those opportunities, report
  inconclusive; if no positive QA gain, stop this instruction branch instead
  of tuning/rerunning these cases. A gain only justifies a fresh full-pipeline
  validation, not promotion, D12 causal repair or bypassing Stage 2 gates.
  Prospectively accepted usefulness clarification: treatment `knownCorrect > 0`
  and treatment known-abstention count no greater than control, alongside the
  per-case known-answer check. This rejects universal abstention without requiring
  perfect 6/6 known answers. No paid outputs informed this clarification.
- RB8: Offline tests inspect actual serialized requests at dispatch, ensure
  only the system instruction differs, and fail when treatment is disabled.
  Test real guarded fake-HTTP single-call behavior, failure denominators,
  immutable sources and gold exclusion. Evaluator controls must reject wrong
  joins and always-abstain on known cases. These do not simulate model quality.
  Owned scratch cleanup covers success/failure. Both Node versions and exact
  fixed-candidate independent Standards/Spec review precede any live manifest.
- RB9: One bounded GPT-6.1 Sol/high implementation owner; independent source
  author; primary integration and direct acceptance. Preserve existing main and
  frozen runtime worktrees. Use one dependent PR, no merge/release/deploy. Paid
  execution follows reviewed immutable manifest, latest-head CI and affordability.

Implementation scope should remain a small named instruction/request-builder
variant, matching opt-in transport seam and focused tests, plus frozen source,
rubric and a reusable answer-only harness. Do not add a graph store, new core
relationship taxonomy, alternate provider, larger model or unconditional answer
rejection. If reuse requires broad changes, return to primary for re-scoping.

## Frozen source interface and ownership

The source file is `relation-binding-cases.json` under
`evaluation/algorithm-development/`, with shape
`{ schemaVersion: 'relation-binding-probe-v1', cases: [...] }`. Each case has
only `id`, `family`, `question: { text, date }` and `sourceUnits`; each source
unit has only `recordedRole` (`user` or `assistant`), explicit UTC `eventAt`,
and `text`. Model-facing input excludes case IDs and family metadata.

The separate evaluator file is `relation-binding-rubric.json`, with shape
`{ schemaVersion: 'relation-binding-probe-v1-rubric', cases: { R01: ... } }`.
Each rule has `answerability` (`known` or `uncertain`), nonempty
`requiredPropositions`, and string arrays `acceptableQualifications`,
`unsupportedClaims`, `staleUseCriteria` and `severeErrors`. This file is not
imported into model execution. The independent corpus author owns those two
files, `test/relation-binding-corpus.test.mjs` and
`docs/plans/relation-binding-fixtures.md`; runtime author does not edit them.

Runtime owner may add closed source-profile/probe/evaluator modules and tests,
make the small named opt-in request-builder/transport changes, and update this
plan plus evaluation README/limitations/roadmap. No fixture edits, core changes,
adapter changes, dependencies/locks, CI, old profiles/corpora/rubrics, ledger
implementation, production or private-product files. Primary integrates the
independent corpus and personally verifies the full final candidate.

## Runtime implementation checkpoint

Implementation owner: actual GPT-6.1 Sol/high, isolated branch/worktree and fixed
base above. Primary owns corpus integration, final inspection, commit, dual
review and paid decisions. The worker read the shared worktree workflow/model
routing and repository CONTRIBUTING/CONTEXT before editing; no additional
workers were dispatched. Author token/cost usage is unavailable.

`packRelationBoundAnswer` shares the ordinary packer's validation, whole-unit
packing and request shape with one fixed appended system instruction. It exposes
no arbitrary prompt argument. The transport alone replaces its private positional
flags with named modes; old exported factories still select unchanged old modes.
`createRelationBindingTransport` selects the new builder only for arm `relation`,
denies all core model methods, and permits exactly R01–R12 with balanced first
arm order and at most one answer per arm. Actual attempts are capped at 24 and
$0.12 reservations; original $10/1,968-request affordability remains required.

Caller path: source-only profile -> `planRelationBindingAnswers` -> exact ordinary
or named treatment packer -> `prepareRelationBindingProbe` immutable manifest ->
`executeRelationBindingProbe` exclusive durable start -> explicit credential port
and rechecks -> closed guarded transport -> same chosen packer -> exact-byte HTTP
dispatch. No capture, MOC, retrieval, installed host or browser flow is touched.
The existing transport tests and mixed-answer byte tests own old caller regression;
new focused tests own this diagnostic contract. Existing hashing, descriptor-safe
JSON snapshots and owned workspace/Git helpers are reused. The small private
owned-directory/exclusive-fsync seam is copied locally from the existing launch;
no generic launch, ledger or provider engine was introduced.

Preparation hashes the full tracked runtime/control closure, source/rubric bytes,
protocol, Node executable and all 24 final request bodies. Rubric bytes are opaque
hash input only; model execution never parses/imports rubric or evaluator. Failed
post-marker launches retain detached sources and all 24 slots. Report persistence
collision is not overwritten or retried; closure reports availability separately.
Explicit review receipts attest two distinct reviewer IDs; they do not authenticate
reviewer identity or grant spending. Neither API discovers environment credentials.

Precommit integration correction: independent source timestamps use canonical
UTC milliseconds (`...:00.000Z`). The runtime now accepts these plus canonical
seconds with strict round-trip validation; invalid normalized dates are rejected.
No independent source text/question was rewritten and no model run occurred.

Tradeoff retained from old D10: requested-answer correctness and source support
are distinct. A stricter relation instruction can abstain when a needed join is
not packed, reducing requested usefulness even while removing unsupported detail.
Known-relation controls and claim-support judgments measure this separately;
old D10/D12 verdicts and every closed study remain unchanged. Offline scripted
outputs establish plumbing and evaluator behavior only, never model QA or cause.

Primary acceptance corrections before freeze: RB7 classification now rejects
known-answer/safety/resource/integrity regressions before checking a baseline
ceiling or equal QA; tests cover equal-QA/new-severe and ceiling/known-loss.
Negative paired QA also rejects even without baseline binding opportunities;
an uncertain compound-answer omission is the explicit prospective control.
The evaluator uses an exact-byte rubric freeze (`bytes`, `sha256`, parsed `rubric`)
and verifies it against the report's recorded rubric hash. Answer execution copies
only source/rubric identities from the existing manifest; it never parses gold.
Unblinding rejects extra fields, duplicate labels and supplied `cellId` overrides.
Fake verdict controls verify these mechanical contracts, not a real judge's
semantic discrimination.

Archive/current dependency correction round 1: existing complementary and
large-pool owned Git tests overlay current algorithm modules onto `git archive
HEAD`. Those overlays also need the current `mixed-answer.mjs` now imported by
transport. Each received one matching file copy without changed assertions or
corpora. Requested-answer and evidence-bundle fixtures do not overlay transport
and need no change. This is a precommit fixture setup correction, not a paid
experiment failure or a change to old results.

## Worker verification record

Verified offline in the isolated worktree at integrated corpus HEAD
`253e87e4f96ab215de7cf6d5255e903a7e45e6c1`, with uncommitted runtime changes.
Commands used the owned `tools/testing/run.mjs` and explicit Node 22.16.0 or
24.15.0 executable/PATH, `NODE_DISABLE_COMPILE_CACHE=1`; no install, operational
ledger, real key, paid prepare or live model execution occurred. Exit codes
below are actual process exits, not inferred from stdout tails.

| Check | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| Initial full `npm run test:algorithm-development` | exit 1; 116/118 pass | exit 1; 116/118 pass |
| Corrected affected complementary/large-pool and new runtime/builder files | exit 0; 20/20 | exit 0; 20/20 |
| Corrected full `npm run test:algorithm-development` | exit 0; 118/118; 299.930 s | exit 0; 118/118; 299.712 s |
| Final three relation runtime/corpus/builder files | exit 0; 16/16; 13.690 s | exit 0; 16/16; 13.397 s |
| Full `npm run test:longmemeval` | exit 0; 212/212 | exit 0; 212/212 |
| `npm run validate` | exit 0 | exit 0 |
| Disabled-treatment `red-capable` negative | exit 1; one expected assertion failure | exit 1; one expected assertion failure |

The initial two failures were the archive/current dependency mismatch documented
above, not failed model assertions. The final three-file command was
`node tools/testing/run.mjs evaluation/algorithm-development/test/relation-binding.test.mjs evaluation/algorithm-development/test/relation-binding-corpus.test.mjs evaluation/longmemeval/test/relation-binding-answer.test.mjs`.
It directly covers the last negative-QA classification correction; the full
algorithm regression runs began before that small correction. A separate final
`--test-name-pattern=RB6/RB7` run also exited 0, 1/1 on both Nodes. The expected
negative used `CAIRN_RELATION_CONTROL_DISABLED=1` with
`--test-name-pattern=red-capable` and the builder test file. These are structural
red/green controls, not natural reproduction or new model-quality evidence.

All 24 independently authored requests fit offline, with maximum 710 planned
local input tokens. Token fit is not observed provider usage. Git diff/untracked
inventory was independently matched against filesystem Git-blob hashes plus
new-file discovery: 17 integrated changed files, comprising 13 runtime-owner
files and four untouched independent corpus files. `git diff --check` exited 0.
No core/MOC, adapter, dependency, lock, CI, default, old rubric/scorer or ledger
implementation changed. Primary final combined matrix, independent reviews,
commit/CI and any spending decision remain separate acceptance gates.
