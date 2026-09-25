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
records the latest checkpoint after the fresh-development terminal run; older
results and failures remain dated history, not fresh reruns. PRs #230
(`5ec4793`) and #231 (`b781a3c`) passed two independent reviews and exact-head
CI (21/21) at their recorded heads and remained open/unmerged at the last
check. PR #205's earlier 21/21 run applies to its prior head only; this docs
update still needs review and exact-head CI. Finite S1 mechanics alone are
accepted; S2–S5 remain open and no S1–S5 sequence pass is claimed.

The source-free fresh-development report SHA-256
`e8d75ac9cd0865c78777587d132eec44ee84dff0bd500afad8ffa1f310dce84d` records
that the wrapper completed six generation and six scoring records (not six
judge calls), but all 12 arm-cases were
`ingestion_incomplete`: each arm had 0 resolved, 0 correct, 0 wrong and 6
unresolved, with common N=0 and null accuracy. This is not a score. The run made
56 requests (28 count and 28 generation, no answer or judge calls), reserved
US$0.280000, recorded US$0.038510 known actual, left 28 count-route costs
unknown and had zero pending. Eight qualification-budget refusals and four
generic compiler-invalid slots were observed; their exact compiler subreason
is unknown. Do not infer a cause for R5 from these diagnostics or retry any
consumed/prior cohort. The original reserved 30-case set remains untouched.

R5 remains a separate historical failure: seven requests and US$0.035
conservatively reserved, with zero scored and six unresolved per arm. Its global
halt followed an indexed count of 8,701 exceeding the 7,024 dispatch limit; an
earlier prefix-capture failure has no retained output or subreason and remains
unknown. The audited 30-case result remains 15/8/7 and was not rerun.

The primary and independent accounting audits confirmed the old 12,646-request
prefix unchanged: 12,702 terminal requests, US$86.516460 conservatively
reserved, US$113.483540 remaining under the unchanged US$200 user ceiling, and
zero pending. The operational cap remains US$200 with a 50,000-request cap;
this is not completion of the embedding-ledger migration. Preserve at least
US$70 for comparator work and US$10 for host work. The previous 124 exclusions
plus the six consumed fresh cases remain closed in the 130-case exclusion set.

Next, complete and independently review the qualification evidence-pool repair,
which is in implementation but not accepted. Its proposal uses a pool of 1–4
source-backed candidate windows per item and reuses shared field schemas,
without extra calls, truncation or relaxed validation. A minimal synthetic wire estimate falls from 6,003 to
3,991 only in that proposal; the maximum 5×4×800 case still fails at a core-side
count of 11,348. This is not a provider-compatibility pass or quality
result. After offline acceptance, run a separately frozen small provider-
compatibility check before any future fresh development cohort. Then proceed
separately to matched Mem0 comparison, installed-growth measurement and
onboarding. No new paid call is authorized by this status update.

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
