# Explicit canonical-source staging through local MCP

Status: acceptance fixed before implementation. Core dependency is locally
verified and independently reviewed; PR #373 latest-head CI passed on the fixed
base (run37822535900), ready and mergeable but unmerged.
Base: `16cbda4b84d90fc2dd4512876c820c666a12b2dd`.
Branch: `feat/indexed-canonical-mcp`; target `feat/indexed-canonical-staging`.

## Outcome and limits

Expose the already implemented bounded core retention policy through the local
MCP host, by explicit `--capture-source-policy indexed-staged-v1` or an own-data
programmatic option. Reuse submitted capture and exact inspect/discard; do not
add another engine, source search, automatic ingestion, permanent retention or
default transcript capture. The sources are canonical normalized/redacted text,
not raw transcript bytes, authenticated roles, verified facts or authorization.

Core retention is 24 hours, at most 24 messages/4,000 UTF-16 units per message/
20,000 total, 128 KiB per event and 64 payloads/1 MiB per exact namespace. Existing
stdio and response limits remain additional boundaries. No new qualification
step or claim that the indexed extraction is semantically reliable is allowed.

## Acceptance

- H1 The new CLI flag accepts only `indexed-staged-v1`, once and explicitly.
  Programmatic `captureSourcePolicy` must be an own data property, snapshotted
  before opening a database; reject getters/unsupported values without invoking
  a getter. Inherited policy does not enable capture/retention. Reject own
  qualification, rationale, legacy captureEvidence and episode-generation
  combinations before database/model work, including own undefined fields.
  Access-only management remains compatible. Do not add an environment opt-in.
- H2 Default tool inventory and all legacy configurations remain unchanged.
  The new mode adds only submitted `capture_memory` and existing exact
  `inspect_capture_evidence`/`discard_capture_evidence` tools to the default
  inventory. Capture schema, message-ID derivation, startup namespace/client/
  session binding and replay identity remain unchanged. It forwards only this
  explicit policy to the shared core. Qualification is not requested; tool
  descriptions/instructions must not describe this mode as source-qualified.
  Existing explicit captureDeadlineMs is valid with either qualified capture
  or this mode, retaining the exact original bound and no new default timeout.
- H3 CLI help and secret-free `--check-config` disclose broader canonical
  retention, fixed expiry, source trust, disabled automatic capture and
  qualification-not-requested. Config checking opens no database and contacts
  no provider, whether a synthetic key is present or absent; no key/source text
  is printed. Access-only mode enables no retention or capture model calls.
  A missing model fails capture explicitly; it must not be misreported as
  successful ingestion or trigger a fallback provider.
- H4 Through real SDK stdio/server/core, fresh zero-item, malformed and provider
  failure cases retain late details beyond 1,000 units and assistant attribution.
  After close/restart, access-only keyless inspection returns exact canonical
  messages and unchanged metadata; inspect/discard makes zero model/fetch calls.
  Staged source remains absent from ordinary inspect/list/recall/sourceSnapshot.
  Successful nonempty capture still stores only selected bound receipts and
  invokes no qualifier. No semantic judgment is inferred from scripted tests.
- H5 Prove duplicate calls do not renew expiry or call models; policy conflicts
  remain explicit. Discard fences replay and pending late admission. Wrong
  startup owner/project/client cannot read another event; tool arguments cannot
  inject authority fields. Access-only reading of prior legacy prefix and new
  canonical formats preserves their distinction. Do not relabel old prefixes
  as complete source or permit retry under invented fresh event IDs.
- H6 Preserve the CLI's 65,536-byte input buffer and server's 262,144-byte encoded
  result check (the latter is not total MCP framing). Exercise actual stdio with
  valid Unicode/escaped payloads near the existing limits and an over-limit
  input. Reject/close explicitly without partial source writes or truncation;
  no widening of transport, token or core limits to make a test pass. Oversize
  transport rejection need not return a tool result; distinguish that from a
  core refusal. Keep response trust metadata and normal safe error behavior.
- H7 Build the private preview archive and install it into a fresh owned local
  project using existing offline locked dependencies. Verify installed source
  hashes, then exercise actual installed CLI stdio with synthetic HTTP only:
  new opt-in capture, keyless cold inspection/discard, source isolation and
  replay fences. No ambient network fallback/real key allowed. Immediately
  register teardown; both success and failure must leave no unexpected owned
  scratch. Do not clean historical directories or mutate shared dependency
  installations. A missing prerequisite is a blocker, not a skipped pass.
- H8 Document explicit manual addition to local `stdio.args` and its privacy
  consequences. The preview installer does not gain a new flag in this slice;
  do not imply automatic installer or Hermes-provider support. Existing schema19
  stop-older-connections guidance still applies. Update standalone/protocol/
  changelog and limitations without revising any closed evaluation result.
- H9 On exact Node22.16.0/24.15.0 run generic tests, JSON/maintainer validation,
  the full MCP suite and full artifact suite with existing prerequisites. Run
  focused new stdio/installed gates on both; primary personally verifies key
  integrated paths on final bytes. Independently cross-check delivery files by
  two routes. Two nonauthor Standards/Spec reviews inspect the same fixed
  commit; latest-head CI and mergeability must pass before ready delivery.

## Scope and ownership

Allowed production files: `adapters/mcp/server.mjs`, `adapters/mcp/cli.mjs` only.
Prefer new `adapters/mcp/test/indexed-canonical-staging.test.mjs` and one dedicated
scripted fixture, plus `packaging/test/indexed-canonical-mcp.test.mjs` and its
synthetic-fetch fixture. Existing relevant configuration tests may receive
necessary new assertions; do not rewrite unrelated tests. Documentation scope:
this plan, `docs/standalone-mcp.md`, `docs/protocol.md`, `docs/limitations.md`,
`CHANGELOG.md`. Ask primary before another source path or contract is required.

Primary authorized one additional documentation-only integration correction:
`docs/staged-capture-evidence.md`, making12 total authored paths. Update its
current core-only/no-MCP wording and the existing canonical-staging limitations
paragraph consistently with explicit local MCP exposure, preserving no
installer/Hermes/automatic-discovery claims and all closed evaluation results.
This does not change H1–H9 or expand production scope.

Primary owns requirements, integration, acceptance and delivery. One GPT-6.1
Sol/high worker implements after dispatch; two independent nonauthors review.
Use the isolated worktree, owned test runner and immediately registered cleanup.
Keep a meaningful preimplementation RED, exact command exits, corrections and
entrypoint/caller coverage in this plan or PR. No source edits while primary
final-file verification is running.

No core/schema/prompt/model/ledger/corpus/CI/dependency changes, paid evaluation,
real conversations, merge, release or deployment. Budget remains cumulative
US$400 with US$30 protected; this packet requires zero provider spending.
Hermes integration and bounded source discovery/recall are later separate
contracts. Passing this host boundary establishes usability of exact recovery,
not long-term retrieval quality or competitive benchmark parity.

## Author implementation and focused verification

Actual GPT-6.1 Sol/high implemented only the two allowed production files.
`createCairnServer` snapshots the own policy descriptor before conflicting option
or model/database reads; capture-enabled and source-qualified configuration remain
separate. Inherited policy cannot enable retention. CLI parsing accepts only one
explicit policy, preserves original deadlines and transport bounds, and exposes
secret-free retention/source-trust information through syntax-only checking.
Existing exact tools and startup source identities are reused. Access-only tools
do not capture; explicitly requested capture without a model fails admission but
may retain failed canonical source, consistently with the existing core ordering.

Entrypoint/caller coverage includes CLI help/check/start/transport, programmatic
constructor validation/snapshot, SDK tool discovery and capture/inspect/discard,
legacy qualified capture/default recall, shared core exact recovery and the actual
installed CLI/import closure. The new fixtures use scripted ports or fully
replaced synthetic fetch, never ambient provider fallback. Installed source hashes
are verified against the inspected build report. Builder TMPDIR is bound to an
already owned workspace, so failures before its report returns are also covered
by immediately registered teardown. Fresh initialized install projects use
`--prefix`, `--offline` and `--ignore-scripts`; success and intentional invalid-
archive failure both explicitly assert owned scratch removal. Existing dependency
symlinks and cached installs are read-only; no network preparation was needed.

Author observations on exact Node22.16.0 and24.15.0:

| Checkpoint | Actual exits22/24 | Observation |
| --- | --- | --- |
| Preimplementation new H1 constructor acceptance | 1 / 1 | Meaningful RED: host allowlist rejects the supported core policy (`invalid_input`), before database opening. |
| First expanded nine source-host tests | 1 / 1 | 2/9: synthetic model omitted required contextWindow; fixture wrongly expected absent staging for missing-model failure and an already-created database after early oversize transport closure. Provider failure expectation also corrected to existing `extraction_failed`. No core/limit change. |
| Corrected source-host tests before final additions | 0 / 0 | 11/11, no failures/cancellations/skips. |
| First new installed CLI/build/install controls | 0 / 0 | 2/2, real SDK/installed CLI and synthetic HTTP; successful and deliberately failed offline-install cleanup asserted. |
| Final eight-file focused/affected packet | 0 / 0 | 46/46 each, zero failures/cancellations/skips/todos; includes new original-deadline and installed near-limit framing assertions. |
| Syntax checks for all six changed MJS files | 0 / 0 | Every individual command exited0. |

Final eight-file command used each exact runtime's Node with keyless `env -i`,
exact Node PATH plus `/usr/bin:/bin`, standard TMPDIR and disabled compile cache:

```sh
node tools/testing/run.mjs --test-concurrency=1 --test-reporter=tap \
  adapters/mcp/test/indexed-canonical-staging.test.mjs \
  packaging/test/indexed-canonical-mcp.test.mjs \
  adapters/mcp/test/configuration.test.mjs \
  adapters/mcp/test/capture-deadline.test.mjs \
  adapters/mcp/test/staged-evidence.test.mjs \
  adapters/mcp/test/qualified-capture.test.mjs \
  packaging/test/staged-evidence-mcp.test.mjs \
  packaging/test/mcp-capture-deadline.test.mjs
```

Original sessions75504 (Node22, completion chunk `c28749`) and82664 (Node24,
`1aaa3b`) each actually exited0. These author-observed tool outputs retain totals,
not a claim of separate raw log files. The new source file contributes12 cases,
including actual65,536-byte transport rejection and near-limit Unicode/escaped
input. Encoded-result tests demonstrate a permitted near256-KiB JSON result whose
MCP framing is larger, and a safe oversized-result refusal; no bound is widened.
The installed file contributes two cases, including installed near64-KiB input,
four extraction outcomes, no qualifier, cold source isolation and replay fences.

Primary identified current core-only/no-MCP wording in the existing staged-source
guide and canonical-staging limitations paragraph. After both focused gates closed,
the authorized documentation-only correction updated these statements and added
the staged-source guide to scope (12 authored paths); no production/test byte or
closed evaluation result changed. The primary owns full generic/MCP/artifact,
JSON/maintainer gates on the frozen packet, fixed-commit nonauthor reviews and
latest-head CI. These remain pending at this author handoff; focused success is
not full-suite, semantic-quality, named-host or paid-operation acceptance.

Final scope discovery by Git diff plus untracked files and independently by
porcelain status agrees on12 authored paths: two production files, four new
test/fixture files and six documentation files. Only the three exact primary-
created read-only dependency links are excluded as setup. The inventory/hash
checker and `git diff --check` actually exited0; all six source/test hashes remain
unchanged after focused gates. No author commit/push or shared dependency write.

## Primary full offline verification

Primary completed all12 final-file gates on exact Node22.16.0 and24.15.0.
Wrapper session36558 closed with actual exit0 (completion `f7936e`). Each of its
twelve child commands records actual exit0, null signal and no launch error in
`/tmp/cairn-canonical-mcp-gates.MCAsbaeB/results.json`; all twelve raw logs were
read and their test totals independently reconciled before this append.

| Gate | Node22 actual exit | Node24 actual exit | Result on each runtime |
| --- | --- | --- | --- |
| Full MCP | 0 | 0 | 123/123;17 test files |
| Full artifact | 0 | 0 | 92/92;30 test files |
| Workspace lifecycle | 0 | 0 | 25/25;2 test files |
| Generic | 0 | 0 | 581/581;21 test files |
| JSON validation | 0 | 0 | Passed |
| Maintainer validation | 0 | 0 | Passed |

All eight test-suite invocations report zero failures, cancellations and skips.
Every test command used `--test-concurrency=1`: files were serial within each
invocation, and each runtime's six gates were sequential. The two runtime streams
ran concurrently; this does not claim globally serial execution or product latency.
Children received only exact-runtime PATH plus `/usr/bin:/bin`, standard TMPDIR
and disabled compile cache. No key, paid request or shared dependency mutation
was involved. This JavaScript repository has no TypeScript/typecheck gate.

The exact executables were the `node` and `npm` binaries under
`/home/chichieh/.nvm/versions/node/v22.16.0/bin/` and
`/home/chichieh/.nvm/versions/node/v24.15.0/bin/`, respectively. On each runtime,
the complete command argument lists were:

```sh
node tools/testing/run.mjs --test-concurrency=1 \
  adapters/mcp/test/candidate-capture.test.mjs \
  adapters/mcp/test/capture-admission-inspection.test.mjs \
  adapters/mcp/test/capture-deadline.test.mjs \
  adapters/mcp/test/classification-recovery.test.mjs \
  adapters/mcp/test/configuration.test.mjs \
  adapters/mcp/test/episodes.test.mjs \
  adapters/mcp/test/indexed-canonical-staging.test.mjs \
  adapters/mcp/test/procedural.test.mjs \
  adapters/mcp/test/qualified-capture.test.mjs \
  adapters/mcp/test/rationale.test.mjs \
  adapters/mcp/test/retained-source-extraction.test.mjs \
  adapters/mcp/test/source-evidence-context.test.mjs \
  adapters/mcp/test/source-qualified-recall.test.mjs \
  adapters/mcp/test/source-snapshot.test.mjs \
  adapters/mcp/test/staged-evidence.test.mjs \
  adapters/mcp/test/stdio.test.mjs \
  adapters/mcp/test/walkthrough.test.mjs
node tools/testing/run.mjs --test-concurrency=1 \
  packaging/test/adaptive-qualified-source-pair-guard.test.mjs \
  packaging/test/automatic-rationale.test.mjs \
  packaging/test/cache.test.mjs \
  packaging/test/candidate-qualification-pilot.test.mjs \
  packaging/test/capture-admission-inspection.test.mjs \
  packaging/test/classification-wire.test.mjs \
  packaging/test/indexed-canonical-mcp.test.mjs \
  packaging/test/indexed-evidence-capture.test.mjs \
  packaging/test/install.test.mjs \
  packaging/test/installed-source-answer-delivery.test.mjs \
  packaging/test/mcp-capture-deadline.test.mjs \
  packaging/test/preview-installer.test.mjs \
  packaging/test/qualification-diagnostic.test.mjs \
  packaging/test/qualified-install-mcp.test.mjs \
  packaging/test/qualified-install-receipt.test.mjs \
  packaging/test/qualified-source-pair-launch.test.mjs \
  packaging/test/rare-navigation.test.mjs \
  packaging/test/rationale-claim-focus.test.mjs \
  packaging/test/rationale-model-controls.test.mjs \
  packaging/test/retained-source-extraction.test.mjs \
  packaging/test/session-episodes.test.mjs \
  packaging/test/source-basis.test.mjs \
  packaging/test/source-evidence-context.test.mjs \
  packaging/test/source-qualified-recall.test.mjs \
  packaging/test/source-scan-ablation.test.mjs \
  packaging/test/source-snapshot-mcp.test.mjs \
  packaging/test/source-support-pilot.test.mjs \
  packaging/test/source-windows.test.mjs \
  packaging/test/staged-capture-evidence.test.mjs \
  packaging/test/staged-evidence-mcp.test.mjs
node tools/testing/run.mjs --test-concurrency=1 \
  tools/testing/lifecycle.test.mjs tools/testing/workspace.test.mjs
node integrations/client/testing/run.mjs --test-concurrency=1 \
  evaluation/architecture/test/augmented-model.test.mjs \
  evaluation/architecture/test/checklist-model.test.mjs \
  evaluation/architecture/test/full-label-model.test.mjs \
  evaluation/architecture/test/official-six-v3-report-integrity.test.mjs \
  evaluation/architecture/test/probes.test.mjs \
  evaluation/architecture/test/query-evidence-checklist.test.mjs \
  evaluation/architecture/test/selection-augmentation.test.mjs \
  evaluation/architecture/test/small-candidate-model.test.mjs \
  evaluation/architecture/test/source-answer-accounting.test.mjs \
  evaluation/architecture/test/source-coverage-ranking.test.mjs \
  evaluation/architecture/test/synthetic-lineage.test.mjs \
  plugins/cairn-memory/test/benchmark-suite-registration.test.mjs \
  plugins/cairn-memory/test/capture-filter.test.mjs \
  plugins/cairn-memory/test/capture-lock.test.mjs \
  plugins/cairn-memory/test/client-bundle.test.mjs \
  plugins/cairn-memory/test/hosted-quota.test.mjs \
  plugins/cairn-memory/test/identity.test.mjs \
  plugins/cairn-memory/test/pause-capture.test.mjs \
  plugins/cairn-memory/test/protocol.test.mjs \
  plugins/cairn-memory/test/recall.test.mjs \
  plugins/cairn-memory/test/transcript.test.mjs
npm run validate
npm run validate --prefix tools/plugin-validation
```

The primary independently derived each suite's sorted file list by readdir and
find, and the12-file delivery list by diff+untracked files versus porcelain status.
All12 authored hashes matched before/after every gate; the worker independently
checked current bytes against those hashes before this append (checker exit0).
The three exact read-only setup dependency links remain excluded and untouched.
Only this final section is appended after gate closure; preceding acceptance and
evidence text are unchanged, and the other11 files retain their gated hashes.
The earlier pending text is historical author-handoff status, not rewritten.

Primary owns candidate commit, independent nonauthor Standards/Spec reviews and
latest-head CI/mergeability, which remain pending. These offline gates establish
mechanical host/install boundaries, not semantic quality, paid authority, a
release, named-client compatibility or permission to merge.
