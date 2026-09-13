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

## Retained live query probe

The [frozen live protocol](../plans/query-candidates-live.md) subsequently ran once
on six new synthetic cases, each with a baseline and candidate arm. Baseline was
`b3429f1246c942b3b8adcb68e955d68abb7716c2`; candidate was
`d1381aed856effd4448236a872cf3ecaced92fe9`. Both used their actual core, adapter and
guard with unchanged `gpt-4.1-mini-2025-04-14` selection/ranking. Explicit admission
and manual placement isolated retrieval from extraction and reconciliation.
The case author saw the specification and audited implementation; fixture
metadata was held out from implementation/test authors, but this was not blinded.

The [frozen fixture](../../evaluations/results/query-candidates-live-fixture-v1.json)
contains source text, corpus recipes and evaluator expectations. Those evaluator
fields were not model input. The
[compact evidence export](../../evaluations/results/query-candidates-live-v1.json)
retains every arm, source-bound target, complete recall envelope, trace output,
intermediate target visibility/selection summaries and per-request accounting.
It records corpus/input hashes and original artifact hashes. Full distractor
snapshots, model inputs, HTTP envelopes, incremental checkpoints and operational
paths remain private; hashes bind these artifacts but do not make omitted content
independently reconstructible from the public export.

| Case | Baseline required targets returned | Candidate required targets returned | Both arms' coverage |
| --- | ---: | ---: | --- |
| English, correctly filed, 224 records | 0/1 | 1/1 | `budget_exhausted` |
| English, unfiled, 224 records | 0/1 | 1/1 | `budget_exhausted` |
| English, two records misfiled, 224 records | 0/2 | 2/2 | `budget_exhausted` |
| Chinese control, 16 records | 1/1 | 1/1 | `complete` |
| English paraphrase control, 16 records | 1/1 | 1/1 | `complete` |
| Absent-answer control, 16 records | 0 returned; 0 required | 0 returned; 0 required | `complete` |

All 12 arms mechanically completed, with no retry or replacement. Of five
positive cases per arm, baseline retrieved all required targets in 2/5 and
candidate in 5/5; target-record coverage was 2/6 and 6/6 respectively. By language,
baseline covered 1/4 English positive cases and 1/1 Chinese case; candidate covered
4/4 and 1/1. The English negative control returned zero memories in both arms.
Every final returned memory was required and its receipts matched the cold source
records. All 12 complete corpus snapshots matched before and after reopening and
after recall; no source or placement mutation was observed.

Final filtering was not perfect initial selection: baseline selected two distinct
non-target memories in the two-evidence case and one in the absent-answer case;
candidate selected one non-target in the two-evidence case. Ranking removed these
before the final response. The export preserves those intermediate selections.

This attempt made 54 HTTP requests (26 baseline, 28 candidate; 27 count/generation
pairs), reserving USD0.270000 within its USD0.40/80-request cap. The existing USD50
phase moved from 8 requests /USD0.040000 reserved to 62 requests /USD0.310000
reserved, with zero unsettled calls. Cumulative known usage was USD0.035212,
including USD0.032110 from this attempt; 31 cumulative calls had unknown cost,
including 27 count calls here. Known usage is not the total bill, and reservations
were not refunded. The separate earlier USD20 campaign was not used or reset.

These observations support the intended candidate-input mechanism on this small
synthetic sample. The 224-record successes still have incomplete coverage.
Chinese/paraphrase results do not demonstrate an advantage from literal matching:
both versions succeeded on these small controls. There was no answer model,
extraction, memory-update test, installed-client live test or real-user evaluation.
No general quality percentage, statistical superiority or release endorsement
follows. Model-guided topic routing and update/adoption reliability remain open.
