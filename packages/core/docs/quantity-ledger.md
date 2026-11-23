# Quantity ledger

The `quantityLedger` capability is off by default. A host with a
`QuantityLedgerStore` can opt into the extra extraction instructions and
strict schema with `{ quantities: true }`. The model returns a separate
top-level list after `items` in the same extraction call. Without a model key,
capture produces no quantities.

## Capture and storage

All store calls take a live transaction and a scope. Call `writeLedgerQuantities`
inside the capture finish unit of work with the admitted memory ID, its existing
core `textHash` from capture and the cited canonical receipts. Do this before
recording the finish result and its index revision. `listForMemory`,
reconciliation and `put` run in the same unit of work under the owner write lock.
A second writer on the same transaction is out of contract. The read leaves
the index revision unchanged. Each row carries the memory ID, the receipt ID and that
write-time hash. In a scoped memory, a replay leaves the original row intact for the same receipt,
measure, category, value, unit, period, comparator and ordinal. Each successful
`put` or `dropWhere` that changes at least one row advances the owner index
revision once.

Capture validates each quantity independently. Each invalid entry adds one
content-free `invalid_extraction_quantity` count. Valid siblings and items
still pass. An exception reading or validating the list drops the whole list
with one count and preserves the items. Goals require a period and a comparator.
Records use `none` for both.

Only rows with the memory's current `textHash` count toward coverage. For each
identity (measure, category, value, unit, period and comparator), if any cited
user receipt has no current row for this memory, count current rows on the cited
receipts. If every cited user receipt already has a current row for this
memory, count all current rows of that identity for the memory. Insert only
the number of extracted quantities above that count.

Use the first candidate tier with any matches. First use cited user receipts
containing the normalized value and a measure, category or fixed alias. Next use
cited user receipts containing the value. The last tier is the earliest cited
user receipt. Within a tier, prefer receipts with no current row, then order by
validated time and message ID. Extra quantities use the last candidate. Ordinals
continue after the highest saved ordinal for the receipt and identity, including
any retained old-hash rows that still occupy storage keys. Undated receipts sort
after dated receipts and use the capture time when selected. Known limits include
a purchase relabelled between captures and other ambiguities when re-extraction
changes which purchases or quantities a later capture describes.

`dropWhere` removes rows and their terms by `{ by: "memoryId", id }` or
`{ by: "receiptId", id }`. Adapters must call `ledgerDropSelector(selector)`
to get the validated key or throw `invalid_input`. When a correction retires
evidence, retire the old receipt associations in the same transaction. Read
`list` on a snapshot using the
row's source event time in the half-open integer millisecond range
`[fromMs, toMs)`. Read `terms` on the same snapshot and return distinct
measure, category and group terms only from rows whose memory is current.

## Read and delivery

Core requires a current and visible memory, a retained canonical receipt
and the current core `textHash` matching the row's write-time hash. Exact
deduplication keeps the hash. A correction changes it even when the
receipt is retained. Old-hash rows are excluded from delivery and the host may
drop them. Use the applicable privacy and retention checks in the same scoped read
snapshot and the host's final visibility fence before delivery. Missing or
uncertain state excludes the row.

`readIntent` checks the query against the store's terms before listing
rows. English cues and the fixed Chinese aliases work with stored terms.
`parseWindow` uses UTC calendar days and Monday-start weeks. Supply checked
rows to `digest` for totals, counts, daily averages and weekly or monthly
subtotals. Units stay separate. Currency displays two decimals, using up to six
significant digits when a non-zero amount would round to zero. Other units
display up to six significant digits. The newest cumulative steps
record supplies each day's total. Supply applicable goals and any earlier checked records
needed for a calendar goal's period to date. Each comparator has its own
latest goal. Goal status compares the total and limit at the unit's display
precision. A goal with no matching records in the requested window reports
that absence.
