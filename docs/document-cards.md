# Capture-time document cards

A host can supply a synchronous `cardPort` to `openMemoryCore({ path, model,
contextRead, cardPort })`. The in-memory adapter lives in
`core/document-card.mjs`. It holds cards and their vectors for the lifetime of
the port. A read-only host can pass the same port to
`openContextReader({ path, contextRead, cardPort })`.

Capture selects messages that look like documents: numbered steps, lists,
tables, code, long answers and sufficiently long requests to remember something.
Long messages in any role can qualify. The length rule weights CJK characters
more heavily. Explicit requests come first, followed by qualifying assistant
messages and then other messages, with source order breaking ties.

Capture keeps up to four cards per batch. Each contains the original message
after NFKC normalization and secret redaction, with line breaks and indentation
preserved. Bodies above 4,000 UTF-16 code units are skipped. The completed
capture reports their count in `documentCards.droppedOversize`. If a redaction
cannot be mapped back to the original lines, capture skips the card and reports
it in `documentCards.droppedRedaction`.

A context read can include one `document-card-v1` item within its normal item
and token budget. A request for the full text can return a truncated head.
Other requests get a short whole card or a window around the matching line.
With a configured embedder and its semantic budget policy, the channel uses
cosine similarity with a minimum of 0.35 once card vectors are available.
Reads use lexical matching while vectors are being prepared or when the host
has no embedder. That fallback needs at least
60% of the query's character bigrams to match the title and body, with at least
two matches when the query has two or more bigrams. It is weaker on paraphrases.

A correction or supersession that changes a linked memory marks the card
stale. The read includes the replacement memories and gives them precedence
over the original text. A correction made in chat can leave the card outdated
when no memory records the correction. Check the original date and any stale
notice before using the contents.

Call `core.forgetCard({ namespace, cardId })` with the ID from a read item.
Forgetting a linked memory or deleting or fencing the source also hides the
card. Hosts should share the configured port across writers and readers for
that store so they observe the same card state.

A durable card adapter must write in the memory's transaction.
