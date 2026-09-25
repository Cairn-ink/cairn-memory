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
records the current after-#221 checkpoint and retains older evidence snapshots
as historical. PRs #217–#221 are ready, open and unmerged; their recorded exact-head CI runs
passed 17/17: #217 `45eca226` / `36076692945`, #218 `330ecb1` /
`36082430474`, #219 `3bd876f` / `36083139820`, #220 `dbfe5d8` /
`36087301218` attempt 1, and #221 `a9c00a5` / `36086514751`. PR #220 is
reported ready and mergeable after both runtime matrices and independent
full-base Standards/Spec reviews passed; it is not merged. Only the finite S1
mechanical gate is accepted. This does not pass the S1–S5 sequence or establish
semantic reliability.

The terminal fresh-six development smoke on PR #217's runtime completed and
was judged 6/6 in all arms: Cairn 2 correct/4 wrong/0 unresolved, full history
3/3/0, and no memory 0/6/0. It meets only the predeclared 95% completion
checkpoint at this six-case N; it is not semantic quality, improvement,
comparator parity or installed-host evidence. The historical 30-case Cairn
outcomes remain 15 correct, 8 wrong and 7 unresolved; they were not rerun. PR
#218's Mem0 2.2.0 preflight is 16 synthetic fake-HTTP cases, not a quality
comparison. PR #220 adds opt-in indexed source windows beyond the ordinary
first-800-unit receipt prefix; the default is unchanged and synthetic mechanics
show no semantic gain. Its request-guard regression is denial-only, not a new
paid capability or request. PR #221 proves a synthetic existing-only v1→v2
embedding-ledger migration preserves history; the actual ledger did not change
and that migration establishes no paid request guard.

The last read-only accounting audit recorded US$86.171460 conservatively
reserved and 12,633 requests terminal, against the unchanged US$100 operational
cap and US$200 user ceiling. This documentation update did not inspect the
ledger or make a paid call. Verify the actual ledger and request guard before
any future paid phase; no budget increase or old-cohort rerun is authorized.
S2 answer-stage quality, S3 matched Mem0 scoring, S4 installed growth and S5
cold-context onboarding remain open. A separately versioned indexed-window
provenance plan is frozen at `3cd37a5` against PR #220; implementation has
started but is not accepted and has no public PR link yet. Versioned ingestion
and verifier work must precede scoring. Later paired fresh comparison, guarded
Mem0 routes, same-budget MOC ablation and installed growth/onboarding remain
separately gated. PR #212's incremental-index result remains a diagnostic only:
mixed query performance, lexical false positives, unsupported CJK, copied full
text and inclusive database growth do not establish a production selector or
S2 answer-stage pass. Earlier PR heads and CI details remain in the plan.

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
