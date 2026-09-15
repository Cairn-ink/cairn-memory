# Same-source answer accounting: fresh protocol

This is a diagnostic of host interpretation, not a memory-ingestion, MOC recall,
installed MCP or human-use benchmark. It tests the
[offline answer record](source-answer-accounting.md) on fresh synthetic sources.
Earlier failures stay retained; no previous answer is regenerated or rescored.

## Twenty-four fixed slots

Six histories form three matched provisional/confirmed pairs: knitting-circle
scarf yarn, temporary homemade-bread storage and Traditional Chinese family-recipe
organization. Each contains seven user statements and one assistant suggestion,
with explicit nonadoption elsewhere. Only the commitment sentence differs within
each pair; questions are identical. Original reasons, later challenges and
reaffirmation remain separate from the recorded choice and another person's
independent choice. The bread case includes a planned return and an untested
replacement; the Chinese case lacks established purchase approval or approver.

Each history has two constructed views: all eight sources and seven sources
with one predeclared reason-changing passage omitted. The decisive qualifier
remains present. These omissions are diagnostic construction, not an observed
retrieval failure or information supplied to the model. Missing evidence does
not justify inventing a replacement, a causal explanation or verified continued
support. The model may truthfully describe an original reason as historical.

For each view, ordinary and accounting arms receive identical `{question,sources}`
values. Source IDs, roles and full contents are unchanged. Only the instruction
and required output representation differ. The ordinary arm uses the existing
source-answer instruction; accounting produces one bounded record including its
own concise answer. There is no additional review, repair or prose-generation
call. Alternate ordinary/accounting order by history and view, retaining actual
order. Six histories ×two views ×two arms =24 slots, including failures/not-run.

The separate rubric is never model input. Its labels identify required sources,
commitment, reasons, scope, actors and unknowns for subsequent review. Exact IDs
and field completion cannot establish entailment. One Chinese pair does not
establish multilingual quality, and three authored pairs are not a general
accuracy estimate. These same-source tests cannot validate capture or retrieval.

## Execution boundaries

Both arms use `gpt-4.1-mini-2025-04-14`, one chat completion, output cap1024,
`store:false`, `stream:false`, `n:1`. No response-format extension, tool call,
source-model generation or automatic judge is added. Instruction plus serialized
input must fit6000 local tokens; serialized HTTP body<=24000 UTF-8 bytes. Returned
text must fit1024 local tokens and16000 UTF-8 bytes. Retain accounting overhead
rather than granting it extra output. Compilation validates structure and source
identity only; its answer and every interpretation remain semantically unassessed.

Freeze fixture/rubric, candidate/source/dependencies, instruction, operator,
compiler and guard identities before real execution. Preserve exact requests,
raw responses, invalid outputs and not-run slots. One durable intent prevents a
second run even in another evidence directory. No retry or regeneration follows
a malformed response. Transport, pin or accounting failure halts later sends;
cleanup status remains separately recorded.

Use the existing cumulative US$50 campaign, not a reset ledger. This run is
bounded by US$2 and24 HTTP attempts; each unchanged host reservation is US$0.05,
so a full schedule reserves US$1.20. There are no input-count requests in this
host-only diagnostic. Check conservative headroom/checkpoint and pins before
dispatch. Unknown costs are not free; estimates are not invoices. No key appears
in a public file, process argument, child environment or captured request header.

Before paid execution, independently review the exact operator and rehearse
success, invalid structured JSON, unknown source references, interrupted
transport, budget/pin mismatch and cleanup failure with fake HTTP and separate
synthetic ledgers. Ordinary unit success is not a substitute. No fresh model
call is authorized merely by importing the compiler or reading this document.
Existing owner authorization and its remaining budget remain controlling.

## Review and decision

The DRI plus two separately working reviewers inspect every ordinary answer,
accounting record and its final prose against the actual input view and frozen
rubric. Disclose nonblind/same-family review and fixture/operator authorship.
Keep genuine ambiguities and disagreements visible rather than forcing a score.

Separate changed from continuing reasons, reasons from commitment strength,
reported plans from completed events, source attribution from adoption and
remembered decisions from execution authority. Review original and later reasons
individually; a correct record with contradictory prose still fails answer
fidelity. Count unnecessary abstention and omitted supported details alongside
unsupported certainty. Missing-view errors must not be blamed on a model seeing
evidence it never received; complete-view errors cannot be blamed on retrieval.

Report all24 slots, request/response sizes, actual token usage, guarded latency,
reserved/known/unknown cost and cleanup. Do not promote if fidelity regresses,
invalid responses proliferate, or mistakes merely move into unchecked fields.
An inspectable record can still be wrong. Even a positive narrow result would
need larger unseen histories and end-to-end installed/natural-host evidence.

This package adds fixtures, tests and a protocol only. No production default,
persistent graph, package release, deployment or private integration is changed.
See [acceptance and frozen shape](plans/answer-accounting-comparison.md).
