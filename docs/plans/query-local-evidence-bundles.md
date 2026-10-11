# Query-local source bundle prototype — prospective contract

Primary decision, 2026-10-11. This is a bounded evaluator-only algorithm packet,
not a paid-run grant or a revision of a closed result. Implementation base will
be the exact reviewed natural-four result commit recorded in dispatch. Dependent
branch/PR is allowed; no main edits, merge, release, deployment or historical
cleanup. The public lightweight/reliability goal and original Stage 2/3 gates
remain unchanged.

## Hypothesis and limits of evidence

The closed natural-four study localized two losses: omitted navigation choices,
and full identity passages discarded by ranking. It did not establish the
model's internal reason. This first packet addresses ONLY the latter mechanism:
make query-local evidence sets explicit and preserve declared prerequisites
together through the existing authoritative read and answer packer. A model can
still choose the wrong set. Existing same-name/literal linking and whole-small-
pool preservation have no proven safety/QA advantage; older D12 is not repaired.

A query-local bundle is unverified organization of exact source receipts, not
a stored semantic relation, identity proof, truth, temporal inference, automatic
supersession or execution authorization. No source text is promoted to system
instructions. Core, adapters, schema/storage, capture, selection, MOC policy,
default behavior, provider/model and old evaluated artifacts stay unchanged.
Upstream omitted-ref probes require a separate implementation/control arm.

## Implementation boundary

Allowed seven paths only:

- evaluation/architecture/source-bundle-rank.mjs (new)
- evaluation/architecture/source-bundle-evidence.mjs (new)
- evaluation/architecture/test/source-bundle-rank.test.mjs (new)
- evaluation/architecture/test/source-bundle-integration.test.mjs (new)
- docs/plans/query-local-evidence-bundles.md (new; preserve this contract)
- docs/limitations.md (append accurate offline boundary)
- ROADMAP.md (small next-stage checkpoint)

No new dependency, package-script or provider wire modification. A closed prompt
may be exported from the new rank module. The paid planRank transport is explicitly
not implemented here; an injected scripted port is used for offline evidence.
If another path is necessary, stop and ask primary for bounded scope review.

## Acceptance QB1–QB9

QB1 — Prepare a descriptor-safe detached rank request from actual core-supplied
source-evidence candidates only. Number existing exact receipts into an ephemeral
catalog carrying namespace index, memory ID/revision, receipt ID, submitted role
and excerpt. No invented offsets, generated summaries, gold IDs/answers, closed
case names, hidden store search or external evaluator inputs. Bound to 36 cards,
existing <=100 receipts/card and <=800-character excerpts, core input.limit <=6.
Version one supports one authorized namespace per invocation; reject mixed
namespaces rather than implying a cross-namespace provenance verifier exists.
Candidate/receipt identities must be unique as appropriate and well-formed.

QB2 — Proposed closed planner output is exactly
`{bundles:[{sourceIndices:[...],terminalSourceIndex:n}]}`. At most six bundles;
each nonempty bundle has at most six unique valid source indices belonging to
at most three distinct cards, and contains its terminal index. Entire union
has <=min(input.limit,6) distinct cards. Empty bundles array gives empty refs.
Reject excess rather than truncate prerequisites. Flatten stable first-occurrence
card refs; never synthesize source relations or expand from matching names.
Keep original receipts and provenance identities even for equal text.

QB3 — createBundleRankModel(baseModel,{planRank,onPlan}) substitutes one planner
invocation for ordinary rank; baseModel.rank is never called. Existing non-rank
ports/receiver and local tokenizer behavior are preserved. The sole prepared
request contains a fixed instruction, catalog and closed strict output schema.
Measure the actual complete prepared representation, including schema, <=6000
local input tokens and maxOutputTokens=1024; raw output <=1024 tokens/40000 chars.
No silent source shortening, extra planner calls, retries or fallback generation.
Preserve cancellation, typed failures, immutable snapshots, request identity,
descriptor safety and failure on output mutation. No environment key/network
default. Record immutable onPlan sidecar before returning flattened {refs};
callback failure is failure, not successful partial state. Concurrent/reentrant
use must fail clearly or have demonstrably isolated per-invocation ownership.

QB4 — The sidecar binds the detached request, original query, exact catalog,
raw proposed grouping and compiled refs. Assemble only after successful core
recall. Revalidate matching refs/revisions/roles/excerpts and source identity
against actual returned source evidence; use unchanged verifiedRoleEvidence
with real core.get and the source-mapped ingestion plan. A stale sidecar, failed
recall, altered/missing receipt, wrong question/query association or forged
provenance must reject. Exact provenance is not semantic sufficiency.

QB5 — Assemble each validated bundle from verified whole-card source passages
as ONE quoted evidence unit; metadata declares unverified organization, never
new source facts. Enforce the unique-card cap independently of the six-unit cap.
No model/counter callback is added inside core after its final authoritative
read. Use the unchanged packMixedAnswer instruction/model/limits. Check actual
packed request: no required bundle omitted/partially packed and <=6000 input
tokens. Duplicate whole bundles may be deduplicated only with explicit complete
identity/provenance accounting; any omitted necessary source must be observable
failure/incomplete evidence, not a returned terminal-only success.

QB6 — Behavioral tests must exercise actual core capture/recall/finalization,
source-mapped role verification and actual answer packing on fresh synthetic
temporary SQLite. A scripted baseline rank omits a bridge; a one-call scripted
bundle plan preserves it. Assert exact packed source identities/content with an
independent literal-source oracle, not merely helper diagnostics. This is a
mechanical positive/negative control, NOT a measured first-answer improvement.
Test one-card answers, two/three-card chains, empty plans, reordered/renamed
aliases, >6 candidate pools, duplicates with distinct provenance, competing
entities/scope/time, missing bridge, uncertain/quoted/instruction-bearing sources.
Tests show source fidelity and lack of automatic identity inference; they do not
assert the scripted planner proves semantic relevance or missing-source detection.

QB7 — Negative controls cover foreign/duplicate/invalid source indices, terminal
outside bundle, mixed namespace, >3-card bundle/>6-card union, source/query
mutation, oversized request/output, accessors/toJSON/prototype hazards,
concurrent/reentrant use, cancellation/provider failure and no retries. Deletion
or revision change during planner/onPlan must be rejected by existing core
freshness/finalize checks. Tests must retain original actual failure evidence,
and use owned workspace teardown on success/assertion/setup failure; no historical
directory cleanup or production/user database access.

QB8 — Primary directly inspects complete diff and actual source controls, derives
inventory by Git plus independent filesystem/tree method and personally runs
focused tests, npm test, npm run validate and both Claude validators on Node
22.16/24.15. Add relevant core/LongMemEval gates if the implementation exposes a
real integration dependency. Actual exit codes/raw logs/temp cleanup and exact
candidate bytes retained. Freeze local commit, independent nonauthor Standards
and Spec review full fixed diff, then latest-head CI/mergeability. No push until
primary acceptance and both reviews pass. No score or security claim from tests.

QB9 — Document subsequent order, not permission to execute it: separately named
accounted structured planner transport and fake HTTP/schema/deadline/budget
tests; separate upstream recovery control; freeze entirely new source-only paired
cases and rubric before model calls; independent first-answer/support judgments;
only then compare supported correctness, unsupported/stale/severe errors and
resources. No current closed corpus reanswer/rescore/tuning. Original cumulative
US$400/protected US$30 ledger unchanged; future experiment affordability/reviews
required. Reject a candidate with new severe harm, increased unsupported/stale
claims, resource overrun or no demonstrated useful supported-answer benefit.

## Research influence, not proof

HippoRAG 2 (https://arxiv.org/abs/2502.14802) and IRCoT
(https://aclanthology.org/2023.acl-long.557/) motivate testing connected evidence;
neither establishes this candidate's correctness or transfers its scores. OpenAI
Structured Outputs documentation
(https://developers.openai.com/api/docs/guides/structured-outputs?api-mode=responses)
supports schema-constrained output, not semantic truth. The later paid seam must
use its own accounted wire protocol, not a fetch-rewriting shim or widened closed
transport allowlist. No new API-backed runtime is introduced by this packet.

## Implementation record

Implementation base: `74c32637da3b519a3198d9e8fd778ec291e53f60`, branch
`experiment/query-source-bundles`, isolated `query-source-bundles` worktree.
The preceding 9,312 contract bytes are preserved verbatim. This record describes
an offline evaluator prototype, not a transport, run grant or product change.

The public seams are:

- `prepareBundleRankRequest(request,countTokens)` prepares and brands the frozen
  instruction/catalog/schema representation; `compileBundlePlan(prepared,raw)`
  accepts only a genuine prepared object and compiles stable card references.
- `createBundleRankModel(baseModel,{planRank,onPlan})` owns one invocation. Its
  sole planner replaces ordinary rank; other ports retain their original receiver.
  The immutable sidecar precedes returned references. Reuse/concurrency/reentrancy,
  cancellation, callback failure and mutable raw output fail without retries.
- `assembleSourceBundleEvidence({sidecar,recall,core,plan,namespace,question})`
  consumes the process-local sidecar once, including on failed assembly. It checks
  the successful core envelope against the catalog and calls unchanged
  `verifiedRoleEvidence` with actual `core.get` and the source-mapped ingestion
  plan. `consumeBundlePlan` is the shared module ownership seam, not serialized
  evidence authority; cloned objects cannot acquire ownership.
- `packSourceBundleAnswer({evidence,countTokens})` accepts only an assembled
  artifact and calls unchanged `packMixedAnswer`. Every bundle is one whole-card
  quoted unit. Declaration/terminal metadata carry identity only; full source text
  appears once per card in answer context. Verified units and provenance remain
  outside that model context. Overlapping cards/duplicate bundles fail visibly;
  there is no silent prerequisite removal or identity-based source merging.

Version one explicitly requires
`question={text:plan.originalQuestion.text,date:plan.canonicalQuestionDate}`.
It rejects another date representation without parsing or rewriting it, and the
actual packer preserves the supplied bytes. Any future paired runner must pass
that same explicit object to baseline and treatment; this interface is not an
unchanged plug-in for the closed natural-four runner's question representation.

The request cap counts the complete prepared JSON, including the schema, at
6,000 local tokens; output is capped at 1,024 tokens/40,000 characters. Uniqueness,
terminal membership, three-card bundle and six-card union rules are compiler
checks also disclosed in the fixed instruction, not speculative schema keywords.
The inherited verifier still caps total receipts at 384 (and 100/card). The
unchanged answer packer's internal context ceiling remains 123,000; this helper
independently imposes 6,000 on the actual complete packed request and rejects any
omission or duplicate unit. Neither inherited limit is relaxed.

Only the four new modules/tests call these new seams. Existing core, adapters,
capture, navigation/selection, MOC policies, scoring, source fixtures, closed
results and public defaults are unchanged. No model/counter callback is inserted
inside core after its final authoritative read. No provider port is implemented.

## Author verification and acceptance ownership

Author: actual GPT-6.1 Sol/high, not an independent reviewer or semantic judge.
Primary owns integration, direct complete-diff/source inspection, inventory,
personally rerun gates and acceptance. Distinct nonauthor Standards and Spec
reviews and exact-head CI remain pending delivery gates at this author handoff.

Both pinned Nodes execute all 17 focused controls without skips. The actual core
controls use fresh owned SQLite, scripted capture/select/rank ports, authoritative
finalization and real role verification. Captured receipt texts/roles must match
independently prepared literal source windows, and actual packed source identities
must match the independent capture/read oracle. Coverage includes one/two/three
cards, empty grouping, renamed/reordered aliases, nine-candidate pools, distinct
equal-text provenance, old/new/proposed same-name cross-scope/date passages and
uncertain/quoted/instruction-bearing sources. Scripted bridge preservation is
source-fidelity evidence only, not an answer improvement or semantic-safety result.

Negative controls cover descriptor/prototype hazards, forged prepared/sidecar/
evidence objects, indices and caps, valid-shape output token overflow, mutation,
query/question/date mismatch, failed recall, altered/missing roles/excerpts,
forged origin mappings, actual deletion/revision during planner and `onPlan`,
callback/provider failure, cancellation and concurrent/reentrant ownership.
The shape-invalid large-extra-property example is not claimed as an isolated
40,000-character boundary test. Actual packed source-occurrence/token checks and
whole-card/duplicate/omission failures are independent of helper diagnostics.
SQLite/core imports are dynamic under the neighboring `supportsSqlite` pattern;
Node20 discovery remains compatible. Dependency-free generic CI uses an explicit
scripted fixture counter if optional `tiktoken` is missing and skips only the
dedicated real-tokenizer check (also skipped on unsupported Node). Required
focused acceptance sets `CAIRN_BUNDLE_TOKENIZER_REQUIRED=1`: missing tokenizer is
fatal, never a fallback/skip, and supported Node22/24 gates execute every control.
This test-only distinction introduces no runtime token-count fallback.
Owned success fixtures are explicitly removed; child setup/assertion failures
close SQLite and remove the same owned path in `finally`, with actual child exit
1 and removal checked. The owned runner also cleans scratch after failed suites.

Raw author evidence directory:
`/tmp/cairn-query-bundle-worker-gates.Rz3vFP1y`.
The exact focused command is each pinned Node running
`tools/testing/run.mjs evaluation/architecture/test/source-bundle-rank.test.mjs evaluation/architecture/test/source-bundle-integration.test.mjs`.
First logs `focused22-first.log` and `focused24-first.log` retain actual exit 1:
one syntax typo and a null output reaching untyped `Object.keys`. Their first
correction fixed both, but exposed a separate fixture oracle mistake (`memoryId`
instead of admission `id`), retained in both `focused*-correction1.log` (exit 1).
One correction of that fixture yielded both `focused*-fixture-id1.log` (exit 0,
15/15); subsequent source-occurrence/cleanup controls passed both
`focused*-final.log` (exit 0, 15/15). Final scoped/date coverage and typed controls
passed `focused22-coverage-final.log` and `focused24-coverage-final.log` (actual
exit 0, 16/16, no skips). Each distinct observed defect needed one correction;
no third tuning round, source change or paid call occurred.

Primary's forthcoming matrix additionally covers generic/core/LongMemEval,
validation and both Claude validators under each pinned Node. No author test is
a substitute for those gates or independent full-diff reviews.

Author validation: pinned Node22.16/24.15 `npm run validate` each actual exit 0,
raw `validate22-final.log` / `validate24-final.log`. Required-tokenizer focused
reruns `focused22-required17-final.log` / `focused24-required17-final.log` each
actual exit 0, 17/17 with no skips. The additional test-only dependency control
checks scripted mechanics only for missing optional `tiktoken`, fatal required
tokenizer absence, and propagation of unrelated import failures. No environment
or shared installation is mutated. The final seven-file inventory is reported
separately at handoff.

## Next proposal, not execution authority

First specify a separately named, accounted structured planner transport with
fake HTTP/schema/deadline/budget controls; then separately test upstream omitted-
reference recovery. Freeze entirely new paired source-only cases and rubric
before any model call, retain independent first-answer/support judgments, and
compare supported correctness, unsupported/stale/severe claims and resources.
Reject increased harm, resource overrun or lack of useful supported-answer benefit.
Do not reanswer, rescore or tune consumed cases. D12 remains uncleared, MOC remains
opt-in and Stage 2/3/product gates stay blocked. Original US$400 cumulative and
US$30 protected ledger limits are untouched; this packet grants no new spend.
