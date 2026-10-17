# Source-selection feasibility: closed first-only result

The two-session feasibility completed mechanically and failed its prospective
semantic gate. It does **not** advance to the proposed 24-question comparison.
The English candidate's first answer reused an old conditional plan after the
canopy had already failed. Preserve that failure; do not tune or retry this
closed cohort. No default, core engine, vector index or product-quality claim
changes.

## Frozen scope and decision

The [implementation plan](source-selection-memory.md) and the separately frozen
operator contract preceded execution. Runtime commit:
`d549f0681d2949731254d0945acaef09155ebad4`; implementation base:
`ad274b6117f86446fbf0ff16f503ae69d0278ce5`. Two independently authored synthetic
sessions, one English and one Traditional Chinese, each supplied two chronological
capture batches and one later question. Both arms used the pinned experimental
model `gpt-4.1-mini-2025-04-14`, ordinary filing, cold source-evidence recall and
the same source-only answering policy. Candidate replaced extraction with bounded
source selection and copied previews; it did not replace classification or recall.

All **4/4 scheduled arms completed**, with **0 failed and 0 not-run**. Each
completed two captures, two classifications, one select, one rank and one first
answer; no outcome or question is excluded. Both candidate sessions had applied
filing. Source/revision and closure checks passed. These are operational outcomes,
separate from semantic failures. No hypothetical unused failure category is
added to the observed denominator.

Two independent nonauthor AI reviewers received explicit arm labels masked.
Their first ratings agreed on all **8 minimal-claim statuses** and all **4
full-answer support flags** before the mapping was revealed; material disagreement
count was zero, so no editorial rescore or adjudication changed their ratings.
Copied previews can disclose the mechanism. Explicit label masking therefore
does not establish reviewer blindness or human calibration.

| Distinct observed metric | Baseline | Candidate |
| --- | ---: | ---: |
| Answers satisfying both minimal required claims | 1/2 | 1/2 |
| Answers satisfying both minimal claims **and** fully supported overall | 0/2 | 1/2 |
| Supported minimal claims | 3/4 | 2/4 |

These metrics answer different questions. Minimal completeness alone can hide
an additional unsupported assertion; overall support alone can hide an incomplete
answer. None is an accuracy headline, population estimate, evidence of parity,
or a pass of the unchanged net-gain >=3/24 stage-2 gate.

| Public row | Minimal-claim statuses (both reviewers) | Both minimal claims supported | Full answer supported |
| --- | --- | --- | --- |
| session-01 baseline | partial; supported | false | true |
| session-01 candidate | partial; partial | false | false |
| session-02 candidate | supported; supported | true | true |
| session-02 baseline | supported; supported | true | false |

Thus mechanical pass is **true**, semantic pass is **false**, and advance to the
24-question study is **false**. Original sources, rubric, four first answers,
stored previews and both rating texts remain unchanged.

## Where the observed failure occurs

In session-01 the candidate stored the original courtyard/reading-room rule in
`memory-1` and the later failed-canopy and pending-key evidence in `memory-2`.
The latest evidence was retained, including room availability without confirmed
side-door access. Both memory references were visible in the actual select
request. The latest reference's visible label included
`Nola's key test is still unconfirmed; she hasn't sent a result`.

Select returned only `memory-1`. Rank received only that memory's old receipts,
returned it, and answering received only batch-1 windows 1–4. All batch-2 windows
were not recalled. Answer packing omitted **zero** recalled windows. The failed
answer treated the already failed canopy check as a future unknown and left
the courtyard branch live. This locates an observable omission before rank;
it does not establish why the model selected the old memory or that label
truncation caused the choice. Stored evidence, navigation visibility, selected
evidence, rank input, returned evidence and packed evidence are separate stages.

The session-01 baseline returned the room-availability/access-pending evidence
but omitted the complete fallback/postponement chain, so only one minimal claim
was supported. Both reviewers nevertheless judged its actual answer fully
supported: missing a required proposition and asserting a false proposition are
distinct failures.

In session-02 the candidate preserved the original wired-lavalier choice/reason
and the still unconfirmed USB-C adapter recording test. Both minimal claims and
the full first answer were judged supported. The baseline also satisfied both
minimal claims but added `已經帶了轉接線`, an unsupported completed-action assertion;
both reviewers marked the full answer unsupported. These are the fixed ratings,
not a new assessment by this publication's author.

Exact source copying does not prove semantic truth, currentness or sufficient
selection. The candidate omitted the cafe rejection and unadopted tent proposal
in session-01 and other unselected sources; its answer did not adopt either
alternative, but unanswered rejection information can still be absent. Full
attached receipts only preserve windows that were selected at capture.

## Resource accounting

The closed operation used **56 physical HTTP requests: 28 count and 28
generation**, lasting **240,705.54312 ms**. Reservation was **280,000 microUSD
(US$0.280000)** at 5,000 microUSD per physical request. Generation usage totalled
**35,535 input / 3,409 output tokens**. The generation-only usage/rate estimate
was **19,681 microUSD (US$0.019681)**, summing each request's separately rounded
estimate at US$0.40/M input and US$1.60/M output tokens.

Actual invoice and count-route billing are **unknown**. Count reservations remain
retained; reservation is not actual cost, and the generation-only estimate does
not price the whole operation. The original cumulative ceiling remains
**400,000,000 microUSD (US$400)** with **30,000,000 microUSD (US$30)** protected.
Cumulative reserved value moved from **340,602,281** to **340,882,281 microUSD**.
New pending and new unknown accounting entries after closure were both zero;
that does not make historical unknown billing known. No reservation reset,
refund, additional grant or new provider request is part of this result delivery.

## Public evidence and integrity

The [frozen public projection](../../evaluation/architecture/results/source-selection-feasibility-v1.json)
contains all synthetic sources and the separate frozen rubric; all four exact
first answers; all 23 final stored memory previews with exact receipt bindings;
capture/classification revisions; select-visible maps and returned refs; rank
inputs and returned refs; recalled receipts; and packed, packing-omitted and
not-recalled window sets. It preserves both independent judgments, including
claim status/support flags, quotes, reasons, extra issues and memory observations.
Per-request summaries permit independent integer cost arithmetic without raw
HTTP payloads or provider identifiers.

Session aliases follow authored session order; view aliases follow frozen mapping
order. Within each row, memory ordinals follow the final stored list, receipts
follow their first occurrence in that list, and group ordinals follow placements.
Source positions remain zero-based in original quote/binding fields; human source
aliases `batch-1/window-1` are one-based. Text is copied without normalization or
paraphrase. The projection excludes local paths, persistence UUIDs, operational
accounting identifiers, credentials and raw provider logs. It includes SHA-256
provenance for the original manifest, contract, sources, rubric, decision, masked
packet, mapping, ratings and all 186 closed local records. Original hashes bind
unchanged private bytes; sanitized projections have different bytes.

Key original SHA-256s:

- Closed report: `0415c657678628af76deee71e0450b0b7d9929085d3e401f5b3cd84e32719fd1`.
- Rating A: `cb6707f542ad4903bd7dc19c675fd9346e289139938a4fcde2107545ac6d4a97`.
- Rating B: `4b39f1fd54b3a066fe5b5287f2fe03b981575e81b7cb9b9b6568cf31e56e9f42`.
- This public projection: `0df5671e1129cfa0efe20ee52867c613d0ab6bd72d2e622e0d3f350e1e751eb6`.

The [offline integrity test](../../evaluation/architecture/test/source-selection-feasibility-result.test.mjs)
checks the frozen projection hash, complete denominator, stage links, exact source
and answer hashes, quote locations, receipt identity, blind-rating agreement,
distinct metric derivation and per-generation integer arithmetic. Adversarial
mutations remove a row or alter a source, answer, receipt, claim, support flag,
selection, packing, denominator or cost and must reject independently of the
whole-file hash check. This checks publication integrity, not semantic correctness
anew. It uses no provider, credential, operational ledger or mutable external file.

Separately from the public test, a read-only worker comparison against the closed
artifacts verified exact content for **24 source messages, 4 rubric claims, 4
first answers, 23 stored previews and 8 complete rating views** after identifier
aliasing, plus all **186 original record hashes**, actual exit **0**. This
comparison did not rewrite any closed artifact. Primary independently inspects
the underlying evidence before accepting the publication.

Focused worker verification used each pinned runtime's `node` executable:

| Runtime | Command | Actual exit | Result |
| --- | --- | ---: | --- |
| Node 22.16.0 | `node tools/testing/run.mjs evaluation/architecture/test/source-selection-feasibility-result.test.mjs` | 0 | 4/4, no skips/failures |
| Node 24.15.0 | `node tools/testing/run.mjs evaluation/architecture/test/source-selection-feasibility-result.test.mjs` | 0 | 4/4, no skips/failures |

The worker independently cross-checked delivery scope by (1) Git changed names
against the fixed delivery base plus `git ls-files --others --exclude-standard`,
and (2) filesystem traversal with current Git blob hashes compared to
`git ls-tree -r d549f0681d2949731254d0945acaef09155ebad4`. The lists match:
**5 changed/new paths across 1,638 inspected files, actual exit 0**. The two
existing documents are append-only; the other three files are new. A separate
`git diff --check` plus a trailing-whitespace check of all five current files
exited **0**.

The primary subsequently inspected the actual changes and independently compared
the public projection with the closed original bytes: **24 messages, 23 previews,
53 source bindings, 8 select/rank input-output pairs, 4 first answers, 8 complete
rating views, 186 record hashes and 56 request-cost rows matched, exit 0**.
This comparison checks exact ordinal aliasing, not just the published file hash.
Primary Node22 `npm test` passed **664/664, exit 0**; the focused result test
passed **4/4, exit 0** on both pinned Node22 and Node24. `npm run validate`,
the pinned Claude marketplace and strict plugin validations, and the independent
5-path inventory all exited **0**. Plugin validation used fresh owned scratch
and no existing client configuration. There is no TypeScript/typecheck gate.

Independent fixed-commit reviews and latest-head CI remain primary delivery
work. The implementation worker made no commit, push or PR.

## Next question, not a new result

The existing opt-in [`bounded-source-scan`](bounded-source-selection.md) already
skips model select for complete small maps within unchanged reference bounds and
ranks the retained sources. It has a bounded fallback and is not a new engine or
vector store. An earlier manual/oracle source-coverage ablation observed 16/16
versus 12/16 necessary sources reaching evidence; those are source-coverage
observations, **not QA scores** or a result of this experiment.

A fresh, separately frozen fixed-write/read-policy ablation is planned to test
the existing mechanism while holding writes fixed. It has not produced a result
in this delivery. More sources can add irrelevant context or still be misused;
no repair efficacy follows from this four-answer diagnostic. Two authored
bilingual sessions cannot establish natural-session reliability, competitive
performance, LongMemEval/Mem0 parity, installed Hermes acceptance or resource fit.
All older failed gates and closed cohorts remain unchanged.
