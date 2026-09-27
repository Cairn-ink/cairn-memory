# Reliability backlog consolidation

## Authorization and fixed inputs

The user requested handling the accumulated PR backlog after the proposed
inventory, verified integration, and closure of covered PRs. This permits this
scoped integration/merge and traceable closures after proof. It does not permit
release, deployment, production operations, paid evaluation, ledger changes,
manual branch deletion, or promotion of rejected experiments. GitHub currently
has automatic head-branch deletion after merge enabled; do not change repository
settings. Preserve local refs/worktrees and report any automatic remote deletion.

- Main baseline: `e7c4ecc47d4e632e4b78209bb3c176da7437f078` (includes #256).
- Reliability stack: `18b3226ef7dfbd201a44968e631ce3e42669d063` (#254).
- Worktree: `cairn-memory-worktrees/reliability-backlog`.
- Branch: `integration/reliability-backlog`.
- Snapshot: 74 open PRs; 59 heads ancestral to #254, 15 not ancestral.

## Acceptance contract (before implementation)

1. Preserve both baseline and stack ancestry in a merge candidate. Preserve
   main-only registry, installation, and proposed session-episode documents.
   Inspect the automatic `docs/privacy.md` reconciliation explicitly.
2. Record every frozen open PR, exact head, dependency/content classification,
   intended disposition, and evidence. Non-ancestry does not establish absence;
   ancestry alone does not prove a reverted feature is active.
3. Preserve unique historical protocol/results/plans from #181, #190, #198,
   #202, #205, #219, #247 in an explicitly historical archive with provenance.
   Do not overlay stale ROADMAP or limitations on the latest conclusions.
4. Keep independent #255 and experimental #208, #212, draft #241 separate.
   Confirm patch-equivalent #240/#242/#243 and semantic coverage of #221
   before suggesting closure. Do not silently enable installed experimental
   candidates or the rejected direct-candidate wire.
5. Verify one final integrated tree against CONTRIBUTING on Node 22.16/24.15:
   generic/JSON, core and demos, OpenAI, LongMemEval and demos, offline live,
   MCP/artifact/cache/installed rationale, budget/guard/native and mixed-native,
   strict plugin validation, and installed pinned Hermes canonical tests.
   No credentials, paid endpoints, operational data, or campaign ledgers.
   Integration regression found before freeze: the pinned Hermes capture
   recovery and qualified conversation tests still emit the retired inline
   qualification format, while the installed adapter requires evidence-pool-v1.
   Reproduce with the canonical host runner and retain the failed run. Permit
   only synthetic wire conversion using the existing qualificationPoolWire
   helper in these two tests (already available as a narrow subset of #241).
   Preserve lifecycle, receipt, source and request-count assertions; change no
   production decoder, timeout, provider response policy or #241 runtime opt-in.
   Rerun the isolated failure and the full five-file host matrix on both Nodes.
6. Freeze one candidate and run independent Standards and Spec reviews over
   the same fixed baseline/candidate. Use five review ranges (#203, #220,
   #230, #246, #254) for tractability, plus integration/archive delta; these
   are checkpoints, not five separately claimed product deliveries.
7. Push a main-target integration PR only after local verification and both
   reviews. Require all applicable latest-head remote checks, head equality,
   mergeability, and a fresh main comparison before merge. No admin bypass.
8. Close an old PR only after main contains its work or an explicit equivalent
   with a traceable link and explanation. Never manually delete branches/worktrees.
   Retain independent work. Record actual final main SHA and remaining PRs.

## Claim boundaries

This is consolidation, not a new semantic result. The latest six-type pilot
remains Cairn 0/6 resolved, Mem0 6/6 resolved with 4 correct and 2 incorrect;
there is no common-resolved accuracy claim. The direct-ID experiment remains
not promoted. No spending or retry authorization follows from a green test.

## Ownership and evidence

Primary owns contract, integration, direct inspection, key reruns and GitHub
delivery. A bounded GPT-6 Sol/high worker owns inventory/archive documentation;
two independent GPT-6 Sol/high reviewers own Standards and Spec. Prior PR test
records are historical context, not final-tree verification. Record final
commands, results and review SHAs in the integration PR and supporting record.
