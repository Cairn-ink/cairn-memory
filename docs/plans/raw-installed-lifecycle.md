# Installed Raw / Memory / Card lifecycle

Status: primary combined local gates pass; exact-commit review and CI remain pending.
Started 2026-10-22. Fixed base:
`9623cea3e0696aeb6bfb1177a4927781b46f34f5`, ready/unmerged PR #466.
Worktree: `cairn-memory-worktrees/raw-installed-lifecycle`.
Branch: `feat/raw-installed-lifecycle`; delivery target remains `main` and includes
unmerged dependencies. No merge is authorized by this packet.

## Outcome and boundary

Verify selected Step 4 flows in one installed engine/store: actual foreground
capture creates Raw and Memory provenance; retained-source MCP and explicit
terminal intent create an authored Card; correction, forgetting, source deletion,
rearm and cold restart preserve the intended support boundaries.

This closes an integration-evidence gap between previously separate fixtures.
It does not add a new algorithm or automatically turn Memory into Cards. Raw,
Memory and Cards remain engine-owned; the product presents/authenticates that
engine. Scripted model responses and synthetic client formats establish
mechanics, not extraction quality, real-client activation or a competitive score.

Authority is the October 21 local-development exception in
[the Raw contract](raw-layer-contract.md#local-development-exception-approved-2026-10-21).
No real transcripts/configuration/database/credentials, paid calls, product pins
or flags, operational migrations, native-client activation, releases, deployments
or merges. G1/G2/H6 and product joint acceptance remain separate.

## Ownership and finite scope

One non-primary implementation worker, actual `gpt-6.1-sol` / `high`, owns:

- `packaging/test/raw-installed-lifecycle.test.mjs`
- `packaging/test/fixtures/raw-installed-lifecycle.mjs`
- the bounded evidence/limitations entry in `docs/limitations.md`

The primary owns this plan, the checkpoint in `raw-local-v1-completion.md`,
independent acceptance, integration decisions and delivery. This is five scoped
repository paths; verify that roster independently before commit. No runtime,
schema, manifest, lockfile, dependency or version changes are expected. Existing
artifact discovery already includes the new suite. A reproduced runtime defect
requires a documented bounded rescope and affected gates before implementation.

Reuse the existing installed-host, one-shot, retained-MCP and fake-HTTP drivers.
Their convenience methods sometimes assume one conversation/default Codex; do
not import those assumptions. Application imports must resolve inside the real
generated/offline-installed archive, never back to source checkout. Real SQLite,
stdio children and a synthetic controlling PTY are required. No direct SQL
seeding of a claimed Memory, receipt or source relationship; inspection may be
read-only SQL. Conversation deletion uses installed trusted core, not a new tool.

## Frozen acceptance

Run three independent scenarios for each client, six top-level tests total:

- **A**: capture, provenance, zero automatic Cards/notes, explicit Raw-backed
  authored draft, generic MCP confirmation refusal, real PTY confirmation and
  cold source/Card readback.
- **B**: captured-Memory correction/forget with Raw retained, exclusions and
  pending-draft cancellation; disjoint-source control; explicit pause/re-enable/
  rearm and future capture; restart and replay without restoring old support.
- **C**: two actual conversations support one Memory under explicit matching-
  evidence opt-in; delete one, preserve surviving Memory support and private
  authorship, exclude unsupported current Card, restart and replay deletion.

| ID | Required observable | Scenario |
| --- | --- | --- |
| IL-01 | Offline archive installs; input traverses installed foreground host/worker/core, with exact saved Raw, completed admission and actual receipt lineage. No seeded Memory/source relation. | A/B/C |
| IL-02 | Ordinary capture creates no Card/note. Core-resolved Raw supports an explicit authored draft; generic MCP approval refuses; actual synthetic PTY approval and cold readback succeed without another Memory/note/provider request. | A |
| IL-03 | Correct/forget actual captured Memory while Raw stays. Old exact refs and fresh coarse resolution cannot revive excluded original anchors. Pending drafts purge; confirmed authored body remains private but is not current evidence. Disjoint retained source remains usable after restart. | B |
| IL-04 | Explicit pause/re-enable/rearm skips paused text, preserves session identity/ordinal and captures later eligible Raw. Restart does not restore cancelled drafts/excluded anchors. Replay adds no provider call, usage charge or receipt. | B |
| IL-05 | Two independent captures support one Memory with opt-in matching labels/content. Actual installed-core deletion retains survivor, removes deleted receipt/text and blocks required-source Card use; private authored body remains. Cold restart and idempotent replay preserve results. | C |
| IL-06 | Archive/manifest/filesystem inventories agree; no source-checkout application fallback; actual child exits recorded, children closed, synthetic environment sanitized, no real network/keys, owned scratch cleaned. | A/B/C |

D6 applies to the original source anchors, not a semantic ban on a genuinely new
session containing newly entered text. Use fresh conversation revisions after
mutation so a stale coarse cursor cannot masquerade as an exclusion check.
Re-extraction jobs are absent (RL-9); never report exercising an unavailable API.
The disjoint control may be an actual captured message with scripted empty
extraction. Preserve default-strict duplicate behavior except the explicitly
selected independent-source fixture. Duplicate receipts alone are not independent
corroboration. Reads, drafting, PTY review, deletion, rearm and restart add no
provider calls or ledger charges; record which capture phases actually occurred.

## Primary acceptance and execution gates

Before worker implementation the primary separately drafted five installed
cases, using the earlier primary capture fixture, not the future worker fixture:
LI00 archive identity; LI01 correction/forget for each client; LI02 independent
source deletion for each client. The new source is frozen at
`e54fdfc3b9349637e1bfed6c6863ae4b36c5dce68317a3d075d36d4938b7ec9f`.
That initial fixture hash is retained, not overwritten as a successful result.
Its one diagnosed import-order correction is recorded below.
Primary evidence directory: `/tmp/cairn-installed-lifecycle-evidence.UNo3zn`.

Execute baseline, worker suite and independent acceptance on Node 22.16.0 and
24.15.0 with synthetic HOME/TMPDIR and actual exits. Preserve every red result;
diagnose fixture-premise errors separately from runtime defects. No unexplained
green rerun resolves a red. Freeze source/dependency hashes before final gates
and compare again afterward; record tested precommit content and final SHA.

For this tests/docs-only packet, run five contributor gates per runtime, ten
commands total. Expand and independently enumerate the test globs before launch:

```sh
node tools/testing/run.mjs --test-concurrency=4 packaging/test/*.test.mjs
node integrations/client/testing/run.mjs --test-concurrency=4 plugins/cairn-memory/test/*.test.mjs evaluation/architecture/test/*.test.mjs
node tools/testing/run.mjs --script scripts/validate-json.mjs
node tools/testing/run.mjs --test-concurrency=2 tools/testing/*.test.mjs
node tools/testing/run.mjs --script /tmp/cairn-installed-lifecycle-evidence.UNo3zn/primary-final-validator.mjs
```

The last wrapper runs pinned Claude 2.1.260 `plugin validate .` and
`plugin validate plugins/cairn-memory --strict`, synthetic HOME and traffic
disabled. There is no TypeScript/typecheck gate. Both adapters and validator use
unchanged existing locked dependencies; local links are never staged. The shared
offline npm cache is already prepared. Do not read environment keys.

Primary reruns its meaningful installed acceptance on the exact final candidate.
Then separate nonauthor Standards and Spec reviewers inspect the same fixed
base/candidate. Corrections require affected checks and both axes again. Push
only the reviewed candidate, open a draft PR, supervise latest-head CI to actual
completion and inspect merge-preview tree equality before marking ready.
No standalone process/log counts as unattended supervision.

## Contract coverage map

This map is an acceptance roster, not a claim that all rows pass. New results
will name the exact test/runtime/SHA. Prior unit evidence is not relabelled as
new integrated acceptance. The full contracts remain normative.

| Contract row | This packet's observation | Still separate / not inferred |
| --- | --- | --- |
| T01 | None; existing decision primitives unchanged. | Supported premise failure versus unverified challenge; semantic link accuracy. |
| T02 | None. | Supported B adoption/current/history and rationale quality. |
| T03 | None. | Event-time versus ingestion-time reasoning and non-failing premise updates. |
| T04 | Existing exact-Raw identity tests remain dependencies. | New combined suite does not certify every unrelated-append/coarse-cursor case. |
| T05 | Installed exact profile scope is used. | Full cross-scope mapping/relation/isolation matrix remains prior core evidence, not a new semantic result. |
| T06 | Unavailable. | No generated topic-summary feature or fabricated cache acceptance. |
| T07 | B and LI01: actual captured provenance, correction/forget, fresh anchors, cancellation, disjoint control and cold restart. | All context-only bindings/races and changed-event re-extraction are not inferred; RL-9 API is absent. |
| T08 | B/C inspect invalidated pending drafts; deletion replay in C. | Full double-confirm/edit/cancel/provider races remain separate core tests. |
| T09 | C and LI02: two real source conversations, one-source deletion, surviving Memory/receipt and unsupported authored Card. | No semantic corroboration claim or inference of all legacy/host consumers. |
| T10 | Confirmed authored bodies intentionally survive support loss. | Card-body deletion/host publication drain is a different operation, not tested by source deletion alone. |
| T11 | Existing typed MOC/navigation unchanged. | No new full routing or mapping-revocation acceptance. |
| T12 | A/LI01/LI02 directly resolve Raw without inventing an extra Memory/note/provider call. | These stores already contain captured Memory; prior #464 bare-Raw/no-Memory and note-only cases stay separately labelled. |
| T13 | A/B/C inspect no automatically created Card/note after foreground capture. | Not actual native hook activation or a new run of every legacy Memory-confirm path. |
| T14 | A/B/C and LI01/LI02 use generated installed artifact, actual stdio, explicit PTY and cold restart. | Missing/stale approval permutations and real native clients retain their separate gates. |
| T15 | Current fixed resource limits apply to selected small fixtures. | Long Unicode/multipart/quota/crypto/routing exhaustion matrices remain prior specialized suites. |
| T16 | All new fixtures use owned cleanup and observed child exits; lifecycle gate tests success/failure cleanup. | No guarantee for SIGKILL/host crash/detached processes or historical directory cleanup. |
| T17 | B/LI01 observe canonical D6 exclusion propagation. | Locator-only filing/interpretation independence is not proven by exclusion tests. |
| T18 | No new permission model; installed existing scope is respected. | Full asynchronous scope-revocation/host-drain races are separate evidence. |
| RL-1 | A/B/C inspect actual saved short Raw, admission and lineage on an installed store. | Full atomicity, long texts, cap/concurrency, encryption, migration and failure matrices are separate; not all RL-1 accepted here. |
| RL-2 | B/C observe precise captured provenance exclusion/deletion and surviving support after restart. | Full deletion table, historical/legacy/host consumers, concurrency and re-extraction are not all covered. |
| RL-3 | Both synthetic client formats/qualified ancestry, installed foreground host and explicit rearm are exercised. | Automatic setup/activation/disclosure, real client support, all quota/continuation cases and default-on rollout remain separate. |

## Remaining delivery boundaries

Passing this packet makes the installed local subset demonstrable, not complete
general-purpose V1 or production readiness. Still track schema29 E-1 reader/import
compatibility, actual automatic client setup/activation, simpler owner setup,
product joint acceptance and G1/G2/H6 independently. Product pin/flag changes
remain outside this work. Automatic consolidation, generated summaries, vector
retrieval and new semantic comparisons require separately scoped work/evidence.

### Next compatibility boundary, independently checked

The ready, separate PR #457 (`3ae5bc1d40ae611293cd42edaab14bf1252e55ae`)
exports `openMemoryReader().readTopicOverview()` for Memory MOC metadata. Its
explicit schema roster is 18/20/21/22/23; that branch is not in this Raw stack.
On both Node runtimes a new owned schema18 control reads successfully, while a
new owned schema29 store returns `unsupported_database`. Main database hashes
are unchanged and all owned scratch is removed. The diagnostic command exits 0
to mean that this known boundary was reproduced, NOT that schema29 compatibility
passes. This is expected refusal under #457's existing contract, not a newly
discovered defect in it.

The probe is `next-reader-schema-probe.mjs` in primary evidence, executed via
`node tools/testing/run.mjs --script ...` on both supported binaries. It neither
migrates a store nor changes a product caller. A later bounded integration packet
must bring the already reviewed reader into the Raw stack, verify exact schema29
metadata/index/visibility compatibility and preserve read-only/no-provider and
writer-responsiveness guarantees. Do not simply permit every unknown version.
Memory-only metadata still does not claim authored Card MOC metadata. No such
implementation or public compatibility claim is part of this tests-only packet.

## Execution record

| Task | Owner/model | Base/candidate | Evidence / next step |
| --- | --- | --- | --- |
| Planning and independent acceptance | Primary | #466 / candidate pending | Independent five cases and ten combined gate commands pass both Node runtimes; actual exits 0/null, source unchanged and owned cleanup verified. |
| Six installed scenarios and limitations | One bounded GPT-6.1 Sol/high worker | Same fixed base / three paths frozen | Six cases pass both Node versions, actual child/outer exits 0 and cleanup; primary independently checked logs, hashes and process receipts. No runtime edits. |
| Final review | Separate nonauthor GPT-6.1 Sol/high Standards and Spec | Candidate pending | Not started. |

All implementation/review elapsed times and exposed costs remain unknown until
observed. No spend is inferred from model labels. The ongoing work segment began
2026-10-21 14:00 UTC; discuss progress within the user's 12–18 hour window rather
than silently extending another long run.

### Baseline and retained fixture failure, 2026-10-22

The first primary run exited 1: archive LI00 passed; a cleanup-hook failure plus
four subsequent lifecycle case failures produced TAP totals 6 / pass 1 / fail 5.
This was not five independent engine failures. The primary fixture registered
LI00 before an awaited SDK-helper import. While that import yielded, Node ran
the root after hook and removed the shared installed archive before registering
the remaining cases. Their application imports then failed ENOENT. No engine
behavior verdict follows from that run. Outer owned scratch was still removed.

A minimal two-case Node probe observed `first, root-after` before the later test
registration, actual exit 0. The only correction moves the helper import before
any test registration; it does not change expectations, runtime or budgets.
Original source/runner and red receipt are retained as fixture-v1/baseline-v1.
Corrected primary test SHA-256:
`3fe31c0d38a4d67ce0b133e249272efa42f966e790df3e6677bdef80a7ca9f95`.

`primary-installed-run.mjs baseline-v2 freeze` and `... baseline-v2 run` both
exited 0. LI00 plus LI01/LI02 for both clients passed, 5/5 on each Node version,
child exits 0/null and outer exit 0. The actual foreground-created stores survive
MCP/PTY Card creation and cold correction/forget/deletion checks. Source 1,853
entries stayed unchanged with aggregate
`4c7a2551d209cb8fc1e0499104c07a1551d6b48fce15119bc9d81f8deb8bdfec`;
the one changed planning path was independently enumerated. Baseline-v2 report
records owned cleanup and the actual completion time. Worker implementation began
only after the baseline supervisor finished at 00:20:32 UTC.

### Frozen author result

The three author paths are frozen at aggregate SHA-256
`c19a33afe35212e5913458582252724b04801975ab59f9dc6dc711522b72bc55`.
Both `focused-final-22.16.0` and `focused-final-24.15.0` pass six tests,
actual child/outer exits 0, signals null, with owned scratch removed. Each case
checks 179 archive files and exact equality of the 172-entry static/observed
application closure. Scripted capture HTTP/usage counts are A 6/3, B 10/5 and
C 12/6 per client; these are fake HTTP mechanics, not paid model calls.
Non-capture operations preserve the ledger and request count.

The author freeze covers 1,854 source entries excluding only the two primary
plans; aggregate `fb9442be431c5b1180070b96952d29262e235716016dfa7c54ea6d88659d1333`.
All nonauthor source/runtime bytes and modes match the fixed base. Eighteen
dependency entries and three local links remain unchanged. Independent diff
and full-tree/filesystem inventories agree on exactly five regular changed paths.
Evidence: `/tmp/cairn-installed-lifecycle-author.1BOM69/`.

Retained author reds are fixture-only: the first 0/6 used the archive launcher
path as a source path; subsequent 0/6 and minimized 0/1 startup failures came
from newline escaping in the new nested test loader. A syntax probe separated
outer parse success from nested failure, then verified both corrected layers.
All failed runs exited 1 with owned cleanup. The final receipt parser also first
exited 1 while treating a TAP-escaped hash diagnostic as JSON; it was narrowed
to bounded scenario/client records, without changing test source or raw logs.
No runtime defect or semantic result is inferred from these fixture failures.

### Primary combined acceptance

The ten frozen commands in primary-combined-v1-commands.json all completed,
actual exit0/signal null on both runtimes. Each runtime records artifact133
(132pass, one existing native-Windows-only skip), generic635/635 and workspace
lifecycle25/25. JSON and pinned marketplace/strict-plugin validators exit0.
The supervisor exits0, observes only its synthetic home after each gate, then
removes its workspace. The independent final verifier exits0 and confirms raw
log counts/hashes, all1,855 frozen source entries and18 dependency entries.

Primary's separately authored five installed acceptance cases also pass on both
runtimes against the same combined source digest
`82eb8181e95ad90cd758eb52bfc769ec7e6433dffd719428f2a1962157bce87c`.
Both children and their supervisor exit0; source stays unchanged and scratch
is removed. primary-acceptance-precommit-v1-verification.json independently
checks the two logs and actual file hashes. The author result is separately
verified in primary-author-verification.json; it is not substituted for these
primary cases.

Two primary bookkeeping errors did not run application tests: a freeze label
collided with the existing matrix freeze and exited1 without overwriting it;
the acceptance run then used its own distinct label. The author-log verifier
initially understood only Node22's TAP markers and exited1 on Node24's spec
markers. It now parses both observed formats, keeps the exact six-case/count
requirements and exits0 against the unchanged original logs. Neither required
a runtime/test change or an unexplained test rerun.

Only this plan and the completion checkpoint are updated after those gates.
The three frozen author files remain byte/mode-identical. Before push, the
five-path delivery inventory and committed content must match, primary must
repeat installed acceptance on the exact commit, and both nonauthor review
axes and latest-head CI must pass. Those later results belong in the PR.
