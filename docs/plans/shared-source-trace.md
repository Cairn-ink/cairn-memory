# Shared-source localization: N5 offline

Prospective contract, 2026-09-29. Dependent worktree/branch:
`shared-source-trace` / `diag/shared-source-trace`. Fixed parent candidate:
`2ee005d7d3fcf8d27e418a4eba60a35d22fb0276` (N4 report, PR #285).
The initial contract base was `269a12d`; primary fast-forwarded the dependent
branch through the parent's two documentation corrections before implementation.
The final parent's independent reviews pass; CI is pending. This contract can
be prepared now, but implementation waits for its delivery gates. Main stays
untouched.

## Goal and bounded decision

Build a lightweight, source-backed reliable memory layer usable through MCP,
Hermes and other harnesses. N4 completed all eight authored generation arms;
Cairn was 3/4 correct and Mem0 4/4. Two source traces could not bind uniquely
because a canonical window can legitimately be retained on multiple cards.
The recorder's original reason and later challenge were stored, but its answer
did not explain the changed premise. Neither fact establishes the first
semantic loss. N4 results and earlier official failures remain immutable.

This packet improves observation only, OFFLINE. Keep the consumed v1 protocol
and optional probe behavior intact. A prospectively selected v2 mode will
observe the full bounded family of cards retaining one designated window,
through one actual recall and answer pack. Do not select a winning card or
stitch partial stages from different cards into a fictional successful path.
Use this before diagnosing premise delivery versus answer use. No larger
receipt cap, new engine, prompt repair, paid replay or scorer change here.

## Observable acceptance

- **S1 — Explicit compatible version.** Add one narrowly named preparation
  option for shared-source observation, requiring indexed-evidence mode and
  at least one valid existing source probe. Absent option leaves v1 and
  disabled manifests, roster hashes and output behavior unchanged. Invalid
  values, accessor/proxy input and incompatible/no-probe use reject before
  dispatch. Bind the new version, finite bounds and aggregation meaning in the
  context manifest before guard creation. No evaluator data enters generation.
- **S2 — Complete finite family.** Inspect only the designated completed
  capture batch's at most five unique admitted IDs. Each public `get` reads
  at most 100 receipts with no pagination, validates full current identity,
  namespace, active state and completeness even for nonmatching members.
  Match exact client/session/event/role/canonical excerpt, not similar text.
  Multiple distinct matching cards are valid; duplicate matching receipts
  inside one card remain unavailable. Preserve all carriers, with no arbitrary
  winner. At finish recheck every original admitted member (at most five more
  reads): same revisions and receipt bindings, no new/lost carrier. No store
  scan, mutation or model call. Failure/foreign/stale/incomplete/over-limit
  family is unavailable, never missing-data proof.
- **S3 — Truthful per-carrier progression.** Reuse the existing single-card
  trace state machine for each carrier through actual select/rank/final/pack
  boundaries and complete-map bypass. Return bounded source-free per-carrier
  reports with stable local ordinals, not IDs/text/query/paths/hashes/errors.
  Report observed/unavailable counts and any complete single-carrier path
  without a cross-carrier union. No global first-loss claim when member gaps
  differ or any required member/read is unavailable. Flattened answer text
  still cannot prove source identity, semantic truth or causal use. At most
  five carrier reports within a 32-KiB serialized report; one finish only.
- **S4 — Passive integration.** Wire the new mode into `runMixedGeneration`,
  including failed capture and recall/error paths. Reuse the trusted model
  facade: original receivers, arguments, promises/results, errors and abort
  signals preserved; capture projection at method entry. Missing/late/invalid
  observation must never change the actual operation or add provider calls.
  No public core, provider, prompt, capture, budget, native arm, scoring or
  persistence behavior change. Do not silently reinterpret saved v1 results.
- **S5 — Actual preconditions and regressions.** First show the v1 limitation
  using real capture with two genuinely different extracted cards citing the
  same source index, not duplicated fake reads. In v2 one selected carrier and
  one omitted carrier must remain distinct; also cover both/none selected,
  complete-map, nonmatching member validation, exact identity vs same text,
  duplicate receipt, stale/corrected/forgotten/foreign/incomplete/oversize,
  failure, late/duplicate callback and report privacy/size. Assert the whole
  family and finite read counts. Compare identical real-core requests through
  the existing guarded fake-HTTP adapter for byte/result/accounting parity;
  actual mixed-runner + native fake-HTTP proves end-to-end mode plumbing.
  Tests use owned scratch and clean after success/failure, never old stores.
- **S6 — Verification and delivery.** Both Node 22.16 and 24.15: focused tests,
  long-history, LongMemEval, current authored-fixture tests (unchanged frozen
  digests), generic JSON and strict plugin validation, workspace lifecycle,
  four existing LongMemEval demos, and mixed-native-local (no skips). Primary
  personally inspects and reruns critical integrated paths. Freeze one scoped
  candidate for separate nonauthor Standards and Spec reviews, then latest-head
  CI and mergeability. No paid provider, corpus, credentials, operational
  ledger, release, deployment, historical cleanup or merge in this packet.

## Ownership and checkpoint

Primary owns this contract, integration documents, acceptance, parent delivery
and final PR. One GPT-6 Sol/high worker owns runtime/tests after returning an
API/output schema and caller/hash-binding design for approval. Initial allowed
files: `evaluation/longmemeval/mixed-source-observation.mjs`,
`mixed-generation.mjs`, focused tests under `evaluation/longmemeval/test/`,
and `testing/mixed-fixture.mjs` / `testing/mixed-native.test.mjs`. A small
neighboring shared-source module is allowed if it avoids growing a second
single-card state machine. Do not edit the N2 state machine without approval.
All other core/adapter/guard/model/package/CI/old fixture files are excluded.

The primary will examine the existing recorder source-to-context evidence
separately, read-only, while the worker verifies this diagnostic. That analysis
cannot reconstruct missing historical live callbacks. A subsequent bounded
product correction needs a demonstrated causal failure and its own acceptance;
new paid cases must be prospectively frozen and fit the original US$200 ledger.
Official matched scoring and installed-host cold-session, growth,
correction/forgetting and latency/cost remain separate product gates.

## Approved design, before implementation

The worker's read-only checkpoint proposes
`sourceObservationMode: 'shared-source-v2'`, requiring valid nonempty probes
and indexed-evidence mode. The absent-option path stays v1. New context version
`mixed-indexed-evidence-context-v3` binds
`shared-current-source-trace-v2`, five before/five after reads, at most five
carrier reports and the 32-KiB report limit. Aggregation is per-carrier
any-complete, never a union of different cards' progress.

The source-free report uses version 2, scope
`one-current-source-family/one-recall`, family status, counts, and
`carriers: [{localOrdinal, trace}]` with existing single-card reports. The
ordinal is the original admission position, not an identity. An
`anyCompleteCarrierPath` tri-state is yes only for a complete path on at least
one card while the required family reads remain valid. No global first-gap
field is synthesized. Every member is re-read, including initially unrelated
members; snapshot current revisions and all bounded receipt bindings to detect
changes without interpreting semantic currentness. Missing family evidence
always remains unavailable even if one convenient carrier looks successful.
Before implementation, confirm the actual public get lifecycle/currentness
shape and cover a retired historical card separately from logical deletion.
No edits to the existing N2 state machine or paid files are approved.

## Primary read-only context audit (not a replay)

The original recorder result saved two recalled cards and two receipt
provenance entries: the later battery challenge and the subsequent unadopted
recorder proposal. `selectedIndices` is `[0, 1]`, with no duplicate or omitted
indices. The frozen runner's `verifiedEvidence` binds complete current
receipts to the original prepared windows; `packMixedAnswer` supplies each
selected unit unchanged. Together with the read-only synthetic store, this
supports a code-backed reconstruction that the 18-hour challenge was supplied
and was not dropped by packing. It is not a retained raw HTTP request or a
retroactively observed rank callback.

The original 72-hour decision is retained separately and is absent from final
provenance. Thus two facts must remain distinct: original-premise context is
missing from final retrieved evidence, while the delivered update still did
not receive an explanation in the answer. No evidence here identifies why
ranking omitted the original decision or proves that adding it alone would
fix the answer. There is no basis to increase receipt limits: the two returned
cards each have one receipt and neither was omitted by packing. The broad
question's answer-sufficiency ambiguity remains as published in N4.

Do not change the product based only on this audit. The next prospective
experiment must distinguish original-premise delivery from use of an already
delivered update, preserve each stage's denominator, and use fresh questions
that explicitly request the decision and its reason. This does not revise or
rescore the consumed question, and source linkage is not a claim that the
underlying premise is true or that remembered text authorizes action.

## Convergence checkpoints after S6

1. **Locate a realistic retrieval loss.** The next fresh localization packet
   must exercise actual model selection as well as ranking; the two observed
   N4 cases bypassed selection on a complete small map. Freeze a larger varied
   source history, explicit decision-and-reason questions, and original-premise
   probes before output. Report the actual admitted size and whether select
   ran. Failure to reach that path is an unmet diagnostic precondition, not a
   successful scale test. Do not silently replace such a case. Keep an adopted
   change, changed premise without replacement and uncertain proposal distinct.
2. **Make one justified correction.** Use observed retention/select/rank/pack
   loss or answer omission to choose the smallest relevant intervention. A
   retrieval change must demonstrate better evidence delivery without weakening
   revision/namespace/forgetting guarantees. An answering change must be
   evaluated with the same evidence and controls, not credited as retrieval.
   Freeze fresh treatment/control cases and resource limits before calls.
3. **Return to matched official scoring.** Preserve the six-question official
   result: Cairn completed 5/6, with 3 correct, 2 incorrect and 1 unresolved;
   Mem0 completed 6/6, with 3 correct and 3 incorrect. Its 292 planned capture
   batches are not represented by N4's 16. A fresh selected official cohort
   needs complete paired mechanics before expanding to a fixed 30; correctness
   remains a comparison, not a requirement for 100% accuracy. Existing timeout
   isolation, cumulative budget and immutable failed slots stay intact.
4. **Accept the installed product separately.** Verify clean install, actual
   MCP/Hermes cold-session use, growing collections, sourced decision changes,
   correction/forgetting and finite request/latency/cost. Publish measured
   boundaries and limitations. Neither a clean observer nor an authored score
   satisfies this gate or establishes production readiness.

These are staged decisions, not permission to run another paid packet now.
The remaining conservative capacity after N4 is 63,340,666 microUSD under the
same US$200 ledger; a fresh authenticated preflight is required before any
future dispatch. No new budget or repayment credit is inferred from offline
successes or known partial usage.

## Parent delivery and implementation GO

PR #285 final head `2ee005d7d3fcf8d27e418a4eba60a35d22fb0276` passed both
independent GPT-6 Sol/high review axes and all 17 reported checks in exact-head
pull-request CI run `36490487958`; primary verified mergeability. No CodeQL
check was reported. The PR is ready, not merged. Implementation may now begin
from this fixed parent, using the approved contract and scoped worker.

Primary installed the unchanged locked OpenAI adapter dependency set in this
worktree and personally ran the existing v1 focused source-observation tests
on Node 24.15: 2/2, no skips (1075.315 ms). This is baseline evidence, not an
N5 pass. The new tri-state aggregate must preserve unknown: `no` requires a
concrete observed gap on every carrier; any unresolved member progression
cannot be converted into a proven negative. Family read/status failure
overrides even an otherwise complete member path.

## Genuine shared-source precondition

Before v2 implementation, the worker added an actual `core.capture` fixture:
two different extracted interpretations cite `sourceIndices: [0]`, admission
returns two distinct IDs, and public `get` confirms both hold the exact
designated canonical window. The unchanged v1 locator returns
`ambiguous_source`. No cloned read, direct SQL insertion, hand-selected ID or
existing database establishes this precondition.

Primary personally reran
`node tools/testing/run.mjs --test-name-pattern='actual capture retains one indexed window' evaluation/longmemeval/test/mixed-source-observation.test.mjs`
on Node 22.16 and 24.15: 1/1 each, no skips, 517.628 / 464.703 ms. This is an
expected v1 negative and evidence of the real pattern, not a v2 pass or proof
of semantic relevance. The scripted extractor/counter are mechanical controls.

## Interrupted-work resume checkpoint

The GPT-6 Sol/high implementation worker was interrupted by agent usage quota
after partial runtime/tests had been written. No N5 candidate commit, PR,
paid execution or final acceptance was claimed. After the user restored quota,
the same worker resumed the bounded packet; primary rechecked the saved diff,
clean primary repository and the unchanged ready PR #285.

Primary had already reproduced the actual two-carrier v2 complete-map path
on both Node versions (one final carrier returned, one omitted). Remaining
acceptance includes real model-selected routing, currentness/failure/unknown
controls, identical-request wire/accounting parity, actual native-runner
scoring eligibility, full S6 checks and independent review. Primary rejected
an early model-selected test's closure over an admitted target ID: the scripted
selector must choose only from the actual visible request. This is test
adequacy work, not an observed semantic improvement.

## Combined implementation acceptance

The same GPT-6 Sol/high worker completed the six scoped runtime/test files;
primary owns this plan, roadmap and limitations integration. No core, adapter,
guard, prompt, frozen fixture, package or CI file changed. Primary read the
complete diff and traced preparation, private manifest binding, successful
recall, capture failure, recall failure and scoring callers. Existing tests
keep the v1/disabled protocol goldens unchanged. New actual-native tests
compare results, requests and scoring eligibility with observation disabled.
The real-core request parity test separately compares identical provider bytes,
results and reserved/actual accounting through the guarded fake-HTTP adapter.

Primary interventions tightened admission-array handling (no untrusted map or
iterator execution), unknown carrier counts on incomplete reads, visible-only
selection fixtures, concrete-plus-unknown progression and failure-path parity.
Development test failures were explained and fixed: an invalid fixture date,
an assumption that admission order equaled visible selection order, an expected
concrete gap without a rank observation, and a null-prototype result assertion.
These were test-fixture/assertion defects, not silently retried provider cases.
The final independent review remains a separate gate below.

Primary personally ran all following commands with matching Node PATH and
`NODE_DISABLE_COMPILE_CACHE=1`. The tested runtime/test diff SHA-256 is
`597d1258f32316ac35412ac69630d735edc70b888c3a90d57b9804a8c4e61904`
(`git diff --binary -- evaluation/longmemeval`); it was unchanged after testing.

| Gate | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| Focused two changed test files through `tools/testing/run.mjs` | 17/17, 6649.756 ms | 17/17, 6608.079 ms |
| `npm run test:longmemeval` | 200/200, 16938.136 ms | 200/200, 16963.813 ms |
| `npm run test:long-history` | 19/19, 55897.745 ms | 19/19, 54535.772 ms |
| `npm run test:long-history-live:offline` | 6/6, 1021.375 ms | 6/6, 666.335 ms |
| `npm test` | 143/143 | 143/143 |
| `npm run test:workspace-lifecycle` | 25/25 | 25/25 |
| `npm run test:mixed-native-local` | 29/29, 161179.271 ms | 29/29, 160282.577 ms |
| `npm run validate` | PASS | PASS |
| `npm run validate --prefix tools/plugin-validation` | PASS | PASS |

The focused command was
`node tools/testing/run.mjs evaluation/longmemeval/test/mixed-generation.test.mjs evaluation/longmemeval/test/mixed-source-observation.test.mjs`.
The four commands `npm run demo:longmemeval-ingestion`,
`npm run demo:longmemeval-comparison`, `npm run demo:longmemeval-public`, and
`npm run demo:longmemeval-mixed` also passed on both runtimes. No suite skipped
tests. The worker independently reported focused 17/17 on both runtimes and
native 29/29 on Node 24.15. Native checks used the existing pinned local roots,
Linux containment and synthetic fake HTTP, without provider keys or operational
ledgers. Strict validation reused the unchanged pinned 2.1.260 tooling.
Ordinary test scratch is owned and cleaned; demos retain their documented
artifacts. No historical cleanup was performed. There is no typecheck gate.
Agent cost and total elapsed implementation time are unavailable; test durations
above are observed suite times, not product latency or model-cost estimates.

At this checkpoint the local acceptance is complete, but fixed-candidate
Standards/Spec review, remote exact-head CI and mergeability are still pending.
Their results must be recorded against the delivered PR head, not inferred from
these offline passes. This packet incurred no paid model calls and produces no
new semantic score. The next fresh selection-path experiment, official paired
scoring and installed-host acceptance remain as listed above.
