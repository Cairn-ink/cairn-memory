# Document card storage and reads

The optional `documentCards` store uses the live `UnitOfWork` transaction for
every operation. Put the card inside capture finish so the card and its source
memory writes commit or roll back together. Use plain session IDs in store
records, sentence sources and hide selectors. Resolve the same canonical
session key for Raw and ordinary capture before building the card.

A put with the same ID and content hash is unchanged. A hidden or tombstoned
ID stays tombstoned on every replay. An insert or replacement, a hide or
bulk hide that affects at least one card, and each `markStale` call advance the
owner index revision once per call. Store only memory IDs in stale entries.
Pass an embedding with its model key to index a vector. Without a model key,
use lexical matching only.

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
with the stored origin hides the card. Every linked memory must be present,
current and visible at its recorded revision in the same snapshot. An empty
source set is valid and can use an empty `memoryStates` map.

For a source-less card, pass the stored `card.title` and `card.body` to
`documentCardVisible`. Use `null` if the stored title is absent. Supply
`textFacts` as the complete applicable set of unwrapped `TextFact` objects
from that scope and read snapshot. Use `[]` when there are no applicable
facts. Pass the owner's memory `fingerprintKey` when available. Core checks
the title and body separately with memory fingerprints, exact digests and
keyed shingle containment at the shared 0.6 threshold. A match in either
field returns `text_withheld`. Unknown or malformed facts and unavailable
key evidence needed for comparison withhold the card.

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
UTF-8 bytes. Each of the four lists contributes at most 50 candidates. For
each item, add `0.5 / (60 + lexicalRank)` and `1 / (60 + vectorRank)` for
its available ranks, counted from one in its own lists. With the floor
enabled, vector-only items survive at distance `0.45` or closer. The function
orders the union by score and the same tie-break, then applies offset paging.
A null card vector channel leaves memories' vector scores intact. With both
vector channels null and cards present, the two lexical lists mix by rank.
Empty card lists produce exactly `fuseHosted` output, or exactly
`fuseHostedLexicalOnly` output when both vector channels are null. Adding
cards never changes the relative order of memories in the ranking.

For a visible card in the page, return `documentCardFindItem(card, query)`
alongside typed memory items. It returns `type: "card"`, `id`, `title`,
`date`, `excerpt`, and `truncated`. The excerpt uses the same line scoring as
`selectDocumentPiece`, breaks ties by first nonblank line, and clips the
selected line to `maxChars` Unicode code points (default 240). `truncated`
indicates that the line was clipped.
