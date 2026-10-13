# Closed readable-source first-answer probe

Disposition: **STOP this presentation probe**. Flat and readable evidence each
produced 12/12 required-conclusion-correct first answers. Net correct gain is
zero, and the baseline has no agreed incorrect-answer opportunity. Those two
frozen stop conditions apply even though one baseline answer contained an
agreed unsupported, predefined-severe extra assertion absent from the readable
answer. Correct required conclusions do not certify every added assertion.
This result establishes no QA improvement, promotion or product acceptance.

## One presentation factor, not learned retrieval

The population is 12 wholly new hand-authored synthetic worlds in six matched
source-world pairs: six known and six explicitly unestablished worlds across
three families. Each world supplies five whole cards and seven passages:
60 cards, 84 passages and 24 first answers overall. These cases are consumed;
none may be tuned, retried or reused as fresh evidence.

A uses ordinary flat whole-card source JSON through `packCardPlanAnswer`.
B uses lossless, length-framed readable source blocks through
`packReadableCardPlanAnswer`, on the same genuine card-plan capability.
Both use unchanged ordinary `packMixedAnswer`, complete sources/recorded roles,
card/source order, question, instruction, model `gpt-4.1-mini-2025-04-14`,
temperature 0, n=1 and output cap 512. Only evidence presentation differs;
decoding B recovers the original source fields/text without omission or
duplication. No semantic annotations, filtering or new reader instruction
were added. The renderer is opt-in, not a default or release change.

Genuine indexed-evidence capture, cold reopening and authoritative source
reads were used, but extraction, classification and all-card ranking were
scripted bookkeeping, not measured model memory formation or retrieval.
Actual native recall/get observations were retained separately from the
explicit evaluation-only author-order array permutation. Every other actual
field and source membership remained intact; the ordered snapshot is not
claimed to be unmodified normal recall. A common operator-assigned synthetic
capture clock is not event truth or an inferred source fact. The evaluator-only
rubric was opaque during preparation and never entered model inputs.

## Frozen first outcomes

Two new distinct nonauthor judges, actual GPT 6.1 Sol/high with no parent history,
each submitted one independent first reply against frozen original evidence
and rubric. Agreement-only scoring retained first submissions without repair,
retry, adjudication or rejudgment.

| Observation, fixed denominator 12 per arm | A flat | B readable |
| --- | ---: | ---: |
| Completed first answers | 12/12 | 12/12 |
| Required-conclusion correct | 12 | 12 |
| Incorrect / unresolved / unanswered | 0 / 0 / 0 | 0 / 0 / 0 |
| Agreed unsupported-certainty questions | 1 | 0 |
| Agreed predefined-severe questions | 1 | 0 |
| Produced-answer safety unknown | 0 | 0 |

Both baseline safety flags concern the same question, RV06, not two separate
failures. All 12 paired correctness outcomes are correct/correct: zero wins,
zero useful-answer losses and zero net correct gain. There is no new readable
unsupported/severe case. The single favorable safety observation is retained,
but does not establish a reliable or general safety benefit or satisfy the
required positive QA signal. This hand-authored paired sample is not population
evidence; do not pool it with any earlier score.

Judges received independently shuffled opaque individual items without arm or
explicit pair labels. Each packet included both arms' answers, so repeated
questions could be recognized. Same-family agreement is not human ground truth,
perfect blinding or independent per-item evidence.

A truncated, unsubmitted packet transfer was detected before either judge
received it. The transfer was rebuilt to the exact original intended
bytes/IDs/order/hash, with its malformed copy retained. No answer was regenerated,
rubric changed or first judge submission repaired. This was data-transfer
diagnosis, not a hidden model retry.

## Completion and resources are separate from QA

The closed primary audit accepted accounting: execution exit 0, 24 physical
requests, all 24 answers completed, original ledger prefix unchanged and no
pending or unknown usage. Structural completion does not override the STOP.

| Resource observation | A flat | B readable |
| --- | ---: | ---: |
| Local complete-wire input tokens, total | 15,109 | 15,817 |
| Provider-reported input tokens, total | 11,953 | 12,745 |
| Provider-reported output tokens, total | 390 | 376 |
| Configured usage estimate, US dollars | 0.005411 | 0.005705 |

Readable framing added **59 local full-wire tokens per question**, 708 total;
this is not token saving or evidence of lightweight performance. The new
conservative reservation was US$0.12; combined provider-reported configured
usage estimate was US$0.011116, not an invoice or independently billed cost.
At closure, cumulative original reservations were US$335.102281 across
58,153 requests. The original US$400 ceiling and protected US$30 remained
unchanged; this historical checkpoint grants no future affordability or spend.
The ordinary transport's US$10 spendable preflight floor and 1,968 remaining
request-slot requirement were not relaxed for this smaller probe.

All complete-wire inputs fit the unchanged 6,000-token cap; output remained 512,
physical call 200 seconds, case 1,200 seconds and run 28,800 seconds. Recorded
run elapsed was 76.741987314 seconds, including coordination. It is not product
latency; arm medians are not evidence of causal performance improvement.

## Frozen provenance and public boundary

The tested renderer is commit
[`85cc67c0da501c13f53dcd7277834964dcdb2e18`](https://github.com/Cairn-ink/cairn-memory/commit/85cc67c0da501c13f53dcd7277834964dcdb2e18),
[PR #421](https://github.com/Cairn-ink/cairn-memory/pull/421). Its
[fixed presentation plan](https://github.com/Cairn-ink/cairn-memory/blob/85cc67c0da501c13f53dcd7277834964dcdb2e18/docs/plans/readable-source-view.md)
is separate from this docs-only base; no runtime was changed to document results.

| Immutable artifact | SHA256 |
| --- | --- |
| Reviewed source-v2 | `4a7a1471413320da4964d976b5cfb18a448f006d50e0aeae7bc34646b111c424` |
| Reviewed rubric-v2 | `95048a78a2bf6857844b5ddf5e2994d8bcb250bc1c191018fb05ebe1cfdbdec2` |
| Closed first-answer report | `e888cf34b7d63f5618ae91187a0331d103eb86f04690461c96074afdabaac4c0` |
| Frozen first score | `09fc500edb3498a17b02c19e7b1f6eaa293afbd9d8510bfeeabbf2b2f3769d5f` |
| Closed primary audit | `6bd13691f3948287b603086046c1866868b8a28d67547540ada4795a2b8659aa` |

Original source, answer, receipt, judgment and accounting artifacts stay private
and immutable. This report publishes no private paths, opaque identifiers,
source/answer bodies, credentials or full judge explanations. Its counts are
the existing sealed first score, not a new scorer invocation or judgment.

## Stop and next evidence boundary

Do not tune/retry these format cases or revive literal source-context basis
generation as if it were new. The ordinary `indexed-evidence-v1` capture path
rejects capture-qualification configuration and produces no such qualification;
source-only projection intentionally omits interpretations. Existing
[basis](../source-basis-comparison-results.md),
[context](../source-context-ablation-results.md) and
[addressed](../source-addressed-ablation-results.md) trials retain copy/role,
structural and semantic failures; none established final-answer gains.
Those are distinct closed experiments, not pooled comparators for this result.

Exposing an existing source-bound proposal to a downstream answer reader is a
distinct but unproved hypothesis, not a chosen or implemented successor here.
It would add interpretation and resource cost, not be lossless formatting
alone. Fresh mechanism and baseline-error opportunity evidence must precede
another candidate; no old case, answer or judgment is reopened to manufacture
a signal. This result authorizes no new architecture, budget or execution.

The unchanged [three-stage plan](reliability-three-stage.md) still requires
fresh paired P4 gain at least +3/24 with targeted-stage improvement and all
safety/resource gates, then separate Stage 3, reliability, natural installed
Hermes new-session and measured resource acceptance. This probe establishes
none of those, no official LongMemEval score, Mem0/Supermemory parity or product
reliability. No default, roadmap gate, release or deployment changed.

## Documentation ownership and remaining verification

One bounded actual GPT 6.1 Sol/high worker owns only this result, append-only
limitations and a latest-status/link insertion into the historical master plan,
at fixed docs base `01965c34dc2262de94b5de18505dedc9187df74a` (PR #420).
Primary owns arithmetic acceptance, final generic/validation/strict Claude
gates on Node 22.16/24.15, exact-blob inventories, distinct nonauthor fixed-commit
Standards/Spec reviews and dependent PR delivery. No worker tests, runtime
imports, live requests, rejudging, commit or push occurred for these docs.
