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

Read with one snapshot. The store excludes hidden cards in `get` and `list`.
Before delivery, the host's `VisibilityFence` uses `documentCardVisible` to
verify owner and namespace, the deterministic ID, each source memory's
current visibility, and that Raw would expose the entire source message.
The ID check uses the canonical session key supplied on the helper's card
input. The host must resolve it from the record's plain source with the
capture resolver. A missing key, state, or Raw verdict hides the card.

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
Use this check even when the card has no linked memories. A match anywhere
in the message withholds the entire card. A host with its own Raw predicate
can pass `sourceWithheld: false` after that predicate confirms visibility for
the entire source message in the same snapshot.

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

The host calls `detectCardAmendments` after the capture commits, outside any
`UnitOfWork`. Pass the eligible, model-safe messages from that capture and
the visible cards in the same scope, with their source session dates as
`YYYY-MM-DD`. The helper considers sessions ordered by date and then session
ID. It skips captures without user messages or visible earlier cards. It
keeps the newest cards that fit the detect input budget and skips detection
if none fits. A correction to an older card outside the list is unlinked.

Each qualifying capture costs one detect call and up to four verify calls.
Detection requires a model key and both optional model methods. To switch
amendments off in a host, skip the post-commit helper. Model failures,
malformed responses, and timeouts yield no amendments for the capture.

Write accepted results through `documentCards.amend` in a separate, short
`UnitOfWork`. Recheck that the card is still visible, that the source message
is still eligible, and that the pause generation is unchanged before
each write. The deterministic amendment ID makes replays idempotent.
Hidden or tombstoned cards refuse amendments. Only a new amendment advances
the owner index revision for an `amend` call.

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
