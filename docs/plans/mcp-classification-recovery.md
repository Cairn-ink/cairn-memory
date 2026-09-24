# Explicit MCP classification for current unfiled memories

Status: implementation candidate on `feat/mcp-classification-recovery`, fixed base
`038f0acbe2ac281d1fd599a1199aa921782ca5e5`.

This opt-in exposes the existing public core classification and placement pair
through the local MCP host. It is general classification of inspected current
unfiled memories, not proof that a particular capture batch failed. The caller
must explicitly invoke it with retained `{memoryId, revision}` references. It
never extracts, admits, resumes capture, retries automatically, changes source
receipts or reviews rationale.

## Acceptance

- CR1: `classificationRecovery: 'guarded-v1'` enables only
  `classify_unfiled_memories`; `--classification-recovery guarded-v1` maps to the
  same setting. Defaults and capture flags stay independent. Constructor and
  CLI reject unknown/duplicate values before database or provider access.
  Check-config reports `configured-not-verified` with a supplied key or
  `model_not_configured` without one, always with no database/provider contact.
  Keyless tool calls return `model_not_configured`.
- CR2: Strict tool input is exactly `refs`, containing one to five unique
  `{memoryId, revision}` records. IDs and revisions use existing public bounds.
  Reject extra authority fields, duplicate or malformed refs, and oversized
  batches before a model call. Snapshot the bounded refs before awaiting.
- CR3: Preflight all refs through `core.get` in the configured namespace and
  require exact revision, `active` state and `unfiled` filing. Missing, foreign,
  deleted, historical, corrected, stale or filed refs reject the whole request
  before model work or placement. One invalid ref cannot partially apply the
  rest. No source text from a failed preflight reaches a provider.
- CR4: Read the classification map, classify the original refs using its index
  revision and the existing `core.classifyPlacement`, then apply exactly the
  returned proposal and `basedOn` guards through `core.applyPlacement`. Never
  refresh a stale guard or run a model inside a storage transaction. A concurrent
  correction, deletion, placement or namespace index change fails closed.
  Concurrent calls may both classify. If one changes placement, stale guards
  prevent a second conflicting change; no-op proposals may both succeed.
- CR5: Return the actual placement metadata and current memory revisions. Do
  not claim every item became filed: an empty-parent placement can legitimately
  leave it unfiled, and another explicit call with the same refs can classify
  again. Repeating old refs after a filing fails before model work.
  Model failure or invalid output preserves the original unfiled memories and
  receipts. Capture duplicate behavior and all default tool inventory remain.
- CR6: SDK MCP tests cover capture failure, retained refs, cold host recovery,
  unchanged receipts and duplicate capture, plus repeat, correction, deletion,
  historical and foreign refs, mixed batches, malformed input, failed model,
  empty-parent output and concurrent calls. CLI tests cover opt-in, invalid flags
  and keyless check-config. Use scripted models or fake HTTP and fresh synthetic
  stores only.

## Entrypoints and checks

`adapters/mcp/cli.mjs` parses startup and check-config. `server.mjs` owns the
fixed namespace and SDK tool inventory. The new tool composes `core.get`,
`core.map`, `core.classifyPlacement` and `core.applyPlacement`; public core and
capture remain unchanged. Existing MCP tests that count default tools or assert
capture behavior must remain green. No browser, installed artifact or live
pilot path changes. Run focused SDK tests, full `test:mcp`, root `npm test`,
`npm run validate`, pinned plugin validation and applicable core classification
regression tests on Node 22.16 and 24.15.

The preview artifact copies a fixed runtime file list, so this feature lives
in the already included `server.mjs` rather than a new imported module. The
installer only forwards its own approved arguments; users of its output
may add this runtime flag to their local `stdio.args`, as with other MCP-only
options. Hermes has a separate tool inventory and is unchanged. Existing
default MCP tool-count and capture-replay tests own those cross-feature checks.

## Verification record

Implementation: bounded Sol 6 high worker; fixed base above. The new SDK test
was red before implementation (constructor/CLI rejected the option). Its
failed-capture and race cases now use fresh synthetic stores and scripted model
callbacks, including an actual keyless stdio CLI invocation. On both Node
22.16 and 24.15, root `npm test` equivalent passed 112/112, MCP `test:mcp`
equivalent passed 83/83, focused core capture/classification passed 25/25, and
JSON validation passed. The pinned native Claude validator passed marketplace
and strict plugin checks. No real provider requests or credentials, benchmark
ledger, or historical data were used. Candidate SHA is recorded at handoff.

## Limits

No batch membership or durable classification journal is added. A capture
response lost after admission may still be hard to discover, and a core model
stage has its own 30-second deadline rather than one whole-capture deadline.
S1 remains incomplete. Synthetic correctness checks establish placement safety,
not model quality, source truth, or repair of historical pilot outcomes.
