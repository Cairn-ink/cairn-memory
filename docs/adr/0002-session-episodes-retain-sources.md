# Session episodes retain their own sources and obey conversation deletion

Proposed with the [session-episode contract](../plans/session-episodes.md), not
implemented behavior. Update one bounded episode on every accepted capture
batch: session-end signals can be lost, and waiting for the next session delays
both a timeline and continuity. This costs an extra bounded interpretation call
per batch and leaves provisional summaries rather than one final session report.

An episode is a model interpretation, never a current assertion. Retain selected
source receipts with it even when no memory is admitted; expiring staged evidence
cannot support a durable quick-question episode. This intentionally extends local
personal-data retention, so enable it explicitly, bound each record and disclose
that it is a rolling sourced summary rather than a transcript archive.

Deleting an episode means deleting that captured conversation and forgetting its
derived memories through existing suppression, including deduplicated multi-source
memories. This can discard useful independent evidence, but avoids retaining the
conversation as a paraphrase after its deletion. Ordinary memory correction or
forgetting invalidates dependent episode interpretations/sources; existing broad
staged-evidence fences remain. Source lineage and tombstones make this storage and
privacy choice costly to reverse; neither hiding a summary nor historical
retirement substitutes for forgetting. Backups and provider copies retain their
existing logical-deletion limitations.
