# Explicit MCP source-evidence recall default

Fixed base `3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9` (origin/main).
Isolated branch/worktree `feat/mcp-source-context-default` /
`mcp-source-context-default`. This is configuration of the existing shared core
view, not a second recall engine, a model improvement or a new capture policy.

Source-only answer diagnostics separate retained evidence from fallible generated
interpretations. Today callers must request that context on every MCP invocation.
Allow a user to choose that default once at startup, preserving all old behavior
when omitted. This does not establish source truth or fix incomplete answers.

## Acceptance

SCD1. CLI accepts exactly `--recall-context source-evidence`, rejects duplicate,
missing and unknown values consistently with existing parseConfiguration. Maps
to createCairnServer option `recallContext: 'source-evidence'`. Explicit invalid
constructor values (including undefined/null) reject before store opening. This
does not require capture qualification, rationale or a provider key at startup.
No implicit enabling of capture, source snapshot, staged retention or provider.

SCD2. With this config and no contextMode argument, actual recall_memory delegates
to existing core.recall with contextMode source-evidence and does not implicitly
enable qualification. Returned/ranker context excludes generated summaries and
qualifications and preserves exact complete retained source receipts. Existing
read namespace, limits, source-currentness markers and sourceSelectionCoverage
are unchanged. No new requests, fallback or engine edits.

SCD3. Configuration is a presentation default, not an authorization boundary.
An explicitly supplied contextMode (source-evidence or rationale-evidence) wins.
Explicit includeQualification:true conflicts with the effective source mode and
must return invalid_input before model calls; do not silently drop the request
or bypass the configured mode. False does not disable source mode. Omitting the
configuration preserves all existing cases exactly, including qualified-capture
recall defaults and explicit legacy includeQualification:false. Existing optional
selectionMode remains unchanged and operates with the resolved source context.
Do not add a new mode value just to opt out per call; restart without this default
for legacy summary context, or inspect_memory for explicit interpretations.

SCD4. CLI help, check-config and technical MCP/protocol docs expose the selected
default without claiming credentials/model validity, source truth, temporal
currentness or automatic capture. --check-config remains no database/provider
access, and no key or path is leaked. Startup without a model permits existing
keyless operations; semantic recall still returns model_not_configured.
Document complete retained excerpts can expose more source text than legacy
summary-oriented context, within existing namespace/budgets; no new stored fields,
retention, telemetry, authority or hosted/Claude-hook behavior. Narrow unreleased
CHANGELOG note only; no version bump, merge, publication or deployment.

SCD5. Tests use actual MCP SDK client/server calls and installed local archive,
synthetic databases/scripted models only. Include changed source vs summary text,
default call without context argument, false/true qualification, explicit mode
precedence, configuration omission compatibility, invalid constructor/CLI forms,
namespace mismatch rejection and keyless startup/recall. Actual installed entrypoint
must cover behavior, not only --check-config or source-tree import. No real key,
user database or model request.

SCD6. Run generic npm test/validate, MCP suite, artifact suite and applicable
plugin validation on Node22.16/24.15 per CONTRIBUTING. No TypeScript gate exists.
Primary inspects diff and independently reruns installed/MCP key paths on final
combined candidate. Freeze scoped commit; independent Standards/Spec review;
push PR against main after acceptance and verify latest-head CI. Do not merge.

## Ownership and bounded files

Primary owns contract/integration/acceptance/delivery. One Sol/high worker owns
adapters/mcp/{cli,server}.mjs, their test directory, a focused packaging/test test
and any required existing installed-test helper only after identifying it,
docs/standalone-mcp.md, scoped docs/protocol.md, CHANGELOG.md and this record.
No core, OpenAI adapter, Hermes, hosted, root README/marketing or private
experiment edits. No dependency/version changes. Use existing artifact allowlist;
ask primary if a production file beyond these is necessary. Reviewers are separate.

## Worker verification record (pre-review candidate)

Implementation changes only the MCP CLI parser/report, server option and
per-call resolution, SDK/installed tests, and the narrow MCP/protocol/changelog
documentation. The existing core source view and conflict validation are reused.
The startup option is a presentation default, not a qualification, capture or
model switch. `packaging/install-preview.mjs` and the frozen experiment-only
`evaluation/live/cairn-launcher.mjs` retain their own narrower argument
allowlists; neither was changed. The installed test exercises the actual
packaged `bin/cairn-memory.mjs` entrypoint with a loopback-only fake HTTP
provider. It also preserves the omitted-config, explicit `contextMode`
installed case and proves a configured qualification conflict returns
`invalid_input` with no additional fake provider sends.

On Node 22.16.0, `npm ci --prefix adapters/mcp`,
`npm ci --prefix adapters/openai`, `npm test`, `npm run validate`,
`npm run test:mcp` (76/76), strict
`npm run validate --prefix tools/plugin-validation`,
`node packaging/prepare-cache.mjs`, and `npm run demo:recall` passed.
The first full `npm run test:artifact` was 65/66: the installed test's
experiment-only launcher rejected the new flag before server startup. This
was a test-harness preflight mismatch, not a flaky model or product behavior;
the test was redirected to the actual installed CLI with fake loopback HTTP.
The subsequent Node 22 full artifact suite passed 66/66. After adding the
final assertion-only zero-provider-call conflict check, the affected focused
installed test passed 1/1 on Node 22. A redundant third full Node 22 run was
started then intentionally stopped after primary accepted focused rerun for
this assertion-only edit; it is not counted as a passing gate.

On Node 24.15.0, both isolated `npm ci` commands, `npm test`,
`npm run validate`, `npm run test:mcp` (76/76), strict plugin validation,
`node packaging/prepare-cache.mjs`, `npm run demo:recall`, and the final full
`npm run test:artifact` (66/66) passed after that assertion. All test inputs
were synthetic; no provider key, real model request or paid run was used.
Independent Standards/Spec review and primary acceptance remain pending at
this record point; no branch push or PR was made by the worker.
