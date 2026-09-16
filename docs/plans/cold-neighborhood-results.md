# Cold-neighborhood comparison evidence delivery

Fixed base: `964e4e5879956adb816c4920f2cda7a01015a6e3`.
The retained private report has SHA-256
`9c72e31c227b75893881f4e3016406f597d3a0b00d38c859def6d17b8c7453b9`.
This packet publishes a sanitized account of the already-completed one-shot run;
it does not dispatch or authorize another request.

## Acceptance

- CNRE1: Preserve all four frozen cases and eight arm slots, including the two
  unrun slots. Distinguish six `generated-unassessed` mechanical answers from
  semantic quality; never promote either mode or compute an accuracy percentage.
- CNRE2: Retain the six exact answer texts and, per arm, the original source
  passages actually delivered to the answer model. Map retained receipts back
  to fixture message IDs and distinguish selected-root from linked-neighborhood
  delivery. Record submitted, retained, selected, expanded and delivered
  evidence separately, including exact-anchor coverage and missing anchors.
  Preserve capture-stage statuses and warnings.
- CNRE3: Describe the global halt at request 122, including the aborted
  `qualifyCandidates` count/generation sequence and the difference between the
  last capture's started attempt and its stale `not_run` report slot. Retain
  every failed/unrun case and arm without retry, replacement or repair.
- CNRE4: Reconcile 122 attempts (116 core, six host), 880,000 micro-USD of
  conservative reservation (not an invoice), ledger deltas 2,273→2,395
  requests and 25,442,000→26,322,000 reserved micro-USD, zero unsettled
  reservations, 55,808 micro-USD increase in known usage estimates and 59
  requests with unknown cost. Publish only run-local counts, not campaign rows.
- CNRE5: Preserve the primary-verified result that all six completed arms'
  full before/after source-and-graph snapshots match their case baselines.
  Keep transport completion, evidence availability, answer support and semantic
  judgment distinct. A whole-read-path comparison cannot isolate graph-edge
  causality or establish general readiness.
- CNRE6: Use the frozen evaluator-only rubric unchanged. Record per-obligation
  source sufficiency and exact-anchor coverage separately, including optional
  historical obligations. Incorporate the two independently made, agreeing
  primary and independent AI-agent qualitative judgments without a separate
  paid provider judge call; partial literal
  rubric coverage must not be conflated with a useful supported answer.
- CNRE7: Publish only synthetic fixture-local IDs, source excerpts, model answer
  text, its four ephemeral receipt UUID citations with fixture-ID mapping,
  code/artifact hashes and sanitized run-local accounting. Exclude
  credentials, private paths, account/run/request IDs and whole-campaign data.
  Add a bounded generic conformance test for hashes, shape, counts, coverage,
  exclusions and failure/nonpromotion labels.

## Scope and verification checkpoints

Allowed writes: this plan, `docs/cold-neighborhood-comparison-results.md`,
`docs/cold-neighborhood-comparison-results.json`, and one scoped generic test
under `evaluation/architecture/test/`. The source fixture, rubric, operator,
provider, guard, ledger, public runtime and prompts are frozen and unchanged.

Before candidate freeze, verify the retained report hash and exact source,
rubric and answer-byte projections; inspect the public artifact for private
identifiers or paths; run the focused test, `npm test`, `npm run validate`,
JSON validation and strict plugin/marketplace validation on Node 22.16 and
24.15. Do not commit until the agreed semantic judgments are incorporated and
primary acceptance is ready.

## Implementation and verification record

The retained private report hash matched its fixed pin. Read-only comparison
against that report verified all six published answer strings byte-for-byte,
the order and root/linked origin of 21 delivered source groups, and the exact
text/role/fixture mapping of 25 delivered receipt occurrences. The public
projection also independently compared the six completed arms' full private
before/after snapshots with their respective cold case baselines.
The public
test recomputes every missing exact rubric anchor from the frozen fixture and
public source catalog; source sufficiency and answer support remain qualitative
AI-agent judgments rather than assertions inferred from string matching.
Primary and an independent AI-agent reviewer separately agreed on the bounded
judgments in the explanation, including partial literal obligations despite
useful supported answers. No new paid judge call occurred.

The focused conformance test passed 2/2. On both Node 22.16.0 and 24.15.0,
`npm test` passed 143/143, `npm run validate` passed, and
`npm run validate --prefix tools/plugin-validation` passed marketplace and
strict-plugin validation. `git diff --check` passed. These are publication
consistency gates, not a model rerun or a semantic accuracy test. The final
candidate still requires primary acceptance and independent fixed-diff review
before push/PR; no merge or provider call is part of this packet.
