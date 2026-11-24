# Document card storage and reads

## Service configuration

Host presets choose the defaults. Core leaves all three switches off unless a
host opts in. A switch applies only when the adapter advertises its storage
capability and supplies the store.

| `MemoryServiceConfig` switch | Capture behavior | Model requirement |
| --- | --- | --- |
| `documentCards.enabled` | Routes screened messages at successful finish, including finishes with no extraction or no extracted items. | Card routing uses no model key. A configured embedder supplies search vectors. Without it, cards are lexical-only. |
| `documentCards.amendments` | Detects and verifies later corrections after commit when card capture is enabled. | Requires both amendment methods on a configured model port. |
| `quantityLedger.enabled` | Includes quantities in extraction and reconciles them at finish. | Requires a model for extraction. See [Quantity ledger](quantity-ledger.md). |

A write-capable service with card capture enabled may pass `model: null` to
capture cards without extraction. Amendments and quantity extraction require
a model, so neither runs in that composition or in the read-only
`keyless-local` profile. When both storage options are absent or disabled,
capture sends the original extraction request and makes the original writes.

## Capture writes

The optional `documentCards` store uses the live `UnitOfWork` transaction for
every operation. The service puts routed cards in the finish transaction
after memory, source and Raw checks so cards and source memory writes commit
or roll back together. It excludes withheld sources before routing. The
embedder runs outside the transaction over screened search text. Only a
card chosen from the final allowed batch can use its vector.

Use plain session IDs in store records, sentence sources and hide selectors.
The card ID uses the plain session ID by default. An adapter with a different
canonical session key supplies its synchronous resolver as
`documentCardSessionKey` when creating the service. Capture and visibility
use the same resolver.

At capture, bind a router card's `sourceMemories` to the memories that capture
wrote or touched for its source message. On recapture, union the bindings by ID,
keeping the highest revision. Hosts that have receipts and lack a capture-time
set can use `documentCardMemoryLinks(sourceMessage, memories)` from `./routing`.
Keep the host's capture-time binding when available. A memory links when any
receipt has the same client, plain session ID and message ID. The receipt role
does not affect matching. The helper keeps the highest matching revision per ID,
sorts by UTF-8 ID order, and throws `invalid_input` for malformed inputs.

A put with the same ID and content hash is unchanged. A hidden or tombstoned
ID stays tombstoned on every replay. Use `linkMemories(tx, scope, cardId, links)`
with the live transaction to union bindings when a later capture adds memories
for the same message and content. The host may implement this operation inside
`put`. A changed union returns `linked` and advances the owner index revision
once. A union with no change returns `unchanged`. A hidden or tombstoned card
returns `tombstoned` without writes, and an unknown ID returns `not_found`.
An insert or replacement, a hide or bulk hide that affects at least one card,
and each `markStale` call advance the owner index revision once per call. Store
only memory IDs in stale entries. Pass an embedding with its model key to index
a vector. Without a model key, use lexical matching only.

Text is marker-only when it contains at least one `[REDACTED]` marker and no
Unicode letter or number remains after removing all markers. Punctuation-only
text without a marker follows the usual routing rules.

Read with one snapshot. The store excludes hidden cards in `get` and `list`.
Before delivery, the host's `VisibilityFence` uses `documentCardVisible` to
verify a nonempty card ID, owner and namespace, and each source memory's
current visibility. Pass the immutable `origin` from the stored record in
that snapshot. Keep it unchanged on replacement. Router cards (`"router"`)
and legacy cards with no origin require a source message. The helper verifies
the deterministic ID and that Raw would expose the entire source message.
The ID check uses the canonical session key supplied on the helper's card
input. The host must resolve it from the record's plain source with the
capture resolver. A missing key, state, or Raw verdict hides the card.

Source-less cards have stored origin `"import"` or `"manual"` and
`sourceMessage: null`. An unknown origin or a source message that conflicts
with the stored origin hides the card. An empty source set is valid and can
use an empty `memoryStates` map. Each linked memory is checked against its state
in the same snapshot.

| Linked memory state | Router and legacy cards | Import and manual cards |
| --- | --- | --- |
| Visible at the linked revision | Visible | Visible |
| Corrected in place, visible at a different revision | Visible and stale | Hidden (`source_memory_not_visible`) |
| Historical, including after supersession | Visible and stale | Hidden (`source_memory_not_visible`) |
| Forgotten | Hidden (`source_memory_forgotten`) | Hidden (`source_memory_forgotten`) |
| Suppressed | Hidden (`source_memory_not_visible`) | Hidden (`source_memory_not_visible`) |
| Missing | Hidden (`source_memory_missing`) | Hidden (`source_memory_missing`) |
| Unknown | Hidden (`source_memory_not_visible`) | Hidden (`source_memory_not_visible`) |
| Visible with an invalid revision | Hidden (`uncertain`) | Hidden (`uncertain`) |

A malformed linked memory state also hides a router or legacy card with
`uncertain`.

For a source-less card, pass the stored `card.title` and `card.body` to
`documentCardVisible`. Use `null` if the stored title is absent. Supply
`textFacts` as the complete applicable set of unwrapped `TextFact` objects
from that scope and read snapshot. Use `[]` when there are no applicable
facts. Pass the owner's memory `fingerprintKey` when available. Core checks
the title and body separately with memory fingerprints, exact digests and
keyed shingle containment at the shared 0.6 threshold. A match in either
field returns `text_withheld`. Unknown or malformed facts and unavailable
key evidence needed for comparison withhold the card.

For facts with legacy MACs, the adapter can pass `legacyFingerprint: { key, labels }`.
Use the adapter's frozen legacy domain labels and derive the key with
`userFingerprintKey(secret, owner, labels)`. For each field, Core compares
legacy exact MACs and keyed shingles under those labels for the cleaned
original, V1 redacted text, hosted-current redacted text, Core-prepared text,
NFKC then V1, and NFKC then hosted-current capture redaction. The signer
normalizes its input. Core signs both the original and already-normalized
forms of each spelling when that produces different bytes. Each signature
keeps its own shingles and associated redaction versions for labelled facts.
For full legacy facts, `containmentThreshold` sets
the shingle cutoff. It defaults to 0.6 and must be greater than zero and at
most one. An invalid cutoff withholds the card. A higher cutoff requires more
overlap, so it hides fewer cards; hosts should not raise it above the default
without a privacy review.

Hosted legacy facts are passed without a digest `label`. A labelled digest
compares redaction versions, and the version Core assigns to each legacy
spelling can differ from the version the hosted writer recorded. Before any
adapter starts labelling hosted legacy facts, Core must first treat an equal
legacy MAC as a match regardless of its redaction version. A fact with both legacy and
Core aliases can match through either comparison. A host holding both kinds
of facts passes both `fingerprintKey` (derived with Core labels) and `legacyFingerprint`
(derived with adapter labels). Omitting either leaves facts that require that
key fail-closed. For a fact with both MACs, passing only `legacyFingerprint`
can withhold an unrelated card because the Core MAC cannot be compared. With
both keys, the card can be visible when both MACs miss. A legacy MAC under a
different key ID withholds the card, including after a key rotation.
Invalid labels or an unusable signing key return `uncertain`.

During forget, the host's `dependents.invalidate` step calls
`hideWhere(tx, scope, { sourceMemoryId }, reason)` for each forgotten memory.
The selector hides linked cards in the forget transaction. The linked memory
state check in `documentCardVisible` is the read-time backstop.

To forget a source-less card, use the store's scoped
`hide(tx, scope, cardId, reason)` by ID and apply text withholding as for
memories. The store excludes hidden and tombstoned IDs from reads and keeps
them tombstoned on replay.

For `documentCardSourceWithheld`, supply the complete Raw match projections
for the card's source message, plus all applicable facts and the Raw matching
policy from that snapshot. Supply `sourceLengthUtf16` as the full message length
in Raw's UTF-16 coordinates before exclusions. The projections must cover
`[0, sourceLengthUtf16)` in order, with no gaps or overlaps, and all share the
same owner, namespace, session hash, and message key. Missing extent, empty
projections, or inconsistent coverage or identity withholds the card.
`factHidesRow` matches session, window, text and overlapping Raw span facts.
Its Raw branch treats identity facts as targeting memories. Pass Raw lineage
fences and any identity-derived exclusions already resolved by Raw as
`sourceExcluded`. An uncertain comparison or projection withholds the card.
Use this check for a source message even when the card has no linked memories.
A match anywhere in the message withholds the entire card. A host with its own
Raw predicate can pass `sourceWithheld: false` after that predicate confirms
visibility for the entire source message in the same snapshot.

`documentCardStaleness` detects recorded stale entries, revision changes, and
sources whose state is anything other than current and visible. A historical
or unknown source is stale even at the recorded revision and without a
`markStale` call. Resolve replacement text from current memory state in the
same snapshot with `resolveStaleReplacement`. The host supplies
current supersession edges and confirms visibility of the terminal revision.
Report forgotten and suppressed states even when a memory is also historical.
When no current visible replacement can be resolved, show only the stale
marker and the precedence sentence.

## Card amendments

An amendment records a later change to an earlier card. It holds the session
date, a sentence stating the updated value, and a verbatim quote with its
source message. Only changes stated in the user's own words are linked.

When enabled, the service calls `detectCardAmendments` after capture commits,
outside any `UnitOfWork`. It supplies the finish-screened messages and visible
earlier cards from the same scope. It derives the capture date from the
earliest known message time in UTC. The helper considers sessions ordered
by date and then session ID. It skips captures without user messages or
visible earlier cards. It keeps the newest cards that fit the detect input
budget and skips detection if none fits. A correction to an older card
outside the list is unlinked.

Each qualifying capture costs one detect call and up to four verify calls.
The host binds models to `ModelPort.detectChanges` and
`ModelPort.verifyChange`. The cloud host binds verify to `gpt-4.1`.
Keep mini off the verification path. The service checks pause generation
and the consent gate before each send, and checks the gate after each send.
Model failures, malformed responses, and timeouts yield no amendments and
leave the committed capture result intact.

Write accepted results through `documentCards.amend` in a separate, short
`UnitOfWork`. Recheck that the card is still visible, that the source message
is still eligible, and that the pause generation is unchanged before
each write. The deterministic amendment ID makes replays idempotent.
Hidden or tombstoned cards refuse amendments. Only a new amendment advances
the owner index revision for an `amend` call.

Hosts can also call `routeDocumentMessages`, `buildDocumentCard` and
`detectCardAmendments` directly from `./routing`.

`get` and `list` return visible amendments in date order. `hideAmendment`
hides an individual amendment, and hiding a card hides its amendments.
`hideWhere` by source message or session also hides amendments from a
matching source. A replay leaves a hidden amendment hidden.

At delivery, pass the card's `documentCardVisible` verdict to
`documentCardAmendmentVisible` for each amendment. Resolve the amendment's
own `sourceMessage` to Raw's session hash and message key and supply the
complete Raw projections, extent, exclusions and facts for that source in
the same snapshot. An unavailable identity or visibility verdict, incomplete
coverage, or a withholding match hides the amendment.

After selecting the document piece, call `renderCardAmendments` with the
visible amendments. Its token counter should measure the final card item
with the proposed suffix, including the separator, against the item's
share of the pack budget. Append the returned text after the piece when
nonempty, and add the returned amendments' source messages to that item's
sources. The suffix keeps up to five amendments in ascending date order
and drops the oldest first when the item is short of space. The precedence
sentence is part of the suffix budget.

## Find

Enable `documentCardSearch` with `documentCards` and implement the optional
`documentCardCandidates` port. Its `lexical` and `vector` methods use the
ordinary candidate signatures. Return only visible cards in the
`RetrievalScope` and its read snapshot. Exclude hidden and tombstoned cards.
Set `ref.type` to `"card"` and `ref.namespace` to the card's namespace. Order
vector rows by distance ascending, then `updatedAtUs` descending, then ID
descending by UTF-8 bytes. Pass `null` for a vector channel when it is
unavailable or its `coverage.complete` is false.

Index and embed exactly `documentCardSearchText(card)`. It is the stored title,
two newlines, and the body. A null or empty title yields the body alone. The
stored fields are already redacted. Use `DOCUMENT_CARD_SEARCH_TEXT_VERSION`
(currently `1`) to gate lexical reindexing and re-embedding when the text
format changes.

Run `visibleDocumentCardRows` on each card candidate list before fusion so
only visible cards contribute ranks and scores. Its loader supplies a
`DocumentCardVisibilityInput` for the ref from the same read snapshot. The
helper preserves row order and counts drops by reason. It drops non-card
refs, missing inputs, loader failures, identity mismatches, and hidden or
uncertain verdicts. Run the final visibility check before delivery in the
same snapshot.

Use `fuseHostedWithCards` as the reference ranking function. It sorts each
memory or card lexical list by score descending and each vector list by
distance ascending. Ties use `updatedAtUs` descending and ID descending by
UTF-8 bytes. In hybrid mode, each of the four lists contributes at most
50 candidates. For each item, add `0.5 / (60 + lexicalRank)` and
`1 / (60 + vectorRank)` for its available ranks, counted from one in its
own lists. With the floor enabled, vector-only items survive at distance
`0.45` or closer. The function orders the union by score and the same
tie-break, then applies offset paging. A null card vector channel leaves
memories' vector scores intact. Empty card lists produce exactly
`fuseHosted` output.

With both vector channels null, the function merges both full lexical lists
by `0.5 / (60 + lexicalRank)` using the rank within each list and the same
tie-break. It preserves the original rows and counts all merged rows in
`total` before paging. Memory and card store scores are incomparable.
Callers must preserve the returned ranking order as-is. An empty card list
produces exactly `fuseHostedLexicalOnly` output. Adding cards preserves the
relative order of memories.

For a visible card in the page, return `documentCardFindItem(card, query)`
alongside typed memory items. It returns `type: "card"`, `id`, `title`,
`date`, `excerpt`, and `truncated`. The excerpt uses the same line scoring as
`selectDocumentPiece`, breaks ties by first nonblank line, and clips the
selected line to `maxChars` Unicode code points (default 240). `truncated`
indicates that the line was clipped.
