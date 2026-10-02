# Explicit supplied-history comparison integration

Fixed base: `7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4` (`origin/main`).
Dependency candidate: `a7477b87f644505ab6dc955dbb0075bd76816eb7`, PR #324.
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/supplied-history-source-policy`.
Branch: `feat/supplied-history-source-policy`.

This is the next authorized offline slice of the same explicit source-policy
change, not a new interpretation of any consumed paid-run grant. It extends
the additive SH1–SH6 preparation contract without changing its API or legacy
snapshots. The combined candidate must receive new primary acceptance, both
independent review axes and latest-head CI before delivery. PR #324's earlier
green candidate remains a historical record, not verification of these changes.

## Contract

- SCI1: `prepareMixedComparison` accepts one explicit, enumerable own-data
  option `sourceHistoryPolicy: 'supplied-history-v1'`. Omission preserves the
  complete legacy preparation, manifest, roster and report behavior for both
  capture profiles. Unknown values, getters and malformed options fail before
  either arm's runtime, store or provider work. Source inclusion is independent
  of `comparisonProfile`; do not silently switch capture/qualification modes.
- SCI2: The explicit mode uses `prepareSuppliedHistoryCase` once to prepare
  both arms. Preserve source order, roles and floating dataset timestamps,
  including sessions after the question. The question stays query-only.
  Include all valid supplied sessions; no oracle-based selection, timestamp
  repair, extra truncation, sorting or relabeling. Existing validation, planner
  recomputation, batch caps and static native-token fit remain unchanged.
- SCI3: Bind the selected source policy to distinct context, preparation,
  generation and scoring identities. Keep existing manifest/roster envelope
  domains where the request guard requires them. A capability for legacy
  preparation cannot execute the supplied-history preparation. Preserve
  prepared-object identity, one-use refusal and exact manifest/roster binding
  before dispatch. Do not introduce another run-time policy selection.
- SCI4: The scorer accepts only the two finite, source-policy-bound report
  families. Reject mismatched schema/policy/context identities before judge
  work. Emit a separately versioned supplied-history score and keep fixed-N
  incorrect/unresolved accounting, paired outcomes and evaluator isolation.
  Do not pool legacy and new scores, change judge prompts or reinterpret old
  results. Preserve existing valid legacy reports and public output. The
  independently demonstrated malformed-identity acceptance is tightened as
  recorded below; do not describe arbitrary legacy acceptance as unchanged.
- SCI5: Tests must go RED before implementation at the actual preparation,
  authority and scorer seams. Cover before/equal/later/all-future and unordered
  source sentinels, both capture profiles, complete legacy snapshots, real
  caller option validation, old/mismatched capability refusal, clone/reuse
  refusal, native static overflow and oracle-bearing input refusal. Prove
  distinct identity even when both policies include the same sessions.
- SCI6: Exercise actual Cairn plus installed pinned native Mem0 using synthetic
  fake HTTP only, in both arm orders. Inspect real extraction and native ADD
  inputs for all supplied sentinels, preserve authoritative receipt/window/
  origin verification, and distinguish input inclusion from extractor omission.
  Include unresolved fixed-N behavior. Preserve timers, transport settlement,
  retries, limits, budget math, model profiles and native configuration.
- SCI7: Use `createTestWorkspace` for newly added scratch and resource cleanup.
  Run focused checks, generic tests, validation, full LongMemEval tests,
  ingestion/comparison/public/mixed demos and explicit `test:mixed-native-local`
  on Node 22.16.0 and 24.15.0, plus the required maintainer plugin validations.
  Parent compile cache is disabled. Coordinate full/heavy suites with the CR
  owner: no overlapping matrices; exact equivalent serial file concurrency
  may be recorded without weakening assertions. Preserve RED, interrupted and
  failed gate evidence; a green rerun alone does not explain an earlier failure.

## Allowed changes and boundaries

Allowed implementation files: `evaluation/longmemeval/mixed-generation.mjs`,
`mixed-scoring.mjs`, narrowly required finite protocol helper(s),
`testing/mixed-fixture.mjs`, `testing/mixed-native.test.mjs`, corresponding
synthetic `test/` files, this plan, `docs/longmemeval-comparison.md`,
`docs/limitations.md` and `CHANGELOG.md`.

The pure renderer and its snapshots are frozen dependencies; change them only
after reporting a demonstrated integration defect. Do not edit core behavior,
MOC, extraction prompts, paid/operator scripts, request guard, ledger, models,
dependency locks, native gateway or historical studies. No user credentials,
downloaded corpus, reference answers or authentic book may be read. No paid
request, replay, retry, merge, publication, deployment or historical cleanup.

The result journal currently exists only in unmerged PR #321, not this fixed
base. Do not copy its wider dependency chain into this PR. This slice does not
claim durable-journal integration or authorize a real run. Before a later live
run, integrate the journal's strict finite preparation/generation/scoring
families after its dependency lands, issue a fresh approved source-policy-bound
capability, and complete the applicable durable/independent gates. Existing
paid scores remain unchanged.

## Ownership and checkpoints

Implementation: bounded GPT-6.1 Sol, high reasoning, non-root worker. Primary
owns the contract, scheduling, actual diff/caller inspection, key integrated
reruns, candidate-to-evidence binding and independent Standards/Spec review.
Workers receive only public code and synthetic inputs. No changed UI/browser
flows exist; record all generation/scorer/fixture callers and new schema
consumers, including the pending journal limitation, in the evidence section.

Record commands, exact runtime versions, outcomes, raw log paths and candidate
SHA here. No public score or improvement claim follows from fake HTTP tests.

## Implementation and evidence

The finite `mixed-source-policy.mjs` helper names exactly the legacy and supplied
families. It retains the existing manifest and roster envelope domains required
by the guard, while new context, scorer, case-protocol and generation-report
digest domains bind the explicit source policy. Existing answer and adapter
policy hashes are unchanged. `prepareMixedComparison` selects the pure renderer
once per source case; its private WeakMap binds the family for one-use execution.
There is no runtime source selector and the pure renderer remains frozen.

Caller inventory: the preparation callers are `mixed-demo.mjs`, the synthetic
`testing/mixed-fixture.mjs`, preparation unit tests and
`evaluation/long-history-live/prepare.mjs`. Only the explicitly supplied
synthetic fixture/tests opt in; demo and live preparation callers remain legacy.
Generation/scorer callers are their unit tests and the installed-native local
test file. The scorer accepts the two finite generation schemas, recomputes
trusted source/context/scorer hashes from the selected family, profile and
native configuration SHA, then preserves existing capability/scope/evaluator
validation. There is no journal consumer in this base. The pending PR #321
journal needs its own finite-family integration after landing before any live
run; it has not been copied or represented as complete here.

Raw logs belong to `/tmp/cairn-supplied-comparison-gates.GkCy99`. The initial
synthetic RED command on each exact Node runtime was
`node tools/testing/run.mjs evaluation/longmemeval/test/supplied-history-comparison.test.mjs`.
Both Node 22.16.0 and 24.15.0 failed nine tests before implementation, including
the actual preparation/scorer family seams and independent malformed legacy
source/context/scorer identities. This latter test returned “Missing expected
rejection” against the old scorer: checking a supplied capability alone did not
prove the protocol identity. The tightening is intentional and separately
documented; it changes malformed acceptance, not valid legacy reports. Retained
logs: `node-22.16.0-RED.log` and `node-24.15.0-RED.log`.

Focused GREEN evidence so far: Node 22.16.0 passed 21 tests across supplied
integration, legacy scoring and indexed-evidence comparison files
(`node-22.16.0-focused-GREEN.log`); Node 24.15.0 passed 23 tests across supplied
integration, legacy generation and legacy scoring files
(`node-24.15.0-focused-GREEN.log`). These provisional focused scopes differ;
equivalent final scopes and full gates are still required. Both include actual
legacy complete-preparation JSON SHA snapshots: qualified
`f643d0757b552ce6456359fa62f3caa6e45aae8a284302700e6b5f98aff99922`, indexed
`81462d9950f7e8c646a428cf4729ed1137815405abb45e15379827aac732db80`.

Equivalent focused scope subsequently passed 32/32 (zero skipped) on both
confirmed binaries `v22.16.0` and `v24.15.0`, with
`NODE_DISABLE_COMPILE_CACHE=1`. Command:

```sh
node tools/testing/run.mjs evaluation/longmemeval/test/supplied-history-comparison.test.mjs evaluation/longmemeval/test/mixed-generation.test.mjs evaluation/longmemeval/test/mixed-scoring.test.mjs evaluation/longmemeval/test/indexed-evidence-comparison.test.mjs
```

Logs: `node-22.16.0-focused-equivalent-GREEN.log` and
`node-24.15.0-focused-equivalent-GREEN.log`. The scope includes unknown schema
refusal and old-manifest/new-schema transplant refusal. `git diff --check`
passed. This is still not the installed-native/full-gate candidate freeze.

SCI6 synthetic installed-native tests inspect actual Cairn structured ingestion
and actual native serialized ADD inputs for all five unordered before/equal/
after sentinels, in both profiles and both orders. Empty extraction deliberately
keeps the existing caps and demonstrates input inclusion without admitted
evidence. A separate future-only, nonempty control verifies exact original-body
receipt offsets and answer evidence, not the generated summary. Invalid
extraction remains unresolved in fixed N.

The primary confirmed the existing public-test native prerequisites (also
recorded by the durability plan):
`CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv` and
`CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu`.
Native gates will use `env -i`, the exact Node binary path, cache disabling,
owned temporary roots and only those designated native roots. Real roots are
read-only prerequisites; drift tests operate on copies. Workspace lifecycle and
isolated maintainer plugin validations on both runtimes are included in the
remaining contributor gates, in addition to the full SCI7 matrix.

### Bounded installed-native smoke

After the classification owner confirmed its current runner closed and its
scratch absent, the primary authorized one SCI6-only window. Exact Node
`v22.16.0` passed all 12 controls, zero skipped, in 81.50 seconds. This smoke
needed no fixture correction, product timeout change, budget/cap increase or
source-policy weakening. The direct command was:

```sh
timeout --signal=TERM 300s env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 TMPDIR=/tmp/cairn-sci-native-smoke.NKOXnJ TMP=/tmp/cairn-sci-native-smoke.NKOXnJ TEMP=/tmp/cairn-sci-native-smoke.NKOXnJ CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu node tools/testing/run.mjs --test-concurrency=1 --test-name-pattern='SCI6 installed supplied history' evaluation/longmemeval/testing/mixed-native.test.mjs
```

The external catchable smoke bound did not fire; internal timers were unchanged.
Raw log: `node-22.16.0-native-smoke.log`. Installed native inspector descriptors
before and after were byte-identical (`cmp` passed): source tree SHA
`440facea6b675784e1faffc3c8bfe926a7930bf40a09bc1e9c30fed27a37b423`, lock SHA
`721cf4e3519c19b7419939dcc76c098a24a95a17b5cab3e9b121d8d9a79922f7`, 12,768
entries and 233,471,805 regular-file bytes. Logs:
`node-22.16.0-native-smoke-artifact-before.log` and
`node-22.16.0-native-smoke-artifact-after.log`.

The runner completed successfully. The exact owned caller root
`/tmp/cairn-sci-native-smoke.NKOXnJ` was verified empty and then removed; cleanup
log `node-22.16.0-native-smoke-cleanup.log` records `remaining: []` and
`rootExists: false`. No caller or historical temporary directory was swept.
The slot was explicitly returned to the classification owner before any other
native/full gate. The complete both-runtime SCI7 matrix still awaits its final
release; this successful smoke does not substitute for that matrix.

Runtime/test files were frozen after the smoke. The nine-file SHA manifest
`runtime-test-freeze.sha256` (including unchanged pure renderer/tests) has SHA
`73c9b3e729b55b2cd6a8e6568b0441dab5e735d07df5a633e16b5e7a55c74af9`.
`git diff --check` passed. No SCI commit has been made yet; HEAD is still the
dependency candidate `a7477b87`. After the classification owner's final
release, the primary reserves the first slot to rerun the frozen focused 32 and
installed-native 12 controls personally on both runtimes. The author will start
full gates only after that acceptance window and explicit slot transfer. The
local combined candidate commit and independent Standards/Spec review follow
all required full gates; no push is authorized at this stage.

No paid/model request, authentic source data, scorer prompt, operator protocol,
budget, guard, native gateway, dependency lock or public default has changed.

### Primary pre-commit acceptance checkpoint

The primary personally reran the frozen acceptance scope on both exact Node
runtimes in a safe inter-gate window. Primary-reported outcomes:

| Scope | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| Equivalent focused integration scope | 32/32 passed, 12.725 seconds | 32/32 passed, 9.433 seconds |
| Actual Cairn plus installed native SCI6 controls | 12/12 passed, 57.900 seconds | 12/12 passed, 57.858 seconds |

All four runs had zero failures, skips, cancellations and TODOs. The nine-file
freeze manifest SHA
`73c9b3e729b55b2cd6a8e6568b0441dab5e735d07df5a633e16b5e7a55c74af9` was unchanged
before and after. The primary verified the identities of four owned caller
roots (`dCzumr`, `aI7i6m`, `V9iV1B`, `73CQKk`), confirmed each empty, and removed
them. Primary-reported raw evidence, retained with mode 600 and fsynced:

- `/tmp/cairn-six-diagnostic-primary.F3Skmd/SCI-PRIMARY-22.16.0-focused.log`
- `/tmp/cairn-six-diagnostic-primary.F3Skmd/SCI-PRIMARY-24.15.0-focused.log`
- `/tmp/cairn-six-diagnostic-primary.F3Skmd/SCI-PRIMARY-22.16.0-native.log`
- `/tmp/cairn-six-diagnostic-primary.F3Skmd/SCI-PRIMARY-24.15.0-native.log`

These paths and facts were supplied by the primary; the implementation author
did not inspect or list that private evidence directory or other primary
inputs. This establishes primary acceptance of the frozen pre-commit bytes,
not verification of a new candidate commit. Final candidate-to-tested-byte
binding remains required.

This checkpoint supersedes only the scheduling order described above: the
primary acceptance window moved before the remaining classification gates.
The primary has returned the heavy slot to the classification owner. The
supplied-history author still awaits explicit final classification release and
a fresh primary handoff before launching the complete SCI7 matrix. Both-runtime
full gates, the local combined candidate commit, renewed independent Standards
and Spec reviews against fixed base `7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4`,
and latest-head CI remain pending. There is no commit, push or task-completion
claim from this documentation-only checkpoint, and no paid call, new grant,
default enablement, journal integration or new score claim.

### Fresh full-matrix first gate and boundary handback

The primary explicitly handed the sole heavy verification slot to the author
after classification's then-required gates closed. The fresh Node `v22.16.0`
generic gate ran the unchanged package-script union with serial file concurrency:
`npm test -- --test-concurrency=1` (expanding to
`node integrations/client/testing/run.mjs plugins/cairn-memory/test/*.test.mjs evaluation/architecture/test/*.test.mjs --test-concurrency=1`).
No file, assertion or test limit was omitted or changed. It passed 580/580,
zero failures/skips/cancellations/TODOs, child exit code 0 and no signal.
The Node test duration was 322,720.796 milliseconds; the command wrapper's full
elapsed time was 323,930 milliseconds. Raw mode-600, fsynced log:
`/tmp/cairn-supplied-comparison-gates.GkCy99/node-22.16.0-final-test.log`.

The invocation used `env -i`, exact Node PATH
`/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin`,
`NODE_DISABLE_COMPILE_CACHE=1`, and `TMPDIR`/`TMP`/`TEMP` all pointing at the
fresh short owned caller `/tmp/sci22.RiVXxA`. Npm user configuration was
`/dev/null`, global configuration pointed at the intentionally absent task-owned
`no-global-npmrc`, and npm's cache was separate from the caller under the
evidence directory. No user configuration or credentials were supplied.
A command-only wrapper recorded runtime, known wrapper/npm PIDs, command,
closure status and post-run caller contents; it did not alter the runner or
product timers. The wrapper reported `remaining: []`, not caller removal.

After closure, the author separately verified the exact caller's canonical
path, non-symlink directory type, owner UID 1000, and unchanged device/inode
identity across the empty check (device 2112, inode 69519743). Both known PIDs
(wrapper 45853, npm 46177) were absent. The caller was empty and then removed;
the mode-600, fsynced `node-22.16.0-final-test-cleanup.log` records
`rootExists: false`. No historical or caller-wide sweep was performed.

While that generic gate was running, independent classification review found
an unrelated validation gap. The primary requested a safe boundary handback;
the author did not interrupt the generic child, then explicitly released the
heavy slot after closure and exact caller cleanup. SCI remains paused before
validate or any subsequent heavy gate until a fresh explicit return. Runtime
and test bytes remain frozen. The Node 24 generic gate and all remaining
both-runtime SCI7 gates, local candidate commit, renewed dual review and
latest-head CI are still pending; this first successful gate is not completion.

### Resumed full SCI7 matrix (in progress)

After its unrelated classification correction acceptance window on the other
branch, the primary explicitly returned sole heavy verification ownership to
the SCI author. This is a scheduling event only: no classification fix or
runtime/test edit entered this worktree. The nine-file freeze manifest was
checked successfully before resuming. Node 22's completed generic gate was
retained, not repeated.

The remaining fresh Node `v22.16.0` gates all passed without failures or source
corrections: JSON/version validation; workspace lifecycle 25/25; full
LongMemEval 213/213; all four ingestion/comparison/public/mixed demos; complete
installed-native mixed-local 38/38 (175,834 milliseconds full command elapsed);
and both marketplace and strict plugin validations. All counted suites had
zero skipped/cancelled/TODO cases. Node 24's complete fresh matrix is currently
running; no candidate commit or completion is claimed yet.

Every resumed gate uses a fresh short `/tmp/sc22.*` or `/tmp/sc24.*` caller,
`env -i`, the exact runtime PATH, disabled parent compile cache, isolated npm
configuration/cache, and one command at a time. The metadata-only wrapper
captures caller canonical path/UID/device/inode before dispatch, checks the
same identity after child closure, records known PIDs/exit signal and actual
remaining entries, removes only empty callers, and fsyncs each mode-600 raw
log. It does not change product assertions, budgets or timers. Test gates use
`--test-concurrency=1` with the unchanged complete package-script file union;
in-file concurrency/lifecycle cases remain exercised.

Node 22 raw log suffixes after `node-22.16.0-final-`, under
`/tmp/cairn-supplied-comparison-gates.GkCy99`: `validate.log`,
`workspace-lifecycle.log`, `longmemeval.log`, `demo-ingestion.log`,
`demo-comparison.log`, `demo-public.log`, `demo-mixed.log`,
`mixed-native-local.log`, `plugin-validation.log`. All test and empty-output
caller roots are recorded absent after cleanup. The ingestion and comparison
demo outputs intentionally remain at
`/tmp/sc22.D4H2l2/cairn-lme-ingestion-demo-F57fUT/memory.sqlite` and
`/tmp/sc22.vXumkp/cairn-lme-comparison-demo-hGt1lw/memory.sqlite`, as their
documented retention contract requires; these are synthetic outputs, not
unexpected test residue. Public and mixed demos left empty callers, removed by
the wrapper.

Maintainer validation reused the matching installed locked Claude Code
2.1.260 dependency, with a fresh task-owned `CLAUDE_CONFIG_DIR`, clean
environment, and nonessential traffic/auto-updating disabled. Npm user config
was `/dev/null`; no user authentication or provider key was supplied. No
dependency lock, provider setup or native bootstrap changed. The public-test
native inspector's `final-native-artifact-before.log` again records the exact
approved artifact hashes from the smoke; a matching after-matrix check remains
required.

### Completed fresh SCI7 matrix and local candidate freeze

The resumed matrix is complete on exact Node `v22.16.0` and `v24.15.0`.
The earlier in-progress checkpoints above are historical, not current status.
Every actual npm child closed with exit code 0 and signal `null`; no fresh
SCI7 full-matrix assertion failure, interruption, retry or source correction
occurred. All test-suite rows below have zero failures, skipped, cancelled and
TODO tests. Serial file concurrency preserved the complete package-script
union and original in-file concurrency assertions, timeouts and budgets.

| Actual command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `npm test -- --test-concurrency=1` | 580/580; 323,930 ms | 580/580; 304,006 ms |
| `npm run validate` | 10 JSON files; version 0.2.0 consistent | Same |
| `npm run test:workspace-lifecycle -- --test-concurrency=1` | 25/25; 17,865 ms | 25/25; 19,377 ms |
| `npm run test:longmemeval -- --test-concurrency=1` | 213/213; 13,161 ms | 213/213; 8,446 ms |
| `npm run demo:longmemeval-ingestion` | Exit 0 | Exit 0 |
| `npm run demo:longmemeval-comparison` | Exit 0 | Exit 0 |
| `npm run demo:longmemeval-public` | Exit 0 | Exit 0 |
| `npm run demo:longmemeval-mixed` | Exit 0 | Exit 0 |
| `npm run test:mixed-native-local -- --test-concurrency=1` | Complete 38/38; 175,834 ms | Complete 38/38; 203,538 ms |
| `npm run validate --prefix tools/plugin-validation` | Marketplace + strict plugin pass | Marketplace + strict plugin pass |

Elapsed times in the table are full command-wrapper times, not benchmark
measurements. The complete native suite includes, but is not limited to, the
12 SCI6 controls. The generic gate is the exact unchanged union documented
above, not selected shards. No JavaScript typecheck exists in this repository;
this slice has no UI build/browser gate.

All 20 original raw logs are retained mode 600 and fsynced under
`/tmp/cairn-supplied-comparison-gates.GkCy99`, named
`node-VERSION-final-SUFFIX.log`, where VERSION is `22.16.0` or `24.15.0` and
SUFFIX is `test`, `validate`, `workspace-lifecycle`, `longmemeval`,
`demo-ingestion`, `demo-comparison`, `demo-public`, `demo-mixed`,
`mixed-native-local`, or `plugin-validation`. Each records exact runtime,
actual argv, known parent/child PIDs, caller identity, closure status and
contents. The separate first-generic cleanup evidence remains preserved.
`final-gate-audit.json` independently parses anchored TAP `#` and SPEC `ℹ`
numeric footers, checks all counts and exit statuses, and checks current caller
existence and retained-output identity against the original headers. This
audit does not overwrite or replace any raw invocation evidence.

The previously described clean environment applies on both runtimes, using
the exact `/home/chichieh/.nvm/versions/node/vVERSION/bin:/usr/bin:/bin`
PATH and `NODE_DISABLE_COMPILE_CACHE=1` on the parent npm commands. Npm caches
are separate task-owned `npm-cache-22`/`npm-cache-24` directories. Locked
installed tiktoken 1.0.22 and Claude Code 2.1.260 match their lock manifests;
no dependency or lock edit was needed. Maintainer gates used fresh isolated
`claude-config-22`/`claude-config-24` directories and
`DISABLE_AUTOUPDATER=1`, `DISABLE_NONESSENTIAL_TRAFFIC=1`,
`CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC=1`, with no authentication supplied.
These tool-managed config/cache outputs are retained separately from callers.
Only native gates received the two approved read-only public-test native roots.

All test and empty-output caller roots are absent after identity-checked,
empty-only removal. Four documented synthetic demo database outputs remain:

- `/tmp/sc22.D4H2l2/cairn-lme-ingestion-demo-F57fUT/memory.sqlite`
- `/tmp/sc22.vXumkp/cairn-lme-comparison-demo-hGt1lw/memory.sqlite`
- `/tmp/sc24.84C1ez/cairn-lme-ingestion-demo-tod2Uy/memory.sqlite`
- `/tmp/sc24.4PVq6q/cairn-lme-comparison-demo-T02iTs/memory.sqlite`

The final audit verified all four exact caller identities and these output
files without reading their database contents. No shared temporary-root sweep
or unowned cleanup was performed. All owned verification children are closed;
the heavy slot was explicitly released before this static documentation and
local-commit step so the classification owner can run its affected gates.

`final-native-artifact-before.log` and `final-native-artifact-after.log` are
byte-identical by `cmp` and independent audit. The approved artifact remains
source-tree SHA-256
`440facea6b675784e1faffc3c8bfe926a7930bf40a09bc1e9c30fed27a37b423`
and dependency-lock SHA-256
`721cf4e3519c19b7419939dcc76c098a24a95a17b5cab3e9b121d8d9a79922f7`;
no bootstrap or real native-root mutation occurred. All nine runtime/test
files still match `runtime-test-freeze.sha256`, whose SHA-256 is
`73c9b3e729b55b2cd6a8e6568b0441dab5e735d07df5a633e16b5e7a55c74af9`.
`git diff --check` is clean. This unchanged-byte evidence retains the primary's
pre-commit acceptance; committed blob-to-manifest binding is recorded separately
after the scoped local candidate commit, whose exact SHA is handed to the primary.

Delivery remains gated: primary final commit-byte binding/diff inspection,
renewed independent Standards and Spec reviews of the combined SH+SCI change
against fixed base `7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4`, and latest-head
CI are still required before any push. The previous SH reviews/CI cover only
their earlier head. No push, PR edit, merge, default enablement, paid call,
new grant, journal integration, new certified score or semantic-quality claim
is authorized by these local passes. The old grant remains closed and existing
score data are unchanged.
