# Session episodes retain their own sources and obey conversation deletion

Proposed with the [session-episode contract](../plans/session-episodes.md), not
implemented behavior. Draft first capture, then debounce by accepted batch count
(default eight), coalescing PreCompact, available end and next-capture catch-up
triggers. This limits ordinary per-conversation cost while retaining quick-question
handling and interruption recovery without relying on end signals. The contract
bounds repeated triggers and records delayed/omitted coverage. Reads never draft.
Episode failure falls through to ordinary memory admission, with an inspectable
gap and retained staging; prior context is trimmed oldest-first within the budget.
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

Episode-mode staging releases text/quota atomically once admission and durable
selected-passage disposition complete. The 24-hour ceiling then applies only to
unresolved payloads; completed captures do not consume a daily staging allowance.
Content-free replay fences remain, and ordinary staged-v1 behavior is unchanged.

Deleting an episode means deleting that captured conversation and forgetting its
derived memories through existing suppression, including deduplicated multi-source
memories. This can discard useful independent evidence, but avoids retaining the
conversation as a paraphrase after its deletion. Ordinary memory correction or
forgetting invalidates dependent episode interpretations/sources; existing broad
staged-evidence fences remain. Source lineage and tombstones make this storage and
privacy choice costly to reverse; neither hiding a summary nor historical
retirement substitutes for forgetting. Backups and provider copies retain their
existing logical-deletion limitations.
