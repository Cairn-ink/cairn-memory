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

The existing source invalidation increments the Card revision. Such a Card has
status `stale` and is refused by both current and history reads. Suppressed,
excluded, forgotten, denied or foreign sources also make the Card ineligible.
After at least ten minutes, a later worker pass re-evaluates the trigger. A
rebuild inserts a fresh Card row and source set, retaining the old row and seal.
If the trigger no longer holds, maintenance deletes the stale Card body while
retaining its row and lineage records.

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
