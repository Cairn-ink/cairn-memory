# Quantity ledger

Host presets decide whether to set `MemoryServiceConfig.quantityLedger.enabled`.
Core defaults to the original extraction request. With a model and the
`quantityLedger` capability and store, the opt-in sends the existing
`{ quantities: true }` variant. The model returns a separate top-level list
after `items` in the same extraction call. The keyless local profile produces
no quantities.

## Capture and storage

All store calls take a live transaction and a scope. The service writes ledger
rows in the finish transaction with the admitted memory ID, its current core
`textHash`, and the cited canonical receipts. Every cited
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

Before reconciliation, capture keeps a record only if a number in one of the
item's cited user messages matches its magnitude after rounding both to two decimal
places. It drops model-computed totals unless the resulting value also appears
as a number in a cited user message. Every such drop emits one content-free
`extract/core_validation/ungrounded_extraction_quantity` diagnostic. The
recognizer allows up to 360,000 UTF-16 code units, covering up to 18-fold NFKC
expansion of capture's 20,000-unit message limit. It returns no readings for a
longer input or a combining-mark run exceeding 20,000 units after accounting
for decomposition. Both checks precede the recognizer's own normalization.

Only rows with the memory's current `textHash` count toward coverage. For each
identity (measure, category, value, unit, period and comparator), if any cited
user receipt has no current row for this memory, count current rows on the cited
receipts. If every cited user receipt already has a current row for this
memory, count all current rows of that identity for the memory. Insert only
the number of extracted quantities above that count.

Use the first candidate tier with any matches. First use cited user receipts
containing the normalized value and a measure, category or fixed alias. Next use
cited user receipts containing the value. The last tier is the earliest cited
user receipt for goals and direct calls to the ledger helpers. Within a tier,
prefer receipts with no current row, then order by validated time and message ID.
Extra quantities use the last candidate. Ordinals
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
The same matching selects the summaries. A food question limits the reading
to food, including its categories. A coffee question includes the coffee
category, its group and the measure total. A question that names only the
measure includes its total and group summaries. Goals follow the same scope.
`readIntent` also checks the terms of visible rows in each namespace.

Every delivered number uses the full set of eligible rows for its summary.
For example, a measure total shown with a coffee line counts all eligible
rows for that measure and unit in the window. Their sources are cited even
when their group or category lines are absent. A removed line releases its
rows only when no surviving line uses them. The citation list is the union
of the contributing memory refs. Delivery rechecks the exact contributing
ledger row keys and the evidence fence for each cited memory. This includes
an earlier record when it contributes to a delivered goal.

`parseWindow` uses UTC days. “This week” and 這週 or 本週 use the last 7 days.
“This month” and 這個月 use the last 30 days. Both include the as-of day and
end at the next UTC midnight. The digest states the rolling reading in its
header and uses those days for its totals, subtotals and daily averages.

Set `quantityLedger.calendarReading: true` alongside `quantityLedger.enabled: true`
on a service with quantity-ledger storage to include the calendar reading for
these two windows. The digest names the date range once after the header and
follows each summary with its calendar total, count and daily average. Calendar
weeks start on Monday and calendar months start on the first. A reading with no
records for a summary shows a zero total, zero records and a zero average. The
optional comparison extends the checked source range to cover both readings.
A stale cited row withholds the affected digest. A calendar change may still
allow the rolling digest when its cited evidence remains valid.

The digest uses one item slot. If the ordinary pack can deliver ranked memory,
the digest must leave at least one ranked memory in the pack. The pack
measures the incremental token cost of the formatted digest, including the
body and all citations, using the same formatter and tokenizer as the read.
Apply the limits in this order.

1. Keep a ranked item when the ordinary pack has one. Trim or omit the digest
   if it cannot fit alongside one.
2. Keep answering lines whole with all their citations. Directly answering
   summaries can use up to 60% of `maxTokens`. Omit a whole answering line
   when that line alone exceeds 60%.
3. Include other lines only while the digest fits within 30% of `maxTokens`.
   Drop subtotals first, then non-answering category lines from the smallest
   total up, then non-answering group lines. Drop remaining optional
   context as needed. If any line was dropped, append
   `More ledger rows not shown.` to a delivered digest.

Read diagnostics report `ledger_digest_trimmed` as a count of dropped lines,
`digest_line_too_large` as a count of individual answering lines above 60%,
and `ledger_digest_omitted` when a planned digest can't be delivered.
`ledger_digest_error` counts failures by coarse stage (`terms`, `scan`,
`evidence`, `seal`, or `snapshot`). A failed check withholds that digest.
The counters carry no query terms, values or source identifiers.

Supply checked rows to `digest` for totals, counts, daily averages and weekly
or monthly subtotals. Units stay separate. Currency displays two decimals,
using up to six significant digits when a non-zero amount would round to
zero. Other units display up to six significant digits. The newest cumulative
steps record supplies each day's total. Supply applicable goals and any
earlier checked records needed for a calendar goal's period to date. Daily
goals use the requested window, including the rolling days for “this week”
and “this month”. Each comparator has its own latest goal. Goal status
compares the total and limit at the unit's display precision. A goal with no
matching records in the requested window reports that absence.
