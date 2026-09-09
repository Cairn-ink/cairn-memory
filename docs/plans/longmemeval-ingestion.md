# Source-mapped LongMemEval capture ingestion

Base: `7d0d6ec659f56a475e7001d02ffc22e62fedbf59` (#33/#34 merged).
Track B next slice consumes only answer-blind prepared history. It does not
score answers, send data to a provider, tune models or alter the public engine.

## Acceptance I01–I08

- I01: Strict in-memory API accepts one prepared history case (opaque question
  ID and indexed sessions/turns) and explicit exact core namespace. Validate
  closed field allowlists, occurrence indices/order, unique turn IDs, role/text,
  preserved dates and identifiers. Reject evaluator/manifest/answer annotations
  before invoking capture. No file/network/key discovery or implicit namespace.
- I02: Build a deterministic full-case capture plan with no raw-source truncation.
  Split oversized turns on Unicode code-point boundaries; preserve ordered raw
  UTF-16 offsets, original case/session occurrence/date/turn/role and unique
  chunk IDs in source maps. Reassembly of every turn is byte-for-byte identical
  to prepared text. No deduplication, speaker collapse or cross-session batches.
  Derived bounded hashed core session/message/event IDs prevent source collisions.
- I03: Every batch passes the actual existing captureSnapshot preflight: <=24
  messages, <=4000 normalized UTF-16 units each, <=20000 total. Respect the raw
  20000 input bound, normalization expansion, whitespace/redaction and astral
  characters; preserve raw source separately from normalized capture text.
  If a turn cannot be admitted (empty, fully redacted, invalid text), retain an
  explicit blocker and forbid execution of the entire case instead of silently
  dropping it. Retain blocked turns' raw source for reconstruction too. If
  full-turn NFKC/redaction changes text and a single-message preflight cannot
  admit it, block rather than split a credential into unrecognized fragments.
  Test a secret spanning a prospective chunk boundary with zero capture calls.
  Size compatibility does not prove model context/token fit.
- I04: Inject a capture function; no production provider/default transport.
  Execute validated batches sequentially, recording every planned batch with
  completed/duplicate/partial/failed/unknown/not_run outcomes. Stop after processing,
  failed envelope, classification failure, malformed response or thrown/unknown
  outcome; retain remaining batches as not_run. Never retry automatically or
  assert failed extraction made no writes. Blocked plans make zero calls.
- I05: Preserve source linkage from captured receipt event/session IDs back to
  exact original turn intervals without feeding labels to the extractor. Tests
  use the actual public core and synthetic SQLite stores with scripted models;
  verify receipts, deterministic completed replay without another model call,
  forgetting then replay cannot resurrect memory, and exact case namespaces
  cannot leak to one another. No second storage/extraction engine.
- I06: Offline tests on Node22.16/24 cover allowlists, poisoned metadata,
  oversized/astral/normalization-expanded text, long sessions and repeated
  session IDs at distinct occurrence indices, deterministic batches/maps,
  reconstruction, blockers and every runner stopping condition. Sensitivity
  assertions must catch truncation, role changes and source collisions.
- I07: Primary additionally plans the existing pinned seven-case real-data
  preparation without calling models; verify every source turn reconstructs and
  every planned batch passes actual preflight. Report blockers honestly. Keep
  source data/generated artifacts out of git and no real corpus in core tests.
- I08: Document API and exact synthetic demonstration, interpretation limits,
  dates as source metadata (not secretly inserted into dialogue), lossless raw
  source versus intentionally normalized/redacted engine input, and split-turn
  context limitations. Wire CI, contributor gates and changelog. Independent
  Standards/Spec review final candidate. Scorer, reliability breadth, live pilot
  and full benchmark remain later steps; no benchmark-success claim.

## Ownership

Primary owns acceptance/docs and real-data preflight. Sol high worker owns
evaluation/longmemeval ingestion implementation/tests and package/CI wiring.
Do not change core, prepared schema, provider, MCP, Hermes or private code.

## Verification record

Primary and worker independently ran the final ingestion tests and synthetic
demo on Node 22.16.0 and 24.20.0. The primary's complete
`npm run test:longmemeval` passed 23/23 on each (15 preparation + 8 ingestion).
`npm run demo:longmemeval-ingestion`, `npm test` (31/31) and `npm run validate`
passed on both. Pinned Claude 2.1.260 marketplace and strict plugin validation
passed. All product probes used sanitized environments without provider keys.

The primary separately authored an actual-core integration probe: a synthetic
5,435-unit turn became two capture messages; a scripted extractor/classifier
admitted one memory through the real public SQLite core. Its receipt event ID
and session ID mapped to the original source interval. Other owner/project
namespaces returned no memories. Removing model methods before replay still
returned duplicate without a second extraction; forgetting then replaying did
not resurrect the memory. The final probe passed on both runtimes with separate
new SQLite files. This verifies orchestration, not real-model source judgment.

The primary also read only the pinned prepared `history.jsonl`, after verifying
SHA-256 `02ef9286e77df82fa92919fc26da9cacc69a489dec66a650b03828a62db0e44f`.
The snapshot/revision and seven-case selection are recorded in
[preparation](benchmark-preparation.md#verification-record). No evaluator data
was provided to the planner. For each case the namespace was explicitly
`{ownerId: 'synthetic-evaluation', scope: 'project', projectId: history.question_id}`.

| Source-order case | Original turns | Planned chunks | Capture batches | Blockers |
| --- | ---: | ---: | ---: | ---: |
| 1 | 550 | 551 | 53 | 0 |
| 2 | 523 | 523 | 52 | 0 |
| 3 | 484 | 488 | 46 | 0 |
| 4 | 508 | 509 | 51 | 0 |
| 5 | 484 | 490 | 50 | 0 |
| 6 | 413 | 415 | 40 | 0 |
| 7 | 550 | 553 | 51 | 0 |
| Total | 3,512 | 3,529 | 343 | 0 |

Independent assertions checked every raw interval, contiguous coverage, exact
full-turn reconstruction, roles/dates/identities, unique message/event IDs and
the actual `captureSnapshot` messages/digest for every batch. Repeated plans
were deterministic. Sequentially hashing `JSON.stringify(plan)` for all seven
cases produced SHA-256
`766f460c4f610edb63d3513c32c2cff444dc3de0b0edac84d95248cfa4fa9a31`
on both Node versions. This real-data check performed zero capture/model calls;
no source or generated corpus was committed. A first probe used the proposed
`normalizedSnapshot` API name rather than the final `normalizedCapture` shape;
the probe/docs were corrected before these passing results.

Primary interventions required full-source retention for blocked cases,
credential-boundary blocking, opaque prepared IDs and capture callback snapshot
before awaiting. The boundary-secret fixture explicitly crosses position 4,000.
The demo originally cited a filler-only trailing chunk; it now cites the source
containing the demonstrated preference and asserts that excerpt directly.
Separate Sol high Standards/Spec reviewers inspect the final committed diff;
review SHA/results are recorded in the PR. Initial Spec review identified the
missing LongMemEval contributor instructions; CONTRIBUTING now specifies the
test/demo matrix and its no-key boundary. Runtime code is unchanged by that fix.
Agent costs and total elapsed time
were not measured. No private app, host profile, provider default, live traffic,
model quality claim, scorer or benchmark score is part of this slice.
