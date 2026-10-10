# Codex Cloud: bounded algorithm exploration and independent verification

Status as recorded 2026-10-10 23:34 (Asia/Taipei): cloud setup completed and an
Only-me environment published at approximately
2026-10-10 22:47 (Asia/Taipei). A new M1 offline smoke task was dispatched at 22:48
with GPT-6.1 Sol High selected in the UI; its final result is FAIL. Cloud M2 remains
blocked. Primary selected the local fallback with the same A/B contract; its
fixed-#389 readiness gate is accepted PASS. As of this evidence record, no
algorithm workers or paid evaluation have been dispatched.
Owner: primary DRI.
Document branch: `docs/codex-cloud-algorithm-plan`.
Fixed documentation base: `523b8bfd88f8de280b85277e735ca1fb747379d8` (public main).

先把力氣放在 Cairn 的 retrieval 和回答品質，長期目標仍是讓 Hermes 和其他
harness 用得到輕量、可靠的記憶。雲端先分成兩個有明確範圍的任務，一個試演算法，
另一個獨立找反例；整合和付費評估由本機統一負責。雲端 setup 已完成，環境也已
發布，但新送出的 M1 失敗了，原因還沒確認。我們改走本機，同一個固定 #389
版本的 readiness 檢查已通過，下一步才是派兩個本機 A/B 任務。Cloud 的失敗仍保留，
setup 跑綠不能直接當成演算法或回答品質的證據。

## Goal and present evidence

Improve source-backed retrieval and QA while retaining lightweight memory for
Hermes and other harnesses. Use existing tools, branches and result documents;
do not build another orchestration service, A2A framework or memory architecture.
Cloud delegation is useful only if it produces a testable algorithm change and
independent evidence faster than the primary could obtain locally.

The closed [combined development comparison](https://github.com/Cairn-ink/cairn-memory/blob/52640f2278291d42e79597e542e2f039ccf6b29f/docs/plans/evidence-bundle-qa24-results.md)
recorded ordinary 18 correct / 5 incorrect / 1 judge-unresolved and combined
22 / 2 / 0 across 24 cases, with all 48 answers executed. Safety advancement
remained false. This is neither holdout nor official LongMemEval, Mem0 parity,
long-history or installed-host acceptance. Preserve all sealed results.
The [seed-gated candidate](https://github.com/Cairn-ink/cairn-memory/blob/52640f2278291d42e79597e542e2f039ccf6b29f/docs/plans/seed-gated-source-preservation.md)
has offline evidence for pools at most six and falls back above six; it has no
new QA score. Larger pools are the next challenge, not an established gain.

PRs [#387](https://github.com/Cairn-ink/cairn-memory/pull/387),
[#388](https://github.com/Cairn-ink/cairn-memory/pull/388) and
[#389](https://github.com/Cairn-ink/cairn-memory/pull/389) were OPEN at inspection.
Do not merge or duplicate them. This main-based documentation PR is separate
from the prospective experiment stack. The configured experiment base is #389 head
`52640f2278291d42e79597e542e2f039ccf6b29f`; M1 verified its actual checkout,
but failed readiness tests. Primary must verify the base again before algorithm dispatch.
A default-main cloud checkout without that stack is a failed prerequisite.

## Cloud setup progress, 2026-10-10

This section records setup and publication evidence supplied by the primary,
not the result of the new M1 task. The environment includes only the public
`Cairn-ink/cairn-memory` repository and pins the exact #389 SHA above. Primary
directly verified Only me in the publication UI; the agent schema cannot see that
setting. Network is package-managers only, with zero extra domains, zero secrets
and zero configured environment variables. No private wiki, local `.env`,
operational ledger, dataset or provider key was uploaded or connected.

The setup installed Node under
`/workspace/cairn-toolchains/node-v22.16.0-linux-x64/bin` and
`/workspace/cairn-toolchains/node-v24.15.0-linux-x64/bin`, plus Python 3.12.14.
Both Node archives were verified against official Node checksums:

| Runtime | Archive SHA-256 |
| --- | --- |
| Node 22.16.0 | `f4cb75bb036f0d0eddf6b79d9596df1aaab9ddccd6a20bf489be5abe9467e84e` |
| Node 24.15.0 | `472655581fb851559730c48763e0c9d3bc25975c59d518003fc0849d3e4ba0f6` |

Locked isolated, nonsymlink dependency sets were installed with `npm ci` for
`adapters/openai`, `adapters/mcp` and `tools/plugin-validation`. Setup ran these
commands on each pinned runtime; counts are per runtime:

| Setup command | Actual exit / outcome on Node 22.16.0 and 24.15.0 |
| --- | --- |
| `node --version` | Exit 0; exact pinned versions |
| `npm test` | Exit 0; 669 tests, 669 pass, 0 fail / skip / cancel |
| `npm run validate` | Exit 0 |
| `NODE_DISABLE_COMPILE_CACHE=1 npm run test:workspace-lifecycle` | Exit 0; 25 tests, 25 pass, 0 fail / skip / cancel |
| `node tools/testing/run.mjs evaluation/architecture/test/source-linked-evidence-model.test.mjs evaluation/architecture/test/seed-gated-source-set.test.mjs` | Exit 0; 30 tests, 30 pass, 0 fail / skip / cancel |
| `npm run validate --prefix tools/plugin-validation` | Exit 0 |

The final setup-status command asserted all 12 command records had exit 0 and
empty owned scratch. Lifecycle cases include expected child success, assertion,
setup, resource-close and runner-cleanup failures. Git status, worktree diff and
index diff were empty. Main suites took 130.8 seconds and 137.3 seconds on the two
runtimes respectively. Observed setup capacity was four CPU equivalents via
cgroup, 32 GiB memory and approximately 29 GiB free disk. Exact peak-resource
records and command logs remain remote-only in `/workspace/cairn-setup-logs`;
they have not been downloaded locally. Capacity is setup evidence, not measured
A/B workload fit, remaining quota or concurrency availability.

Retained setup failure: the initial automatic onboarding ran default main with
preinstalled Node 24.19.0 and inherited umask `0077`. It returned 635 tests,
634 pass and 1 fail (`key_restored` versus `binding_history_invalid`); targeted
reproduction exited 1. Superseded-main logs remain in the setup log directory.
The fixture requested mode `0644` without `chmod`; observed mode was `0600` under
`0077` and `0644` under `0022`. Subsequent normalized tests set umask `0022` only
inside test children. The default remained `0077`, and no test, source or
production-permission file was edited. This establishes no compatibility with
default `0077` and no semantic score. The UI's `+10215/-5` represents the existing
main-to-#389 merge-base diff (locally checked: 45 files, 10,215 insertions,
5 deletions), not new setup changes.

Automatic onboarding initially selected GPT-6.1 Sol Light; a follow-up steered
GPT-6.1 Sol High. The newly dispatched M1 separately selected High in the UI.
Backend inference metadata/usage, remaining cloud allowance and concurrency are
not exposed. Record UI selection as such; do not infer actual inference or cost.

## New M1 smoke result: FAIL, 2026-10-10

Primary observed the new task's final report. It verified exact #389 SHA
`52640f2278291d42e79597e542e2f039ccf6b29f`, both pinned runtime versions and
archive digests, and `npm ls` for all three isolated dependency sets. GPT-6.1 Sol
High was directly verified in the UI; backend inference metadata remains unknown.
The following are actual command exits on each runtime. Reported test totals are
**file-level results, not individual assertion counts**; they are not comparable
to setup's 669/25/30 assertion totals.

| M1 command | Actual exit / outcome on Node 22.16.0 and 24.15.0 |
| --- | --- |
| `node --version` | Exit 0; exact pinned versions |
| `npm test` | Exit 1; 21 files pass, 6 files fail, 0 skip / cancel |
| `npm run validate` | Exit 0 |
| `NODE_DISABLE_COMPILE_CACHE=1 npm run test:workspace-lifecycle` | Exit 1; 1 file pass, 1 file fail, 0 skip / cancel |
| `node tools/testing/run.mjs evaluation/architecture/test/source-linked-evidence-model.test.mjs evaluation/architecture/test/seed-gated-source-set.test.mjs` | Exit 0; 2 files pass, 0 fail / skip / cancel |
| `npm run validate --prefix tools/plugin-validation` | Exit 0 |

All 12 command-owned scratch parents were empty despite the test failures. Default
umask `0077` was preserved, with `0022` only in test children. Final git status,
worktree/index diffs and two independently derived changed-file inventories all
had exit 0 and count 0. The new smoke measured 63.433 seconds, four CPU equivalents,
16 GiB cgroup memory, 460.3 MiB cgroup peak, no OOM and 29.8 GiB free disk. These
are fresh-task observations, separate from setup's 32 GiB environment evidence.

The first preflight wrapper was rejected for its npm configuration paths involving
`/dev/null`; the wrapper was corrected before tests. That failed
preflight is retained rather than reclassified. Exact test-failure cause remains
unassigned after the bounded diagnosis below. Logs remain remote-only at
`/workspace/cairn-cloud-smoke.jFVlV3`: the designated output filesystem is
read-only, so no local raw artifacts were downloaded. Setup success, clean scratch
and passed validators do not override M1's failed test commands. No algorithm A/B
or paid calls ran.

### Bounded M1 diagnosis: root cause unassigned

Primary inspected the original logs and raw synthetic diagnostic stdout. Node 24
main-log lines 25–42 contain a native `InternalCallbackScope::Close` assertion,
`execution_async_id == 0`; the subprocess identity is unknown. Both pinned
runtimes reported files rather than individual assertions.

An approved, owned synthetic fixture imported `node:test` and the existing
`createTestWorkspace`, with one named passing assertion and one intentional named
failure. On Node 22, direct `node --test --test-reporter=tap` and the repository
runner each exited 1 and reported only one failed file; the expected two
assertions / one pass / one fail, names and failure message were absent from raw
stdout. The intentional failure explains a nonzero exit, but not that missing
assertion reporting. Repository SHA stayed unchanged and git remained clean.
Owned scratch was empty and removed with `rmdir`; global umask `0077` remained
unchanged, with `0022` only in the child. The remote `diagnostic-node22.ktFTrh`
directory is retained. A wrapper-only explanation is insufficient; root cause
remains UNASSIGNED. This proves neither a platform fault nor product correctness.

### Primary decision: local fallback, readiness accepted PASS

Primary selected the accepted local route for the same fixed-#389 A/B contract,
not a Cloud gate waiver. Primary completed and independently checked the shared
readiness commands locally at exact SHA
`52640f2278291d42e79597e542e2f039ccf6b29f` on both pinned runtimes, in
`/home/chichieh/Github/cairn-memory-worktrees/cloud-retrieval-v1`. Actual outcomes:

| Local readiness command | Node 22.16.0 | Node 24.15.0 |
| --- | --- | --- |
| `node --version` | Exit 0; `v22.16.0` | Exit 0; `v24.15.0` |
| `npm test` | Exit 0; 669 pass; 268.383 seconds | Exit 0; 669 pass; 272.656 seconds |
| `npm run validate` | Exit 0 | Exit 0 |
| `NODE_DISABLE_COMPILE_CACHE=1 npm run test:workspace-lifecycle` | Exit 0; 25 pass; 16.742 seconds | Exit 0; 25 pass; 17.179 seconds |
| `node tools/testing/run.mjs evaluation/architecture/test/source-linked-evidence-model.test.mjs evaluation/architecture/test/seed-gated-source-set.test.mjs` | Exit 0; 30 pass; 2.942 seconds | Exit 0; 30 pass; 2.821 seconds |
| `npm run validate --prefix tools/plugin-validation` | Exit 0 | Exit 0 |

All test totals here are individual assertions, with zero fail / skip / cancel.
Logs, `run-readiness.mjs`, `22.16.0-records.json` and `24.15.0-records.json` are retained in
`/tmp/cairn-cloud-local-readiness.M9T0Br`. Primary's independent Node assertion
matched all 12 command records against 12 separately enumerated command log files
and exited 0. All 12 owned scratch parents were empty and removed with `rmdir`.
The three locked dependency sets were isolated nonsymlink directories; each
`npm ci --offline` exited 0. Execution used an allowlisted environment, child
umask `0022` and disabled compile cache, without provider credentials, corpus or
operational ledger. Exact experiment SHA remained unchanged and clean; git-diff
versus git-status inventories matched with count 0 and assertion exit 0.

The analogous local Node 22 diagnostic fixture, direct and wrapped, each returned
the expected exit 1 with two assertions, one pass and one deliberate fail, zero
skip / cancel, both test names and the distinctive failure message visible.
Empty owned-parent removal exited 0. This local/cloud contrast identifies no
single environmental cause; the full Cloud root cause remains unknown.

Primary may now dispatch exactly two local GPT-6.1 Sol High packets using the
frozen seam and disjoint files. As of the dated evidence record above, none had
been dispatched. Cloud M1 stays FAILED and Cloud M2 stays BLOCKED independently.
The cloud diagnostic loop stops here: no further Cloud/CLI probes or cloud
product-suite reruns this turn. The next action is the two local packets. No user
decision, paid calls or new orchestration service is required for this fallback.

Local documentation verification is separate: on the documentation worktree at
HEAD `dfff551a5fe7d0d76b0083bc01de90bb98a2ff79` plus these scoped documentation
edits, `npm test`, `npm run validate` and
`npm run validate --prefix tools/plugin-validation` each exited 0 on local Node
22.16.0 and 24.15.0. Each main suite reported 635 tests, 635 pass and 0 fail / skip /
cancel (282.894 seconds and 288.092 seconds respectively). Logs are retained at
`/tmp/cairn-cloud-plan-gates.CUbKQ1`; this main-based local pass does not repair or
explain the cloud #389 failure.

### Bounded CLI follow-up, 2026-10-10

A read-only GPT-6.1 Sol/high helper had a 20-minute deadline and stopped early
safely. Installed CLI was 0.162.1; ChatGPT login status exited 0. Actual checks:

| Check | Outcome / limit |
| --- | --- |
| `codex cloud list --json --limit 20` from the repo and `/tmp` | Both exit 0; zero tasks, `cursor: null`. The assertion that the known browser task was visible exited 1. |
| `codex cloud status` with browser UUID or full URL | Exit 1; HTTP 404 `Invalid task ID`, with URL normalized by the CLI. The browser `/local/` UUID is not a verified CLI backend task ID. |
| `codex doctor --json`, bounded to 30 seconds | `ETIMEDOUT`, no output; inconclusive despite reported status 0, not a healthy diagnostic result. |
| `codex cloud exec --help` | Requires an environment; no explicit model/effort option. A `-c` override cannot guarantee the same cloud model without a test. |

The [CLI reference](https://learn.chatgpt.com/docs/cli/reference),
[authentication documentation](https://learn.chatgpt.com/docs/auth) and
[current Cloud documentation](https://learn.chatgpt.com/docs/cloud) describe the
available commands and access, but these observations do not establish browser/CLI
account or workspace equivalence, backend ID mapping or rollout state. They do
not prove current Cloud unsupported or an account mismatch. Primary found no
further official nonsecret task ID in browser menus. No raw auth files or tokens
were inspected, and no config, install or task creation occurred. Primary decision: keep
the browser as the validated transport; stop CLI searching and add no new
orchestrator. The bounded M1 diagnosis leaves its root cause unassigned; primary
selected the local readiness route above.

## Historical local inventory, 2026-10-10 before cloud setup

These are local checks, not an executed cloud smoke test. Commands below were
read-only; actual exit codes are shown where a process completed.

| Check, 2026-10-10 | Actual outcome | What it establishes |
| --- | --- | --- |
| `codex --version` | Exit 0; `codex-cli 0.162.1` | Installed local CLI version only. |
| `codex login status` | Exit 0; `Logged in using ChatGPT` | Local authentication, not cloud execution/model access. |
| `codex cloud list --json --limit 5` | Exit 0; `tasks: []`, `cursor: null` | No tasks returned in this account/CLI view. |
| `codex cloud` in an owned PTY; picker opened with `o`, cancelled and quit with `q` | Exit 0; after loading, only `All Environments (Global)` visible; no environment selected or task started | None visible through this CLI; newer UI environments/account permissions remain unknown. |
| Chrome-devtools `list_pages` and Playwright tabs | Both failed: missing `/opt/google/chrome/chrome`; tool errors, no shell exit code | Browser UI inspection unavailable; no browser installation or OAuth change attempted. |
| `/home/chichieh/.nvm/versions/node/v22.16.0/bin/node --version` | Exit 0; `v22.16.0` | First local runtime exists. |
| `/home/chichieh/.nvm/versions/node/v24.15.0/bin/node --version` | Exit 0; `v24.15.0` | Second local runtime exists. |
| `python3 --version` | Exit 0; `Python 3.11.7` | Local Python exists; cloud Python remains unknown. |
| Fresh documentation worktree dependency inspection | Initially no `adapters/openai/node_modules` or `tools/plugin-validation/node_modules` | Runtime binaries do not establish dependency readiness. |
| `git fetch origin main` | Exit 0; main `523b8bfd88f8de280b85277e735ca1fb747379d8`; local main clean | Public repository visibility and local base only. |
| `gh pr list --repo Cairn-ink/cairn-memory --state open --limit 30 --json number,title,headRefName,headRefOid,baseRefName,isDraft` | Exit 0; #387–389 OPEN with expected heads | Existing stack visibility, not cloud checkout readiness. |

Unverified at that earlier inspection: a published usable current cloud
environment, cloud-executed tests,
GPT-6.1 Sol selection, network/secrets configuration, CPU/RAM/disk fit, concurrency,
quotas and remaining cloud allowance. No local `.env`, private source, operational
ledger or credential is uploaded. Do not connect the private `cairn-wiki` repo or
production systems. Its unrelated untracked files remain outside this change.

[Current cloud documentation](https://learn.chatgpt.com/docs/cloud) and
[cloud environments](https://learn.chatgpt.com/docs/environments/cloud-environments)
describe isolated task workspaces based on published environments. Current cloud
differs from Legacy. Repository instructions/skills can travel with the checkout;
local personal skills do not automatically sync. Packets must be self-contained.
Creating/publishing an environment can execute setup; network and secrets are
environment settings. Those actions were outside this historical inventory;
the later setup/publication is recorded separately above. Cloud tasks can
continue while the laptop sleeps; the local coordinator and budget ledger do not
move automatically. An empty CLI task list is not an environment-readiness test.

## Milestones, owners and stop conditions

| Milestone | Owner / dependency | Deliverable and pass condition | Fail / stop condition |
| --- | --- | --- | --- |
| 0. Historical inventory and completed setup/publication | Primary; local/repo/official-doc and authorized cloud setup access | Dated inventory retained; setup command evidence and Only-me publication recorded above | Setup failures remain evidence; setup success alone does not pass M1. |
| 1. New offline cloud smoke, FAILED | Primary; published public-repo environment and GPT-6.1 Sol High UI selection | Exact checkout/imports verified, but both runtimes failed main and lifecycle suites; bounded diagnosis completed with cause unassigned | Cloud M2 BLOCKED; clean scratch and setup passes do not waive the gate; no further Cloud probe this turn. |
| 1L. Local fallback readiness, accepted PASS | Primary; exact #389 SHA and both pinned local runtimes | All 12 commands exited 0 with 669/25/30 assertion totals per runtime, clean owned scratch and independently matched logs/inventories | This is separate from the main-based documentation gates and does not pass or waive Cloud M1. |
| 2. Exactly two bounded A/B packets: Cloud BLOCKED / local ready for dispatch | A: candidate author; B: independent challenger; accepted 1L plus frozen seam, packets and disjoint paths | Primary may dispatch exactly two local GPT-6.1 Sol High branches with scoped prototypes/tests, command evidence and resource reports; none dispatched as of this record | Cloud dispatch stays blocked independently; scope expansion, guessed API, test contamination, model substitution or two unsuccessful correction rounds stops/re-scopes the packet. |
| 3. Preregister and verify fair comparison | Primary local integrator and one central paid evaluator; accepted offline candidate/challenges, independent review and fresh ledger preflight | Frozen protocol and same-batch outcomes, including all failures, coverage/safety/resources; unchanged advancement gates pass | Unfrozen comparator, safety unknown, unaffordable reservation or failed resource gate blocks execution/advancement. |
| 4. Larger/official/installed-host evidence, later | Primary; M3 plus separately scoped authority, fresh cases and prerequisites | Independently frozen larger cohort, official/Mem0 and installed Hermes evidence with honest limits | No automatic progression; missing cases, native containment, host/resource fit or budget stops the relevant gate. |

Cloud M1 was dispatched at 22:48 and failed; completed setup does not substitute
for this new task. Cloud M2 stays blocked. The local fallback's own fixed-#389
readiness gate passed, allowing the two local packets; it neither passes nor
waives Cloud M1. M2 is two work packets, not an expanding worker pool.
Record observed slot limits and
queue/runtime usage before assuming parallel capacity. Keep primary integration,
review and ledger work local; cloud workers cannot spend on evaluated-model APIs.

## Shared packet contract, frozen before algorithm dispatch

Requested author/challenger model: actual GPT-6.1 Sol High. The M1 UI allows this
selection, but backend inference metadata is not exposed. Record the supported
selection and its evidence for each task. Stop and report an
unavailable choice; do not silently downgrade. The evaluated model is a separate
protocol variable, not whichever model authors the candidate.
For the local fallback, primary must use and record the actual model/effort
controls for both workers; a model name in a packet does not establish execution.

Every packet must include its fixed SHA, named branch, allowed NEW files,
exclusions, dependencies, acceptance cases, runtime/model selection and exact
commands. Pin the experiment SHA above after verifying its public availability.
Use branches `experiment/cloud-retrieval-v1-candidate` and
`test/cloud-retrieval-v1-challenge`; workers must start from the same SHA.
The primary decision below freezes shared seam v1 before either codes. B tests
that contract; A implements it. Reuse existing interfaces, without a new service
or large API.
Do not edit core/defaults, capture, provider/transport, budget code, sealed cases,
reports, existing test expectations, CI or dependencies to obtain a green result.
Unexpected shared-file needs return to primary before edits.

### Shared seam v1: primary-frozen decision

The NEW `evaluation/experiments/cloud-retrieval-v1/candidate.mjs` exports:

- `assembleComplementarySourceSet(input, rankOutput)`: a pure synchronous
  compiler returning deeply immutable `{ output: { refs }, diagnostics }`.
- `createComplementarySourceSetModel(model)`: the same frozen model-port/factory
  shape as `evaluation/architecture/source-linked-evidence-model.mjs` at exact
  #389 SHA `52640f2278291d42e79597e542e2f039ccf6b29f`. Preserve every other model
  port and make exactly one unchanged underlying rank call.

Preserve that existing seam's descriptor-safe validation, typed errors,
cancellation checks and time-of-check/time-of-use checks. Input query is nonempty
and at most 4,000 characters; limit is 1–12; candidates number at most 36. Preserve
the exact supplied namespace, memory ID, revision, receipt role and excerpt.
Output contains distinct allowed references only, each with exactly
`namespaceIndex`, `memoryId`, `revision`, and at most `limit` references. The rank
request shell remains `system`, `input`, `maxOutputTokens: 1024`, `signal`;
serialized input stays at most 6,000 tokens, output at most 1,024 tokens and the
model context window at least 8,192. Existing byte and structural limits remain.

A validated empty rank yields empty output. Preserve every original ranked seed
in order, and add references only from the same namespace as a ranked seed.
When there is no spare limit, return unchanged seeds. Diagnostics include at least
a `strategy` string, exact `addedRefs` references and
`semanticCoverage: 'unassessed'`. Do not classify truth, adoption, authorization
or semantic validity, or edit roles, provenance, sources or state. No external
reads, storage, extra model calls or expanded budget are allowed. A explores one
bounded complementary-retention strategy for pools above six and long-history
distractors; this contract does not choose that strategy for the worker.

Return a scoped diff/branch and a concise report containing actual exits,
pass/fail/skip/cancel counts, command logs, owned temporary-directory cleanup,
model/runtime, elapsed time, exposed token/cost/allowance data and peak resources.
Mark unavailable measurements unknown; no inferred spend from model labels.
Derive changed-file lists twice independently, diff them and print their count.
Never claim success from the last command of a pipe; use `pipefail` or explicit
exit capture. No credential fragments or source answer bodies in public reports.

### Packet A: one evaluation-only candidate

Allowed NEW files only:

- `evaluation/experiments/cloud-retrieval-v1/candidate.mjs`
- `evaluation/experiments/cloud-retrieval-v1/candidate.control.test.mjs`
- `docs/plans/cloud-retrieval-v1-candidate.md`

Explore one bounded strategy for complementary source retention when the real
rank-visible pool exceeds six, including long-history distractors. Reuse existing
core and evaluation seams; do not invent a service or enable a production default.
Selection can use only model-visible source inputs, never evaluator gold/anchor
identities. Keep namespace/revision/source-role/empty-evidence boundaries intact
and verify zero extra reads, model calls or storage and unchanged token ceilings.
A cannot write B's fixtures, rubric or acceptance tests, and its own controls
do not constitute acceptance.
Return red-capable controls and a bounded recommendation, including failures.

### Packet B: independent challenge and acceptance evidence

Allowed NEW files only:

- `evaluation/experiments/cloud-retrieval-v1/challenge.test.mjs`
- `evaluation/experiments/cloud-retrieval-v1/fixtures/source-only.json`
- `docs/plans/cloud-retrieval-v1-challenge.md`

Freeze synthetic source-only cases, required invariants and evaluator rubric
before seeing A's results. Cover irrelevant noise, temporal applicability, scope
conflicts, changed premises, proposal versus adoption, empty evidence, pools above
six and long histories, including currentness boundaries. Exercise real core
recall and real answer packing, not only a compiler's declared diagnostics.
The ordinary unexpanded rank must miss complementary evidence in at least one
targeted negative-control case. A missing candidate cannot pass through a
fallback shim or skip: B may verify fixtures and negative controls while recording
candidate-dependent checks as PENDING integration; primary's full integrated
suite must execute all checks. B does not author A's algorithm or modify existing
sealed rubrics to accept it. Keep file ownership disjoint; integrate sequentially locally.

Public repository tests are development challenges, not blind holdout. Restricted
expected answers and nonauthor review are required for later blind judging;
separate task workspaces alone do not guarantee access privacy. Freeze/hash the
fixture/rubric before unblinding, keep oracle answers out of model-facing inputs,
and record exposure. If restricted handling is unavailable, the blind claim is
blocked; do not rename a public test as a holdout.

## Runtime setup and exact Cloud M1 / local readiness / A/B checks

Inspect the selected SHA's `CONTRIBUTING.md`, package scripts and dependency locks
first. Pin Node 22.16.0 and 24.15.0 in the cloud setup, retaining version/digest
evidence. Install Python 3 for LongMemEval sidecar checks. For the smoke/lifecycle
prerequisites, inspect `ls -ld adapters/openai/node_modules` and
`ls -ld adapters/mcp/node_modules` for shared symlinks before installing both locked
isolated sets with `npm ci --prefix adapters/openai` and
`npm ci --prefix adapters/mcp`. Do not remove a shared install. No generic root
`npm ci`, invented root TypeScript gate or broad dependency replacement.
The locked plugin validator is isolated maintainer tooling required for applicable
delivery gates by `CONTRIBUTING.md`, not a product dependency or cloud capability.

Run these literal commands once under each pinned Node PATH; the final packet
records the resolved executable/PATH and actual version before the commands:

```sh
node --version
npm test
npm run validate
NODE_DISABLE_COMPILE_CACHE=1 npm run test:workspace-lifecycle
node tools/testing/run.mjs evaluation/architecture/test/source-linked-evidence-model.test.mjs evaluation/architecture/test/seed-gated-source-set.test.mjs
npm run validate --prefix tools/plugin-validation
```

After A/B exist, each packet adds its own named test command; primary runs both:

```sh
node tools/testing/run.mjs evaluation/experiments/cloud-retrieval-v1/candidate.control.test.mjs
node tools/testing/run.mjs evaluation/experiments/cloud-retrieval-v1/challenge.test.mjs
npm run test:longmemeval
npm run demo:longmemeval-ingestion
npm run demo:longmemeval-comparison
npm run demo:longmemeval-public
```

Use the owned runner and synthetic stores, close resources before removal and
retain failed cleanup evidence. Cloud M1 and local readiness must each verify
owned cleanup on successful and intentionally failing subprocesses on both Nodes.
Missing prerequisites/essential skipped cases
fail readiness. No historical-directory sweep. Native Mem0's pinned Python roots,
Linux `bwrap` and installed-host gates stay on the primary side; a cloud offline
smoke is not proof of their readiness. Read any operational script instructions
before use; these test commands do not authorize production operations.

## Fair comparison, accounting and acceptance

Preregister the exact intervention and fresh challenge mix before scored calls.
The current suggested seed comparison is A ordinary / B prior combined / C seed
combined, on identical cold captured states with the same model, answer packing,
limits, rubric and balanced arm order. It is not yet accepted, frozen or executed.
Keep C–A's unchanged net-correct gain of at least three plus increased targeted
coverage, no increased unsupported/stale use, no newly failing severe case and
all resource gates. Safety unknown blocks advancement. C–B is incremental
ablation evidence, not a substitute. Historical 18/22 scores are not concurrent
comparators. Do not lower gates to fit a previous 22/24 ceiling. If A's new
strategy replaces C, primary freezes its exact arm identity before execution.

Cloud Codex allowance and paid evaluated-model API costs are separate. Cloud
quota/remaining allowance is unknown. Historical campaign authorization is
US$400 cumulative with US$30 protected; only a fresh preflight of the original
authoritative local ledger establishes today's available reservation. Historical
balances do not. One central local paid evaluator owns all guarded calls and
reconciliation; no copied/forked operational ledger, refunds, resets or retries
of closed runs. Conservative cost and request/resource limits must fit before
dispatch. Future protocol gates do not waive existing standing grants or expand
their scope; new authority is needed only for work beyond them.

Next action after accepted local readiness: dispatch exactly two local GPT-6.1 Sol
High packets using the frozen seam and disjoint files above. Cloud M1 remains
FAILED and Cloud M2 BLOCKED; setup passes, local documentation gates and the local
fallback do not waive those cloud results. No algorithm workers had been
dispatched as of the dated evidence record above; no further Cloud/CLI probing
is planned this turn.

Coordinate through this plan, bounded branches/PRs and retained result documents.
Primary directly inspects the combined diff and reruns key gates. Separate
nonauthor Standards and Spec reviewers use the same fixed candidate in independent
read-only contexts; neither sees the other's findings before submission. Stop
and report blockers rather than improvise permissions, models or accounting.
Delivery requires primary's affected checks on the final committed candidate,
passing independent nonauthor Standards and Spec reviews, and all required CI
passing for the latest remote PR head, which must equal the reviewed candidate.
Any content, base or head change invalidates affected prior gates and requires
both reviews again. A push alone is not delivery; a real blocker leaves the PR
draft. No release, production operation, automatic promotion or merge follows
this plan.
