# Quantity ledger

Host presets decide whether to set `MemoryServiceConfig.quantityLedger.enabled`.
Core defaults to the original extraction request. With a model and the
`quantityLedger` capability and store, the opt-in sends the existing
`{ quantities: true }` variant. The model returns a separate top-level list
after `items` in the same extraction call. The keyless local profile produces
no quantities.

## Capture and storage

All store calls take a live transaction and a scope. The service calls
`writeLedgerQuantities` in the finish transaction with the admitted memory ID,
its current core `textHash`, and the cited canonical receipts. Every cited
source must pass finish checks. Attribution uses retained user receipt IDs
from hydration or the inspect store in that transaction. `listForMemory`,
reconciliation and `put` run under the owner write lock and commit with the
finish result. Hosts may also invoke the ledger helpers directly.
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
