# Raw skipped-tail capture barrier (B2a)

Status: frozen local matrix and primary acceptance passed; candidate review and
remote delivery pending.
Fixed dependent base: `cc9a91d285498181aeb424bcfb47d5992057d497`
([B1 PR #456](https://github.com/Cairn-ink/cairn-memory/pull/456)).
Branch: `fix/raw-skipped-tail-barrier`.
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/raw-skipped-tail-barrier`.
Main remains `cd6d1ad32ac3d6f5926c6846e8c6d27645bb7c9a` when prepared.
B1 is ready/unmerged with independent dual review and 31 successful latest-head
checks. This is an explicitly dependent packet, not authorization to merge it.

Authority remains the pure-local synthetic-development exception in
`raw-layer-contract.md`. Preserve default-off retention, notices and every
production gate. No real transcripts, paid/live requests, product pin or flag
changes, releases, deployments, operational migrations or merges.

## Reproduced problem

An incomplete message can already be closed with `quota_reached`,
`notice_required` or `raw_disabled`. Namespace pause currently closes only
pending assemblies. After resume/restart, the skipped predecessor still has an
unreceived transport tail; the next higher-ordinal message fails
`raw_part_out_of_order`. This is an ordering/control defect, not a model failure.

Primary's frozen public and internal P4a six-case probes both fail all six,
actual exit 1: two client identities times the three skip reasons. A separate
nine-case invariants suite passes four and fails five, actual exit 1, preserving
the already-correct no-barrier and tool-off behavior. Original evidence remains
in `/tmp/cairn-raw-b1-evidence.B2X2u2`; new evidence belongs in
`/tmp/cairn-raw-b2a-evidence.awdXwM`. Owned fixtures are removed on failure too.

Frozen independent oracles (not author fixtures):

- `primary-barrier-recovery.test.mjs`, SHA256
  `5f42c48984afd8128c6d292e36bb8247199e884613194fa9342d2996e064fcfc`.
- `primary-barrier-invariants.test.mjs`, SHA256
  `6300a64223a442e4f7954f53acb19281a48cd7ba0c70401e2287fa99bdca9874`.

## Narrow decision

Use the existing transactional capture-barrier setter and existing
`closed/capture_barrier` representation. In the exact control scope, include
closed incomplete tails with the three policy-skip reasons above, in addition
to the existing pending branch. Exclude completed messages and tails already
closed by `tool_off` or `capture_barrier`. Raw-only switch-off is not a new
namespace/model EOF boundary. Do not weaken global message-order validation.

Keep every historical part/event receipt byte-for-byte unchanged. Release only
real outstanding reservations, once; update conversation/namespace revisions
only for changed rows. Later unreceived parts remain explicit gaps, never
saved text or renewed reservations. Old-generation first-part replay remains
`capture_evidence_closed`; an old observational receipt grants no new capture
authority. Namespace pause affects both clients in that namespace; project
stop affects exactly that project, not personal/other-project/other-owner data.
Existing CAS failure must be atomic. No new schema, public option or marker.

This is ordinary pause/resume with known durable identities. It does not solve
lost-client-state recovery, provide durable consent authority or finish local
hook/MCP transport; those remain later packets in `raw-local-v1-completion.md`.

## Author scope and ownership

Primary owns this contract, parent plan, independent acceptance, integration,
fixed-candidate review and delivery. One actual GPT 6.1 Sol/high implementer
owns the bounded runtime/test/doc change after primary dispatch. Two separate
non-author reviewers inspect Standards and Spec on the same committed diff.

Allowed author paths:

- `core/raw-control-storage.mjs`, with the minimal selection/accounting change.
- New `core/test/raw-skipped-tail-barrier.test.mjs` and, only if needed, a
  focused fixture in `core/testing/` used by that test.
- New `packaging/test/raw-skipped-tail-barrier.test.mjs` and dedicated fixture
  `packaging/test/fixtures/raw-skipped-tail-barrier.mjs`, reusing the established
  private archive/install helpers and actual installed public entrypoint.
- Minimal accurate `CHANGELOG.md`, `docs/limitations.md`,
  `docs/raw-local-journal.md` and `docs/plans/raw-layer-contract.md` updates.

Preserve existing `core/test/raw-journal.test.mjs` P1-07 expectations unchanged,
including `closedMessages:0` for an already tool-off tail. Do not rewrite B1's
installed lifecycle fixture or unrelated tests to conceal failures. Any new
required path or architecture conflict returns to primary before editing.

## Observable acceptance

| ID | Required result |
| --- | --- |
| B2a-01 | Both clients and all three policy skips pass the unchanged six-case public oracle after pause/resume/restart: the higher ordinal saves, original skipped receipts stay unchanged, and old text is never backfilled. |
| B2a-02 | Pending saved-prefix reservations release once; repeated controls and multiple connections preserve saved/reserved sums, revisions and cursor invalidation. Completed messages and already tool-off/capture-barrier rows remain unchanged. |
| B2a-03 | Exact project-stop/resume works through a feature-off writer; unrelated scopes/owners remain unchanged. Stale expected generation makes no partial mutation. Namespace pause intentionally covers both clients. |
| B2a-04 | Late contiguous suffixes remain capture-barrier gaps with zero model calls/reservations; old-generation first-part replay still refuses. Part/event receipts retain original dispositions; partly saved prefixes remain readable without restoring skipped text. |
| B2a-05 | With no actual pause/project barrier, an incomplete predecessor still rejects a new message. Raw-only off/on does not repair a policy-skipped predecessor. Existing P1-07 tool-off EOF/release semantics stay unchanged. |
| B2a-06 | Installed archive, fresh processes and public entrypoint exercise the same corrected path for both clients; no source fallback/network/model service. Exact file inventory, final Node22.16/24.15 gates, primary independent reruns, two reviews and latest-head CI pass before ready/unmerged. |

## Verification and supervision

Start with owned focused red/green regressions, then run affected core, MCP,
artifact, generic tests, JSON/native plugin validation and store/capture/
episodes/session-context/private-cards demos on both supported Node versions.
Keep generated client/setup parity checks. No TypeScript gate exists here.
The native plugin validator uses isolated pinned tooling with a fresh owned
HOME/config directory and no application credentials. Any public-registry
metadata preparation is explicit and separate from offline tests.

Run primary oracles with `CAIRN_RAW_PUBLIC_REPO` set to this worktree, through
its owned runner; preserve the original failing logs and compare oracle hashes.
Primary also runs actual installed lifecycle evidence independently. Register
resource cleanup immediately, verify scratch deletion and actual child exits,
and serialize timing-sensitive suites. Do not remove historical temporary data.

Author reports baseline, focused fix, frozen scope and required full gates;
report contradictions immediately or a substantive checkpoint within 20 minutes.
After two unsuccessful correction rounds on the same cause, primary re-scopes.
Do not run heavy suites until primary approves scheduling alongside E1 work.

Mechanically derive changed-file inventories twice (Git diff/untracked versus
base-tree/file comparison), print counts and reconcile. Freeze tested bytes,
commit only this scope, reread current contributor/CI gates, and give both
non-author reviewers the same fixed base/candidate. Corrections require affected
checks and both review axes again. Push/PR only after independent passes; all
latest-head CI and mergeability must pass before ready, without merging.

## Primary baseline checkpoint

Before implementation, primary reruns both unchanged independent files together
on the exact B1 dependency in this worktree. Node22.16 and24.15 each report
15 cases:4 pass/11 fail, actual test exit1. The expected-failure controller
exits0 only because both commands return the expected red exit; it is not a
passing runtime result. Logs: `primary-barrier-baseline-{22.16.0,24.15.0}.log`
in the B2a evidence directory. No source was changed to create these failures.

The assigned implementer is `/root/raw_b2a_impl61`, actual GPT 6.1 Sol/high.
Primary inspected the first runtime diff: only the selection predicate changes,
retaining all mutation/accounting and message-order logic. Primary then reran
both unchanged independent files: 15/15 pass on Node22.16 and24.15, actual
exit0 each (`primary-barrier-first-{22.16.0,24.15.0}.log`). These are initial
unfrozen synthetic checkpoints, not installed-client or final review evidence.
The author additionally reports 41/41 focused new plus unchanged journal tests,
exit0 on22.16; its initial event-ID fixture collision is retained separately
from the corrected failing-before-fix regression. No claim of semantic accuracy.

The first final author freeze has eight files, combined JSON path/hash SHA256
`b8c96d80d8f88898ee27649be4266acec13eba5b54e939e2399cc29426bb4911`.
Primary's independent Git diff/untracked and base-tree/filesystem comparisons
agree on nine total paths (including this plan); all eight author hashes match
the separate author manifest and actual files. The shared tooling uses package-
entry links to identical locked existing installs (2 OpenAI,14 MCP,3 validator);
no dependency deletion/install modifies those shared packages.

The author runs 44 focused cases on each Node version:11 new core,31 unchanged
journal and2 installed cases, actual exit0 both. Primary personally reruns the
15 independent public cases plus both installed cases:17/17 each on22.16/24.15,
actual exit0 (`primary-final-{22.16.0,24.15.0}.log`). Each installed client uses
three fresh processes and all three skip reasons, with a feature-off project
writer, old receipts unchanged, no source fallback/network and no model calls
for the barrier/late suffix. Scripted first-part interpretation is not semantic
model evidence. Full serial matrix, fixed-candidate reviews and CI remain.

Retained author fixture corrections are distinct from the real runtime defect:
an early synthetic event-ID collision, then null-prototype SQLite row versus
JSON/plain-object comparisons (first combined new-core/installed run10/13,
actual exit1). Correcting fixture identity and explicit PK-based receipt
comparison does not relax runtime assertions. Primary also identified one
outdated duplicate guide paragraph and corrected setup-failure cleanup ownership
before this freeze; no extra runtime change was needed.

## Final local matrix and candidate preparation

The author owns and supervises the serial matrix; primary independently audits
its raw records rather than accepting the summary. All26 gates (13 per runtime)
finish with actual exit0, signal:null and no interruption. Each runtime reports
core1668/1668, MCP125/125, artifact99 total/98passed/one native-Windows-only
platform skip, and generic635/635; there are no failed or cancelled cases.
JSON/native validation, store/capture/private-cards/episodes/session-context
demos and generated client/setup parity each exit0. This JavaScript project has
no typecheck gate. Native Windows behavior remains the remote CI responsibility.

The matrix ran2026-10-21 11:15–11:41UTC, serially through the owned runner with
isolated HOME/temp/cache and no credentials. Final core duration is455seconds
on22.16 and488seconds on24.15; the long synthetic lock cases made observable
progress and needed no timeout/retry change. All gates leave only their owned
home directory before final cleanup. Primary confirms both the nested matrix
workspace and its outer runner directory no longer exist. No historical files
or the dirty primary worktrees were removed or modified.

Evidence: `author-matrix-results.jsonl`, `author-matrix-report.json`,
`author-matrix-{before,after}.json` and per-gate logs under the B2a evidence
directory. Primary's `primary-matrix-audit.json` independently checks all26
codes/signals, count/uniqueness, cleanup, identical before/after manifests and
all eight actual file hashes; the audit itself exits0. The author freeze remains
`b8c96d80d8f88898ee27649be4266acec13eba5b54e939e2399cc29426bb4911`.

Primary will commit only the nine inventoried paths, reread current contributor,
runtime and CI configuration and rerun the17 public/installed acceptance cases
on each supported Node. Separate nonauthor GPT6.1Sol/high Standards and Spec
reviewers inspect the same fixed base and candidate. Their results and actual
post-commit exits belong in the PR record, not an unverified completion claim.
Remote latest-head CI and mergeability must pass before ready/unmerged; this
candidate neither merges dependencies nor completes the later local setup.

## Remote CI correction: terminal test framing, not Raw semantics

Initial candidate `52b7d825c5cdd2715bd57fc6c6713f02ab29439c` passed both review
axes and committed primary 17/17 plus workspace 25/25 on each Node, actual exit 0.
It is PR #458, still draft. Remote CI run 39594344678 / job 119202824244 fails
the Node 24 MCP suite: H03 expected the complete displayed `bindings`, but the
PTY fixture announced a prompt while only a quoted fake `Approval> ` in the
untrusted body had arrived. Artifact steps consequently did not execute.
The first narrow real H03 local rerun passes 1/1, actual exit 0; that does not explain
or clear the remote failure.

Primary minimizes through the actual checked-in Python PTY supervisor with a
synthetic two-chunk display, no core/database/provider. Its unchanged
`primary-pty-framing.test.mjs` fails 1/1 on both supported Nodes, actual exit 1, for
the same missing-complete-bindings assertion. It observes normal child/supervisor
exit 0 and exactly one prematurely emitted prompt; the test failure is not a
process crash. Old and candidate supervisor/H03/production-review sources are
identical. Raw runtime is not involved in this reproduction.

Ranked predictions: substring matching an embedded marker yields premature
events only when the display is fragmented; omitted production bindings would
also fail without the synthetic renderer; character/PTY truncation would not
depend specifically on an ASCII embedded marker. Use deterministic fragmented
and coalesced output, actual prompt fragmentation, spoofed-only/no-prompt EOF,
and the original real H03 approval/restart/negative cases to distinguish them.

Authorized correction is test-only, owned by the original B2a implementer:
`adapters/mcp/test/fixtures/card-review-pty.py`, a new focused
`adapters/mcp/test/card-review-pty-framing.test.mjs`, and a synthetic helper
fixture only if needed. Primary owns this record. Do not edit production
`review-card.mjs`, its authorization/display, Raw runtime, existing H03
assertions or timeouts. Match the actual prompt frame rather than arbitrary
quoted text. Preserve bounded output/deadline, child cleanup and single prompt
notification. No weakened checks or blind CI retry.

After correction run both full MCP suites, focused terminal/primary framing
and public/installed Raw checks on each Node; verify all original eight author
hashes unchanged. Freeze an incremental correction commit, then both independent
review axes must reassess the full fixed-base/final-head diff. Rerun all remote
checks on that new head; retain the original failed run and local red evidence.
B2b may develop from the already reviewed parent but must integrate this exact
test-only correction before its own final verification/delivery.

The minimal correction requires the marker at a line start and at the current
output suffix. The author adds nine actual-PTY cases: fragmented/coalesced quoted
markers, three real-prompt split points, single notification, quoted-only EOF
and no-prompt EOF. Before correction, three pass and six fail (actual exit 1).
After correction, all nine plus the eight unchanged real private-card tests
pass 17/17 on each Node (actual exit 0). Both full MCP suites pass 134/134,
actual exit 0, with no skips. Their supervisor is reaped at exit 0, and primary
independently verifies all eight original author hashes and both owned workspace
removals. The unchanged primary fragmented-display oracle independently passes
1/1 on both Nodes (actual exit 0). Production authorization/display and existing
H03 assertions are unchanged. Final committed acceptance, both independent
review axes and new-head remote CI are still required before readiness.
