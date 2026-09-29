# M2a: MCP access to already retained episode evidence

Status: implementation contract, not accepted or released. Fixed base:
`c2212ce12fa0f31d4847bfc3838f11db377fa51f`.

## Why this seam

The core can already capture a bounded episode with cited passages and zero
admitted memories, then read it after a cold restart without episode generation
enabled. The MCP server cannot currently discover or inspect those passages.
`read_memory_sources` reads admitted-memory receipts, not episode-only sources.
Expose existing core operations instead of adding storage, extraction, ranking,
or another source-retention policy.

This does **not** repair the historical N7 indexed-evidence run: that mode did
not produce episodes, and absent input cannot be recovered by a read tool.
It also does not establish semantic recall quality, a complete archive, or a
competitive score. The wider M2 candidate/selection/packing work remains open.

## Product boundary

An explicit trusted server option `sessionEpisodesAccess: 'episode-v1'` or CLI
`--session-episodes-access episode-v1` adds exactly three tools:

- `list_session_episodes`: forwards the existing `listEpisodes` arguments minus
  namespace. Require explicit canonical UTC `since`/`until`; preserve core's
  event/receipt basis, exact client filter, range/page limits, cursors, unknown
  event-interval marker and incomplete coverage.
- `inspect_session_episode`: forwards `getEpisode` arguments minus namespace,
  including independent source/memory/policy/keep limits and cursors. Preserve
  episode revision, source IDs, digests, roles, source text, provenance and
  pagination exactly. Interpretations remain distinct from cited sources.
- `forget_session_episode`: forwards only `episodeId` and `expectedRevision` to
  `forgetEpisode`. This is an explicit destructive conversation deletion, not
  hiding a summary. Explain that existing core behavior also forgets derived
  memories, including deduplicated multi-source memories, and invalidates copied
  source consumers. Require actual user intent and a freshly inspected revision.

All use the server's existing cloned, exact namespace. Tool arguments may never
override owner, project or scope. Strict schemas and ordinary MCP envelopes,
untrusted framing and transport caps apply. List/inspect have read-only and
closed-world hints; forgetting is destructive, not read-only, and closed-world.
All three are keyless. No capture, interpretation, selection, ranking, draft,
retry, queue drain, tokenizer or provider request is introduced. Existing core
opening/migration and expired staging housekeeping are not removed, so do not
describe the process as a filesystem-read-only or zero-database-write mode.

Access alone never enables `sessionEpisodes`, automatic capture, staging,
source qualification, or new retention. Omission keeps the current default
tool set and behavior. Reject own undefined/null/unknown modes before opening
the database. `--check-config` remains syntax-only and truthfully reports access
enabled while episode generation remains disabled. No new host/native Hermes
configuration is implied; native Hermes allowlists need a separate change.
The broader tools planned in `session-episodes.md` are not delivered here.

## Acceptance

- **E01 Configuration:** constructor/CLI validate the one explicit mode; reject
  malformed, duplicate and unknown flags before database creation. Default
  discovery is unchanged; opt-in adds only the three named tools. Keyless
  check-config opens no database and imports no provider/tokenizer.
- **E02 Normal capture to cold read:** use normal core episode capture with a
  scripted interpreter citing submitted passages and an empty extractor, not
  manual insertion. Assert zero admitted memories and real retained sources.
  Close the writer, open the actual stdio MCP CLI without episode generation,
  discover by receipt-time range, inspect, and compare exact source/provenance
  and revision with the captured state. No model/provider call during reads.
- **E03 Bounded honest discovery:** exercise pagination, independent source
  cursors and limits, strict field validation, canonical UTC/range ceilings,
  unknown event dates and explicit receipt-time discovery. Incomplete pages
  remain incomplete; absence in a page does not imply absent history.
- **E04 Authority:** reject namespace injection and cross-owner/project IDs and
  cursors; exact client filters never match unrelated clients. Inspect output
  is untrusted evidence, not truth, adoption or execution permission.
- **E05 Lifecycle:** correction of a linked memory invalidates dependent
  episode evidence; stale cursors and deletion revisions reject. Explicit
  conversation forgetting suppresses linked memories and copied sources using
  existing core behavior. Cold restart cannot revive forgotten text. Include
  the zero-memory episode and a linked-memory/cascade case, not just empty DBs.
- **E06 Installed path:** build and offline-install the local archive using the
  existing packaging helpers; capture through the installed core, then run the
  installed CLI through actual stdio discovery/inspection/forget/restart.
  Check installed file identities and block network/provider access. This is
  installation compatibility evidence, not an upstream listing or publication.
- **E07 Safety and delivery:** new fixtures use owned test workspaces; close
  processes/databases before removal, including failure. No real keys, user
  database, historical corpus, live ledger, paid call or old-case rerun. Preserve
  public defaults, schema, core semantics and native Hermes behavior. Document
  retention/deletion limits and new local-host disclosure. Primary reruns key
  paths, two nonauthor fixed-diff reviews pass, and exact-head CI passes before
  delivery. No merge, publication or deployment.

## Scope and verification

Allowed implementation: `adapters/mcp/server.mjs`, `adapters/mcp/cli.mjs`, new
focused MCP tests/helpers, one focused installed-artifact test, this plan,
`docs/standalone-mcp.md`, scoped protocol/privacy/limitations documentation,
and `CHANGELOG.md`. Do not change core queries/schema, provider/model behavior,
Hermes, evaluation protocols, budgets or CI without primary re-scoping.

Run focused red/green tests, `npm run test:mcp`, `npm test`, `npm run validate`,
the installed artifact gate and pinned strict plugin validation on Node 22.16
and 24.15. Prepare dependency metadata with the existing documented packaging
command; public-registry requests are not model calls. Record commands and
meaningful results, correction rounds and primary reruns below. Core remains
unchanged; lifecycle assertions must still exercise real core behavior.

## Ownership and evidence

Primary owns the contract, integration and direct acceptance. Implementation
is delegated under the shared routing policy; record the actual worker/model,
final candidate, verification and independent reviewers before delivery.

## Implementation checkpoint, pending primary acceptance

The bounded M2a worker used GPT-6 Sol/high on `feat/mcp-retained-episode-access`
from fixed base `c2212ce12fa0f31d4847bfc3838f11db377fa51f`. The changed flow
enters through `parseConfiguration`/`start` in `adapters/mcp/cli.mjs`, then
`createCairnServer` in `adapters/mcp/server.mjs`, and forwards to existing
`core.listEpisodes`, `core.getEpisode`, or `core.forgetEpisode` with the server's
cloned namespace. The CLI imports no provider/tokenizer in keyless access mode.
Default hosts, other adapter callers and the installed archive's existing
entrypoints are unchanged. Native Hermes is not wired. No core, schema,
provider, evaluation or CI file changed.

Focused E01–E05 tests use owned workspaces and actual stdio clients. Normal
core episode capture with a scripted interpreter and empty extractor produces
zero admitted cards and retained source text; after closing the writer, an
access-only cold CLI lists by receipt time and returns an exact `getEpisode`
value, including source IDs, digests, roles and provenance. Tests cover UTC
ranges, page exhaustion, source cursor continuity, exact client and namespace
filters, foreign-owner/project ID and cursor rejection, stale list/source
cursors, invalid tool fields, stale deletion revisions, correction, zero-card
deletion and cold non-resurrection. A separate synthetic lifecycle control
reuses core's existing copied-source runtime setup to show that deleting a
zero-memory origin invalidates a consumer's copied passage while preserving
its independent memory. This control is not evidence that automatic repeated
inferred capture creates such a consumer.

The installed E06 test builds a checked-identity archive, installs offline in
an owned workspace, captures through the **installed core**, and uses the
**installed CLI** over real stdio for cold list/inspect/forget/restart. Its
child preload rejects provider/tokenizer imports and network fetch; no model
is configured on reads. Build scratch and installed files stay inside the
owned workspace, and deferred client/database closures precede removal.

Initial focused execution was blocked by missing isolated MCP dependencies;
`npm ci --prefix adapters/mcp` supplied the locked set. The resulting first
behavioral red was the missing option. A test initially assumed source rows
followed message order; core orders by opaque source ID, so the test now checks
the complete ID-ordered source objects and exact warm/cold values. A second
normal capture of identical inferred text returned the pre-existing
`qualification_conflict`; the multi-carrier cascade control uses one normal
capture plus one explicit direct-admission carrier instead. No qualification
behavior was changed or inferred-capture success claimed. The copied-source
control also initially assumed the consumer's public source ID equaled its
origin ID; core creates a distinct consumer source row. It now checks retained
text followed by invalidation on origin deletion. An early Node 24 full
artifact run had one unrelated `installed_mismatch` while the worker changed
`server.mjs` mid-run; the focused failing test passed 11/11 on frozen files,
and the full Node 24 artifact gate was restarted on frozen files.

With Node 22.16.0, focused MCP passed 4/4, focused installed artifact 1/1,
`npm run test:mcp` 95/95, `npm test` 131/131, `npm run test:artifact` 87/87,
`npm run validate` and strict plugin validation passed with zero skips. With
Node 24.15.0, focused MCP passed 4/4, focused installed artifact 1/1,
`npm run test:mcp` 95/95, `npm test` 131/131, `npm run validate` and strict
plugin validation passed with zero skips. The frozen Node 24 full artifact
rerun passed 87/87 with zero skips; its formerly failing installed-launch test
also passed 11/11 in an isolated rerun. The locked OpenAI and MCP adapter sets
and isolated plugin validator were installed, and the documented public
metadata cache was prepared before artifact tests. `git diff --check` and
syntax checks of both runtime modules and focused tests passed. Primary reruns,
committed candidate SHA, independent review and CI remain pending at this
checkpoint.

The primary independently reran the combined focused MCP and installed paths
on both runtimes before the final foreign-forget assertion, passing 5/5 in
about 8.7 seconds on Node 22 and 9.3 seconds on Node 24. It then reran the
final focused MCP tests with rejected cross-owner and cross-project deletion
requests: 4/4 on Node 22 in 8.06 seconds and 4/4 on Node 24 in 7.75 seconds,
including proof that the authorized episode was unchanged. Primary fixed-diff
review and full candidate commit/reviews remain the next acceptance steps.
