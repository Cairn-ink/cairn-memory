# Natural rationale trace packet

This is an offline, synthetic, source-only diagnostic of the existing automatic
capture path. It measures observable plumbing and lifecycle, not model accuracy.

## Acceptance contract

- NR1. `runDecisionEvolutionCore` keeps its current default output and capture
  settings. An explicit opt-in enables the real core's `source-bound-v2`
  qualification and `source-bound-v1` automatic rationale on every case. It
  uses only the injected model and ordinary `capture`; it never calls `admit`,
  manually reviews rationale, or writes relationship proposals itself.
- NR2. Each opted-in event reports capture, classification and rationale status,
  and every actual `relate` request in that event reports its bounded local
  receipt excerpts, observed candidate window and proposed edges. The observer
  forwards the original call, return or rejection without changing them.
  Only actual retained receipts with matching event ID and canonical excerpt
  can map a model-visible passage to a source event. Missing, identical or
  clipped passages are marked unmatched, ambiguous or truncated; no model input
  receives rubric data or a provenance key.
- NR3. The report distinguishes absent admission/source, no candidate,
  candidate seen, no proposal and stored model-proposed relation. Capture-time
  proposal and persisted lifecycle are separate observations, including a
  second observation after cold reopen. It reports source evidence and edge
  direction, not a semantic pass/fail judgment. The current vocabulary is only
  `supports-decision` and `challenges-premise`; no supersession or tentative
  positive role is inferred.
- NR4. Scripted integration tests exercise automatic capture, a candidate
  window beyond six, callback failure, ambiguous identical excerpts, filing
  preservation and cold reopen. They establish orchestration only, never
  precision, recall or decision-state accuracy. Run focused tests on Node
  22.16 and 24.15, plus repository validation; no live calls or credentials.

The source fixture contains only attributed events and questions. Its actor
and timestamps remain untrusted source claims. The separate rubric is neither
loaded by this runner nor passed to models. A trace can prove which retained
passages were presented and which proposals persisted; it cannot establish that
a proposed relationship is true, that discovery was complete, or that memory
improves an answer. Unknown and incomplete observations remain denominators.

## Frozen pre-live review criteria (not runner input)

For a later separately authorized, guarded dev-only pilot, nonblind agent
semantic source review should read the actual source excerpts and each emitted
support/challenge edge. This is not independent human review or a hidden
holdout. In `dev-vendor-transition-en`, d1 is the old adopted A choice on price/quality,
d2 considers B, d3 is tentative B while A remains adopted, and d4 explicitly
adopts B. In `dev-tentative-zh`, d5 adopts A and d6 is tentative B without a
replacement. In `dev-premise-failure-en`, d7 supports A for offline use and d8
challenges that premise without replacing A. In `dev-other-actor-zh`, d9 and
d10 belong to separate actors/projects; neither supplies the other's reason or
supersession. Review attribution and scope, and report candidate-window
omissions separately from the semantics of edges actually proposed. An empty
proposal is not reliable success. Do not require a `supersedes` relationship:
the current automatic vocabulary cannot express it. These criteria are not
loaded by the runner or added to any model prompt.

## Delivery evidence record

Bounded Sol/high implementation from dependency base `a8f686c22251127b0aab4b2bb4c87f353c150c01`
on `test/natural-rationale-trace`; primary owns commit, independent review and
delivery. The root's inspection found and prompted corrections to cold-reopen
stage ordering, exact stored-edge identity matching, and observer failure
semantics. No provider calls, credentials, paid requests or production data
were used. Final focused integration and new trace tests: 19/19 passing on
Node 22.16 and 24.15; `npm run validate` and `git diff --check` passed. These
scripted results do not measure model semantic quality, answer accuracy,
latency or cost. Token/cost data were unavailable.
