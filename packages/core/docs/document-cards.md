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
Resolve the canonical session key from the record's plain source with the
capture resolver and supply it on the helper's card input. A missing key,
state, or Raw verdict hides the card.

For `documentCardSourceWithheld`, supply the complete Raw match projections
for the source message, covering its full span before exclusions, plus all
applicable facts and the Raw matching policy from that snapshot.
`factHidesRow` matches session, window, text and overlapping Raw span facts.
Its Raw branch treats identity facts as targeting memories. Pass Raw lineage
fences and any identity-derived exclusions already resolved by Raw as
`sourceExcluded`. An uncertain comparison or projection withholds the card.
Use this check even when the card has no linked memories. A match anywhere
in the message withholds the entire card. A host with its own Raw predicate
can pass `sourceWithheld: false` after that predicate confirms visibility for
the entire source message in the same snapshot.

`documentCardStaleness` detects recorded stale entries and revision changes
independently of the update hook. Resolve replacement text from current memory
state in the same snapshot with `resolveStaleReplacement`. The host supplies
current supersession edges and confirms visibility of the terminal revision.
Report forgotten and suppressed states even when a memory is also historical.
When no current visible replacement can be resolved, show only the stale
marker and the precedence sentence.
