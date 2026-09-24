# Roadmap

Our target is a lightweight, independently runnable memory layer with Source
Receipts. MCP is the first access surface; native providers and the commercial
service must use the same public core, not separate engines.

## Current developer preview

- Public SQLite core: capture orchestration, MOC organization, bounded recall,
  inspection, correction, deletion suppression and namespace isolation.
- Optional OpenAI adapter and thin local MCP host; an inspected local npm archive
  has passed installed subprocess persistence and actual-model sourced recall.
- Frozen synthetic evaluation and failures are retained. **Source support still
  fails**, so broad-promotion readiness is not declared.
- The [verified preview consolidation](docs/plans/pr-consolidation.md) selects
  four narrow engineering changes: filing-only rationale preservation, an
  explicit local MCP source-evidence startup default, owned provider response
  bytes, and installed cold-recall coverage, plus one direct-challenge read fix
  extracted from #136. It does not adopt the larger #142 lifecycle, the rest
  of #136 or later experimental assessment paths, or establish answer quality.
- Hermes MCP discovery is verified. The separate [native-provider candidate](https://github.com/Cairn-ink/cairn-memory/pull/25)
  passed MemoryManager lifecycle and actual-model recall on Linux CLI; interactive
  chat tool selection is not implied.

These are development candidates, not a claim that every PR has merged or a new
package has been published. The released v0.1 hosted plugin remains available;
its past hosted tests do not establish local-preview quality.

## Next gates

The next reliability design slice is the
[memory reliability contract](docs/plans/memory-reliability-contract.md): qualified
updates, current/history/change evidence, and explicit acceptance gates. It
distinguishes main from pending PRs and proposed behavior; it is not a release
claim or authorization for a paid experiment. Its staged order guides the
reliability work below without declaring older failure gates resolved.

Dated 2026-09-25: [comparative reliability milestones](docs/plans/comparative-reliability-milestones.md)
sets proposed completion, held-out comparison, installed-host, growth and preview
onboarding gates within the existing cumulative ceiling. All statuses below are
checkpointed 2026-09-25; earlier PR #202–#207 state is retained in the plan and
was not refreshed in this pass. Current verified open heads: PR #205 at
`ad45cd1` (run `36045084989`, 21/21 green), PR #208 at `c118c0f` (run
`36045232556`, 17/17 green), PR #209 at `328052a` (run `36045345343`, 17/17
green), and PR #210 at `9ac1176` (run `36047442942`, 17/17 green). PR #205's
CI applies to its remote `ad45cd1` head only; this plan update remains local
until separately reviewed and published. PR #210 is marked ready; none of these
four candidates is merged or released.

The earlier PR #208 run `36042861159` at `f25050d` failed its Node 22
40,000-space tokenizer check at 5,048 ms against the unchanged 5-second gate.
The failure is retained with cause unknown; the later green `c118c0f` run does
not establish a tokenizer runtime fix. Retrieval evidence remains diagnostic:
the measured candidate reaches its target in both indexed paths, alias
expansion helps pure-alias queries, both indexed paths miss CJK controls and
MOC-first shows no observed gain. The separate red-base 1,025-admit control
still misses its target. None of this attributes the eight historical errors
or establishes QA/product quality.

PR #210's bounded S1 slice adds read-only exact-batch admission inspection with
unknown classification and fresh current refs; it reports no old content and
adds no durable classification journal. Worker/primary checks and independent
Standards/Spec review passed on the exact 14-file candidate. S1 remains
incomplete. The next assigned, not-started packet is
`test/transport-phase-diagnostics` from base `9ac1176`: bounded opt-in
transport-phase diagnostics only, with no deadline, retry, ledger or scorer
change. It does not waive S1 or later live-benchmark, host-readiness or preview
gates.

Research remains proposal-only: 3/2,604 retained generation attempts ended in
`core_deadline` (not a scorer timeout); recorded guard durations are not
provider latency. A process-local FTS index and Mem0 source candidate still need
the preflight described in the plan; neither is a production default or
comparison result. No new semantic score, paid request or ledger change is
recorded. Budget figures were not reread for this docs update; verify the actual
ledger and request guard before any paid phase.

1. Resolve source-support and unjustified-update failures; evaluate under the
   reliability contract's frozen-case and independent holdout rules. Any paid
   rerun needs scoped authorization; earlier one-shot approvals do not roll over.
   A public LongMemEval benchmark remains a separate next gate: freeze the
   dataset, model/configuration, scorer and comparison arms, publish per-case
   failures and independently review the result. Offline scripted demos are not
   a measured score, and this baseline authorizes no paid run.
2. Review/merge the verified native-provider candidate; separately evaluate
   interactive Hermes chat and additional host/platform coverage.
3. Complete independent onboarding and propose publication with honest limits.
4. Run the [14-day adoption experiment](docs/plans/local-memory-plg.md) only after
   approval: activation and useful sourced recall first; stars are secondary.
5. Verify private consumption of a pinned public core and synthetic migration/
   rollback before proposing any production cutover.

See the [detailed delivery plan](docs/plans/delivery-roadmap.md) for dependencies
and the [launch-kit acceptance](docs/plans/local-memory-launch-kit.md).
OpenClaw, additional clients, fully local model verification, automatic local
capture and UI improvements follow their own evidence gates. Moss and shared
team knowledge are separate work. No ten-person alpha prerequisite, guaranteed
star count, hidden telemetry or automatic publication is implied.
