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
records the latest fixed checkpoint and earlier evidence snapshots. PR #212 is
ready, open, unmerged and mergeable at `a6f8bfc3176f9ca8f64ebbcd888e58a920b5e3da`;
CI run `36056945007`, attempt 1, passed 17/17, and full-base Standards/Spec
reviews passed with zero findings. Primary generic (127/127), JSON and strict
plugin checks passed on Node 22.16 and 24.15 on a runtime-identical candidate.
The synthetic incremental-index CLI passed at 100/1,000/10,000; its mixed query
performance, lexical false positives, unsupported CJK, copied full text and
inclusive database growth do not establish a production selector, semantic QA
or S2 answer-stage pass. S1, S2 answer-stage, S3 matched Mem0, S4 installed
growth and S5 onboarding remain open.

The next assigned S1 packet is `feat/capture-classification-journal`, fixed to
PR #211 base `632c0d8b1ad0e79ea5c9ccc8c4bbfee022d8ab9b`, owner GPT-6 Sol/high.
Its frozen contract lives at
`docs/plans/capture-classification-journal.md` in the local, unpublished
`capture-classification-journal` worktree (freeze
`c4dd8850e435bf3752b52f6a72154ef56aeed100`, plus manifest clarification
`6ea5b90`). CJ1–CJ6 cover a source-free initial-classification journal,
transactional admission/placement, v13-to-v14 migration and opt-in cold
inspection; default and legacy/manual records remain unknown. It is assigned,
not implemented or verified. Do not claim an S1 pass. Deadline/recovery and
fresh frozen semantic-comparison gates remain later work.

Budget was not reread: last-recorded authority is US$200 cumulative, operational
ledger US$100 pending review, and reserved spend US$79.389500. Verify the actual
ledger and request guard before any paid phase. No new paid call, ledger edit,
old-cohort rerun, merge, release or deployment is recorded.

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
