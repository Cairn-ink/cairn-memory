# Offline LongMemEval official-rubric compatibility

`evaluation/longmemeval/official-scoring.mjs` is a separate evaluator-only
adapter. It does not replace the legacy diagnostic scorer and has no default
provider transport. The comparison run must already exist; evaluation
references come only from a separate prepared evaluator record. Shape and
opaque-ID checks prevent accidental data mixing but do not authenticate the
provenance of either record. Real runs must use the digest-checked prepared-v2
loader and retain an independently verified case roster.

## Compatibility boundary

The adapter follows `get_anscheck_prompt` and the judge request in the pinned
[`evaluate_qa.py`](https://github.com/xiaowu0162/LongMemEval/blob/9e0b455f4ef0e2ab8f2e582289761153549043fc/src/evaluation/evaluate_qa.py)
at commit `9e0b455f4ef0e2ab8f2e582289761153549043fc` (MIT license and
upstream-derived fixtures under `evaluation/longmemeval/fixtures/`). The six
base question types use their exact prompt wording. A source question ID
containing `_abs` selects the common abstention prompt, regardless of base
type. The request is `{model:'gpt-4o-2024-08-06', messages:[{role:'user',
content:prompt}], n:1, temperature:0, max_tokens:10}`. The upstream parser
trims and lowercases judge text, then tests whether it contains `yes` anywhere:
even `yesterday` is positive. This is compatibility, not a truth guarantee.

By default, only string references have verified prompt-byte parity. Prepared
JSON has lost the Python lexical/type distinctions needed to reconstruct
numeric and array reference formatting. Without the separate, checksum-bound
[offline Python reference rendering](official-reference-rendering.md), such
references receive `reference_serialization_unverified` on every completed arm,
with no judge call. The optional renderer uses Python's `str(answer)` from the
original verified source bytes; no Python is loaded by the public core.

## API and unresolved outcomes

`scorePublicComparison({run,evaluator,judge,judgeTimeoutMs,referenceRendering})` consumes the
public-comparison-v1 run and its matching prepared evaluator record. The
optional `judge({request,signal})` returns `{text}`; omission leaves completed
arms unresolved as `judge_not_configured`. The callback is invoked serially,
once per eligible arm, with a bounded timeout (default 30 seconds). Invalid
transport responses, throws, and timeouts stay unresolved. Failed, blocked,
or absent generation is never converted into a fabricated hypothesis or sent
to the judge. After a timeout, later completed arms are marked
`prior_judge_timeout` rather than started while an abort-ignoring callback
might still be running. The scorer snapshots inputs before calls and freezes judge
requests/results. A judge callback can be a scripted test double: these
records alone do not prove a real request reached the pinned model.

When comparison diagnostics contain opaque `retrievedSessionIds` and
`packedSessionIds`, the scorer separately reports reference-session coverage
for both stages using the evaluator's `answer_session_ids`. Missing retrieval
diagnostics and absent reference labels yield null coverage, not a fabricated
zero. These diagnostic IDs never enter the judge request.

`aggregateOfficialScores({roster,records})` requires a nonempty, unique roster
of `{questionId,sourceQuestionId,questionType}` and zero or more completed
scoring records. It rejects duplicate/unexpected IDs, mismatched source IDs or
types, mixed rubric/request versions, and malformed arm outcomes. Omitted
records count as unresolved for each of the fixed `cairn`, `full-history`, and
`no-memory` arms. For each arm it reports overall and per-type `fixedN`,
`resolved`, `correct`, `incorrect`, and `unresolved`; resolved-only accuracy;
coverage (`resolved / fixedN`); and fixed-N lower/upper bounds (`correct / N`,
`(correct + unresolved) / N`). It also reports stage/reason counts and a
separate `_abs` overlay. Empty type buckets have null accuracy, and the
six-type macro accuracy is null unless every type has at least one roster case
and all six buckets resolve. It also reports `common`: cases in which all three
arms resolved (`commonN`), per-arm correct/incorrect/accuracy over those cases,
by type and as an `_abs` overlay; accuracy is null at `commonN` 0. The `completeVerifiedOfficialStyle` flag means
only that every declared outcome resolved under verified string or Python-
rendered reference protocols.
It does not prove corpus completeness, genuine model provenance, or a
published LongMemEval result. Records also carry and aggregate-check the
answer model identity; mixing different answer models is rejected.

No downloaded corpus, provider credential, paid call, or measured quality
result is part of this adapter or its synthetic tests.
