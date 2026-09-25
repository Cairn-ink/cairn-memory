# Fresh six-case development smoke: terminal aggregate

On 2026-09-25, the separately frozen, one-shot six-case development smoke
reached a terminal scored result without a global halt. One new case of each
LongMemEval question type was selected before execution. This was a development
cohort, not a held-out benchmark or an installed Hermes test. The primary and an
independent read-only audit checked the redacted aggregate; private case IDs,
source text, answers, artifacts, and credentials remain outside this report.
The [F1–F6 contract](../plans/fresh-reliability-smoke.md) and the
[runner candidate, PR #217](https://github.com/Cairn-ink/cairn-memory/pull/217)
define the execution boundary. Runtime
`45eca22639836e8035c3ccbbe6403a9f5c076b1d` was an unmerged candidate,
not a merged or released version.

| Arm | Generated | Judged | Correct | Wrong | Unresolved |
| --- | ---: | ---: | ---: | ---: | ---: |
| Cairn | 6/6 | 6/6 | 2 | 4 | 0 |
| Full history | 6/6 | 6/6 | 3 | 3 | 0 |
| No memory | 6/6 | 6/6 | 0 | 6 | 0 |

Every arm passed the predeclared **at least 95% completion** checkpoint: at
this N, it requires 6/6 judged answers. These judged labels are not a 95%
accuracy result, a demonstrated improvement, or competitor parity. The frozen
arm order and paired blocking remain limitations. Historical 30-case results
are unchanged: Cairn 15/8/7, full history 19/8/3, and no memory 2/25/3
(correct/wrong/unresolved). These cohorts and protocols are not interchangeable.

The run used `gpt-4.1-mini-2025-04-14` for memory and answers and
`gpt-4o-2024-08-06` for judging, with `answer-v2`, `case-deadline-v1`, and
`bounded-v1` transport diagnostics. All 18 answers had `finishReason=stop`;
no generation or judge answer was silently dropped. The existing public pilot
exercised embedded default core capture and recall. It did not opt into native
v2 qualification, explicit recovery, or `captureDeadlineMs`; installed-host
behavior remains a separate gate.

All 275 capture batches completed, recording 1,281 admitted references, not
1,281 unique memories. The prepared histories contained 2,956 turns and 2,969
chunks; 1,222 turns and 1,229 chunks exceeded the receipt's 800 UTF-16-unit
bound, with 1,520,919 units omitted at that source boundary. Answer packing
included 11 receipts; three came from truncated chunks whose 2,764 omitted
units are part of the 1,520,919-unit total, not an additional packing loss.
These observations do not establish which text any answer needed.

All six Cairn recalls reported `budget_exhausted`: bounded map/fetch traversal
did not prove full coverage. This is not a monetary, request, or case-deadline
failure. `sourceSelectionCoverage` was explicitly unassessed. The ordinal
candidate-to-answer-packed counts were `0→0, 1→1, 1→1, 1→1, 2→2, 1→1`;
there was no observed packing loss among returned candidates. These counts do
not establish whether necessary evidence was visible, selected, or correct.
There was no diagnostic drop or overflow in the recorded run. Causes of wrong
answers remain unobserved and unknown.

| Phase stage | Requests | Reserved USD | Reported known actual USD | Actual cost unknown |
| --- | ---: | ---: | ---: | ---: |
| Count | 568 | 2.840000 | — | 568 requests |
| Generation | 568 | 2.840000 | 0.883776 | — |
| Answer | 18 | 0.914760 | 0.272811 | — |
| Judge | 18 | 0.187200 | 0.008334 | — |
| **Phase total** | **1,172** | **6.781960** | **1.164921** | **568 requests** |

The phase's 1,172 requests were successful and the fixed prelaunch projection
reserved exactly USD 6.781960; zero requests remained unsettled. The 568
unknown-cost count requests are not free, and the known actual column is not
an invoice. The shared cumulative ledger reached 12,633 requests and USD
86.171460 reserved against its USD 100 operational cap and USD 200 user ceiling.
No reservation was refunded or reset. Completion alone does not authorize a
scored Mem0 comparison: temporal replay, outbound and shared-cost guards,
balanced independent arms, and fixed-N comparison accounting remain to be
frozen and checked. S2–S5 remain open.
