# Three-arm comparison — offline runner, not a benchmark result

Cairn needs evidence of usefulness, not only successful data ingestion. This
runner compares the same question under three evidence conditions: Cairn recall,
simple lexical retrieval, and no memory. It reuses the public memory core and the
existing source-mapped ingestion module. No second memory engine is introduced.

The bundled demonstration uses entirely synthetic dialogue and scripted models.
Its answers and scores verify the runner and scorer wiring, not the quality of
a real model, human usefulness, or a public LongMemEval benchmark score.

## Run the synthetic check

From the source checkout with Node 22.16 or 24:

```sh
npm run test:longmemeval
npm run demo:longmemeval-ingestion
npm run demo:longmemeval-comparison
```

No dependency download, API key, actual corpus or model service is needed by
these commands. The demo retains a newly created synthetic SQLite database.

## Programmatic runner

Import `runLongMemEvalComparison` from `evaluation/longmemeval/comparison.mjs`.
Supply exactly `{history, question, namespace, core, answer, countTokens,
answerModel, limits}`. `history` is one prepared history record; `question` is
exactly `{question_id, text, date}` with its matching opaque case ID. Namespace
must be project scope, with `projectId === history.question_id` and an explicit
owner. The existing core supplies `list`, `capture` and `recall`.

Use a new synthetic database for every case/trial. The active-memory check can
reject a visibly contaminated scope, but cannot prove an empty scope has never
held tombstones, replay claims or other history. This API does not own the
database lifecycle or authenticate its caller.

`limits` has exactly six positive integer fields: `evidenceTokens`,
`requestTokens`, `outputTokens`, `answerTimeoutMs`, `recallLimit` (at most 12),
and `lexicalLimit` (at most 100). `countTokens(text)` is synchronous and must
return a nonnegative safe integer. It is injected so the experiment can use the
answering model's tokenizer; the demo's scripted counter is not that tokenizer.

The answer callback receives `{model, request, maxOutputTokens, signal}`. The
request includes a fixed versioned instruction, question text/date and evidence,
but no arm name, reference answer or evaluator label. The counted input boundary
is exactly `JSON.stringify({model, request, maxOutputTokens})`; AbortSignal is
excluded. Evidence counting uses `JSON.stringify(request.evidence)`, including
the empty array's framing. A provider adapter must separately account for its
wire framing; these counts alone do not establish external context fit.

Return `{text}` or `{text, usage}`, where usage is exactly
`{inputTokens, outputTokens, costMicroUsd}` with each field a nonnegative safe
integer or null. Missing usage stays null. Returned text is independently counted
against the output cap. This usage belongs to the answer callback only, not to
capture, recall or judging. Callback implementations must be stateless across
arms and honor the AbortSignal; the runner cannot stop arbitrary background work
inside an injected function. The existing core retains its own model deadlines.

The result is a deeply frozen record with schema/template versions, question,
declared answering model and limits, a content-free source identity catalog,
three `arms`, blocking flags and elapsed time. Arms are ordered `cairn`,
`lexical`, `no-memory` in the report; that order is not necessarily callback
execution order. Each arm records completion/failure, stage errors, retrieval,
packing and answering evidence. Answer failures do not disappear from the report.

Ingestion outcomes retain an optional `errorStage` (`capture` or `classification`)
with a finite projected `{code, retryable}` error. A partial admission can have
failed classification after memory was stored; it remains partial, stops later
batches, and does not authorize an answer from the incomplete Cairn store.
Top-level capture errors are not relabeled as extraction errors. Unknown codes
map to fixed fallbacks, never arbitrary provider strings. Successful, duplicate
and not-run outcomes do not acquire a failure diagnostic.
The scorer accepts both older outcomes without `errorStage` and new bounded
stage-bearing outcomes. The extra field does not change scores or eligibility;
unknown stages and inconsistent stage/status/error combinations are rejected.

Lexical ranking counts unique overlapping question/turn tokens after NFKC,
lowercasing and Unicode letter/number tokenization. Zero-overlap turns are not
candidates. Ties retain source order; `lexicalLimit` bounds the ranked candidates
considered for packing. No stemming, embeddings, BM25 or relevance guarantee is
implied. A budget-skipped candidate is retained as an omission, and smaller
later candidates may still fit.

## Separate evaluator-only scoring

Import `scoreLongMemEvalComparison` from `evaluation/longmemeval/scoring.mjs`.
After generation, call it with exactly `{run, evaluator}`. `evaluator` is the
matching prepared evaluator record with `question_id`, `source_question_id`,
`question_type`, `reference_answer`, `answer_session_ids` and `turn_labels`.
Case identity and referenced source coordinates are checked before scoring.
An in-memory record is not a signed artifact: retain its preparation hashes and
run provenance separately instead of treating schema validation as authenticity.

The `normalizedExactMatchDiagnostic` applies NFKC, lowercase and whitespace
normalization to the answer and reference serialization; it is not a semantic
grader. A scalar is converted to a string. An array is one `JSON.stringify`
reference, not a list of acceptable aliases. Therefore a reasonable paraphrase
can fail this diagnostic. Do not call it official LongMemEval accuracy.

To request independent semantic judgments, supply all three additional fields:
`{judge, judgeModel, judgeTimeoutMs}`. The callback receives
`{model, input: {question, generatedAnswer, reference}, signal}` and returns
exactly `{verdict: 'correct' | 'incorrect' | 'unknown'}`. Freeze the judge's rubric
and implementation before a real experiment. The module supplies no live judge
or built-in semantic rubric. Unknown, malformed, failed or timed-out judgments
remain unscored; missing judgments are neither correct nor automatically wrong.

The scoring result keeps each arm's generation status, exact-match diagnostic,
optional semantic judgment, and separate **retrieved** versus **packed**
reference-session coverage. Coverage includes numerator/denominator; absent
reference-session labels produce null, not perfect coverage. The scorer also
retains attempted/completed/failed/scored counts and blocking flags. Aggregate
real experiments by arm across cases, not by averaging these three experimental
conditions into a single product score.

## Evaluation boundaries

History and questions are model-facing; the evaluator file is not. Generation
finishes before the separate scorer receives reference answers or evidence
labels. Logical separation does not sandbox a malicious callback: the operator
must not give the answerer another route to the evaluator data or prior answers.
Injected model identity and token counting are operator declarations, not proof
of which external service an arbitrary callback uses.

The lexical baseline is intentionally simple and will not stand in for every
RAG implementation. The no-memory arm has the question and date but no history.
All arms share the answer template, declared answering model and input/output
allowances. Whole evidence items that do not fit are omitted and counted; text
is not silently chopped to manufacture a passing context limit.

Cairn's receipts prove where content was attributed, not that the memory is
semantically supported by that source. Reference-session coverage is likewise
not answer correctness. Keep structural safety/provenance failures separate
from QA scores; a good average must not hide a cross-case leak.

## Before a real score

Freeze the sample, model versions, prompts, tokenizer, limits and judge rubric
before scored calls. Use a fresh isolated store per case and retain every failed
attempt. Bind all paid stages to the reviewed experiment guard and obtain a new
explicit budget. Record extraction/recall expenses as well as answering and
judging; an answer-only usage report is not total experiment cost.

The full dataset, actual-provider pilot, broader correction/forgetting/fault
regressions and source-faithfulness quality fixes remain separate gates. A
seven-case pilot must never be presented as the full dataset. This package
neither downloads a corpus nor discovers credentials or runs a provider by default.

See [acceptance and verification](plans/longmemeval-comparison.md).
