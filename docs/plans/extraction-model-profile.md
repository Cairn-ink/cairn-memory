# Measured extraction-only model candidate

Base: `1d5c8cfd29eddbdc5dc2b5402447b053725d2fff` (retained third failed suite).
The source-support rubric, corpus and receipts remain unchanged. This is an
explicit experimental adapter option, not an unmeasured default-model migration.

## Hypothesis and scope

The existing pinned GPT-4.1 mini extractor still adds implementation claims to
source statements of usage after the prompt-only fix. Test whether an explicitly
selected stronger extraction model follows the same source-faithful prompt more
reliably. Change only the extraction model; retain GPT-4.1 mini for classification,
selection and ranking. Do not retry the unchanged baseline until it happens to pass.

Candidate: `gpt-5.4-mini-2026-03-17`, reasoning effort `none`. Official model docs
checked 2026-09-09 describe Responses/structured-output support, a 400000-token
window, and standard text pricing US$0.75 input/US$4.50 output per million tokens:
<https://developers.openai.com/api/docs/models/gpt-5.4-mini>.
Account access and actual response compatibility were initially unverified;
the bounded evidence below records the subsequent result. No claim that a newer
model necessarily passes other tasks.

## Acceptance X01–X07

- X01: Add only an explicit allowlisted extraction-model option to the existing
  adapter. Default behavior remains the pinned GPT-4.1 mini profile. Unknown
  models/configuration reject before network I/O. No arbitrary endpoint, retries,
  silent model fallback or second memory engine.
- X02: Count and generation use the same selected model, input, instructions,
  schema and supported reasoning configuration. Preserve exact snapshot response
  checks, bounded output/context framing, cancellation and sanitized errors.
  Non-extraction methods remain byte-equivalent to the existing profile.
- X03: Run-local guards reserve per request using its verified model rate before
  I/O, including count calls and failed/unknown outcomes. GPT-4.1 mini remains
  US$0.004448/request; candidate extraction ceiling is US$0.009876/request
  (7024 input +1024 output at the documented rates). No aggregate undercount,
  refunded failures or weaker request limits. Record exact model on each request.
- X04: Evaluation runner accepts an explicit profile, reports its per-method model
  identity and sums integer reservation units from guard snapshots. Freeze corpus
  and scorer unchanged; retain all failures/unrun results and independent labels.
- X05: Offline tests cover routing, reasoning shape, invalid configuration,
  wrong-model output, token/response limits, failures, mixed-model accounting and
  aggregate budget stop. Run both Node22.16 and24. No worker paid calls.
- X06: DRI-only initial compatibility probe has a maximum US$0.05 reservation;
  if it fails, retain the failure and diagnose before further calls. A subsequent
  single full frozen run may use at most US$1.40, only if the cumulative campaign
  reservation remains under the already approved US$5 ceiling. Starting checkpoint
  US$3.033536 reserved, US$1.966464 remaining. Never spend unused allowance merely
  to repeat a successful-looking sample.
- X07: Independently label source support and retrieval on the complete new run.
  Failed semantic acceptance remains failed regardless of engineering CI. Do not
  promote the candidate to a default or advertise quality before measurement and
  final independent Standards/Spec reviews. No publication or deployment.

## Offline implementation evidence

The OpenAI Docs workflow fetched the exact official model page and count API
Markdown reference before changing request behavior; the latter explicitly lists
`reasoning?: Reasoning` and effort `none`. No newer target was substituted and
no prompt change was added. Candidate selection is the exact `extractionModel`
option shared by adapter, guard and evaluation runner; CLI syntax is documented
in [evaluation usage](../semantic-evaluation.md).

Eight new offline tests exercise extraction-only routing and unchanged non-extract
requests, identical count/generation reasoning, invalid options, exact response
snapshot rejection, shared limits/cancellation, explicit guard opt-in, failures,
upfront mixed pricing and integer aggregation over all 36 fake runs. A tiny
candidate budget permits only two failed HTTP attempts and keeps 34 unrun
repetitions in the fixed denominator. Scripted successful orchestration still
retains pending independent semantic judgments, not a passed quality claim.

All 81 adapter/evaluation tests pass on Node22.16.0 and24.20.0; both offline
provider lifecycle demos pass. Frozen corpus, scorer and old report files are
unchanged. Existing 31 plugin tests, JSON/version validation and marketplace/
strict plugin validation pass; no new typecheck gate exists in this JS repository.
The offline implementation stage made no paid calls and consumed none of the US$1.966464
remaining campaign reservation. X06 compatibility and X07 independent source
support remain DRI gates before any default-promotion discussion.

## Measured evidence

Implementation was frozen at `4980e6408c21c939ffb1357a16f082ee7b1e07cd` before
the following DRI-only calls. The corpus/scorer and all three earlier reports
are unchanged. The explicit experimental profile is not promoted to a default.

- [Compatibility probe](../../evaluations/results/extraction-profile-probe-v1.json):
  actual extract/count/generate and classification succeeded in a fresh synthetic
  store. Both original usage statements remained literal, correctly sourced
  memories. Four HTTP requests reserved US$0.028648 against a US$0.05 cap.
- [Complete frozen run](../../evaluations/results/extraction-profile-v1.json):
  36/36 completed, 222 HTTP requests, US$1.117728 reserved under the US$1.40 cap.
  Only the 36 temporary database paths were removed from the original report;
  raw pending-review summary remains intact alongside separate labels.
- [Independent agent labels](../../evaluations/results/extraction-profile-v1-review.json):
  unchanged scorer returns **passed**: recall 44/45, relevance 44/44, all 25
  captured records supported and all 24 required capture facts recovered.
  MOC discoverability 12/12 and three coherent topic groupings, empty queries 6/6,
  zero reported safety violations or review errors. This is agent, not human,
  evidence review. C04 repetition 3 omitted `soup-cumin` for the cooking query;
  it remains a miss, not a discarded trial. The scorer's pre-existing 90% recall
  threshold allows this miss; no threshold was changed.
- Current-executable peak RSS 176254976 bytes, max retained SQLite/WAL/SHM
  233472 bytes, recall p95 4856 ms. Small Linux fixtures only, not scale evidence.

The probe's generation-usage estimate is US$0.0011855 and the complete run's is
US$0.0415658, neither an invoice. Campaign reservations now total US$4.179912
(prior US$3.033536 + probe US$0.028648 + run US$1.117728), leaving US$0.820088
of the approved US$5. Failed/count requests in previous runs stay reserved.
No additional calls are needed merely to improve this score.

Reproduce review without network or credentials from this checkout:

```sh
node --input-type=module -e 'import fs from "node:fs"; import {cases} from "./evaluations/semantic-cases.mjs"; import {summarizeEvaluation} from "./evaluations/score.mjs"; const read = name => JSON.parse(fs.readFileSync("./evaluations/results/" + name, "utf8")); console.log(summarizeEvaluation(cases, read("extraction-profile-v1.json").results, read("extraction-profile-v1-review.json")));'
```

Default GPT-4.1 mini source support is still failed. This run is not a competitor
benchmark, human benefit study, public release, automatic capture certification,
or proof that an installed MCP client uses the experimental profile. Packaging
integration must add the new runtime `profiles.mjs` to the artifact allowlist
and rerun installation gates before these source changes are combined with it.
