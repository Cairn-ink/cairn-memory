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
records the current after-#216 checkpoint and retains older evidence snapshots
as historical. PRs #213–#216 are ready, open and unmerged; PR #216 at `2b24674`
passed 17/17 exact-head CI checks in run `36072917284`. The finite S1 mechanical
repair/recovery gate is accepted on the current candidate after independent
Standards/Spec review, read-only acceptance audit and 22 installed pinned-Hermes
tests on each of Node 22.16 and 24.15. This covers observable partial admission,
bounded source refs, explicit guarded recovery and correction/deletion/namespace
fences. It does not establish semantic reliability or an S1–S5 sequence pass.
Repeat-safe recovery protects stored state, not exactly-once provider cost.

The next packet is a separately frozen six-case development plumbing smoke,
one case per question type after excluding 82 previously reserved or used cases.
Its local, unpublished plan is frozen at `6287e1e` with pricing record
`658b3ba`, fixed to `2b24674`; GPT-6 Sol/high owns implementation. No paid run
has started. The phase cap is US$12 and 2,000 requests; the source-only projection
of 1,172 requests and US$6.781960 is neither spending nor a wall-clock estimate.
The smoke uses embedded default-core capture/recall, not the native v2,
whole-capture-deadline or explicit-recovery live-model path. S2 answer-stage,
S3 matched Mem0, S4 installed growth and S5 cold-context onboarding remain
pending; the historical 30-case Cairn outcomes stay 15 correct, 8 wrong and
7 unresolved.

The latest read-only accounting checkpoint recorded US$79.389500 reserved and
11,461 requests terminal, with the US$100 operational ledger limit and US$200
user cumulative ceiling unchanged. Verify the actual ledger and request guard
before any paid phase. No new semantic score, paid request, ledger edit, old-cohort
rerun, merge, release or deployment is recorded. PR #212's earlier synthetic
incremental-index result remains a diagnostic: its mixed query performance,
lexical false positives, unsupported CJK, copied full text and inclusive
database growth do not establish a production selector or S2 answer-stage pass.
Earlier PR heads and CI details remain in the plan as dated records.

Historically, the earlier PR #208 run `36042861159` at `f25050d` failed its Node 22
40,000-space tokenizer check at 5,048 ms against the unchanged 5-second gate.
The failure is retained with cause unknown; later green run `36045232556` does
not establish a tokenizer runtime fix. The measured retrieval candidate is
diagnostic only: target reachability in both indexed paths, alias benefit for
pure-alias queries, CJK misses and no observed MOC-first gain do not attribute
the eight historical errors or establish QA/product quality. The separate
red-base 1,025-admit control still misses its target.

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
