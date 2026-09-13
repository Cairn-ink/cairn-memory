# Rationale pilot v1 — mechanically complete, semantic gate not passed

Eight frozen two-event synthetic cases, two independent stores per case, same
`gpt-4.1-mini-2025-04-14` model. Baseline source evidence versus opt-in automatic
rationale evidence. The actual installed MCP artifact was used; all 16 arms
completed capture, recall, cold inspection, duplicate replay and forgetting.
There were no live retries or failed-case reruns.

This **does not pass the reliability gate**. Useful linked-source recovery in
two cases coexists with missed challenged reasons and one clear false-decision
relationship. No host answer was generated, and no real-user/competitor score is
claimed. See the [frozen sources and rubric](../evaluation/live/rationale-fixture.json)
and [public evidence](../evaluations/results/rationale-pilot-v1.json).

## What the source context actually contained

These are independent agent judgments checked against the recorded sources,
not human labels, blinded independent-model-family evaluation or an automatic
keyword score. The two reviewers agreed on the main context findings; raw
proposal inspection clarified an initially incomplete count of relationships.

| Case | Baseline | With rationale evidence |
| --- | --- | --- |
| Pump noise | Choice, advertised reason and contradictory measurement retained | Same useful context; no exposed challenged-reason path |
| Chinese notes | Original no-registration reason returned; actual registration requirement omitted | Same omission despite correction being stored |
| Two reasons | New price, unchanged encryption and continuing choice retained | Same useful context; price challenge not identified in exposed graph |
| Calendar suggestion | Non-adoption and correction retained; original assistant suggestion omitted | Same missing suggestion provenance |
| Third-party scope | Original choices retained; changed phone requirement omitted | Linked receipt restores second event, but relationship scope is ambiguous |
| Compatible chair | Purchase reason retained; later confirmation omitted | Correct support link supplies confirmation |
| Subjective career | Both time-scoped feelings and continued indecision retained | Faithful sources, but an unsupported decision relationship is returned |
| Ambiguous translator | Tentative preference, unknown referent and non-adoption retained | Same; appropriate abstention, not positive-detection success |

Returned excerpts preserve source wording/meaning and speaker roles. That does
not repair omitted context or make interpretations correct. Both calendar arms
also summarize the assistant suggestion as a factual benefit; their qualification
labels remain proposed/considered. Those summaries are omitted from source-only
recall, but the wrong career relationship is present in returned rationale.

## Proposals, accepted links and exposed graphs are different

The provider proposed **8 edge tuples**, and capture reports accepted insertion
of those 8. Final inspection exposes **4 unique support edges**, not the whole
relation table. It follows incoming decision supports and then challenges to
those premises; an orphan challenge without a support path is not exposed.
Consequently “zero exposed challenges” must not be reported as “zero challenges
proposed or stored.” The public evidence includes source-indexed proposals
separately from final graph projections for this reason.

- Pump and storage price each have a reversed challenge: the old advertised
  noise/old price is made to challenge the later measurement/raised price.
  Neither establishes the required later-evidence → original-premise relation.
- Calendar has two source-supported challenge tuples correcting the assistant's
  claimed benefit. These do not establish an adopted decision and have no exposed
  decision-support path.
- Two third-party support tuples are defensible as **Hazel reaffirmation at the
  receipt level**, because each endpoint receipt contains both people's claims.
  Their memory summaries are cross-bound between Mina/Juniper and user/Hazel.
  Calling them unambiguously false would ignore the receipts; calling them
  correctly subject-scoped would also overclaim. Mina's challenged reason remains
  unidentified.
- Chair support is supported by the exact source receipts.
- Career self-support is unsupported: its source explicitly says the user still
  has not decided. A `supports-decision` link must not imply adoption here.

None of the four positive changed-premise cases earns graph-detection success.
No explicit replacement/cancellation is asserted, but absence of replacement is
not enough: false adoption and omitted changed reasons still fail the goal.

## Accounting and latency

This invocation used **288 HTTP requests**: 128 baseline and 160 candidate.
Additional conservative reservation: **US$1.44**. Known priced generation usage:
**US$0.073096**, with 144 input-count requests whose actual cost remains unknown;
do not present the known component as the complete invoice.

The existing US$50 ledger moved from 204 to 492 requests and US$1.02 to US$2.46
reserved, with zero unsettled requests. No allowance was reset or replenished.
The separate US$1.92/384-request cap was not reached.

Mean arm wall time was 18.197 seconds baseline and 20.337 seconds candidate.
These include two captures, recall, evidence persistence, restarts and deletion,
not single-call latency. Eight observations per arm do not establish a reliable
performance distribution or production SLO.

## What changes next

Do not make rationale capture default or advertise semantic reliability from
this result. Keep the original observations immutable.

1. Bind proposed relationships to focused, source-backed claims and explicit
   endpoint roles, rather than ambiguous whole-memory/whole-receipt containers.
   Separate identifying a committed decision and its reason from proposing a
   challenge; unsupported or ambiguous adoption must remain unresolved.
2. Carry incoming versus previously stored evidence roles into automatic review
   and constrain direction without assuming every newer assertion is true.
   Reject a backward update interpretation; do not silently reverse it.
3. Make orphan/ambiguous relationship outcomes inspectable without promoting
   them to a confirmed decision or silently injecting them into answer context.
4. Diagnose the Chinese recall omission at the MOC selection boundary: both
   receipts reached relationship review, so candidate discovery alone does not
   explain the failure. Preserve relevant correction evidence through selection
   and ranking under the existing token bounds.

Engineering invariants can be locked down with offline tests. A replay of fixed
provider outputs reproduces their semantic errors but cannot establish that a
new prompt/model fixes them. Subsequent model-quality claims require fresh frozen
cases, explicit ablations and independent assessment—not rerunning these failures
until they look better.

## Provenance

- Runner commit: `3c15d25abecef4821a07baed6a7ecd7227d44ccc` (#74).
- Fixture SHA256: `a7d3042027bf8dee46df16ef99bbe5be9a86beb622139a2795efe79fc0d73409`.
- Installed artifact SHA256: `1b8aac55560c9ddd63ef0dfbdbecad66a3d93c8d115271f75264e569aa9a4391`.
- Private raw report SHA256: `4f00fc3cc649281f491ad3aabc5f84402d4afdf99fa3319af914403265d290d9`.
- Public source-linked projection SHA256: `0384051eac0c32e8cbb9c4e204a07c8f9c6c31808ff01160770638643dda752a`.

No user conversations, production stores, package publication or deployment were
involved. The raw report retains private local paths and is not published.
