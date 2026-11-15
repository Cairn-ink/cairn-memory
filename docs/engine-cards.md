# Engine Cards

A Memory is an atomic claim with an event time. An engine Card consolidates the
dated Memories of one topic, with out-of-date statements separated from current lines. It is derived, untrusted recollection,
never an additional fact or execution permission.

Generation is available by default when the model implements `consolidate`.
There is no authoring confirmation or generation toggle. Capture never builds a
Card. The existing MCP maintenance loop calls `maintainCards`; embedded hosts can
call the same method in their maintenance worker. `getEngineCardStatus` reports
the trigger in plain words and the last bounded pass. These methods are present
only when the model implements
`consolidate`; ordinary handles retain their established method surface.
Writable pinned stores reuse installed Card tables without upgrading their schema.
See [defaults, costs and off switches](defaults.md) for the local controls.

## Trigger

Each pass scans one exact namespace, up to 512 memories. Incomplete scans resume
on later passes, restarting when the namespace epoch changes. The scan retains
at most 4,096 memories / 8 MiB across passes and publishes no partial cluster.
Filed memories cluster
by MOC L1 membership. Unfiled memories cluster against a seed by cosine similarity
of at least 0.65 when both retained vectors exist, otherwise positive BM25 term
overlap. Configured context readers reuse their retained vectors without making
an embedding call for clustering.

Before evaluating triggers, a cluster larger than 12 Memories is sorted by event
date, with memory ID breaking ties, and divided into consecutive parts of 12.
Each part has key `<cluster key>#<part index>` (zero-based); clusters of 12 or
fewer keep their key. Similarity-key reuse and exact-source carry apply per part.
Past 12 Memories in a topic, new Memories join a Card in groups: a tail becomes a
Card at 5 sources; until then they appear as individual Memories.
Each part needs one of three conditions plus budget pressure: at least
8 memories, 3 conversations and 14 days; a chain of at least 3 supersedes or
contradicts edges on one slot; or at least 5 current Memories, whatever their
conversations. The trigger result includes `topic` alongside `recurring`, `chain`
and `pressure`. Pressure means at least 5 memories or 1,200 tokens of packed
Memory/receipt text, including framing and metadata, measured with the configured
tokenizer and existing packer. These thresholds correspond to the product's
12 item / 3,000 token pack. There is no sliding time window or importance sum.

A topic with no previous Card can build on the next eligible maintenance pass
after the fifth Memory lands, with no ten-minute wait. Capture itself does not
schedule a pass. The MCP loop arms a pass one second after the previous pass
finishes (or after startup); embedded hosts choose their worker cadence. When
more items arrive, the next pass marks the earlier Card stale and hides it; a pass at least ten minutes after that staling can build a
fresh Card. Further additions during that wait do not restart it. The old row
and seal remain. Scan expiry and failed-attempt backoff keep their existing
timing; an incomplete scan can require multiple passes.

Appending a later-dated Memory changes only the last part (or adds a new part).
Known limit: removing or re-dating a Memory in the middle shifts later part
boundaries and rebuilds the affected Cards. Rebuilds retain the existing ten-minute
debounce and at most one generation per pass; several passes may be needed.

Receipt event dates take precedence; legacy memories without those dates use
their recorded creation date. This fallback is an arrival date, not a recovered
event instant. Conversation identity comes from linked Raw when available,
otherwise the receipt's client and session identity.

## Ports and budgets

`consolidate({system, input: {memories, rawSpans}, maxOutputTokens, signal})`
uses the ordinary model port. A memory contains `id`, `revision`, `content`,
`date` and `currentness`. The part's own Memories always come first, followed by
other Memories from the same original cluster, newest first, up to 24 total.
Context is added only while the existing input and adapter envelopes still fit.
`rawSpans` is an empty array; no Raw text is sent. When available, `relations`
supplies up to 192 same-part edges; `supersedes` points from newer to older.
The Raw opt-in no longer affects bundle building. Bundles are built from Memory
content only and never send Raw spans or receipt excerpts to `consolidate`, with
the opt-in on or off. Without Raw spans, the feature is slightly weaker at telling
that something is no longer true.

`maintainCards` still accepts the boolean `rawSpans` consent option. It controls
whether receipt excerpts enter the token counter when metering pressure for a
four-Memory chain; omitted or `false` excludes those excerpts. It can therefore
affect whether that chain qualifies to build a bundle. The resulting bundle
request still contains only Memory content. The local MCP server enables this
pressure opt-in only with `rawSemantic: true` and `contextSemantic !== false`.
Those local switches also retain their separate control over Raw embeddings as
explained in the [defaults table](defaults.md).

The model identifies only out-of-date Memories: later statements that change,
replace, remove, cancel or negate the same thing. Daily records remain true for
their own dates; different days, things and list items do not replace each other.
The change statement itself remains current. Uncertain cases stay current.
The closed output still has three arrays: `currentState` and `contradictions`
contain `{text, memoryIds}`, and `timeline` contains `{date, text, memoryIds}`.
The prompt asks for one `currentState` entry with text `ok` and the latest ID,
empty `contradictions`, and one timeline entry per out-of-date Memory.
Malformed shapes are refused. A timeline entry counts only when every ID belongs
to the request; an entry containing a foreign ID is ignored in full. Only these
IDs are used: model text and dates are never stored or delivered. Zero marked
Memories is an ordinary successful result; all marked means no Card.

The body is built from the part's original Memories, sorted by event date with
ID breaking ties. Every current line is `<YYYY-MM-DD>: <content> [<memory id>]`.
A Memory the store already holds as history is always treated as out of date,
whatever the model returns. If any sources are marked out of date, a final `Timeline: ` line holds those same
dated verbatim entries separated by `; `. Control characters and square brackets
in content become spaces; whitespace collapses. Nothing is paraphrased or
shortened. The body cap is **850 tokens**, including dates and citation tags.
The offline 15–40 word synthetic corpus with UUID IDs needs 750 tokens for twelve
stored lines. When the cap is exceeded, whole current lines are removed oldest
first; their uncited Memories remain ordinary candidates. If no current line
fits, no Card is published. Timeline entries are never shortened or dropped to fit.

The OpenAI adapter uses a closed structured-output schema with source-ID enums.
Each pass makes at most one generation, through the existing 6,000 input / 1,024
provider output envelope and model deadline. The verbatim Card body is fitted locally after validation. The local guarded model charges the existing runtime budget for
consolidation and stops on refusal. Memory text is never truncated to fit a
request. Parts may still exceed the input envelope and return `input_budget`.
`ENGINE_CARD_LIMITS.sources` remains 96; `source_limit` is unreachable through
maintenance because every part contains at most 12 Memories. Its defensive check
remains in place.
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

Evidence selection checks its shared deadline between denied engine candidates,
including metadata lookahead. Once the deadline stops selection, it starts no
further lookahead probe and returns partial coverage with a continuation cursor.
Only consumed readable positions enter that cursor. Denied positions are not
persisted, so a denied prefix that consumes every call's deadline is rescanned
on every call. Indexed candidate seeks and the per-call deadline bound each
traversal; they do not guarantee eventual progress through such a prefix.

When a bound Memory's revision changes, the existing trigger advances the Card
revision once and records one `evidence_invalidated` effect for that Memory.
Ordinary admission or capture of another receipt, causal supersession,
confirmation, filing or re-filing, remember metadata updates and correction can
therefore stale an engine Card without failing the Memory write, including on
stores with sealed lineage. Each update to a bound Memory's revision produces
one consecutive Card step, including repeated updates to the same Memory within
one transaction, as when duplicate extracted items attach distinct receipts.
A causal batch that restates a bound Memory and contains a different item does
not offer that restated Memory as a reconciliation candidate. The restatement
adds its receipt and advances the Memory once; it stays current while the Card
goes stale. Retiring a bound predecessor through causal capture is a separate
case in which that predecessor is not restated in the same batch.
The Card keeps its state, title, body, bindings and seals; the
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
Each later revision-changing write to a bound Memory restarts the ten-minute wait
before a worker pass rebuilds or retires the Card. Re-filing with an unchanged
revision does not restart the wait. After that wait, a later pass re-evaluates the
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

Engine Cards enter the existing candidate ranking. A Card citing a Memory (on a current line or under `Timeline:`) among
the first `budget.maxItems` ranked Memory candidates is considered immediately
before its best-ranked cited Memory. In mixed Memory/Raw assembly its unit
borrows that Memory unit's lexical score and rank prior, without a size penalty
in scoring; budget fit still applies. Packing the Card removes only exact source
Memory revisions cited in its stored body, including Timeline entries. Uncited cluster Memories remain
ordinary candidates; all cluster sources still bind invalidation and read safety.
For `intent: 'current'`, the delivered body contains the title and current lines,
without the `Timeline:` line or citation tags. Counts and budget checks meter
this delivered text. History delivers the stored title and body unchanged;
evidence reads also remain unchanged. Promotion uses every stored citation: when
the hit is a Memory listed under `Timeline:`, the Card takes its place and that
out-of-date statement is not delivered. Covered-source detection always
uses the stored body, preventing out-of-date entries from returning beside it.
Stored lineage fingerprints, snapshot fences, signed snapshot references and
`bodyRev` continue to bind the canonical stored Card. Projection does not mutate
that body or advance its revision. Final canonical refetch and signed-response
byte checks remain in place.

A later statement alone does not rewrite an existing Card: until maintenance
identifies the change and rebuilds, an older Card can still deliver that line.
When a build marks an ID appearing on another current Card's current lines in
the same namespace, it retires that Card through the existing staling path.
Retirement hides it immediately; a later pass rebuilds after the ordinary
ten-minute debounce, with at most one generation per pass. Context is bounded,
so changes outside the selected context can remain unrecognized.

A Card that does not fit removes nothing. A Card without a cited Memory in the
window retains ordinary ranking and cannot displace a better-ranked source
Memory already selected. Authored Cards and Memory ranking are unchanged. All
reader eligibility, namespace, lineage and budget checks remain in place.

Additive engine Card metadata on evidence reads is `origin`, `builtAt`,
`clusterKey`, `status` and `sourceRevisions`. Packed Card metadata includes the
first four; canonical source revisions remain available through evidence reads.
The authored Card API and its confirmation authority remain available separately.

Run the offline synthetic exercise with
`node tools/testing/measure-engine-cards.mjs`. It prints exact pack tokens for
stored and current-delivered bodies for parts of 5, 8 and 12 realistic synthetic Memories, with the local tokenizer and no provider access.
