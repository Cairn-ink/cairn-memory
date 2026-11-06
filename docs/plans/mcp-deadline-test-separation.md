# Separate MCP deadline enforcement from same-host recovery

## Scope and evidence boundary

Original fixed base: `061dc31ffe32d6e40d55ee6d3c01d144097c7795`.
Standalone delivery base: `ad274b6117f86446fbf0ff16f503ae69d0278ce5`.
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/mcp-deadline-separation`.
Branch: `test/mcp-deadline-separation`. Requested implementation owner:
GPT-6.1 Sol, high reasoning. The primary confirmed accepted spawn controls
`model=gpt-6.1-sol`, `reasoning_effort=high`, `fork_turns=none`; this is
primary-observed dispatch metadata, not worker self-introspection.

Only the deadline test, its synthetic stdio fixture, and this plan may change.
No production/runtime/default/dependency/CI changes, provider or web calls,
operational keys/ledgers, existing experiment artifacts, other worktrees,
hosted reruns, push, merge, release or deployment. The paid run uses a different
frozen worktree. Inspection/editing is authorized now; installs and tests wait
for the primary's explicit release and run sequentially without stress load.

Historical CI job `117806656760` in run `39171938904` failed at the later
classification assertion: actual `failed`, expected `applied`, H3 elapsed
3853.399196 ms, suite 110/111 passed, job exit **1**. The log has neither the
classification error code nor stage timing. The read-only diagnosis retained
33/33 unmodified passes and controlled 1700 ms synchronous-classifier failures
with `model_timeout` (direct exit **1**, repeated control 2/2 exit **1**),
followed by disabled-pause controls 2/2 exit **0**. Those green reruns do not
establish the original CI cause. This change addresses demonstrated coupling
in test design and improves diagnostics; it is not a production runtime fix
or a claim that the historical CI failure was diagnosed.

The primary retained the original diagnosis and logs under
`/tmp/cairn-idf-h5b-primary-xLEMbe/t3-mcp-ci-diagnosis61.md` and
`/tmp/cairn-mcp-deadline-diagnosis61.1Az14u`. This task does not alter them.

## Acceptance contract

- H1: Independently test real stdio pre-admission extraction timeout with a
  fixed 1500 ms core budget, `model_timeout`, no memories/receipts, and exact
  `extract` stage history. The client deadline is 12000 ms.
- H2: A separate host receives one deliberately adequate fixed 5000 ms budget.
  Its first extraction really times out; a distinct later capture on that same
  host admits one memory, applies classification, and retains one receipt.
  There is no host restart or per-call options mutation.
- H3: The later capture explicitly requests a bounded 1700 ms synchronous fake
  classifier pause, exceeding the old 1500 ms success assumption and fitting
  the fixed liveness budget. Verify the identical liveness test with only its
  budget changed to 1500 goes red at `failed` versus `applied` and reports
  `model_timeout`, then restore 5000 and verify green. Run once per runtime at
  each setting; do not retry until lucky.
- H4: Classification assertions include the structured classification object,
  model stages, and elapsed capture time. Error codes preserve the distinction
  between `model_timeout`, `storage_busy`, and `revision_conflict`; diagnostics
  include no source passages, credentials, or inherited environment.
- H5: Remove ineffective post-construction mutation and document the server's
  configuration snapshot; add no public option or weaker runtime behavior.
- H6: Keep tool/schema/authority H2 and post-admission/cold inspection/recovery
  H4 behavior. Use `createTestWorkspace`, defer client closure before removal,
  and close SQLite handles in `finally`. Verify success and deliberate
  assertion-failure cleanup only under newly owned temporary parents.
- H7: On Node 22.16.0 and 24.15.0, run scoped deadline tests and full MCP tests,
  then contributor `npm test`, `npm run validate`, and isolated maintainer
  validation. Record actual exits and counts. There is no TypeScript gate.
- H8: Cross-check the complete changed-file inventory through diff names and an
  independent tree/status route; print its count. Freeze one scoped local
  candidate commit after gates, without pushing. The primary owns integration,
  independent Standards/Spec review, and acceptance.

## Hypotheses and design

The retained diagnosis ranks three falsifiable explanations. The later capture
may independently exhaust its 1500 ms wall budget (predicts `model_timeout`
and a late response); post-admission storage/freshness may fail (predicts a
different structured code, such as `storage_busy` or `revision_conflict`);
or stale cancellation/claim state may damage the later call (predicts failure
despite an adequate fresh budget, possibly before that budget expires).
Only the first has a controlled matching reproduction. Natural CI recurrence
and historical root cause remain unproven.

`createCairnServer` snapshots `captureDeadlineMs` during construction, so the
existing fixture's later mutation cannot enlarge a particular capture. Both
the stalled capture and the success capture must share their host's fixed
budget. The short test retains the 1500 ms enforcement check. The liveness test
deliberately waits for a real 5000 ms timeout before invoking the same host
again. Its fixed 1700 ms synchronous pause exercises late-result rejection
even while the event loop cannot service a timer. It leaves 3300 ms for the
ordinary synthetic success path rather than making it a 1500 ms performance
test. No core/server configuration implementation changes.

## Affected entrypoints and check owners

| Entry/check | Owner | Required evidence |
| --- | --- | --- |
| Deadline fixture through actual `capture_memory` stdio | Worker | Short timeout, same-host delayed success, bounded red control |
| H2 tool inventory and submitted message authority | Worker | Existing assertions in scoped/full MCP suite |
| H4 initial classification retention, keyless cold read, guarded recovery | Worker | Existing assertions in scoped/full MCP suite |
| `tools/testing/workspace.mjs` and owned outer runner | Worker | Success/failure cleanup under fresh owned parent, no helper changes |
| Full MCP matrix, generic contributor and maintainer checks | Worker | Actual exits on both runtimes |
| Runtime `core/`, server/CLI/public schemas, CI, browser and cross-feature callers | Primary | Unchanged; no product URL/text/browser replay changes |
| Fixed candidate Standards/Spec review and integration | Primary and independent reviewers | Same base/candidate, both axes accepted before delivery |

A fixed-string caller search across adapters, tools, CI, package scripts and
docs found only this test's fixture reference; no external command depends on
the removed combined H3 name. Existing package glob entrypoints continue to
exercise both separate H3 tests. No browser/URL replay applies to this test-only
change.

## Verification record

The primary released installs/tests after the separate paid run completed with
actual run exit **0** and terminal audit exit **0**. No tests/installs ran in
this worktree before that release. Worktree root, MCP, OpenAI and maintainer
`node_modules` targets were absent, checked with `ls -ld` (absence exit **2**),
so no shared installation or symlink was removed. Locked offline installs on
Node 22.16.0 each exited **0**: MCP 14 packages, OpenAI 1 package (required by
the full MCP tokenizer tests), maintainer validation 3 packages. No lockfile
changed.
`scripts/README.md` and repository/ancestor `AGENTS.md` are absent in this
public repository; the supplied session instructions and `CONTRIBUTING.md`
govern. Read ADR 0002 and `CONTEXT.md`. No operational script was run.

Every test/install used a cleared environment, with this prefix (replace
`VERSION` with exactly `22.16.0` or `24.15.0`):

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/vVERSION/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1
```

Actual offline install commands, after the absence/symlink checks:

```sh
npm ci --offline --ignore-scripts --no-audit --no-fund --cache /home/chichieh/.npm --userconfig /dev/null --prefix adapters/mcp
npm ci --offline --ignore-scripts --no-audit --no-fund --cache /home/chichieh/.npm --userconfig /dev/null --prefix adapters/openai
npm ci --offline --ignore-scripts --no-audit --no-fund --cache /home/chichieh/.npm --userconfig /dev/null --prefix tools/plugin-validation
```

For the red control, `apply_patch` temporarily changed only
`livenessDeadlineMs` from 5000 to 1500. The actual controlled commands, each
preceded by its runtime's allowlisted prefix, were:

```sh
node tools/testing/run.mjs --script /tmp/cairn-mcp-deadline-separation.utPIwo/cleanup-probe.mjs red-22 'H3 actual stdio same host'
node tools/testing/run.mjs --script /tmp/cairn-mcp-deadline-separation.utPIwo/cleanup-probe.mjs red-24 'H3 actual stdio same host'
```

The probe creates a fresh `createTestWorkspace` with a separate `scratch`
parent, then launches the selected test with the same Node executable and
`--test --test-name-pattern=H3 actual stdio same host`. Only PATH, disabled
compile cache and owned `TMPDIR`/`TMP`/`TEMP` enter that child. The outer owned
runner supervises its process group. Before returning, the probe checks the
suite's scratch is empty, removes its own workspace and verifies removal.
Thus outer-runner cleanup cannot hide a suite cleanup failure.

`apply_patch` restored 5000, and the same commands ran once each with labels
`green-22` and `green-24`. There were no retries. Retained raw logs and JSON
are `/tmp/cairn-mcp-deadline-separation.utPIwo/{red,green}-{22,24}.{log,json}`.

| Control | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| 1500 ms fixed budget, 1700 ms classifier | exit **1**, expected `applied` / actual `failed`, `model_timeout`, later capture 1822.21 ms | exit **1**, same structured symptom, 1799.42 ms |
| Restored 5000 ms fixed budget, same pause | 1/1 pass, exit **0** | 1/1 pass, exit **0** |
| Assertion-failure and success cleanup | both before/after counts **0**, no child signal, probe workspace removed | both before/after counts **0**, no child signal, probe workspace removed |

Both red diagnostics show exact stages
`["extract","extract","qualify","classify"]`. The same-host green test also
asserts exactly one 1700 ms synthetic pause and elapsed capture time at least
1700 ms. This controlled evidence does not establish why the historical CI
run failed.

Subsequent commands under each runtime's allowlisted prefix:

```sh
node tools/testing/run.mjs adapters/mcp/test/capture-deadline.test.mjs
npm run test:mcp
npm test
npm run validate
npm run validate --prefix tools/plugin-validation
npm run test:workspace-lifecycle
```

| Gate | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| Scoped deadline suite | 4/4 pass, exit **0** | 4/4 pass, exit **0** |
| Full MCP suite | 112/112 pass, exit **0** | 112/112 pass, exit **0** |
| Generic `npm test` | 673/673 pass, exit **0**, 230.50 sec | 673/673 pass, exit **0**, 208.85 sec |
| JSON validation | exit **0** | exit **0** |
| Isolated maintainer validation | exit **0** after local prerequisite recovery below | exit **0** |
| Workspace lifecycle | 25/25 pass, exit **0** | 25/25 pass, exit **0** |
| Structured diagnostic probe | timeout/storage/revision cases pass, exit **0** | same three cases pass, exit **0** |

The long generic test is actively supervised using process CPU time, current
test output and owned sequence-directory progress; live PIDs alone are not
counted as health. Verification runs sequentially, with no stress workload.
Only newly owned scratch is cleaned, after clients/SQLite handles/processes
close. No historical scratch sweep.

The first maintainer validation on Node 22 exited **1** with `claude native
binary not installed`: `--ignore-scripts` left its package-local launcher stub
in place. This tooling prerequisite failure remains in
`original-maintainer-22.log` and `original-gates.json`; it is not a test flake.
The complete pinned `install.cjs` was inspected: its Linux path only detects
platform and hardlinks/copies the already-installed optional native payload
into its own package. Running that helper under the cleared Node 22 environment
exited **0**, with no network, credentials or user configuration involved:

```sh
node tools/plugin-validation/node_modules/@anthropic-ai/claude-code/install.cjs
```

The subsequent maintainer checks use this exact owned runner command under
each runtime's allowlisted prefix:

```sh
node tools/testing/run.mjs --script /tmp/cairn-mcp-deadline-separation.utPIwo/maintainer-probe.mjs
```

That probe runs `npm run validate --prefix tools/plugin-validation` with a fresh
owned `CLAUDE_CONFIG_DIR`, `CI=1`, `DISABLE_TELEMETRY=1`, and
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, plus owned temp paths and the
cleared PATH/compile-cache settings. Both marketplace and strict plugin
validation pass. It cleans its own workspace afterward.

The diagnostic probe extracts the actual `classificationDiagnostic` helper
from the test and forces synthetic assertion failures for `model_timeout`,
`storage_busy`, and `revision_conflict`. Each actual assertion message retains
the distinct code, exact stages and elapsed time, with no source passages or
credentials. Command under both runtimes' allowlisted prefixes:

```sh
node tools/testing/run.mjs --script /tmp/cairn-mcp-deadline-separation.utPIwo/diagnostic-probe.mjs
```

Logs are retained in the owned evidence directory. Original-base scoped/MCP/
generic logs use `{scoped,mcp,generic}-{22,24}.log`; subsequent successful gates
use `recovered-{validate,maintainer,workspace,diagnostic}-{22,24}.log` and their
exact commands/exits/counts are also recorded in `recovered-gates.json`.

Before the original-base candidate commit, mechanical
`git diff --name-only 061dc31...` plus `git ls-files --others --exclude-standard`
was independently cross-checked against `git status --porcelain=v1 -z
--untracked-files=all`: both inventories match, count **3**, actual check exit
**0**. Complete scope:

- `adapters/mcp/test/capture-deadline.test.mjs`
- `adapters/mcp/test/fixtures/deadline-server.mjs`
- `docs/plans/mcp-deadline-test-separation.md`

## Standalone delivery-base refinement

The primary explicitly authorized rebasing only this unpublished one-commit
branch onto inspected `origin/main`
`ad274b6117f86446fbf0ff16f503ae69d0278ce5`, after retaining the original-base
candidate and logs. `git diff --exit-code` between the bases confirms both
allowed MCP files and all three installed package lockfiles are identical,
actual exit **0**. No runtime changes are carried. The worker must stop on any
conflict or unexpected scope and rerun affected acceptance/contributor gates
on the standalone base; original-base passes above remain historical. The
primary owns a separate focused PR and independent reviews. Original PR442
stays blocked, and its historical failure remains unexplained. No push or
merge is authorized for this worker.

Original candidate `17779fb9a455aece81b3f465472ec3018b400cc2` was committed
after its original-base gates, with clean status and exactly the three allowed
files. That SHA and all original logs are retained. The exact transplant was:

```sh
git rebase --onto ad274b6117f86446fbf0ff16f503ae69d0278ce5 061dc31ffe32d6e40d55ee6d3c01d144097c7795 test/mcp-deadline-separation
```

Actual exit **0**, no conflicts. Preliminary standalone candidate:
`c06100a3879a6973474fcce7735109bc36579b7f`; exactly one commit on the new base,
with the same three files. Both changed MCP files match the original candidate
byte-for-byte (`git diff --exit-code`, actual exit **0**). Contributor rules,
CI configuration, owned runner/workspace implementation and installed lockfiles
are unchanged between bases. Inspected current package/glossary differences
only remove the unrelated source-time demo command and glossary entry. The
actual standalone gate commands use the current base's package scripts.

Fresh standalone controls repeat the same bounded procedure with labels
`standalone-{red,green}-{22,24}`. Each red budget was 1500, each green budget
5000, with exactly one attempt per runtime/setting. Both red runs exited **1**
at the expected `failed` versus `applied` assertion and retained `model_timeout`,
exact stages, and later-capture elapsed 1774.54 ms (Node 22) / 1770.11 ms
(Node 24). Both green runs passed 1/1, actual exits **0**. All four fresh cleanup
checks had before/after counts **0**, no child signal and removed probe
workspace. These results are new-base evidence rather than reused old passes.

Fresh standalone gates ran sequentially through
`/tmp/cairn-mcp-deadline-separation.utPIwo/gates.mjs standalone all`, which
spawns the exact scoped/MCP/generic/validation/maintainer/workspace/diagnostic
commands documented above under each runtime's cleared environment. It writes
live per-gate logs, records child exits/signals/counts in `standalone-gates.json`,
and stops immediately on a failure. The queue completed with actual exit **0**;
all **14** recorded child gates had actual exit **0** and no terminating signal.

| Fresh standalone gate | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| Scoped deadline suite | 4/4 pass, exit **0** | 4/4 pass, exit **0** |
| Full MCP suite | 112/112 pass, exit **0** | 112/112 pass, exit **0** |
| Generic `npm test` | 635/635 pass, exit **0** | 635/635 pass, exit **0** |
| JSON validation | exit **0** | exit **0** |
| Isolated maintainer validation | exit **0** | exit **0** |
| Workspace lifecycle | 25/25 pass, exit **0** | 25/25 pass, exit **0** |
| Structured diagnostic probe | all three codes retained, exit **0** | all three codes retained, exit **0** |

The generic count is **635** on this actual main base, versus **673** on the
original unrelated stack; neither run skipped a test. No successful old-base
result was substituted for a new-base gate. Fresh per-gate logs are
`standalone-{scoped,mcp,generic,validate,maintainer,workspace,diagnostic}-{22,24}.log`.

Before freezing the final standalone candidate,
`git diff --name-only ad274b6... HEAD` was independently cross-checked against
`git diff-tree --no-commit-id --name-only -r HEAD`. Both inventories match the
complete three-file list above, count **3**; both set differences are empty,
actual check exit **0**. The tested MCP code remains byte-identical to
`c06100a3879a6973474fcce7735109bc36579b7f`; only this plan's evidence record is
amended afterward. The final local commit SHA is reported after that amendment
to avoid a self-referential SHA inside its own content. Both-axis independent
review and primary acceptance remain pending; the worker has not pushed.
