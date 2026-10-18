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
The expected excerpt follows the core's one canonical storage path: capture
normalizes and truncates the source view to complete code points, then admission
canonicalizes that bounded excerpt again. That second pass can trim whitespace
exposed at the 800-UTF-16-unit boundary. The comparison derives that one exact
stored form with the same two bounded operations; it does not accept a prefix,
substring, whitespace-insensitive match, or alternate normalization.
Selected answer evidence consists of whole memory receipt items; packing can
omit a whole item for context fit, never an individual receipt. Retrieval and
packing counts, omissions, retrieved and packed opaque session IDs, and
source-selection coverage are diagnostic only.
Capture is source-time-unaware: source dates are reattached from the prepared
history after source binding, not inferred by core.
This describes this historical comparator's existing entrypoint; the explicit
consumer below has a separate version and performs no history join.

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

## Explicit source-time answer consumer

`packSourceTimeAnswer` from `evaluation/longmemeval/source-time-answer.mjs`
returns `cairn-longmemeval-source-time-answer-v1`. It packages a request only:

```js
const packed = packSourceTimeAnswer({
  question: { text: 'When was travel discussed?', date: '2026-03-10' },
  namespace,
  recall: successfulSourceEvidenceRecall.value, // the value, not {ok,value}
  get: coldCore.get, // actual authoritative synchronous local core.get
  model: declaredModel,
  limits: { inputTokens: 7000, outputTokens: 512, contextTokens: 7512 },
  countTokens: trustedLocalSynchronousCounter,
});
// No provider call occurs. A future authorized caller would use packed.request.
```

There are exactly these seven input fields. No history, plan, source/origin map,
reference, gold ID or repair channel is accepted. Only current source-evidence
memories are accepted; historical assertions need a separate future applicability
consumer. The detached bounded JSON snapshot permits at most 12 memories,
100 complete receipts per memory, 800 UTF-16 excerpt units per receipt, canonical
128-unit optional source labels, a 4000-unit nonempty question and 128-unit
nonempty question date. Sparse data, accessors, cycles, explicit undefined labels
and oversized candidates fail; nothing is silently sliced. A generic 4 MiB,
60,000-node, depth14 snapshot ceiling also bounds accepted ancillary recall data.
These are accepted-data bounds, not isolation against arbitrary Proxy traps.

Before counting, the helper verifies each memory's ID/revision/currentness,
namespace, source-only markers and complete unique receipt set against an
exhausted local `get({namespace,memoryId,receiptLimit:100})`. Exact receipt ID,
role, excerpt and sourceTime presence/value must agree. Missing labels are never
enriched from canonical inspection, question date or another source. Failed,
stale, partial, foreign or malformed reads fail closed. The same verification
runs after all token-counter callbacks. This is packaging-time validation; it
does not grant an indefinite freshness lease or execution permission. `get` is
a trusted local core port, not a callback-based remote provenance authority.

The model-facing JSON is `{evidence,currentQuestion:{text,date}}`. Each receipt
is one tuple `{role,content:excerpt,sourceTime?}`. The helper preserves first-seen
order and deduplicates only identical role/content/optional-time tuples; different
dates, roles and absent versus present dates remain distinct. It never concatenates
cards, reconstructs turns, sorts dates or sends identities/date sidecars. The
new instruction retains evidence-only, untrusted-data and insufficient-evidence
rules and explains that sourceTime claims utterance time, without establishing
event time, applicability, chronology, ordering or authority.

The exact request is `{model,messages,temperature:0,max_tokens:outputTokens,n:1}`,
where messages contain that system instruction and one serialized user object.
The trusted local counter receives the complete `JSON.stringify(request)`,
including model, instructions, question, tuple framing and labels. Input tokens
must fit `inputTokens`; input plus reserved `outputTokens` must safely fit
`contextTokens`. Every limit is a positive safe integer. A whole tuple fits or
is omitted; smaller later tuples may fit. No metadata is stripped and no excerpt
is shortened. The empty question envelope must fit even when recall is empty.

The frozen result contains `request`, its exact `serializedRequest`, `inputTokens`,
`reservedOutputTokens`, `totalEstimatedTokens` and `included`, `duplicates`,
`omitted` diagnostics. Each diagnostic maps tuple/memory/receipt positions to
original IDs outside model evidence. A duplicate names its first tuple and its
`included` or `omitted` disposition, including when the first copy did not fit.
Omission does not claim the remaining tuples cover a complete memory or decision.

Counter throws, negative/noninteger/overflow results and thenables fail
synchronously with controlled errors; arbitrary thenables are never invoked.
Accidentally rejected native Promises are observed to prevent an unhandled
rejection, then refused. Asynchronous/provider counting, transport deadlines and
paid dispatch belong to a future guarded caller, not this helper. Resource
metadata is an estimate under the declared counter, not provider context-fit
proof, usage or an invoice. The demo's UTF-8 byte counter is synthetic.

Select the [new producer](longmemeval-ingestion.md#explicit-source-time-indexed-evidence-producer)
explicitly and run `npm run demo:longmemeval-source-time` for actual capture →
close → cold recall → measured request. This leaves existing comparators/scorers,
mixed helpers, historical wire goldens and defaults unchanged. There is no host,
provider transport or model-service integration, no new score, and no H6 replay.
