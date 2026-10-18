# H6: two fresh routing × ranking diagnostics

This is the public account of the private H6 contract frozen before operator
implementation and its final runtime binding frozen before selection and live
access. This public document was first drafted during the one-shot run; it
does not replace those private records or authorize another attempt. The run
is now mechanically closed with actual exit 0 and a passing closure audit;
independent masked judgments and primary adjudication are frozen, showing no
demonstrated quality benefit. The exact-path necessary-source trace is also
accepted; the contract below is unchanged.

The comparison concerns two implemented read changes: `moc-hierarchy-v2` adds
standalone-L1-aware navigation while preserving two flat rounds, and
`bounded-idf-v1` weights literal source-query overlap within the existing scan.
It does not establish implementation of the broader Raw/Memory/Card,
relationships or vector architecture. The original [H3 miss](moc-hierarchy-real-opportunity.md)
and [H5 resource failure](source-idf-ranking.md#r5-outcome-stopped-at-writer-contention-not-promoted)
remain closed; neither is replayed or reclassified here. The separate
[H5b/P8 offline resource acceptance](source-idf-page-snapshots.md#p8-execution-record)
does not establish real-model benefit.

## Frozen provenance and status

- Original private implementation-contract SHA256:
  `b8de4055fd74f9c7a48ceb4457e9e12cb5f70495951b86edd3dc500338524e46`.
- Final runtime-bound private contract SHA256:
  `5e1bbde0d7a46c70e3855ff59bda3d9721f975b7af117c28d0f201465c8083a2`.
- Runtime: `d46f7d0aef7b0011e982da8e10f1f26e90706767`,
  [PR #438](https://github.com/Cairn-ink/cairn-memory/pull/438), reviewed with
  31/31 exact-head checks successful before the live binding. Ready/unmerged
  was the checked pre-run snapshot, not a continuing remote-status claim.
- Selection frozen at `2026-10-18T19:21:28.278Z`, SHA256
  `ea9be35a967474618dd23b2418118661f7d8adfa1c24554c699f3cc6e3a98193`.
- Future-exclusion union SHA256:
  `8d48b321e8819343730445d955dc92b7daed17e4e83695521c139ac06ba7e8f2`.
- Preparation receipt SHA256:
  `eb00cea826c402f0997d72b94b6b22c0db801a3160302ad2cdce704340cb9f12`.

The selection and preparation values above are metadata, not completion or
answer-quality results. The primary owns live supervision, closure, accounting,
grading and adjudication. The [result document](../evidence/routing-idf-diagnostic.md)
records mechanical completion, frozen quality judgments and the accepted
source-loss trace separately.

The original digest records the criteria frozen before worker dispatch. The
final digest identifies the contract after binding the reviewed runtime and
exact-head CI; independent reviewers reconstructed the original by removing
only those binding fields. The original digest is supplied by the primary's
retained review record; the final digest was also read directly from the frozen
file and matched selection/manifest metadata. Neither digest is an outcome or
a post-result change to acceptance criteria.

## D1. Select before inspecting content

Authenticate the original s-cleaned source against SHA256
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`,
revision `98d7416c24c778c2fee6e6f3006e7a073259d48f` and size 277,383,467 bytes.
Reproduce the N35 eligibility/exclusion chain and include the closed H3 exposure
union: 269 prior exclusions, SHA256
`c375ce57140ceb1c7a96f615fced41d8f35e9fb370ef86924cbc8d590312562f`.

Choose the first two structurally eligible, unexposed IDs in ascending
`SHA256(JSON.stringify(['cairn.routing-idf-diagnostic.v1','2026-10-18-h6',id]))`
order, breaking ties by bytewise ID order. Do not filter by question type,
length, content, reference answer or expected win. Persist selection and the
new exposure union before projecting content. The frozen selection metadata
records 225 eligible unexposed IDs, no prior content inspection and no allowed
replacement. Preflight, ingestion, recall or grading failure does not change
the selected two-case denominator.

Only history and question/date enter the operator, through the existing
official preparer and source-mapped indexed-evidence planner. Reference answers
and answer-session IDs stay separate from the operator and paid models. The
`routing-idf-diagnostic-source-v1` input has exactly two cases in selection order,
each with its own history, question and opaque namespace. It cannot supply
arbitrary routing or model options.

## D2. One write, four cold first reads per case

Capture each fixed batch once through ordinary
`captureSourcePolicy:'indexed-evidence-v1'`, without qualification, direct SQL
filing, injected topology, duplicated sources or add-until-found behavior.
Complete a case's full write before any of its reads. Every arm uses the
unchanged default candidate scan; omit `sourceCandidatePolicy` throughout.
The separate keyset experiment is not another treatment in this comparison.

| Arm | Routing | Source ranking | Constructor/recall opt-ins |
| --- | --- | --- | --- |
| A | Default flat | Literal | Both properties omitted |
| B | `moc-hierarchy-v2` | Literal | Recall `selectionMode:'moc-hierarchy-v2'` |
| C | Default flat | `bounded-idf-v1` | Constructor `sourceRankingPolicy:'bounded-idf-v1'` |
| D | `moc-hierarchy-v2` | `bounded-idf-v1` | Both opt-ins above |

All four use recall `contextMode:'source-evidence'`. Disabled properties are
omitted entirely, not passed as `undefined`. Within each case, all four first
reads use the same unchanged, same-process, cold-reopened MemoryCore store,
written once. Stores,
prepared batches, counters, source catalogs, namespaces and outcome identities
remain scoped to their case. No partial-ingestion read or read retry is allowed.

The first case uses A, B, C, D; the second uses D, C, B, A. This balances
first/last positions only, not a complete Latin square or randomization proof.
Preserve complete bounded canonical snapshots before and after reads, including
exact revisions and source bindings. Retain actual group/flat/rank requests and
outputs, source/leaf omissions and answer packing; counts alone do not prove
that necessary evidence was visible.

Use `gpt-4.1-mini-2025-04-14` for extraction, classification, selectors, rank
and answers in every arm, with no silent fallback or mid-run migration. The
private contract records a scheduled `2027-01-14` retirement for that control;
the GPT-6.1 Sol worker model is a separate implementation choice. Preserve core
input/output/context limits of 6,000/1,024/8,192 tokens and 30,000ms calls.
Flat permits at most two selects plus one rank; v2 permits at most two
`selectGroups`, two selects and one rank. Each arm then receives one identical
source-only answer call, input 4,000/output 512 tokens, using the inherited
answer instruction/schema and whole-source packing. There is no raw-history or
reference-answer fallback. Report v2's extra allowance; this is not an equal-cost
or routing-efficiency comparison.

## D3. One budget and bounded first-only execution

Frozen maxima are two writes and eight first read/answer outcomes, at most 180
fixed batches per case, 800 physical requests/US$4 reservation per case and
1,600 requests/US$8 total. Preserve the existing cumulative US$400 ceiling and
protected US$30 reserve. Each count and generation reserves 5,000 micro-USD
independently on the original schema-2 ledger. Unused allowance cannot increase
another case's cap; there is no reset, refund, replacement, changed run identity
or resumed closed attempt. At 180 batches, the theoretical ceiling is 760
requests per case: 720 ingestion, 16 flat-arm and 24 v2-arm requests.
Historical budget observations are not a current balance or launch clearance.

Reuse the reviewed transport/first-only pattern in new private files. Preserve
strict serialization, provider counts and endpoint/model/body bindings,
provider input limit 7,024 tokens, output/body limits, exact historical ledger
prefix and settled owned tail, durable first-only claim before credential
access, stage/HTTP/terminal records and owned cleanup. Source, runtime,
credential, accounting or unsettled/unknown new-transport anomalies stop the
whole run. This is not a new general budget framework.

Before paid ingestion, preflight each actual query as well-formed, nonempty
text of at most 4,000 UTF-16 code units without truncation; preflight all fixed
extraction envelopes and empty-evidence answer envelopes. Check actual
state-dependent and packed answer envelopes when used. A structurally valid
selected case with an unsupported query, batch ceiling or envelope is retained
as preflight-failed, with all four reads not-run. A malformed source/identity is
a global stop. Neither condition permits another case to be selected.

Only settled, explicitly allowlisted `invalid_model_output`,
`context_budget_exceeded` or `context_item_too_large` algorithm failures may
allow another pre-frozen read/case, without retry, after source/snapshot,
accounting and cleanup invariants hold. An allowlisted extraction or
`classification.error.code` failure during partial ingestion marks the write
failed and all four reads not-run; only the other frozen case can then proceed
after the same checks. Generic `recall_failed`, `model_failed` and
`classification_failed` wrappers cannot conceal a transport failure. Other
unsafe/nonallowlisted failures, case or total ceilings and failed cleanup stop
remaining work. The frozen time limits are 35 minutes per case/70 total, latest
launch `2026-10-19T02:30:00Z`, hard stop `03:40:00Z`, preserving the `03:58:00Z`
discussion checkpoint. These historical execution bounds do not schedule a
future attempt.

## D4. Acceptance and honest interpretation

Mechanical completion requires two complete writes, eight first read/answer
outcomes, exact source bindings, unchanged per-case canonical snapshots,
complete traces/accounting and owned cleanup. Report failed, missing and
not-run outcomes explicitly. N=2 cases and eight correlated arm outcomes are
different denominators; eight outcomes are not eight independent benchmark
successes.

After closure, two independent masked non-author reviewers first grade opaque
answers against held reference/history without arm, configuration, resource or
trace data. Freeze those correctness records before a second masked pass
receives the actually delivered evidence for support/abstention judgments.
Only after both passes are frozen are arms and traces unmasked. Preserve each
review, disagreement and a source-cited primary adjudication. Do not modify
frozen grades or add grading passes after the freeze.

The shared rubric distinguishes:

- Minimal correctness: directly requested facts with necessary attribution/time
  qualification, consistent with held reference and source.
- Full correctness: all material requested parts without unsupported additions.
- Unsupported assertions, stale-state use, proposal-to-adoption upgrades and
  unjustified certainty, recorded separately.
- Insufficient retained evidence and whether abstention was justified;
  abstention does not by itself make an answer correct.
- Unavailable or ambiguous truth, recorded as not-ratable rather than success.

Trace necessary sources separately through write, candidate visibility,
selected identity, whole-source packing and final answer. Gold-session
membership alone does not establish necessary evidence. Report observed,
trace-supported differences; one stochastic output per arm cannot causally
separate the code change from model variance. No opportunity or no observed
gain is an inconclusive/negative result, not permission to manufacture another
case.

This diagnostic can inform whether to freeze a later paired24; it establishes
neither broad accuracy nor a competitor result. The later gate remains net
>=3/24 correct improvement with targeted benefit, no increased unsupported/stale
use or new severe failure, plus resource gates. A resource-matched flat control
must precede any routing-efficiency claim. Fresh30 later requires >=29 completed
and >=same-batch Mem0, with uncertainty, resources and failures reported. There
is no automatic expansion, default promotion or merge.

## D5. Delivery and delegation

An actual GPT-6.1 Sol/high worker owns the new private operator, operator tests,
launcher and implementation evidence. The primary owns selection/preparation,
contract, integration, acceptance and live access. The operator worker uses
synthetic inputs; it does not receive real corpus, ledger or keys. The operator
must implement four actual routes and v2's two-group/two-flat quotas, rather
than relabel a previous two-arm denominator.

Keyless Node 22.16/24.15 checks cover >36-reference ordinary capture with real
classification, all four routes and fixed orders, unchanged per-case store,
strict source-only packing, case/total caps, preflight failures, partial-write
read prohibition, safe continuation versus global stops, generic-wrapper
refusal, first-only claims/hash drift, accounting retention, exits and cleanup.
The primary repeats combined paths. Independent non-author Standards and Spec
reviewers inspect the exact private helper/contract/runtime and source-preparation
bindings before credential access; changes repeat affected checks and both
reviews. The final runtime binding is fixed to the reviewed commit above,
never an arbitrary runtime supplied to the live entrypoint.

Public documentation and a metadata projection are delivered separately from
the private operator. Public hashes identify retained evidence; they do not
make private authentic traces publicly replayable or establish anonymization.
No raw conversations or secret configuration belong in the public projection.
Closed mechanical records, frozen masked grades and sanitized primary
adjudication and independently rejoined exact-path source-loss tracing have
been supplied. No new benchmark framework, release or deployment is authorized.

## Mechanical closure checkpoint

The primary reports actual live exit 0 at `2026-10-18T20:02:46Z` and closure
audit exit 0 at `20:05:19Z`: two complete writes (51/48 batches, 239/225
memories), eight complete first read/answer outcomes, unchanged source/runtime
and canonical snapshots, settled owned accounting and exact workspace absence.
The authorized mechanical projection SHA256 is
`2e1b16d869162731f5305306148a0a8909cdfb6c17b3d16bb07bac80a807ad71`.
The [result document](../evidence/routing-idf-diagnostic.md) and
[public metadata projection](../../evaluation/architecture/routing-idf-diagnostic-results-20261018.json)
separate instrumentation, reservation/usage and completion from semantic
judgments. The frozen semantic projection SHA256 is
`18d41296665aa3c9ec1cb99803c52fe00b42bc6e0a9b159334b64d53f1a1e286`:
H6-1 has four not-ratable outcomes from a source/question-date conflict;
H6-2 has four incorrect outcomes with justified context-limited abstentions,
including one unsupported question-date/event-date substitution. No benefit
was demonstrated. The accepted source-trace projection SHA256 is
`71060dea1e2cb458a3e2bc77660f986ab431c9728905d80488dae4c1b424b052`:
references were visible on 16/16 original-statement/arm paths and 12/16 paths
were answer-packed (four unique original statements × four arms); original
dates remained only in source-map/audit sidecars, not
receipts or model-facing context. The next stage is shared-engine/consumer
source-time transport, then complementary-evidence selection, with offline
regressions rather than an automatic paid expansion. This checkpoint changes
none of D1-D5's acceptance rules and claims no runtime fix or promotion.
