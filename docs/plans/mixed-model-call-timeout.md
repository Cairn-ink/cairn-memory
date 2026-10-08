# Prospective mixed-evaluation core call timeout

Primary acceptance contract written before implementation. Fixed base
`f384401ae8d55a1071f8658bd83d57b6d0b54afc`; branch
`feat/mixed-model-call-timeout`, dependent target
`feat/recall-lineage-diagnostics` (#364). The base already includes the accepted
opt-in core timeout and bounded-lineage-v2 observation. Neither needs duplication.

## Decision and limits

Return toward a fresh same-source Cairn/native-Mem0 comparison. First wire the
existing explicit core call timeout into immutable mixed preparation, its guard
binding and retained journal. Current mixed construction silently uses the
30,000-ms default even though core supports an explicit value up to120,000.
Longer time is a prospective completion hypothesis, not a demonstrated repair
of old failures, semantic improvement or lightweight/latency parity.

Do not change extraction prompts, batching, memory caps, qualification, MOC,
ranking, native Mem0, answer/scorer or original results. N30's prompt candidate
did not advance. N32's private20-window partition had no measured semantic gain
and separated correction context; it is not activated here.

The existing Cairn HTTP count and generation limits remain60,000 ms each.
A120,000-ms core call may span count plus generation; it never authorizes a
single HTTP request exceeding its guard timeout. Existing case request/cost
limits remain. Mixed withCaseScope has no aggregate Cairn wall-clock deadline;
the native child's3,600,000-ms limit is NOT a shared whole-case deadline.
This packet adds no wall supervisor or new timeout-isolation policy. A later
paid operation must explicitly state and verify its actual outer limits.

## Acceptance

- T1: Add optional preparation-time `modelCallTimeoutMs`, using the same
  positive safe integer1..120000 contract as core. Omission preserves exact
  existing defaults and manifest/protocol shapes. Reject accessors/inherited
  options or malformed/unknown values consistent with strict existing input
  validation; snapshot the accepted value so caller mutation cannot alter it.
- T2: Bind a supplied timeout into the Cairn manifest and relevant existing
  configuration/protocol digests, validate it at guard and journal boundaries,
  and pass only the bound value into actual `openMemoryCore`. No unbound runtime
  override. A manifest/configuration drift must fail before provider dispatch
  or budget reservation. Do not bypass any artifact/parent/current-ledger pin.
- T3: Keep existing HTTP limits, leases, model/provider configurations,
  reserve/settle/unknown/halt semantics, request budgets, default30s behavior,
  and legacy grant/journal readers intact. No extra provider pass or retry.
  There is no new generic transport, evaluator, ledger schema or authority API.
- T4: Exercise actual mixed preparation/core/adapter/guard with synthetic
  transports and owned stores: omitted default, explicit timeout scheduling,
  invalid range/type/descriptor, post-preparation mutation, protocol/digest
  mismatch refusal, a genuine configured core abort, and late response fencing.
  Preserve pending/unknown accounting behavior; do not reinterpret timed-out
  work as successful or infer historical cause. Mock timing is not performance.
- T5: Base bounded-lineage-v2 remains opt-in, output bounded/privacy-safe,
  export after close before disposal, no memory retention by diagnostics. Verify
  the explicit timeout composes with that path and journal/scoring closure.
  Preserve sources and fixed-denominator reporting; no diagnostics-as-score.
- T6: Document timeout-layer limits and the prospective six-case boundary.
  Proposed next round is at mostUS$20 combined generation/scoring within
  cumulativeUS$400/protectedUS$30, with fresh preselected cases and no failure
  replacement. This is a planning envelope, not a grant or permission from
  tests to call providers; corpus selection, resource fit, settled ledger,
  operation/supervisor freeze and independent review precede any new paid run.
- T7: Author focused and primary integrated checks on exact Node22.16.0/24.15.0,
  actual exit codes, explicit cleanup after success/failure, two-route scope,
  fixed-candidate independent Standards/Spec reviews and latest-head CI before
  ready PR. No merge/release/deployment or historical replay.

## Ownership and scope

One GPT-6.1 Sol/high worker implements. Primary owns this contract, integration,
direct source/test inspection, reruns, fixed review and delivery. Allowed paths:

- evaluation/longmemeval/mixed-generation.mjs
- evaluation/longmemeval/mixed-result-journal.mjs
- evaluation/experiment-budget/request-guard.mjs
- evaluation/longmemeval/test/mixed-model-call-timeout.test.mjs
- evaluation/longmemeval/testing/mixed-fixture.mjs
- evaluation/experiment-budget/test/mixed-source-pair-guard.test.mjs
- docs/plans/mixed-model-call-timeout.md
- docs/limitations.md

Primary approved the eighth path, `testing/mixed-fixture.mjs`, solely to forward
the explicit optional preparation value; omission remains unchanged. The new
LongMemEval test is discovered by the existing test glob; no package/CI change.
Escalate before any further fixture/source file or policy expansion. Do not edit
core, existing witness, package/CI/dependencies, old frozen artifacts or other
worktrees. Three manifest-matched dependency setup symlinks are read-only;
never install/rebuild/remove them or their targets. No operational scripts,
keys/env, authentic ledger, corpus/gold, providers, commits or pushes by worker.

Required integrated gates: generic/JSON/maintainer, full LongMemEval, OpenAI,
experiment request guard/budget and portable native gateway, relevant synthetic
mixed comparison/journal/lineage tests and demos, workspace lifecycle, plus
installed-native LOCAL comparison gate if the changed runtime is exercised
there as required by CONTRIBUTING. Missing prerequisites are blockers, not
skips. Tests do not authorize paid calls. Primary will inspect current CI and
gate configuration after the candidate commit and verify affected checks.

## Author evidence

Actual GPT-6.1 Sol/high; no delegation, provider calls, authentic inputs,
operational ledger access, dependency changes or commits. Caller path:
`prepareMixedComparison` → `protocolManifest` → `mixedManifest` in the existing
request guard → `validateManifest` in the result journal → `cairnCase`'s actual
`openMemoryCore`. Only a supplied primitive adds fields to the context, adapter
configuration and Cairn manifest. Case/manifest/capability digests consequently
bind it. The runtime function still refuses an unbound timeout override.

Prepatch RED on Node22.16.0: actual exit1,2/3 pass. The explicit120000 option
failed at `ownOptions` as unsupported; hardcoded legacy context/adapter/answer/
scorer digests and invalid-input controls passed. After the minimal wiring,
the same three controls passed, actual exit0.

Expanded child-fixture checks initially failed, actual exit1 each: first, a
refused guard-drift attempt consumed its preparation identity; the control now
uses an independent preparation, never retries the refused one. Second, the
inherited native-skip fixture bypassed the actual mixed callback, so scorer
correctly refused its missing scope. The corrected control revokes the native
handle and enters the real callback; it executes no native process and records
Mem0 unresolved. This is Cairn/guard/journal composition, not a successful native
paired-quality run. Existing installed-native coverage belongs to primary gates.

The isolated child observes actual core/default30s, configured120s and HTTP60s
timers, invoking the genuine scheduled callback deterministically. A configured
core abort emits `extract/core_call/model_timeout`; count and generation share
one clock. Ignored-abort physical HTTP settles unknown durably, with zero pending
attempts (`outcome:null` is the pending representation), no retry, no second
settlement or memory admission after late output. The separate HTTP callback
preserves real guard behavior, not a reinterpreted success. Both qualified and
indexed-evidence profiles, opt-in lineage-v2 and journal/scoring closure are
exercised. The fixed synthetic denominator is1; native is unresolved. Default
and explicit runs have identical extraction wire hashes and route order.
Child success and deliberate assertion failure remove owned scratch; guarded
constructor/schema denials precede claim/reservation/publication without getter
invocation. Object-prototype inherited getters are checked only in the isolated
child. These are cooperative-bound controls, not wall-clock measurements.

Exploratory focused results: Node22 new LongMemEval file5/5 actual0; guard T2
1/1 actual0. One exploratory guard control briefly overlapped a running focused
LongMemEval process; this is not serial or latency evidence. Final reruns below
are serial with flags before files. Source-discovery attempts for nonexistent
`testing/native-synthetic.mjs`, `core/map.mjs`, `core/schema.mjs` and `core/core.mjs`
returned actual exit2; corrected paths were discovered read-only. No build/test
success is inferred from those tooling failures.

Final author commands (each exact runtime separately, keyless environment):

```sh
env -i PATH=/usr/bin:/bin TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs --test-concurrency=1 --test-reporter=tap evaluation/experiment-budget/test/mixed-source-pair-guard.test.mjs evaluation/longmemeval/test/mixed-model-call-timeout.test.mjs
env -i PATH=/usr/bin:/bin TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/v24.15.0/bin/node tools/testing/run.mjs --test-concurrency=1 --test-reporter=tap evaluation/experiment-budget/test/mixed-source-pair-guard.test.mjs evaluation/longmemeval/test/mixed-model-call-timeout.test.mjs
```

Final serial author runs: Node22.16.0 actual exit0,31/31 pass,0 fail/skip;
Node24.15.0 actual exit0,31/31 pass,0 fail/skip. Both include all26 guard-file
controls plus5 new mixed controls. Child cleanup asserts zero owned entries
after success and deliberate failure; the latter child actually exits1 while
its observing parent succeeds. Canonical runner cleanup completed on both.
`git diff --check` actual exit0. Delivery paths from `git diff --name-only -z`
plus `git ls-files --others --exclude-standard -z` matched the independent
`git status --porcelain=v1 -z` route:8 scoped files, with only the3 known
read-only dependency links excluded. The first manifest probe used the wrong
MCP setup-link path and returned actual exit1 (`ENOENT`); `git status` identified
`adapters/mcp/node_modules`, and the corrected probe returned actual exit0.
No dependency link or target was changed. Final file hashes are handed to
primary outside this self-referential plan; author edits are frozen.
Author focus alone is not delivery acceptance or a paid-run grant.

## Primary integrated acceptance

Primary inspected all eight final changed files and independently matched their
hashes to the author's frozen handoff. The serial integrated runner completed
36 commands on exact Node22.16.0 and24.15.0, all actual exit0, with identical
source hashes before and after execution. The outer runner also exited0.
Each runtime passed1816 tests with zero failures, cancellations or skips:
generic581, budget67, request guard336, portable native85, LongMemEval318,
long-history5, OpenAI332, workspace25, installed native-local20 and mixed-native47.
JSON and maintainer validations plus all six required demos also exited0.

Commands followed current CONTRIBUTING and package scripts. Selected suites
used the canonical owned runner with `--test-concurrency=1`; generic used its
existing client wrapper. Full LongMemEval/long-history and generic test paths
were independently enumerated from filesystem and git before execution. Both
native gates used the existing pinned installed Mem0/Python roots and bwrap,
synthetic stores and fake HTTP, with no provider credentials. No missing
prerequisite was treated as a skip. The repository has no typecheck gate.

The eight-file delivery scope matched diff-plus-untracked and independent
porcelain enumeration, excluding only the three known unchanged dependency
links. After those gates, primary appended this acceptance record only; runtime
and test bytes remain the verified ones. Fixed-candidate independent Standards
and Spec reviews and latest-head CI are still pending. No paid run, merge,
release or deployment was performed.
