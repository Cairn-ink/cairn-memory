# Experimental relationship-disposition review

The embedded core now has an explicit, read-only
`reviewRationaleDispositions({ namespace, refs })` view. Supply one to six exact
current refs in one namespace and inject a model with a separate
`reviewRationaleDispositions` method and exact token counter. It is not part of
the OpenAI adapter, local MCP, automatic capture or a default review path.
There is no commit endpoint. A real injected provider would receive the
selected retained source excerpts and the existing relationship proposals;
this is extra potentially personal context and requires a caller's explicit
choice. No paid guard authorizes the new method.

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
right direction or a separate reason was captured. In particular, this view
does not repair the archived-case direction reversal or the old-decision
default-read visibility gap found in the [paired chronology diagnostic](rationale-temporal-comparison.md).
