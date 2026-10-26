# P3b — shared conversation deletion, not a second engine

Status: corrected frozen-source offline matrix passed 2026-10-21. The first
candidate `6596b2e4e466996049783502b12d735213e62179` was rejected by independent
Spec review for two confirmed provenance/CAS defects; its failures are retained
below. Corrections and related authority/context regressions now pass. A new
fixed-commit dual review and latest-head CI are still required; no push/PR yet.
Fixed base: `99b09855358176786d86765d009faba4777867f6` (P3a, PR #451).
Worktree: `/home/chichieh/Github/cairn-memory-worktrees/raw-local-v1-delete`.
Branch: `feat/raw-local-v1-delete`. P3a passed independent Standards and Spec;
its latest-head CI subsequently passed 31/31 checks, `gh pr checks` actual exit 0.
PR #451 is ready and mergeable, not merged. P3b develops on this dependent branch;
do not edit the frozen P3a branch or imply the stack is merged.
Existing raw-layer D5/D6 remains source authority.

## Construction and compatibility

Select additive schema 27 only through the uninstalled internal factory's own
boolean `deletion:true` option, implying lineage. Public constructor options and
installed capability stay unchanged. Current option-off writers on a 27 store,
including already-open-before-upgrade connections, must enforce the selected
rules. A pre-Raw store may opt in without backfilling text/maps. Default unopened
legacy stores are not silently claimed to have adopted D5. Frozen v26 refuses 27.

Keep existing `forgetEpisode` input/output shape. On a selected store it delegates
to the shared cascade, including legacy episodes with no Raw. Its ordinary missing
or stale-episode behavior remains explicit. No production store is upgraded.

## Observable acceptance

| ID | Required behavior |
| --- | --- |
| P3b-01 | Additive opt-in migration is atomic, has no fabricated Raw or source text, strict options reject wire/public injection, current option-off opens and pre-upgrade connections honor it, frozen v26 refuses. Default behavior stays unchanged. |
| P3b-02 | Preview and delete call the same live-source planning function on one consistent transactional snapshot. Candidate Memories come only from actual retained receipt provenance, including historical rows; stale episode links or unrelated zero-receipt rows are not deletion authority. Every surviving receipt must be provably independent explicit input or another actual source conversation/session. Unknown legacy support fails `raw_lineage_unavailable`, with no mutation and no fabricated independence. |
| P3b-03 | A changed support graph invalidates deletion CAS even without Raw append. Receipt addition/removal, correction/forget, dedup provenance attachment, source-root changes and episode-source consumer addition/removal/replacement (including zero-Memory episodes) advance the affected conversation revision before old evidence disappears. Touch only roots reached from the affected Memory/receipt/episode-source graph, not every namespace conversation. A genuinely unrelated conversation remains unchanged. Preview itself is write-free. |
| P3b-04 | Forget source-only current and historical Memory using ordinary suppression. For multi-source Memory, remove only target receipts/lineage; preserve content, remaining receipts and current/historical state, advance revision, and invoke existing dependent-evidence/index/episode/Card invalidation. New explicit aliases or keep event IDs cannot count as independent support. |
| P3b-05 | In one transaction: enforce CAS/action identity, tombstone source session, close related pending work, invalidate source consumers, mutate Memory, release saved/reserved bytes exactly once, purge Raw records/obsolete maps/exclusions/bindings, persist content-free replay and finite host effects. Failure injected after receipt or usage mutation rolls everything back, including Card/effects state. Successful reads expose no deleted source text. |
| P3b-06 | Same action+arguments replays original counts after restart without additional deletion, usage decrement or effects. Same action with changed arguments fails `event_payload_conflict`; unknown/foreign target is `conversation_not_found`. Same-action/different-action competing processes serialize. No partial state, double decrement or duplicated withdrawal. |
| P3b-07 | Legacy `forgetEpisode` uses this cascade for Raw-backed and pre-Raw episodes, including option-off opens. Clear target episode prose, passages, steps/policies and dependent cross-episode closure prose; fence source publication without recursively forgetting unrelated Memory. Empty/no-Memory episode deletion still tombstones its session. Preserve existing confirmed host collection records; do not claim host delivery. |
| P3b-08 | Durable session tombstones reject late Raw and new-event legacy capture before provider dispatch and at receipt/admission publication. Private trusted source-session bindings are persisted inside actual ordinary/staged/ordered claims before providers run, not accepted as wire fields. Cover keep origins, pre-dispatch counting microtasks, in-flight model responses, staged retry, separate connections/cold processes and async Raw-read races. Unresolvable old pending provenance fails visibly rather than guessing. |
| P3b-09 | Pause/project-stop/client-off closes pending assemblies and releases remaining reservations in the control transaction, including current option-off and already-open-before-upgrade writers, without crypto/policy/model callbacks. Accepted parts remain. Resume/on never backfills a closed attempt; a new message in the surviving session may save normally. Other owners/projects/clients are unaffected. |
| P3b-10 | Host effects contain only finite kinds, stable effect/action IDs and scoped affected entity IDs. Bounded model-free pagination survives restart and returns no prose. Identical action replay adds no effects. Host consumption, acknowledgements and actual ask/preview withdrawal remain P4/RL-4, not asserted from an outbox row. |
| P3b-11 | Both clients; exact owner/project/client/session isolation; saved/skipped/incomplete Raw; historical/explicit/keep/dedup receipts; legacy resolvable and ambiguous evidence; real competing child processes; failures and cleanup. Exercise existing private Card draft cancellation/confirmed authored-body retention via actual receipt-backed Card APIs, not a new Card engine. |
| P3b-12 | Primary independently constructs user-facing acceptance, reviews actual combined diff and reruns key cases. Run focused and full core on Node22.16/24.15, generic/validation, relevant demos, workspace, MCP/artifact/import regressions and affected installed cases. Capture actual exit codes. Mechanically cross-check file inventory twice, freeze tested bytes, obtain independent Standards and Spec on final commit, then latest-head CI and mergeability before delivery. |

## Internal API and outbox bounds

Existing decided methods: `previewDeleteConversation({namespace,conversationId,
expectedRevision})` and `deleteConversation({namespace,conversationId,
expectedRevision,actionId})`. Both expose the four decided content-free counts:
`forgottenMemories`, `retainedMemories`, `removedReceipts`, `invalidatedEpisodes`.
Preview includes the compared conversation revision; delete includes a small
effect count, not an unbounded array of every affected Memory.

Use a separate internal `listRawEffects({namespace,limit?,cursor?})` analogous to
the existing Card outbox: default 20/max50, whole serialized result <=65,536 bytes,
exact scoped signed keyset cursor, stable effect IDs and deterministic order.
No acknowledgement or HTTP callback is added. The host owns delivery/consumption.

The worker must record final DTO choices before implementation, preserving these
bounds and existing strict facade compatibility; do not invent a public wire API.

Worker read-only audit accepted by primary (2026-10-21): preview's strict value
is `{conversationId,revision,forgottenMemories,retainedMemories,removedReceipts,
invalidatedEpisodes}`. Delete returns those fields plus `{actionId,effectCount}`;
its revision is the committed tombstone revision and is replayed unchanged.
Counts are unique affected entities, not the number of mutation calls. Count
the target episode and each dependent consumer once. `effectCount` counts only
the new Raw withdrawal rows, not existing Card invalidation effects.

Each Raw effect is `{effectId,namespace,kind:'withdraw_pending',
source:{type:'conversation'|'episode',id},
entity:{type:'conversation'|'episode'|'memory',id},actionId}`. List returns
`{effects,coverage:{status:'complete'|'budget_exhausted',included,omitted:0|null},
nextCursor}`. A signed immutable high-watermark and stable ordinal ordering
permit pagination across later appends. No delivery/acknowledgement is implied.

Two revision domains must remain distinct: `forgetEpisode` compares the episode
revision, while conversation deletion compares the conversation revision.
Relevant support mutations invalidate both reachable roots where present;
pre-Raw legacy episodes require no synthetic Raw conversation to obtain CAS.

Legacy staged views contain no session. Only exact existing Raw/episode/keep/job
metadata may resolve their root, never matching excerpt text or message ID alone.
If a job in the target's exact namespace/client remains unresolvable and has
retained staged payload or publication authority, preview/delete refuses with
`raw_lineage_unavailable`, mutating nothing. Foreign scope/client jobs do not
block. Terminal payload-free jobs with no publication authority do not block;
expired-but-retained payload must not be silently treated as absent. This is a
documented legacy repair prerequisite, not permission for broad deletion or a
new repair endpoint.

## Ownership and exclusions

One GPT6.1 Sol/high worker implements runtime/storage/tests and minimal packet
docs in its isolated dependent worktree. Primary owns this plan, acceptance,
integration and supervision. Separate non-author Standards/Spec reviews follow
freeze. Escalate a failing correction hypothesis after two attempts, not an
arbitrary number of green reruns.

No RawSourceRef resolver or bare Raw Card implementation (P3c), installed/client
Raw surface (P4), paid models, real transcripts, benchmark change, new issue,
merge, publication, deployment, data repair or production gate waiver.

## Execution record

2026-10-21: actual implementation assigned to the existing non-author-reviewer
worker `/root/raw_p2_capture_impl61`, configured GPT 6.1 Sol/high. Primary owns
planning, direct diff inspection, independent acceptance and final gates. The
worker's first checkpoint is schema/plan/cascade integration, not a passing
result. No takeover or correction round has occurred yet.

Primary prepared 35 independent cases before P3b acceptance, covering basic
support/delete semantics plus pre-upgrade cached option-off handles, token-count
microtasks, in-flight extraction, asynchronous Raw reads, real competing child
processes, receipt-backed Card invalidation, post-usage whole-table rollback
including Card/effect rows, and outbox snapshot pagination.
Syntax checks exit 0; behavior is not yet claimed passing. Evidence directory:
`/tmp/cairn-raw-p3b-evidence.xOAiQk`. All fixtures use synthetic owned workspaces;
child processes are explicitly terminated on failed teardown paths.

Scope clarification accepted by primary: the artifact manifest may include the
exact static-import closure required by current ordinary openers and option-off
writers (new DB-only modules and an existing input module where imported).
This is compatibility plumbing, not P4 exposure. The usable internal factory,
Raw resolver, new installed tools/capabilities and public constructor options
remain excluded. Mechanically derive and cross-check the final import/file list.

The immutable `captureRaw` action receipt reports registration-time Raw revision.
Later Memory-support changes may advance the conversation revision in the same
operation. Delete callers refresh `getConversation` before preview and CAS;
do not rewrite the recorded Raw replay receipt to make it look current.

Locked isolated dependency installs completed with actual exit 0 for OpenAI,
MCP and plugin-validation tooling. Their `node_modules` paths were checked absent
before installation; no shared installation or package lock was replaced.
The existing MCP dependency audit reports two high-severity vulnerabilities;
no automatic force-upgrade or unrelated dependency mutation is authorized here.

Foundation checkpoint: worker's seven cases passed Node 22.16, actual exit 0.
Primary then ran 14 independently prepared actual-API cases, also exit 0
(`primary-foundation22.log`): source-only deletion and cold action replay,
explicit and second-conversation support preservation/CAS, historical deletion,
derived-alias handling, unknown legacy support refusal, and AFTER DELETE receipt
failure rolling back every application table. This is working-tree evidence;
remaining publication/control/Card/process checks and final source freeze are
still required, not implicitly passed by this subset.

Primary's second working-tree subset passed 11/11 on Node 22.16, actual exit 0
(`primary-cards-process22.log`). It observes two real competing processes for
same/different delete actions, no double usage/effects, asynchronous Raw-read
publication refusal, multi-source Memory surviving while bound draft/current
Card evidence invalidates, confirmed authored history retention, stale evidence
snapshot refusal, rollback after usage mutation including all Card/effect tables,
and high-watermark outbox pagination. Existing strict evidence DTOs were read
before execution; the probe uses `items[].ref` and snapshot-only revalidation,
not an invented return shape. Total 25 distinct independently constructed cases
have now passed on this working tree; the other ten and full final gates remain.

P3a handoff was posted to the named product issue only:
<https://github.com/wsxqaza12/cairn-wiki/issues/453#issuecomment-6307510653>.
It explicitly keeps the product pin unchanged and does not claim P3b/P3c/P4.

First full primary acceptance (`primary-first35-22.log`, Node 22.16) completed
31 passed / 4 failed, actual exit 1. Both clients fail deletion while an ordinary
legacy extractor is in flight and during its token-count microtask; the delete
returns `storage_error`. The original cases and failure log are retained.
This is not a passing gate. The same bounded worker owns minimal diagnosis and
correction; primary made no runtime patch. Ranked hypotheses are a pending-job
state/CHECK mismatch when closing a claim, a legacy-connection transaction
conflict, or pending-source classification. Narrow reproduction and explanatory
red-to-green evidence are required before the final full matrix.

Correction round 1 confirmed the state/CHECK hypothesis: a public-created
pending admission requires a non-null token. Clearing it during deletion violates
SQLite CHECK (errcode 275); the transaction correctly rolls back. The worker
expires the pending lease without changing its valid token/state representation,
while the durable closed-job fence refuses reacquisition and late publication.
Primary reran the original unmodified 35 cases: 35/35, actual exit 0 on Node
22.16 (`primary-corrected35-22.log`). This resolves the observed failure; it is
still pre-freeze evidence, not the final regression/review gate. The worker's
minimal probe retains an initial setup-only missing-lease failure separately
from the successful actual CHECK reproduction; neither is a product score.

A separate source-root/CAS gap was then demonstrated by the worker's real
pre-upgrade receipt case (`worker-delete-jobs-third22.log`, 16/17 passed, actual
exit 1): a newly trusted capture job resolves an old unknown receipt, without
adding Raw or a receipt, but previously left a dependent conversation's preview
revision unchanged. The narrow correction compares only the matching retained
receipts before/after binding the trusted job and advances their affected roots.
Primary independently constructed a v18-to-v27 case with both clients, unchanged
receipt rows and Raw parts, and an unrelated conversation control. Its first run
was after the correction and passed 2/2, actual exit 0
(`primary-proof-first22.log`); the worker's retained log is the red evidence.
The final independent primary suite now has 37 cases.

Primary also ran the six existing lineage/admission/staged/ordered/episode
regression suites on Node 22.16: 234/234, actual exit 0
(`primary-legacy-regression22.log`, 312.884 seconds). This was an in-progress
diagnostic, not final frozen-source evidence. The longer cases intentionally
hold real SQLite locks; process activity and advancing subtest output were
checked during the run. Full two-runtime gates remain required after freeze.

The authority-transition audit reproduced the same CAS gap through episode
reservation and Raw registration with an empty extractor, rather than treating
the ordinary-job fix as complete. Retained worker logs include
`worker-delete-proof-episode-before22.log` and
`worker-delete-proof-raw-before22.log` (actual exit 1). The shared correction
now compares exact matching retained receipt authority around job binding,
episode reservation and journal registration inside their existing transactions.
The journal uses its canonical session key; an initial integration attempt using
the deliberately removed raw session field is retained separately. No broad
namespace revision bump or new source text is introduced.

Primary added two independently constructed Raw-only cases, one per client:
an actual empty extractor creates no Memory/receipt, yet registering its Raw
source stales the dependent deletion preview; an unrelated conversation stays
unchanged, and the newly proven source survives deletion of the other source.
The two ordinary proof cases plus these two passed 4/4, actual exit 0
(`primary-raw-proof-first22.log`). Both tests first ran after the correction;
the worker's retained failures establish red evidence. The final independent
suite now contains 39 cases; the earlier 35/37 counts are historical checkpoints.

Worker source freeze: 51 P3b plus 88 existing lineage cases passed 139/139 on
Node 22.16 and 24.15, both actual exit 0. Logs are
`/tmp/cairn-raw-p3-evidence.67nhhd/worker-delete-stable-focused22.log` and
`worker-delete-stable-focused24.log`. All worker test/helper processes stopped.
Primary independently compared Git diff plus untracked paths against base-tree
blob/mode versus actual filesystem: 25 paths, including 21 non-document paths.
`frozen-inventory.json` records their exact SHA-256 bytes before final gates.
Primary has started the two-runtime final matrix on those frozen source bytes;
its final outcomes are not implied by the worker's focused pass.

Final-gate orchestration uses an additional owned temporary parent per lane,
disables the npm parent's Node compile cache and checks that parent is empty
after each command before removing it. Actual child exit status and residue
listing are recorded separately; unexpected residue is a failure and is retained
for diagnosis rather than swept. No historical workspace cleanup is involved.

## Final frozen-source verification, 2026-10-21

Primary reran the actual combined candidate on Node **22.16.0** and **24.15.0**.
Every command below completed with actual exit **0** on each runtime:

| Command / owned-runner input | Each runtime's result |
| --- | --- |
| `node tools/testing/run.mjs` with the three primary `primary-deletion`, `primary-deletion-races`, `primary-support-version` suites in the evidence directory | 39/39 independent cases |
| `node tools/testing/run.mjs core/test/raw-deletion.test.mjs core/test/raw-deletion-jobs.test.mjs core/test/raw-deletion-host.test.mjs` | 51/51 |
| `npm run test:core` | 1,529/1,529, zero skipped/cancelled; command elapsed 402.084s / 403.846s |
| `npm test` | 635/635 |
| `npm run validate` | Pass |
| `npm run validate --prefix tools/plugin-validation` | Pass |
| `npm run test:mcp` | 125/125 |
| `npm run test:artifact` | 94 passed, one native Windows-only skip on WSL, zero failures |
| `CAIRN_RATIONALE_INSTALLED_OFFLINE=1 node tools/testing/run.mjs evaluation/live/test/rationale-pilot.test.mjs` | 4/4; synthetic HTTP, no paid API |
| `NODE_DISABLE_COMPILE_CACHE=1 npm run test:workspace-lifecycle` | 25/25 |
| Existing store/history/MOC/recall/admission/episodes/session-context/private-cards/capture/conflicts/rebuild/continuation demos through the owned runner's `--script` mode | 12 commands per runtime, 24 total |

The primary-owned gate runner records exact commands, child exit codes,
elapsed time and parent-directory residue in
`/tmp/cairn-raw-p3b-evidence.xOAiQk/final-*-results.json` and corresponding logs.
All eight lane parents were empty after their children finished and were then
removed. No test process remains running. Intentional lock/timeout cases were
supervised via changing output and actual child activity, not inferred healthy
from a PID. No source change or test timeout relaxation occurred during this
matrix; original red logs remain available.

The 21 non-document paths still exactly match the pre-gate SHA-256 inventory.
Their concatenated sorted `path + NUL + bytes + NUL` digest is
`f287452f24e6b7ab2a1f2a13df791cfd2aa216d1cb0cdb019ea73ef394824e71`.
Primary fetched origin: main remains `cd6d1ad32ac3d6f5926c6846e8c6d27645bb7c9a`.
The dependent base remains P3a `99b09855358176786d86765d009faba4777867f6`,
not a claim of merging the stack. The subsequent PR records the exact candidate,
two separate reviews and latest-head CI. No merge/release/deployment or product
pin change is authorized by these offline results.

## Independent review correction, 2026-10-21

Candidate `6596b2e4e466996049783502b12d735213e62179`, fixed base unchanged:

- Standards (`/root/raw_p2_standards61`, GPT 6.1 Sol/high): zero documented
  violations; one optional low possible-Duplicated-Code note for the session
  HMAC helper. Independent 51-case focused run exited 0 and two inventory
  routes agreed on 25 paths. This does not override the Spec gate.
- Spec (`/root/raw_p2_spec61`, GPT 6.1 Sol/high): two high findings. Actual
  frozen P2 keep receipts can carry a consumer's identity for a different
  episode's original passage. Deleting the original source leaves that Memory
  and receipt readable. Separately, committing a new zero-Memory episode
  consumer changes deletion effects without invalidating the old source CAS.
  The same 51 tests passed; these missing scenarios were independently exposed.

Reviewer retained standalone probes under `/tmp/cairn-p3b-spec.D78L0x/`:
`legacy-keep-origin-probe.mjs` and `consumer-cas-probe.mjs`, with their logs.
Each exits 0 **asserting the defective outcome**, not product correctness.
Primary ran both and independently constructed four expected-correctness cases
in `/tmp/cairn-raw-p3b-evidence.xOAiQk/primary-review-regressions.test.mjs`:
both same/cross-client old-P2 keep origins, and both clients' zero-Memory
consumer CAS with an unrelated-source control. All four failed with actual
exit 1 on `6596b2e`; this is retained red evidence, not a transient retry.

The bounded original implementation worker owns correction round 1. Primary
owns independent acceptance and review coordination. Ranked, falsifiable
diagnostic hypotheses are: removing the stamped-client candidate shortcut
should make A-derived B receipts reach planning; resolving exact keep-action
source IDs before consumer inference should identify A instead of B; updating
CAS around actual episode-source graph mutations should reject the old preview
even when no Memory or receipt changes. Test each at its actual seam and audit
removal/invalidation paths as well as insertion.

Legacy keep provenance uses only recorded receipt IDs, the exact scoped keep
action and recorded source IDs/origin episode identity. No excerpt similarity,
invented multi-source support, or Raw backfill is permitted. If retained keep
metadata is missing/ambiguous so that the target cannot be excluded, fail
`raw_lineage_unavailable` before mutation within the exact namespace, including
cross-client origins. Proven unrelated roots do not block; this is a legacy
repair prerequisite, not a new repair endpoint. Default public capability and
product pin remain unchanged. The original offline passes are still evidence
for their exact bytes, not approval of a later correction.

Primary retained the four-case red invocation as
`review-red-review4-22.16.0.log` plus `review-red-review-22.16.0-results.json`;
the child exited 1, its owned parent had zero residue and was removed. At that
point only this plan differed from the frozen runtime. The worker independently
retained four checked-in red cases (`review-correction-worker-red22.log`, exit
1) and verified the actual frozen P2 keep function after fixture import/header
relocation: 1,930 bytes, SHA-256
`b41fb629088170813a99b6232e3a80646da5f09bdd7cf974c585c034880ad926`.

After the first narrow three-runtime-file correction, the worker's original
four cases passed 4/4, exit 0. Primary's unchanged original four plus two
independent add/remove source-consumer replacement cases passed 6/6, exit 0
(`review-first-green-review6-22.16.0.log`). The latter verify both removed and
added source roots stale, with a third unrelated root unchanged. All owned
scratch was removed; these are in-progress results, not the final source freeze.
The expanded primary acceptance suite is now 45 cases. A further authority-
transition audit is checking whether disappearance of a legacy keep source ID
also stales the *other* sources of its deduplicated Memory, not only that
episode's immediate origin. Final full gates and both reviews still remain.

That audit confirmed an additional affected-root omission. An actual legacy
keep from A and actual Raw capture from C deduplicate to one Memory; forgetting
the consumer removes the recorded keep source IDs without changing its retained
receipts. The old C preview then returned `raw_lineage_unavailable` instead of
first rejecting stale CAS. Two red cases are retained in
`review-correction-proof-loss-red22c.log` (0/2, actual exit 1). Earlier `red22`
and `red22b` runs failed during fixture setup and are not counted as runtime
correction failures. The shared episode-source mutation context now snapshots
the exact keep-linked receipt authority and all affected Memory roots before
those IDs disappear, then touches the before/after reached-root union.

The expanded checked-in review suite passed 23/23 on Node 22.16, actual exit 0
(`review-correction-coverage-second22.log`). This covers both clients, same-
and cross-client legacy keep, historical/cold reads, genuine independent dedup
support, naturally missing source IDs, ambiguous colliding message IDs, foreign
and proven-unrelated controls, source add/remove/replacement/invalidation, and
transaction rollback. Its earlier 15/17 result (exit 1) used a forbidden
unqualified supersession operation on a qualified fixture; setup was corrected
to the real qualified binding/transition APIs, without weakening runtime rules.
These remain working-tree results. Broader two-runtime gates, a new exact
candidate and independent dual review are still required.

Primary added two actual-old-runtime acceptance cases for the co-support
authority transition, separately from the worker's copied keep fixture. The
eight-case review packet passed 8/8, exit 0
(`review-proof-check2-review8-22.16.0.log`), with zero residue. The preceding
run was 6/8, exit 1: its two new fixtures selected an episode-enabled core but
submitted ordinary input lacking episode context, so strict validation refused
before the target path. Correcting the fixture construction required no runtime
change. The total primary acceptance packet is now 47 cases.

Primary direct inspection also identified cleanup outside a helper's preparation
reads. The worker reproduced it using real source rows and a single injected
DB read failure: a context survived rollback and suppressed the next helper
mutation's CAS flush (0/2, actual exit 1,
`review-correction-context-red22.log`). Extending the existing try/finally around
preparation resolved both cases (2/2, exit 0,
`review-correction-context-green22.log`). Current public callers normally open
an outer guarded context first; this is internal-helper failure recovery, not a
claim of a reproduced public exploit. The checked-in review packet now has 25
cases. No schema, permission or dependency-policy change was needed.

Corrected source freeze: Git diff plus untracked paths and independent base-tree
blob/mode versus filesystem comparison agree on 28 paths, including 24
non-document paths (`review-fixed-frozen-inventory.json`). Primary's final
47-case acceptance passes on Node 22.16 and 24.15, actual exit 0 each. Both
runtime demo lanes also completed all twelve demos, exit 0 each. The remaining
full, interface and generic gates are still in progress. Every lane checks its
owned parent for zero unexpected residue; all completed commands have none.

## Corrected final-source verification

All 44 primary gate commands completed with actual exit **0** against the
unchanged 24-path non-document freeze, on Node **22.16.0** and **24.15.0**:

| Gate | Result on each runtime |
| --- | --- |
| Four independently constructed primary acceptance files, owned runner | 47/47, zero skips |
| `node tools/testing/run.mjs core/test/raw-deletion*.test.mjs` | 76/76, zero skips |
| `npm run test:core` | 1,554/1,554, zero skips; 438.948 / 438.952 seconds |
| `npm test` | 635/635, zero skips |
| `npm run validate`; `npm run validate --prefix tools/plugin-validation` | Each exit 0 |
| `npm run test:mcp` | 125/125, zero skips |
| `npm run test:artifact` | 94 passed, zero failed, one native-Windows-only skip on WSL |
| `CAIRN_RATIONALE_INSTALLED_OFFLINE=1 node tools/testing/run.mjs evaluation/live/test/rationale-pilot.test.mjs` | 4/4, zero skips; synthetic HTTP only |
| `NODE_DISABLE_COMPILE_CACHE=1 npm run test:workspace-lifecycle` | 25/25, zero skips |
| Twelve existing demos via the owned runner, as listed above | All 24 invocations exit 0 |

All eight owned lane parents were checked empty and removed. Original failures
and older logs remain; this round uses `review-fixed-final-*.log` and eight
`review-fixed-final-<lane>-<runtime>-results.json` files under the same evidence
directory. `review-gate-report.mjs --complete` checks 44 actual exits, no signals,
no unexpected residues and no incomplete lanes; actual exit 0. The implementation
worker separately completed nine affected suites on Node 22 (289/289, exit 0)
and the new 25-case review suite on Node 24 (25/25, exit 0); its processes ended.

Primary repeated the independent Git/base-tree-filesystem inventory check after
the matrix: 28 scoped paths agree, and every non-document byte matches the
pre-gate snapshot. There was no new model call, test timeout relaxation, failure
reclassification, schema expansion, product edit or production action. A final
local candidate commit, both independent review axes and latest-head CI remain
separate gates; their exact SHA/results will be recorded in the PR.
