# Lightweight relation definitions: partial improvement, not reliability

The short [relation guide](relation-definition-lite-guide.md) reduced unsupported
links in this one frozen synthetic comparison, but did not improve complete-case
coverage. Keep it experimental; do not promote a runtime default from this result.

| Frozen measure | Existing prompt | Existing prompt + guide |
| --- | --- | --- |
| Completed model calls | 10/10 | 10/10 |
| Proposed edges | 6 | 6 |
| Unsupported edges | 3 | 0 |
| Omitted required obligations | 10/13 | 7/13 |
| Complete cases (no omissions or extras) | 4/10 | 4/10 |
| Failed / malformed / unrun | 0 / 0 / 0 | 0 / 0 / 0 |

Thirteen obligations are not thirteen memories: one reaffirmed decision accepts
any of four valid support pairings. The two no-adoption cases correctly require
no edges and count as complete in both arms. Even excluding them, complete
positive cases remain 2/8 in both arms. Fewer unsupported edges is not a complete
memory loop, and zero observed errors is not a general precision guarantee.

## Every observed case

`S01` means supports-decision 0→1; `C10` means challenges-premise 1→0.
All selected receipt indices are zero; `empty` is a successful empty proposal,
not a failure. Indices refer only to that case's
[source fixture](../evaluation/live/relation-definition-fixture.json).

| Case | Existing | With guide | Source-semantic inspection |
| --- | --- | --- | --- |
| English pump | empty | empty | Both miss the explicit choice/because self-support. |
| Chinese pump | C10 | C10 | Correct noise challenge; both miss the original support. |
| Two storage reasons | empty | C10 | Guide catches changed price, not an invalidated key-location reason; both miss support. |
| Considering calendar | empty | empty | Correct abstention: no adopted choice. |
| Tentative translator | empty | empty | Correct abstention: no adoption; ambiguous network referent. |
| Explicit notebook replacement | S01 | S11 | Old A/offline reason does not ground new B/export choice. Guide fixes that link but misses historical A support. |
| Chair color elaboration | S00 | S00 | Both preserve the seat-height reason without inventing a color challenge. |
| Reaffirmed cafe and reason | S01 | S01 | Both valid. Repeated explicit reason; not a minimal-edge test. |
| Different chat users | C02 | S00 | Existing direction is reversed. Guide retains Mina's support but misses the later C20 and Hazel's independent S11. |
| Historical lunch and advice | S02 | empty | Thanks and no new choice do not adopt the suggestion. Guide avoids false adoption but misses historical support. |

Primary and an independent nonblind Sol/high agent inspected all twelve proposed
edges against the twenty-one source memories. Their judgments agree with the
frozen rubric; no rubric or case was changed after observing outcomes. This is
same-family agent review, not external human validation.

## What this isolates—and does not

The same `gpt-4.1-mini-2025-04-14` adapter, source inputs, strict two-type schema
and input/output ceilings run twenty fixed slots, alternating arm order by case.
The candidate changes only the instructions by appending the guide. Every case's
complete supplied memories are visible; there is no MOC selection or label
truncation in this experiment. These omissions therefore occur in relationship
proposal generation, not retrieval in this particular test. This does not rule
out separate MOC retrieval failures elsewhere.

Both arms emitted at most one edge per case despite permission to emit ten.
That observation suggests testing explicit coverage, not assuming an output
schema or model capacity cause. Even the one-card English choice/because example
was missed by both arms. Clearer definitions alone did not solve that omission.

The guide distinguishes six concepts, but only support and premise challenge
are emitted wire types. Tentative discussion, continuation and replacement do
not become persisted new relations. No store, graph, default prompt, MCP tool
or automatic decision state changed. This direct adapter comparison does not
test extraction, automatic capture, installation, storage, downstream answers
or real-user longitudinal benefit. The small nonblind, single-model, single-run
sample has no variance estimate or held-out product-quality claim.

## Next bounded test

Retain the definitions as a provisional vocabulary. Next compare a source-by-
source coverage check against free-form edge proposals, reusing the existing
[decision-basis units and source anchors](source-basis-review.md), not building
a second engine. First identify explicit decisions, their reasons and updates;
then assess their links. An accounted-for source may correctly have no decision
or no link—coverage must not force adoption or invented edges.

Use fresh cases under matched cost/token limits, measuring omissions and extras
together. Only a subsequent natural-capture/reopen/recall comparison could show
whether this helps the actual memory loop. Do not retry this sample to improve
its score or enable the guide by default based on this run.

## Cost and provenance

One run used 40 HTTP requests: 20 counts and 20 generations. It conservatively
reserved US$0.20 under the US$0.32 additional ceiling inside the existing US$50
campaign. Available generation usage gives US$0.006691 at the campaign's frozen
rates; 20 count requests have unknown cost and retain reservations. These are
usage-priced estimates and reservations, not an invoice. No retry, new grant,
budget reset or unsettled attempt occurred; the session and ledger closed.

Per-arm elapsed slot totals were 20.169s existing and 22.512s with guide; medians
were 1.793s and 1.926s. These include token-count requests and local evidence work,
not a controlled performance benchmark.

Execution source: `bc17cf10561c3e9efc4a47be3d04be44463bc020`, after independent
Standards and Spec passes and both runtime offline gates. The prereview
reaffirmation ambiguity was resolved and re-frozen before any paid request.

Private sanitized report SHA256:
`6604016100512caefd1c8a8e683115b0e0867a71272c75a8ba800aa64ee89312`.
The [frozen numeric/enum projection](../evaluations/results/relation-definition-lite-v1.json)
retains all twenty slots, twelve edges, latency and accounting without provider
text, identifiers, local paths or credentials. Its SHA256 is
`45b9f167d0417aec4a10bc16aac6ff674ceffb90fec9a3d68345479c4552a0a3`;
it also records the fixture, rubric, guide, operator and scorer digests.
