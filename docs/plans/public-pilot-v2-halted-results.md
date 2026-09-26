# Public pilot v2 — halted before scoring

Status: retained halted-run record. This is not an accuracy result, a
population estimate, a competitiveness claim, a representative score, or a
release/production claim. It makes no installed-real-host or Hermes-quality
claim.

The prospectively frozen roster contained seven slots: a first-six packet and a
conditional seventh slot. The run stopped in the first packet, so the seventh
slot was not executed. The fixed six and the frozen seventh declaration are
retained; no merged fixed-seven result is reported and no outcome is rewritten.

## Exact identity and outcome

The run used the explicit answer identity
`cairn-longmemeval-public-answer-v2` under pilot schema
`cairn-longmemeval-public-pilot-v1`, tested at commit
`2bebfa93c38d659ab6edb394b95cb31abc801d87`. The answer model was
`gpt-4.1-mini-2025-04-14`; the judge model was `gpt-4o-2024-08-06`. The
source-aware candidate and the answer-boundary change were present together;
this is not a single-variable ablation. The redacted run was recorded at
`2026-09-21T20:00:50.816Z` UTC (2026-09-22 in Taipei).

The redacted run summary is `fixedN=6`, `generated=1`,
`generationBlocked=5`, `scored=0`, `halted=true`, and `commonN=0`. The one
generated value is a wrapper checkpoint, not a successful Cairn answer. Every
arm's accuracy is `null`, not zero percent. The legacy capture path was used;
this was not staged or qualified capture.

The old v1 record remains separate. It reports Cairn 1/4, full-history 1/4 and
no-memory 0/4 on paired `N=4` from fixed `N=5`; those versions and rosters must
not be combined. See the [v1 record at its pinned PR190
commit](https://github.com/Cairn-ink/cairn-memory/blob/2e5418a48f5173547077ee8ad009c6c5d0e026c9/docs/public-pilot-results.md).

## Halted packet

For the one started case, batches 0–4 completed, batch 5 extraction failed,
and batches 6–50 were not run. The Cairn arm reports
`ingestion_incomplete` inside the one completed generation wrapper. The
full-history and no-memory arms report
`answer_failed` because the halt guard prevented their answer work; no answer
or judge request was made. Five following cases were blocked during
generation, and all six cases were blocked during scoring.

The safe diagnostic record observed `core_call/model_timeout` and
`adapter/model_cancelled`. The last successful count was 995 input tokens,
below the configured 7,024-token limit. One generation outcome was unknown
with a known recorded elapsed measurement of 29,361 ms. These observations do not establish a provider,
network, HTTP, model-quality or other root cause, and this record does not
claim a fix. Any later offline diagnosis remains separate from this retained
live evidence. Admission reference counts are not unique-memory counts,
extracted unique-unit counts, semantic source coverage or verified truth.

## Audited accounting

The primary audit reconciled 22 unique requests: 11 count requests and 11
generation requests. All 11 count requests succeeded; generation had 10
succeeded and one unknown outcome. No answer or judge request was made.

| Channel | Requests | Outcomes | Reserved (micro-USD) | Known actual (micro-USD) | Unknown billing |
| --- | ---: | --- | ---: | ---: | ---: |
| Cairn count | 11 | 11 succeeded | 55,000 | 0 (not priced) | 11 |
| Cairn generation | 11 | 10 succeeded, 1 unknown | 55,000 | 12,037 | 1 |
| **Total** | **22** | **11 count; 10 + 1 generation** | **110,000** | **12,037** | **12** |

The count calls returned no known usage price; `0` is not a claim that they
were free. The 12,037 micro-USD known actual is incomplete billing, not an
invoice. The audited ledger checkpoints were 34,444,080 micro-USD / 3,609 requests before
the packet and 34,554,080 / 3,631 after it, leaving 15,445,920 / 1,369 and
zero unsettled attempts. Two historical unknown attempts remain charged. No
refund, reset or continuation is authorized by this record.

## Public-safe evidence pins

Only redacted metadata, methodology, hashes and limitations are published.
The primary audit passed its exact-ID/outcome/reservation reconciliation,
confirmed no additional or unaccounted attempts beyond the 22 reconciled
requests, confirmed no unsettled rows, confirmed the
seventh and merge outputs were absent, and verified that the retained v1
hashes were unchanged. Keys, source question/history/reference text,
answer-request bodies, credential paths, live-ledger dumps and provider
responses are not published; private source and evaluator material remains
private.

| Artifact | SHA-256 |
| --- | --- |
| Freeze record | `65c4695c9ac35ed7e9f244e71da2859b8541b2bb41d45f394e3ca6ace833bc46` |
| Launcher | `b6a265f0e745a1bd1075ecbb0acd48ea294fc0008f4424f835afd7e01124ad3f` |
| Redacted report | `5f000bb083b940fe20508e9603c4880b8b6ae35681b67b6ebf2144996595fc16` |
| Aggregate | `898073a96c0db45eba84530b4b8a77dba0d81cba9eef639ead75d6d364eee8f4` |
| Accounting | `333c15acbaa8eb2d523593ba9e421df20dbd3845c9bd02c4911f87202e90d08b` |
| Diagnostics | `31f8088b7056848b1d09dfb39c254bd7d59a9497ab3019c840ce5b0f9f9296b9` |

## Offline diagnosis supplement

The offline diagnosis observed fail-closed safety mechanics, not a live-run
correctness defect or provider cause; it does not invent a before-fix RED,
change a timeout as a claimed remedy, or alter the retained live result.
Sol/high owns exactly one new file, `evaluation/live/test/capture-timeout-boundary.test.mjs`;
this section records the offline finding.

The core applies one 30,000 ms deadline to each model call, spanning that
call's provider count and generation. Extraction and classification are
separate calls. The benchmark guard has a separate 60,000 ms transport
deadline. Retained live accounting records 30,013 ms from the final count's
start to generation settlement: 637 ms count, a 15 ms gap and 29,361 ms
generation. This is consistent with the core deadline; it does not identify
the underlying service or network cause.

The separate synthetic regression reproduced the mechanics: a
1,000 ms count plus 28,000 ms generation succeeds; a sixth 1,000 ms count plus
29,000 ms generation aborts after five admissions, with 21 successful and one
unknown attempt. It preserves the expected ledger accounting after halt, makes
no 23rd call or reservation, and a late provider reply cannot change
settlement or admit memory; it is safety-mechanics evidence, not a semantic-quality or provider/network-cause claim.

Primary verification is complete on both Node 22.16 and 24.15: focused 1/1;
live-offline 276 pass plus 30 intentional skips (306 total); generic 106/106;
JSON/plugin validation and document link checks pass. Independent Standards and
Spec review remains pending at the candidate commit and will be recorded in the
PR.

## Acceptance, ownership and next gate

This document traces the delivery contract as follows:

- **R1–R2:** preserve the seven-slot/fixed-six packet and report the wrapper
  versus actual ingestion, blocked stages and zero answer/judge requests above.
- **R3:** publish only the observed diagnostic core/adapter labels, 995 count,
  and the one unknown generation outcome with its recorded 29,361 ms elapsed
  measurement; make no cause or fix claim.
- **R4:** publish the exact 22-request accounting and checkpoint balances;
  retain unknown billing and do not refund or reset.
- **R5:** pin the exact v2 identity and tested commit, keep v1 separate, and
  state that the combined candidate is not an ablation.
- **R6:** publish only safe metadata and hashes, link this record from
  [`docs/limitations.md`](../limitations.md), and leave the README untouched.
- **R7:** primary gates pass on Node 22.16 and 24.15: focused 1/1,
  live-offline 276 pass plus 30 intentional skips (306 total), generic 106/106,
  JSON/plugin validation and document links. Standards and Spec review remains
  pending at the candidate commit and will be recorded in the PR. No score is
  promised until a separately frozen future run is legitimately complete.

Implementation ownership is the bounded documentation worker, requested and
actual selection Luna max (`gpt-5.6-luna`, max); no worker model-token or cost
telemetry is available. The primary owns acceptance, accounting verification,
gates, independent review and delivery. Sol/high owns the offline regression;
its focused and dual-runtime evidence is complete above. This packet makes no
provider call and does not authorize a merge, release or deployment.

The next gate is a new prospectively frozen policy/protocol, independent review
and separate authorization. This is prospective protocol work, not a
retrospective fix claim. Under the current halt, do not start a new paid run,
automatic retry or new session, and do not present an increased timeout as a
proven remedy.
