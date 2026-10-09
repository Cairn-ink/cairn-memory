# Source-diverse linked evidence: frozen development results

Decision: revise, not advance. The combined candidate gained 4 correct answers
against its new paired baseline and 8 packed source anchors, within all declared
resource ceilings. The unchanged safety gate nevertheless blocks advancement:
baseline D22 has an unresolved unsupported-claim disagreement. Stage 3, product
acceptance and default promotion remain blocked; no disagreement is adjudicated.

This is the closed execution of the [prospective B1–B12 contract](evidence-bundle-qa24.md),
on the same 24 previously seen authored short development cases, not holdout,
official LongMemEval, long-history or installed-host evidence. Treatment is one
combined selection/ranking candidate, not a ranking-only attribution. Compare
only these paired arms; the earlier 10/9 and 20/23 results remain frozen under
their own settings and cannot serve as this trial's comparator. There is no
native Mem0 comparison, parity claim, release or merge in this result packet.

## Runtime, operation and judging

Reviewed runtime: `e729262e90636669755fadca050a4911cf093faf` (#387), executed
with Node 22.16.0 and the unchanged `gpt-4.1-mini-2025-04-14` evaluated model.
Primary recorded that runtime's 31/31 CI checks green and its PR ready and
MERGEABLE, but unmerged. That engineering checkpoint is not a QA acceptance.
The one-shot operation started at `2026-10-09T21:57:37.401Z` and closed
successfully at `2026-10-09T22:15:59.945Z`; its report has `fatal: null`.

Capture ran once per case; each arm cold-opened the same captured state,
alternating first-arm order by ordinal. Baseline used ordinary select/rank;
treatment used `source-diverse-linked-v1`, composing the existing source-diverse
selector and bounded literal-linked rank wrapper. Both used `verifiedRoleEvidence`
(`source-role-evidence-v1`), the unchanged answer instruction/packer, model,
six-unit limit, corpus, transport and resource ceilings. Recorded roles remain
untrusted submitted evidence, not speaker authentication or execution permission.

Two nonauthor blind judges ran in separate new contexts, each actual GPT-6.1
Sol/high, under the frozen requested-answer v2 rules and unchanged calibrations.
That judge/worker model is not the evaluated model. Each submitted all 48
judgments; there was one correctness disagreement, no missing judgments and no
explicit unknown verdict submissions. Agreement-only aggregation leaves the
disagreement unresolved. Full histories support correctness judging; actual
packed evidence supports claim judging. Original first submissions remain sealed,
with no adjudication, rescore or favorable selection. Same-family agent agreement
is not independent human ground truth. Blind arm mapping remains local only;
this report publishes no blind labels, source text or answer bodies.

## Fixed-denominator answer outcomes

All 24 captures and all 24 answers per arm completed successfully. Execution
completion and agreement-only correctness are separate:

| Arm | Execution /24 | Correct | Incorrect | Unresolved |
| --- | ---: | ---: | ---: | ---: |
| Ordinary baseline | 24 | 18 | 5 | 1 |
| Combined treatment | 24 | 22 | 2 | 0 |

Baseline D22's unresolved slot is judge disagreement, not failed execution.
Paired outcomes over all 24 are 5 wins (D09/D10/D11/D12/D22), 1 loss (D19),
17 both correct and 1 neither correct (D16): net correct +4. D22 contributes
no baseline correct credit; its win does not resolve its safety unknown.

| Family (four cases each) | Baseline correct / incorrect / unresolved | Treatment correct / incorrect / unresolved | Execution per arm |
| --- | --- | --- | --- |
| Detail retention, D01–D04 | 4 / 0 / 0 | 4 / 0 / 0 | 4/4 |
| Lexical/paraphrase/CJK, D05–D08 | 4 / 0 / 0 | 4 / 0 / 0 | 4/4 |
| Multi-session links, D09–D12 | 0 / 4 / 0 | 4 / 0 / 0 | 4/4 |
| Event-time/late import, D13–D16 | 3 / 1 / 0 | 3 / 1 / 0 | 4/4 |
| Proposal/adoption/premise update, D17–D20 | 4 / 0 / 0 | 3 / 1 / 0 | 4/4 |
| Unknown/conflicting evidence, D21–D24 | 3 / 0 / 1 | 4 / 0 / 0 | 4/4 |

Every paired slot follows; every entry executed successfully in both arms.

| Case | Baseline judgment | Treatment judgment | Pair |
| --- | --- | --- | --- |
| D01 | correct | correct | both correct |
| D02 | correct | correct | both correct |
| D03 | correct | correct | both correct |
| D04 | correct | correct | both correct |
| D05 | correct | correct | both correct |
| D06 | correct | correct | both correct |
| D07 | correct | correct | both correct |
| D08 | correct | correct | both correct |
| D09 | incorrect | correct | win |
| D10 | incorrect | correct | win |
| D11 | incorrect | correct | win |
| D12 | incorrect | correct | win |
| D13 | correct | correct | both correct |
| D14 | correct | correct | both correct |
| D15 | correct | correct | both correct |
| D16 | incorrect | incorrect | neither correct |
| D17 | correct | correct | both correct |
| D18 | correct | correct | both correct |
| D19 | correct | incorrect | loss |
| D20 | correct | correct | both correct |
| D21 | correct | correct | both correct |
| D22 | unresolved | correct | win |
| D23 | correct | correct | both correct |
| D24 | correct | correct | both correct |

## Safety and unchanged advancement verdict

Question-level harm counts use all 24 slots per arm; overlap is allowed.

| Classification | Baseline known / unknown | Treatment known / unknown |
| --- | --- | --- |
| Unsupported-answer questions | 1 / 1 | 1 / 0 |
| Stale-use questions | 0 / 0 | 0 / 0 |
| Severe-error questions | 1 / 0 | 0 / 0 |

Known unsupported questions are baseline D12 and treatment D10. Baseline D12
is also the one known severe error; treatment has no newly failing severe case.
Baseline D22's unsupported classification remains unknown. All other question
classifications are clean, including stale-use in both arms. Treatment D10 can
be requested-answer correct while containing an unsupported claim: correctness
and packed-source support are distinct criteria.

Claim totals remain separate for each judge, without pooling unlike denominators:

| Judge / arm (24 submissions each) | Reviewed claims | Unsupported claims | Stale claims |
| --- | ---: | ---: | ---: |
| A / baseline | 38 | 2 | 0 |
| A / treatment | 43 | 1 | 0 |
| B / baseline | 38 | 1 | 0 |
| B / treatment | 44 | 1 | 0 |

The net-correct requirement (≥3) passes at +4; targeted packed-anchor gain
passes at +8; all resource checks pass. However, the aggregate has
`safety.unknown: true`, `blocksAdvancement: true`, and `advances: false`.
Its conservative `noIncreasedUnsupported: false` and `noIncreasedStale: false`
flags are unproven safety gates under the blanket unknown rule, not observations
of increased stale use. Known unsupported-question counts are equal; known
stale counts are zero. Do not relax the gate or silently interpret unknown as
no harm. Decision: revise while preserving all sealed outcomes.

## Source-anchor coverage and actual intervention

Literal normalized origin-bound presence is independent of answer correctness
and semantic support. All stages use the same 42 frozen diagnostic source anchors:

| Stage | Baseline present / absent | Treatment present / absent |
| --- | --- | --- |
| Capture-retained | 42 / 0 | 42 / 0 |
| Candidate-reachable | 42 / 0 | 42 / 0 |
| Effectively selected | 30 / 12 | 42 / 0 |
| Recalled | 29 / 13 | 37 / 5 |
| Actually packed | 29 / 13 | 37 / 5 |

Unknown and not-run counts are zero at every stage in both arms. Presence in
the candidate-reachable metric does not prove complete source text in navigation
labels. Coverage validates authoritative receipts, effective compiler traces and
actual packed requests; there is no raw-ref fallback or oracle backfill.
Some diagnostic anchors, including background in D13/D14/D19, are optional for
requested-answer correctness under v2. A missing diagnostic anchor does not imply
a missed required answer proposition.
Five treatment anchors were selected but did not survive recall. Packing omitted
zero whole units in either arm, so this measured loss precedes answer packing.

The primary's retained-request audit records the actual interventions, rather
than assuming the rank wrapper restored every missing chain:

| Trace measure | Baseline | Treatment |
| --- | ---: | ---: |
| Raw select refs | 42 | 47 |
| Effective select refs | 42 | 71 |
| Additional wrapper public reads | 0 | 190 |
| Accepted source material bytes | 0 | 59,870 |
| Raw rank refs | 27 | 38 |
| Effective rank refs | 27 | 39 |
| Added / displaced rank refs | 0 / 0 | 1 / 0 |
| Packed evidence units | 27 | 39 |
| Packed answer-input tokens | 6,414 | 8,006 |
| Omitted whole units | 0 | 0 |

The sole observed rank addition was D04 treatment, with no displacement.
The selector changed exposure substantially; this run cannot isolate a
ranking-only or role-rendering-only effect. Wrapper read/material counts exclude
ordinary core reads and are not RSS measurements. Ref counts are not anchor
counts, and neither is a semantic-support score.

## Resources, accounting and fixed ceilings

Actual HTTP attempts were 392: 172 provider token-count requests, 172 core
generation requests and 48 answer requests. The primary audited 784 durable
request snapshots and decoded all 172 core model calls. There were 24 retained
cold databases totaling 13,475,840 bytes; matched arm state identities and prior
closed report identities remained unchanged. These are retained-store bytes,
not a measured incremental growth/expiry study. CPU and peak RSS were not measured.

| Phase | HTTP attempts | Generations (including answers) | Input / output tokens | Measured elapsed ms |
| --- | ---: | ---: | --- | ---: |
| Shared capture | 152 | 76 | 57,234 / 6,508 | 439,126.303276 |
| Baseline recall/answer | 120 | 72 | 47,249 / 3,300 | 322,855.937148 |
| Treatment recall/answer | 120 | 72 | 53,649 / 3,947 | 339,112.523046 |

Total generation usage was 158,132 input + 13,755 output = 171,887 tokens,
with zero unpriced generation calls. Report runtime was 1,101,925.489457 ms
(18.3654248 minutes), including overhead outside the phase timings. Per-case
core generation counts ranged 6–10, with two answers and 14–22 HTTP attempts;
the maximum observed case elapsed time was 62,356.137186 ms.

The unchanged limits were 24 cases, 40 core calls plus two answers per case,
1,968 HTTP requests, US$10 conservative run reservation, US$400 cumulative
campaign and US$30 protection. Token ceilings remained 6,000 local input,
7,024 provider count, 1,024 core output and 512 answer output; physical request,
case and run bounds were 200 seconds, 20 minutes and 8 hours. Ordinary core
logical calls retained their 30-second deadline. Per-request reservation was
5,000 micro-US dollars. Every retained resource check passed: pinned model,
no fatal, request/local/cumulative ceilings, exact ledger delta, usage caps,
per-case calls, known generation prices and case/run deadlines.

Conservative reservations increased by US$1.96; the known model-profile usage
estimate was US$0.085352, not an invoice. Phase estimates were US$0.033334
capture, US$0.024211 baseline and US$0.027807 treatment. No reservation was
refunded or reset. On the original ledger, requests rose 56,171→56,563 and
reserved micro-US dollars 325,192,281→327,152,281. Pending attempts were zero;
US$42.847719 remained outside the protected US$30 at close. This historical
balance is not dispatch authority or evidence that a larger pilot is affordable.

## Loss boundaries and next bounded direction

Primary's read-only replay reproduced the closed D10/D16 compiler outputs
exactly: needed targets were already rank-visible but not retained. Original
missing-target assertion probes exited 1 and remain retained. The minimized
controls pin target and seed as evaluator preconditions, using copied inputs
only; neither evaluator identities nor synthetic diagnostic codes enter a
production retrieval path.

| Case / minimized cards | Single diagnostic change | Target retained |
| --- | --- | --- |
| D10 / 3 | Remove only the redundant assistant same-code card | yes |
| D10 / 3 | Restore that same card | no |
| D16 / 2 | Add an identical synthetic diagnostic code to both copied cards | yes |
| D16 / 2 | Add the code to only one copied card | no |

D10 demonstrates suppression associated with a repeated literal code; D16's
existing natural-language reference is not linked by this code matcher. Raising
the original copied-input limit from 6 to 12 did not restore either target,
so those controls do not support capacity as the tested explanation. The full
positive/negative control packets passed with actual exit 0 on both Node 22.16.0
and 24.15.0, with zero network/paid calls and unchanged original report bytes.
These establish narrow navigation limitations, not the model's internal reason,
a semantic production fix or a new QA result. No frozen verdict changed.

D19 is the paired loss. Primary compared all 24 actual serialized answer-request
pairs: 11 were byte-identical (D01/D02/D06/D08/D13/D14/D15/D16/D18/D19/D21),
and only D19 among those pairs produced different answers. Both D19 arms received
the same current evidence, including the required reconfirmation status.
Baseline included that qualification; treatment omitted it. Both sealed judges
therefore marked treatment incorrect, while its stated negative-confirmation
claim remained supported with no unsupported/stale/severe error. This is
output-stage variation with identical input, not a treatment-specific retrieval
regression or proof that a missing older anchor caused the loss. The model's
internal reason remains unknown. Coverage and answer use stay separate.

Before broader holdout, the next bounded algorithm direction is to investigate
preservation of already selected, rank-visible complementary evidence under the
existing caps, using the minimal red controls and source-free trace audit. Freeze
the proposed policy and negative controls before implementation, avoid evaluator
gold in retrieval, and demonstrate actual selected→ranked→packed behavior plus
capacity/displacement, irrelevant evidence and freshness failures. D10's known
unsupported claim and D19's qualification omission remain separate acceptance
risks; D19 specifically requires an identical-input answer-use control rather
than a retrieval-loss explanation. Extra coverage cannot substitute for support
or correctness. The selector
can still omit needed evidence beyond its four novelty additions, and literal
identifier equality does not prove entity identity. Recorded roles do not identify
the claim subject, establish adoption or authenticate a speaker.

Any later QA comparison needs a new prospectively reviewed paired freeze and
current original-ledger affordability; a closed run cannot be continued or
rescored. This development set is consumed and selection-biased. Separately
frozen fresh/broader data, reliability challenges, natural installed Hermes
sessions and CPU/RSS/resource evidence remain necessary after development
acceptance. No new paid operation is authorized by this document.

## Frozen evidence identities and delivery

The source-free facts SHA-256 is
`2b3f509dc04b0eb25a43c5151f0952c36c0d2153b91b20209a0c3f3e9df1bf06`.
Private artifacts are retained under operation `cairn-evidence-bundle-live.Bq2B0WTi`;
hashes bind them without publishing source text, answers or the arm mapping.
Report/launch/coverage/judgment schemas are the separate
`source-diverse-linked-requested-answer-{comparison,launch,coverage,judgments}-v1`
identities; blind protocol is `source-diverse-linked-requested-answer-blind-judging-v1`.

| Retained artifact | SHA-256 |
| --- | --- |
| Prospective manifest | `71df912b486854453e16ee628a770dc58917619cdb2c84ac62ecc3b4accd467b` |
| Report | `dff3f896e0b76ca4a7a0c4c5895c5571367bd7c8072d6b7d637218d102ca8561` |
| Blind packet | `3c4b06dd2acfa0e8dedb2d37e5c8e09fd1bdc78c64a241d1c14509efe30d08ed` |
| Coverage | `edcb270cc86cfbb88b3864314ddcf696a65a9229f1b7fc05a3585b956f6e172d` |
| Resource audit | `ee4848fc9265598756a89cf10ebc2714d61541c2eae62ce8fadd2a4df93e3b2f` |
| Original judge A submission | `4b53e706663e56833d64a5ebaa3e42c32d256226e25ecc61d74cbeac66c1919d` |
| Original judge B submission | `58d888178a5e080401ba8301b8e4f5091cf84f6fd5cc89b504e6bbf1ba3b5d7f` |
| Judgment aggregate | `8404ed86eb1ee42e65ab71f0371d741df734f595238c0aaf79243f15fc634897` |
| Primary artifact audit | `976905cef0a4264d8c1b4eaf4f2ca98db97a9c34554d6c09078a30c75c63bae5` |

Supplementary source-free offline evidence is separately retained, not a change
to the paid operation or first judge submissions:

| Diagnostic artifact | SHA-256 |
| --- | --- |
| Bridge controls, Node 22.16.0 (actual exit 0) | `f1d4ee83c90dbb7ec4c3092eb8d20eaedb2185207c9ce022b9208755303fce97` |
| Bridge controls, Node 24.15.0 (actual exit 0) | `773230c45d8570a19164fb5bd08098eddf6f69e6f9449a6e33d36c93e01dc269` |
| Answer-wire pair audit (actual exit 0) | `6d5396f3426bfc6c2dea91d00679b63ff7cca17a5dbf9eadc1b885d3fc12ccfd` |

The manifest binds the runtime, both wrappers, role verifier/packer, source and
evaluator modules, tests, plan, Node binary and original/new freeze identities.
Node binary SHA-256 is `8142d37c6f2f372ef040419e7a111a6baf17df89f8078d02447d6c639ae20c1d`.
The original `algorithm-development-requested-answer-v2` rubric is unchanged;
only the new judging protocol version differs, not its criteria/calibrations.

| Frozen component | SHA-256 |
| --- | --- |
| Source/model inputs, unchanged | `56f0db72471781497872cdf757c9f9db45772a334198e9e26ac1b4dd947215ac` |
| Original rubric, unchanged | `c40952734852e01072185939c51f54efa8238d5fa1b44259bf3964b8088ce4f5` |
| Requested-answer v2 rubric, unchanged | `580c2c5c00a06d0fb6bbef6e6f97e658d26489483c1cd63adb1bb50fc2eaeef2` |
| Compiled rubric, unchanged | `faa2885f276d1c2e97580d6af7c3d05386b4315e7cb2f89cf1aaa5bd6dee6f1a` |
| Original judging protocol | `763f0988bb8076e63b1f54225f511776e77408694643fae36b4b6a663a342171` |
| Original requested-answer freeze | `4a136c561318c8af9a9ba2666064cb483f9dd2095dbf186b019041ff81950f25` |
| New judging protocol | `05bb0ec5ed26c121e4586e575bf70f80108e0300b68320301662fa812e55b2f2` |
| New combined freeze | `bc62d50bf8d9a77c8b3f0dc95ad4643a2c3f2e0b331396a957d2728ca0263c63` |

Primary directly audited the sealed operation. The bounded docs worker, actual
GPT-6.1 Sol/high, independently compared the aggregate, coverage, resource audit,
primary-audit totals and all nine retained artifact hashes against the supplied
source-free facts; the read-only check exited 0. No worker elapsed/cost or CPU/RSS
measurement is available. This docs-only packet changes no runtime, test, rubric,
live artifact or historical report. Worker inventories by diff plus untracked
paths and independently by porcelain status agreed on exactly three assigned
docs files; `git diff --check` exited 0. ROADMAP remains unchanged because its
global pending gate is still accurate. Final contributor gates on both supported
Nodes, independent same-SHA Standards/Spec review and latest-head CI/mergeability
are recorded separately in the delivery PR; they do not change the semantic verdict.
