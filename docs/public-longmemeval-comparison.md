# Offline public LongMemEval comparison API

`runPublicComparison` in `evaluation/longmemeval/public-comparison.mjs` is a
separately versioned, offline generation API. It does not replace the legacy
lexical comparison or scorer and does not make a benchmark-accuracy claim. The
fixed serial arms are `cairn`, `full-history`, and `no-memory`. The API has no
provider transport, credential discovery, evaluator input, or default model.

The exact input is `{history, question, namespace, core, answer, countTokens,
answerModel, limits}` plus optional `answerTemplateVersion`. `history` and `question` are one matching prepared v2
history/question pair; `question` contains exactly `{question_id,text,date}`.
Opaque v2 session-occurrence IDs must be unique and have the `lme-session-`
digest shape; this checks shape, not the originating corpus digest.
The namespace is a new project namespace with `projectId` equal to the opaque
question ID. `core` supplies `list`, `capture`, `recall`, and `get`. `limits` is
exactly `{contextWindow,outputTokens,answerTimeoutMs,recallLimit}` with positive
safe integers and `recallLimit <= 12`. `answerModel` is a nonempty model label.
`countTokens(text)` is synchronous and returns a nonnegative safe integer. It
must be a pure, model-appropriate estimate. The runner clones and freezes its
validated input snapshot before invoking callbacks, but a counter with external
side effects cannot be made pure by the runner.

All arms receive the same fixed system instruction, question text/date, model,
temperature 0, `n:1`, and `max_tokens:outputTokens`. `answer({request,signal})`
receives one provider-shaped request:

```js
{
  model: answerModel,
  messages: [
    { role: 'system', content: PUBLIC_ANSWER_INSTRUCTION },
    { role: 'user', content: JSON.stringify({
      question: { text: question.text, date: question.date }, evidence,
    }) },
  ],
  temperature: 0, max_tokens: limits.outputTokens, n: 1,
}
```

That request is the default `cairn-longmemeval-public-answer-v1`; explicit v1
is byte-identical to omission. The experimental opt-in
`cairn-longmemeval-public-answer-v2` keeps the same system instruction and all
request controls, but serializes user content as
`{evidence,currentQuestion:{text,date}}`, in that key order, for all three arms.
Evidence remains quoted JSON data: historical roles never become provider
message roles. V1 and v2 results are separate protocols and must not be mixed
or treated as directly comparable quality measurements.

The callback is stateless by contract and receives no arm name, reference,
labels, or scoring rubric. It returns `{text}` or `{text,usage}`, where usage
has exactly `inputTokens`, `outputTokens`, and `costMicroUsd`, each a
nonnegative safe integer or null. Missing usage stays null. Reported usage is
answer-only; capture, recall, and any later judge spend are excluded. An answer
callback is attempted once per eligible arm with an AbortSignal and deadline.
Timeout or invalid response remains a failed arm, never a guessed answer. The
runner cannot stop background work in a callback that ignores abort. After an
answer timeout, remaining arms are blocked as `prior_answer_timeout` rather
than starting potentially overlapping answer work.

Full history uses compact JSON session blocks in source occurrence order:
`{sessionIndex,sessionId,date,turns:[{role,content}]}`. Every original role,
content string, date, and duplicate session occurrence is preserved; neither
normalization nor retrieval shortens this baseline. No-memory uses an empty
evidence array. The preflight counter receives `JSON.stringify(request)` for
the complete full-history request and also the empty request. Reserved output
tokens are added to each input estimate and checked against `contextWindow`.
If full history exceeds the window, **all three arms block without a core or
answer call**. This is a local counter estimate, not proof of a real provider
window or provider wire framing. There is no truncation fallback.

Cairn checks the namespace before capture, then uses the existing source-mapped
ingestion planner/capture path. The runner does not accept duplicate outcomes:
replaying even an empty previous
capture fails the Cairn arm. The memory-list precheck cannot prove the absence
of unrelated event-history rows; the calling harness must own a newly created
store/namespace rather than relying on this check as freshness authentication.
Source dates stay metadata; capture does not
receive the question date. Recall uses `contextMode:'source-evidence'` and
includes the question date in the retrieval query. The answer never receives
generated memory content or a generated summary. For every selected memory the
runner calls `core.get({namespace,memoryId,receiptLimit:100})`, requires an
exhausted complete receipt set, matches ID/revision/namespace/count, and joins
each receipt by exact ID to the core detail and by exact event ID to the
ingestion source map. Client, session, role, and normalized bounded excerpt
must match exactly. Unknown, partial, duplicate, mismatched, or stale
provenance blocks Cairn. Content similarity is not used as source identity.
Selected answer evidence consists of whole memory receipt items; packing can
omit a whole item for context fit, never an individual receipt. Retrieval and
packing counts, omissions, retrieved and packed opaque session IDs, and
source-selection coverage are diagnostic only.
Capture is source-time-unaware: source dates are reattached from the prepared
history after source binding, not inferred by core.

The frozen run has schema version `cairn-longmemeval-public-comparison-v1`,
`questionId`, `question:{text,date}`, `answerModel`, `templateVersion`,
`limits`, `preflight`, and `arms`. Each arm has `{name,status,reason,answer,
diagnostics}`. Status is `completed`, `failed`, or `blocked`; reason is null on
completion; answer is null otherwise. The evaluator record is deliberately
separate and should be passed only to the official scoring adapter after
generation. A prepared object passing this shape validation is not provenance
authentication: real benchmark runs must use the digest-checked v2 loader and
retain its artifact provenance.

The integrated synthetic demo uses the real local core and scripted models.
It verifies wiring and separation only, not semantic answer quality, real
context fit, official scoring, or total experiment cost. Capture/recall
transport guards and whole-pipeline spend accounting are later work.
Full-history evidence intentionally retains the original text, unlike the
core's redacted capture path. Only synthetic fixtures belong in this offline
demo. Before a real provider transport is connected, the operator must review
dataset privacy and permissions; this API does not authorize exporting private
conversations or bypassing the project's redaction rules.
