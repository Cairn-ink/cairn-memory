# Longer source history stopped before retrieval and answers

The once-only installed experiment stopped at the fourth capture window: a
completed qualification response duplicated one item index and omitted another.
Local validation rejected the batch before source admission. No retrieval or
host answer ran. This is a capture robustness finding, not evidence for or
against MOC or lexical answer quality.

The [fixture](../evaluation/live/long-source-history-fixture.json),
[scorer labels](../evaluation/live/long-source-history-rubric.json),
[pre-live semantic rubric](long-source-history-rubric.md), and
[driver contract](long-source-history.md) remain available. The operator and raw
report are retained privately; this document is not a raw-log publication.

## What ran and what did not

One synthetic 32-message history contained eight four-message windows and four
later questions, each scheduled for MOC and lexical source controls. The actual
installed CLI used source-bound-v2 capture with
`gpt-4.1-mini-2025-04-14`, closing and reopening for inspection after capture.
There was no manual source admission, retry, replacement case or model switch.

| Capture window (zero-based) | Outcome | Source-memory observation |
| --- | --- | --- |
| 0 | Completed | Three of four messages retained; assistant suggestion omitted. |
| 1 | Completed | All four messages retained. |
| 2 | Completed | Three of four messages retained; assistant suggestion omitted. |
| 3 | Failed | Four extracted items; qualification rejected before admission. Warm/cold records match window 2. |
| 4 | Not run | No capture attempted. |
| 5 | Not run | No capture attempted. |
| 6 | Not run | No capture attempted. |
| 7 | Not run | No capture attempted. |

| Later question | MOC answer | Lexical answer |
| --- | --- | --- |
| Flask reasons | Not run | Not run |
| Course actors | Not run | Not run |
| Commute exception | Not run | Not run |
| Unbought telescope | Not run | Not run |

All four queries also have not-run recall and null coverage, not measured zero
retrieval. All eight answer slots remain in the private report. The operator's
top-level `observed` means execution returned; the driver's
`observed-with-failures` and failed/not-run records describe the actual outcome.
There was no transport halt: the driver stopped subsequent work after capture
failure as its frozen policy required.

## Exact structural failure

Generation trace 20 extracted four items: the user's changed Sable lid, tea
storage, Mara's flask switch combined with the user's non-switch, and telescope
bookmarking without purchase. Trace 22, `cairn_qualifyCandidates`, received item
indices 0, 1, 2 and 3, but returned qualification indices **[0, 1, 2, 2]**.
The second index-2 entry described the user's non-switch separately from Mara's
switch. There was no qualification for index 3, the telescope item.

The provider returned completed, parseable JSON, not a truncated response or
transport error. Four entries and their individual index alternatives fit the
advertised response schema; cross-entry uniqueness/completeness did not satisfy
the core contract. The
[qualification compiler](../core/qualification-candidates.mjs) rejects duplicate
indices rather than guessing which item an entry belongs to. Capture returned
nonretryable `invalid_model_output`. Qualification precedes admission, so no
fourth-window classification call followed.

The failed window's complete warm and cold source-memory records are identical
to the preceding completed cold snapshot: ten memories and receipts, with
unchanged contents and revisions. No partial fourth-window source-memory writes
are visible. This does not establish that internal capture-attempt bookkeeping
was unchanged.

`captureCoverage` reports 10/32 designated source messages using window 2,
explicitly `last-completed-before-failure`. Its 22 missing messages comprise two
earlier extraction omissions, four extracted-but-unadmitted messages and sixteen
never-attempted messages. That denominator must not become a retrieval accuracy
or semantic failure rate. Assistant suggestions being omitted also prevents any
claim that downstream consumers successfully distinguished those suggestions.

## Semantic limits and next investigation

Surviving receipts retain the user/Mara distinction, one-off bus exception,
undecided enrollment and telescope nonpurchase. Generated metadata is less
reliable: browsing without purchase was typed `decision`; some reported
third-person statements received `attribution: direct`; Lina's enrollment was
filed under unrelated existing categories in trace 18. These are interpretation
and organization caveats, not the duplicate-index failure's cause or observed
downstream answer errors. No select/rank or answer call tested their effects.

The author and a separate agent inspected the frozen traces and snapshots.
Judgments are nonblind, same-family agent assessments over development material,
not independent-human review or real-world longevity evidence. Four queries
share one history; this run produced no MOC-versus-lexical comparison.

The next bounded investigation is offline qualification robustness: reproduce
the duplicate/missing mapping and mixed-person extracted item, examine whether
the output representation can enforce one qualification per item, and evaluate
failure isolation without guessing provenance or silently accepting invalid
mappings. Preserve the fail-closed boundary and this failed run. Any new runtime
change or paid experiment needs its own reviewed scope; no rerun, default change,
release, publication of raw logs or deployment is authorized by this report.

## Accounting and frozen provenance

The run made 22 source HTTP requests: eleven input-count calls and eleven
generation calls, with zero host calls. It reserved US$0.110 under the frozen
128-request/US$1.50/eight-host-call ceiling in the unchanged US$50 ledger.
Known token-priced estimates increased US$0.012318; eleven additional requests
have unknown cost; zero are unsettled. Unknown does not mean free, reservations
are not actual invoices, and no reservations were refunded or ledger reset.

| Shared ledger measure | Before | After |
| --- | --- | --- |
| Requests | 1,058 | 1,080 |
| Conservative reservations | US$13.506 | US$13.616 |
| Known token-priced estimates | US$0.772930 | US$0.785248 |
| Unknown-cost requests | 521 | 532 |
| Unsettled requests | 0 | 0 |

Frozen identifiers (SHA256 except the source commit):

- Source commit: `582f42b6375ddcdde6561c6b5f8da1310c98c2ec`.
- Fixture: `fce74edc6ee12588b5c635ee716fccfce97fb0a5872c967d7ca728aac11f0e88`.
- Scorer: `7b541f3bb74eec58b86b0f0592abcb05dd9f5f229f979eec5b41eaeb3457aae2`.
- Pre-live rubric: `8232a0131ad434c1e456844c3a3430576b1e7c1933bb93a86fa2300575d4b1c7`.
- Operator: `4b05f4d381b4afef3eaabe003ce453d3376f60a4ad2d821ce4dfecb686d64a80`.
- Installed archive: `9b7c3b2ef0745b7878a0e7037201cc6e864ce275ed821251fcb0a570b9967b4a`.
- Private raw report: `9aedc6fc1a0caa7d698601a92169c1948d73a05632e46a79b08d5271419dd99c`.

The pre-live rubric hash identifies its original frozen bytes, before adding the
post-run results link. The fixture and scorer were not tuned to these outcomes.
