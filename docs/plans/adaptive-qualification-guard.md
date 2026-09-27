# Adaptive qualification experiment guard — G

Status: primary pre-edit contract, frozen before worker implementation.
Fixed base: `cf42dff7542764dcbc893b694868b1a64e4a1458` (accepted PR233).
Worktree: `adaptive-qualification-guard`; branch: `feat/adaptive-qualification-guard`.
PR233 has primary dual-runtime acceptance, independent Spec/Standards PASS and
all21 latest-head checks green. It is ready and unmerged. This is dependent work.
No paid launch, operational ledger migration, old claim reuse, merge or release.
This is a narrow new profile, not another benchmark runner or a Mem0 comparison.

## Acceptance

- G1 Explicit authority. Provide new authorizeAdaptiveQualifiedSourcePairCapability
  and createAdaptiveQualifiedSourcePairExperimentRequestGuard entrypoints.
  Existing authorize/createQualifiedSourcePair* remain exact v1. New capability
  version is qualified-source-pair-adaptive-case-v1, methodProfile is
  qualified-source-pair-adaptive-v1. The configured input profile is exactly
  adaptive-text-catalog-v1. Use a distinct binding/claim filename namespace and
  claim version. An old factory rejects a new grant and vice versa, before a
  claim or provider reservation. Never derive authority from request.inputMode.
- G2 Bound experiment identity. New capability binds an exact adaptiveContext:
  qualificationInputProfile, runtimeArtifactSha256, adapterConfigurationSha256,
  experimentDigest. All digests are lowercase SHA256. Derive the last digest
  from a domain-separated canonical record of the first three fields and the
  full existing normalized roster (including its inner v1 protocol digests).
  The pure exported helper is deriveAdaptiveQualifiedSourcePairExperimentDigest
  with one exact options object: qualificationInputProfile, runtimeArtifactSha256,
  adapterConfigurationSha256, roster. Normalize roster through existing pairRoster,
  then SHA256 of canonical(['cairn.lme.source-pair.adaptive.experiment.v1',
  { qualificationInputProfile, runtimeArtifactSha256, adapterConfigurationSha256,
  roster: normalizedRoster }]). Authorizer and verifier both call this same helper.
  Reject context/digest mismatch, unknown keys,
  missing profile and foreign capability. Keep the v1 inner roster/source/scorer
  protocol unchanged: the new context is an outer experiment identity.
  Artifact/config hashes bind declared identity; they do not independently
  inspect files or certify configuration. A future installed helper must verify
  actual artifact/source receipt/configuration bytes before issuing the grant.
  The later configuration digest covers a frozen non-secret serializable model/
  mode configuration, never an API key, transport callback or raw source data.
- G3 Dispatch. Only the verified adaptive factory selects
  schemasForQualificationInput for qualifyCandidates. It accepts both canonical
  inline and strict text-catalog-v1, since F is inline-first, but not arbitrary
  named modes. Other methods, arm-specific indexed extraction, endpoints,
  model pins, output shape, source compiler, and model ceilings stay unchanged.
  Ordinary and v1 pair guard factories still reject actual catalog count and
  generation bodies before forwarding/reserving. No schema-only mock denial.
- G4 Resource boundary. Retain shared cumulative bound ledger, historical prefix
  checks, settlement, one-shot claim, timeouts, late-child denial, route/stage
  scope, and no retry/refund semantics. New qualifier requests enforce the same
  logical6000 and count-body6000 maximum; for generation, measure the equivalent
  count body excluding max_output_tokens/store/stream. Provider7024/output1024
  remain independently enforced by F and existing policy. Do not impose a new
  generation-body token ceiling or modify legacy dispatch behavior.
- G5 Compatible phase accounting. The returned guard may retain the generic
  qualifiedSourcePairCapability property only if its value is the fully verified
  new capability, never a fabricated v1 alias. The existing phase quota is not
  a grant verifier; prove that it delegates to the new guarded closures and
  still enforces unchanged phase/campaign caps, with no plain-object upgrade.
  Do not rewrite the old launcher to use this mode. No default host/MCP change.
- G6 Observable positives. Synthetic temporary ledger plus actual F core/adapter
  through the new guard must complete a fitting-inline case and a repeated-
  source catalog case, exact original candidate/receipt/role/offset anchors,
  one count plus one generation each, conserved terminal reservations, no
  additional HTTP or hidden fallback. Test the same real installed artifact
  path (fake HTTP only) with byte/hash checks. Include positive temporary-ledger
  controls for both already-supported parent forms: the US$100 extension and
  the US$200 chained extension; retain a nonempty prior-history prefix unchanged.
  These are synthetic ledgers, not changes to the operator's budget. No output/
  QA truth claim.
- G7 Observable negatives. Old/new grant cross-use, malformed/noncanonical
  catalog, altered profile/context/digest/binding, wrong model/route/method/arm,
  duplicated/foreign candidate IDs, missing scope, repeated claim, policy/parent
  drift, unclosed request, exhausted phase/campaign cap, timeout/late callback,
  and source mutations fail at their defined boundary. Claim races use separate
  processes; exactly one winner. Preserve fail-closed states; do not hide a
  legitimate consumed claim from a failed launch. All data and ledgers synthetic.
- G8 Scope and evidence. Change only guard runtime, its new focused tests,
  existing negative controls as necessary, focused phase-quota/installed tests,
  the root standard guard test command to include the new test, and
  docs/plan/changelog. No ledger schema, actual operator files, source
  roster, corpus, paid entrypoint, dependency/version, core/adapter behavior or
  operational launcher change. Existing embedding-ledger work is separate.
- G9 Delivery. Both Node22.16/24.15 generic/JSON/pinned plugin, core/OpenAI,
  full budget/guard, LongMemEval/MCP/artifact/live and installed rationale suites,
  applicable demos, primary direct positive/negative acceptance, independent
  fixed-base Standards and Spec, latest-head CI and mergeability. No paid call
  follows automatically; a fresh one-shot installed compatibility plan and
  actual remaining budget audit are later prerequisites.

## Frozen bounded file list

Frozen entrypoint shapes: the new authorizer takes existing v1 authorization
fields plus required adaptiveContext. The new factory takes the existing v1
factory fields except that adaptiveQualifiedSourcePairCapability replaces
qualifiedSourcePairCapability; keep transportDiagnostics/installedCoreDeadline
as the existing explicitly validated optional fields. Do not accept both grant
keys. Returned generic qualifiedSourcePairCapability, when present for the
existing phase-quota interface, is exactly the verified adaptive record, with
its distinct version/profile/context. It is not convertible to a v1 grant.

evaluation/experiment-budget/request-guard.mjs
package.json (append new focused test to test:experiment-request-guard only)
new evaluation/experiment-budget/test/adaptive-source-pair-guard.test.mjs
evaluation/experiment-budget/test/qualified-source-pair-guard.test.mjs
evaluation/live/test/qualified-source-pair-phase-quota.test.mjs
new packaging/test/adaptive-qualified-source-pair-guard.test.mjs
new docs/plans/adaptive-qualification-guard.md
docs/qualification-evidence-pool.md
docs/limitations.md
CHANGELOG.md

The root test:experiment-request-guard script enumerates files explicitly, so
append the new focused guard test there while preserving every existing entry.
This is required to run the new acceptance in ordinary CI, not only an ad hoc
all-tests primary command. No other root script or CI workflow changes.
The new focused installed test is covered by the existing test:artifact glob;
it constructs an inspected local archive/installation and verifies source hashes,
then uses actual installed F core/adapter behind G with synthetic ledger/fakeHTTP.
Keep the broad install.test.mjs unchanged. The phase-quota test proves delegation
and caps, not installed artifact identity. No new ordinary CI skip is needed.
Reuse private profile-parameterized machinery where it preserves old
bytes/invariants, but keep selection internal to explicit public factories.
No arbitrary caller profile flags or general-purpose grant framework.

Read-only feasibility review by checkpoint232_standards6 (GPT6Sol/high) found no
design blocker after these explicit digest/variant/installed-test clarifications.
F was accepted at the exact base above before this tracked contract/dispatch.
The primary additionally requires the normal CI script to include the new guard
file and positive controls for both supported synthetic parent forms.

## Next boundary

A separately frozen installed compatibility helper may consume new synthetic
fixtures once, max6 physical requests/30000microUSD conservative reservation,
with actual inline and catalog paths. It must verify artifact/source/config/
outer experiment identity, use stable experiment marker and current ledger
checkpoint, and preserve failures. Neither this plan nor offline acceptance
authorizes that launch. E fixtures remain terminal. Do not automatically run
another six-case development batch; complete S3+host budget feasibility first.

## Ownership and continuation

The primary owns this contract, integration, direct acceptance and current-head
CI. One bounded GPT-6 Sol/high worker owns implementation in the listed files,
sequential dual-runtime gates and a scoped local candidate commit, not push or
merge. Separate non-author Standards and Spec reviewers inspect the same full
fixed-base diff. The primary personally verifies the assembled guard, installed
path and ledger conservation before delivery. Record failures and exact tested
SHAs here; do not substitute old runtime checks for new-head affected evidence.

All fixtures, ledgers and HTTP in this packet are synthetic. No worker accesses
the operator ledger, keys, downloaded corpus, reserved30 or consumed runs. The
last earlier accounting checkpoint (not reread by this packet) was12708 terminal
requests/86546460microUSD reserved/0pending under the200M ceiling. No new money
or requests are authorized by this document; later paid work requires the real
read-only ledger audit and a separately frozen accepted execution plan.

## Worker implementation evidence

The first private G1 filename proposal put `adaptive-` inside the old
execution-ID namespace. The primary noticed that old ID `adaptive-overlap`
and new ID `overlap` would address the same binding and claim paths. A focused
test reproduced `policy_mismatch` on the second authorization. The adaptive
stem is now `experiment-adaptive-qualified-source-pair-`, disjoint from the
unchanged old stem; the regression proves both bindings and claims coexist in
one synthetic ledger. This was a local pre-candidate failure, not a CI result.

The first focused Node22.16 controls passed 14/14 after that correction:
canonical outer digest and cross-grant denial; actual core qualification plus
F adapter through G for inline/catalog on both synthetic 100M and chained
200M parents with a retained nonempty history; strict catalog and route denials;
binding/policy drift; separate-process one-claim race. A later primary review
found that cloning before validation erased a hidden adaptive-context key. A
fresh focused fixture accepted that malformed grant and consumed its claim.
Adaptive-only pre-clone own-descriptor validation now rejects that key and
context/field getters without invoking them, claim or reservation; the same
valid capability still works. The old v1 factory is unchanged. The focused
guard and installed-archive controls passed after this correction; the latter
uses actual installed F core/adapter for both inline and catalog behind G,
with source/archive/installed byte hashes and fake HTTP.

## Frozen delivery follow-up — genuine-deadline integration test clock

The first Node24 G9 live-suite attempt discovered369 tests:338passed,
30existing optional skips and one cancelled test. The unchanged
`reliability-smoke.test.mjs` genuine-core-deadline test exceeded its45000ms
outer timeout at45576ms. The test, smoke CLI, model-call and capture-deadline
files match the fixed base; this does not alone rule out shared-path regressions.
Named isolation passed37127ms; a two-CPU control passed37866ms; bounded CPU
peers and two-file parallelism passed34860ms and33960ms. Those controls do not
explain the first failure and do not support claiming simple CPU contention.

A private in-memory import-hook diagnostic added one12000ms scheduling pause
at the second fake HTTP dispatch, after the genuine first core abort, without
editing repository files. It reproduced the exact outer timeout: setup547ms,
first dispatch988ms, core abort30884ms, next dispatch pause31424–43428ms,
run-end45261ms and cancellation45263ms. This proves wall-time sensitivity of
the integration test, not the original host-load cause. The pre-fix test hash is
`ef6751eb650de0d7b09af0384a7476e90273734ba661be608956e0662ab6d2ca`;
diagnostic hook hash is
`3c6eb4b3740a8f0cc7e203651e2b2e5c386b24ce3a9751d3d7b476937a80ec4a`.
The primary independently verified on bothNode versions that an isolated
Node test timer can drive the real model-call callback and its private deadline
signal provenance, without a provider call or production modification.

The primary freezes these additional requirements before corrective edits:

- G10 Preserve all failures and falsifying controls. Keep the original outer
  45s and all production deadlines, policies, clocks and defaults unchanged.
  Do not claim repaired product performance or a known initial failure cause.
- G11 Isolate only this integration test's wall-time dependence in one
  test-only child. Drive the real core timer callback and private signal
  provenance, never spoof an abort/error or manufacture a report. The child
  must not patch the shared parent process clock. Preserve separate real-time
  timer/cancellation tests unchanged; this gate is not30s wall-time calibration.
- G12 Still run actual smoke CLI/delegate, a fresh synthetic plan from the
  existing500-source setup, bound ledger, one-shot marker and six-case schedule.
  Assert exactly one genuine core timeout, no global halt, continued later
  cases and conserved bounded requests. Establish all five remaining cases
  complete if that is the actual existing contract; otherwise report the
  precise remaining state rather than weakening it silently. Use explicit
  key-free child environment and fake HTTP only. Do not access an operational
  plan, credential, ledger, corpus or held-out question.
- G13 Add a separate fresh-plan counterfactual that removes the real core
  timer's signal-provenance registration using an import-time in-memory mutant.
  It must fail the specific timeout/continuation assertion; unrelated child
  failure or timeout is not a passing mutant test. Do not write mutated runtime
  files or reuse a consumed plan. Preserve all other smoke tests and assertions.
- G14 Additional allowed files are only the existing
  `evaluation/live/test/reliability-smoke.test.mjs` and one narrowly named
  test-only child under `evaluation/live/testing/`, plus this plan and the
  existing limitations entry. Reuse the parent's setup/plan rather than
  refactoring unrelated fixture code. No root live-script serialization, core,
  CLI, dependency, package export or policy change. Run named normal/mutant,
  full smoke file and full live suite on bothNodes, complete G9 affected gates,
  primary direct acceptance, both full fixed-base reviews and exact-head CI.

Implementation remains with the same bounded GPT-6 Sol/high worker. No paid
launch, merge or delivery-complete claim follows from this follow-up contract.

## Worker pre-candidate verification record

On both pinned Node 22.16.0 and 24.15.0, the worker ran the standard commands
sequentially with no overlapping heavy matrices: `npm test` (112 pass),
`npm run validate` (JSON PASS), pinned Claude 2.1.260 plugin validation (PASS),
`npm run test:core` (719 pass), `npm run test:openai` (224 pass),
`npm run test:experiment-budget` (25 pass),
`npm run test:experiment-request-guard` (249 pass),
`npm run test:longmemeval` (128 pass), `npm run test:mcp` (91 pass),
`npm run test:artifact` (84 pass), installed rationale (4 pass), and the
applicable store, offline OpenAI, budget, guard, LongMemEval, comparison and
public demos (all PASS). Dependencies were installed only in the isolated
OpenAI, MCP and plugin-validation packages; artifact cache preparation used
public metadata. No model API or operational data was used.

The first Node24 full live run, before G10–G14, retained the one cancelled
45-second smoke test described above (338 pass/30 existing skips/1 cancel).
After the test-only clock isolation, the named normal and provenance-removal
counterfactual each passed their expected parent assertions on both Nodes.
The normal child invokes the actual smoke CLI and delegate, observes exactly
one real `core_deadline` termination, five completed later generations, no
global halt, and bounded terminal ledger accounting. The mutant removes only
the core timer's internal provenance registration in memory on a fresh plan;
it exits with the expected specific invariant failure, not an unrelated
exception or timeout. The full smoke file passed 16/16 on both Nodes. After a
final assertion correction from the nonexistent ledger outcome `pending` to
the actual unsettled value `null`, the named normal/mutant controls passed
2/2 on both Nodes and final full live runs passed 340/370 with 30 existing
optional skips, zero failure/cancellation (Node22 95.9s, Node24 87.2s).
The outer45s test timeout, real core deadline, production behavior and other
real-time/cancellation tests remain unchanged. The initial Node24 failure's
cause is unknown; the private pause demonstrated only wall-time sensitivity.

These are worker pre-candidate results, not primary direct acceptance,
non-author review, latest-head CI, real-provider compatibility or paid evidence.
