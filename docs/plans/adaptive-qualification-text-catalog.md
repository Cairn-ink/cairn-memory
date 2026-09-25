# Adaptive qualification text catalog — F contract

Status: pre-edit contract, dependent on accepted PR232 runtime.
Fixed base: `767f1e16b67a024ca30de30bca57151a906dee3f`.
Branch: `feat/adaptive-qualification-text-catalog` in its dedicated worktree.
Primary owns this contract and acceptance; one GPT-6 Sol/high worker implements.
No paid launch, merge, release or deployment is authorized by this packet.

Purpose: rescue bounded repeated-source qualification requests without adding
model calls, dropping source material, or merging source identities. This is
not a full solution for unique-source capacity, semantic reliability, MOC
navigation, or matched benchmark performance.

## Frozen acceptance

- F1 Identity: retain the current immutable inline candidate snapshot and every
  original item/candidate ID, order, role and candidate-to-receipt/span mapping.
  A deterministic exact-string dictionary may share text bytes only. Expanding
  the catalog reconstructs every original model-facing candidate byte-for-byte.
  Equal text from different receipts, events, roles and items remains distinct.
- F2 Strict representation: explicit inputMode text-catalog-v1, bounded texts,
  item metadata and candidateIndex/role/textIndex entries. Canonical dictionary
  order is first occurrence during original item/candidate traversal. No unused
  strings or duplicate dictionary strings; repeated references ARE allowed.
  Validate dense own-data arrays/objects before serialization, correct types,
  well-formed text and bounds, exact allowed keys, and every index in range.
  Reject rather than repair malformed input. No source normalization change.
- F3 Opt-in compatibility: default model behavior and models without the new
  optional synchronous fit capability retain the old one-call inline path.
  OpenAI adapter option qualificationInputMode defaults to 'inline'; the only
  additional accepted value is 'adaptive-text-catalog-v1'. Only that opt-in
  exposes fitsQualificationRequest. Reject unknown option values at creation.
  Core builds the candidate representations, does its own logical token check,
  and selects inline first if both logical and full-wire checks fit. Try catalog
  only otherwise, and refuse locally if neither fits. No model call before the
  choice, no fallback/retry after dispatch, no batching or extra physical calls.
- F4 Single serializer: optional fitsQualificationRequest uses exactly the
  request preparation that invoke dispatches, including mode instructions and
  evidence-pool-v1 schema. It must be local, synchronous, detached and side-effect
  free: no HTTP, key access, ledger reservations or diagnostics writes. It is
  only a planning hint; unchanged callModel and adapter checks remain final.
  Preserve the present logical6000/count-body6000/provider7024/output1024 gates;
  do not accidentally impose a different generation-body limit or relax one.
- F5 Interpretation: instruct the model to resolve each textIndex through texts,
  preserve per-candidate role and original candidate IDs, and treat source text
  as untrusted data. The existing output pool representation, original-ID
  validation, core semantic compiler and anchored receipts remain unchanged.
  No claim that model interpretation is equivalent merely from a roundtrip.
- F6 Failures: preserve one capture deadline/cancellation, no partial admission,
  output bounds and finite safe error reporting. Invalid fit returns/throws or
  mutations must not inject arbitrary replacement input or bypass trusted mapping.
  Fake-HTTP mutation after snapshot cannot alter candidate/source bindings.
- F7 Scope of authority: DO NOT relax existing v1 paired guard or ordinary grants.
  A catalog request through existing guards must still fail before transport.
  Shared schemasFor is also used by the guards: adding catalog support to its
  default path would silently open non-pair grants. Require an explicit opt-in
  schema/preparation entrypoint used only by the configured adapter; the default
  qualifier schema entrypoint must reject named input modes. Freeze the minimal
  interface before code, and test actual old guard factories, not just a mock
  denial. This must not require a guard-runtime change in F.
  This packet may implement the explicitly opted-in core/adapter path only.
  A later separately contracted profile/versioned launch plan will bind adaptive
  mode before an operational paired run; old capabilities are never upgraded.
  No CLI default, installed host default, provider model, price, budget, old
  artifact, ledger or benchmark dataset change in this packet.
- F8 Observable red/green: fixed synthetic repeated5x4x800 fixture (SHA-text,
  mixed roles and distinct event IDs) refuses inline and traverses actual
  opt-in core+adapter+fakeHTTP catalog under both unchanged local checks,
  decodes and compiles exact source anchors. Include warm/cold synthetic capture
  source inspection where admission is exercised. Fitting inline stays inline;
  all-unique oversize refuses without HTTP/admission. Test nontrivial IDs,
  malformed catalogs, cross-item refs, all-unknown citation rules, legacy models,
  callbacks/abort/output failures and old guard denials. Measure work and token
  counts without claiming provider counts or semantic quality.
- F9 Delivery: worker and primary run affected core/OpenAI/guard/MCP/artifact/live
  and installed-rationale tests plus required demos, generic/JSON/pinned plugin
  on both Node22.16 and24.15. One owner, tracked pre-edit contract, clean candidate,
  independent fixed-base Standards and Spec reviews, affected correction gates,
  dependent PR and all exact-head CI. No merge/release/deploy. A new artifact and
  separately frozen synthetic compatibility run are later gates, not waived.

## Frozen interface

The optional core-facing capability is
`fitsQualificationRequest({ system, input, maxOutputTokens: 1024 }) -> boolean`.
It receives a detached request built by core, never the trusted source snapshot.
Only strict booleans are accepted; a promise, nonboolean, getter failure or throw
fails locally with a finite public error, not a fallback or provider dispatch.
The optional capability must be an own-data callable. An inherited property,
including an inherited getter or function, fails locally without invoking it;
only a genuinely absent property retains the legacy inline path.
Recheck the capture deadline before and after tokenizer/fit callbacks, including
on throws. Keep `callModel` unchanged and authoritative. Fit uses the configured
qualification model profile, complete instructions and output schema, matching
the actual count-body serializer; it does not count a hypothetical old format.

Use `snapshotQualificationTextCatalog` (pure core helper) to validate/detach an
explicit catalog and expand it without changing IDs/roles. A separate adapter
`schemasForQualificationInput` opt-in entrypoint may resolve a validated catalog
for the unchanged output schema; default `schemasFor('qualifyCandidates', ...)`
must reject any named inputMode. The adapter's default configuration must also
reject a catalog request. These interface names are fixed for this packet;
do not silently widen old shared schema/guard behavior. Shared request
preparation is qualifier-only: preserve unrelated method framing byte-for-byte.

## Frozen file boundary

Production: core/qualification-candidates.mjs; new pure
core/qualification-text-catalog.mjs; adapters/openai/index.mjs and schemas.mjs;
packaging/artifact-files.json. Share qualifier-only request preparation inside
index.mjs between fit and dispatch; do not add a general serialization framework.

Tests: new core/test/qualification-text-catalog.test.mjs and
adapters/openai/test/qualification-text-catalog.test.mjs; existing
core/test/capture-qualification-v2.test.mjs,
evaluation/live/test/qualified-source-budget-boundary.test.mjs,
evaluation/experiment-budget/test/candidate-qualification-guard.test.mjs,
evaluation/experiment-budget/test/qualified-source-pair-guard.test.mjs,
packaging/test/install.test.mjs.
Docs: this plan, docs/qualification-evidence-pool.md, docs/limitations.md,
CHANGELOG.md. Trace other affected tests/callers before proposing any extension.

Keep core/model-call.mjs, core/capture.mjs, receipt/compiler/storage semantics,
guard/ledger runtime, operational launchers, profiles, MCP and host defaults
unchanged. No broad abstraction, dependency/version bump or unrelated cleanup.

The positive catalog path uses standalone fake HTTP. Old actual guard factories
are negative controls, not a way to dispatch the new mode. Side-effect freedom
is an implementation property of Cairn's adapter; core cannot sandbox arbitrary
third-party callbacks, but must detach input, reject invalid results and check
deadlines. The repeated fixture uses identical candidate text bytes across
distinct receipts/events/mixed roles; generating new SHA text per event is not
a deduplication-positive fixture.

## Prior E acceptance — retained, not an F result

PR232 exact base passed primary gates, independent Standards/Spec, and all21 CI
checks; ready and unmerged. A separately frozen new installed-artifact probe
then called the real pinned provider once on three synthetic shapes1x1/4x4/5x1.
All3 compiled exact original source anchors. Physical requests6; reserved
US$0.030000; known actual US$0.004670;3 count costs unknown;0pending.
Local complete-body tokens2063/3066/3015; provider counts1609/2435/2341.
Supplied/selected source candidates1/1,16/16,5/5. No extraction, answer or judge
was called. This is compatibility evidence, not semantic quality or MOC recall.

Plan SHA11ea08899e700288273ef20f0ae51598751e54397ccac9618e5d43f9ffce9633;
report SHAbdbe2d4d7ba8a5c43b6962e5ca70c02b454b95786f83f1ad5098d3d37adb8061.
Primary terminal audit preserves the entire previous12702-request ledger prefix.
These synthetic fixtures are terminal and must not be rerun or relabelled as F.

## After F

Before any paid catalog compatibility or paired development run, separately
implement explicit adaptive-mode authorization/profile and versioned plan pins,
with old-grant denials and installed/runtime/config/protocol identity checks.
Only after both packets pass their gates, verify the actual installed serializer
and model compatibility in a fresh frozen, bounded synthetic run under that
explicit guard. Never bypass the old guard to get an earlier compatibility score.
Do not reinterpret old fixedN outcomes, rerun old cohorts, or touch original30.
Only then use new preselected development cases for measured completion/quality,
followed by the original30 once under the joint Cairn/comparator S3 protocol.

Remaining cumulative API headroom is last audited US$113.453540 of US$200,
including protected US$70 comparator and US$10 host. Reaudit before any fresh
paid plan; this draft grants no new spending, requests or credential access.

## Worker implementation evidence (offline candidate; primary acceptance pending)

The new pure `core/qualification-text-catalog.mjs` validates and detaches the
first-occurrence dictionary, then expands it back to unchanged inline candidate
IDs, roles and texts. `core/qualification-candidates.mjs` owns inline-first
selection and the authoritative original snapshot; `core/model-call.mjs` and
the compiler did not change. `adapters/openai/index.mjs` prepares both fit and
dispatch with one qualifier-only serializer; `schemas.mjs` exposes the named
mode only through `schemasForQualificationInput`. Default `schemasFor` and all
old guard factories still reject the catalog. The artifact allowlist includes
the one new production helper and excludes test helpers.

Test ownership is: pure roundtrip, 100-candidate astral edge, malformed shapes,
fit callbacks and finite diagnostics in `core/test/qualification-text-catalog.test.mjs`;
source admission, anchored warm/cold inspection, replay and neither-fit rollback
in `core/test/capture-qualification-v2.test.mjs`; real opt-in adapter fake HTTP,
token fit, strict schema and provider failure in
`adapters/openai/test/qualification-text-catalog.test.mjs`; old candidate and
source-pair grant denials in their existing experiment-budget tests; installed
source-hash and adapter/core fake-HTTP proof in `packaging/test/install.test.mjs`.
Existing default candidate tests retain the original inline request path.

The fixed repeated SHA-text 5×4×800 fixture yields 80 candidates across 20
distinct synthetic receipt event IDs, with mixed roles; local logical tokens
are 2,935 and complete count-body tokens 4,757. The inline fit refuses while
the catalog fit succeeds, yielding exactly one fake count and one fake generation
call and original anchors. A separate surrogate-safe 800-unit receipt produces
five windows, exercising the 100-candidate validation ceiling. The all-unique
80-candidate fixture refuses before HTTP. Local fit may tokenize/serialize the
inline form and then the catalog form, with another authoritative dispatch
serialization; these measurements establish no CPU savings or provider count.

The initial new cold-inspection assertion assumed storage receipt order and
failed despite preserving all event IDs; it was corrected to check the receipt
set and the selected anchor's exact receipt ID, event, role and offsets. No
runtime failure was attributed to that test-only red. No paid call, real corpus,
operator ledger or legacy artifact was used. This packet neither authorizes an
adaptive paid guard nor establishes real-provider interpretation or benchmark
quality.

Worker gate record, sequential on Node 22.16.0 and 24.15.0, all exit 0:

| Command (each runtime) | Result |
| --- | --- |
| `npm run test:core` | 717 pass |
| `npm run test:openai` | 224 pass, including final exact local-token assertions |
| `npm run test:experiment-request-guard` | 230 pass |
| `node --test evaluation/experiment-budget/test/*.test.mjs` | 255 pass |
| `npm run test:live-evidence-offline` | 338 pass, 30 existing optional skips |
| `npm run test:longmemeval` | 128 pass |
| `npm run test:mcp` | 91 pass |
| `npm run test:artifact` | 83 pass, including installed catalog |
| `CAIRN_RATIONALE_INSTALLED_OFFLINE=1 node --test evaluation/live/test/rationale-pilot.test.mjs` | 4 pass |
| `npm test`; `npm run validate`; `npm run validate --prefix tools/plugin-validation` | 112 pass; JSON/version valid; pinned local Claude Code 2.1.260 strict validation pass |
| `npm run demo:store`; `npm run demo:capture`; `npm run demo:openai-offline`; `npm run demo:experiment-budget`; `npm run demo:experiment-request-guard`; `npm run demo:longmemeval-public` | all pass with synthetic data |

Preparation used isolated `npm ci --prefix adapters/openai`,
`npm ci --prefix adapters/mcp`, `npm ci --prefix tools/plugin-validation`
and `node packaging/prepare-cache.mjs` (public package metadata only).
Focused additions and `git diff --check` also pass. The primary's independent
exact-head gates and reviews remain subsequent acceptance steps, not worker
evidence already claimed here.

### First independent review correction

The first committed candidate `61c133a` passed Standards but its Spec review
found that an inherited `fitsQualificationRequest` getter was treated as absent.
The primary's synthetic red control observed one legacy model dispatch instead
of local refusal. New focused red tests reproduced that behavior for inherited
getter/function and proxy `has` traps. The bounded correction performs an
own-property descriptor lookup plus `Reflect.has` only when absent, checks the
deadline after those traps, and rejects inherited or failed lookups once with
`token_count_unavailable`; it never invokes the inherited value. A truly absent
capability still takes the original inline path. No other production path or
paid guard changed. The prior full gate matrix belongs to `61c133a`; affected
checks and independent reviews must be repeated for the correction commit.
Worker correction gates, both Node 22.16.0 and 24.15.0: the three affected
core test files passed 28/28; the full OpenAI suite passed 224/224; generic
tests passed 112/112; JSON/version and pinned Claude Code 2.1.260 strict
plugin validations passed. The two new tests were red on the old candidate
and green after this change. The primary will rerun the complete exact-head
matrix before new independent reviews.
