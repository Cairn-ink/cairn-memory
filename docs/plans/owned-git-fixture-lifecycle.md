# Owned Git fixture lifecycle

Base: `56f555df56184e7ea7980cea2351c84c12f72572`.
Branch: `fix/b9-git-fixture-lifecycle`.
Worker: actual GPT-6.1 Sol, High; primary owns acceptance, combined gates,
independent reviews, delivery and CI. No worker push, PR or CI actions.

## Acceptance contract

R1 actual bug-pattern red-capable minimized replay with exact exits and limitations;
R2 regression fails before fix and passes after at the real caller seam;
R3 owned Git work is quiescent before directory disposal, including success and failure paths, without deleting outside fresh ownership or suppressing cleanup errors;
R4 B9 manifest, clean checkout, one-shot/key/budget gates retain behavior and no extra model/HTTP call;
R5 targeted and algorithm-development73 plus lifecycle/generic/validators on pinned22.16/24.15, retain failed attempts; primary reruns combined final gates and owns independent dual reviews/CI;
R6 two independently derived changed-file inventories agree, record count, temporary tagged logs removed from deliverable, exact frozen SHA and clean worktree.

## Evidence and attribution boundary

Historical PR392 run `38070224313`, job `114265935845`, failed B9 cleanup
with `test_workspace_cleanup_failed`, nested `ENOTEMPTY` removing owned
`runtime/.git/objects`; algorithm-development passed 72/73, exit 1.
CI used Node 24.21.0 and Git 2.55.0. Local WSL2 uses Git 2.34.1;
pinned local Node versions are 22.16.0 and 24.15.0.

Diagnostic artifacts and failed attempts are retained only beneath freshly
owned `/tmp/cairn-owned-git-diagnosis.kHwSLr`. The Git 2.55.0 source came from
the official Git repository's `v2.55.0` tag. Its isolated build passed exit 0
with `NO_RUST=YesPlease`, after an initial build failed exit 2 because Cargo
was unavailable. It is not the identical CI binary or host.

The original B9 caller passed 1/1, exit 0, on both Node22/Git2.34 and
Node24.15/isolatedGit2.55. A temporary in-memory module hook selected the
isolated Git executable without changing repository files or manifest bytes.
Trace proves Git2.55 commit launches detached automatic maintenance; commit
exited at `06:10:11.770` while its repack exited at `06:10:12.328`.

The minimized original-archive init/add/commit replay, with no added inputs,
failed 1/1, exit 1, in 0.79 seconds by observing the native owned
`.git/objects/maintenance.lock` still present after commit. Earlier detection
based only on `gc.pid` missed this newer maintenance path. This proves an
unfinished owned Git lifecycle; it does not reproduce historical ENOTEMPTY.

One controlled immediate-disposal replay of that exact archive observed the
active maintenance lock but cleanup passed exit 0. Its repository-local
`maintenance.autoDetach=false` control was quiescent and passed exit 0.
Native older-Git auto-GC on a synthetic 10,000-input fixture remained active
with only that maintenance setting (exit 1); adding repository-local
`gc.autoDetach=false` made the same workload quiescent (exit 0).
These are bounded controls, not retry-until-green or statistical confidence.

Git's tagged official documentation separately specifies
[older auto-GC detachment](https://github.com/git/git/blob/v2.34.1/Documentation/config/gc.txt)
and [newer automatic maintenance detachment](https://github.com/git/git/blob/v2.55.0/Documentation/config/maintenance.adoc).
The isolated source's `run-command.c` selects the maintenance setting and
fallback, and `builtin/gc.c` holds `objects/maintenance.lock` while maintenance
runs. Older auto-GC owns `gc.pid` while it runs. The tests check both native
markers immediately after commit; no writer or deletion error is injected.
Externally scheduled maintenance outside the fixture's own commands is out
of scope.

## Ranked hypotheses, shown before probes

1. Git2.55 detached geometric repack races disposal. Foreground maintenance
   should remove unfinished work while preserving clean checkout behavior.
2. Detached auto-GC is a second lifecycle path on older Git. Controlling only
   new maintenance should leave the amplified older-Git control red;
   controlling both paths should pass. The bounded controls support this.
3. Historical ENOTEMPTY could be filesystem/rm behavior independent of Git
   writers. A quiescent fixture could still fail; immediate disposal can pass
   despite active maintenance. Historical attribution remains unassigned.
4. Another owned actor could create objects during teardown. Trace would show
   a writer outside commit/maintenance/repack; foreground settings would not
   remove it. The observed native path is sufficient to prove the lifecycle
   defect, but no claim excludes all possible historical writers.

## Scope and verification record

Only the two synthetic checkout callers, a test-only owned Git fixture helper
and its regression, and this plan are in scope. Generic workspace deletion
continues to surface failures without retries, sleeps, skips or suppression.
No candidate algorithm, core, adapter, transport, corpus, rubric, CI, budget
default or operational artifact is changed.

The shared helper creates a fresh checkout inside its caller's fresh workspace
and configures `maintenance.autoDetach=false` and `gc.autoDetach=false` locally
before adding or committing files. Native maintenance still runs. Synchronous
Git completion now joins its native work before caller assertions and cleanup.
Both real callers retain their existing manifests, clean checkout checks,
synthetic budget/key-failure checks, one-shot closure and No HTTP assertions.

The B9 immediate-marker regression failed before the fix: 0/1 passed, exit 1,
on Node 24.15.0 / isolated Git 2.55.0. The requested-answer caller also failed
0/1, exit 1, in a temporary in-memory control that removed both settings after
implementation. With the fix, both callers passed 2/2, exit 0, on that Git
combination, and on both pinned Node versions with local Git 2.34.1.
The shared helper regression passed 2/2, exit 0, on Node22/Git2.34 and
Node24.15/isolatedGit2.55; it proves native packing actually ran, later caller
failure removes owned scratch while preserving a sibling, failed commit is
reported, and an existing checkout is refused. The original minimized replay
with both foreground settings passed exit 0 with no maintenance marker.

Exact diagnostic commands (all artifacts are under the owned diagnostic root):

```sh
# Original minimized red, Node 24.15.0 / isolated Git 2.55.0, exit 1.
/home/chichieh/.nvm/versions/node/v24.15.0/bin/node /tmp/cairn-owned-git-diagnosis.kHwSLr/replay.mjs /tmp/cairn-owned-git-diagnosis.kHwSLr/git-2.55.0/git 0 /tmp/cairn-owned-git-diagnosis.kHwSLr/git-2.55.0
# Immediate disposal, active maintenance observed but cleanup exit 0.
/home/chichieh/.nvm/versions/node/v24.15.0/bin/node /tmp/cairn-owned-git-diagnosis.kHwSLr/replay.mjs /tmp/cairn-owned-git-diagnosis.kHwSLr/git-2.55.0/git 0 /tmp/cairn-owned-git-diagnosis.kHwSLr/git-2.55.0 archive dispose
# Minimized pattern after both foreground controls, exit 0.
/home/chichieh/.nvm/versions/node/v24.15.0/bin/node /tmp/cairn-owned-git-diagnosis.kHwSLr/replay.mjs /tmp/cairn-owned-git-diagnosis.kHwSLr/git-2.55.0/git 0 /tmp/cairn-owned-git-diagnosis.kHwSLr/git-2.55.0 archive foreground-both
# Actual B9 regression before fix, exit 1; log b9-regression-before.log.
TMPDIR=/tmp/cairn-owned-git-diagnosis.kHwSLr /home/chichieh/.nvm/versions/node/v24.15.0/bin/node --import /tmp/cairn-owned-git-diagnosis.kHwSLr/select-git.mjs --test --test-name-pattern='^B9 clean owned fixture' evaluation/algorithm-development/test/evidence-bundle.test.mjs
# Both actual callers after fix, 2/2, exit 0; log callers-after-git255.log.
TMPDIR=/tmp/cairn-owned-git-diagnosis.kHwSLr /home/chichieh/.nvm/versions/node/v24.15.0/bin/node --import /tmp/cairn-owned-git-diagnosis.kHwSLr/select-git.mjs --test --test-name-pattern='B9 clean owned fixture|owned clean synthetic checkout' evaluation/algorithm-development/test/evidence-bundle.test.mjs evaluation/algorithm-development/test/requested-answer.test.mjs
```

Reproduction limitations remain explicit: no bounded replay reproduced the
historical ENOTEMPTY. The corrected lifecycle is independently proven. Node
24.21.0, the CI binary's build options, and the CI filesystem were not matched.
Passing cleanup despite an active writer shows why a green rerun alone is not
the regression oracle.

Worker verification of the candidate content:

| Gate | Node 22.16.0 / Git 2.34.1 | Node 24.15.0 / Git 2.34.1 |
| --- | --- | --- |
| Both actual checkout callers | 2/2, exit 0 | 2/2, exit 0 |
| Full algorithm-development | 73/73, exit 0, 382,993 ms | 73/73, exit 0, 382,250 ms |
| Workspace lifecycle, including new helper | 27/27, exit 0 | 27/27, exit 0 |
| JSON/version validator | exit 0 | exit 0 |

Each Node ran these commands from the worker worktree, using its pinned
executable (`node` resolved to 22.16.0; the 24.15.0 executable is above):

```sh
node tools/testing/run.mjs --test-name-pattern='B9 clean owned fixture|owned clean synthetic checkout' evaluation/algorithm-development/test/evidence-bundle.test.mjs evaluation/algorithm-development/test/requested-answer.test.mjs
node tools/testing/run.mjs evaluation/algorithm-development/test/*.test.mjs
node tools/testing/run.mjs tools/testing/*.test.mjs
node scripts/validate-json.mjs
```

Raw logs are `callers-after-node{22,24}.log`, `algorithm-node{22,24}.log`, and
`lifecycle-node{22,24}.log` under the diagnostic root. The Node24 caller command
also loaded the helper test file under its name filter; that file's filtered
load is not counted as helper assertion coverage. The unfiltered lifecycle
suite supplies that coverage. Failed diagnostic attempts remain retained.
Generic/root and plugin validation are owned by the primary on the combined
candidate. Worker generic gates started before that ownership clarification;
their outcomes will be forwarded separately, without treating pending output
as a pass. No TypeScript gate is configured in this `.mjs` repository.
The referenced `scripts/README.md` is absent here; the executed validator was
inspected as read-only JSON parsing/version comparison first.

Independent pre-freeze inventories agree on **5 files**: route one combines
`git diff --name-only HEAD` and `git ls-files --others --exclude-standard`;
route two uses `git status --porcelain=v1 --untracked-files=all`.

- `docs/plans/owned-git-fixture-lifecycle.md`
- `evaluation/algorithm-development/test/evidence-bundle.test.mjs`
- `evaluation/algorithm-development/test/requested-answer.test.mjs`
- `tools/testing/owned-git-fixture.mjs`
- `tools/testing/owned-git-fixture.test.mjs`

`git diff --check` passed exit 0. A scoped debug-tag search found no temporary
instrumentation; all temporary replay/source-loader files live outside the
deliverable in the diagnostic root. The worker's frozen commit SHA and clean
status are reported in its handoff. The primary independently verifies the
combined behavior and keeps the historical CI attribution boundary explicit.
