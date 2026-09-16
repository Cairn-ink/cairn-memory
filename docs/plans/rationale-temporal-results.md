# Paired chronology evidence acceptance

Base: `620044ddde593074a83355d1d8441d830e5570ca`. This documentation/evidence
slice must not change the frozen fixture, rubric, guidance, core or operator.
There were no results when this plan was written. The separately guarded
once-only run has now completed after its CI/preflight and resource gates;
this slice only projects its retained evidence and source review.

- TE1: Account for every one of six frozen histories and both scheduled arms,
  including any failed or not-run slots. Map private memory/receipt IDs only to
  the fixture's source IDs and receipt indices. Retain every raw proposed edge,
  successful/failed review status, complete direct/incident graphs, source and
  cold-read integrity results. Malformed output must remain a failure with a
  digest, not a successful empty graph. No headers, credentials, private paths,
  namespaces, persistent/provider IDs or arbitrary error text in public files.
- TE2: Record fixed source/operator/cold-reader/fixture/rubric/guidance/archive
  hashes. Primary independently reconstructs the projection from retained raw
  transport evidence and compares it with actual warm/cold snapshots. Retain
  prior negative evidence unchanged. A static synthetic JSON/report is enough;
  do not add a general export framework solely to format this experiment.
- TE3: Verify per-arm and cumulative requests, conservative reservations,
  known usage estimates, unknown costs and unsettled calls against a read-only
  query of the same campaign ledger. Never call reservations an invoice or
  unknown costs zero. Review durations include guard and local work; they are
  not isolated model latency or a performance benchmark.
- TE4: Independently assess all outputs against the previously frozen source
  rubric, including alternative legitimate links, false temporal/scope links,
  missing challenges, missing distinct support, abstention and uncertainty.
  Report paired observations, not a broad accuracy estimate. These are adapted
  synthetic cases with nonblind same-family agent review, manual admission,
  complete supplied sources, no seeded old graph and an embedded evaluation
  facade; they do not establish natural capture, retrieval, MCP integration,
  old-edge correction, user benefit or production default readiness.
- TE5: Decide the next engineering step from failures and improvements without
  rerunning or tuning on this scored set. Primary owns semantic judgment and
  final accounting; worker owns bounded report/artifact assembly. Run generic,
  JSON/strict plugin checks on Node22.16/24, privacy and exact-evidence checks,
  then independent fixed-candidate reviews and exact-head CI. No paid calls,
  merge, package publication or deployment are authorized by this evidence slice.

## Evidence assembly checkpoint

The private final-report SHA-256 is
`bf9bf0b13793e7c3036cadb6b31fb02e64ee4d36d060092c79648bd740eec2b6`.
The inert private projection verified the fixture/rubric/guidance/operator/
cold-reader/archive pins, all twelve per-arm result files, all 24 request and
response files, normalized source/receipt mappings, and equality of every
mapped post-review and cold graph. It projected all 30 raw proposed edges,
including unsupported and ambiguous ones, without private IDs or paths.
Attempt accounting from the retained report is 24 requests, 120,000 microUSD
reserved, 4,999 known-usage microUSD, twelve unknown-cost count calls and zero
unsettled. The primary's separate read-only query of the same ledger confirmed
the cumulative 2,249 requests, 25,322,000 microUSD reserved, 1,377,612
microUSD known usage, 1,050 unknown-cost calls and zero unsettled. The
primary independently read and ran the inert mapper in verification mode: all
12 arms, 30 proposals and 288 graph views matched, with no private-field hit.
Fixed-candidate review remains an acceptance gate; no further paid call is needed.

The worker ran the inert projector's `--verify` mode against the public JSON:
12 arms, 30 raw proposals, 288 graph views and no private-field scan hit.
`npm test` passed 121/121 on Node 22.16.0, and the same generic test command
passed 121/121 on Node 24.15.0. JSON validation and marketplace plus strict
plugin validation passed on both runtimes. These checks were offline and did
not exercise a model.

Primary acceptance independently repeated the generic tests, JSON validation,
and marketplace/strict plugin validation on Node 22.16.0 and 24.15.0; all
passed. `git diff --check` passed. The projected artifact SHA-256 is
`9f62b20193ba34ea8bec7d5888b615b249d8c26fa9e653ccfe060de9d6276c6f`.
