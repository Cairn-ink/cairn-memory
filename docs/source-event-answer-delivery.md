# Evaluation-only source-event answer delivery

[`prepareSourceEventAnswer`](../evaluation/live/source-event-answer-delivery.mjs)
and `deliverSourceEventAnswer` receive one unmodified successful local MCP
`recall_memory` result. The caller must request all three options explicitly:

```json
{"query":"Why did we choose A?","contextMode":"rationale-neighborhood-evidence","sourceProjection":"neighborhood-source-events-v1","rankingMode":"source-evidence-first-v1","limit":6}
```

Pass that SDK tool result as `toolResult`, the same question, and the matching
`requestedContextMode`, `requestedSourceProjection` and `requestedRankingMode`
values. The helper does not call MCP, inspect storage, discover a credential or
create a provider transport. `deliverSourceEventAnswer` additionally needs an
already-authorized, injected `complete(body)` callback; no callback is made
for invalid source input, and there is no retry. A paid callback would still
need a separate guarded budget, timeout and evidence-retention workflow. This
evaluation helper grants none of those.

The consumer requires the exact successful envelope and event DTO, one
complete namespace traversal, explicit untrusted/unassessed markers, at most
six event groups and 36 distinct associations. Every event keeps its returned
order, original retained excerpt, submitted role, collision flag and complete
memory/revision/currentness/receipt bindings. Equal text does not merge groups;
no representative memory or inferred event ID is made. Reused receipt IDs,
conflicting memory versions, extra fields, partial evidence and overflow fail
whole. `currentness: "current"` is required because this SEP path reads current
stored cards; a historical statement in an original excerpt is still allowed.
Stored currentness is not a claim about what is true or effective today.

Only `{question, sourceEvents}` enters the user message. The existing
source-answer model and system instruction are reused verbatim; no namespace,
raw client/session/event identifiers, graph proposals or stored interpretations
enter the request. The request remains one nonstreaming, no-store completion,
without tools, with a 1,024-token output cap and 24,000-UTF-8-byte serialized
body cap. Tool text is bounded at 262,144 bytes, the complete value at 24,000
bytes, questions at 4,000 UTF-16 units, and excerpts at 800 units. Secrets and
malformed Unicode reject rather than being redacted or truncated. Empty complete
`sourceEvents: []` is explicit ignorance, not an infrastructure failure.

Outcomes are `invalid-source` (zero completions), `completion-failed` (one
attempt, no retry), `invalid-output` (one attempt, malformed completion retained)
and `generated-unassessed` (structurally completed plain text). The last status
does not validate citations, entailment, source relevance, submitted identity
or answer quality. Complete coverage means the bounded map/fetch traversal
finished, not that all relevant history was found. Returned answer text remains
private, untrusted model output and is not publication-safe.

The ordinary offline test covers DTO and body bounds without SQLite. The
installed-artifact test is included in `npm run test:artifact`: it performs a
fresh synthetic SQLite admission, actual installed MCP stdio recall, consumer
delivery into a fake completion, and before/after store comparison. It makes
no provider request or semantic-quality score. External answer hosts are not
automatically adapted; this is a receiving-boundary experiment only.
