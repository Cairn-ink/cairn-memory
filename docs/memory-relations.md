# Memory threads

Capture links facts about the same topic within a namespace. Both facts and
their receipts remain stored. Relations are enabled by default; no read-side
model or opt-in setting is required.

Without a relation model, a conservative lexical rule emits only `same_thread`.
It checks the subject as well as the topic. This neutral label makes no claim
about agreement, negation, replacement or causation. Discovery retains the
lexical/vector union, capped at eight candidates per fact, and admission accepts
at most five outgoing edges. Uncertain matches are omitted.

When the extraction model supplies `relateMemories`, capture makes one relation
request per batch with eligible candidates. The model may label a pair `supersedes`, `contradicts`,
`refines` or `causes`, or leave it unrelated. A typed decision replaces a neutral
edge for that pair. An unrelated decision adds no edge. A failed, malformed or
timed-out request falls back to the neutral rule and never prevents admission.
Causal captures retain their high-water and receipt provenance. A relation
decision or installed relation layout preserves both Memory rows instead of
automatically retiring a predecessor. Without either, main's older `reconcile`
port remains reachable. Pending review transitions already stored by an earlier
engine remain resolvable.
Candidates and model results are untrusted data. Unknown IDs, duplicate decisions,
invalid labels or confidence values are discarded. Low-confidence supersession
is omitted. Provider diagnostics contain closed codes, never Memory text.

## Dates and delivery

Chronology comes from the source message's stored date, falling back to capture
time. The model cannot override it. Before the first edge, legacy layouts without a
source-date column keep main's stored receipt dates. A bounded volatile clock
hint retains recent source-message dates on the admitting connection and binds
them to receipts when the first edge installs the package. Reopening or evicting
that hint before the first edge falls back to main's stored capture date; no
extra date row or schema is persisted for an unrelated store. Ties use capture order. Currency follows
dates independently of the direction or type of an edge; a late capture of an
older message stays earlier. Attaching an older receipt to an exact-content
fact retains that fact's latest trusted support date.

A memory captured before the store's first link, and not an endpoint of that
link, keeps only its capture date. A backdated import can therefore order a
thread by capture time for those memories. Live captures are unaffected.

A default context read that selects any member resolves its connected thread.
It brings the current member and up to three earlier members, choosing the most
recent earlier members first. Four members leave room for the present value,
the preceding change and recent supporting context. All text, dates, labels,
reasons and sources count against the existing token and response-byte budgets.
The thread counts as one item for the item budget. The current member is packed
first under tight budgets. History delivery orders the selected members by date
and capture order. A thread is never coalesced into a single unlabeled Raw body.

Each delivered member has `metadata.thread`:

```js
{
  currentMemoryId: 'current-memory', currentRevision: 1,
  status: 'earlier', eventTime: '2025-01-01T00:00:00.000Z',
  relation: 'supersedes', direction: 'incoming',
  reason: 'The preference changed because of the cooking oil.'
}
```

The current member has `status: 'current'` and a null relation, direction and
reason. An earlier member without a direct typed edge to the current member has
`relation: 'same_thread'`; no transitive typed assertion is invented.
`metadata.relations` retains bounded direct edge labels, dates and known reasons.
`get().relations` and legacy recall relation labels remain additive and are absent
when empty. The compatibility source name `relations-one-hop-v1` remains accepted.

Every traversed endpoint passes the canonical content predicate in the authorized
read transaction. Forgotten, suppressed, excluded, denied or foreign memories
cannot enter the thread or its labels. Revision changes invalidate incident
edges. Durable Memory, receipt, namespace, owner and Raw suppression, and Raw
exclusion, remove incident edges, reasons and relation times for every memory
they make unreadable, in the same transaction. Forgetting the latest member
therefore restores the preceding eligible value. Temporary caller denial never edits another caller's graph.

The local traversal is bounded by the read deadline and a component ceiling.
An incomplete traversal does not assert a current member. Empty graphs use the
existing read path and exact epoch SQL while the layout is absent. Once installed,
an edge-presence bit rides an existing epoch statement,
without a new statement or wire annotation. Standalone facts keep their original
representation, including after deletion removes a thread's last edge.

## Model port

```js
relateMemories({ system, input, maxOutputTokens, signal })
// input:
{
  facts: [{ factIndex: 0, content: 'I stopped eating egg pancakes.',
    eventTime: '2025-03-01T00:00:00.000Z' }],
  candidates: [[{ id: 'older-memory', revision: 1,
    content: 'I like egg pancakes.', eventTime: '2025-01-01T00:00:00.000Z' }]]
}
// output:
{ facts: [{ factIndex: 0, eventTime: null, edges: [
  { candidateId: 'older-memory', relation: 'supersedes', confidence: 0.9,
    reason: 'The preference changed because of the cooking oil.' }
] }] }
```

The output `eventTime` field remains accepted for port compatibility and is
ignored. `reason` is optional for existing custom ports and bounded to 600
characters; the OpenAI adapter requests a string or null. Requests share the
existing model input/output and embedding budgets and reserve time for admission.

A model reason is retained only when the entire request contains exactly one
new fact and one candidate, the edge's two endpoints. Decisions from larger
batches keep their dated links and labels but discard all reason prose. This
avoids retaining text derived from a non-endpoint candidate; forgetting,
suppression and Raw exclusion remove endpoint edges, reasons and relation times.

## Layout and compatibility

The second relation package uses inherited physical layout plus 200 and
`relationsRevision: 2`. It expands the closed relation set with `same_thread`,
adds nullable `memory_relations.reason`, and constrains rule decisions to neutral
edges. The prior four-label package (inherited layout plus 100) upgrades lazily
on its first relation write in the admission transaction, retaining model/user edges and removing the obsolete rule
assertions. Its receipt bindings are retained and dates are rederived from those source
receipts, replacing dates previously supplied by a model.

Opening, creating, reading, forgetting, suppressing, maintaining and migrating
an unrelated store never installs this package. An unmanaged local store installs
it only after admission validates its first neutral or typed edge, in the same
transaction as the Memory and edge. Failed optional installation rolls back the
relation work and preserves ordinary admission. Timing-only decisions do not
install anything. Revision-one reads omit threads until the first write upgrades.

Managed stores (`existingStore`) and stores with a host-pinned `storeFence`
never install or upgrade relations implicitly.
The host must explicitly upgrade the layout while the store is quiescent and
reopen its connections before relation writes are enabled. The internal
`installMemoryRelations(db)` installer requires a caller-owned writer transaction;
it is not called by the managed opener.

The first committed, validated link triggers a one-way layout upgrade.
Set `memoryRelations: false` in `openMemoryCore` before the first edge to disable
relation discovery and new relation writes. This does not remove an installed
layout. A store that has only been opened by the new engine, without gaining any
relation, remains readable by main. After the first edge, older engines refuse
with `unsupported_database`; hosts can inspect `PRAGMA user_version` and resolve
the inherited-plus-package layout, or use the internal layout attestation's
`relationsRevision`. Rolling back the installer after the first link means
reinstalling the newer version to use that store; there is no downgrade conversion.

Legacy conflict rows migrate to user-decided contradiction edges and
`memory_conflicts` remains a compatibility view. Existing conflict hint limits
and projections remain supported. Endpoint foreign keys and revision guards
invalidate edges together with their memories. Existing base, safety and
attested-feature capabilities are preserved. Previous engines refuse the new
layout with `unsupported_database` before writing it.

The `index_memory_keyset` name and columns, `openDatabase` entry point, and
`raw-control-storage` exports are unchanged. No host configuration change is
required to receive threads. Hosts that enumerate relation labels or render
context metadata should accept the additive neutral label and thread annotation.

A committed lazy upgrade invalidates readers in the same JavaScript runtime.
An already-open plain legacy reader in another process or realm omits threads
until it closes and reopens after that upgrade; its original read path has no
schema polling statement.
Host-managed upgrades require quiescence and reopening of all connections.
