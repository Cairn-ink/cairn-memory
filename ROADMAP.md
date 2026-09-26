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
- The dependent [native deadline and recovery candidate](docs/plans/hermes-capture-recovery.md)
  passed an offline pinned-Hermes MemoryManager and scripted AIAgent dispatch
  gate on Node 22.16 and 24.15 against a hash-checked installed archive with
  fake provider responses. Capture's invocation deadline and admission
  inspection/classification are explicit profile opt-ins. Independent review
  and all 17 exact-head CI checks passed for the candidate. The finite S1
  mechanical gate is accepted; the PR remains unmerged. No paid model,
  natural tool selection or semantic reliability follows from that gate.

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

1. Resolve source-support and unjustified-update failures; evaluate under the
   reliability contract's frozen-case and independent holdout rules. Any paid
   rerun needs scoped authorization; earlier one-shot approvals do not roll over.
   A public LongMemEval benchmark remains a separate next gate: freeze the
   dataset, model/configuration, scorer and comparison arms, publish per-case
   failures and independently review the result. Offline scripted demos are not
   a measured score, and this baseline authorizes no paid run.
   The separately versioned offline three-arm comparison and string-reference
   official-style scorer now have synthetic integration coverage; without the
   optional sidecar below, non-string reference parity remains unresolved.
   An opt-in evaluator-only Python reference sidecar addresses original-number
   and array formatting; its synthetic parity is not a corpus-quality result.
   Stage-bound transport and a public pilot runner are available as development
   candidates. The [retained v2 halted-run record](docs/plans/public-pilot-v2-halted-results.md)
   documents the fixed-six packet, frozen conditional seventh and `commonN=0`;
   no score is available.
   The [classification diagnosis plan](docs/plans/classification-count-diagnostics.md)
   motivated a classification-only
   [request-local wire repair](docs/plans/classification-wire-aliases.md) that
   preserves candidate coverage and all existing caps/policies while reducing
   repeated UUID literals in offline local-tokenizer/fake-HTTP checks. The
   historical provider count and cause remain unknown; this is not a recovered
   score or proof that a future pilot will complete. The offline deadline
   diagnosis records one 30,000 ms deadline per model call across that call's
   count and generation, separate extraction/classification calls and a
   separate 60,000 ms guard deadline; it does not establish a provider cause or
   fix. Focused and live-offline safety gates pass on both Node 22.16 and 24.15.
   Independently review a new prospectively frozen policy/protocol before any
   separately authorized fixed pilot; under the current halt, do not start a
   new paid run, automatic retry or new session, and do not treat an increased
   timeout as a proven remedy. The
   [benchmark count diagnostic](docs/plans/guard-count-reason.md) preserves a
   future structurally validated count without changing the adapter, ceiling or
   halt policy; it is observability, not the repair or proof that a pilot is
   ready. Then run a separately frozen and authorized fixed pilot before broader
   architecture work.
   Preserve the original failed run and spending; offline tests are not scores.
   The separate [contained native Mem0 gateway candidate](docs/plans/mem0-native-gateway.md)
   has a synthetic no-optional-spaCy preflight gate in its inspected artifact,
   hashed configuration and child startup. Its immediate owned-group abort
   policy addresses a retained bwrap startup race: an earlier Node 24 local
   gate failed 7/8, and controlled TERM/KILL plus actual-kernel regression
   evidence is recorded in the plan. Its real pinned local fake-provider
   tests are an engineering gate only; matched-resource comparison, semantic
   quality, a paid grant and broad-promotion readiness remain unestablished.
2. Review/merge the verified native-provider candidate and its dependent
   native deadline/recovery candidate. The separately frozen
   [six-case development smoke](docs/fresh-reliability-smoke.md) now has a
   synthetic, guarded wrapper; its fresh real-model result remains pending.
   Evaluate interactive Hermes chat and additional host/platform coverage
   separately.
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
