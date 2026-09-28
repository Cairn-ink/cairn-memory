# CF-1: confirmation state appendix

Status: implemented in CF-1; synthetic acceptance tests accompany the implementation.

Extends [session episodes](session-episodes.md). Acceptance: cairn-wiki
`origin/main:docs/plans/one-brain-u6.md`, D1, D6 and CF-1; one-brain-v1,
decision 5. Implementation base: `c558593bd7dc4700a09235aeb8ebbd93184a0ea4`.

## State and admission

Opt in with `decisionReview: 'required-v1'`. Review state is `none`, `awaiting`
or `confirmed`, independent of currentness and filing. Existing rows get `none`.
Only inferred decisions admitted through capture/admission jobs wait. Explicit
`remember`/`admit` and other kinds retain their existing behavior. Manual trusted
admission jobs use the same inferred-admission semantics as capture.

**Decision (chichi, 2026-09-29):** the conservative admission is chosen.
Under `decisionReview: 'required-v1'`, every automatically captured decision
waits, and explicit `remember`/`admit` stay direct. Chichi noted that asking
people to confirm these is probably too much. The follow-up is a provenance
contract: decisions from the person's own typed prompts, which plugin 0.1.1
marks with `promptSource`, are admitted as direct. It is recorded in cairn-wiki
`docs/plans/one-brain-u6.md` → “Confirmation burden”.

Today's extractor and qualification contracts cannot distinguish a person's
direct decision from an assistant's inference. A user-role source is not proof
that the claim was stated directly; CF-1 does not invent that proof or change
prompts. Thus paraphrases of direct statements also wait under this option.
Explicit host-authorized remember/admit remains the existing direct path.
The provenance follow-up is not implemented here.

An inferred duplicate attaches evidence and keeps awaiting; it cannot demote an
explicit or confirmed item. Pre-existing `none` rows are not retroactively
reviewed on duplication. An explicit duplicate promotes an awaiting item to
`none`, with explicit origin, using existing duplicate semantics. Mixed batches
resolve final revisions after all duplicates; non-awaiting members still classify.

## Readers and related paths

Normal readers exclude awaiting rows regardless of opener option: recall and
fetch (all evidence modes), sessionStartContext, list, time ranges, get, legacy
get/list/search, admission inspection, rationale, map, placement, classification,
source snapshots and recall-index eligibility. `list({reviewState:'awaiting'})`
is the explicit person-facing review listing; `get({includeAwaiting:true})`
provides paged evidence for review. Both require the option. Hosts must reserve
these switches for the authenticated person's review UI, never model tools.
Opted-in ordinary memory DTOs expose `reviewState`; option-off DTOs retain existing shape.
`decisionReview` is an `openMemoryCore` option only; the legacy `openMemoryStore`
rejects it and always hides awaiting rows. Review pagination binds its selection
so cursors cannot cross visibility modes.

Awaiting rows retain admission lineage, source receipts and episode links for
lifecycle cleanup, but cannot be placed, classified, corrected, superseded,
qualified-transitioned or used as rationale targets until resolved. Awaiting
predecessors are excluded from reconciliation, so confirming two successive
awaiting decisions leaves both current; see the [limitation](../limitations.md#awaiting-predecessors-are-not-reconciliation-candidates). Forget is
still allowed, including forgetEpisode, which follows physical links and forgets
awaiting descendants with suppression. Source snapshots exclude awaiting items.

Ordered capture durably holds only supersessions whose replacement awaits review;
independent transitions in the same batch apply immediately unless their set
needs qualified evaluation. Confirm and explicit admit/remember promotion
recheck the predecessor content identity, currentness and bound receipts, retire the
predecessor and write `memory_supersessions` in the same transaction as the
review state, evidence and index changes. Confirm also records its action ledger
in that transaction. Reject/forget drops the held work and leaves
the predecessor current. Capture replay retains the original reconciliation
result, even after review resolves its held work. A mixed batch may therefore
return `confirmation_required` with a positive `retiredCount`.

Conflict insertion checks `review_state === 'awaiting'` explicitly and holds
those hints durably; other missing or non-current rows still fail loudly.
Confirmation and explicit promotion restore valid hints at the new revision.
Held transitions and hints contain IDs/revisions and receipt IDs, not prose.
Restating either endpoint, adding receipts, and filing changes preserve held
work. A newer predecessor or replacement revision alone does not invalidate its
original evidence. Capture binds the predecessor's fingerprint and receipt IDs
alongside the replacement receipt IDs. Review checks that identity, the bound
receipts and currentness, not an exact predecessor revision. Content edits,
missing receipts and retirement invalidate work with a recorded
`dropped/stale_evidence` outcome. Forget and forgetEpisode instead use
`dropped/forgotten`. No lifecycle path silently deletes a held row.
Rejection instead records `dropped/rejected` for the work it drops.
The private tables retain content-free terminal outcomes as well as pending work.
A fresh conflict hint for the same pair replaces a non-pending row with new
revisions, resets it to pending, and clears its result and drop reason. A fresh
supersession hold re-arms only dropped rows; applied and unresolved rows retain
their outcome and proof. An already-pending row keeps its original proof. These
tables record the latest outcome per pair, not an append-only audit trail: re-arming replaces the earlier
outcome. Confirm/reject action-ledger results remain immutable.

Review-enabled results expose `reviewEffects: {transitions, conflicts}` for work
performed by that call. Confirm and reject always return it; promotion through
`admit` returns its new effects. Later admits of an already-active item do not
return old outcomes, and forget returns only the drops it performs, omitting
`reviewEffects` if it drops nothing. Confirm/reject action replay returns the
original call's recorded result. Other lost responses are recovered through the
review listings, not by repeating admit: `listReviewTransitions` recovers lineage
and `listReviewConflicts` recovers hints. Durable pair outcomes remain available
there until an eligible new hold replaces them; later qualified resolution or
invalidation updates the outcome.
**Option-off openers never return `reviewEffects`**, including promotion through
`openMemoryCore` without the option and every legacy `openMemoryStore.remember`.
They still apply valid held work atomically and retain outcomes for an enabled
opener to recover; all legacy record shapes remain unchanged.

Each transition has `predecessor` and `replacement` refs (`memoryId`, `revision`),
a `status` (`applied`, `unresolved`, or `dropped`) and `reason` (null,
`qualified_transition_required`, `stale_evidence`, `forgotten`, `rejected`, or
`supersession_limit`).
Qualified transitions remain durably `unresolved` on confirmation or promotion,
including legacy remember; the qualified retirement path marks them applied,
and invalidation records a drop. A review-enabled opener can recover them with
`listReviewTransitions({namespace, limit?, cursor?, status?})`, returning
`transitions`, `nextCursor`, and `exhausted`. `status` defaults to `unresolved`;
`applied`, `dropped`, and `all` also expose recorded terminal outcomes, including
after forgetting an endpoint. Pending work has no outcome yet and is excluded.
Its signed cursor binds namespace, page size and status;
a namespace epoch change gives `cursor_stale`. The listing returns current
endpoint revisions for the host's qualified-path revision checks. Hosts reserve
this method for the person's review UI, not model tools. No adapter exposes it.

Limits are enforced at review time, not by limiting captured held rows. Pending
supersessions are processed in predecessor-ID order: apply up to the shared
five-link limit and record remaining transitions as `dropped/supersession_limit`.
Filling the last slot, including through the qualified path, also records a
limit drop for any earlier unresolved hand-offs targeting that replacement.
Conflicts use the same shared constant and capacity comparison. Their outcomes
identify the source `memoryId` whose hint was held and its `targetId`, plus
`status` (`restored` or `dropped`) and `reason`
(null, `stale_evidence`, `forgotten`, `rejected`, or `conflict_limit`). A full
endpoint drops the hint instead of blocking review. `confirmation_conflicts` retains both its result
and drop reason; ordinary conflict insertion still enforces the hard limit.
Neither conflict nor supersession capacity can fail confirm or promotion.

`listReviewConflicts({namespace, limit?, cursor?, status?})` returns `conflicts`,
`nextCursor`, and `exhausted`. Each conflict has the same source `memoryId` and
`targetId` as mutation effects. Status defaults to `all`; filters are `pending`,
`restored`, and `dropped`. Pending and restored hints have null reason. The
listing requires review to be enabled, uses signed cursors bound to namespace,
operation, status and page size, and fences cursors by the namespace epoch.
Drops from correct, supersede, forget and forgetEpisode remain listable, including
after either endpoint is forgotten. Confirm/promotion restoration and limit drops
are recoverable after a lost response. No adapter exposes this person-only API.

Inserting a new hidden hint alone does not advance the namespace epoch, so
ordinary list cursors remain valid. Re-arming a prior outcome does advance it:
that replaces a review-visible result and expires existing cursors. Review pages
use keyset order; a new hint inserted before a cursor appears on a fresh listing.

For a mixed batch, `qualified_transition_required` takes precedence when the
independent set needs qualification, with `awaitingCount` also reporting how
many transitions need review. Otherwise `confirmation_required` remains the
reason for held work. See [capture](../capture.md) for the replay shape.

Episode prose and retained passages cannot reliably be separated into confirmed
and awaiting assertions. Conservatively hide an episode from list/get/start
context while it has a live awaiting memory link, including passages borrowed
from such episodes. Physical links and episode mutation APIs remain intact so a
person can delete a conversation by its known identity. This may temporarily hide
unrelated episode content; confirmation/promotion restores reader eligibility. Rejection restores an
invalidated episode shell with its event interval, while forget still removes
its prose and retained passages. It does not restore rejected content.

## Confirm and reject

`confirm({namespace,memoryId,expectedRevision,actionId,receipt})` requires a user
receipt and the option. It only accepts awaiting current items, increments the
revision, retains `agent-inferred`, sets `confirmed`, attaches the confirmation
receipt without replacing source receipts (a distinct receipt identity is required), and updates index eligibility and the
namespace epoch in one transaction. The result identifies the new receipt as
`confirmationReceiptId`. It does not reuse correct. It leaves filing
unfiled; subsequent classification is a separate operation.

`reject({namespace,memoryId,expectedRevision,actionId})` requires the option and
an awaiting item, and executes forget plus fingerprint suppression atomically.
Recapture of the same normalized inference remains suppressed.

A durable action ledger keyed by namespace and actionId stores an input digest
and content-free result. Exact retry returns that original result even after
restart or later mutation; identity reuse with different input fails
`action_conflict`. First execution checks revision. Confirmation receipts are
ordinary receipts; ledger digests retain no excerpt. Rejection removes content
and receipts through the existing forget lifecycle. No action automatically
expires and no daily ask cap belongs in the core.

## Schema and parity

Schema v18 adds review_state, the action ledger, `confirmation_supersessions`
and `confirmation_conflicts` with bound-evidence metadata, durable statuses and
content-free outcome records, eagerly on every open, including option-off opens. All DDL, index-reader replacement and version change
are transactional; any failure rolls back. v17 and older openers refuse v18.
Index readers and rebuild eligibility exclude awaiting rows; promotion inserts
into a published projection atomically even when it was previously absent.
No migration reclassifies existing rows or changes their revisions or epochs.
With the option absent, existing fixture API/model bytes stay identical
(excluding generated IDs and clock values, as existing parity fixtures do).
New schema columns are additive storage metadata, not legacy DTO fields.
Option-off openers cannot explicitly expose or resolve awaiting rows.

## Episode availability impact

The synthetic typical-session fixture uses three user/assistant turns, two
captured decisions and one next step. With nothing reviewed, `listEpisodes`
returns 0 episodes, `getEpisode` returns `episode_not_found`, and
`sessionStartContext` returns 0 next steps and 0 procedural items. Confirming
only one decision changes none of these counts. After both confirmations,
there is 1 readable episode and 1 startup next step; procedural items remain 0.
This hides 100% of episode context in this fixture. Any session with a live
awaiting link incurs that cost; this is not a population frequency estimate.
The option stays off by default. U-6 will measure the burden in dogfood; see
[limitations](../limitations.md#decision-confirmation-hides-whole-episode-context).

## Acceptance mapping

`core/test/confirmation-state.test.mjs` covers state independence, admission and
its direct-statement limitation, duplicate and mixed-batch behavior, every reader,
classification and lifecycle paths, confirmation/rejection receipts, suppression,
replay and revision conflicts. `core/test/confirmation-migration.test.mjs` injects a DDL failure and exercises
an actual v17 opener against v18. Parity tests execute existing synthetic fixture
workflows against the recorded base and this implementation with the option off.

## Verification record

Commands use a worktree-local `TMPDIR` and `npm_config_cache`, and synthetic scripted models. General
checks and the full core suite run on Node 22.16; confirmation tests, artifact tests and all
11 demos run on both Node 22.16 and 24.15.

| Command | Result |
| --- | --- |
| `npm test` | Exit 0; 131 passed |
| `npm run validate` | Exit 0 |
| `npm run test:core` | Exit 0; 1,088 passed |
| `node tools/testing/run.mjs core/test/confirmation-*.test.mjs` | Exit 0 on both runtimes; 87 passed each |
| `git diff --check` | Exit 0 |
| `npm run demo:store` | Exit 0 on both runtimes |
| `npm run demo:history` | Exit 0 on both runtimes |
| `npm run demo:moc` | Exit 0 on both runtimes |
| `npm run demo:recall` | Exit 0 on both runtimes |
| `npm run demo:admission` | Exit 0 on both runtimes |
| `npm run demo:capture` | Exit 0 on both runtimes |
| `npm run demo:conflicts` | Exit 0 on both runtimes |
| `npm run demo:rebuild` | Exit 0 on both runtimes |
| `npm run demo:continuation` | Exit 0 on both runtimes |
| `npm run demo:episodes` | Exit 0 on both runtimes |
| `npm run demo:session-context` | Exit 0 on both runtimes |
| `npm run test:artifact` | Exit 0 on both runtimes; 86 passed each |
