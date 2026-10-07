# Session episodes retain their own sources and obey conversation deletion

**Partial supersession (2026-10-07):** D5 in cairn-wiki ADR 0006 and the decided
[raw-layer contract (RL-0)](../plans/raw-layer-contract.md) replaces the
multi-source deletion choice below. RL-2 deletes raw/episodes and suppresses
memories derived only from that conversation; memories with other live sources
stay without the deleted receipts. Their wording may have come from the deleted
conversation; chichi accepted that trade-off to preserve independently supported
memories. Until RL-2 ships, the legacy runtime still uses the old rule. Bounded
episode citations, staging and their retention rules remain as described here;
raw adds a separate archive with no automatic expiry.

Proposed with the [session-episode contract](../plans/session-episodes.md), not
implemented behavior. Draft first capture, then debounce by accepted batch count
(default 8, allowed range 2–16), coalescing PreCompact, end and next-capture catch-up
triggers. This limits ordinary per-conversation cost while retaining quick-question
handling and interruption recovery without relying on end signals. The contract
bounds repeated triggers and records delayed/omitted coverage. Reads never draft.
Episode failure falls through to ordinary memory admission, with an inspectable
gap and bounded staging; prior context is trimmed oldest-first within the budget.
Only a freshly classified quick batch skips extraction; non-drafted batches
always receive normal extraction regardless of the previous episode's label.

An episode is a model interpretation, never a current assertion. Retain selected
source passages with it even when no memory is admitted; expiring staged evidence
cannot support a durable quick-question episode. This intentionally extends local
personal-data retention: core is opt-in. The one-brain configuration is the product
setup in which one person's Claude Code, Codex and chat tools share one memory;
it enables episodes by default with automatic capture and discloses retention.
Bound each record and describe it as a source-anchored rolling interpretation,
not a transcript archive or an assessed claim.

Episode-mode staging normally releases text/quota atomically once admission and
durable selected-passage disposition complete. Under pressure, release the oldest
admitted payloads awaiting only episode interpretation, recording coverage gaps.
If capacity still fails, register/admit new input normally without episode staging
and record that gap too. Protect unadmitted payloads; episode-only capacity may
never stop ordinary admission. The 24-hour ceiling bounds live payloads, not a
guaranteed minimum: pressure can release them earlier. Content-free replay fences
remain; released inspection has no active expiry. Ordinary staged-v1 is unchanged.

The original deletion choice was: deleting an episode means deleting that
captured conversation and forgetting its derived memories through existing
suppression, including deduplicated multi-source
memories. This can discard useful independent evidence, but avoids retaining the
conversation as a paraphrase after its deletion. Ordinary memory correction or
forgetting invalidates dependent episode interpretations/sources; existing broad
staged-evidence fences remain. Source lineage and tombstones make this storage and
privacy choice costly to reverse; neither hiding a summary nor historical
retirement substitutes for forgetting. Backups and provider copies retain their
existing logical-deletion limitations.
