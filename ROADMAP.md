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

Dated 2026-09-25: the [comparative reliability milestones](docs/plans/comparative-reliability-milestones.md)
records the latest after-#229/R5 checkpoint and preserves earlier results as
history. PR #228 (`a5d76b3`, CI run `36109490910`) and PR #229 (`d302abe`, CI
run `36112167726`) each have a recorded exact-head 17/17 pass and were open,
unmerged at last check. This is not a fresh audit of every earlier PR. Finite
S1 mechanics are accepted within their bounded scope; S2–S5 remain open. No
S1–S5 sequence pass is claimed.

The R5 run stopped before scoring: seven requests, US$0.035 conservatively
reserved, zero scored and six unresolved cases per arm. Unresolved is not a 0%
accuracy score. Its global halt followed an observed indexed count of 8,701
exceeding the 7,024 bounded dispatch limit. A separate earlier prefix-capture
record is labeled `invalid_model_output` / `ingestion_incomplete`; no output or
subreason was retained, so that prefix failure's exact cause is unknown. Do not
retry this consumed six-case roster or prior cohorts; the reserved 30-case set
remains untouched. The historical audited 30-case results remain 15 correct,
8 wrong and 7 unresolved.

The latest independent read-only accounting audit recorded 12,640 terminal
requests, US$86.206460 conservatively reserved and zero pending. The cumulative
user ceiling remains US$200; the operational cap has been atomically extended
from US$100 to US$200 with a 50,000-request cap. This is not the separate
embedding-ledger migration, which remains incomplete. Keep at least US$70 for
comparator work and US$10 for host work. No additional paid request, cohort
retry, merge or release is authorized by this status update.

A primary offline budget-boundary control through the real core, adapter and
fake-HTTP guard produced one pass and one red on both Node 22.16 and 24.15. In
each of four source turns, source text length increased from 113 to 114 UTF-16
units. For the 114-unit fixture, the local partial preflight counted
2,379 while full wire serialization was 7,032. This demonstrates an analogous
schema-budget gap; it does not explain R5's distinct 8,701-over-7,024 global
halt or the earlier prefix failure. The budget repair is in progress but not
accepted; source-free observability is not implemented. Next: finish and accept
the offline fix/diagnostic, separately freeze and pass a small synthetic
real-API compatibility/count check within the existing authority, freeze a separate
fresh development cohort without old retries, run a matched Mem0 comparison,
then measure installed growth and onboarding. Protect the comparator and host
reserves; none of these steps is a result yet. This documentation update makes
no provider call and does not itself establish API compatibility.

The older after-#221 accounting, smoke completion, synthetic Mem0/index-window
results and embedding-migration mechanics remain in the plan as historical
evidence, not current status or quality claims. PR #212's incremental-index
result remains diagnostic only; its mixed query performance, lexical false
positives, unsupported CJK, copied full text and inclusive database growth do
not establish a production selector or S2 answer-stage pass. Earlier PR heads
and CI details remain in the plan.

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
