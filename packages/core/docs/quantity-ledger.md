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
recording the finish result and its index revision. The helper reads
`listForMemory` and reconciles before inserting. The read leaves the index
revision unchanged. Each row carries the memory ID, the receipt ID and that
write-time hash. In a scoped memory, a replay leaves the original row intact for the same receipt,
measure, category, value, unit, period, comparator and ordinal. Each successful
`put` or `dropWhere` that changes at least one row advances the owner index
revision once.

Capture validates each quantity independently. Each invalid entry adds one
content-free `invalid_extraction_quantity` count. Valid siblings and items
still pass. An exception reading or validating the list drops the whole list
with one count and preserves the items. Goals require a period and a comparator.
Records use `none` for both.

For each identity, rows on cited user receipts cover the same number of
extracted quantities. Reconcile only the excess. Favor receipts with no existing
row for the memory. Within those candidates, prefer the normalized value and a
measure, category or fixed alias in the same sentence, then anywhere in the
receipt, then the value alone, then the earliest receipt. Assign distinct
matching candidates by validated receipt time, then message ID, per identity.
Extra quantities use the last candidate, continuing after the highest saved
ordinal for that receipt and identity. Undated receipts sort after dated
receipts and use the capture time when selected. Extraction can produce another
row if it gives the same amount a different identity in a later capture.

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
receipt is retained. Use the applicable privacy and retention checks in the same scoped read
snapshot and the host's final visibility fence before delivery. Missing or
uncertain state excludes the row.

`readIntent` checks the query against the store's terms before listing
rows. English cues and the fixed Chinese aliases work with stored terms.
`parseWindow` uses UTC calendar days and Monday-start weeks. Supply checked
rows to `digest` for totals, counts, daily averages and weekly or monthly
subtotals. Units stay separate. Currency displays two decimals and other
units display up to six significant digits. The newest cumulative steps
record supplies each day's total. Supply applicable goals and any earlier checked records
needed for a calendar goal's period to date. Each comparator has its own
latest goal. Goal status compares the total and limit at the unit's display
precision. A goal with no matching records in the requested window reports
that absence.
