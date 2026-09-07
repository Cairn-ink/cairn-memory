# Capture preview

`openMemoryCore({ path, model }).capture(input)` composes the existing admission
and MOC runtime. It is a JavaScript source API, not an MCP server or passive hook.
Run `npm run demo:capture` on Node >=22.16 for an offline synthetic example.

Input is exactly `{ namespace, client, eventId, sessionId, messages }`. The trusted
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

Pending replay returns `{processing:true}`. Completed replay returns
`{duplicate:true,memoryIds,suppressedCount}`, even without a model/counter. IDs
may refer to subsequently forgotten records but expose no forgotten content.
A changed digest on the same event returns `event_payload_conflict`.

No real provider, tokenizer, automatic host integration or semantic-quality claim
is bundled. Scripted tests prove boundary/lifecycle behavior only. Storage and
receipt retention follow [the local store limits](local-store.md).
