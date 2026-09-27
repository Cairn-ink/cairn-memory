# Test-owned scratch lifecycle

Status: local verification complete; independent review and PR delivery next.
No historical cleanup or paid experiment.
Base: `2222ac47159429b01b324e09350478b93e948cf2`.
Integration/review base: `13e5039999e526a0d0e25c62739a3ec067120d27`.

## User outcome

Standard offline test commands own and dispose of their temporary files on
success and failure. Preserve assertions about retained installation failures,
cold reads and formal evaluation evidence. The user will arrange historical
cleanup separately; never enumerate/delete old `/tmp/cairn-*` by prefix or age.

Previous diagnosis exercised the actual current tests in fresh TMPDIR sandboxes:
ordered-capture passed but left one 376832-byte SQLite (Node22 twice/Node24 once),
paired comparison passed but left 16 SQLite files, semantic fake HTTP passed
but left 36, and a cleanup-enabled control left none. Packaging `command()`
dropped scoped TMPDIR in its deliberately sanitized child environment. The
initial red-capable harness and findings are at
`/tmp/cairn-temp-leak-diagnosis.ntItl9`; no need to rescan disk or historical tmp.

## Design and observable acceptance

- T1: Shared test-only workspace helper at `tools/testing/workspace.mjs`.
  `createTestWorkspace(t, { prefix, parent } = {})` creates a NEW exclusive
  directory and immediately registers cleanup with `t.after` when t is supplied;
  null t permits an outer runner's explicit finally. Defaults use `tmpdir()`.
  Return `{ path, defer(fn), cleanup() }`: deferred resource cleanup is awaited
  in reverse registration order, then exact owned directory removal. Cleanup is
  idempotent; all deferred operations are attempted even if one fails. Do not
  swallow errors. Own identity/path checks prevent deleting a replaced root or
  following a symlink outside the owned tree. No adopting arbitrary existing dirs.
- T2: Standard offline `npm test`/`test:*` entrypoints use one shared Node test
  runner with a fresh per-invocation workspace. It launches the existing real
  Node test runner with original arguments/cwd/concurrency, scoped TMPDIR/TMP/TEMP,
  waits for process termination and disposes the exact owned root. Preserve test
  failure/nonzero status; cleanup failure also fails. Do not delete while owned
  children are still running. Handle catchable termination predictably; document
  SIGKILL/host-crash limits, no orphan sweeper in this change. No shell interpolation.
  Native optional suites remain explicitly opt-in. Do NOT wrap paid/live CLI,
  semantic evaluation CLI, public build/install commands or operational scripts.
- T3: This runner is a safety net for legacy fixtures, not a claim each legacy
  fixture now cleans immediately. Migrate the confirmed hot spots to T1 for
  prompt per-test or correctly shared per-file cleanup, including closing cold
  readers/client/proxy/child resources before removing their data. Preserve all
  semantic and installation-retention assertions. Shared installations remain
  until their last consumer finishes. Generated build roots are also confined
  under the outer test workspace; standalone artifact/receipt retention stays.
- T4: Propagate the scoped standard temp location across the inspected sanitized
  packaging command seam without forwarding application environment/credentials.
  Prefer explicit narrowly allowlisted temp values and validation; no broad env
  spread, no credential lookup. Verify with a real child process; report limits
  of unmodified direct Node/manual commands accurately.
- T5: Add an executable cleanup gate on Node22.16 and24.15. Red regressions before
  implementation; real subprocess success, assertion failure, setup failure,
  close/cleanup failure, child failure/termination, overlapping invocations,
  symlink/replaced-root/sibling preservation, and repeat execution. Assert zero
  unexpected retained scratch after owned test runs. Never equate test exit0
  with cleanup success. Include the actual ordered/paired/semantic fixture seam
  and sanitized child-temp seam, not just a fake helper call.
- T6: All ordinary offline test package scripts and the CI direct installed
  rationale test must use the canonical runner; add the dedicated lifecycle
  gate to CI. Keep original suite contents/options, Node floors and optional
  native roots. Document direct-run syntax through the wrapper. Demos retain
  their current standalone artifact contract and are not called scratch-free
  by this packet. Formal evaluations/ledgers/retained outputs remain untouched.
  CI's network-enabled fresh-cache regression and metadata preparation also
  create test scratch: run these through explicit runner `--script` mode,
  keeping standalone utility CLI behavior and the network/offline distinction.
- T7: No public memory-core semantics, model prompts, schemas, pricing, default
  retention, artifact file list, published dependencies or benchmark results
  change. Test helpers are not shipped in the local artifact. Existing package
  command safety/credential-isolation tests remain green. No production, keys,
  corpus, user DB, real ledger, provider calls, publication or deployment.
- T8: Verify changed-area contributor gates on both Node versions, generic/JSON/
  strict-plugin checks, new lifecycle gate and actual offline installed artifact
  path. Primary reruns key combined cases and reviews actual scope; independent
  non-author Standards/Spec reviews use the same final base/candidate before PR.
  No TypeScript gate exists here. Record unavailable optional prerequisites as
  blockers, not skips-as-passes. Do not run huge baseline suites without an owned
  scratch root; no historical deletes or global tmp scan.

## Delegation and integration

Primary owns architecture, acceptance, integration and delivery. Both workers
use GPT-6 Sol/high (explicit user upgrade supersedes older routing labels).

Worker A at `test-workspace-lifecycle`, branch `fix/test-workspace-lifecycle`:
owns `tools/testing/**`, root/adapter test package scripts, relevant CI,
`packaging/build.mjs` scoped-temp propagation, and technical docs/CHANGELOG plus
this plan. No fixture-family edits assigned to B. First freeze T1 API; coordinate
changes before affecting B. Supply foundation commit early for B to consume.

Worker B at `test-fixture-disposal`, branch `fix/test-fixture-disposal`: owns only
`core/test/ordered-capture.test.mjs`, `core/test/query-candidates.test.mjs`,
`evaluation/live/test/qualified-comparison.test.mjs`, and packaging tests
`qualified-install-receipt`, `qualified-install-mcp`, `install`,
`preview-installer`, `automatic-rationale` (`.test.mjs`). May add tightly related
regression fixtures after coordination, not change runtime/build/helper/scripts.
Use exact T1 API; do not weaken tests. Trace all closes and shared setup scopes.
Wait for foundation before running; return only scoped fixture commit(s).

Use independent worktrees; primary combines commits into A for one coherent PR.
Workers do not push/merge or spawn further agents. Before edits report caller
trace and planned acceptance coverage. Run small red/green gates before full
suites. Reserve final slots for two independent reviewers. No cleanup of old
worktrees, caches or historical artifacts is part of the delivery.

## Evidence record

Worker A `/root/workspace_framework6` and B `/root/fixture_disposal6` dispatched
as GPT-6 Sol/high against the recorded base. Both supplied entrypoint/resource
traces before edits. A foundation `7376b85` supplies helper plus three focused
tests (Node22 3/3); B integrated its identical tree as `575be72`.

Primary independently reconfirmed the old ordered fixture: child exit 0 but one
unexpected root, so the no-residue assertion failed as expected. Probe
`/tmp/cairn-test-lifecycle-evidence.MjDOl0/probe.mjs` deletes its own new sandbox
in finally; it did not touch historical data. The directory intentionally holds
only this small acceptance probe/evidence, not installed packages or databases.

B fixture `3717342` integrated as `a728a8b`; worker raw ordered/query/comparison
files passed 78/78 on both runtimes with zero residual roots before sandbox
cleanup. Framework `a110097` initially passed its 19-case lifecycle gate. Primary
inspection then requested cleanup-promise reentrancy and signal-during-removal
regressions; corrections `36b1595` and `3c8074b` bring the gate to 22 cases.
Their red failures were explained and corrected, not ignored via reruns.

Primary pre-main integration checks: generic 114/114, artifact 85/85, MCP 91/91,
JSON and strict plugin validation passed; real semantic wrapper probe left zero
roots on both runtimes. Raw migrated ordered/paired/receipt probes also left zero.
The cache preparation and fresh-cache installation regression passed using owned
script-mode workspaces. No model requests were made.

Upstream advanced with CX1 and SE-1 during this work. Primary integrated main
13e503 in `a1f7009`, preserving both changelog additions (only manual conflict)
and the automatically combined installation assertions. JSON, syntax and merge
diff checks passed; the full affected matrix is rerun on this combined code.
The review diff uses 13e503, excluding unrelated upstream features from this PR.

An independent canonical-npm probe detected npm's `node-compile-cache` outside
the runner-owned directory. Local npm `lib/cli.js` explicitly enables this cache
before launching scripts. This is external tooling's persistent cache, not a
test fixture, and this change does not delete shared tool caches. Strict scratch
probes disable that parent-process cache with `NODE_DISABLE_COMPILE_CACHE=1`;
the original observation remains recorded, not counted as zero residue.

Native-gate instrumentation exposed a second acceptance-harness issue: placing
scratch inside the long evidence directory made Unix-domain socket paths 136
bytes. Worker B independently reproduced `listen()` followed by `stat` ENOENT
using a 141-byte path while a 37-byte control worked, with both probes closed
and their newly created scratch removed. The acceptance driver now creates a
short exclusive `/tmp/ct-*` parent and records its exact path; it never
searches for old directories. No production socket code or containment policy
was changed. The short-root Node22 runs passed native 9/9, mixed native 26/26
and gateway 45/45, all with zero residual roots. Node24 subsequently passed the
same counts with short owned roots. Initial overlong-path failures (including
the already-started long-root gateway checks) remain in the evidence and are
not represented as passing runs.

## Combined verification

Primary tested the code at `e32f43b` (same executable tree as `a1f7009`; later
change is documentation only). Each canonical command ran in a fresh exclusive
parent, with parent npm compile caching disabled as described above; the primary
asserted the parent was empty after process exit, separately from test status.
Empty parents were removed; diagnostic logs remain intentionally in
`/tmp/cairn-test-lifecycle-evidence.MjDOl0`. No historical directory was deleted.

| Gate | Node 22.16 | Node 24.15 | Residual test roots |
| --- | --- | --- | --- |
| `test:workspace-lifecycle` | 22 passed | 22 passed | 0 |
| `test` | 121 passed | 121 passed | 0 |
| `test:core` | 815 passed | 815 passed | 0 |
| `test:artifact` | 86 passed | 86 passed | 0 |
| `test:openai` | 282 passed | 282 passed | 0 |
| `test:mcp` | 91 passed | 91 passed | 0 |
| `test:live-evidence-offline` | 340 passed / 30 skipped | 340 passed / 30 skipped | 0 |
| `test:longmemeval` | 193 passed | 193 passed | 0 |
| `test:experiment-budget` | 65 passed | 65 passed | 0 |
| `test:experiment-request-guard` | 292 passed | 292 passed | 0 |
| `test:mem0-native-gateway` (short root) | 45 passed | 45 passed | 0 |
| `test:benchmark-budget-extension` | 13 passed | 13 passed | 0 |
| `test:mem0-native-local` (pinned roots) | 9 passed | 9 passed | 0 |
| `test:mixed-native-local` (pinned roots) | 26 passed | 26 passed | 0 |
| Installed rationale opt-in gate | 4 passed | 4 passed | 0 |

The 30 ordinary live-suite skips are existing optional installed/pinned-host
cases, not successes. The three rationale skips are exercised by its explicit
four-test installed gate above; other opt-in host coverage is not claimed by
this test-infrastructure packet. Native optional suites used the existing
explicit pinned Mem0 and Python roots and real Linux containment with fake HTTP,
never a key, corpus or operational ledger. Missing prerequisites were not skipped.

`demo:store`, `demo:openai-offline` and `demo:longmemeval-ingestion` also passed on
both runtimes using explicit script-mode ownership in primary verification;
their standalone CLI retention behavior was not changed. JSON and strict plugin
validation passed after main integration. Static/diff inspection verified that
all original test arguments, concurrency, targets, engines, dependencies and
artifact file list remain unchanged against review base 13e503; assertion-call
counts in all eight migrated fixtures are unchanged as an additional scope check.

Routing observations: two bounded Sol/high implementation workers, followed by
primary acceptance; no model fallback. Primary interventions were two lifecycle
edge cases, upstream changelog integration and two diagnosed harness/tool-cache
boundaries. No repeated unsuccessful correction loop. Elapsed model time and
token cost are not measured. All listed gates are complete. Independent
Standards/Spec review uses this plan and the same committed candidate before
push; fixed-SHA reviewer findings and final CI delivery are recorded in the PR.
