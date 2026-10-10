# Codex Cloud: bounded algorithm exploration and independent verification

Status: proposed plan; read-only local environment inventory completed on
2026-10-10 (Asia/Taipei). No cloud task, environment creation/publication or
paid evaluation has run for this plan. Owner: primary DRI.
Document branch: `docs/codex-cloud-algorithm-plan`.
Fixed documentation base: `523b8bfd88f8de280b85277e735ca1fb747379d8` (public main).

先把力氣放在 Cairn 的 retrieval 和回答品質，長期目標仍是讓 Hermes 和其他
harness 用得到輕量、可靠的記憶。雲端先分成兩個有明確範圍的任務，一個試演算法，
另一個獨立找反例；整合和付費評估由本機統一負責。目前確認了本機登入與 CLI
查詢，但還沒驗證雲端環境能跑測試，也沒確認 GPT-6.1 Sol 是否可選。

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
from the prospective experiment stack. Proposed experiment base is #389 head
`52640f2278291d42e79597e542e2f039ccf6b29f`; verify it again before dispatch.
A default-main cloud checkout without that stack is a failed prerequisite.

## Environment inventory: observed versus unverified

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

Unverified: a published usable current cloud environment, cloud-executed tests,
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
environment settings. Those actions are outside this inventory. Cloud tasks can
continue while the laptop sleeps; the local coordinator and budget ledger do not
move automatically. An empty CLI task list is not an environment-readiness test.

## Milestones, owners and stop conditions

| Milestone | Owner / dependency | Deliverable and pass condition | Fail / stop condition |
| --- | --- | --- | --- |
| 0. Read-only inventory, now | Primary; local/repo/official-doc access | This plan and dated evidence; every unknown labelled | Missing visibility stays unknown; no setup or task dispatch to fill the gap. |
| 1. Future offline cloud smoke | Primary; future environment/setup authority, published public-repo environment and verified model choice | One isolated task at exact experiment SHA; pinned runtimes/imports/offline tests and owned cleanup on success plus intentional failure pass without provider keys; record capacity/quotas | Wrong checkout, unavailable requested model, missing imports, cleanup failure or unknown resource fit blocks algorithm dispatch. |
| 2. Exactly two bounded cloud packets | A: candidate author; B: independent challenger; M1 plus primary-frozen shared seam, packets and disjoint writing paths | Two branches with scoped prototypes/tests, exact command evidence and resource reports; primary integrates locally | Scope expansion, guessed API, test contamination, model substitution or two unsuccessful correction rounds stops/re-scopes the packet. |
| 3. Preregister and verify fair comparison | Primary local integrator and one central paid evaluator; accepted offline candidate/challenges, independent review and fresh ledger preflight | Frozen protocol and same-batch outcomes, including all failures, coverage/safety/resources; unchanged advancement gates pass | Unfrozen comparator, safety unknown, unaffordable reservation or failed resource gate blocks execution/advancement. |
| 4. Larger/official/installed-host evidence, later | Primary; M3 plus separately scoped authority, fresh cases and prerequisites | Independently frozen larger cohort, official/Mem0 and installed Hermes evidence with honest limits | No automatic progression; missing cases, native containment, host/resource fit or budget stops the relevant gate. |

M1 is a future readiness check, not permission to create/publish now. M2 is two
work packets, not an expanding worker pool. Record observed slot limits and
queue/runtime usage before assuming parallel capacity. Keep primary integration,
review and ledger work local; cloud workers cannot spend on evaluated-model APIs.

## Shared packet contract, frozen before any dispatch

Requested author/challenger model: actual GPT-6.1 Sol, with supported reasoning
effort recorded. Cloud availability is not confirmed. Stop and report an
unavailable choice; do not silently downgrade. The evaluated model is a separate
protocol variable, not whichever model authors the candidate.

Every packet must include its fixed SHA, named branch, allowed NEW files,
exclusions, dependencies, acceptance cases, runtime/model selection and exact
commands. Pin the experiment SHA above after verifying its public availability.
Use branches `experiment/cloud-retrieval-v1-candidate` and
`test/cloud-retrieval-v1-challenge`; workers must start from the same SHA.
Before either codes, primary freezes the minimal shared import/export seam:
existing model port/factory shape, result fields and limits. B tests that contract;
A implements it. Reuse existing interfaces, without a new service or large API.
Do not edit core/defaults, capture, provider/transport, budget code, sealed cases,
reports, existing test expectations, CI or dependencies to obtain a green result.
Unexpected shared-file needs return to primary before edits.

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
and record any extra reads, calls, tokens or storage. A cannot write B's fixtures,
rubric or acceptance tests, and its own controls do not constitute acceptance.
Return red-capable controls and a bounded recommendation, including failures.

### Packet B: independent challenge and acceptance evidence

Allowed NEW files only:

- `evaluation/experiments/cloud-retrieval-v1/challenge.test.mjs`
- `evaluation/experiments/cloud-retrieval-v1/fixtures/source-only.json`
- `docs/plans/cloud-retrieval-v1-challenge.md`

Freeze synthetic source-only cases, required invariants and evaluator rubric
before seeing A's results. Cover irrelevant noise, temporal applicability, scope
conflicts, changed premises, proposal versus adoption, empty evidence, pools above
six and long histories. Exercise real source packing and adverse controls, not
only a compiler's declared diagnostics. Demonstrate a failure when the tested
behavior is disabled. B does not author A's algorithm or modify existing sealed
rubrics to accept it. Keep file ownership disjoint; integrate sequentially locally.

Public repository tests are development challenges, not blind holdout. Restricted
expected answers and nonauthor review are required for later blind judging;
separate task workspaces alone do not guarantee access privacy. Freeze/hash the
fixture/rubric before unblinding, keep oracle answers out of model-facing inputs,
and record exposure. If restricted handling is unavailable, the blind claim is
blocked; do not rename a public test as a holdout.

## Runtime setup and exact future checks

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
npm run test:workspace-lifecycle
node tools/testing/run.mjs evaluation/architecture/test/source-linked-evidence-model.test.mjs evaluation/architecture/test/seed-gated-source-set.test.mjs
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
retain failed cleanup evidence. M1's existing workspace-lifecycle gate verifies
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

Next readiness action: verify a published current environment's name/link and
public-repo checkout/settings in an available UI, then scope M1. The current CLI
shows no concrete environment and browser inspection here is unavailable; this
is an unverified prerequisite, not proof that cloud cannot work on the account.

Coordinate through this plan, bounded branches/PRs and retained result documents.
Primary directly inspects the combined diff and reruns key gates. Separate
nonauthor Standards and Spec reviewers use the same fixed candidate in independent
read-only contexts; neither sees the other's findings before submission. Stop
and report blockers rather than improvise permissions, models or accounting.
No release, production operation, automatic promotion or merge follows this plan.
