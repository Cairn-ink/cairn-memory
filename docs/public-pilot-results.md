# Public pilot evidence

## Fixed five-case development pilot

The paired result on the four cases resolved by every arm was **Cairn 1/4,
full-history 1/4 and no-memory 0/4**. This was a fixed, selected development
pilot for plumbing and failure accounting, not a benchmark population,
leaderboard result, competitive comparison or reliability percentage. The
sample is too small to support a product-quality claim.

The run used the reviewed classification transport candidate from
[PR 189](https://github.com/Cairn-ink/cairn-memory/pull/189), exact commit
`8132c552bcf88df5d0f539475ef13b683baf480c`. All five cases were generated and
scored, but one Cairn arm failed before producing an answer. Therefore
"generated 5 / scored 5" is wrapper progress, not five successful Cairn arms.

### Results and denominators

| Arm | Fixed N | Resolved | Correct | Unresolved | Coverage | Resolved accuracy | Paired common result |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cairn | 5 | 4 | 1 | 1 | 80% | 25% | 1/4 (25%) |
| Full history | 5 | 5 | 1 | 0 | 100% | 20% | 1/4 (25%) |
| No memory | 5 | 5 | 0 | 0 | 100% | 0% | 0/4 (0%) |

The paired four-case column is the only like-for-like comparison. Cairn's 25%
resolved accuracy and full-history's 20% fixed-roster accuracy use different
denominators and do not show Cairn superiority. With one unresolved fixed case,
Cairn's fixed-N bounds are 20% to 40% depending on that case's unknown result.
These are deterministic missing-case bounds, not a statistical confidence
interval or population bound.

The single-session-preference case was correct for both evidence arms and
incorrect for no-memory. All three arms were incorrect on the multi-session,
temporal-reasoning and knowledge-update cases. On the
single-session-assistant case, full-history and no-memory were incorrect while
Cairn was unresolved. There was no single-session-user case and no abstention;
the six-type macro is therefore null.

Cairn's reference-session coverage in its final answer evidence was 1/1 for
single-session-preference, 2/3 for multi-session, 1/2 for knowledge-update and
2/3 for temporal-reasoning. Session coverage is not passage completeness,
entailment or answer correctness.

### Retained failure

The unresolved Cairn case stopped during capture at zero-based batch 23, the
24th of 54 batches. Batches 0 through 22 completed, batch 23 returned
`invalid_model_output` with `retryable: false`, and the remaining 30 batches
were not run. The scorer records `ingestion_incomplete` at the generation
stage, so no Cairn answer or judge request exists for that case.

The last successful count and generation attempt for the failed batch both
reported 2,330 input tokens; generation reported 325 output tokens. Those
values are below the 7,024-input and 1,024-output provider bounds. The exact
validation rejection was not retained, and the runner did not connect the
allowlisted diagnostic callback at this seam. A successful guarded HTTP
outcome does not distinguish adapter `parseOutput` rejection from later core
extracted-item validation, so the exact cause must remain unknown.

### Frozen protocol and artifacts

Memory extraction, classification and answers used
`gpt-4.1-mini-2025-04-14`; official-style judging used
`gpt-4o-2024-08-06`. The scorer used verified string-reference serialization
at upstream compatibility commit
`9e0b455f4ef0e2ab8f2e582289761153549043fc`, with one judge completion at
`temperature: 0` and `max_tokens: 10`.

The source-evidence context mode, recall limit of 6, 800-UTF-16-unit receipt
prefix, one-attempt request policy and stage-bound guard were unchanged.
Capture used baseline `core.capture`, without qualification or rationale
variants. The bounds remained 6,000 local classification-input tokens, 7,024
provider-input tokens and 1,024 provider-output tokens; answers used a 123,000
token context bound and 512 output tokens; judge input/output bounds were
4,096/16 tokens. This direct-core pilot is not evidence for advanced
reliability modes, an installed-live package or a native Hermes/provider path.

The original seven-case campaign envelope was 8,000,000 micro-USD and 1,600
requests. The executed five-case packet was capped at 7,665,000 micro-USD and
1,533 requests inside the existing shared 50,000,000-micro-USD / 5,000-request
ledger. Caps authorize reservation headroom; they are not invoices, retries,
refunds or budget resets.

The prepared v2 inputs and source were fixed by these public pins:

| Input | SHA-256 |
| --- | --- |
| Manifest | `71a3a344747b508f77d41de6152cd773d750915573f84b97af77397155387397` |
| Histories | `4d2fff60df3869a943e57efaa898fc7aea5263bf67c4e13deb3b9acacfee7746` |
| Questions | `11121b3e3b9867088b37ac4cd4de8348b4c066e53239e9c628b1218c8d0a19cd` |
| Evaluator | `97b508ad9fac8dbfe6bee8a629ac453159c5ff11925316ab66fdc873ca70e4d0` |
| Freeze record | `2f39baca7d42c4de7f31c0174c456270125aa1b82cc69178191fd989ad83ad4c` |
| Launcher | `bb866336d907800e939cfc92662983104de5efb9d563e741a754f0e2678620aa` |
| Final report | `6dd0f102f6032756f0bd97be3b2c9ea212217d174e8a145d391d46e629fe3b5b` |
| Final aggregate | `a33e9d8ce9f209eec765425552a442b5ad1a1e185a59a490ecc3c999f9bdf536` |

The frozen source dataset revision was
`98d7416c24c778c2fee6e6f3006e7a073259d48f`, with file SHA-256
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`.
No source text, answers or references are reproduced here.

### Request and cost accounting

Reservations are budget holds, not provider invoices. Known cost is computed
from returned token usage; the count-only callback did not return billable
usage, so its billing remains unknown rather than being estimated.

| Stage | Requests | Reserved micro-USD | Known usage-priced micro-USD | Unknown billing |
| --- | ---: | ---: | ---: | ---: |
| Cairn count | 430 | 2,150,000 | 0 | 430 |
| Cairn generation | 430 | 2,150,000 | 663,645 | 0 |
| Answer | 14 | 711,480 | 229,926 | 0 |
| Judge | 14 | 145,600 | 10,687 | 0 |
| **Total** | **888** | **5,157,080** | **904,258** | **430** |

All 888 guarded/accounted requests completed at the transport layer, with 888
unique attempt IDs and no reservation overrun. That does not imply semantic or
validation success. All 430 count diagnostics were within the unchanged 7,024
input bound (observed range 452 to 6,005). Judging began only after every
generation attempt had settled. Generation took 1,872,437 ms, scoring 12,741
ms and the recorded total was 1,885,761 ms.

The shared campaign ledger remained open at 34,444,080 of 50,000,000
micro-USD reserved and 3,609 of 5,000 requests, leaving 15,555,920 micro-USD
and 1,391 requests. There was no reset, refund or paid request after this run.

### Earlier two-case record remains separate

The original two-case run at revision `a31f9d9` remains a separate failed
record: 67 requests, 335,000 micro-USD reserved, 58,266 micro-USD known
usage-priced cost, one unknown classification-count outcome, no answer or judge
requests, and `commonN = 0`. No case was rerun or substituted, and those cases
are not mixed with this revision for accuracy.

Across all seven original campaign slots, accounting only—not accuracy—sums to
955 requests, 5,492,080 micro-USD reserved and 962,524 micro-USD known cost.
The original failure and all reservations remain visible.

### Post-hoc qualitative audit

A manual audit after scoring matched every prepared question, date, evaluator,
source ID, type and arm join; it found no positive evidence of a mapping bug.
It was not an independent judge or a rescore. In each of Cairn's three resolved
incorrect cases, the final evidence omitted necessary source context: the
multi-session answer covered two events but missed the third, the update case
missed the later value and abstained, and the temporal case missed the winning
evidence and made a claim unsupported by its subset. The multi-session and
update passages were retained verbatim in current filed memories but were not
recalled, bounding those failures to the broader recall
selection/ranking/budget path. The temporal passage came from one untruncated
planned chunk but had no receipt row after completed ingestion, bounding that
failure to the broader capture/admission/source-attachment path. These checks
do not identify a narrower subroutine. The correct preference case had 1/1
reference-session coverage.

All four incorrect full-history answers followed unrelated tasks embedded in
the history. This is qualitative evidence, not proof of causality. Three
full-history outputs—the multi-session, knowledge-update and
single-session-assistant cases—reached the 512-token output limit and ended
mid-structure. Because completion finish reasons were not retained, provider
length termination cannot be claimed.

### Practical limitations

- Classification reads one page. An applied placement can leave a retained
  memory unfiled; unfiled memories remain inspectable and eligible for bounded
  recall, so unfiled does not mean lost.
- Recall and source scanning remain budgeted. `budget_exhausted` reports an
  incomplete bounded scan, not a context-packing failure or proof of absence.
- The 800-UTF-16-unit receipt prefix remains. Across the five cases, 1,050 of
  2,337 planned chunks exceeded that bound, but this corpus-wide potential
  suffix is not necessarily answer-relevant loss. Only 13 receipt occurrences
  were packed; four came from over-bound chunks, totaling 5,271 omitted units.
  Packed counts can repeat a source, and the all-chunk original/retained
  denominator was not persisted, so no truncation percentage is reported.
- Provider/guard success does not establish correct extraction, source
  selection, answer use or judging reliability. The pilot does not establish
  that a larger run would behave similarly.

The request-local wire alias reduced one fixed local serialized count-request
projection from 7,349 to 3,803 tokenizer tokens while preserving the visible
fixture. This is transport evidence, not a provider count, semantic result or
proof of the earlier failure's cause.

See the [runner protocol](public-pilot-runner.md),
[known limitations](limitations.md),
[classification wire-alias plan](plans/classification-wire-aliases.md) and
[roadmap](../ROADMAP.md) for the surrounding contracts and next gates.
