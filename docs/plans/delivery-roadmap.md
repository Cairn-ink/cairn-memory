# Shared memory layer — delivery plan

Current baseline: merged PR #16, `5f17b4399ffdd6d7f5b1ee04e1fb106a2af163a9`.
The original #8 baseline and historical checkpoint ledger below are retained
as history, not the current merge status.
This is an execution plan, not a claim that the remaining features have shipped.
The primary assistant is the engineering DRI; the repository owner retains
merge, production, release and external-publication decisions.

## Plan acceptance

- P1: Record the product goal, verified baseline and missing work without calling
  mock success semantic quality or a source library a standalone MCP service.
- P2: Define five remaining delivery stages with bounded work packages, explicit
  owners, dependencies and observable exit criteria, including inferred capture.
- P3: Define delegation, primary verification, independent Standards/Spec review,
  failure handling and status transitions. A PR is not equivalent to a merge.
- P4: Separate offline work from gates needing credentials, paid model runs,
  external publication, third-party approval or production authorization.
- P5: Identify the next package and retain receipts, namespace isolation,
  correction/forget safety and the single-public-engine rule in every stage.

## Goal and baseline

### Current candidate checkpoint (2026-09-09)

These are reviewed development candidates, not newly merged releases. The owner
retains all merge, publication and deployment decisions. The historical planning
tables below are retained; this checkpoint overrides their old progress labels.

| Package | Current evidence / remaining gate |
| --- | --- |
| 1 — Live provider | [PR #17](https://github.com/Cairn-ink/cairn-memory/pull/17): actual synthetic capture/classify/recall/reopen/correct/forget passed |
| 2 — Evaluation | [#19](https://github.com/Cairn-ink/cairn-memory/pull/19), [#21](https://github.com/Cairn-ink/cairn-memory/pull/21), [#23](https://github.com/Cairn-ink/cairn-memory/pull/23) retain default-model failures. [#27](https://github.com/Cairn-ink/cairn-memory/pull/27) explicit experimental profile passed 36/36 frozen runs after independent agent labels: 25/25 source-supported claims, 24/24 facts, 44/45 recall, 44/44 relevance; default GPT-4.1 mini remains failed |
| 3 — Thin MCP | [PR #18](https://github.com/Cairn-ink/cairn-memory/pull/18): actual stdio lifecycle/isolation/revisions, same core |
| 4 — Installation | [PR #24](https://github.com/Cairn-ink/cairn-memory/pull/24): inspected archive, fresh installed subprocess and actual-model restart/recall passed; no npm publication |
| 5 — Hermes | [PR #25](https://github.com/Cairn-ink/cairn-memory/pull/25): native MemoryManager lifecycle and actual-model two-session recall passed on Linux CLI; not interactive chat or a released compatibility claim |
| 6 — Launch kit | [#26](https://github.com/Cairn-ink/cairn-memory/pull/26): local-first documentation and independent no-key onboarding verified; source/profile artifact integration is a separate candidate, with no human-adoption or broad-promotion claim |
| 7a — Private facade | Under development; not complete |
| 7b — Production provider/quota/deadline | Not complete; no production integration claim |
| 8 — Migration/rollback | Rehearsal not complete; only synthetic rehearsal may proceed without production approval |

Provider reference constraints in [#20](https://github.com/Cairn-ink/cairn-memory/pull/20)
corrected invalid placement references; the source-faithful prompt change in
[#22](https://github.com/Cairn-ink/cairn-memory/pull/22) did **not** reliably cure
over-inference. Do not remove that failure or relax the frozen rubric to declare
success. A sourced receipt and a relevant return do not establish entailment.

The installed lifecycle is evidence of the narrow memory loop, not a human-user
study. A subsequent real Hermes MemoryManager two-session sourced-recall probe
also passed, without claiming interactive model tool selection. Current
conservative paid-run reservation after the experimental profile probe and suite is
US$4.179912 of the approved US$5 ceiling, including failed runs, with US$0.820088
remaining; it is not an invoice. See the [exact profile ledger](extraction-model-profile.md#measured-evidence).
New paid experiments
must account for the remaining allowance and be recorded separately.

### Current checkpoint and next eight PR packages (2026-09-08)

The owner merged #10 and #12–#16. Core lifecycle, capture, conflict hints,
index rebuild and bounded recall continuation are implemented; the optional
OpenAI adapter has offline verification. This is not yet real-model quality
evidence or an independently installable MCP product.

| Order | Package | Exit gate |
| --- | --- | --- |
| 1 | [Live provider lifecycle](live-provider.md), in progress | Real capture/classify/recall/reopen/correct/forget, bounded spend and sanitized evidence |
| 2 | Frozen semantic/resource evaluation | Freeze numeric rubric before scored runs; three fresh-state repetitions, retain all failures, zero safety violations |
| 3 | Thin standalone MCP host | Real protocol calls to the same core, startup-bound authority, persistence and lifecycle safety |
| 4 | Install artifact and client matrix | Fresh-environment install and new-session recall; distinguish tested local stdio from unverified remote connectors |
| 5 | First ecosystem integration | Prefer Hermes after checking the current interface; real host test, disable/uninstall, distinguish manual install from official listing |
| 6 | Professional launch kit and PLG experiment | Accurate docs/demo/evidence/privacy/security and independent context-free onboarding; activation before stars |
| 7 | Private pinned-core adapter | Commercial behavior actually runs the same versioned public core, not a second engine |
| 8 | Private migration/rollback rehearsal | Synthetic legacy-data parity and failure recovery, no production mutation |

These are scoped planning packages, not promised GitHub PR numbers. Fixes may
need additional PRs. Package six targets a demonstrable standalone developer
product ready to propose for publication. Packages seven/eight establish shared
engine integration and rehearsal; actual production cutover remains a separate
approval and verification gate, not something completed by a plan or mock.

Evaluation fixtures and MCP interface design may start alongside live work.
After the basic live lifecycle passes, evaluation and MCP implementation may
advance concurrently; scored evaluation is a release-readiness gate, not a reason
to defer all transport work. Private adapter/rehearsal work can begin once the
core contract is stable; it does not depend on stars or publication.

Owner approved using the existing local OpenAI key with a US$5 first-test total
ceiling. Only the DRI performs paid calls, loading that key alone; never copy an
application environment or use a user database. Actual spend remains recorded
in the live acceptance evidence. Human feedback remains separate from agent
onboarding tests. No fixed ten-person alpha prerequisite, no guaranteed stars,
no automatic capture claim from MCP alone, no full UI or Moss prerequisite.

The detailed stages below supply invariants and historical package identifiers.
This current checkpoint overrides their historical status and strict ordering.

Deliver a lightweight, self-hostable open-source memory layer, not merely a
client for a private hosted service. MCP is the first adoption surface. A first
third-party host integration follows; commercial memory behavior eventually
consumes a pinned version of this same public core. Auth, quotas, billing and
hosted UI can remain private. Moss and shared/team knowledge are out of scope.

The product must remember with provenance, organize using MOCs, retrieve relevant
current evidence, and support inspection, correction and forgetting. No passive
capture claim comes from MCP alone: automatic capture requires an explicitly
installed hook/host integration and transparent data flow. A full web UI is not
a prerequisite; usable inspection and deletion are.

Merged implementation:

| Slice | Evidence | What it establishes |
| --- | --- | --- |
| S2a | [PR #6](https://github.com/Cairn-ink/cairn-memory/pull/6), [spec](s2-storage-contract.md) | Explicit lifecycle, receipts, revisions, inspection and SQLite persistence |
| S2b | [PR #7](https://github.com/Cairn-ink/cairn-memory/pull/7), [spec](s2-moc-placement.md) | Persisted MOC placement, bounded maps and injected classification |
| S2c | [PR #8](https://github.com/Cairn-ink/cairn-memory/pull/8), [spec](s2-fetch-recall.md) | Paged fetch, bounded selection/ranking and authoritative final recall snapshot |

At the baseline, 76 core tests pass on each of Node 22.16 and 24; 31 plugin tests
and all five CI jobs pass. These establish synthetic contracts, not measured
semantic quality, lightweight resource performance, standalone installation or
hosted migration. The released plugin still uses its configured hosted service.
The older draft engine PR #5 is not the delivery base.

At that baseline, low-level storage accepts inferred origin/confidence, but the public
contract admission is explicit-only; neither is automatic extraction with guarded
inferred admission. Inspection currently returns empty conflict links. Exact-content
collision errors are not contradiction tracking. These gaps are separate below.

## Delegation and progression

Use at most four concurrent agents: primary DRI plus bounded workers/reviewers.
Roles below are assignments to be instantiated when their prerequisites clear,
not claims that all workers are currently running.

- Engine worker: storage/lifecycle implementation in an isolated worker worktree.
- Adapter worker: model or host boundary implementation in its isolated worktree.
- Verification worker: independent synthetic cases, reproduction scripts or
  installation checks; never substitute a mock for real model/client evidence.
- Primary DRI: write acceptance first, pin interfaces/file ownership, integrate
  scoped changes, inspect diffs, run required gates and reproduce critical cases.
- Final Standards and Spec reviewers: fresh independent agents on the exact same
  fixed base and committed candidate; neither is its implementer. The two axes
  do not exchange findings before reporting.

Workers receive a concrete package, base SHA, allowed files, observable tests,
out-of-scope list and stopping condition. They return changed files, evidence and
limitations. A worker saying "done" is not acceptance. Keep implementation and
verification roles distinct; after workers finish, reuse concurrency capacity
for the two final reviewers while the primary prepares handoff evidence.

Per package:

1. Verify prerequisites on remote main; create a dedicated branch/worktree and
   tracked package spec. No unrelated primary-worktree edits.
2. Delegate bounded implementation and independent testing where useful.
3. Primary integrates and exercises the real changed path on synthetic data.
4. Run applicable CONTRIBUTING gates. Core changes run both Node versions, all
   relevant demos and CI; model/client changes additionally need real end-to-end
   evidence. Static inspection is not sufficient.
5. Freeze a local commit. Run both independent review axes. Fix actionable
   blockers, rerun affected gates, commit and re-review BOTH axes on final HEAD.
   Non-blocking suggestions stay explicit rather than disappearing from reports.
6. Push/open a scoped PR and verify the remote SHA/CI. Mark `ready_for_merge`,
   not `merged`. Report worktree, branch, SHA, evidence and limitations.
7. The owner has authorized stacked branches: after verification and both reviews,
   create the next dependent worktree from that fixed candidate without waiting
   for merge. Record the parent SHA/PR and target its branch for a focused diff.
   Only the owner merges; verify parent merges, retarget and rerun affected gates
   when the stack advances. Never self-merge, publish or deploy.

States: `not_started` → `in_progress` → `verified` → `ready_for_merge` → `merged`.
Use `blocked` with the exact failing check or missing authority. Failed acceptance
returns to implementation, not the next dependent package. Independent specs,
fixtures and diagnostics may proceed in parallel; dependency-sensitive delivery
uses merged main or the verified parent under the now-authorized stacked workflow.

This plan is followed during active work sessions; it does not create an
unattended scheduler. A new merge/continuation message resumes the next package.

## Five stages, thirteen initial work packages

Packages **1a–1e are merged** (#10, #12–#15); the offline portion of **2a is
merged** (#16). Live 2a acceptance is now in progress with authorized credentials
and a bounded test budget; later packages remain
**not_started**. The grouping is a planning baseline, not a
promise of exactly thirteen PRs; split packages further when scope/risk requires.

### 1. Complete the core lifecycle contract

| Package | Delegation and prerequisites | Exit evidence |
| --- | --- | --- |
| 1a — Admission claims and inferred commit | Engine worker + independent concurrency tests; requires #8 | Durable exact-namespace event/digest claims, active-lease exclusion, expiry takeover and old-token rejection; inferred memory/source commit and completion marker atomic; replay creates no duplicates; failure allows safe retry; suppression cannot be bypassed. Two-process and restart tests cover every transition. |
| 1b — Capture orchestration | Adapter worker owns injected extraction port; engine worker owns validated commit seam; requires 1a | Allowlisted synthetic messages produce bounded inferred memories with real source bindings. Model cannot invent receipt IDs or namespace. Extraction outside transactions, explicit empty/failure paths, idempotent retry and bounded batches. Classification success files accepted memory; classification failure leaves it inspectable and unfiled. |
| 1c — Conflict lifecycle | Engine worker + independent provenance/lifecycle tests; requires 1b | Revision-bound contradiction hints are inspectable and attributable, distinct from exact-content deduplication. Foreign/stale hints reject; hints never silently overwrite explicit truth. Correction/forget invalidate affected relations atomically; late failure leaves no partial state. |
| 1d — Index integrity and staged rebuild | Engine worker + corrupt-index tests; requires 1c's settled schema | Bounded generation build, resumable cursor, stale-build rejection, valid namespace/level/revision edges only; partial work never becomes authoritative. Crash/restart and injected late failure preserve the previous valid generation or return explicit unavailable. |
| 1e — Bounded retrieval continuation and contract closure | Adapter/orchestration worker + independent coverage tests; requires 1d | Relevant synthetic targets beyond the first map page become reachable under an explicit call/fetch/token budget; receipt continuation has no omissions/duplicates. Budget exhaustion stays explicit, including empty results. Final authoritative validation survives every traversal path. Complete an operation-to-test traceability matrix; no unimplemented contract operation is labeled complete. |

Before 1a coding, its spec freezes claim/commit/replay/error semantics and schema
migration behavior. Reuse existing public normalization, suppression, receipt and
revision invariants. Do not revive the old draft engine or copy private code.
Core stage tests use scripted model ports; actual semantic quality belongs to 2.

### 2. Real provider and quality evidence

| Package | Delegation and prerequisites | Exit evidence |
| --- | --- | --- |
| 2a — One real provider/tokenizer adapter | Adapter worker + counter/abort tests; requires 1e; protocol research may start earlier | Pin provider/model/tokenizer versions and dependency provenance. Demonstrate exact counter and request framing, output limits, error/timeout/cancellation behavior and no silent fallback. A synthetic capture → classify → recall → correct → forget cycle runs with the actual configured model. |
| 2b — Frozen semantic/resource evaluation | Verification worker authors fixtures; primary freezes rubric before runs; requires 2a | Independently authored corpus and reproducible runner; three fresh-state repetitions per frozen case, all failures retained. Report extraction/source correctness, organization, retrieval relevance, unrelated queries, changed/forgotten facts, isolation, latency, token use, peak memory and dataset size. |

The 2b package spec must freeze corpus, positive/negative denominators and numeric
quality/resource thresholds BEFORE any scored runs. Until that spec is committed,
quality thresholds are undecided, not passed. Safety gates are non-negotiable:
zero cross-namespace exposure, invented provenance or forgotten-revision emission
in the frozen suite. No successful average can hide a safety failure. Repeat
after fixes and report all repetitions; no cherry-picked demo or competitor claim.

Provider choice and the paid-run ceiling must be recorded before network runs.
If suitable authorized credentials/budget are unavailable, finish offline adapter
tests but mark real-model acceptance blocked; ask only for that missing input.
Never inspect unrelated browser sessions or copy credentials into the repo/logs.

### 3. Standalone MCP and installation

| Package | Delegation and prerequisites | Exit evidence |
| --- | --- | --- |
| 3a — Thin MCP host | Adapter worker + protocol/authority tests; requires 2b; transport spec may proceed earlier | Explicit remember/recall/inspect/correct/forget map to the same core. Owner/read-set binding comes from trusted startup/auth, not model arguments. Real MCP client/server tool calls exercise isolation, errors and persistence, not just direct JavaScript calls. No extra extraction/retrieval engine in the host. |
| 3b — Reproducible install and client matrix | Packaging worker + clean-environment tester; requires 3a | From documented installation, a fresh environment stores a memory, restarts, recalls it in a new session and inspects/forgets it without a Cairn hosted account. Record exact client/OS/version/transport and evidence. Separate local stdio support from remotely reachable authenticated connector support; no untested ChatGPT/Claude/Codex compatibility badge. |

An npm/npx wrapper is a possible distribution choice, not proof of a plugin or
passive capture. Decide distribution in 3b based on an actually tested install
path and upgrade behavior. Packaging can be verified locally; registry release,
public endpoint deployment and account authorization are separate approval gates.
Clients that require remote transport remain explicitly unsupported until tested.

### 4. Developer launch and first ecosystem integration

| Package | Delegation and prerequisites | Exit evidence |
| --- | --- | --- |
| 4a — First host integration | Adapter worker + fresh-session tester; requires 3b | Choose one of Hermes/OpenClaw after checking its current third-party interface. A real host session loads Cairn, writes/recalls/forgets memory and preserves namespace binding; uninstall/disable behavior documented. State whether install is manual, submitted upstream or actually listed. Third-party approval is not our acceptance evidence. |
| 4b — Professional release and PLG experiment | Documentation/packaging worker + context-free onboarding tester; requires 4a and stage 2 evidence | Accurate quickstart, architecture/data flow, privacy/limits, runnable example, troubleshooting, security/contribution paths, dependency/license provenance and upgrade guidance. A tester without project history completes first-memory → new-session-recall → inspect/forget from docs alone. Verify release artifact before proposing publication. |

Freeze the launch experiment in 4b: channels, observation window, activation
definition (first write + successful later-session recall), feedback and adoption
signals. Stars are a secondary observed metric, never an engineering gate or a
guaranteed result. Collect only consented, content-free signals; no hidden core
telemetry or conversation harvesting. Private alpha recruitment is useful but
not a fixed ten-person prerequisite. Outreach drafts may be prepared; sending,
publishing posts/releases or upstream submissions require scoped authorization.

Stages 1–4 reach the intended standalone developer product. They do not claim
that all clients or both ecosystems are supported or that commercial cutover has
already happened. A web dashboard and Moss are not launch prerequisites.

### 5. Commercial service consumes the public engine

| Package | Delegation and prerequisites | Exit evidence |
| --- | --- | --- |
| 5a — Pinned-core adapter and migration rehearsal | Private-repo engine/host workers + independent migration tester; requires stages 1–4 and existing hosted contracts | On synthetic legacy datasets, stage into a fresh store; verify counts, receipts, namespaces, tombstones/suppression and replay policy. Legacy events lacking required identity/digest semantics need explicit reject/quarantine/non-replayable policy, not invented guarantees. Host adapter preserves wire contracts and runs core behavior without a second engine. Failure keeps old authority intact; rollback rehearsed. |
| 5b — Approved cutover and parity audit | Primary coordinates; independent parity verifier; requires 5a and explicit production approval | Record approved target/version, backup/rollback and stop conditions. Run authorized deployment/migration, verify actual pinned core in service and parity checks, then confirm deprecated engine paths are no longer authoritative. No deletion of old stores without separate recoverability decision. |

Stage 5 detailed operational specs stay in the authorized private repository;
never publish user datasets, credentials, private prompts or sensitive deployment
details in this public plan. Keep commercial UI, auth, quotas and billing outside
the engine. Completion requires actual verified shared-core consumption, not a
dependency added to package.json while the private engine still runs.

## Next action and evidence ledger

Package 1a merged in [PR #10](https://github.com/Cairn-ink/cairn-memory/pull/10)
at `b18db1590e15d2190e0cba8482fe2278e9580567`.
Package 1b is implemented against that fixed base; its
[checkpoint](capture-implementation.md) records the frozen C01–C13 acceptance.
Primary integrates separate engine/test workers and verifies both runtime versions.
Capture [PR #12](https://github.com/Cairn-ink/cairn-memory/pull/12) is ready for
owner merge at `45bf62f801c340e82700780bc6c497b661452825`: 106 core tests and five
demos pass on each runtime, 31 plugin tests and all five CI jobs pass; independent
Standards and Spec each report zero findings. This ledger does not claim it merged.
Conflict [PR #13](https://github.com/Cairn-ink/cairn-memory/pull/13) follows #12 at
`c9295f4ad9533fdf91d299703a85f3a4b2af94e4`: 145 core tests and six demos pass on
each runtime, 31 plugin tests and all five CI jobs pass; independent Standards
and Spec each report zero findings. It is not marked merged here.
Index [PR #14](https://github.com/Cairn-ink/cairn-memory/pull/14) follows #13 at
`d91c60651c3d224eee5e8154a4eb6ab6ca27ba42`: 162 core tests and seven demos pass on
each runtime, 31 plugin tests and all five CI jobs pass. Independent review found
an initial unbounded SQL reference scan; the final bounded-scan fix passed both
axes with zero findings. It is not marked merged here.
Package **1e** follows that verified parent; its [acceptance](recall-continuation.md)
freezes continuation budgets and the [contract inventory](core-contract-inventory.md).
Recall [PR #15](https://github.com/Cairn-ink/cairn-memory/pull/15) is ready for
owner merge at `2a97af2b4fb1fe8e4277954143a840c6c7135e0b`: 174 core tests and
eight demos pass on each runtime, 31 plugin tests and all five CI jobs pass.
Independent Standards and Spec each report zero findings; Spec additionally
ran 30 recall/continuation/fetch tests. It is not marked merged here.

The [2a offline subpackage](openai-provider.md) follows that verified parent.
Its adapter/tokenizer/transport fixtures are separate from live acceptance.
This historical offline checkpoint did not include an authorized key or paid-run
ceiling. Those are now authorized as recorded above; live outcomes belong in the
[live acceptance evidence](live-provider.md). No downstream completion or general
model-quality claim follows from the offline checkpoint.

When a package advances, record: package/status, fixed base and candidate SHA,
implementation owner, primary verification commands/results, Standards findings,
Spec findings, remote PR/CI, merge SHA, remaining risks and next eligible package.
When genuinely blocked, record the exact dependency and smallest owner action
needed. Do not replace this ledger with undocumented conversational memory.
