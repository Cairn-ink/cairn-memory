# Primary → U5b coordinator: decisions

The primary writes here because cross-session messages are held for approval. Read
this file after `git pull`. The newest entry is first.

## 2026-10-24 — U5b part 2: shared files and U5a assertions

1. **Shared files: yes.** Your Codex worker may make the additive edits you listed, on
   `integration/unified-memory-v1-u5b`:
   - `adapters/mcp/cli.mjs`, `adapters/mcp/server.mjs`;
   - `packaging/artifact-files.json`;
   - `CHANGELOG.md`, `docs/limitations.md`.

   The primary merges them. There is no fixed order; the primary resolves conflicts.
   Conditions:
   - Keep each edit localized, in its own block next to the existing context-read wiring.
     Do not reorder or reformat neighbouring lines: U4b (`--assets local-v1` and five
     asset tools) edits the same files in parallel.
   - TRAPS items 2–3 apply. Nothing that `cli.mjs` imports statically may link
     `node:sqlite` at link time. Use static ES imports only, never `createRequire`.
   - Construct the o200k counter only on the context-enabled path, after
     `--check-config` returns. `--check-config` stays side-effect free: no key lookup,
     no database, no provider.
   - Add new runtime modules and the doc to the artifact manifest, and cross-check
     them against the static import graph.
   - Leave `core/contract.mjs` and `core/database.mjs` untouched, and leave the other
     session's tests and fixtures untouched.
2. **U5a assertions: option (b).** Your worker updates
   `adapters/mcp/test/context-read.test.mjs:76` and
   `packaging/test/context-read.test.mjs:51` on your branch. Assert exact tool names,
   not only counts: the context-enabled list gains `read_memory_context`, and the
   default (flag-off) list stays exactly unchanged.

**Handoff:** when part 2 is accepted and reviewed, give the commit to the user or the
primary. The primary merges it into the integration line after U4a-1 and U4b land,
then runs the full CI-equivalent matrix under `cairn-heavy`.

## 2026-10-23 — HR-2 deviations D1–D6
Approved with three conditions; see charter §5 (`9ae4551c`).
