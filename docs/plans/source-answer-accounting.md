# Source-linked answer accounting — offline candidate

Dependent base: `2181922e75802fa7fd6ecf42b4ce8ddedd6e025b` (provider usage repair,
including its installed bounded-drift/overflow regression update).
No production selection, retrieval, storage, provider transport or host default
changes. This package prepares and validates one model-proposed answer record;
it does not execute a model or claim the record is semantically correct.

## Why this seam

The retained augmentation comparison loses required sources and complete-source
controls still preserve obsolete reasons or amplify provisional choices. Test
answer handling independently before another retrieval intervention. Existing
`core/source-evidence.mjs` supplies full receipts; `compileDecisionBasis` already
distinguishes decision, premise, update, subject, applicability, scope and
commitment. Reuse that vocabulary and trust boundary, not its persistent state
or a second graph. No preliminary reviewBasis call or second prose generation.

The existing synthetic answer wire format is `{question,sources}`, where each
source is `{id,role,content}`. The caller must first bind these aliases and full
contents to an authoritative finalized source snapshot (or explicit synthetic
canonical control). This compiler checks only its frozen input identities, not
database freshness after a host answer or independent truth of source content.

## API and representation

`prepareSourceAnswerAccounting({inputJson,countTokens})` returns a deeply frozen
`{system,input,maxOutputTokens,compile}`. `input` is the parsed unchanged-value
question/sources object; `system` retains the existing source-answer instruction
plus the record contract; `maxOutputTokens` is1024. No transport is included.
JSON strings at both boundaries avoid evaluating caller-owned getters/toJSON.
The caller-supplied synchronous tokenizer is trusted only as a counter, with
finite safe nonnegative integer results required. Count system plus serialized
input as `system + '\n' + JSON.stringify(input)` using the existing6000
local-input ceiling; compile counts the exact raw
output JSON against1024. Never truncate, repair or invoke a model to fix output.

Record shape, all keys required and no extra keys:

```
{
  "choice": claim | null,
  "commitment": claim | null,
  "scope": claim | null,
  "reasons": [{"original": claim, "later": [claim], "current": claim | null}],
  "unknown": ["requested information not established"],
  "answer": "concise answer in the question's language"
}
claim = {"text": "model-proposed interpretation", "sourceIds": ["input-id"]}
```

`later` preserves separately cited challenges/reaffirmations without requiring
a normalized truth label or a link graph. Empty later means no update represented,
not that no update exists. Null choice/commitment/scope/current means unresolved,
not disproved or universal. No requirement that confidence increase when a reason
survives; failed reasons alone cannot establish a replacement decision. Unknown
approval means neither an approver nor approval itself is established.

## Acceptance

1. New evaluation-only module `evaluation/architecture/source-answer-accounting.mjs`
   reuses existing identifier/text privacy validation and source-answer instruction.
   No fetch, database, model, provider key, grant, ledger or persistence access.
   Preparation counter failures/invalid input throw content-free `invalid_input`;
   all compile failures, including its counter, throw `invalid_model_output`.
   No input normalization or truncation.
2. Input JSON UTF-8<=24000 bytes, well-formed Unicode, question1–4000 UTF-16,
   sources0–24 with unique valid IDs, role user/assistant and nonblank full
   content1–800. Reject missing/extra fields, non-string JSON, malformed JSON,
   invalid IDs/roles/Unicode and detected secrets. Preserve every supplied source
   including assistant attribution and enclosing negation; do not clip quotes.
   Local counted system+input<=6000. Freeze all nested request data.
3. Output raw JSON UTF-8<=16000 bytes and count<=1024; exact shape above.
   Claims have nonblank well-formed text<=400 and1–4 distinct existing source IDs.
   Reasons0–8, later0–4 per reason, unknown0–6 distinct nonblank strings<=400;
   answer1–4000. Reject missing/extra fields, invalid or duplicate references,
   invalid lengths/types/Unicode/secrets. The compiler never infers an unmentioned
   reference or silently fills empty fields. Instructions forbid treating an
   assistant suggestion as permission, but a structurally valid model claim of
   permission remains unassessed under acceptance4, not automatically detected.
4. Compile returns deeply frozen `{record,sources,interpretationStatus:'model-proposed',
   semanticStatus:'unassessed',sourceSelectionCoverage:'unassessed',executionAuthority:'none'}`.
   `sources` retains all exact enclosing input receipts, not just cited fragments.
   It intentionally accepts structurally valid but semantically wrong assertions
   as **unassessed**; deterministic citation validity is not entailment, adoption,
   reason applicability or proof the answer agrees with the record.
5. Independently authored tests cover happy path, empty/unresolved input, bounds,
   malformed JSON/fields, alias isolation, Unicode, privacy, count failures,
   deep freeze/caller mutation and counter callbacks. Negative semantic fixtures
   explicitly demonstrate that source-bound stale reasons, strengthened tentative
   choices, clipped-negation interpretations or claimed approval do NOT receive
   semantic/truth/authority approval. No live experiment or historical rescoring.
6. Root runs generic/JSON/strict plugin gates and focused tests Node22.16/24;
   preserve Node20 pure-test compatibility. Fixed-point independent Standards and
   Spec reviews and required CI precede authorized merge. Document the next
   integration/fresh comparison gates without promising quality improvement.

## Later experiment, not authorized by this module

Use identical retrieved inputs for ordinary and structured answers, with the
same pinned model, one generation each, unchanged output cap and paired controls.
Report record overhead, failures, final prose fidelity and unnecessary abstention
separately from field completion. Include old-premise/new-reason, actor sharing,
temporary planned return, explicit nonadoption, outside-span negation and absent
approval. Freeze new cases/operator and review fake-HTTP rehearsals before any
new paid run. Existing failed cases stay frozen; no production promotion yet.
