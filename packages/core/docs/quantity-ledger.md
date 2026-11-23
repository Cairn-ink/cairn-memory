# Quantity ledger

The `quantityLedger` capability is off by default. A host with a
`QuantityLedgerStore` can opt into the extra extraction instructions and
strict schema with `{ quantities: true }`. The model returns a separate
top-level list after `items` in the same extraction call. Without a model key,
capture produces no quantities.

## Capture and storage

All store calls take a live transaction and a scope. Write the rows in the
capture finish transaction with their admitted memory and canonical receipts.
A row binds to a memory ID and a receipt ID across memory revisions. In a
scoped memory, a replay leaves the original row intact for the same receipt,
measure, category, value, unit, period, comparator and ordinal. Each successful
`put` or `dropWhere` that changes at least one row advances the owner index
revision once.

Capture validates each quantity independently. Each invalid entry adds one
content-free `invalid_extraction_quantity` count. Valid siblings and items
still pass. Goals require a period and a comparator. Records use `none` for both.

Attribute each item's validated quantities to its cited user receipts.
Candidates first match both the normalized numeric value and a measure,
category or fixed alias. The fallback is a value match, then the earliest user
receipt. Within an identity, assign distinct candidates by validated receipt
time, then by message ID. Additional quantities use the last candidate with
increasing ordinals. Undated receipts sort after dated receipts and use the
capture time when selected. Extraction can produce another row if it labels
the same amount with a different measure or category in a later capture.

`dropWhere` removes rows by memory or receipt and removes their contributions
to the term index. When a correction retires evidence, retire the old receipt
associations in the same transaction. Read `list` on a snapshot using the
row's source event time in the half-open integer millisecond range
`[fromMs, toMs)`. Read `terms` on the same snapshot and return distinct
measure, category and group terms only from rows whose memory is current.

## Read and delivery

Core requires a positive current-and-visible memory check and a retained
canonical receipt for that memory before including a row in a digest. Use
the applicable privacy and retention checks in the same scoped read
snapshot and the host's final visibility fence before delivery. Missing or
uncertain state excludes the row.

`readIntent` checks the query against the store's terms before listing
rows. English cues and the fixed Chinese aliases work with stored terms.
`parseWindow` uses UTC calendar days and Monday-start weeks. Supply checked
rows to `digest` for totals, counts, daily averages and weekly or monthly
subtotals. Units stay separate. The newest cumulative steps record supplies
each day's total. Supply applicable goals and any earlier checked records
needed for a calendar goal's period to date. Each comparator has its own
latest goal. A goal with no matching records in the requested window reports
that absence.
