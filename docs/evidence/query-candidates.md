# Query-aware candidate reachability

This change moves literal body scoring before recall candidate pagination.
It retains the shared SQLite core, public MOC organization and genuine placement
references, while changing the private selection input from mixed root-map pages
to deduplicated memory candidates. It is not a new semantic model or an overall
memory-reliability claim.

## Same-fixture offline comparison

The [retained candidate report](../../evaluations/results/query-candidates-offline-v1.json)
uses the ten-case diagnostic from PR64 (`f86dbb1`), changing only module import
resolution to this candidate core and the unchanged lexical helper. It records
SHA256 of the five changed runtime modules. The [baseline report](https://github.com/Cairn-ink/cairn-memory/blob/f86dbb1bd3a197c2b1c0fb1c656b1532e1dc8b6f/docs/evidence/moc-architecture.md)
contains the original observations. PR65 changes classification only, leaving
that baseline recall path unchanged.

| 224-record case | Baseline visible / required | Candidate visible / required |
| --- | ---: | ---: |
| Correct topic, late | 0/1 | 1/1 |
| Misleading topic, late | 0/1 | 1/1 |
| Unfiled target behind filed records | 0/1 | 1/1 |
| Two required records, late | 0/2 | 2/2 |

All ten candidate cases preserve direct-read support, complete target inventory
and namespace isolation. The visibility oracle recalls every target it sees;
all four former late-target misses now enter selection. The successful large
cases still report `budget_exhausted`, not full-corpus coverage. Small cases
remain complete. UUIDs and local timings differ between runs; fixed topic names
control baseline page placement and full-body score promotes exact matches in
the candidate without selecting favorable UUIDs.

The scripted selector knows target IDs but can select only visible references.
Its Chinese and paraphrase successes therefore establish reachability in small
stores, not semantic understanding. Constant-one token counting isolates row
ceilings and is not provider accounting. The unchanged FTS5 baseline still misses
the contiguous-Chinese and paraphrase controls. These are not comparable model
accuracy percentages or equal-compute latency measurements.

To reproduce the candidate observation, use PR64's
`evaluation/live/moc-retrieval-diagnostic.mjs` and
`evaluation/live/moc-lexical-baseline.mjs`, resolving the diagnostic's core import
to the candidate `core/contract.mjs`. No fixture, scorer or oracle change is
needed. The normal core regressions are directly runnable via `npm run test:core`.

## Additional boundaries

New actual-SQLite regressions cover raw 1023/1024/1025-row boundaries, with deleted
and historical rows consuming the scan allowance. A fixture scores exactly 1024
bodies /15277 UTF-8 bytes and excludes the sentinel. The existing namespace/ID
index supplies the raw scan without a temporary sort. Auxiliary projection and
placement lookup costs are separate; no total-I/O or production-latency bound is
claimed. The [runtime documentation](../fetch-recall.md) defines the ceilings.

Literal matching still misses unsegmented Chinese substrings and synonyms, and
can prioritize lexical decoys. Zero-score records remain eligible, but large
equal-score groups or records beyond the scan ceiling can still be missed.
Private pages omit group headers, so this change loses that context rather than
implementing adaptive MOC routing. Bounded topic routing, model quality, current
state updates, decision premises and real-user benefit remain separate work.

The [next frozen live protocol](../plans/query-candidates-live.md) tests six new
independently authored cases with actual selection/ranking and retained failures.
This offline evidence does not claim that live protocol has passed.
