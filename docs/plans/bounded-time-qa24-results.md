# T5 bounded-source-scan / source-time QA24 closure

Decision: **STOP the current two-candidate paid sequence and re-scope offline.**
All 24 pairs / 48 correlated answer cells completed. Ordinary A was correct on
20/24 and bounded-source-scan B on 22/24: three paired wins, one loss, net +2.
The unchanged P4 gate required at least +3. Better candidate exposure is not a
guarantee of downstream recall, supported answers or a passed architecture gate.
No automatic third variant, new paid run or default promotion follows.

The [public evidence packet](../evidence/bounded-time-qa24-results.json) preserves
all 24 authored synthetic histories/questions, seeds and held rubrics; all 48
exact actual two-message requests and answers; four original independent reports;
source-stage observations; and the primary's source-cited adjudication. This is
development evidence, not an official LongMemEval score or 48 independent trials.
It follows the [T4 label-only closure](source-time-qa24-results.md), without
changing that historical result. The governing architecture/gate context remains
the [immutable three-stage master plan](https://github.com/Cairn-ink/cairn-memory/blob/36c566013d615bc29852428bbf5fb1c77b80c70f/docs/plans/reliability-three-stage.md).

## Executed comparison and boundaries

The runtime was unchanged T2 commit
`287d22625faaa50b056c83cc5745be16d01171bf`; this documentation depends on T4 result
commit `3d336d61472cbeabe0adbe07d46a403729df254c`. Each case captured once into a
fresh owned store, closed it, and cold-reopened that same state for each whole
arm. A used ordinary default selection; B added only the existing
`selectionMode: bounded-source-scan`. Whole arms alternated AB/BA. Each arm did
its own recall, unchanged canonical [T2 pack](source-time-consumer.md) and one
answer. Both kept sourceTime, the same question text, source-evidence context
mode, explicit recall limit 6, model and caps. There was no shared T4-style
recall, deletion-only label factor, forced source selection or rank override.

The model was `gpt-4.1-mini-2025-04-14`, temperature 0, one answer with 512 output
tokens and 4,000 answer-input / 4,512 combined-token caps. Core limits were 6,000
local input, 7,024 provider input, 1,024 output and 8,192 context tokens. The
prospective ceiling was 60 physical requests / US$0.30 per case, 1,440 requests /
US$7.20 for the run, 30 seconds per HTTP request, 10 minutes per case and one
hour per run. These are diagnostic guardrails, not measured lightweight fit.

B's bounded strategy was observed as `complete-map` for all 24 short cases, with
semantic coverage explicitly unassessed. Internal complete-map chosen refs are
not exposed by this runtime. Therefore B SELECT is **not observed**, represented
as null / unknown, not zero selected sources or zero selection failures. Actual
canonical RANK input is separately observable; it is not relabeled SELECT.
No fallback was observed in this cohort. This does not exercise the >12-memory
per-namespace or >24-total fallback/long-history regime. The already-native
mixed comparator uses bounded scan already; it was not compared here.

## Correctness, support and safety

| Fixed denominator / diagnostic | A | B |
| --- | ---: | ---: |
| Completed / 24 | 24 | 24 |
| Full-source correct | 20 | 22 |
| Full-source incorrect | 4 | 2 |
| Unresolved / not-run | 0 / 0 | 0 / 0 |
| Actual-context supported answer | 16 | 18 |
| Justified abstention | 3 | 2 |
| Unsupported question | 5 | 4 |
| Stale-use question | 0 | 0 |
| Definite-value source sufficient / insufficient | 15 / 9 | 15 / 9 |
| Predefined severe violation / unknown safety | 0 / 0 | 0 / 0 |
| Asserted factual claims | 41 | 39 |
| Supported / unsupported claims | 32 / 9 | 32 / 7 |

Supported answers and justified abstentions are distinct labels. Full-source
correctness is not support by what the answer model actually saw; sufficiency
is a separate definite-value diagnostic, not an abstention penalty. The secondary
supported-correct diagnostic is A17/B18, not the primary P4 score. Zero severe
and unknown results are observed on this fixed cohort only, not general safety.

| Family (4 cases each) | A correct | B correct |
| --- | ---: | ---: |
| Detail | 4 | 4 |
| Lexical | 3 | 3 |
| Multi-session | 3 | 4 |
| Event-time | 3 | 4 |
| Commitment | 3 | 4 |
| Unknown | 4 | 3 |

Zero-based paired B wins were cases 8, 15 and 18; loss was 23; 19 pairs were
both correct and one (7) both incorrect. No unresolved pair was dropped. Net
correct +2 fails +3 even though the required-context, unsupported, stale,
severe/unknown and mechanical/resource component gates pass.

Two nonauthor GPT-6.1 Sol/high reviewers first judged full-source correctness
and safety, then separately judged actual-context sufficiency/support/claims.
First reports froze at 07:40:17.710Z and second reports at 07:48:35.597Z on
2026-10-19, both before primary opened the arm mapping. Same-family reviewers
and masked labels do not establish perfect blinding or human ground truth.
Both originals remain unchanged. Four field disagreements and seven claim
segmentation differences are retained; primary used reviewer B's entire
80-claim enumeration consistently, not favorable per-cell grading. Reviewer A's
72-claim enumeration remains available in full.

Primary resolved case 18 A's categorical window-inadequacy claim as unsupported
certainty but not a predefined severe violation; cases 21 A/B lacked a definite
occupancy value despite correct justified abstention; case 23 B lacked the
at-most upper-bound qualification needed for the full target. Primary also
explicitly clarified Seabright case 22: known 12 kg load plus unconfirmed weather
resistance is insufficient for both requested definite values. This changes
only that sufficiency diagnostic to insufficient in both arms, retaining both
reviewers' original sufficient labels. Correctness, support, claims, safety and
P4 do not change. Exact reasons and source/context citations are in the packet.

## Where evidence stopped moving

Coverage uses the frozen 32 required anchors / 23 positive cases, excluding
case 20's no-positive-source target. Historical-set coverage is not semantic
sufficiency. Missing/null observations receive no credit.

| Complete required source set / 23 | A | B |
| --- | ---: | ---: |
| Retained | 23 | 23 |
| Actual SELECT output | 19 | Not observed (23 unknown) |
| Visible in actual RANK input | 19 | 23 |
| RANK output / final recall | 17 | 18 |
| Actual answer context, including required time labels | 17 | 18 |

Anchor counts likewise move A32 retained → 28 RANK-visible → 26 recalled/context,
and B32 → 32 → 27. B SELECT remains 32 unknown anchor observations. The 15 optional
diagnostic anchors across 12 cases do not replace the fixed 32-required-anchor /
23-positive-case gate.
Snapshots stayed unchanged, both cold handles closed, and no answer packing
omissions explain or repair these cases. The packet retains actual SELECT/RANK
requests/outputs, packed-wire hashes/bytes and per-anchor stage observations.
Packing wire metadata comes from the frozen operator's closed report. Raw
operational count/generation envelopes, provider count acknowledgements and
accepted request identities are omitted audit-only details, bound by the
packet's closure-audit hash. Canonical messages plus these hashes do not alone
make this projection independently raw-wire-reproducible. Local packing token
counts are not provider acknowledgements. The closure's
`correctnessEvaluated:false` describes its mechanical pre-grading phase, not
the subsequent frozen semantic grades and primary result.

Primary's source/context inspection locates important limits without asserting
an internal model cause:

- Case 7's alias and case 9 Vardo's entity bridge were visible to RANK in both
  arms but dropped. A full-source-correct Vardo answer can still be unsupported
  by its actual context. Case 11 Redfern's bridge was absent from A SELECT,
  visible then dropped by B RANK. B exposure alone did not repair that bridge.
- Case 23 B's upper-bound source was RANK-visible but dropped; A retained it.
  This is the paired loss. Case 18 both arms had the same full two-source facts
  in reverse order; B's better qualification is observed, not proved caused by
  newly supplied evidence.
- Pallis case 14 had all dates and required tuples visible in both arms and
  correct arithmetic. Its unsupported flags arise because the frozen system
  prompt says opaque sourceTime labels do not establish event time or
  applicability, while the answers promote tomorrow/today plus those labels
  to definite event dates. This is a temporal-policy/semantic tension, not lost
  dates, failed arithmetic or proof timestamps are unusable. Rhosyn case 15 B
  retrieves the 14-day note rather than A's future 3-day note, yet its definite
  as-of inference is still unsupported under the same frozen contract. A future
  typed/conditional temporal policy cannot retroactively regrade this result.

## Accounting, latency and storage

All 24 captures and 48 outcomes reconciled: 54 capture batches, 77 memories,
227 logical model starts and 454 physical count/generation requests. Logical
phases were extract 54, classify 54, SELECT 24, RANK 47 and answer 48. There was no
new unknown or pending outcome. Private attribution reconciles 454 unique
attempt IDs across 24 shared and 48 arm rows; public per-case resources retain
the same totals without operational IDs. No historical prefix was rewritten.

| Attribution | Physical requests | Conservative reservation | Known generation estimate | Known generation input / output tokens |
| --- | ---: | ---: | ---: | ---: |
| Shared capture | 216 | US$1.080000 | US$0.033916 | 64,954 / 4,933 |
| A recall + answer | 142 | US$0.710000 | US$0.022146 | 41,687 / 3,401 |
| B recall + answer | 96 | US$0.480000 | US$0.015181 | 30,748 / 1,788 |
| Total | 454 | US$2.270000 | US$0.071243 | 137,389 / 10,122 |

Count-route billing remains unknown and conservatively reserved; neither the
reservation nor generation usage/rate estimate is an invoice. Cumulative
reservation is US$349.272281 / 60,987 requests, with 23 historical unknowns,
zero new unknowns and zero pending. US$20.727719 remains outside the protected
US$30 under the unchanged US$400 cap. No affordability permission follows.

| Wall-time observation (24 each; seconds) | Median | Maximum |
| --- | ---: | ---: |
| Whole case | 67.044 | 81.946 |
| Shared capture | 29.830 | 44.326 |
| A recall | 14.573 | 15.716 |
| B recall | 7.244 | 7.567 |
| A whole arm | 21.754 | 23.047 |
| B whole arm | 14.440 | 15.457 |
| A post-recall packing + answer | 7.178 | 7.565 |
| B post-recall packing + answer | 7.193 | 7.915 |
| A answer HTTP count + generation only | 2.337 | 2.726 |
| B answer HTTP count + generation only | 2.354 | 3.086 |

Total observed run wall time was 1,690.653 seconds (about 28.18 minutes).
These are private diagnostic wall times including accounting/integrity-record
overhead, not production latency or pure model-compute time. Packing + answer
is a measured bundle, not isolated answer latency. No overhead subtraction is
invented. Full n/min/median/p95/max/sums are in the packet. Owned SQLite after
close/before cleanup was 561,152 bytes per case, 13,467,648 bytes total across 24;
owned cleanup was verified. Production storage, host memory and realistic
long-history/resource fit remain unavailable, not zero.

The original latest-start 02:00Z / hard-stop 03:15Z window expired with no model
outputs, operational manifest, claim, report, original-ledger preflight or key
lookup. Explicit owner continuation at 06:50Z prospectively changed only the
window/provenance to latest-start 08:00Z / hard-stop 09:15Z. Archived old bindings
and reviews remain historical; this was not a paid retry or ledger reset, and
the gap was not continuous compute. The revised manifest froze 07:06:40.284Z;
closure audit was 07:35:55.425Z. Scheduling-v2 offline controls passed 47/47 with
actual exit 0 on Node 22.16.0 and 24.15.0; intentional shared-recall mutants failed
with the expected exit 1 on both. This is separate from semantic acceptance.

## Provenance, delivery and next checkpoint

The public packet includes the exact private report/source/rubric/manifest,
operator/test/launcher/evidence, runtime tracked/dependency inventory, judge,
freeze, mapping, primary-decision and resource-audit SHA256 bindings.

Safe label/hash bindings for the completed pre-live window-v2 Standards/Spec
operator reviews are also retained. They are not the still-required final
public-delivery reviews and do not substitute for exact-candidate acceptance.

| Artifact | SHA256 |
| --- | --- |
| Closed report | `293552afca8a2a060b22eea8d6203b153273debccfddbeb487078b73c8ff1a7d` |
| Authored sources | `2507b96d8966ae328ea63ed3e8b191ce6526f44b50cb7a3e16dd8440b1fe4eb1` |
| Held rubric | `e69dfb7732375559254a43b04e90735ec0e04912c250ef50c358e0b98b0ec8c3` |
| Revised manifest | `b4594223c9356e9d9e4e7456a4671530c6314b18390ead3b838afde74f792119` |
| Primary adjudication | `81b9ca6deff0c8bfb69ee746566634bb59ee9de5b64f989ecd602130f1d226c4` |
| Primary decisions | `3a7ae727369bf2ae0ada6bc63e76b9538191dc56846d8c83fde6bb1c4b685eb0` |
| Resource cross-check | `9870ef13603793f7c2acd9efb0c4bdc2eaf4afa869a4d27fe95643a1b71c45e8` |

Projection is by a deliberate field allowlist, not replacement of evidence
strings. Public omission covers local absolute paths/private execution-root
names, original ledger/attempt IDs, provider response IDs and personal
configuration/credential fields. The authoritative private record is retained
separately. Original synthetic source IDs are not operational ledger IDs.

This five-path documentation delivery changes no runtime/default, evaluator,
README, test or historical result. Exact-candidate nonauthor Standards/Spec
reviews, primary evidence acceptance and latest-head CI are separate mandatory
delivery gates; a local documentation pass does not claim them completed.

Local delivery checks used a clean allowlisted environment and invocation-owned
test/config cleanup with pinned Node binaries. Actual completed results:

| Gate | Node 22.16.0 actual exit | Node 24.15.0 actual exit |
| --- | ---: | ---: |
| `npm test` (673 passed, zero failed each) | 0 | 0 |
| `npm run validate` | 0 | 0 |
| Pinned Claude 2.1.260 marketplace + strict plugin validation | 0 | 0 |
| Public projection/math/hash/privacy/link verification | 0 | 0 |

Full test durations were 339,018.234 ms and 341,817.633 ms respectively; these are
delivery checks, not model-run latency. The initial plugin check exited 1 on
both Nodes because an offline locked install skipped its native-binary setup.
The inspected pinned local installer then completed with exit 0 using the
already installed optional binary, without network; both repeated validations
exited 0 and isolated config cleanup was verified. No runtime fix was involved.
Git and an independent filesystem/base-blob comparison agreed on exactly five
changed paths, with zero difference. Source/answer/judgment value fidelity,
paired/family/claim/stage arithmetic, private attempt attribution and SHA256 via
Node crypto plus sha256sum were checked. All added local/exact-commit links
resolved; explicit citation index references were checked without regrading
their prose. Historical append targets retain their original byte-prefixes;
ROADMAP has additions only. `git diff --check` exited 0.

The next checkpoint is offline inspection/reuse of existing source-bound
relation/assembly mechanisms plus an explicit typed-time semantic contract.
Existing [rationale/basis APIs](https://github.com/Cairn-ink/cairn-memory/blob/287d22625faaa50b056c83cc5745be16d01171bf/core/contract.mjs#L839)
and [rationale-evidence fetch](https://github.com/Cairn-ink/cairn-memory/blob/287d22625faaa50b056c83cc5745be16d01171bf/core/runtime.mjs#L451)
are reusable optional hooks, not mechanisms exercised by this source-evidence
T5 profile or an already implemented general Card materializer.
“Group sources together” is not an untried architecture: the earlier
[canonical receipt-group QA24](https://github.com/Cairn-ink/cairn-memory/blob/01965c34dc2262de94b5de18505dedc9187df74a/docs/plans/receipt-group-canonical-comparison-results.md)
went 21→19 and was rejected. No third tuned bundle or sweeping new architecture
is implemented or promised here. A prospective offline red/green checkpoint
would preserve entity bridges/qualifiers through actual rank and answer input,
distinguish utterance/event/effective/query time, and test abstention and
untrusted-label negatives before any separately authorized semantic comparison.
Fresh paired quality, independent reliability, installed Hermes new-session
use and measured lightweight resource fit remain independent future gates.
This cohort establishes neither native-comparator transfer, official benchmark
or competitor parity, complete raw/memory/governed-card/MOC/relation/vector
architecture, natural Hermes use, long-history success nor default readiness.
