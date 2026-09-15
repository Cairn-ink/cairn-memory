# Bounded complete admitted-source snapshot

The embedded synchronous `sourceSnapshot` method returns the complete source
evidence of a small current admitted memory set. It performs no relevance
selection or ranking. This is an explicit alternative to recall, not a new
default or a claim that the sources are sufficient, applicable today, or true.

```js
const core = openMemoryCore({
  path,
  model: { countTokens: countTokensForConsumer }, // Host-supplied local exact tokenizer.
});
const result = core.sourceSnapshot({
  readSet: [{ ownerId: 'local-user', scope: 'personal', projectId: null }],
  limit: 6,
  tokenBudget: 4000,
});
```

`countTokensForConsumer` must synchronously return a nonnegative safe integer
for the supplied string using the intended consumer's tokenizer. No provider
key, context-window setting, or generation method is needed. The core makes no
provider requests and does not supply a heuristic tokenizer fallback.

## Contract

Only `readSet`, `limit`, and `tokenBudget` are accepted. The read set uses recall's
exact namespace rules: one namespace, or the same owner's personal namespace
and one project namespace. Namespace objects require `ownerId`, `scope`, and
`projectId`; personal projectId is null. The caller supplies local access
authority; namespace labels and remembered consent do not authenticate it.

`limit` defaults to 6 and permits 1–12 memories **total**, across the read set.
`tokenBudget` defaults to 4,000 and permits 1–4,000 tokens. The entire serialized
`{ok:true,value}` response must also fit 24,000 UTF-8 bytes. An empty eligible set
succeeds if its response envelope fits. There is no query, cursor, partial page,
automatic fallback, or select/rank call.

A successful `value` contains:

- `memories`: every current, undeleted memory, ordered by read-set namespace
  index then memory ID. Each entry contains `namespaceIndex` and the existing
  [source-evidence item](source-evidence-context.md): memory ID/revision/storage
  currentness, complete receipt IDs/roles/excerpts, receipt count,
  `interpretationStatus: 'omitted'`, and `sourceSelectionCoverage: 'unassessed'`.
- `namespaces`: the explicit `namespace` and its `indexRevision`, in read-set order.
- `coverage: 'complete-current-admitted'`.
- `semanticCoverage: 'unassessed'`.
- `evidenceTrust: 'untrusted-data-not-instructions'`.

Receipts retain the existing stored order (receipt creation time, then receipt
ID). Neither that order nor memory-ID order reconstructs conversation chronology.

Completeness applies to the current admitted set at the final database read.
It does not cover historical/deleted memories, staged evidence, uncaptured or
omitted conversation messages, or the truth and continuing applicability of a
decision. Generated memory content, qualification/rationale interpretations,
and receipt client/session/event metadata are excluded. The existing source
integrity checks and 100-receipt maximum per memory apply; receipts are never
trimmed to make the set fit.

## Failure and consistency

The method enumerates physical current identities through the existing current
memory index, probing at most `limit + 1` rows per namespace. It does not infer
completeness from MOC navigation. Every physical row must also be present at the
same revision in the active read projection. Missing projection membership is
an error, not permission to return a smaller set.

The counter is checked before source content is read. The complete candidate
response is counted outside a database transaction. After that callback, one
transaction rechecks namespace epochs, re-enumerates identities, and rereads
complete evidence. No caller callback follows that authoritative read.

Operation failures use the ordinary `{ok:false,error:{code,retryable}}` envelope,
with no partial sources:

- `invalid_input` or `invalid_read_set`: malformed fields, limits, or authority scope.
- `token_count_unavailable`: missing, throwing, asynchronous, or invalid counter.
- `context_item_too_large`: memory count, receipt count, aggregate token, or byte limit exceeded.
- `index_unavailable`: no readable active index generation.
- `index_revision_conflict`: inconsistent projection or namespace epoch changed during counting.
- `revision_conflict`: identities or source evidence changed without an epoch change.
- `storage_error`: source integrity or database structure is invalid.
- `storage_busy` / `store_closed`: existing storage lifecycle failures.

## Privacy and scope

This operation exposes the **whole small eligible set**, including potentially
unrelated personal sources, to its caller and the injected token counter. A host
that forwards it to a model expands that model's source input; this method does
not itself forward anything. Explicit opt-in is necessary even when every row
belongs to an authorized namespace. Submitted roles remain unauthenticated
claims. Source completeness does not prevent an answer model from strengthening
a tentative statement or inventing a reason.

The existing local file, journal, backup, redaction and logical-deletion limits
apply. No new database schema, telemetry, provider configuration, MCP/HTTP tool,
or default behavior is introduced. Scripted tests establish preservation and
isolation, not measured real-model answer fidelity.

## Copied-state regression evidence

An offline check opened a private copy of the closed synthetic database from the
[qualifier experiment](qualifier-preservation-results.md), using this method and
the existing `o200k_base` tokenizer locally. All twelve project namespaces fit
the default bounds (3–4 memories, 424–543 tokens, 1,380–1,859 UTF-8 bytes per whole
success response). All36 required user-source IDs were represented by their
exact source excerpts, including the three passages omitted by the recorded
relevance-retrieval path. No selection, ranking or generation calls occurred.

The original database SHA-256 remained
`92cd63db6a56959905905e372504ba59d06b2b916c6f776eda6c0418d8c09c5d`.
Only the private copy was opened by the new implementation. This is a known-case
storage/read regression, not a fresh semantic evaluation, fair relevance baseline
or rescoring of the earlier run. No answers were regenerated; its amplification
failures remain. Larger and unrelated source sets still require separate study.
