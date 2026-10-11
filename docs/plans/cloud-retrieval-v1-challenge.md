# Complementary retrieval: independent source-only development challenge

Packet B, local fallback; fixed base `52640f2278291d42e79597e542e2f039ccf6b29f`.
Owner: independent GPT-6.1 Sol High worker. Worktree:
`/home/chichieh/Github/cairn-memory-worktrees/cloud-retrieval-v1-challenge`, branch
`test/cloud-retrieval-v1-challenge`. Cloud M1 remains FAIL; local readiness does
not waive it. No A implementation, results or controls were inspected before
this freeze. The public fixtures and this rubric are a development challenge,
not a blind holdout. No provider, model service, corpus, credential or operational
ledger is used. Runtime token/cost/allowance and peak resources are unknown unless
measured explicitly below. No paid or semantic QA evaluation is authorized here.

## Frozen acceptance rubric

The source fixture defines five targeted cases: changed premise, proposal versus
adoption, temporal applicability, natural-language navigation and namespace
collision. Every targeted case must deliver both required exact source passages
and their original submitted roles into the actual unchanged answer request.
Required indices and answer constraints are evaluator-only; neither is passed to
selection, rank, candidate assembly, or answer packing. There is no scripted QA
accuracy claim: the answer constraints describe why both passages matter, not a
model-scored result. A candidate that fails any case retains that failure.

Preconditions: each case has 54 earlier irrelevant history turns and an 18-card
rank-visible review shelf, including unrelated and instruction-bearing sources.
All original turns are admitted using trusted synthetic explicit source windows.
The source-visible selector chooses the visible `Review shelf:` label, while
the ranker chooses by query-word overlap in submitted receipt excerpts, ignoring
stored identities and evaluator fields. Required complements are visibly present
within the 36-card, 6,000-token input bound. Limit six leaves spare capacity after
the scripted seed. Natural navigation supplies an exact shared schedule phrase;
literal-navigation cases supply a repeated source code. We require retaining
explicit source context, not determining truth or adoption from navigation.

The ordinary unexpanded rank is a negative control: it must miss at least one
required passage in every targeted case. The very same delivery assertion must
go red against that ordinary arm. Identical fresh cold SQLite copies isolate
arms. Treatment runs real `core.recall`, authoritative `core.get` verification,
`verifiedRoleEvidence`, and unchanged `packMixedAnswer`. A passage in a candidate
pool or diagnostics alone cannot pass. Verify exact excerpts, roles, namespace,
revision, provenance coordinates, seed order and unchanged rank wire input.

Boundaries required for acceptance: validated empty rank and empty selection
deliver no evidence; no-spare-limit preserves unchanged seeds; mixed namespace
additions require a seed in that namespace; overflow omits a whole authoritative
role-evidence unit under the unchanged answer ceiling; correction or forgetting
during rank returns the core's `revision_conflict`, including a would-be added
source. Descriptor-safe malformed input/output, stale and duplicate references,
input/output token ceilings, detached immutable snapshots, cancellation and
output-counter mutation must retain the shared seam's typed failures. Every
rank delegates once, with original system/input/1024/signal and no new ports.
Diagnostics must contain strategy, exact addedRefs and semanticCoverage
`unassessed`; they do not establish relevance, safety or semantic completeness.

Candidate loading is lazy only to allow explicitly named precondition and
negative-control runs without A. A full suite without `candidate.mjs` fails with
the import error; there is no substitute candidate and no essential skip. Full
integrated acceptance is PENDING primary integration until every required test
actually executes on Node 22.16.0 and 24.15.0. The primary owns combined verification
and independent nonauthor Standards and Spec review; this worker makes scoped
local commits only, with no push, PR, merge or deployment.

## Evidence record

Fixture/rubric freeze commit and SHA-256 hashes will be reported immediately to
primary before implementing the test harness. The fixture and rubric above are
not revised in response to A behavior. Exact test commands, actual exits,
assertion counts, scratch cleanup and elapsed observations follow in a separate
append-only execution record below. Generic suites and validators are baseline
regression evidence; they cannot replace candidate-specific acceptance.

## Append-only execution record: Packet B local, 2026-10-10/11

The independent fixture/rubric freeze is commit
`258a8b859bf4326c5f9d948b65cf6c89b9e3f24b`. Frozen fixture SHA-256:
`b2e71a8d11f6301fed7a70a93381fdb28cac22e890a512b201b74601ca55bf6e`.
Initial rubric SHA-256 at that commit:
`6ec49919baf96090d6d6758648c1be60ca7d98ed8b9bd4fafd13cd651cfe169c`.
The final harness SHA-256 is
`cadbce02ee15dc20786d152a7d524df05c9a82965e4d4d57918541134d281331`.
The fixture was never changed. No A implementation, outputs, results or controls
were inspected while authoring or verifying this harness. Runtime assignment is
GPT-6.1 Sol High; inference usage, actual agent cost and remaining allowance are
not exposed. No additional agent was spawned.

Pre-candidate protocol correction, approved by primary: the existing core
selects at most twelve refs per namespace in each navigation round and permits a
personal namespace plus one project, rather than two projects in a read set.
Keep the frozen total eighteen cards and every explicit source/role/text/namespace
field: only generated filler cards spill into namespace one, making twelve
project cards and six personal cards visible. The seeded project therefore has
twelve eligible cards, not eighteen. All fifty-four archive distractors remain
stored. The source-visible `Review shelf:` selector does not evaluate semantic
MOC routing or discovery among the seventy-two stored turns. Synthetic navigation
summaries copy the source body verbatim; authoritative rank and answer inputs
omit those interpretations and retain exact source receipts.

The strict source planner requires project scope and projectId equal to caseId;
the personal-namespace source plan uses that planner-only surrogate. Actual
admission, cold recall and `core.get` still use the project/personal namespaces.
Tests check authoritative admitted identities, every actual rank namespaceIndex,
authoritative namespace/revision/state, exact roles/excerpts/event mapping and
exact reconstruction coordinates. The source-evidence DTO intentionally omits
namespace, so grouping uses the evaluator-only authoritative admission inventory;
it is never supplied to the model or assembly. Windows containing the synthetic
date wrapper are correctly classified `metadata-or-mixed` with null original
character offsets, while original session/turn and window coordinates are exact.
This is explicit trusted synthetic admission, not capture-model extraction.

Retained harness development failures all preceded A exposure: invalid planner
namespace (exit 1, one pass/six fail), illegal eighteen refs in one namespace and
two-project read set (exit 1, one pass/six fail), then incorrect assumptions about
the DTO namespace, compact admission DTO and metadata-window offsets (exit 1,
one or two pass/six or five fail). These were harness/precondition errors, not
candidate failures. Their tool output is retained in the session. An initial
sanitized npm wrapper also failed before running tests: both npm configuration
paths were `/dev/null`, which npm rejects as double loading one config. Five npm
commands per runtime exited 1 with no assertion counts. Logs are retained;
reruns used separate nonexistent config paths inside each fresh owned parent.
Neither failure was reclassified as candidate evidence or suppressed.

All following commands used resolved Node binaries under
`/home/chichieh/.nvm/versions/node/v22.16.0/bin` and
`/home/chichieh/.nvm/versions/node/v24.15.0/bin`, with exact `node --version`
outputs `v22.16.0` and `v24.15.0` (both exit 0). Fresh isolated nonsymlink
dependency directories were checked with `ls -ld`; each of
`npm ci --offline --prefix adapters/openai`,
`npm ci --offline --prefix adapters/mcp`, and
`npm ci --offline --prefix tools/plugin-validation` exited 0. No root/global
install, dependency removal or lockfile change occurred.

Timed gates use `env -i` with the pinned PATH, LANG, a fresh owned TMPDIR and
`NODE_DISABLE_COMPILE_CACHE=1`. npm receives distinct owned config paths.
The table contains actual process exits, not the status of a pipeline. Counts
are executed node:test assertions; all rows with counts have zero skips and
cancellations. Pattern runs are precondition evidence only, never full acceptance.

| Executed command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `node tools/testing/run.mjs --test-name-pattern=precondition evaluation/experiments/cloud-retrieval-v1/challenge.test.mjs` | Exit 0; 7/7 pass; 14.97 s | Exit 0; 7/7 pass; 14.93 s |
| `CAIRN_COMPLEMENTARY_NEGATIVE_CONTROL=1 node tools/testing/run.mjs --test-name-pattern='acceptance: actual cold recall' evaluation/experiments/cloud-retrieval-v1/challenge.test.mjs` | Exit 1; 0 pass/5 fail; 12.91 s | Exit 1; 0 pass/5 fail; 13.00 s |
| `node tools/testing/run.mjs evaluation/experiments/cloud-retrieval-v1/challenge.test.mjs` (final harness, missing candidate) | Exit 1; 24 tests: 7 pass/17 fail; 16.55 s | Exit 1; 24 tests: 7 pass/17 fail; 16.54 s |
| `npm test` | Exit 0; 669/669 pass; 283.83 s | Exit 0; 669/669 pass; 288.08 s |
| `npm run validate` | Exit 0; 0.10 s | Exit 0; 0.10 s |
| `npm run test:workspace-lifecycle` | Exit 0; 25/25 pass; 18.83 s | Exit 0; 25/25 pass; 19.37 s |
| `node tools/testing/run.mjs evaluation/architecture/test/source-linked-evidence-model.test.mjs evaluation/architecture/test/seed-gated-source-set.test.mjs` | Exit 0; 30/30 pass; 3.40 s | Exit 0; 30/30 pass; 3.35 s |
| `npm run validate --prefix tools/plugin-validation` | Exit 0; 1.41 s | Exit 0; 1.44 s |
| `npm run test:longmemeval` | Exit 0; 210/210 pass; 12.48 s | Exit 0; 210/210 pass; 11.73 s |
| `node tools/testing/run.mjs --script evaluation/longmemeval/demo.mjs` | Exit 0; 0.33 s | Exit 0; 0.25 s |
| `node tools/testing/run.mjs --script evaluation/longmemeval/comparison-demo.mjs` | Exit 0; 0.35 s | Exit 0; 0.33 s |
| `node tools/testing/run.mjs --script evaluation/longmemeval/public-demo.mjs` | Exit 0; 0.39 s | Exit 0; 0.39 s |

Ordinary controls miss required source one in all five targeted actual answer
requests. The disabled treatment command reports five `ERR_ASSERTION` missing
complement failures, not import errors. The final unfiltered suite reports
seventeen `ERR_MODULE_NOT_FOUND` failures because A is absent; the seven
independent tests pass. An earlier unfiltered harness had 21 tests, seven pass
and fourteen missing-module failures on each runtime (exit 1). The three added
boundary checks remain within the frozen rubric and were written before A
exposure. Candidate-dependent acceptance is PENDING, not a pass or skip.
Primary must preserve the first unfiltered integrated result on this final
fixed harness and run all twenty-four tests on both pinned runtimes.

Logs and GNU time records remain in `/tmp/cairn-complementary-b-gates.m2GQLE`.
All thirty-six timed command-owned parents, including expected failed runs,
were empty after their processes finished; each `rmdir` exited 0. SQLite closes
before removal. An independent owned-root directory inspection found zero
remaining scratch parents. Demo entrypoints were run through the owned runner's
`--script` mode; their synthetic output databases were therefore invocation
scratch, not retained demo artifacts. No historical temporary directory was
searched or swept. Maximum observed GNU-time per-process RSS across successful
gates was 302,816 KiB on Node 22 and 422,124 KiB on Node 24 (LongMemEval suite).
This is not aggregate/cgroup peak, algorithm workload fit, or paid cost.

No QA accuracy, safe semantic reasoning, extraction quality, installed Hermes
acceptance, official LongMemEval score, competitive parity or holdout claim
follows from these synthetic source-preservation tests. No default/core/provider,
transport, budget, CI, dependency, existing test or sealed result was changed.
The base-to-HEAD `git diff --name-only` inventory and independent unique
`git log --name-only` inventory were diffed (exit 0), then checked against the
exact allowed set: count three. The timed-log count was independently derived
with `find` and Node directory enumeration: count thirty-six, matching thirty-six
owned-parent cleanup records. Only the three Packet B files are delivered by
scoped local commits. Primary owns integration, its final inventory cross-check, combined gates,
independent nonauthor reviews, branch delivery and any later paid evaluation.
