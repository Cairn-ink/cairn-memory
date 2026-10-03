# Journal integration on the observed evaluation runtime

Base: `13fe50b22bbb1e9ad1f336290a823d7f335512d0`.
Worktree: `evaluation-journal-observability`; branch:
`fix/evaluation-journal-observability`. This is an explicitly dependent
evaluation branch, not an update to the primary worktree or authorization to
merge. The reviewed journal source is PR315 candidate
`68c3954ed996cd32cb619a773ab0019507c26d81`.

## Scope and frozen acceptance

- JO1: Add the opt-in PR315 result journal to this existing observed runtime.
  Preserve its complete RD1–RD12 contract from
  `docs/plans/mixed-result-durability.md`: same prepared/generation object,
  per-arm durable transitions and completion checks, persistence failures stop
  dispatch, interruption inspection is offline, and it grants no resume rights.
- JO2: Preserve this base's `phaseTiming`, `recallWitness`, transport failure
  observation, capture classification diagnostics and request-cap-v3/US$300
  lineage. Omitted journal behavior and both existing observational options
  remain valid. No core/MOC/retrieval/answer packing/prompt/model/default-policy
  changes. Test the journal together with both observational options enabled.
- JO3: Keep the existing public journal files and ordinary/native interruption
  tests from PR315, adapting only integration necessities. New fixtures use the
  canonical owned runner/workspace and contain no real corpus, key or ledger.
  Both arm orders, generation/scoring failure barriers and same-object scorer
  identity must still pass. An interrupted ordinary/native fake-HTTP run with
  observational options enabled preserves terminal-prefix inspection.
- JO4: Read the original source and intent for each overlapping hunk; retain
  both changes, record exact resolution choices, never select one entire side
  indiscriminately. Non-overlapping journal docs/testing infrastructure may be
  taken exactly from reviewed PR315. Do not implement unrelated changes or
  reinterpret the old interrupted run as recovered. A source-preserving sync
  with fixed main7467 for delivery retains already-approved main features;
  it is not new feature implementation. Inspect both sources for documentation
  conflicts, keep both retained-evidence sections, and rerun combined gates.
- JO5: Run generic npm test, test:longmemeval, the four documented LongMemEval
  demos, test:mixed-native-local, JSON and strict plugin/marketplace validation
  on both Node22.16/24.15. Run the relevant experiment-budget/HTTP guard v3 and
  OpenAI observational regressions on both versions. Native tests use the pinned
  synthetic roots and fake HTTP. Preserve labelled failures and explain them;
  no paid calls. Record exact candidate SHA/content and all commands/results.
- JO6: One bounded GPT-6.1 Sol/high author, primary direct final-candidate
  reruns, separate nonauthor Standards/Spec reviews of the same fixed diff,
  fresh review after fixes, then scoped PR against main with latest-head CI
  and current mergeability. No merge, release, deploy, key read, evaluator
  read, actual ledger mutation, old-operator rerun or new paid execution.

## Allowed changes

The exact journal implementation/docs/test files from PR315 and only necessary
integration changes to mixed-generation.mjs, mixed-scoring.mjs, their fixture
and native tests, CONTRIBUTING.md, ROADMAP.md, docs/limitations.md and this plan.
Existing ownership is serialized per file. Root owns protocol/resource choices
and operational authority; this worker does not select actual evaluation cases.

## Evidence

Primary delivery-integration decision2026-10-01: the first additive candidate
94cb586e1702354f770ec23b82d9f373ad491ff5 passed all JO5 author gates. Read-only
three-way merge inspection against fixed main7467 found exactly documentation
conflicts in CHANGELOG.md and docs/limitations.md, no runtime conflict. To keep
the PR currently mergeable and avoid dropping existing main features, the same
bounded author will integrate that fixed main into this isolated branch,
resolve those sections preserving both sources, record provenance, then rerun
all changed/current contributor gates and freeze a new combined candidate.
Primary worktrees/main remain untouched; no GitHub PR merge is authorized.
Independent reviews and primary acceptance target the final combined candidate,
not the first candidate's stale evidence.

Implementation owner: bounded GPT-6.1 Sol/high worker. Primary acceptance,
separate nonauthor Standards/Spec reviews and delivery remain root-owned gates.
Worker has no push, PR, GitHub PR merge, primary-main update or paid execution
authority. Only the explicitly authorized fixed-main local integration below
may finish as an isolated branch merge commit.

### Integration choices and caller inventory

Read the full original PR315 contract/guide and each overlapping source hunk
before applying changes. Six new source files were retrieved explicitly from
`68c3954ed996cd32cb619a773ab0019507c26d81` and added through `apply_patch`;
no cherry-pick or whole-side conflict resolution was used. The original
durability plan remains verbatim provenance and does not describe new execution.

- Generation: add the own `resultJournal` descriptor to the existing strict
  option inventory alongside `phaseTiming` and `recallWitness`. Preserve both
  validations and all base observer/transport/classification logic. Start the
  journal after the existing preparation/guard/native/root checks; append
  terminal results after the existing transport settlement, core cleanup and
  observer close/snapshot, before later arms. Completion binds the same frozen
  generation object returned to the caller.
- Scoring: transfer the reviewed additive hunk exactly. Existing generation/X
  validation and evaluator separation precede journal scoring start. The same
  actual generation object is required; completion binds the actual report.
- Journal: extend only its finite generation-diagnostic key allowlist with the
  base's `adapterPhaseTiming` and `recallWitness`. Reports, policies, prompts,
  core, MOC, transport observation and capture classification stay at the base.
- Fixture ownership: retain the base's canonical `createTestWorkspace` and
  deferred guard cleanup, adding optional caller-owned workspace reuse required
  by reviewed fixtures. Do not restore PR315's older direct temporary cleanup.
- Native tests: add the reviewed five cases plus generation/scoring interruption
  with both observations; retain both original omitted-option arm-order cases
  and add both observation-enabled arm-order cases. Ordinary tests retain all
  23 reviewed cases and add combined-option interruption and real
  generation/scoring report identity round-trip.
- Documentation: transfer narrow PR315 contributor/roadmap/limitations/protocol
  additions without replacing their surrounding base material. Extend the
  journal guide to describe already-existing observer retention.

Affected public entrypoints are `runMixedGeneration`,
`scoreMixedGeneration`, `createMixedResultJournal` and offline
`inspectMixedResultJournal`. Existing unjournaled callsites remain covered by
the base LongMemEval suite and native gate. Enabled callers are only owned
ordinary/native tests and their interruption child; no operational operator,
CLI, evaluator, corpus, actual ledger or external provider was accessed.
No browser routes or replay assumptions are present in this evaluation-only
scope. Request-cap-v3 and the cumulative US$300 lineage files are unchanged and
their offline guard regressions are required below.

### First additive candidate verification (historical)

Retained diagnostic directory:
`/tmp/cairn-journal-observability-evidence.eSnyvt`, outside test-owned scratch.
Only the locked `adapters/openai` and `tools/plugin-validation` dependencies
were installed using `env -i` with pinned Node24.15.0.

Initial focused evidence on Node22.16.0/24.15.0: ordinary journal 25/25 on each,
native combined observations 4/4 on each. Native focused logs precede adding
the two retained omitted-option cases; full final-source native gates supersede
that narrower result.

First additive candidate `94cb586e1702354f770ec23b82d9f373ad491ff5`
results, with zero test failures, cancellations or skips
in every passing suite:

| Command | Node22.16.0 | Node24.15.0 |
| --- | --- | --- |
| `npm test` | 402/402 | 402/402 |
| `npm run test:longmemeval` | 258/258 | 258/258 |
| `npm run demo:longmemeval-ingestion` | exit 0 | exit 0 |
| `npm run demo:longmemeval-comparison` | exit 0 | exit 0 |
| `npm run demo:longmemeval-public` | exit 0 | exit 0 |
| `npm run demo:longmemeval-mixed` | exit 0 | exit 0 |
| `npm run validate` | exit 0 | exit 0 |
| `npm run validate --prefix tools/plugin-validation` | both manifests pass | both manifests pass |
| `npm run test:experiment-budget` | 65/65 | 65/65 |
| `npm run test:experiment-request-guard` | 313/313 | 313/313 |
| `npm run test:benchmark-budget-v3` | 19/19 | 19/19 |
| `npm run test:openai` | 330/330 | 330/330 |
| `npm run test:mixed-native-local` | 41/41 | 41/41 |

Every command above ran from this worktree using `env -i` and exactly
`PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin` or the
corresponding `v24.15.0` path. Native commands additionally supplied only:

```sh
CAIRN_MEM0_NATIVE_VENV_ROOT=/tmp/cairn-mem0-preflight.vDNO3z/venv
CAIRN_MEM0_NATIVE_PYTHON_ROOT=/home/chichieh/.local/share/uv/python/cpython-3.11.12-linux-x86_64-gnu
```

Locked installs were `env -i PATH=/home/chichieh/.nvm/versions/node/v24.15.0/bin:/usr/bin:/bin npm ci --prefix adapters/openai`
and the same environment with `npm ci --prefix tools/plugin-validation`.
No dependency manifests or lockfiles changed. Required native infrastructure
was already supplied; no additional provider, credential or native installation
was performed. Native gates used fake HTTP, the pinned installed Mem0 roots,
Linux bwrap and synthetic new ledgers/stores; they never inspected an actual
ledger, evaluator, corpus, key, old operator or paid run.

Raw logs are named `<version>-<npm-script-with-colons-replaced-by-hyphens>.log`
in the retained directory above; strict validation is
`<version>-strict-plugin.log`. Full native timings were 241.896 seconds on
Node22 and 213.741 seconds on Node24. These are whole synthetic test-suite
durations, not memory-engine performance measurements.

The additional command
`env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin CAIRN_MIXED_JOURNAL_BASELINE=1 node tools/testing/run.mjs '--test-name-pattern=RD7 generation interruption' evaluation/longmemeval/test/mixed-result-journal.test.mjs`
intentionally exits 1 and is retained as
`22.16.0-EXPECTED-UNJOURNALED-RED.log`. It completes the real first Cairn
answer/scope, kills before whole-phase return, and observes missing retained
answer versus `Synthetic memory fact.`. This was a post-integration
reproduction of omitted-journal behavior, not a newly claimed pre-fix RED or
recovery of an old experiment. The RD9 test separately verifies owned cleanup
after this exact deliberate assertion failure. No unexpected worker
verification failures occurred.

All runtime/test content was fixed before the final-source matrix; subsequent
edits only completed this evidence record. The worker freezes the scoped local
candidate and reports its exact commit/tree in the handoff. Original PR315
evidence/counts in the verbatim source plan remain historical and are not
substituted for this matrix. Primary exact-candidate reruns, both independent
review axes and PR/CI/mergeability are still pending; this worker does not
claim those gates or merge/deliver the branch.

### Fixed-main delivery integration

The primary started `git merge --no-commit --no-ff 7467aebcb32563c9aab4356a8c3e04c0ebb1ecd4`
in this isolated worktree after explicitly amending JO4. The worker reread the
entire current contract and conflict-resolution skill, inspected stage-2 and
stage-3 documentation sources and source commit intent, and resolved only the
two conflicts using additive `apply_patch` edits.

- `CHANGELOG.md`: retain all four observed-branch unreleased classification/
  timing entries, then retain main's complete 0.2.0 CX-4 release section. Do not
  relabel unreleased evaluation diagnostics as part of that hosted release.
- `docs/limitations.md`: retain all three observed-branch recall-witness and
  prospective-transport sections, then retain main's complete CX-4 round-2
  environment limitations. Earlier journal retention and all other retained
  evidence remain present; none of the older failures is called recovered.
- Runtime auto-merge: before resolution, the staged diff from the first additive
  candidate is empty for `evaluation/longmemeval`, `evaluation/experiment-budget`,
  `adapters/openai` and `core`. Fixed main's MCP, shared-client/Codex, schema,
  version and CI files merged without conflict. No implementation is added to
  those approved main features, and their source content is preserved.

Current `CONTRIBUTING.md`, `package.json` and CI were inspected. The new main
version is 0.2.0; it adds the Codex/client CI suites and previously approved
MCP episode/procedural access. All JO5 gates are rerun on the combined source;
first-candidate evidence above remains historical, not final acceptance.
Combined-source logs and final frozen candidate are recorded below.

Retained combined-source diagnostic directory:
`/tmp/cairn-journal-main-sync-evidence.J7pTwb`. Locked MCP dependencies were
additionally installed with `env -i` and pinned Node24.15.0 after the primary
confirmed the current contributor/MCP verification scope. No manifest or
dependency change is authored by this setup. CI's newly imported Codex/client
and existing MCP/packaging gates are included in the combined matrix.

Exact source preservation checks: the staged combined tree equals fixed
main7467 for MCP/Codex runtimes, hosted plugin runtimes, schemas and version
manifests. Relative to main, it additionally retains the observed base's
pairing-guard v3 accommodation, benchmark-suite registration test, v3 package
commands/guard registration and installed-observer package/CI gates. These are
already present in first-candidate94, not new feature implementation. The
combined tree equals first-candidate94 for all LongMemEval/experiment-budget/
OpenAI/core source and tests (empty diff). Manual resolution adds both
conflicting documentation sections; no source changes are authored.

Combined-source worker verification completed on both exact runtimes. Each
command used the same `env -i`/pinned-PATH convention above, and native tests
used only the same two supplied pinned native roots. Raw logs use the same
`<version>-<script-with-colons-replaced-by-hyphens>.log` convention in this
new directory; no first-candidate raw log was overwritten.

| Command | Node22.16.0 | Node24.15.0 |
| --- | --- | --- |
| `npm test` | 581/581 | 581/581 |
| `npm run test:longmemeval` (all 25 journal cases included) | 258/258 | 258/258 |
| `npm run test:mixed-native-local` | 41/41 | 41/41 |
| `npm run test:experiment-budget` | 65/65 | 65/65 |
| `npm run test:experiment-request-guard` | 313/313 | 313/313 |
| `npm run test:benchmark-budget-v3` | 19/19 | 19/19 |
| `npm run test:openai` | 330/330 | 330/330 |
| `npm run test:codex` | 136/136 | 136/136 |
| `npm run test:client` | 5/5 | 5/5 |
| `npm run test:pairing` | 270/270 | 270/270 |
| `npm run test:pairing:golden` | exit 0 | exit 0 |
| `npm run test:mcp` | 111/111 | 111/111 |
| `npm run test:core` | 1136/1136 | 1136/1136 |
| `npm run test:workspace-lifecycle` | 25/25 | 25/25 |
| `npm run test:artifact` | 88/88 | 88/88 |
| `npm run test:installed-phase-live:offline` | 4/4 | 4/4 |
| `npm run test:installed-classification-followup:offline` | 6/6 | 6/6 |
| `npm run test:long-history` | 5/5 | 5/5 |
| `npm run test:long-history-live:offline` | 3/3 | 3/3 |
| `npm run test:live-evidence-offline` | 340 pass, 30 opt-in skips | 340 pass, 30 opt-in skips |
| `npm run validate` | exit 0 | exit 0 |
| `npm run validate --prefix tools/plugin-validation` | both manifests pass | both manifests pass |

The generic count is 581 rather than fixed main's expected 580 because this
branch retains the observed base's single benchmark-suite registration test.
All listed suites have zero failures/cancellations. Only the ordinary
live-evidence suite skips: eight explicitly opt-in pinned Hermes cases,
nineteen explicitly opt-in installed capture/lifecycle cases and three opt-in
installed rationale cases. These thirty skips are not counted as passed
installed-host/product gates. The separate required installed rationale gate
below explicitly executes its three opt-in cases; all native/journal and
other listed suites have zero skips.

Each of the four `demo:longmemeval-{ingestion,comparison,public,mixed}` commands
passes on both runtimes. The current CI contributor demos
`demo:{store,history,moc,recall,admission,episodes,session-context,capture,conflicts,rebuild,continuation,openai-offline,experiment-budget,experiment-request-guard}`
also each exit 0 on both runtimes, using their existing synthetic fixtures.

Additional current CI commands all exit 0:

- Metadata preparation: pinned Node24 `node tools/testing/run.mjs --script packaging/prepare-cache.mjs`,
  retained in `24.15.0-metadata-preparation.log`.
- On both runtimes: `CAIRN_RATIONALE_INSTALLED_OFFLINE=1 node tools/testing/run.mjs evaluation/live/test/rationale-pilot.test.mjs`,
  4/4 passed with zero skips, retained in
  `<version>-installed-rationale-explicit.log`.
- On both runtimes: `node tools/testing/run.mjs --script packaging/verify-clean-cache.mjs`,
  retained in `<version>-packaging-fresh-cache.log`. This and metadata
  preparation use only public npm registry metadata/dependencies, never a
  model provider or registry publication.

No unexpected verification failure or cancellation occurred during this
integration. Combined native whole-suite durations are 282.967 seconds on
Node22 and 279.529 seconds on Node24; core whole-suite durations are 445.723
and 446.402 seconds, including the existing actual-lock/budget sweeps.
These are test-suite timings, not engine-performance measurements.

Runtime and tests were unchanged throughout this combined matrix; only this
evidence record was completed afterward. The isolated merge commit has the
first additive candidate and fixed main7467 as its two parents. Primary
acceptance, separate Standards/Spec reviews and latest-head PR delivery gates
must use that final combined commit/tree; the first-candidate matrix is not
substituted for it. Exact commit/tree are reported in the worker handoff.
