# Token-fit ingestion before paid execution

## Goal and evidence

Keep Cairn a lightweight reliable memory layer; accepted structural batches
must not silently exceed the extraction model's known local input budget.
N9 is CLOSED, unscored, never retried. Its first Cairn arm completed41/46
batches, then failed capture/context_budget_exceeded. Primary's read-only
reconstruction of that exact batch measured6652 logical tokens against6000;
previous batch289. No model call or database mutation was used to reproduce it.
This extraction request contains only its current batch, not accumulated MOCs.
Independent synthetic minimum: one3200-character CJK message3463 tokens fits;
two6727 tokens fail the real checkExtractionFits guard. Remove either and it fits.
The discrepancy is between structural UTF16 grouping and exact extraction fit.
The causal branch is directly established by deterministic request measurement;
no speculative prompt/model improvement is part of this fix.

N9 Mem0 separately halted at native_http_invalid; that cause is not established
here and is owned by the separate native-http-client-error worktree. N9 spent
891805 conservative microUSD; original cumulative234488985/300000000, settled.
These are reservations/recorded charges, not the vendor invoice. No new live run.

## Ownership and fixed point

Worktree /home/chichieh/Github/cairn-memory-worktrees/token-fit-ingestion,
branch fix/token-fit-ingestion, fixed base1706aa9f2f162d4d55f2147a7bbb24ec11aff2f5.
One GPT-6.1 Sol/high worker implements; primary owns design, authentic numeric
acceptance, integration and delivery; independent nonauthors review final commit.
Never mutate DCE, old operators, formal sources/results/ledger or other worktrees.
Dependent PR against integration/diagnosed-current-engine is authorized; no main
merge/release/deployment. No provider calls or live credentials.

## Acceptance TFI1–TFI8

TFI1: Write a failing synthetic regression before the fix. Use the real local
token counter and minimized two-message case. Original planner must be
structurally executable yet exceed6000; record exact red then green.

TFI2: Share the existing core.planCaptureBatches whole-message algorithm through
a pure internal helper. Preserve public core planner validation, shape, behavior,
source normalization, failure envelopes, no-store/no-provider semantics and
dependency-free core. Core keeps runtime.ready() ownership. No new OpenAI
dependency enters core; evaluation may use its already-required isolated adapter.

TFI3: Indexed-window and indexed-evidence evaluation plans use exact extraction
envelope counts with the same frozen OpenAI local counter before execution.
Partition only whole messages within existing session/structural batches;
preserve every source byte/coordinate/role/message identity and ordering.
Rebuild dense message/window/global/session-batch indices and normalized capture
digests. Nonfitting singleton returns an explicit nonexecutable preflight blocker,
never silently omitted or truncated. Legacy plain/qualified-prefix behavior stays.

TFI4: Version changed indexed plan identity and mixed source policy/digest;
derive new batch event IDs under a deterministic versioned domain. Both Cairn
capture and native Mem0 receive the same newly frozen message partition.
Prepare/verify/execution must agree; old prepared plans/capabilities must not
silently validate as the new plan. No execution-time adaptive resplitting.

TFI5: Recompute batch counts, manifests/rosters/source digests and resource
ceilings before a grant. Tests prove source reconstruction, deterministic IDs,
session boundaries, singleton rejection, no input mutation, old/new mismatch
refusal, and changed request/cost projection. No models/prompts/context limits,
timers/prices/guard authority/scorer/denominator changes.

TFI6: Use owned synthetic workspaces; prove success/failure cleanup. Regression
must reach real shared planner/guard with exact counter, not mirror a formula.
Test helper/public planner parity and installed package availability of helper.
Run applicable CONTRIBUTING gates on exact Node22.16.0 and24.15.0: generic,
validate, core + store/capture demos, LongMemEval + relevant ingestion/comparison/
public/mixed demos, mixed native, affected mixed guard and installed packaging
checks. Add other gates only when actual caller changes require them. Capture
complete logs/exits/skips and every failure; no repeated green suites without
a change/failure/unresolved concern. Do not invoke paid scripts.

TFI7: Primary privately remeasures closed N9 source-only plans using new pure
planner without provider calls or scoring; preserve old source/results unchanged.
Report whether all batches fit, or explicit blockers remain. This is development
diagnosis, not replayed official score or authorization for another paid run.

TFI8: Document limitations and visible behavioral change in this plan plus
docs/limitations.md/CHANGELOG.md as applicable; no parity/reliability completion
claim. Freeze scoped candidate, independent Standards+Spec on same base/head,
latest-head CI and primary key regression acceptance before ready PR.

## Worker scope

Allowed: new core pure capture-batch planner helper, core/contract.mjs delegation,
focused core tests; evaluation/longmemeval ingestion/mixed-source and required
plan-verifier/mapping callers/tests; affected mixed guard tests and packaging
tests; this plan, docs/limitations.md, relevant ingestion docs/CHANGELOG only.
Do not modify native runtime/HTTP diagnostics, request-guard authorization,
models/prompts/scorer/timers/root dependencies. Flag any necessary expansion.
Own locked dependency installs in this worktree are allowed, no lock changes.
Checkpoint red and static design/diff before broad gates. Do not commit/push;
primary will freeze and dispatch review. Keep all source text synthetic/public.

## Author checkpoints

Primary approved the necessary narrow packaging/artifact-files.json allowlist
addition for the new pure core helper. The installed artifact regression must
import that helper from the actual built/installed package and exercise it.
No release, package version or dependency-lock change is authorized.

TFI1 regression was written before any implementation edits. Exact command
(cwd is this worktree):

```sh
env -i PATH=/home/chichieh/.nvm/versions/node/v22.16.0/bin:/usr/bin:/bin NODE_DISABLE_COMPILE_CACHE=1 /home/chichieh/.nvm/versions/node/v22.16.0/bin/node tools/testing/run.mjs evaluation/longmemeval/test/token-fit-ingestion.test.mjs
```

Expected red: natural exit 1, 1 test/0 pass/1 fail/0 skipped/0 cancelled/0 todo,
258.071706 ms suite duration (tool chunk 5a6a77, wall 0.397843 seconds).
The real guard rejected the original single mixed batch of two individually
fitting 3,200-character messages at 6,727 logical tokens:
`Got unwanted exception. Actual message: "context_budget_exceeded"`.
The assertion calls real checkExtractionFits, not a mirrored budget formula.
The one-message control passed. No database/provider call or source mutation.

Static design: move the public core planner's existing algorithm, including
input validation, into a pure internal helper; retain runtime.ready() and the
public failure envelope in core. Indexed evaluation replans each structural
batch through that helper with the exact isolated OpenAI local counter,
preserves all source-map coordinates and identities, and rebuilds dense batch/
message/window indices and capture digests. New versioned event IDs and source
policy distinguish the new frozen partition. Nonfitting singletons produce
explicit blockers; old legacy/qualified-prefix planning remains unchanged.
No changes to core budgets, models, prompts, timers, prices, guard authority or
scoring. Primary authentic-data acceptance and independent review remain pending.

Provisional primary TFI7 source-only acceptance on this production draft passed:
old six batch counts [46,49,55,47,48,50] became [47,49,55,47,48,50]. All 296
new batches fit the real extraction guard, and the first case maximum became
5,528 tokens. Primary asserted unchanged source messages/raw/source-map
coordinates/order, dense indices, identical Mem0 partition and no input mutation.
Natural exit 0, session 48530, output chunk 7bba4a. This was private offline
development measurement, not replay/scoring or new spending authority. Primary
must tie this evidence to final source digests, or rerun the affected acceptance.

Initial focused set: 47/48 passed; the new mixed-regression fixture used a
nonmatching project namespace and failed `invalid_namespace` before its intended
path (chunk 718861, natural exit 1). Corrected only that synthetic fixture to
the required case-bound project namespace and opaque session identity. Affected
regression rerun then passed 5/5, exit 0, no skips (chunk 19572a). The original
TFI1 red became green with two batches measured [3463,3463] (chunk eab53d).
This setup failure and correction are retained; no production behavior or test
assertion was weakened to obtain green.

Expanded focused gates on exact Node 22.16.0 and 24.15.0 each passed 101/102
tests with no skips; the sole failure was the literal M3 protocol golden pinned
to old mixed-source-v2. This is the expected changed source-policy identity,
not a compatibility fix or guard weakening. Updated only the exact v3 golden
to 613fc5d50e30d9a0957671bb90c8e988b0836e755d7afa899ee51b9c86be632f,
retaining old scope-ID literals and asserting inequality to the old protocol
digest. Complete pre-correction logs are retained at
/tmp/cairn-token-fit-evidence.2gm67lO4/focused-pre-golden-node22.log and
focused-pre-golden-node24.log. Final affected rerun passed 11/11 on each runtime
including the installed helper, natural exit 0 with no skips/cancelled/todo
(22: 2847.406695 ms, chunk 44e86d; 24: 3040.234967 ms, chunk 7c8e09).
The unaffected focused greens were not repeated. Generic npm test then passed
581/581 on each exact runtime, natural exit 0, no failures/skips/cancelled/todo
(22: 260491.361652 ms; 24: 264101.475254 ms). Complete focused-final and generic
logs are retained in the same evidence directory. Remaining broad gates run next.

Final primary TFI7 acceptance passed on both exact runtimes, all 296 batches,
with identical metrics and source-preservation assertions above. Natural exit 0:
22 session 56346/output 8753a9; 24 session 70681/output c7d76f. Primary personally
authenticated the following SHA256 production digests against the acceptance:

| Source | SHA256 |
| --- | --- |
| core/capture-batch-planning.mjs | c65c39178ec35cc8f409bec5db847e6451b97c8824264b79151db73ccec5779a |
| core/contract.mjs | edb606a4fde50dcd82b8b7ce62ad4dc1eb3a093326a4395a5dd5b4c8c93db735 |
| evaluation/longmemeval/ingestion.mjs | 0ef4fbb99ba8045b7bc5fc470cc20d26e3866c3426cad54da5d285da5c7e159e |
| evaluation/longmemeval/mixed-source.mjs | 4e5ae28bdfbf13134329f69942114d6bbe5c3a6f910987a80af7b77c48b12c10 |

Primary's independent final key regression/public-parity/installed-helper gate
also passed 8/8 on each exact runtime, natural exit 0, no failure/cancel/skip/todo
(22 session 48745/output 202ad3, 2475.80998 ms; 24 session 3262/output 1357c8,
2584.112358 ms). No provider/store/scorer/old-run resume occurred in authentic
acceptance. This establishes local extraction fit only, not a semantic score,
provider-wire fit, downstream context fit or authorization for paid execution.

JSON validation and all six required synthetic demos (store, capture, ingestion,
comparison, public, mixed) passed on both exact runtimes, natural exit 0. Demos
retain only their newly created synthetic databases according to their existing
contracts; public demo removes its owned workspace. Maintainer plugin validation
initially failed on both runtimes because the prior locked tooling install used
--ignore-scripts and did not place its native binary. Inspected and ran only its
local install.cjs binary-placement step (natural 0); no download/provider call.
The same marketplace plus strict plugin validations then passed on both runtimes,
natural exit 0. Initial setup failures and successful reruns have separate complete
logs in the evidence directory; no repository production change was needed.
Workspace-lifecycle passed 25/25 on each exact runtime, natural exit 0 and no
failure/skip/cancel/todo (22: 23804.262093 ms; 24: 23590.730523 ms), including
real success/failure/interruption cleanup and canonical invocation ownership.

Broad LongMemEval initially passed 235/273 on both exact runtimes, natural exit
1, with 38 failures and no skips/cancel/todo (22: 94788.367306 ms). Complete
initial logs are retained. Root approved two test-fixture repairs: journal
preflight must use a genuinely nonfitting singleton rather than five now-fitting
turns; native input denial must retain its independent cl100k 8192-token boundary.
Root also approved necessary public-comparison/source-pair-preparation caller
compatibility and qualified-source-scoring schema validation only: compare one
shared ordered projection of exact sourceTurns, all message id/role/raw bytes and
every source coordinate except batch-local messageIndex; bind the shared source
map under a versioned digest domain. Each arm still binds its own full frozen
partition/event IDs through payload digests. Outer protocol schema/hash domain,
scope identities, guard authority, scoring math/rubric/denominator are unchanged.
Current indexed-v2 descriptors reject stale v1, and per-arm dense counts may differ.
This is no longer a pure source-window-only ablation for prefix/indexed; Cairn/Mem0
still receive identical partitions. Legacy/prefix planners remain unchanged.

Core broad passed 1182/1182 on both exact runtimes, natural exit 0, no failures/
skip/cancel/todo (22: 430384.433773 ms; 24: 429180.965164 ms). Caller compatibility
first rerun passed 70/73 with three expected identity goldens awaiting update,
natural 1, no skips (22: 46977.693869 ms); its complete log is retained. Updated
only required indexed-v2 plan/protocol/map/payload goldens; legacy plan, prefix
payload, history digest and scope-ID goldens remain unchanged. Corrected the
journal fixture to an explicit oversized singleton and proved its preflight
blocker, preserving zero HTTP, all-failed, terminal journal and cleanup checks.
The native boundary fixture now uses a single 3900-character U+85DD message:
the finite synthetic counter probe measured 3900 o200k versus 11700 cl100k tokens,
preserving native 8192-token refusal while Cairn fits. No model request occurred.

Final focused caller/journal/token regressions passed 81/81 on both exact
runtimes, natural 0, no fail/skip/cancel/todo (22: 62919.216025 ms;
24: 64245.389963 ms), with complete caller-final logs retained. Shared projection
also preserves each message's non-event namespace/client/session identity;
mutation tests cover these as well as raw sourceTurns, id/role/content, source
coordinate, order and drop changes. A valid 1-versus-2 frozen partition reaches
both scoring scopes normally; a coherently rehashed stale indexed-v1 descriptor
is refused before any scope/request. Scoring math, guard and scope IDs unchanged.
Remaining full native/artifact and final affected broad checks are pending.

Primary final source epoch acceptance after caller compatibility passed on both
exact runtimes, natural 0 (22 session 40925/output 082652; 24 session 68531/output
98a7a3). All 296 batches fit the unchanged 6000-token local extraction guard;
source/order/dense indices and identical Cairn/Mem0 partition assertions hold,
with no provider/store/scorer operation. The latest ingestion digest supersedes
the earlier table entry: 225876205acfcc5545fbb201e19836ce60ef6e80297730a93e50c2913b558cea.
Additional final caller digests:

| Source | SHA256 |
| --- | --- |
| evaluation/longmemeval/public-comparison.mjs | a094a1e3a1a6456c8d76446589f5b188140d83e33a8d040986ec40ed6bce7668 |
| evaluation/longmemeval/source-pair-preparation.mjs | c59b98a37d7a53a0bc48b38923fd3454462545fd5bbc39e41270b3a0d89c0708 |
| evaluation/longmemeval/qualified-source-scoring.mjs | a79cca3e6e39c76934f5b2f70cbd021710237459af473180f1a0faf023de875e |

Primary's affected key acceptance passed 13/13 on both exact runtimes, natural 0,
no fail/cancel/skip/todo (22 session 60403/output 80e2ea, 29392.410315 ms;
24 session 53143/output b1f446, 32294.467517 ms). It independently covers the
new projection/source mutation controls, journal refusal, stale-v1 no-scope/nojudge,
and actual native serialization/artifact-drift/deadline boundaries. No paid call.

Affected qualified-source-pair guard, parent inspection and adaptive source-pair
guard passed 56/56 on both exact runtimes, natural 0, no fail/skip/cancel/todo
(22: 20134.116192 ms; 24: 19398.360464 ms). Full installed artifact gate passed
89/89 on both, natural 0 with no failures/skips/cancel/todo (22: 164058.411538 ms;
24: 154594.826568 ms). This includes real offline installation and source-pair
launch acceptance. The required shared helper is included in the installed
archive; no source-checkout import substitutes for it. Complete logs retained.
Final full LongMemEval rerun after the actual caller repair is in progress;
initial full was red, so this rerun is not a redundant unchanged green suite.

Final full LongMemEval passed 275/275 on each exact runtime, natural exit 0,
no failure/skip/cancel/todo (22: 52863.479146 ms; 24: 51420.286908 ms). Full
explicit mixed-native-local passed 47/47 on each, natural 0 with no failure/
skip/cancel/todo (22: 359822.919818 ms; 24: 355924.765452 ms). The M12a native
serialization denial, inspected artifact drift and real local deadline checks
remain intact. All required gates now closed naturally; no author commit/push,
provider request, scoring of authentic data, old-run mutation or cleanup sweep.
Canonical runner cleanup failures would make these gates nonzero; the separate
25-case lifecycle gate explicitly proved invocation success/failure/interruption
owned-scratch removal. Synthetic demo database retention follows existing contracts.
Complete logs plus exact commands/exits/counts and final scoped source hashes are
frozen in /tmp/cairn-token-fit-evidence.2gm67lO4/manifest.json. Final git diff
--check passed. Primary commit freeze, independent Standards+Spec review and
latest-head CI remain delivery gates; author verification is not their substitute.
