# CF-1: confirmation state appendix

Status: proposed contract; implementation and tests are not yet present.

Extends [session episodes](session-episodes.md). Acceptance: cairn-wiki
`origin/main:docs/plans/one-brain-u6.md`, D1, D6 and CF-1; one-brain-v1,
decision 5. Implementation base: `c558593bd7dc4700a09235aeb8ebbd93184a0ea4`.

## State and admission

Opt in with `decisionReview: 'required-v1'`. Review state is `none`, `awaiting`
or `confirmed`, independent of currentness and filing. Existing rows get `none`.
Only inferred decisions admitted through capture/admission jobs wait. Explicit
`remember`/`admit` and other kinds retain their existing behavior. Manual trusted
admission jobs use the same inferred-admission semantics as capture.

**Admission limitation requiring chichi's decision:** today's extractor and
qualification contracts do not distinguish a person's direct decision from an
assistant's inference. A user-role source is not proof that the extracted claim
was stated directly. This packet does not invent that proof or change prompts.
Consequently every automatically captured decision waits when opted in, including
paraphrases of direct statements. Explicit host-authorized remember/admit is the
existing way to record direct statements as explicit. Chichi must decide whether
to enable this conservative behavior or commission a provenance contract first.

An inferred duplicate attaches evidence and keeps awaiting; it cannot demote an
explicit or confirmed item. An explicit duplicate promotes an awaiting item to
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
Opted-in memory DTOs expose `reviewState`; option-off DTOs retain existing shape.
Review pagination binds its selection so cursors cannot cross visibility modes.

Awaiting rows retain admission lineage, source receipts and episode links for
lifecycle cleanup, but cannot be placed, classified, corrected, superseded,
qualified-transitioned or used as rationale targets until resolved. Forget is
still allowed, including forgetEpisode, which follows physical links and forgets
awaiting descendants with suppression. Source snapshots exclude awaiting items.

Episode prose and retained passages cannot reliably be separated into confirmed
and awaiting assertions. Conservatively hide an episode from list/get/start
context while it has a live awaiting memory link, including passages borrowed
from such episodes. Physical links and episode mutation APIs remain intact so a
person can delete a conversation by its known identity. This may temporarily hide
unrelated episode content; confirmation/promotion restores reader eligibility.

## Confirm and reject

`confirm({namespace,memoryId,expectedRevision,actionId,receipt})` requires a user
receipt and the option. It only accepts awaiting current items, increments the
revision, retains `agent-inferred`, sets `confirmed`, attaches the confirmation
receipt without replacing source receipts, and updates index eligibility and the
namespace epoch in one transaction. It does not reuse correct. It leaves filing
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

Schema v18 adds review_state and the action ledger, eagerly on every open,
including option-off opens. All DDL, index-reader replacement and version change
are transactional; any failure rolls back. v17 and older openers refuse v18.
Index readers and rebuild eligibility exclude awaiting rows; promotion inserts
into a published projection atomically even when it was previously absent.
No migration reclassifies existing rows or changes their revisions or epochs.
With the option absent, existing fixture API/model bytes stay identical
(excluding generated IDs and clock values, as existing parity fixtures do).
New schema columns are additive storage metadata, not legacy DTO fields.
Option-off openers cannot explicitly expose or resolve awaiting rows.

## Acceptance mapping

`core/test/confirmation-state.test.mjs` covers state independence, admission and
its direct-statement limitation, duplicate and mixed-batch behavior, every reader,
classification and lifecycle paths, confirmation/rejection receipts, suppression,
replay and revision conflicts. Migration tests inject a DDL failure and exercise
an actual v17 opener against v18. Parity tests execute existing synthetic fixture
workflows against the recorded base and this implementation with the option off.
