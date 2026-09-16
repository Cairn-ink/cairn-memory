# Experimental relationship-disposition review

The embedded core now has an explicit, read-only
`reviewRationaleDispositions({ namespace, refs })` view. Supply one to six exact
current refs in one namespace and inject a model with a separate
`reviewRationaleDispositions` method and exact token counter. The optional
OpenAI adapter now implements that separate method through its existing
`rationaleModel` profile and two-phase count/generate transport. It remains
absent from local MCP, automatic capture and default review paths.
There is no commit endpoint. A real injected provider would receive the
selected retained source excerpts and the existing relationship proposals;
this is extra potentially personal context and requires a caller's explicit
choice. Pre-existing/default paid grants do not authorize this method. A
separate [explicit comparison capability](experiment-request-guard.md#closed-disposition-comparison-preparation)
can bound opted-in transport; this core or adapter port alone does not grant it.

The core atomically snapshots all current source receipts, the namespace epoch
and every stored proposal whose two endpoints are in the supplied refs (at
most ten). Crossing or unrelated proposals are outside this view. The model
sees only request-local memory, receipt and old-edge indices, excerpts and
roles. Each old edge is labelled `unverified`; no persistent IDs, namespace,
client/session/event metadata, stored summary, qualification or inferred time
is sent. The source text itself may of course mention dates or people.

The model must return exactly `{ dispositions, additions }`. Every old edge
needs one `keep`, `withdraw` or `unknown` disposition with distinct indexed
source-receipt citations. `withdraw` requires a citation; citation proves
attachment, not that withdrawal is correct. Additions use the existing
`supports-decision`/`challenges-premise` tuple contract, and cannot repeat an
old edge. Missing, duplicated, out-of-range and extra fields fail the whole
review. Empty old-edge sets can have additions. An empty disposition list does
not withdraw a nonempty old graph.

The returned `projectedEdges` retain `keep` and `unknown`, omit only explicit
withdrawals, and append additions. `unknown` stays visibly unresolved; it is
not a confirmed relationship. The response also includes complete selected
sources, old edges, dispositions and citations, additions, an unresolved count,
the guarded epoch, and `unassessed`, `model-proposed`, `not-stored` markers.
It is limited to ten projected edges and 24,000 UTF-16 units, with the existing
6,000-input/1,024-output-token and 30-second core limits. Oversize or stale
work fails rather than truncating or rewriting stored edges. The actual graph,
source records, qualifications, MOC and epoch never change from this review;
warm and cold ordinary rationale reads retain the pre-review graph.

This is a mechanical contract for inspecting an explicit proposed update, not
a semantic detector. Old proposals may themselves be wrong. The source
citations and complete coverage of old edges do not establish whether a
decision was adopted, a premise remains applicable, a challenge points in the
right direction or a separate reason was captured. It also does not guarantee
that every relevant reason or later update reaches a recall result. An earlier
[development trace](evidence/natural-rationale-development.md) observed a
pre-fix read omission; the subsequent fix was verified offline, and that paid
pilot was not rerun. The [paired chronology comparison](rationale-temporal-comparison.md)
is preparation, not evidence of this view's accuracy or a current failure.

The adapter accepts only the core's indexed source-and-old-edge input shape:
no namespace, persistent IDs or receipt metadata. It validates complete,
sequential, distinct old-edge tuples and their receipt indices before either
HTTP phase. A request-scoped strict schema bounds disposition, citation and
addition indices; the core still rejects missing/duplicate dispositions,
wrong endpoint–receipt pairings, invalid citations and oversize projections.
The adapter does not repair malformed output or classify source truth. The
existing static paid-schema allowlist excludes this method, so fake-HTTP
integration is not authorization for a real provider call.

The explicit port now uses a versioned v2 task prompt. It carries the ordinary
relation prompt's source-trust warning and verbatim definitions of both relation
directions, while retaining the disposition-specific output contract and the
combined ten-edge projection cap. The original disposition prompt remains
unchanged as development history. This closes an instruction gap before any
fresh scored comparison; it is not evidence of improved semantic judgments.
Matching relation definitions across future arms still compares their complete
output protocols, not an isolated causal effect of the disposition fields.

A separate [offline disposition-comparison capability](experiment-request-guard.md#closed-disposition-comparison-preparation)
can constrain a future baseline-model comparison to this method and an
old-graph-aware `relate` control. It does not enable automatic use, persist a
projection, create a live-run intent or establish semantic correctness.
