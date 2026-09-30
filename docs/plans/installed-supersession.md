# Installed explicit supersession

Historical source-construction base: `1bc7f932870d39b0109df4bfb85741af4965270d`.
Current delivery/review base: `50741cda56a5d9a0b50b1bccbf8071b40c444097`.
Main-sync integration tested: `ce21588811a057c56bad12d0a92db9442b3b8ae7`.
Worktree:
`/home/chichieh/Github/cairn-memory-worktrees/installed-supersession`, branch
`feat/installed-supersession`. Implementation owner: bounded worker, requested
and actual GPT-6.1 Sol, reasoning high. Token/cost and elapsed measurements are
unknown unless exposed by the runtime. Primary owns integration, inspection,
reruns, commits, independent reviews and delivery. Worker makes no commits,
pushes, PRs, merges, releases or deployments and spawns no agents.

## Bounded contract (IS1–IS10)

IS1: Opt-in CLI --history-updates explicit-v1 / JS createCairnServer historyUpdates:'explicit-v1', Hermes history_updates:'explicit-v1'. Strict validators reject null/unsupported/duplicate flags etc. Absent opt-in preserves exact existing inventories/options/defaults, including newly merged MCP episode flags. Do not remove/redefine any settings.

IS2: Opt-in adds exactly one keyless/local supersede_memory tool (Hermes prefix cairn_). Strict bounded args {memoryId,expectedRevision,replacement:{content,kind},sourceExcerpt}; replacement kind required and existing enum, content existing600 limit, sourceExcerpt required nonblank and <=800 UTF-16 units consistent with core receipt contract (confirm current validation). Fixed namespace from server construction ONLY. Delegate directly to PUBLIC core.supersede using current receipt helper with sourceExcerpt as excerpt (client-generated event identity); no copied supersession engine/schema. Explicit user-submitted source is an unverified claim, not authenticated transcript/semantic truth/permission. It is NOT automatic currentness or temporal inference. Description/instructions say use only on actual explicit adopted update, same subject/property/scope, not proposal/merely later document; caller supplies evidence, not generated reasons. Bounds and tests cannot certify meaning.

IS3: Successful update retains old record and original receipts as historical and creates/uses successor with new supplied receipt/link. After server/provider process restart, inspect historical predecessor + successor currentness/revisions/receipt evidence. Existing correct_memory remains in-place repair (same ID, old receipts replaced, no history implicitly created); forget semantics unchanged.

IS4: Reuse core guards: stale ref, wrong namespace, historical target, invalid/suppressed/conflicting replacements refuse atomically with no partial successor or source mutation. Ordinary supersede on QUALIFIED old/new record remains qualified_transition_required with atomic rollback. No expose bindQualifiedClaim/singleClaim/trusted slot authority, qualified transition APIs, bypasses, automatic correction-then-update or guessing. Document qualified-history workflow remains outside this limited profile.

IS5: If successor is later corrected/forgotten, inspect must honestly reflect unavailable bound update evidence; never synthesize a reason or restore retired old state. Assert existing core behavior, not new engine modifications. Other unrelated memories survive. Forgetting a record not universal secure erasure or all-chain deletion.

IS6: Hermes validate_config/schema/configured_tools/bridge forwarding all support independent opt-in without exposing key; new tool must not forward OPENAI_API_KEY nor extend model timeouts. Defaults5/6/7/8 remain when no history profile; history adds1. Actual pinned MemoryManager/AIAgent + installed MCP tests using synthetic keyless profiles and process restart; exact supported inventory, invalidconfig, preserved input and profile binding. No user profile/database.

IS7: Source/retention/privacy: old historical source remains intentionally retained; cannot claim authenticated source, event-time/as-of history, complete revision archive, updated decision meaning or execution authority. No new telemetry/cloud fields/paid request/retry/historical cleanup/current benchmark change. Record threat boundary in docs/protocol.md, user-visible CHANGELOG entry without release/version bumps. Docs standalone-MCP/setup-Hermes explain opt-in, explicit update vs correction, retained old sources, qualified fence. No marketing/brand/README-first-screen changes or arbitrary fixture/scorer modifications.

IS8: Tests observable, not source-string-only: real MCP SDK/stdio fresh-store lifecycle and cold restart, opted-out inventory, malformed source/schema, stale+foreign/historical guard, qualified fence with unchanged store, follow link + receipt IDs, later correction/forget evidence loss, existing correct semantics, zero model calls. New fixtures use createTestWorkspace and success/assertion/setup failures cleanup. Use sanitized env and low test concurrency (1) to avoid contention with paid trial.

IS9: Both Node22.16.0 (/home/chichieh/.nvm/versions/node/v22.16.0/bin/node) and24.15.0 (/home/chichieh/.nvm/versions/node/v24.15.0/bin/node): focused MCP/config/installed packaging tests, generic npm test + validate, entire test:mcp, demo:history for historical view changes. Actual pinned Hermes canonical tests against separately built inspected LOCAL artifact, retries0, scripted completions/fake HTTP/keyless. Read current CONTRIBUTING/CI and identify additional applicable gates. No TypeScript gate exists in public JS repo. You may install locked isolated adapters and public-registry packaging metadata into OWN WT as ordinary implementation; inspect utility docs/source first. No live command, global install or registry publication. Report real commands/counts/node versions and owned cleanup proof; no pass claims for tests not run.

IS10: Final clean scoped diff, trace all changed entrypoints/dependent tests/old inventory assertions, plan evidence (requested/actual model cost unknown), no scored reliability or parity claim. Primary personally inspects/reruns then commits/reviews. Allowed files: adapters/mcp/{server.mjs,cli.mjs,test/history-updates.test.mjs,test/configuration.test.mjs}; integrations/hermes/cairn/{__init__.py,bridge.py,README.md}; integrations/hermes/test/{test_history_updates.py,test_provider.py,conftest.py} only if genuinely required; packaging/test/{install.test.mjs,history-updates.test.mjs} choose smallest; docs/{standalone-mcp.md,protocol.md,plans/installed-supersession.md}; CHANGELOG.md. DO NOT edit core/adapters-openai/evaluation/CI/locks/package versions/marketplace/CLAUDE/AGENTS or other files; escalate scope needs to primary. Stop and report unexpected source ambiguity; don't invent missing architecture. Checkpoints: plan then API/config wiring then focused evidence. Primary concurrently monitors unchanged paid trial and independently checks exact core/source guards and current-base integration.

## Verification plan

Primary refinement IS2a/IS8a: raw `sourceExcerpt` must be at most 800 UTF-16
units, and existing public `boundedText(sourceExcerpt, 800, false)` must accept
its canonical normalized/redacted form. Reject canonical overflow (including
NFKC expansion) with `invalid_input`, without mutating sources or calling models,
rather than letting core receipt truncation silently remove the tail. Caller
input is unchanged. This preflight is not semantic validation or authority.

Primary refinements IS2b/IS8b and IS2b2: this new tool alone requires well-formed
Unicode in both `sourceExcerpt` and `replacement.content`, using `.isWellFormed()`
and closed `invalid_input` without mutation/coercion. Existing shared `text`
schemas, memory tools and core receipt semantics remain unchanged. Real stdio
and embedded SDK high/low lone-surrogate probes compare all SQL rows and model
sentinel counts; valid emoji pairs retain raw 800-unit source/600-unit content.

Read current core receipt/supersession tests and public API before implementing.
Reuse the existing receipt helper, namespace binding and public `core.supersede`.
Cover constructor/CLI strict rejection and independent opt-in combinations,
preserving episode and other flags. Exercise real SDK stdio with fresh owned
stores; compare all SQLite rows before/after refusals; inspect exact receipt
links across cold restart, deduplication, correction and forgetting. Use a
throwing model sentinel in embedded SDK tests, keyless sanitized CLI environments
and fake provider/agent responses only where existing host tests require them.

Read packaging utilities and pinned Hermes runner before invocation. Build and
inspect a separate local archive, install offline, then use its actual executable
for installed SDK and canonical Hermes tests. Run the generic, validate, full
MCP, artifact and history demo gates on both exact Node versions with concurrency
1. Additional applicable CI gates will be recorded after inspecting workflows.
Use `createTestWorkspace` for new JS fixtures and pytest-owned synthetic profiles.
Record commands, counts, versions, artifact hash and cleanup evidence here.
No operational experiment artifacts, historical temporary directories, user
profiles, real provider keys, live calls or current benchmark are in scope.

## Entrypoint/dependency trace

| Entrypoint | Dependent checks | Owner/evidence |
| --- | --- | --- |
| `createCairnServer` option and registration | Configuration, SDK schema/inventory, guards/lifecycle, existing MCP suites | Primary integrated-head focused 18 + full 120 on both Nodes; sync logs 01/07/10/16 |
| CLI parse/help/check-config | Configuration, real stdio cold restart, installed executable | Primary integrated-head focused 18 on both Nodes, including installed history test; sync logs 01/10 |
| Hermes config/setup/schema/inventory | Existing provider tests and new history canonical test | Primary integrated-head full 32 on both Nodes; sync logs 09/18 |
| Hermes bridge flags/key/timeout | Actual installed MCP calls, profile binding, key canary | Primary integrated-head full 32 on both Nodes; earlier precise native seam proof retained |
| Retention and qualification docs | Protocol, standalone setup, Hermes setup, changelog | Primary identified/reconciled dependent-doc claims; scoped diff checked; final audit/reviews recorded separately |

## Evidence

All evidence below before the final-candidate section is PRE-IS2b/IS2b2 and
cannot count as final acceptance after the Unicode host-only fix. Preserve these
observations, including failures; both Node matrices must rerun final source.

Unicode cause investigation considered SQLite UTF-8 encoding, normalization and
transport serialization. Node 22 source red probe exercised stdio high/low and
embedded high/low separately: all four incorrectly returned success, wrote rows,
and retained a U+FFFD replacement instead of the caller's string, with zero model
calls. JSON stringify/parse and public `boundedText` both preserved the malformed
input exactly, ruling out normalization and stdio-only serialization. This is
consistent with the primary's standalone SQLite oracle. Strengthened cause-aware
source red test: exit 1, 0/1 passed, 743.424ms test duration; owned parent was empty
and removed. A preceding source red run also observed all four cases (822.504ms).
The sequential pre-fix matrix stopped naturally on Node 24's first source red
focused run (16/17 passed, exit 1, 8389.512ms); no remaining Node 24 gates ran.

Before the combined host-only fix, the separate Node 22 replacement-content red
probe likewise accepted all four high/low stdio/embedded cases, wrote rows and
retained U+FFFD, with zero model calls. JSON and `boundedText` preserved the input.
Command: sanitized `node tools/testing/run.mjs --test-concurrency=1
--test-reporter=tap --test-name-pattern=IS2b2 adapters/mcp/test/history-updates.test.mjs`.
Exit 1, 0/1 passed, 829.959ms test duration (567.814ms subtest). The runner and
immediately registered fixture cleanup handled the assertion failure. The fix
rejects only the new tool's malformed content/source before calling core.

Plan checkpoint: written before code changes. No implementation or verification
claims yet. There is no TypeScript gate in this public JavaScript repository.

API/config checkpoint: the host adds one registration and one independent
construction/CLI/profile option, reusing the receipt helper and public
`core.supersede`. Core, OpenAI adapters, schema, locks, versions, evaluation and
CI are untouched. The bridge supplies the key only to its existing model tools,
and history uses the existing 30/35/45-second local deadline stack.

First focused Node 22.16 run: 13/14 passed. The failed test expected omitted
`inspect_memory` states to exclude history, but the pre-existing public core
and MCP list default includes both active and historical. Primary clarified
that IS1 preserves this default and that active-only inspection means explicit
`states: ['active']`. Only the test expectation changed; runtime defaults and
the engine did not. The focused rerun passed 14/14. Subsequent test-only additions
strengthen foreign-project rejection, persisted valid qualification preconditions
(content/receipt digests and exact anchors) and positive complete canonical
source normalization; the final focused count is therefore 15, pending rerun.

The first entire `npm run test:mcp -- -- --test-concurrency=1` passed 117/117,
but npm appends this argument after file paths, where Node does not apply it.
The explicit low-concurrency equivalent
`node tools/testing/run.mjs --test-concurrency=1 adapters/mcp/test/*.test.mjs`
then passed 117/117 (75.8 seconds). The final suite adds one test (118), pending
rerun. For literal npm commands below, `taskset -c 0` is used on this Linux host;
the verified `os.availableParallelism()` is 1, making Node's default test-file
concurrency 1. Runner options are placed before file paths for direct commands.

Separately built local artifact:
`/tmp/cairn-history-native-verification-bumdHX/cairn-local-artifact-ydZs2u/cairn-memory-local-preview-0.0.0-preview.1.tgz`,
SHA-256 `285754eff40118fe91fd69b1f328c0532c37890116dcadb46614fb0a8c5dfe1f`.
All 93 listed source-file hashes matched the separately installed bytes at
`/tmp/cairn-history-native-verification-bumdHX/installed/node_modules/cairn-memory-local-preview/`.
This newly owned artifact/install is retained for primary inspection; it is not
a release, global install or registry publication.

Pinned Hermes source:
`/tmp/cairn-hermes-host-nyi8sE/hermes-agent-c8aa5608c24e3636e77c267650c0f1f52e44adb0`.
Only source/venv and its canonical runner are used, never its profile or live
artifacts. New history-only canonical test passed 10/10, then the complete six-file
matrix passed 32/32 on Node 22.16 with `-j 1 --file-retries 0` (156.1 seconds),
against the artifact above. Fake completions, keyless subprocesses and a fetch/key
denial wrapper ensure no model calls. New history tests additionally observe a
synthetic key canary: no outer `OPENAI_API_KEY` and a 45-second timeout. The
complete matrix subsequently gains test assertions for the real native setup
wizard's independent option and blank reconfiguration; final rerun pending.

Canonical invocation uses all six files under `integrations/hermes/test/`:
`test_provider.py`, `test_agent_conversation.py`, `test_qualified_provider.py`,
`test_qualified_conversation.py`, `test_capture_recovery.py`, `test_history_updates.py`,
then `-j 1 --file-retries 0 -- --cairn-executable <installed>/bin/cairn-memory.mjs
--cairn-node <exact-node> --basetemp <new-owned-parent>/pytest -q -p no:cacheprovider`.
The canonical runner terminates each child process group before cleanup. An
outer `createTestWorkspace` finally block removes the newly owned parent;
Node 22 first/full runs both printed removal `true`. Host source/venv caches and
the runner's duration cache remain; no historical directory sweep is performed.

Inspected applicable CI/contributor gates beyond the requested focused tests:
the full offline artifact suite, clean-cache installation regression, workspace
lifecycle gate, marketplace and strict Claude plugin validations. Core/adapter
implementations, classification, capture, extraction, scorers and qualification
wire formats are unchanged, so their separate mutation-specific gates are not
substituted for this profile's observable lifecycle checks.

Node 22 JSON `npm run validate` and `npm run demo:history` passed. Locked isolated
MCP/OpenAI dependencies and the four pinned public-registry metadata entries were
prepared with sanitized environments. Maintainer validator installation used
`--ignore-scripts`, initially leaving its native stub and failing the plugin
gate; the inspected pinned local `install.cjs` was then run (hardlinks the already
installed platform binary), and marketplace/strict plugin validations both
passed. No credential or model call was used. Remaining final matrix evidence
will be appended without removing these first-run observations.

## Final candidate after IS2b/IS2b2

The completed pre-fix sequential Node 22 matrix is retained as historical
evidence, not final gates: focused16/16 (14340ms), JSON validation0 (526ms),
marketplace/strict plugin0 (1604ms), demo history0 (855ms), MCP118/118
(101446ms), artifact88/88 (418402ms), workspace lifecycle25/25 (21319ms),
clean-cache regression0 (4522ms), canonical six-file32/32 (159115ms). All
listed exit codes were0; milliseconds here are observed command wall time.
Pre-fix generic `taskset -c 0 npm test` also passed401/401
(211534.323ms reported test duration). The final matrix reruns these gates.

Source and tests frozen after the combined new-tool Unicode preflight; only this
plan's evidence may be appended. `git diff --check` exits 0. Final focused command
on each exact Node version, with sanitized `env -i PATH=<node-bin>:/usr/bin:/bin
HOME=/home/chichieh LANG=C.UTF-8 NODE_DISABLE_COMPILE_CACHE=1`:
`node tools/testing/run.mjs --test-concurrency=1 --test-reporter=tap
adapters/mcp/test/configuration.test.mjs adapters/mcp/test/history-updates.test.mjs
packaging/test/history-updates.test.mjs`. Node 22.16: exit 0, 18/18,
12033.313ms; Node 24.15: exit 0, 18/18, 9260.213ms. All eight malformed source /
content stdio+embedded probes now return `invalid_input` with unchanged all-row
snapshots and zero model calls. Valid 800-unit source and 600-unit content emoji
pairs are preserved. Installed tests add high/low source+content snapshot checks.

Fresh final archive (not the retained pre-fix archive):
`/tmp/cairn-history-final-verification-Qzz2LS/cairn-local-artifact-FCdBiZ/cairn-memory-local-preview-0.0.0-preview.1.tgz`,
SHA-256 `c92a6d1a127e601bc4597f4d3b30a4c46714e0dec87638d1435779a3d535c74d`.
All 93 shipped source hashes match the separately installed bytes at
`/tmp/cairn-history-final-verification-Qzz2LS/installed/node_modules/cairn-memory-local-preview/`.
This owned artifact/install is retained for primary inspection, not cleanup.

| Frozen file | SHA-256 |
| --- | --- |
| `adapters/mcp/server.mjs` | `2df04df61921549c636d7bd8b901f9c689b4a4f1b4a7818d0ca742dfb374d724` |
| `adapters/mcp/cli.mjs` | `a33e0cbc69422ebb2252cf14ef0a8746d1f07361f789bbe2c8f0196e23b59a6b` |
| `integrations/hermes/cairn/__init__.py` | `160b1e177a877d01af2453822f2153f174029bec056188cdae4188b51860a1b1` |
| `integrations/hermes/cairn/bridge.py` | `885acaf43a34dba899a71f4b74cf78699276733429ff204df3a74399bb911d90` |
| `adapters/mcp/test/configuration.test.mjs` | `69871dba175530b740755caba4cddcd17db6cf4baf6de8dd18602521c99356bc` |
| `adapters/mcp/test/history-updates.test.mjs` | `693b51964ca461912425658bdceae1e3dfe6331eab5fe1dc09568cacd338c7bf` |
| `packaging/test/history-updates.test.mjs` | `3161a1af08f4b6bde26d35de1abe2e71538856449758604a462b07cbf44575fa` |
| `integrations/hermes/test/test_history_updates.py` | `2faead988cde3416cceaa0847f603a99f4ad3c72b73ce148599b4f92ed67334c` |

Historical checkpoint: full final matrix was pending coordinated serial reruns; no pre-fix green gate is
claimed as final acceptance. No scored reliability or parity claim is made.
Primary confirmed worker owns final Node22 full sequence first; primary owns
final Node24 full sequence and acceptance after worker releases the run slot.
Exact sanitized commands and canonical owned-workspace wrapper are retained at
`/tmp/cairn-history-final-verification-Qzz2LS/node22-logs/commands.json`.
Numbered `.stdout.log`, `.stderr.log` and `.result.json` retain command, actual
Node version, exit code and elapsed milliseconds. Full suites use `taskset -c 0`
and observed available parallelism1; direct focused commands use explicit
`--test-concurrency=1`. No gates are run concurrently by this worker.

Primary's dependent-doc inspection authorized one narrow doc-only scope extension:
`docs/supersession.md`, plus the existing standalone historical-inspection
paragraph. Their old broad "no new MCP tool" statements now distinguish the core
API from the independent opt-in wrapper and link setup, without changing core,
capture chronology, qualified fences, inventories/defaults or automatic inference.
Historical scoped `docs/plans/supersession-engine.md` acceptance is left intact.
Runtime/test hashes and all 93 shipped source hashes remain frozen; docs are not
in that artifact list. `git diff --check` passes after the doc follow-up. Applicable
JSON validation will rerun serially after the current runtime gates settle;
primary's Node24 matrix will validate these final docs as well.

### Final Node22 completed gates and native seam finding

| Final command (same sanitized prefix above) | Exit | Count/result | Wall ms |
| --- | --- | --- | --- |
| `taskset -c 0 npm test` | 0 | 401/401 | 243554 |
| `npm run validate` | 0 | JSON/version valid | 121 |
| `npm run validate --prefix tools/plugin-validation` | 0 | Marketplace and strict plugin valid | 1458 |
| `npm run demo:history` | 0 | Explicit retained historical/current evidence | 249 |
| `taskset -c 0 npm run test:mcp` | 0 | 120/120 | 94965 |
| `taskset -c 0 npm run test:artifact` | 0 | 88/88 | 538390 |
| `taskset -c 0 npm run test:workspace-lifecycle` | 0 | 25/25 | 14254 |
| `node tools/testing/run.mjs --script packaging/verify-clean-cache.mjs` | 0 | CI-warmed cache installs offline | 4203 |
| Canonical six-file Hermes wrapper, `-j 1 --file-retries 0` | 1 | 31/32; five files pass, history9/10 | 158956 |
| `npm run validate`, after dependent-doc edits | 0 | JSON/version valid | 98 |

The native failure was a test expectation, not an accepted malformed update:
Hermes returns `cairn_transport_failed` for a lone source surrogate before the
Node tool receives it, rather than the test's assumed `invalid_input`. Canonical
owned scratch `canonical22-final-lkhYKA` was removed (`true`), and all child
process groups settled normally. Failure/traceback retained in log09; the
worker stopped and escalated before changing frozen code or test expectations.

Read-only pinned SDK investigation confirmed `mcp/client/stdio.py:174` calls
Pydantic `model_dump_json` before UTF-8 encoding/sending. An isolated sanitized
pinned-venv `JSONRPCRequest` probe preserved the lone surrogate in outer
`json.dumps`/`json.loads` and the request object, then raised
`PydanticSerializationError` wrapping `UnicodeEncodeError: surrogates not allowed`
on `model_dump_json`. No memory store, provider, network call or file write was
used in this probe. Existing Hermes transport-error handling refuses this earlier
seam; primary must decide the observable expected envelope before a native rerun.
The direct real Node SDK/stdio malformed-text guards remain green and atomic.

Primary clarification IS2c/IS8c preserves existing Hermes SDK/runtime semantics,
without a duplicated Python validator. The precise native expectation is
`cairn_transport_failed`, `retryable: false`, for both lone-source and
lone-replacement-content high/low surrogates before Node receives the call.
The clarified test additionally checks every SQL table, unchanged caller dict,
the same predecessor's active state/original receipts, and a successful subsequent
valid update on that predecessor. The key-denial/fetch-denial wrapper remains
enabled, and normal settled-child cleanup remains mandatory. This earlier
boundary-specific refusal is not success, general transport reliability or
legitimate-source semantics. Prior31/32 failure and all logs remain retained.
Only the native test changed: its replacement frozen SHA-256 is
`2faead988cde3416cceaa0847f603a99f4ad3c72b73ce148599b4f92ed67334c`;
the earlier `4ebdd4d01820d27f81b19d91193d6974ff1ea3c7167ce3c5f90343eeea7a68a9`
hash identifies the failed expectation. All other
runtime/test hashes and 93 shipped source hashes remain unchanged. Primary
authorized rerunning only the affected full32 canonical Node22 matrix; unrelated
final runtime gates already tested the identical source and are not repeated.

IS2c final Node22 canonical rerun: exit0, six files,32/32 passed, zero retries,
152906ms command wall time (152.7s canonical report), with same inspected final
artifact. Exact command/output/exit/timing retained in
`node22-logs/11.result.json`, `11.stdout.log`, `11.stderr.log`. Fresh owned
canonical parent was removed (`true`) after process groups settled. The
pre-existing pinned-source archive's optional git bytecode-precompile warning
does not affect runner status; both failed and successful runs retain it.
All eight current source/test hashes were rechecked afterward; only the expressly
authorized native test hash differs from the first freeze. `git diff --check`
remains0. No worker gate/process remains running; run slot released to primary
for the full Node24 matrix and personal acceptance. At that historical checkpoint,
Node22 final gates were complete while primary Node24 full verification/reviews/
delivery remained pending; the completed primary verification is appended below.

Post-run final archive and installed93 source hashes revalidated successfully.
An additional owned-root inventory assertion first exited1 because it omitted
the generated `node-compile-cache` directory, not because a fixture leaked.
The corrected exact inventory check (compile-cache disabled for the check itself)
exited0: retained archive/staging, installed artifact, numbered logs and generated
Node compile cache only. Neither canonical fixture parent remains. The generated
cache is retained with the inspected artifact; no sweep or removal of historical
directories was attempted. This diagnostic failure does not change runtime
source or acceptance results.

## Primary personal acceptance record

Primary personally reran final focused acceptance on Node22.16.0 and24.15.0,
then the complete nine-command Node24 matrix serially. The worker read each
actual command/result and combined log under
`/tmp/cairn-history-final-verification-Qzz2LS/primary-logs/`.
The ordered exact command manifest is the `cmd` field in
`01.result.json` through `11.result.json`; corresponding complete outputs are
`01.combined.log` through `11.combined.log`. All11 commands exited0 and all
result records report `truncated: false`. Each uses the sanitized prefix
`env -i PATH=/home/chichieh/.nvm/versions/node/v<version>/bin:/usr/bin:/bin
HOME=/home/chichieh LANG=C.UTF-8 NODE_DISABLE_COMPILE_CACHE=1`.

| Log | Exact Node | Command after sanitized prefix | Observed result | Wall ms |
| --- | --- | --- | --- | --- |
| 01 | 22.16.0 | Focused command recorded above, explicit concurrency1/TAP | 18/18 | 15805 |
| 02 | 24.15.0 | Same focused command | 18/18 | 13811 |
| 03 | 24.15.0 | `taskset -c 0 npm test` | 401/401 | 202155 |
| 04 | 24.15.0 | `npm run validate` | JSON/version valid | 378 |
| 05 | 24.15.0 | `npm run validate --prefix tools/plugin-validation` | Marketplace and strict plugin valid | 7025 |
| 06 | 24.15.0 | `npm run demo:history` | Explicit retained historical/current evidence | 538 |
| 07 | 24.15.0 | `taskset -c 0 npm run test:mcp` | 120/120 | 89914 |
| 08 | 24.15.0 | `taskset -c 0 npm run test:artifact` | 88/88 | 336222 |
| 09 | 24.15.0 | `taskset -c 0 npm run test:workspace-lifecycle` | 25/25 | 21637 |
| 10 | 24.15.0 | `node tools/testing/run.mjs --script packaging/verify-clean-cache.mjs` | CI-warmed cache installs offline | 9843 |
| 11 | 24.15.0 | Canonical six-file owned-workspace wrapper in `11.result.json` | 32/32, retries0, scratch removed | 147211 |

These observed orchestration wall times include primary ledger-monitor overhead,
not product performance. Reported test durations differ: focused10241.476ms /
8268.704ms, generic196502.287ms, MCP84123.892ms, artifact329619.205ms,
lifecycle16021.925ms; the canonical runner reports140.7s. Neither timing set
supports a product latency, scored reliability or parity claim.

Primary canonical acceptance used the same inspected final artifact, six exact
test files, `-j 1 --file-retries 0`, Node24 executable and an explicit pytest
basetemp inside a new `createTestWorkspace` parent (`primary24-final-` prefix).
Log11 reports six files,32 tests passed,0 failed, and
`owned canonical scratch removed: true`. The wrapper's finally cleanup follows
settled canonical child groups. Lifecycle25 additionally verifies real owned
success/assertion/setup/child cleanup; no historical directory sweep is used.
Retained archives/install/compile-cache and both verification log sets remain
for inspection, not release/publication.

Primary independently reproduced the exact isolated pinned Python SDK Pydantic
serialization refusal and inspected the final native full-table SQL, unchanged
caller dictionary, active predecessor and valid-followup assertions. This
confirms the narrowly documented Node `invalid_input` versus native
`cairn_transport_failed`, `retryable: false`, boundary without adding runtime
validation or claiming semantic source authenticity/general transport reliability.
Earlier red probes,13/14 expectation failure,31/32 native failure and diagnostic
inventory failure remain historical evidence above; none are erased or substituted
for unrun gates. All required final verification is now recorded. Final commit
freeze, independent reviews and delivery remain primary-owned and pending;
the worker makes no commits, pushes or PRs and changes only this plan here.

Primary's final read-only cross-source proof also passed: archive SHA-256
`c92a6d1a127e601bc4597f4d3b30a4c46714e0dec87638d1435779a3d535c74d`,
169200bytes; all93 shipped hashes match both installed bytes and the exact
current repository source mapping, all8 runtime/test hashes match, all11 primary
gate logs are present/successful/untruncated, and no `canonical22-final-` or
`primary24-final-` fixture parent remains. Product verification model API calls:0.
The first proof exited1 because its harness incorrectly assumed the archive's
`bin/cairn-memory.mjs` existed at that repository-root path. Unchanged
`packaging/build.mjs` maps it from `packaging/bin/cairn-memory.mjs`, and likewise
maps the packaging README, third-party notices and license to their archive
targets. The corrected four-mapping proof exited0 without product/artifact
mutation. Both diagnostic records remain at
`primary-logs/12-original-proof-failure.json` and
`primary-logs/12-corrected-proof.json`; this verification-harness assumption is
not a product failure. No private operational evidence is included here.

## Main-sync integrated-head acceptance

The source-construction base above remains historical. Primary reports initial
candidate `eea72db2b6d90592dfde5d37124da4f7ca19e059` passed both independent
Standards/Spec reviews with 0 findings and all 25 remote checks for PR 313. Strict
branch protection nevertheless requires current main. Primary's ordinary local
branch merge of main `50741cda56a5d9a0b50b1bccbf8071b40c444097` produced
`ce21588811a057c56bad12d0a92db9442b3b8ae7`, without conflict/source rewrite.
It integrated 15 existing main client/Codex test/docs/helper files only: no core,
MCP, Hermes, packaging, runtime, dependencies, configuration or gate changes.
At the integration checkpoint, the feature diff against current main remained
the same 14 paths, 1416 insertions/9 deletions, before this plan-only evidence append.
Primary revalidated all 93 shipped bytes/current-source mappings and all 8 frozen
runtime/test hashes; the worker independently rechecked those 8 unchanged hashes.

Earlier reviews/remote green checks belong to the earlier HEAD, not acceptance
of this integrated or later delivery HEAD. Primary personally reran 18 affected
acceptance commands serially on the exact integration SHA above. The worker
read actual `testedHead`, `cmd`, exit/timing/truncation records and combined logs
under `/tmp/cairn-history-final-verification-Qzz2LS/sync-logs/`.
The ordered exact command manifest is `01.result.json` through `18.result.json`;
full outputs are their corresponding `.combined.log` files. All 18 records have
the integration SHA, exit 0 and `truncated: false`. Command 18 was absent at the
initial read; the worker used bounded 20s waits and did not edit this plan or claim
all-complete until its actual 32-test result and cleanup report existed.

Each command uses the same sanitized prefix recorded earlier with its exact
Node 22.16.0 or 24.15.0 binary. Paired log numbers below list Node 22 then Node 24;
each observed wall-time pair corresponds in that order.

| Logs 22 / 24 | Command after sanitized prefix | Node 22 / 24 result | Observed ms 22 / 24 |
| --- | --- | --- | --- |
| 01 / 10 | Focused command recorded above, explicit concurrency 1/TAP | 18/18 each | 16996 / 13357 |
| 02 / 11 | `taskset -c 0 npm test` | 401/401 each | 221638 / 200224 |
| 03 / 12 | `taskset -c 0 npm run test:pairing` | 270/270 each | 200892 / 237812 |
| 04 / 13 | `taskset -c 0 npm run test:pairing:golden` | Released golden verification, exit 0 each | 49442 / 57076 |
| 05 / 14 | `taskset -c 0 npm run test:codex` | 136/136 each | 76845 / 76831 |
| 06 / 15 | `taskset -c 0 npm run test:client` | 5/5 each | 1089 / 1079 |
| 07 / 16 | `taskset -c 0 npm run test:mcp` | 120/120 each | 88491 / 76978 |
| 08 / 17 | `npm run validate` | JSON/version valid each | 381 / 365 |
| 09 / 18 | Exact six-file canonical wrapper in each result manifest | 32/32 each, retries 0, owned scratch removed | 172953 / 435302 |

The native wrappers use the same inspected final artifact, exact Node executable,
all six Hermes test files, `-j 1 --file-retries 0` and explicit pytest basetemp
inside new owned `sync-22.16.0-final-` / `sync-24.15.0-final-` parents. Both logs
report 32 passed, 0 failed and `owned canonical scratch removed: true`, after
canonical child groups settled. Native runner time is 167.2s / 152.3s; the observed
outer 435302ms for Node 24 includes waiting/polling overhead and is not native or
product wall time. Other observer timings likewise include supervision/monitoring
overhead and support no performance claim.

The earlier full Node 22/24 artifact 88, lifecycle 25, plugin validation, clean-cache
and history-demo evidence remains historical, source-identical verification.
Those unaffected full gates were not rerun after this main sync and are not
claimed as integrated-head executions; the focused installed history test was
rerun on both Nodes. New delivery freeze, both independent review axes and full
latest-head remote CI remain pending; all remote checks will rerun on that final
HEAD. Protocol/engine files are unchanged by the sync or this evidence append.

Separate baseline H3 observation: original main CI 36771787774 reported later
normal classification `failed` rather than `applied` in the 1500ms deadline test.
The bounded Node 22 diagnostic at the earlier feature HEAD ran 3 isolated cases,
one CPU 0 baseline and 8 concurrent same-test cases: 12/12 passed, no exact symptom
reproduced. All owned runner/test parents and the throwaway harness were removed;
exact evidence remains under
`/tmp/cairn-history-final-verification-Qzz2LS/ci-h3-diagnosis/`.
This remains an unresolved CI observation, not a confirmed timing cause or a
fixed source bug. No causal hypotheses/probes/source fix were asserted after
the non-reproduction. No private trial paths/data/keys or operational records
are included in this plan. This worker edited only the plan and ran no tests,
provider/API calls, commits, pushes or branch operations for the sync packet.

Cleanup evidence: final focused fixtures register cleanup immediately, close
SDK clients/servers/SQLite handles and explicitly verify owned installed cleanup;
every full JS suite runs through the existing process-group/owned-workspace
runner, with cleanup failures propagating nonzero. The lifecycle25 gate exercises
real success/assertion/setup/child failures and owned scratch removal. Canonical
finally removes its fresh owned parent only after the runner settles children.
Inspected archives, installed packages and numbered logs are intentionally retained;
no user profile or historical-directory sweep occurs.
