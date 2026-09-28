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
qualified-transitioned or used as rationale targets until resolved. Forget is
still allowed, including forgetEpisode, which follows physical links and forgets
awaiting descendants with suppression. Source snapshots exclude awaiting items.

Ordered capture durably holds only supersessions whose endpoints await review;
independent transitions in the same batch apply immediately. Confirm rechecks
the held endpoint revisions and receipt identities, retires the predecessor and
writes `memory_supersessions` in the same transaction as the marker, receipt,
index update and action ledger. Reject/forget drops the held work and leaves
the predecessor current. Capture replay retains the original reconciliation
result, even after review resolves its held work. A mixed batch may therefore
return `confirmation_required` with a positive `retiredCount`.

Conflict insertion checks `review_state === 'awaiting'` explicitly and holds
those hints durably; other missing or non-current rows still fail loudly.
Confirmation restores valid hints at the new revision. Held transitions and
hints contain IDs/revisions and receipt IDs, not prose. Edits, changed evidence,
explicit promotion, forgetting or intervening retirement invalidate their old
revision-bound work; confirmation never overwrites a newer endpoint. A held
qualified transition remains subject to the qualification fence and is not
silently downgraded to legacy retirement.

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
and `confirmation_conflicts`, eagerly on every open, including option-off opens. All DDL, index-reader replacement and version change
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

## Verification

Commands use a worktree-local `TMPDIR` and synthetic scripted models.

| Command | Result |
| --- | --- |
| `npm test` | Exit 0; 131 passed (Node 22.16) |
| `npm run validate` | Exit 0 (Node 22.16) |
| `npm run test:core` | Exit 0; 1,032 passed (Node 22.16) |
| `node tools/testing/run.mjs core/test/confirmation-*.test.mjs` | Exit 0; 31 passed on each of Node 22.16 and 24.15 |
| `git diff --check` | Exit 0 |
| `npm run demo:store`, `npm run demo:capture`, `npm run demo:conflicts`, `npm run demo:episodes` | Each exit 0 on Node 22.16 and 24.15 |
