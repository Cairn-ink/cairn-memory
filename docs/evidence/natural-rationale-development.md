# Natural rationale: first source-built development result

This is the one-shot synthetic development pilot at candidate
`f2a79f9e6bf0be638945606e84a31f659917496c`. The [closed public
projection](../../evaluations/results/natural-rationale-dev-v1.json) retains
the four cases, ten source events, four questions, every relation candidate
window and proposal, source-linked before/after/cold graph views, and all three
read arms. It retains event IDs, not the event text; read the [frozen source
fixture](../../evaluation/decision-evolution/fixture.json) to interpret `d1`–`d10`.
The exact source, runner, observer, adapter, prompt, schema, guard
and operator hashes are embedded there. The private raw report and provider
messages are not published.

All four cases mechanically completed: ten relation calls returned five
proposals, all five appeared in the stored graph and survived cold reopen.
There were no failed or not-run case slots. This is not a semantic pass rate.

| Proposed link | Source review | Why |
| --- | --- | --- |
| `d1 → d2` challenges-premise | Unsupported | `d2` considers B; it does not refute A's lower price or adequate quality. |
| `d3 → d3` supports-decision | Unsupported | B is still tentative and A remains approved; the link risks treating a preference as adoption. |
| `d4 → d4` supports-decision | Supported | Approval is complete and B is adopted after the better-quality trial. |
| `d5 → d6` supports-decision | Ambiguous | `d6` confirms continued use of A, not adoption of B; the proposed link's exact grounding is unproven. |
| `d8 → d7` challenges-premise | Supported | The startup connection requirement directly contradicts the earlier fully-offline reason. |

Five events reached relation candidate windows without a self-support
proposal: `d1`, `d5`, `d7`, `d9` and `d10` have no corresponding
self-support edge. The separate actors in `d9`/`d10` were not linked across
people. These are observations of the fixed run, not evidence of a dependable
abstention rule.

Read behavior remained limited. For `q1`, source-evidence and
rationale-evidence each returned only `d4`, while sourceSnapshot returned all
four event sources. For `q3`, the stored `d8 → d7` challenge existed, but the
rationale read reported `unassessed-not-linked`; its returned source IDs were
`d8,d7`, so the missing piece was edge exposure, not source absence. This is the
**pre-fix paid observation**; the later [direct-premise challenge fix](../plans/direct-premise-challenge.md)
was verified offline and this paid pilot was not rerun. No host answer was
generated or graded.

The attempt made 112 guarded HTTP requests, reserving USD0.560000. The
usage-priced known delta was 25,971 microUSD and 56 requests had unknown
actual cost; these are not invoice totals. The shared cumulative phase ledger
ended at 2,117 requests and USD24.786000 reserved of the authorized USD50,
with zero unsettled requests. Unknown costs retain their reservations.

Interpretation is narrow: synthetic source-only inputs, four development
questions, one baseline model, one run, and nonblind source review. The pilot
used the embedded actual core, not an installed MCP host; it did not test
answer correctness or real-user reliability. Do not promote replacement edges
from these observations. The concrete next investigation is the known read-edge
omission, followed by a separately frozen held-out comparison of semantic
checking and task-conditioned source views. Neither is established by this run.
