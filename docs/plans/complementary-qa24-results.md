# Complementary source: closed three-arm development results

Decision: revise, not advance. Ordinary baseline A scored 19/24; the previous
source-diverse/linked combination B and complementary candidate C each scored
23/24. C gained four correct answers over A, but none over B. C delivered all
42 diagnostic anchors versus B's 39 and A's 28, yet introduced an unsupported
severe D12 answer against the clean baseline. The frozen safety gate fails:
`advances: false`, `incrementalSuperiority: false`. These scores exist; they
do not authorize promotion, Stage 3 or another paid run.

This executes the [frozen Q1–Q8 protocol](complementary-qa24.md) on the same
24 previously seen authored short development cases. It is not fresh holdout,
official LongMemEval, a Mem0 comparison, competitive parity, long-history,
natural Hermes use or production evidence. Earlier closed comparisons remain
unchanged; historical 22/24 and offline 36/36 are not this run's comparator.

## Runtime, operation and judgments

Reviewed runtime `78d7e37b2cb55afe14d26422beca11864cb9d9aa` executed once on
2026-10-11, approximately 07:18–07:41 UTC, closing at
`2026-10-11T07:41:11.119Z`. Primary recorded actual execution exit 0, no fatal,
retry or arm failure, 24 completed captures and 72 completed answers. Post-run
preparation and scoring each ran once with actual exit 0; no old operation was
resumed or rescored. Node was 22.16.0; the evaluated model stayed
`gpt-4.1-mini-2025-04-14`, not the judge/author model.

| Arm | Selection / rank policy |
| --- | --- |
| A, ordinary baseline | `ordinary-v1` |
| B, previous combined | `source-diverse-linked-v1` |
| C, complementary | `source-diverse-complementary-v1` |

All used `verifiedRoleEvidence`, unchanged `packMixedAnswer`, source-only
inputs and requested-answer v2 criteria. Capture occurred once per case; each
arm cold-opened the same logical state. All six arm-order permutations occurred
four times, giving eight appearances at each position. Independent per-arm
model calls mean the shared B/C selection policy does not guarantee identical
raw selection, rank inputs or outputs. This is not a ranking-only causal QA
comparison. Recorded roles/receipts establish submitted provenance, not subject
identity, truth, adoption, speaker authentication or execution authority.

Two new independent nonauthor judges, actual GPT-6.1 Sol/high, ran in separate
fork-none contexts and each submitted all 72 blind judgments. There were zero
correctness disagreements, missing judgments or unknown verdict submissions;
all safety classifications were known. Agreement-only aggregation preserved
the first submissions without adjudication or favorable picking. Same-family
agent agreement is not independent human ground truth. Full source histories
support correctness judging; actual packed evidence supports claim judging.
Blind labels/mapping and raw source/answer bodies remain local and unpublished.

## Answer outcomes over fixed denominators

| Arm | Execution /24 | Correct | Incorrect | Unresolved |
| --- | ---: | ---: | ---: | ---: |
| A | 24 | 19 | 5 | 0 |
| B | 24 | 23 | 1 | 0 |
| C | 24 | 23 | 1 | 0 |

| Pair /24 | Wins | Losses | Both correct | Neither correct | Unresolved pairs | Net correct |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| C−A | 5 | 1 | 18 | 0 | 0 | +4 |
| C−B | 0 | 0 | 23 | 1 | 0 | 0 |

`netCorrect` is the difference in certified correct counts. Unresolved pairs
would remain in the denominator and outside the four resolved categories;
none occurred here. The correctness-resolution gate is not a requirement for
perfect accuracy. Coverage gain does not turn C−B's zero QA gain into positive
incremental superiority.

| Family, four cases each | A correct / incorrect / unresolved | B | C |
| --- | --- | --- | --- |
| Detail retention, D01–D04 | 2 / 2 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| Lexical/paraphrase/CJK, D05–D08 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| Multi-session links, D09–D12 | 2 / 2 / 0 | 3 / 1 / 0 | 3 / 1 / 0 |
| Event-time/late import, D13–D16 | 3 / 1 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| Proposal/adoption/premise update, D17–D20 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |
| Unknown/conflicting evidence, D21–D24 | 4 / 0 / 0 | 4 / 0 / 0 | 4 / 0 / 0 |

All 24 case outcomes follow; every slot executed in all three arms.

| Case | A | B | C |
| --- | --- | --- | --- |
| D01 | incorrect | correct | correct |
| D02 | correct | correct | correct |
| D03 | incorrect | correct | correct |
| D04 | correct | correct | correct |
| D05 | correct | correct | correct |
| D06 | correct | correct | correct |
| D07 | correct | correct | correct |
| D08 | correct | correct | correct |
| D09 | incorrect | correct | correct |
| D10 | incorrect | correct | correct |
| D11 | correct | correct | correct |
| D12 | correct | incorrect | incorrect |
| D13 | correct | correct | correct |
| D14 | correct | correct | correct |
| D15 | correct | correct | correct |
| D16 | incorrect | correct | correct |
| D17 | correct | correct | correct |
| D18 | correct | correct | correct |
| D19 | correct | correct | correct |
| D20 | correct | correct | correct |
| D21 | correct | correct | correct |
| D22 | correct | correct | correct |
| D23 | correct | correct | correct |
| D24 | correct | correct | correct |

## Safety and advancement verdict

Question-level counts use all 24 slots; overlapping classifications are allowed.

| Classification | A known / unknown | B known / unknown | C known / unknown |
| --- | --- | --- | --- |
| Unsupported-answer questions | 0 / 0 | 2 / 0 | 1 / 0 |
| Stale-use questions | 0 / 0 | 0 / 0 | 0 / 0 |
| Severe-error questions | 0 / 0 | 1 / 0 | 1 / 0 |

B's unsupported cases are D10/D12; C's is D12. D12 is severe in both B and C
but clean and correct in A. B's D10 is requested-answer correct while adding
an unsupported claim; answer correctness and packed-source support differ.

| Judge / arm, 24 submissions each | Reviewed claims | Unsupported claims | Stale claims |
| --- | ---: | ---: | ---: |
| Judge A / A | 37 | 0 | 0 |
| Judge A / B | 53 | 2 | 0 |
| Judge A / C | 55 | 1 | 0 |
| Judge B / A | 36 | 0 | 0 |
| Judge B / B | 49 | 2 | 0 |
| Judge B / C | 51 | 1 | 0 |

Both paired stale checks pass. C−B has no unsupported-question increase or
new severe case, but C−A has an unsupported-question increase and newly severe
D12. This is a known observed harm regression, not the safety-unknown failure
of earlier trials and not a new zero-harm requirement for all controls.

| Frozen gate | Result |
| --- | --- |
| `noFatal` | true |
| `correctnessResolved` | true |
| `primaryQA`, C−A ≥3 | true (+4) |
| `primaryPackedGain`, C−A >0 | true (+14) |
| `linkedQANoRegression`, C−B ≥0 | true (0) |
| `linkedPackedNoRegression`, C−B ≥0 | true (+3) |
| `safety` | false |
| `resourcesWithinLimits` | true |
| `advances` / `incrementalSuperiority` | false / false |

## Coverage and actual intervention

Literal normalized origin-bound anchor presence is not QA or semantic support.
Each stage uses all 42 frozen diagnostic anchors, including optional background
that requested-answer v2 does not always require.

| Stage, present /42 | A | B | C |
| --- | ---: | ---: | ---: |
| Capture-retained | 42 | 42 | 42 |
| Candidate-reachable | 42 | 42 | 42 |
| Effectively selected | 30 | 42 | 42 |
| Recalled | 28 | 39 | 42 |
| Actually packed | 28 | 39 | 42 |

Unknown/not-run counts are zero throughout. Absent counts are 42 minus present;
candidate reachability is not full passage visibility in labels. Coverage
replays actual selection/rank compilers and authoritative packed requests,
without raw-ref fallback or oracle backfill.

| Actual trace total | A | B | C |
| --- | ---: | ---: | ---: |
| Raw select refs | 36 | 41 | 39 |
| Effective select refs | 36 | 68 | 67 |
| Additional wrapper public reads | 0 | 184 | 184 |
| Accepted source material bytes | 0 | 58,251 | 58,251 |
| Raw rank refs | 26 | 34 | 35 |
| Effective rank refs | 26 | 37 | 65 |
| Added / displaced rank refs | 0 / 0 | 3 / 0 | 30 / 0 |
| Packed evidence units | 26 | 37 | 65 |
| Packed answer-input tokens | 6,407 | 7,725 | 10,570 |
| Omitted whole units | 0 | 0 | 0 |

All C rank pools contained at most five cards: 23 compiler decisions were
`complete_small_seeded_pool`, one `empty_rank`. This run never exercised the
larger-pool lexical strategy, so it supplies no live evidence of that strategy's
benefit. C's extra context is not free: more units and answer-input tokens,
but no extra candidate model call and no incremental QA win over B. Ref counts
are not anchor counts; local wrapper reads exclude ordinary core reads and
are not CPU/RSS measurements.

## Resources and accounting

The retained audit accepts all frozen resource checks, including cold-state
identity and balanced order. There were 512 HTTP attempts: 220 token-count
requests plus 292 generations (220 core and 72 answers), all successful.

| Phase | HTTP | Core / answer generations | Input / output tokens | Elapsed ms | Known profile estimate, USD |
| --- | ---: | --- | --- | ---: | ---: |
| Shared capture | 152 | 76 / 0 | 56,774 / 6,454 | 406,480.431626 | 0.033068 |
| A recall/answer | 120 | 48 / 24 | 45,583 / 2,996 | 311,011.237045 | 0.023061 |
| B recall/answer | 120 | 48 / 24 | 52,265 / 3,566 | 318,410.560337 | 0.026649 |
| C recall/answer | 120 | 48 / 24 | 54,263 / 3,559 | 311,372.908397 | 0.027438 |

Total generation usage: 208,885 input + 16,575 output = 225,460 tokens; zero
unpriced generation calls. Runtime was 1,348,122.381232 ms (22.468706 minutes),
including overhead beyond phase timings; the slowest case was 71,705.938324 ms.
The 24 cold stores retained 92 cards (minimum 2, median 4, maximum 7), totaling
13,467,648 bytes. Store bytes are not incremental growth, expiry performance,
peak RSS or a lightweight installed-host measurement. CPU/RSS were not measured.

Limits stayed 40 logical core calls per case, split capture ≤16 and each arm ≤8,
three answers per case, 1,992 HTTP attempts and $10 local reservations. The
maximum request reservation is $9.96 (1,992 × 5,000 microUSD); the original
$400 cumulative ceiling and $30 protection are unchanged. Input ceilings were
6,000 local / 7,024 provider; output 1,024 core / 512 answer tokens. Physical
request/case/run limits were 200 seconds / 20 minutes / 8 hours, with the ordinary
core's 30-second logical deadline unchanged.

This run reserved $2.56. Its known model-profile usage estimate is $0.110216,
not an invoice. The closed evidence records original-ledger requests
56,563→57,075 and reservations 327,152,281→329,712,281 microUSD, no pending
attempts or refunds/resets. At that checkpoint $40.287719 remained outside the
$30 protection under $400. This historical accounting snapshot is not current
affordability, paid authority or permission to rerun the closed operation.

## Failure boundary and next bounded direction

D12 had all three needed diagnostic anchors packed in B and C. Their exact
retained serialized answer request bodies are byte-identical, SHA-256
`49585753cc9df46a01fa34a2e27454f1d2e0cf924635fe156ff5aa64e7db69df`.
Both answers bound the requested identifier to the wrong neighboring holder.
This locates the observed failure after evidence delivery, at the answer-use /
entity-binding boundary; it is not missing retrieval, proof of a model-internal
mechanism or proof that any formatting choice caused the error. A's correct
answer with less context does not establish that withholding sources is safe.

The primary has now inspected and rerun a bounded evaluator-only sealed D12
replay on exact Node 22.16.0 and 24.15.0 with a sanitized environment. Integrity
and positive/negative controls each exited 0 on both; symptom mode exited 1 on
both with the expected `ERR_ASSERTION: D12_UNSUPPORTED_ENTITY_BINDING`, not a
setup failure. Existing preparation, `verifiedRoleEvidence` and the real packer /
token counter reconstructed each complete frozen evidence/request exactly from
recorded authoritative get snapshots: two capture batches, three retained cards,
B/C 385 input tokens, 3/3 packed anchors, zero provider calls. Those snapshots
are not a new SQLite read. The static frozen oracle stays evaluator-only and
narrow, including a known-holder positive control and rejection of always
abstaining. It establishes a replayable symptom, not fresh generative
reproduction, a counterfactual cause, a fix or a new score. The first integrity
attempt exited 2 because of a `JSON.stringify(answer)` hash-convention mismatch;
that corrected diagnostic-harness error is retained separately from runtime.

Next, if warranted by this boundary evidence, separately freeze a fresh
entity-binding/evidence-use experiment before new answers. Preserve the old
verdicts: no rerun/rescore, no prompt tweaking until a favorable result, no
immediate Stage 3 and no broad new reader/architecture fix.

Long-history expansion is planned, not executed. The current eight-batch / ≤16
capture-call design can produce at most 40 cards, so a >36-card archive
precondition is fragile, not guaranteed. A >6-card rank pool and a >36-card
retained archive test different boundaries. Ordinary query-scored keyset/MOC
reference navigation is not hierarchical MOC-only topic discovery. Any expansion
must separately freeze source/capacity/resource preconditions; these docs supply
no additional paid authority or broad retention change.

## Evidence identities and delivery contract

The private closed operation is bound by these artifact digests, not by a
published private path or blind mapping. They permit identity checks, not public
reconstruction of unpublished source/answer bodies. The primary audited all
1,048 observation artifact hashes: 1,024 request snapshots and 24 case artifacts.
Independent readdir/find inventories agreed; an independent nonauthor operator
trace review passed. The primary's private trace-audit script initially exited 1
when it assumed baseline rank diagnostics were non-null; the corrected audit
exited 0. That was an audit assumption failure, not product/runtime failure.

| Retained artifact | SHA-256 |
| --- | --- |
| Prospective manifest | `ebd3f92c47ac86695131be7a7c3f462ce104696856db78dd54dba48d0869d380` |
| Report | `663995e030f739f82d4473aa64a873dcd93de3ccde55b0f96da2bf9ef39931ff` |
| Closure | `19d0340bc53afd8990f14f890f177fb02e2a369eff0a5a5558d79f96e05fe8df` |
| Coverage | `c3c6c0984550a5d0728fd1c5028b5d71489f98ce01dbff3077f27d0e7eb7e2dc` |
| Resource audit | `8c5b323174d6894923bf1cceb38e218f86132da3142d58826fe77c0c36f190d8` |
| Trace audit | `62b9e30549073c06a639fb0b8dc343787d798e397104f3c1950728846122da78` |
| Original judge A submission | `c6d548a811c2ec40dd40c345b445616e686429be030d5f8139cec88323b782e9` |
| Original judge B submission | `22cb291e2c95b5cf4de48b0bd1b307cdf8ce3e409e7bd267a4daa2a9be399c25` |
| Judgment aggregate | `d95e9bcc97ed753c78fb9d0eb2d5729b9d56745314aec54d78a5c06888ba5be9` |
| Judgment identities/audit | `787cd94046758994c70564a2d85edd72793a9e070ff6f1d69ef515197fcde38b` |

The unchanged source-model-input hash is
`56f0db72471781497872cdf757c9f9db45772a334198e9e26ac1b4dd947215ac`;
requested-answer v2 rubric hash
`580c2c5c00a06d0fb6bbef6e6f97e658d26489483c1cd63adb1bb50fc2eaeef2`;
frozen candidate file hash
`43fe41af5d2eff91e7bd1c76dd868af86e6b698f5f34d70e62a4bfd4a011c7f1`.
Node binary hash is
`8142d37c6f2f372ef040419e7a111a6baf17df89f8078d02447d6c639ae20c1d`.
The manifest binds all live paths, protocol, candidate, tests, plan and runtime;
report/launch/coverage/judgment versions use the separate
`complementary-source-requested-answer-*` identities, not the old two-arm profile.

The bounded docs author is actual GPT-6.1 Sol/high. Fixed delivery base
`78d7e37b2cb55afe14d26422beca11864cb9d9aa`, initially clean worktree
`complementary-qa24-results`, branch `docs/complementary-qa24-results`.
Primary fixed the following docs-only acceptance before delegation:

- R1–R2: Publish all fixed-denominator QA/pair/safety outcomes and failed gate,
  preserving independent blind judging and the noncausal D12 boundary.
- R3–R4: Derive coverage, actual traces and resources from closed evidence;
  distinguish QA, coverage, small pools, context costs and estimates/invoices.
- R5–R6: Retain failures, artifact identities and independent audit evidence;
  bound the next offline diagnostic and unexecuted long-history direction.
- R7–R8: Preserve implementation/verification chronology and historical results;
  exactly five scoped docs, independently cross-checked inventories and links,
  actual check exits, no paid/runtime mutation or unearned gate claims.

Only this result, an append-only execution record in the protocol plan, current
three-stage status, limitations and ROADMAP next-gate status change. README,
runtime, schema, fixtures, old reports, CI, defaults and budget remain unchanged.
Earlier primary checks on reviewed runtime 78 passed on both pinned Nodes with
actual exit 0, and 27 CI checks passed. Those are engineering observations,
not semantic acceptance or verification of this later docs candidate. This
candidate's primary contributor checks, independent Standards/Spec reviews and
latest-head CI remain pending until recorded by primary. No merge, release,
deployment or new paid operation is authorized here.

Precommit worker checks used read-only assertions: closed JSON reconciliation
of outcomes/pairs, harms/claims, stages, traces and accounting exited 0;
independent comparison of eight published numeric tables, all 24 outcome rows
and ten digests against sealed JSON exited 0. Relative-link checking found all
149 local targets present across the five scoped docs (exit 0). Git-diff/untracked
and independent filesystem Git-blob-hash/new-file-walk inventories matched
exactly five files, and the original protocol plan remained an unchanged prefix
(exit 0). `git diff --check` exited 0. No dependency install or runtime-worktree
edit was needed. Worker cost/elapsed/RSS is not measured. Primary must inspect
the actual diff before a scoped commit and record remaining delivery gates.
