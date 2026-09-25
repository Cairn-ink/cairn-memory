# Capture preview

`openMemoryCore({ path, model }).capture(input)` composes the existing admission
and MOC runtime. It is a JavaScript source API, not an MCP server or passive hook.
Run `npm run demo:capture` on Node >=22.16 for an offline synthetic example.

Input is `{ namespace, client, eventId, sessionId, messages, causal? }`. The trusted
host supplies the exact namespace; each message is `{ id, role, content }`, with
role `user` or `assistant`. IDs are nonempty opaque identifiers up to 200 units.
Supply 1–24 uniquely identified messages, each at most 4,000 normalized UTF-16
units, totaling at most 20,000. Invalid input is rejected before claiming work.
Redaction and normalization precede hashing and model calls. The digest binds
namespace, event/session/client and ordered message IDs, roles and full content.

The injected model must provide `extract({system,input,maxOutputTokens,signal})`,
`countTokens` and context capacity, using the same bounded-call contract as
[classification](moc-placement.md). Extractor input contains only indexed roles
and normalized content, never trusted identity fields. Output is exactly:

```js
{ items: [{ content: 'Prefer diagrams.', kind: 'preference', confidence: 0.9,
  sourceIndices: [0] }] }
```

Zero to five items are allowed; content is at most 600 units. Each item selects
one to four unique valid message indices. Kinds are fact, preference, decision,
instruction or context; confidence is finite from zero to one. Unknown fields,
including invented receipts, namespace or conflict hints, reject the whole batch.
Core constructs receipt identity and excerpts from the trusted messages; excerpts
are redacted and truncated to 800 units without splitting Unicode code points.
Indices establish provenance binding, not proof that a model's claim is true.

The model budget is at most 6,000 input and 1,024 output tokens, a 1,024-token
reserve, minimum 8,192-token context and a 30-second abort deadline per call.
Fresh work claims a fixed 125-second lease. Extraction and token counting happen
outside write transactions. Failure attempts fenced abandonment for safe retry;
an expired worker cannot commit or release its successor's lease.

Trusted embedded callers may opt in with
`openMemoryCore({ path, model, captureDeadlineMs: 120000 })`. The setting is
snapshotted at construction, accepts an integer from 1 through 120000, and is
not a capture-message field. The local MCP host now accepts the same trusted
constructor setting or `--capture-deadline-ms` with an explicitly enabled v1/v2
capture qualification mode. Omission retains the existing behavior. The native
Hermes provider separately accepts a canonical decimal string
`capture_deadline_ms` of 1–110000 only with v2 capture and forwards the fixed
CLI flag; its ordinary transport limits do not change.
Each capture then has one monotonic budget starting before input normalization
and spanning extraction, optional qualification/reconciliation, admission,
initial classification and automatic rationale. Every model call still has its
own 30-second ceiling; the smaller remaining limit applies. Deadline checks
before capture-owned transaction commits roll back late admission, placement or
rationale writes. This is cooperative for synchronous token counting and SQLite,
not a hard wall-clock response guarantee. Failure cleanup may run after expiry.
Before admission, expiry returns `model_timeout`; after admission, committed
receipts stay committed and classification or rationale reports failure honestly.
No automatic retry, new provider allowance, or host default is implied.
The native Hermes provider can independently enable admission inspection and
explicit classification recovery through `classification_recovery: guarded-v1`.
Its keyless inspection and model-backed placement retain the installed MCP
schemas and revision guards. See the [native setup guide](../integrations/hermes/cairn/README.md).

Successful new capture returns `{ duplicate: false, admission, classification }`.
Admission contains `{ memories: [{id,revision}], suppressedCount,indexRevision }`.
Classification is one of:

- `{status:'skipped',reason:'empty'|'already_filed'}`;
- `{status:'applied',memoryRevisions:[{memoryId,revision}],indexRevision}`;
- `{status:'failed',error:{code,retryable}}`.

Admission commits before classification. Classification failure does not erase
accepted memories; they remain inspectable. Applied revisions are the actual
post-filing revisions, not the earlier admission snapshot. Concurrent correction
or forgetting rejects stale filing. Retry classification explicitly from fresh
state; capture replay does not rerun extraction or classification.

New captures also commit a bounded, source-free **initial classification
attempt** journal with their admission. Its status is `not_started` before
model work, `in_flight_or_interrupted` while work is outstanding, then
`applied`, `skipped_already_filed` or `failed`; empty admission records
`skipped_empty`. A crash can leave the in-flight status indefinitely. The
`applied` status is committed with placement, including a valid no-op with no
parent, so it does not mean every member is filed or the model was correct.
The journal is visible only through opt-in
[admission inspection](admission-claims.md#read-committed-admission-membership).
It does not retry capture or provide a classification task queue. Manual and
pre-v14 admission claims have no recorded initial attempt.

Pending replay returns `{processing:true}`. Completed replay returns
`{duplicate:true,memoryIds,suppressedCount}`, even without a model/counter. IDs
may refer to subsequently forgotten records but expose no forgotten content.
A changed digest on the same event returns `event_payload_conflict`.

An optional [OpenAI adapter](openai-provider.md) supplies a real provider and
tokenizer. No automatic host integration or semantic-quality claim is bundled.
Scripted tests prove boundary/lifecycle behavior only. Storage and
receipt retention follow [the local store limits](local-store.md).

## Opt-in automatic source qualification

Construct `openMemoryCore({ path, model, captureQualification: 'source-bound-v1' })`
to qualify newly extracted memories with the v1 model contract. The separate
`source-bound-v2` mode is described below. Absence preserves legacy behavior;
explicit undefined, null and unsupported values reject before opening storage. The setting is
snapshotted, not read from caller configuration again during capture. It is not
a new MCP, HTTP or capture input field. Legacy mode is explicitly unprotected
against semantic errors in automatic retirement.

For nonempty extraction, call `model.qualify` once before admission, under the
same 6000-input/1024-output token ceilings and 30-second deadline. The input is
`{items:[{itemIndex,content,kind,sources:[{receiptIndex,role,excerpt}]}]}`; receipt
indices are local to each item, regardless of original message index order.
Only exact canonical/redacted receipt excerpts (at most 800 UTF-16 units) reach
this stage, not full messages or namespace/client/session/event identifiers.
The adapter's qualifier uses its pinned baseline model independently of the
extraction profile. No additional paid-guard method is enabled by this feature.

Output is exactly `{qualifications:[{itemIndex,qualification}]}` with every item
represented once. Each nonnull qualification follows [the S1 contract](claim-qualification.md).
Unknown/null descriptions are allowed; schema validity and exact source anchors
do not establish truth, identity, adoption, atomicity or execution permission.
Model descriptions remain unverified interpretations. Evidence past the stored
800-unit excerpt cannot support an anchor, even if extraction saw it. There is
no quote relocation, larger transcript retention or trusted single-claim binding.

Invalid metadata, malformed Unicode, a missing qualifier, timeout or token
overflow fails explicitly; there is no silent unqualified fallback. Validation
of all items precedes their shared atomic admission. Existing unqualified
duplicates are not backfilled: qualification mismatch fails
`qualification_conflict`. Suppression retains the existing forgotten-content
protection. Empty extraction and completed replay make no qualifier call.
The 125-second admission lease is unchanged; extract and qualify are at most
two precommit model deadlines. Classification still occurs after admission.

The mode participates in a versioned payload digest. Reusing an event under
another mode fails `event_payload_conflict`, rather than claiming that a legacy
event was qualified. Legacy-mode digest bytes remain unchanged. In enabled
ordered capture, every nonempty extraction durably returns reconciliation
`{status:'unresolved',reason:'qualification_requires_identity',retiredCount:0}`,
including dedup/suppression outcomes. The legacy reconcile model is not called,
no slots are bound, and no old memories retire. Empty extraction uses the
existing no-change outcome. Replay retains the recorded outcome.

### Core-owned evidence candidates (v2)

`captureQualification: 'source-bound-v2'` uses `model.qualifyCandidates` instead
of `model.qualify`. The v1 model API, stored S1 qualification DTO and default
capture behavior are unchanged. The local MCP server also accepts this explicit
mode; its paid method remains denied by default. Maintainer experiments require
the separately authorized candidate-qualification guard, not a v1 grant.

V2 extraction now sees exactly the canonical receipt prefix that can be retained:
at most 800 UTF-16 units per normalized/redacted submitted message, without split
code points. The same detached view constructs selected receipts. Full normalized
messages remain in the event digest, so changing an omitted tail still conflicts
with an existing event. Legacy and v1 retain their prior extraction inputs.
V2 source-selection guidance asks for antecedent and response receipts together
when a standalone paraphrase expands pronouns; it cannot guarantee entailment or
repair an omitted citation. More than four necessary messages requires narrowing
to a supported claim or omitting it, not adding guessed neighbors.

Successful v2 capture, including empty, processing and duplicate outcomes, adds
`retainedSourceWindow:{maxUnitsPerMessage:800,truncatedMessageIndices:[...]}`.
Indices refer to normalized submitted messages whose retained prefix omits text.
This is retention coverage, not whole-conversation or semantic coverage. It is
computed from the submitted snapshot and does not attest execution history:
older v2 duplicate events may have been extracted from longer inputs. No replay
reprocesses them. Failed captures retain existing finite error envelopes.
Facts appearing only beyond a retained prefix cannot be extracted in this mode;
larger receipts or alternative source windows require a separate design.

Core partitions every retained canonical receipt into nonoverlapping windows
of at most 200 UTF-16 units, without splitting Unicode code points or dropping
text. Model input is `{items:[{itemIndex,content,kind,candidates:[{candidateIndex,
role,text}]}]}`. Candidate indices are unique across that batch, not persistent
identities. Trusted receipt identifiers and character offsets are not model input.
Before windowing, v2 applies admission's final receipt canonicalization, including
trimming whitespace left at a truncation boundary, so anchors describe exactly
the stored excerpt. This does not repair or relocate a model-supplied quote.

Output is `{qualifications:[{itemIndex,subject,property,scope,applies,value,
attribution,commitment}]}`. Each named field is `{value,evidenceIndices}`: a
descriptive nullable label or existing attribution/commitment enum, plus zero
to four distinct references from that item's candidates. Known values require
evidence. Unknown values may cite context, and even all-unknown output must
explicitly select at least one candidate overall. Four distinct candidates per
qualification is the maximum; additional evidence rejects rather than being lost.

The v2 interpretation prompt evaluates descriptors independently: unknown
commitment does not require dropping a supported subject, attribute or condition.
Its scoped coffee example is illustrative, never reusable evidence. It
distinguishes offered proposals from direct assertions and settled choices from
consideration, rejection or unknown commitment. Firsthand observation of an
assistant's suggestion does not establish user adoption. Conditions, temporary
exceptions and uncertainty must remain visible; unsupported fields stay unknown.
These are model instructions, not an entailment checker or a measured quality
result. Nested speech can remain ambiguous under the existing attribution enum.

V2 compiles the five descriptive labels (subject/property/scope/applies/value)
with NFKC normalization before strict S1 validation. Null is preserved; raw and
normalized text must fit the existing 160/120 UTF-16 bounds. This does not trim,
collapse whitespace, redact, truncate, replace enums or add missing evidence.
Invalid Unicode, secret-like/noncanonical labels, unsupported values and
normalization expansion beyond limits still reject atomically. Model responses
remain raw in experiment evidence; sources and anchor bytes are never altered
by label normalization. NFKC can fold compatibility styles, not prove meaning
or shared slot identity. Manual S1 and v1 remain strictly canonical-input APIs.

Core builds exact offsets/text and derives each anchor's field coverage from
those selections, then applies the unchanged S1 validator. The model does not
calculate character positions, copy quotes, or maintain a separate coverage list.
Missing/foreign references, unsupported values or incomplete batches fail
atomically; there is no v1 repair, fallback citation or guessed evidence.

The same input/output/time bounds apply. Windows can split a phrase and complex
batches may exceed the input budget; neither is hidden by dropping evidence or
increasing provider limits. Multiple selected windows can support one field.
Precise evidence attachment does not prove correct interpretation, shared slot
identity, adoption or currentness. Both qualified modes keep ordered retirement
unresolved until trusted identity is separately established.

This slice produces inspectable provenance, not completed automatic updating.
Independent subject/slot identity, atomicity, adoption, premise tracking and
positive semantic update validation remain required before that claim is valid.

## Opt-in source-ordered reconciliation

For source-qualified capture, see the separate constructor mode below. It skips
the legacy reconciliation judgment and does not automatically retire memories.

The local JavaScript API accepts `causal: {streamId, sequence}`. This does not
change the HTTP/plugin/MCP schemas. Without it, capture keeps the existing
digest, output and model-call sequence; it does not retire changing facts.

The trusted source application must durably allocate positive safe-integer
sequence numbers in actual source order, serialize captures in that stream, and
reuse the same event, sequence and payload on retries. `streamId` is an opaque
identifier up to 200 units, scoped to the exact namespace and client. Different
streams are incomparable. Start a new stream if allocation state is lost; do
not manufacture chronology from delivery time or model judgment. This is a
caller contract, not authenticated proof of ordering. Gaps are allowed, but an
older unseen window cannot later be ingested as current.

After bounded extraction, the core may call `model.reconcile` once to judge
whether current user evidence explicitly replaces an earlier claim about the
same subject/property/scope. Only agent-inferred candidates whose complete
receipts belong to the same earlier stream are eligible. Explicit, unordered,
mixed-stream or oversized sources remain unresolved. Discovery reads at most
13 current namespace memories and five receipts each; accepted ceilings are
12 memories and four receipts. Overflow does not silently claim completeness.

The model sees indexed text, roles and candidate excerpts, not persisted IDs,
namespace, event or stream identifiers. It returns bounded predecessor,
replacement and evidence indices. The core verifies source bindings and commits
admission, historical retirement, replay status and stream progress atomically,
guarded by the claim lease, namespace revision and ordering snapshot. Model
judgment is outside the transaction. Classification remains a later operation.
No replacement is promoted to explicit authority. Existing receipts cannot be
relabelled with a new causal position to make them eligible.

### Experimental model-port output migration

Every nonempty `model.reconcile` entry now requires a qualified verdict:

```js
{ transitions: [{
  replacementIndex: 0, predecessorIndex: 0, evidenceIndices: [0],
  relation: 'supersedes', // or reaffirms, historical_context, compatible, unresolved
  valueChange: 'changed', // or unchanged, unknown
  adoption: 'explicit' // or not_adopted, uncertain
}] }
```

Only `supersedes` with `changed` and `explicit`, bound to a user source, can
retire. Contradictory supersession labels reject the entire judgment. All
entries, including nonretiring ones, must have valid unique item-bound evidence;
assistant evidence is allowed only for nonretiring verdicts. At most five
entries and one per predecessor are accepted; omitted predecessors are untouched,
not proven compatible. Consider all supplied evidence before choosing a verdict.

Custom injected models must migrate nonempty outputs; old bare index tuples fail
with `invalid_model_output` and commit no admission. `{transitions: []}` remains
valid. There is no fallback or additional model call. Input shape, database
format, hosted wire schemas and completed-event replay results do not change.

Nonretiring labels are currently ephemeral: they prevent retirement but are not
stored conflict/rationale links or new recall qualifications. Paraphrased
reaffirmations may still admit separate records; exact-content deduplication is
unchanged. `complete_no_change` means no retirement in this bounded pass, even
when a model reports an unresolved semantic conflict. The three labels are one
model's judgments, not independent proof. Correlated errors can still cause an
unjustified retirement. Temporary exceptions, report-correction narratives,
qualified extraction and historical/rationale QA remain later work. See
[qualified reconciliation acceptance](plans/qualified-reconciliation.md).

Successful ordered capture and completed replay additionally return:

```js
reconciliation: {
  status: 'applied' | 'complete_no_change' | 'unresolved',
  reason: null | 'candidate_limit' | 'unordered_sources' | 'context_budget',
  retiredCount: 0 // 0–5; positive only for applied
}
```

`complete_no_change` describes this bounded pass, not global semantic truth.
`unresolved` admits the extracted items without retiring predecessors and keeps
its reason for replay. Context overflow is unresolved; a missing required port,
malformed output, cancellation or provider failure commits no admission.
An empty successful extraction still advances stream progress. A new event at
a reused position or at/below completed progress returns `capture_order_conflict`
before extraction. Identical completed events replay even after later progress;
changing an event's payload or causal fields returns `event_payload_conflict`.

Schema v9 stores opaque event/stream bindings, sequence numbers, receipt
provenance and content-free reconciliation status locally. These metadata can
reveal event linkage to database readers; never put secrets in identifiers.
They do not duplicate transcript text or prove the model's semantics. See
[historical retention](supersession.md) and the frozen
[acceptance boundary](plans/ordered-capture.md). Real-model cross-window quality
and installed-host acceptance remain separate gates; the original failed audit
is retained unchanged.
