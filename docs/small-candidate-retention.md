# Small-candidate retention policy experiment

Status: evaluation-only; no core, MCP or host default changes. This is not a
semantic quality result or a new memory engine.

Earlier comparisons sometimes selected and fetched an important update, then
discarded it during ranking even though the selected set fit the requested
result limit. This wrapper isolates that second loss point. It does not repair
updates missed by map navigation or selection, and does not establish that a
host interprets retained evidence correctly.

`createSmallCandidateRetentionModel(model)` in
`evaluation/architecture/small-candidate-model.mjs` wraps the existing rank port:

- At or below the requested limit, keep every fetched candidate's exact
  namespace index, memory ID and revision, in existing order. There is no
  provider rank generation; empty input returns no references.
- Above the limit, delegate once to the captured original rank method with the
  complete unchanged, detached input. No retry, truncation or fallback.
- Keep selection and other ports unchanged. Capture and bind the rank method
  and tokenizer to their original model. The wrapper does not discover keys,
  access a database or make HTTP calls itself.

The experiment runs inside the real shared core's existing `callModel` and
final-read path. Existing token limits, cancellation, identity validation and
source freshness checks still apply. The wrapper snapshots ordinary JSON data,
rejects accessors and malformed references, and checks the counted request and
synthetic output. It does not certify freshness when called outside that core.

## Offline evidence and the tradeoff

The independent scripted tests use the actual local core with temporary
synthetic SQLite stores. A baseline ranker drops a selected price update; this
policy retains both the original reason and the update. Correction and forget
callbacks invalidate stale output. Pure tests additionally cover ordering,
cross-namespace reference identities, larger-set delegation, immutable snapshots,
token limits, malformed requests and aborts.

The negative case is intentional: a baseline ranker returns nothing for another
actor's material and unadopted advice. This wrapper retains both when they fit.
That is unwanted exposure, not improved relevance. Tests demonstrate a policy
mechanism, not semantic accuracy. Node 20 runs the pure tests; the SQLite case
explicitly requires Node >=22.16.

## Required before integration

Freeze a fresh comparison before any scored real-model calls. Include relevant
updates, mixed actor/advice distractors, entirely irrelevant selected sets, and
larger sets. Compare the same selected candidates to isolate ranking, then
separately evaluate end-to-end navigation and host answers. Retain failures and
missing answers; do not regenerate them away.

Report required-source retention and irrelevant-source exposure separately,
alongside saved rank calls, added context bytes/tokens, latency and cumulative
cost. Human review must examine current versus historical reasons, tentative
versus confirmed decisions, actor attribution and unsupported authorization
claims. More returned sources or fewer calls alone cannot justify promotion.

No real-model run, paid budget allocation, product promotion, package release
or deployment is performed or authorized by this package. See the
[acceptance plan](plans/small-candidate-retention.md).
