# Selective rationale correction: one bounded diagnostic

This is a source-backed synthetic diagnostic, not evidence of product truth or
general model accuracy. The frozen [fixture](../evaluation/architecture/rationale-correction-fixture.json)
and [rubric](../evaluation/architecture/rationale-correction-rubric.json) contain
three constructed histories. One pinned installed candidate reviewed each
history once with the explicit `replace-reviewed` mode. It made six guarded
HTTP requests in total, with no retry or automatic capture replacement.
The full private responses were retained; the public projection maps private
memory and receipt IDs to the fixture's source IDs and includes all pre-review,
post-review, and cold-read graphs. Mechanical completion is not semantic success.
The [complete public evidence](../evaluations/results/rationale-correction-v1.json)
contains all eleven proposals, including the wrong-way encryption challenge.

| Case | Source-level assessment |
| --- | --- |
| Retracted offline report | Source-plausible. The review retained offline support, withdrew the mistaken report's challenge, and linked the retraction to that report. Whether a known-false report should count as a `premise` remains an ontology question. |
| Verified export loss (Traditional Chinese) | Source-plausible. The current verified loss challenges the original decision directly. This differs from the rubric's challenge to the historical premise, but is a defensible alternative link; the decision was not changed in the source. |
| Mixed distinct premises | Consequential failure. Local-editing support and the retraction's rebuttal are defensible. The review instead made the historical encryption observation challenge the later verified loss, reversing the temporal direction. It omitted a distinct encryption-observation support link and a current-loss challenge to that premise or the decision. The decision text still contains its historical encryption reason; the failure is the missing distinct evidence link and unassessed current challenge, not erasure of all reason text. |

The review produced eleven proposed edges across the three cases. The source
assessment is two source-plausible cases and one consequential failure, not a
`2/3` accuracy estimate. In particular, an edge differing from the rubric can
be legitimate, and the retraction-to-mistaken-report edge's `premise` label is
ambiguous. Review was independent of the operator's execution but nonblind to
the fixture and performed by agents in the same model family. These three
selected synthetic histories cannot establish natural capture or recall,
current-state binding, decision adoption, user benefit, or readiness to make
replacement automatic or default.

Accounting for this single attempt: six requests reserved 30,000 microUSD;
three generation calls had a combined 1,243 microUSD usage estimate and three
count calls had unknown cost. Reservation is not an invoice. The cumulative
read-only ledger ended with 2,225 requests, 25,202,000 microUSD reserved,
1,372,613 microUSD known usage, 1,038 unknown-cost calls, and zero unsettled
requests; it was not reset for this diagnostic.

The exported record pins source head
`0c7c40bdb738c1144d12f3a21084619e4b084f96`, fixture SHA-256
`94618f4b471db220e460891914945e524978e6bd581e955486d3317e9bfac267`,
rubric SHA-256
`e1bea2aca147988fc6965319edbbe395b2099774160c31c18ef6bcb60e09be8b`,
operator SHA-256
`084081a82f01aab7bc9450672db25ac62ef1f47c13ab82e9b03287898202eea0`,
preload SHA-256
`d714c6f493af9dc159df4e3ecf7b645b64292054e491b2cfbc4468fd20a5d442`,
and installed archive SHA-256
`c6e88423ee4764fcf8ebfbd4359b66d89aa7a076b3315db302e3e80f049fe59c`.
These identify this run; they do not validate the semantic conclusions by
themselves. No additional paid run is needed to inspect this failure.

- Raw private report SHA-256: `f87e151d3f26f3ab08836ab7083cf35529cea29489102a56839f8ade0bcfdebc`.
- Public projection SHA-256: `319d78841d738b0949b76e11a18c99576b5e7f49d7749a27490c3d7615e79e3f`.

The exporter is closed to this completed diagnostic and its fixed accounting;
it is not a general exporter for other interrupted campaigns. Malformed review
output is preserved as a failed proposal with a digest, not an empty success.

## DRI decision

Do not promote automatic replacement or claim reliable temporal reasoning.
Keep the mechanical correction capability explicit and its interpretations
unverified. The [next investigation](plans/rationale-temporal-next.md) isolates
chronology/coverage instructions on fresh paired cases before considering more
complex temporal annotations or graph-aware edit proposals. This run's failures
remain evidence; another attempt on the same cases would not be a fresh score.
