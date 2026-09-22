# Case-deadline pilot: retained evidence contract

This document is the acceptance source for a documentation-only result packet.
Documentation base: `83a10c3b7664b1f67485a19e7d84d24dcb3041a5` (origin/main).
The separately tested, unmerged evaluation candidate is
`d3d08becbde6077a3736e0c415b11925f4aedd01` ([PR197](https://github.com/Cairn-ink/cairn-memory/pull/197)),
with the prerequisite guard in [PR196](https://github.com/Cairn-ink/cairn-memory/pull/196).
Documenting a candidate does not mean its implementation has merged or shipped.

## Acceptance

- **E1 — Retain the prospective protocol.** Record exact tested commit, models,
  answer-v2 and case-deadline-v1 identities, upstream scoring revision, six-case
  fixed roster selection and frozen exclusion rule, all-generation-then-scoring
  order, shared cumulative cap, no retry/resume/replacement, and unchanged prompt,
  rubric and deadline settings. Previously halted runs and all their frozen
  slots remain excluded; do not relabel old results with the new policy.
- **E2 — Report genuine outcomes.** Wait for the sole live invocation to end and
  primary plus independent read-only reconciliation before inserting results.
  Distinguish a completed generation wrapper from completed arms and correct
  judgments. Report fixed N=6, all-three-resolved paired N, each arm's resolved,
  correct and unresolved counts, genuine timeout/blocked/failure counts, and null
  rather than zero when no score exists. Preserve partial judgments. Include a
  concise per-type outcome table, not source question or answer text.
- **E3 — Reconcile costs.** Match every new attempt to the existing ledger and
  private generation/scoring accounting; preserve the historical prefix. Report
  request counts, conservative reservations, known actual usage and unknown
  billing separately, with before/after/remaining totals. Do not call reservations
  invoices, unknown costs free, or unused allowance a refund.
- **E4 — State what this establishes.** Six prospectively selected public cases
  are an engineering pilot, not a representative 500-case LongMemEval score,
  independent blind holdout, competitor comparison or production guarantee.
  No abstention case was selected. No-memory receives empty evidence under the
  same insufficient-information instruction, not an unrestricted zero-shot
  baseline or unconditional abstention instruction. State source-evidence/receipt-prefix/recall limits,
  legacy capture path, and that this does not verify installed Hermes behavior.
  If no real timeout occurs, synthetic timeout-isolation evidence remains the
  only test of continuation after timeout; do not invent a live occurrence.
- **E5 — Keep public evidence safe and versioned.** Publish aggregate metadata,
  per-type statuses, methodology and hashes only. No keys, credential/ledger
  paths, source/history/question/reference/answer text, raw response/prompt,
  full sidecar, raw database or ledger dumps. Keep prior v1 and halted-v2 results
  separate and link their pinned commit records when needed. Do not claim a
  causal improvement from different rosters or combined code changes.
- **E6 — Place claims correctly.** Append a concise linked candidate-result note
  to docs/limitations.md. Update ROADMAP.md only to distinguish completion of this
  small measurement from still-open broad benchmark/reliability/host gates. Do not
  edit README, release versions, product claims, previous results or runtime code.
- **E7 — Verify and deliver.** Primary inspects the complete diff and checks all
  numbers/hashes against audited private evidence. Run generic tests, JSON and
  strict plugin validations, privacy and relative-link checks on both Node22.16
  and24.15. No TypeScript gate exists. Freeze a scoped local commit; separate
  Standards and Spec reviewers inspect the same fixed base/candidate. Address
  findings, then push a focused PR against main and monitor every applicable CI
  check on its exact head until successful. No merge, release, deployment or
  further paid run is part of this documentation packet.

## Ownership

Primary owns the contract, live execution, final evidence audit, acceptance and
delivery. The bounded documentation worker is the existing Sol/high worker:
accounting, denominators, unmerged-candidate provenance and failure reporting make
this a data-trust packet rather than ordinary copy editing. Independent Standards
and Spec agents are separate Sol/high reviewers that did not write this packet.
Do not infer model costs from model labels; telemetry is unavailable.

## Frozen methodology and provenance

The sole invocation tests the unmerged candidate above on Node 22.16 with the
reviewed public-pilot CLI, native one-attempt `fetch`, and no replacement
transport, retry layer or proxy. It uses answer template
`cairn-longmemeval-public-answer-v2`, memory and answer model
`gpt-4.1-mini-2025-04-14`, judge model `gpt-4o-2024-08-06`, and official scorer
revision `9e0b455f4ef0e2ab8f2e582289761153549043fc`. Prompt and rubric bytes, model
parameters and bounds were frozen before outcomes. The core model-call deadline
remains 30 seconds across its count and generation work, separate from the
60-second core transport guard. Answer and judge transport guards remain 180
and 60 seconds respectively; the comparison and scorer retain their separate
200-second answer and 90-second judge cutoffs.

The public LongMemEval-S cleaned input is pinned at declared revision
`98d7416c24c778c2fee6e6f3006e7a073259d48f` and SHA-256
`d6f21ea9d60a0d56f34a05b609c79c88a451d2ae03597821ea3d5a9678c3a442`.
Selection policy SHA-256 is
`8ccdeca78b60e1237d3e6a56c22cc6efe1dbc24fb9cf84f4d69c6274221f3ad9`;
the resulting metadata-only selection is
`d9ae3537a840a3658c425805ffb3d376f63dd6df6d666b0c5994379c3df4b109`,
and prepared-manifest SHA-256 is
`624af363626c251190dfd47f05640292d38d35303ee152ef1b86bbd7f3474be0`.
The private Python-rendered reference sidecar is represented publicly only by
SHA-256 `c98ffe581170f51beb564e1a944f39029db52f1c50b36fb6cb6bfcf4f29ece24`.

Before inspecting candidate contents or outcomes, the selector excluded all 34
slots used by earlier pilots, including the unexecuted final slot of the halted
answer-v2 run. It then chose one metadata-only salted candidate from each of the
six official base types. All six fit the prospectively defined longest affordable
priority prefix; none is an abstention case. Execution follows prepared source
order, not selection priority or observed cost:

| Order | Base type | Planned ingestion batches | Projected requests | Reserved micro-USD |
| ---: | --- | ---: | ---: | ---: |
| 1 | single-session-user | 53 | 224 | 1,273,660 |
| 2 | single-session-preference | 45 | 192 | 1,113,660 |
| 3 | multi-session | 44 | 188 | 1,093,660 |
| 4 | temporal-reasoning | 47 | 200 | 1,153,660 |
| 5 | knowledge-update | 42 | 180 | 1,053,660 |
| 6 | single-session-assistant | 56 | 236 | 1,333,660 |

All six generation scopes run in that order before all six scoring scopes. The
one-shot `case-deadline-v1` capability is bound to authorization
`case-auth-20260922-kphbZl`, execution `case-run-20260922-kphbZl`, the exact
schedule and the existing ledger prefix. A guard-recognized timeout may end one
case and permit the next preselected scope in the same process. Every other
unknown accounting, persistence or safety outcome remains globally fatal. No
case, stopped run or capability can be resumed, retried, replaced or refunded.

The unchanged cumulative ceiling is US$50 and 5,000 requests. At the frozen
pre-run checkpoint, all 3,631 earlier attempts were settled, with US$34.554080
conservatively reserved and three attempts retaining an `unknown` outcome. That
outcome count is distinct from requests whose billing remains unknown. The
six-case worst-case projection is 1,220 requests and US$7.021960 reserved; the batch
admission caps use the then-remaining 1,369 requests and US$15.445920 rather
than a new allowance. Reservations are conservative bounds, not invoices;
known token-priced usage and unknown billing are reported separately.

The Cairn arm uses the pilot's legacy public-core capture path and bounded
source receipts, including an 800-UTF-16-unit receipt prefix and recall limit 6.
This does not test opt-in submitted-capture variants or installed Hermes behavior.
The full-history arm receives the prepared history under the same answer model;
the no-memory arm receives empty evidence under the same instruction to say it
does not know when the available information is insufficient. It is not an
unrestricted zero-shot baseline or an unconditional abstention instruction.

## Execution evidence

The sole invocation completed without a global halt at
2026-09-22 07:02:20 UTC after 2,052,416ms (about 34.2 minutes). All six outer
generation wrappers and all six scoring wrappers completed. That mechanical
status does **not** mean all 18 arm answers existed: the Cairn arm was blocked
before answering the temporal-reasoning case because generation reported
`unknown_or_mismatched_receipt`. The run therefore made 17 answer calls and 17
judge calls. It recorded no generation or scoring case timeout, no partial
timeout score and no blocked outer case. The fixed denominator remains N=6.

### Official-style machine judgments

These are the pinned scorer's machine judgments, not independent human review
or a leaderboard result. “Accuracy” below is calculated only over resolved
judgments; coverage keeps the fixed denominator visible.

| Arm | Fixed N | Resolved | Correct | Incorrect | Unresolved | Coverage | Resolved-only accuracy |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cairn | 6 | 5 | 3 | 2 | 1 | 83.3% | 60.0% |
| Full history | 6 | 6 | 4 | 2 | 0 | 100% | 66.7% |
| No memory | 6 | 6 | 0 | 6 | 0 | 100% | 0% |

Cairn's unresolved-outcome fixed-N bounds are 50.0% to 66.7%; they are not a
statistical confidence interval or population estimate. The other two arms have
no unresolved interval. The all-three-resolved paired subset is common N=5:
Cairn 3/5 (60%), full history 4/5 (80%), and no memory 0/5 (0%). The temporal-
reasoning type has common N=0 and therefore null paired accuracy, not 0%.

| Execution order | Base type | Generation / scoring wrapper | Cairn judgment | Full-history judgment | No-memory judgment |
| ---: | --- | --- | --- | --- | --- |
| 1 | single-session-user | completed / completed | correct | correct | incorrect |
| 2 | single-session-preference | completed / completed | incorrect | correct | incorrect |
| 3 | multi-session | completed / completed | incorrect | incorrect | incorrect |
| 4 | temporal-reasoning | completed / completed | unresolved: generation blocked (`unknown_or_mismatched_receipt`) | incorrect | incorrect |
| 5 | knowledge-update | completed / completed | correct | correct | incorrect |
| 6 | single-session-assistant | completed / completed | correct | correct | incorrect |

Reference-session coverage is diagnostic, not answer correctness, fact coverage,
overall retrieval precision or a root-cause proof. For example, the preference
case reported Cairn retrieved/packed reference-session coverage 1/1
but was judged incorrect. On the multi-session case, Cairn reported 0/2 while
full history reported 2/2, yet both answers were judged incorrect. Likewise,
287 `completed/applied` capture observations describe operation status, not 287
unique correct memories or semantic truth. No post-outcome tuning or replacement
case was run.

### Reconciled accounting

The read-only post-run audit matched every one of the 1,218 new ledger rows to
exactly one generation or scoring accounting record, including stage, channel,
reservation, outcome and known actual usage. Its scope chain was continuous;
all new rows settled with `succeeded`, no new row had an `unknown` outcome, and
zero rows were unsettled. The 592 count requests have unknown billing and are
not treated as free.

| Stage | Requests | Conservative reservation | Known actual usage | Billing unknown |
| --- | ---: | ---: | ---: | ---: |
| Cairn count | 592 | US$2.960000 | US$0 | 592 |
| Cairn generation | 592 | US$2.960000 | US$0.905334 | 0 |
| Answer | 17 | US$0.863940 | US$0.271406 | 0 |
| Judge | 17 | US$0.176800 | US$0.007110 | 0 |
| **This run** | **1,218** | **US$6.960740** | **US$1.183850** | **592** |

| Ledger checkpoint | Requests used | Conservatively reserved | Requests remaining | Reservation remaining |
| --- | ---: | ---: | ---: | ---: |
| Before | 3,631 | US$34.554080 | 1,369 | US$15.445920 |
| After | 4,849 | US$41.514820 | 151 | US$8.485180 |

The three historical `unknown` outcomes remain in the unchanged prefix. The
remaining allowance is not a refund, a new authorization or evidence of a
provider invoice. Reservations bound the experiment conservatively; known
usage is token-priced metadata and count-call billing remains unknown.

### Retained audit and historical separation

- Post-run audit record SHA-256:
  `26c4bd585ef63a027637cc8b2cd8e690ba80a21482efd1fd5f37138c37f40e44`.
- Report SHA-256:
  `c71338f188448a01b61d1831e5374563aca0570394889d8a1bc6960b0640f7f4`;
  aggregate SHA-256:
  `1b6c9fafacae3c518961a76f2c4c42f84dbd4ed3ecf8f2403d507c06b7194b44`.
- Checkpoint SHA-256:
  `1e0f2812dcc64a729d4c0a6ea3eeacb2ef83233b43685278647fd89b9164cb5b`;
  manifest SHA-256:
  `a3add5ae1c239a8e0303dcf0abc0c8d71b2c09170096605d271aab111434de7a`;
  52-file tree SHA-256:
  `393b35a27bc68b7598f633e3ca846cfe01b801ede15873c414158f77578d91bf`.

The audit also rechecked the frozen [answer-v1 result](https://github.com/Cairn-ink/cairn-memory/blob/2e5418a48f5173547077ee8ad009c6c5d0e026c9/docs/public-pilot-results.md)
and [globally halted answer-v2 result](https://github.com/Cairn-ink/cairn-memory/blob/e1dc7a2d20ee896707431d60d444bcc743a41555/docs/plans/public-pilot-v2-halted-results.md)
without changing or pooling them. Their retained report hashes remain
`6dd0f102f6032756f0bd97be3b2c9ea212217d174e8a145d391d46e629fe3b5b`
and `5f000bb083b940fe20508e9603c4880b8b6ae35681b67b6ebf2144996595fc16`
respectively.

No live timeout occurred, so this run did not exercise continuation after a
timeout. That behavior remains supported only by the candidate's offline
synthetic core→adapter→guard→runner tests. The result establishes that the fixed
six-case one-shot execution and its accounting completed on the tested unmerged
candidate. It does not establish timeout reliability in live traffic, general
LongMemEval quality, a causal advantage over earlier code, installed-host
behavior, release readiness or a published product capability.
