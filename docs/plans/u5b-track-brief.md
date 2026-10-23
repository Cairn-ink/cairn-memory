# U5b track brief (for a second coordinating session)

Owner of this track: a second Claude Code session, the **U5b coordinator**.
Integration owner (sole merger into `integration/unified-memory-v1`): the
first session, the **primary**. Written 2026-10-23.

## Read first
1. `docs/plans/memory-next-stage-charter.md` on this branch
   (`experiment/hybrid-retrieval-hr1`). It holds goals, boundaries and
   decisions. Do not edit it; the primary owns it. Keep your own log in
   `docs/plans/u5b-track-log.md` on this branch, and commit and push that file only.
2. The contract `docs/plans/unified-memory-v1-contract.md` on
   `integration/unified-memory-v1-u5a`, especially §13 (U5a, which is done) and §§1–2.
3. The repository traps:
   `/home/chichieh/cairn-memory-umv1/.research-private/dispatch/TRAPS.md`.

## Scope of this track
1. **HR-2 research.** Under a fixed token budget, does layered,
   coverage-first assembly fit more required evidence than top-k full
   text? The plan is in charter §6 ("HR-2 計畫草案"); the user approved it
   on 2026-10-23. It needs no model and no money. Reuse the frozen HR-1
   fixture and rankings in `evaluation/retrieval-research/`, and work on a
   new branch `experiment/hr2-assembly` cut from this branch. Freeze the
   protocol before running, and have it audited by a non-author.
2. **U5b contract.** M7 budgeted assembly on top of U5a's
   `findCandidates`/`fetchCandidateEvidence`: the `contextRead()` facade
   reserved in §13; representations; coverage-first-then-deepen; source
   dedup; shared metering with existing packing. Defaults come from the
   HR-2 evidence. Write it as a new contract section (§15), audited by a
   non-author Codex, on your own branch.
3. **U5b implementation.** Do this after the contract is confirmed: a
   Codex worker, then dual non-author review, then your
   CI-equivalent acceptance.

## Branches and worktrees
- Base engineering work on `integration/unified-memory-v1-u5a` at
  `389512d` or later. Create **your own** branch, for example
  `integration/unified-memory-v1-u5b`, and your own worktrees under
  `/home/chichieh/cairn-memory-u5b*`.
- Never edit, rebase or commit to these branches:
  - `integration/unified-memory-v1`
  - `integration/unified-memory-v1-u5a`
  - `integration/unified-memory-v1-u4b`
  - `release/v1-preview`
  - the other session's `feat/*` chain
- Hand off by telling the user that your branch is ready at a commit. The
  primary merges it.
- Shared files need coordination through the user before you change them:
  `core/contract.mjs`, `core/database.mjs`, `adapters/mcp/cli.mjs`,
  `adapters/mcp/server.mjs`, `packaging/artifact-files.json`,
  `CHANGELOG.md` and `docs/limitations.md`. Keep edits there minimal and
  additive.
- You may push your own branches to origin. Do not open or merge PRs
  without asking the user, and do not comment on others' PRs.

## Dispatch rules (same as the primary)
- Delegate to Codex, not Claude subagents:
  ```
  codex exec -m gpt-6.1-sol -c 'model_reasoning_effort="xhigh"' \
    --ignore-user-config --disable hooks -s <read-only|workspace-write> \
    -C <worktree> --json -o <dir>/last.md - < <dir>/prompt.md
  ```
  - Resume a worker with `codex exec resume <thread>`, passing
    `-c 'sandbox_mode="…"'`.
  - Launch long jobs with `setsid -w`, so they survive a session restart.
  - Keep dispatch records in `<worktree>/.research-private/dispatch/<name>/`.
- **Review**: two non-author reviewers (Spec, Standards), each on a
  clean detached worktree of the exact commit. Never let a reviewer read
  a worktree that a worker is editing.
- **Acceptance**: run outside the sandbox with
  `/tmp/claude-1000/-home-chichieh-cairn-memory/e7bc6894-2b04-4de0-a5e2-78112847aff1/scratchpad/acceptance/ci-matrix.sh <worktree> <outdir>`.
  Install `adapters/mcp`, `adapters/openai` and `tools/plugin-validation`
  with `npm ci --offline --ignore-scripts` first.
  - Node 22.16.0 and 24.15.0 are both required.
  - Rerun a load flake in isolation before calling it one.
  - The machine is shared with up to four other workers, so expect load.
- **Paid API**: do not spend unless the user approves. HR-2 needs none.
  Never give a key to a Codex worker.
- Report every result honestly, with actual exit codes, and keep failures.
