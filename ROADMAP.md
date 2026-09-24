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
records the latest fixed checkpoint and the earlier evidence snapshots. PR #211
is ready at `632c0d8b1ad0e79ea5c9ccc8c4bbfee022d8ab9b`; CI run `36051396331`
passed 17/17, and separate Standards/Spec reviews passed with zero findings.
Its opt-in bounded transport diagnostics do not change timeout, retry, cap,
scoring or ledger behavior and do not establish provider billing or semantic
quality. S1 remains incomplete; the later S2 answer-stage, S3 matched Mem0, S4
installed-growth and S5 onboarding gates also remain open.

The next assigned offline packet is `experiment/incremental-candidate-index`,
fixed to base `c118c0f0fd70af01c63ea1339305de03eeb84c94`. Its plan and fixtures
were frozen before results at local, unpublished commit
`67815fe6db4fdd249a6c597d0804d733646eb509`
(`docs/plans/incremental-candidate-index.md`). No result-producing run is
recorded at assignment freeze; implementation is active, and any later result
requires its own verification record. It tests a synthetic bounded SQLite FTS5
sidecar against an authorized ID-keyset scan at 100/1,000/10,000 records; it is
not an accepted production selector or QA result. Verify the actual branch and
candidate diff against the frozen plan before running its ordered Node
22.16/24.15 gates.

The earlier PR #208 run `36042861159` at `f25050d` failed its Node 22
40,000-space tokenizer check at 5,048 ms against the unchanged 5-second gate.
The failure is retained with cause unknown; later green run `36045232556` does
not establish a tokenizer runtime fix. The measured retrieval candidate is
diagnostic only: target reachability in both indexed paths, alias benefit for
pure-alias queries, CJK misses and no observed MOC-first gain do not attribute
the eight historical errors or establish QA/product quality. The separate
red-base 1,025-admit control still misses its target.

No new semantic score, paid request, ledger edit, merge, release or deployment
is recorded in this checkpoint. Budget figures were not reread: last recorded
authority is US$200 cumulative, the operational ledger US$100 pending review,
and reserved spend US$79.389500. Verify the actual ledger and request guard
before any paid phase. Earlier PR #205/#208/#209/#210 head and CI details remain
in the plan and were not rechecked in this refresh.

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
