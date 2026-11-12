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
If any sources are marked out of date, a final `Timeline: ` line holds those same
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

Known limit: carry searches only the oldest 129 confirmed engine Cards in the
namespace. A newer Card beyond that page is rebuilt by the backstop on the next
pass, using one model call and a new Card ID.

The existing source invalidation increments the Card revision. Such a Card has
status `stale` and is refused by both current and history reads. Suppressed,
excluded, forgotten, denied or foreign sources also make the Card ineligible.
After at least ten minutes, a later worker pass re-evaluates the trigger. A
rebuild inserts a fresh Card row and source set, retaining the old row and seal.
If the trigger no longer holds, maintenance deletes the stale Card body while
retaining its row and lineage records.

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
