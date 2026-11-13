# Engine Cards

A Memory is an atomic claim with an event time. An engine Card consolidates the
current state and history of one topic. It is derived, untrusted recollection,
never an additional fact or execution permission.

Generation is available by default when the model implements `consolidate`.
There is no authoring confirmation or generation toggle. Capture never builds a
Card. The existing MCP maintenance loop calls `maintainCards`; embedded hosts can
call the same method in their maintenance worker. `getEngineCardStatus` reports
the last bounded pass. These methods are present only when the model implements
`consolidate`; ordinary handles retain their established method surface.
Writable pinned stores reuse installed Card tables without upgrading their schema.

## Trigger

Each pass scans one exact namespace, up to 512 memories. Incomplete scans resume
on later passes, restarting when the namespace epoch changes. The scan retains
at most 4,096 memories / 8 MiB across passes and publishes no partial cluster.
Filed memories cluster
by MOC L1 membership. Unfiled memories cluster against a seed by cosine similarity
of at least 0.65 when both retained vectors exist, otherwise positive BM25 term
overlap. Configured context readers reuse their retained vectors without making
an embedding call for clustering.

A cluster needs both recurrence and budget pressure. Recurrence means at least
8 memories, 3 conversations and 14 days, or a chain of at least 3 supersedes or
contradicts edges on one slot. Pressure means at least 5 memories or 1,200 tokens
of packed Memory/receipt text, including framing and metadata, measured with the
configured tokenizer and existing packer. These thresholds
correspond to the product's 12 item / 3,000 token pack. There is no sliding time
window or importance sum.

Receipt event dates take precedence; legacy memories without those dates use
their recorded creation date. This fallback is an arrival date, not a recovered
event instant. Conversation identity comes from linked Raw when available,
otherwise the receipt's client and session identity.

## Ports and budgets

`consolidate({system, input: {memories, rawSpans}, maxOutputTokens, signal})`
uses the ordinary model port. A memory contains `id`, `revision`, `content`,
`date` and `currentness`. Optional readable Raw spans contain `memoryId`, `date`
and `text`; each is at most 400 units, with at most 8,000 units per request.
When available, an additional `relations` array supplies up to 192 same-topic
edges; `supersedes` points from a newer claim to an older claim.
Unreadable spans are omitted. A missing or denied source cannot authorize a
Card even when an optional Raw read fails.

The output has three arrays: `currentState` and `contradictions` contain
`{text, memoryIds}`, and `timeline` contains `{date, text, memoryIds}`.
Each entry is a single sentence. Current state renders as one paragraph, followed
by the dated timeline and unresolved contradictions. The engine drops uncited
sentences, rejects foreign IDs and malformed output, and requires a supported
current-state sentence. The rendered body, including citation tags, is at most
250 tokens. Timeline dates must agree with a cited source. Model text is inert.

The OpenAI adapter uses a closed structured-output schema with source-ID enums.
Each pass makes at most one generation, through the existing 6,000 input / 1,024
provider output envelope and model deadline. The tighter Card body limit is
post-validated. The local guarded model charges the existing runtime budget for
consolidation and stops on refusal. Memory text is never truncated to fit a
request. Oversized clusters return `source_limit` or `input_budget` for later
maintenance; they do not publish a partial Card.
Before dispatch, the existing Card operation ledger reserves the exact source
ID/revision fingerprint. Refusal or invalid output is terminal for that
fingerprint, including after restart or a cluster label change. Explicit transient failures (timeout,
network, rate limit or deadline) allow at most three attempts, with ten then
twenty minutes of backoff. A reservation interrupted before its outcome is
recorded consumes the same bounded allowance. Changed sources enable a fresh
attempt; periodic maintenance alone never resets an exhausted fingerprint.
A successful outcome blocks duplicate work while a current Card for that exact
fingerprint exists, even under another topic key. If the Card is missing or no
longer eligible, maintenance can rebuild it once. Publishing no Card ends that
attempt without opening a retry loop; refusal still blocks unchanged sources.

Attempt and outcome rows retain source IDs/revisions and a keyed source-set
fingerprint, without source text. Forget removes both kinds of row for every
affected source set inside the Memory's forget transaction. Namespace purge and
owner erasure remove their bookkeeping in the suppression transaction. Outcome
settlement requires the original reservation to still exist, so a worker awaiting
a model response cannot recreate bookkeeping after forget or erasure commits.

Older rows lack complete source lists. Maintenance conservatively removes those
opaque reservations and outcomes, including terminal outcomes, because their
independence from an earlier forgotten source cannot be established. At the start
of each namespace scan, maintenance inspects at most 64 ledger headers and up to
96 source IDs per matching row. A
namespace checkpoint stores only a rowid watermark and commits with the deletes;
reopening resumes it, and reaching the end restarts the scan. Other namespaces'
payloads are not loaded or changed. This uses the existing layout and makes no
model or embedding requests. Erasure also removes the namespace's checkpoint.
Forget also removes the title and body of every engine Card bound to that
Memory before the forget transaction commits, including stale Cards and older
rows kept by rebuilds. It uses the ordinary Card purge path: the row becomes
deleted, its revision advances, and its live source bindings are removed.
Raw conversation deletion and episode forgetting run the same purge for each
Memory their cascade terminally forgets. In a mixed cascade, terminal forgets
run before receipt removal from surviving Memories: a shared engine Card is
purged and unbound first, while other engine Cards of a surviving Memory are
staled by its revision change, including Cards bound through a retained receipt
from another conversation. Earlier sealed-store validation could roll back that
deletion; it now accepts the trigger's exact invalidation steps while keeping
the stale text unavailable to reads. This changes the order of Memory and Card effects
in that mixed case; returned counts stay the same and Raw effects retain plan
order. Suppression facts are also written in forget-first order. A pending review
conflict or held transition linking the forgotten and surviving Memories is
dropped with reason `forgotten`; previously it was `stale_evidence` when the
surviving Memory sorted first. Episode forgetting without Raw roots still terminally forgets every linked
Memory.
A user can also delete an engine Card with `deleteKnowledgeCard`, which erases
its title and body on both sealed and unsealed stores.
Review rejection also uses that Memory
forget path. On sealed stores, the Card transition requires a terminal Memory
fact of the same action, its removed binding, the canonical engine receipt,
the same namespace, exactly one revision and deletion effect, null text, and
unchanged seals and other columns. A public operation name supplies no authority.
Namespace purge and owner erasure do the same for all their engine Cards in
the suppression transaction. If the Card purge writer is unavailable while Card
tables exist, erasure refuses and rolls back instead of writing a suppression
fact without purging. Authored Cards keep their existing behavior.
Card identities, routing metadata, keyed digests and sealed lineage records
without text remain as provenance. Attempt and outcome bookkeeping disappears
at once with the text. Forget makes no model or embedding request. Later
maintenance can build a fresh Card from the topic's remaining eligible Memories
after the existing ten-minute debounce. The deleted row's text-free routing
receipt preserves the topic key and recent change time; forget cannot trigger
an immediate model request.

An optional `cardRelations.read({namespace, memoryIds, memories, signal})` port
returns `{from, to, kind, slot}` edges. Only endpoints in the cluster and equal
slot identities count. Without an explicit port, the canonical storage adapter
reads `memory_relations` when installed, joining current qualification slots and
endpoint revisions. With no table, chain recurrence is unavailable.

An optional `cardVectors.read` port takes the same request and returns
`{memoryId, revision, vector}` rows. Only exact source revisions are accepted.
The context reader supplies this port automatically for its retained embeddings.

## Lineage and reads

Engine Cards use `private_cards`, canonical receipt bindings, Card epochs and
the operation ledger. Ordinary opening and admission retain the existing layout.
A triggered maintenance attempt installs the existing Card layout on an unmanaged
schema18/20/21 store; empty or ineligible workloads keep their layout. Schema22
maintenance returns `unsupported_store` without calling the model or writing a
Card: its evidence tables predate the schema23 layout required by Card readers.
A managed or fenced store must already support Cards. On stores with sealed Card lineage, the same body/source
seal includes every source Memory revision and its receipt/Raw ancestry.
Historical Memory values can support the timeline while their exact cited
revisions remain unchanged. Engine metadata lives in a `consolidate` operation,
with `origin: 'engine'`, `builtAt`, `clusterKey` and `sourceRevisions`.

When an eligible topic changes key, its current Card follows the complete,
exact set of source IDs and revisions if every source and the Card remain
eligible and the destination has no current Card. Maintenance tries every
eligible destination with that exact source set until one carry succeeds; an
occupied first destination does not hide a later free destination. This also
applies when the old topic remains eligible with a different set of Memories. Carrying changes
only the routing metadata: the Card keeps its ID, body, source bindings, lineage,
revisions and build time, without a model request. A different source set or an
ineligible Card requires the normal trigger and rebuild path; an occupied
destination keeps its own Card. Eligibility and destination occupancy are checked
again inside the carry transaction.

Maintenance walks confirmed engine Cards in pages of 128 by ID, including stale
Cards awaiting rebuild or retirement. Deleted rows occupy none of those pages.
Carry, retirement and rebuild routing inspect every live page within the pass's
existing deadline; there is no total 129-row history cutoff. Source scan limits,
per-source dependency limits and the one-generation-per-pass limit still apply.

When a bound Memory's revision changes, the existing trigger advances the Card
revision once and records one `evidence_invalidated` effect for that Memory.
Ordinary admission or capture of another receipt, causal supersession,
confirmation, filing or re-filing, remember metadata updates and correction can
therefore stale an engine Card without failing the Memory write, including on
stores with sealed lineage. Each update to a bound Memory's revision produces
one consecutive Card step, including repeated updates to the same Memory within
one transaction. The Card keeps its state, title, body, bindings and seals; the
write verifier accepts only those trigger steps, proven
by the same transaction's scoped Memory revisions and unchanged bindings.
This grants no authority to edit, delete, re-bind or re-state an engine Card.
Terminal forgetting still purges the Card first as described above.

Such a Card has status `stale` and is refused by both current and history reads.
Candidate and context reads skip it and continue serving eligible Memories;
direct Card lookup returns no Card, and an explicit fetch of its stale evidence
refuses. The surrounding candidate read remains successful. Suppressed,
excluded, forgotten, denied or foreign sources also make the Card ineligible.
Card candidate scans also skip an engine Card whose revision is current when
the canonical source check denies it. Memory source checks still apply, including
to Memories that share an excluded Raw span.
Each later write to a bound Memory restarts the ten-minute wait before a worker
pass rebuilds or retires the Card. After that wait, a later pass re-evaluates the
trigger. A rebuild inserts a fresh Card row and source set, purging all superseded engine
payloads for the same namespace and cluster key in the same transaction. Their
titles and bodies become NULL and live bindings disappear; text-free rows,
routing receipts and seals remain. Other cluster keys and authored Cards are
untouched. Carrying a Card to a new key retains its existing body and identity.
Forgetting a bound source purges text from both rows immediately as described
above; stale status alone does not erase text. Correction and partial Raw receipt
removal retain the stale Card's title and body at rest until rebuild or retirement,
even when correction replaces the old Memory content. Both current and history
reads withhold that stale body. These remain source invalidations; only terminal
Memory forgetting performs the immediate purge described above.
If the trigger no longer holds, maintenance deletes the stale Card body while
retaining its row and lineage records. The pass's `deleted` count includes only
deletions performed by that pass, excluding rows already purged by forget or
an earlier rebuild. Retirement also leaves a text-free routing tombstone that
holds a re-emerging topic for the same ten-minute debounce. Current/history
candidate and context reads skip purged Cards and can return the remaining Memories. Explicit fetches of erased Card
evidence still refuse; old snapshots still fail their freshness fences.

Maintenance rechecks the committed Card and each listed source revision before
acknowledging a build. If a source becomes ineligible between commit and worker
delivery, a committed Card can yield an empty `built` array with `state: 'refused'`
and `reason: 'source_unavailable'`; its committed provenance remains recorded.
The outermost engine-owned public method repeats the same `engineCards.deliver`
projection on both legacy and suppression-enabled stores. The contract, Raw
facade, unsupported-Raw fallback and context-read composition all use the shared
`withEngineCardDelivery` finalizer, retaining the same projection through method
identity. Each finalizer awaits the entire wrapped method, including its promise
failure reactions and synchronous composition work such as reopening context
capabilities. It then projects synchronously and returns: no await, promise
reaction or asynchronous engine work follows that final projection before the
public promise resolves. A projection exception returns an error result with no
partial acknowledgement. A source forgotten after the worker returns therefore
also produces an empty `built` with `refused` / `source_unavailable`, without
returning its ID or revision. New engine compositions that wrap this method must
finalize their completed handle with the same helper.

This guarantee ends when the engine resolves its public method. A host that
awaits the result and later serializes it across MCP stdio, a Worker message or
another protocol/process boundary controls that later interval; the engine
cannot re-check after handing the value to its caller. The current MCP timer
consumes the acknowledgement internally rather than publishing it as a tool
result. Product-index/Worker APIs expose context-index maintenance, not
`maintainCards`.

Engine Cards enter the existing candidate ranking. Packing an engine Card removes its exact
source Memory revisions from that pack; a Card that does not fit removes
nothing. Authored Cards keep their existing packing behavior. A lower-ranked engine Card does not displace a higher-ranked source Memory
already selected for a specific fact. This also applies when Memory and Raw are assembled together. Single
fact matches continue to use ordinary Memory candidates. Ranking is unchanged.

Additive engine Card metadata on evidence reads is `origin`, `builtAt`,
`clusterKey`, `status` and `sourceRevisions`. Packed Card metadata includes the
first four; canonical source revisions remain available through evidence reads.
The authored Card API and its confirmation authority remain available separately.

Run the offline synthetic exercise with
`node tools/testing/measure-engine-cards.mjs`. It prints exact pack tokens for
the scripted model and local tokenizer, without provider access.
