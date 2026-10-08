# Roadmap

Our target is a lightweight, independently runnable memory layer with Source
Receipts. MCP is the first access surface; native providers and the commercial
service must use the same public core, not separate engines.

> **Reliability backlog consolidation.** This integration contains the
> #254 reliability stack and preserves unique historical PR documents; see the
> [consolidation contract](docs/plans/reliability-backlog-consolidation.md) and
> [frozen inventory](docs/plans/reliability-backlog-inventory.md). The
> [integration delivery record](https://github.com/Cairn-ink/cairn-memory/pulls?q=is%3Apr+head%3Aintegration%2Freliability-backlog)
> is authoritative for delivery status, whether open or closed. Dated candidate,
> CI, and “unmerged” notes below are historical checkpoints, not current GitHub
> status. This integration alone establishes neither semantic acceptance nor an npm
> release.

## Current developer preview

- The [fresh thirty-case development pilot](docs/plans/fresh-thirty-results.md)
  has now obtained durable full-denominator comparison results; primary and two
  independent result audits passed. Documentation review/delivery remain
  pending. Cairn is 13/10/7 and Mem0 21/8/1 correct/incorrect/unresolved at fixed
  N=30, with generation completion 23/30 versus 29/30. The common-resolved 23
  cases yield 13 versus 17 correct, not Mem0's overall 21/29 conditional score.
  Five types have six cases each; preferences are not sampled. No retry,
  replacement or runtime change occurred. This is development evidence, not
  the full official benchmark, independent holdout, competitive parity or
  achieved reliability. The prior N12 six-case 3/6 versus 4/6 result stays separate.

- The [offline long-history stage gate](docs/plans/long-history-stage-gate.md)
  locates loss across public capture, cold receipts, candidate map, selection,
  ranking, final recall and answer packing on finite synthetic families. It
  preserves the default-prefix miss as an expected negative control and
  exercises explicit bounded keyset source routing. Real-model and installed
  host acceptance, semantic/current-state quality, and a fresh paired paid
  comparison remain separate gates.

- The [test workspace lifecycle gate](docs/plans/test-workspace-lifecycle.md)
  checks fresh invocation-owned scratch through real offline fixtures and
  subprocess success, failure and Linux termination on Node 22.16 and 24.15.
  Canonical test commands dispose scratch after resources stop; direct Node
  commands, detached sessions, SIGKILL and host crashes remain outside that
  guarantee. Public retained evidence and historical cleanup are separate.

- The explicit [indexed-evidence comparison profile](docs/plans/indexed-evidence-comparison.md)
  uses the same public core and pinned native comparator without qualification.
  Its [four-case real-model long-history pilot](docs/evidence/long-history-live-pilot.md)
  completed all eight arms and judgments (Cairn 3/4, Mem0 2/4 correct;
  common resolved N=4). One Cairn answer omitted a changed premise and need
  for reconfirmation despite selected source receipts containing the premise
  update. These authored diagnostic cases do not establish comparative
  superiority, default MOC navigation or installed MCP/Hermes reliability.
  The separate [fresh six-type official indexed-evidence packet](docs/evidence/indexed-evidence-official-six.md)
  had six ready source preparations, but the one-shot run failed the frozen
  completion/paired-scoreability gate: Cairn 5/6 ingestions and answers,
  Mem0 6/6, common resolved N=5. Judgments were Cairn 3/2/1 and Mem0 3/3/0
  correct/incorrect/unresolved. One Cairn capture timed out; the cause remains
  unproven. That packet failed its own fixed-30 expansion gate. Its timeout,
  empty multi-session retrieval and temporal evidence path remain retained
  failures, separate from the later fresh-30 development record above.
  Default MOC and product semantic gates remain open.

- The [fresh official-six v3 observation](docs/evidence/qualification-official-v3.md)
  halted during generation: six planned cases and twelve arms retain one
  completed, five failed and six blocked outcomes. Mechanical completion and
  paired scoreability failed; scoring never ran and there is no new accuracy.
  At that original checkpoint one embedding request was pending. A separately
  authorized later settlement marked it `unknown` without changing its
  reservation or the halted observation; `open` ledger state is not resume
  authority.
  Canonicality and slot-mapping boundaries remain under diagnosis. The opt-in
  indexed-evidence core slice was independently planned before this halt and
  remains an experiment, not an adopted remedy. Separately review future
  protocol, resource and fresh cases only after accounting is safe. No consumed
  case replay, replacement or old-run resume is authorized; its failed gate
  did not authorize the separately frozen later fresh-30 development packet.

- The [fresh qualification meaning diagnostic](docs/evidence/qualification-meaning-probe.md)
  completed 24/24 attempts and 31 cards, but adjudicated full-six semantic success
  was 13/24. False observation/fact commitment, claimant/time omissions and an
  exact-anchor failure remain; clarified guidance is not a semantic validator.
  The later indexed-evidence official-six packet missed its 6/6 completion and
  common-resolution gate, while source fidelity remains an unresolved product
  gate. No consumed cohort tuning/replay or reliability/promotion claim. Its
  source-only operator and resource projection were reviewed before dispatch;
  its own expansion gate remains failed. The later fresh-30 development record
  does not repair that cohort. Ordinary installed Hermes/MCP is a separate gate.

- The [paired ingestion semantic probe](docs/evidence/ingestion-semantic-probe.md)
  concludes **do not adopt combined**: mechanical completion was 23/24 baseline
  and 24/24 combined, but useful coverage was 19/24 and 18/24, failing the frozen
  adoption hypothesis. Strict all-six agent-rated success was 11/24 and 12/24;
  same-model-family judgments and two repetitions per synthetic scenario do not
  establish broad superiority. The prior offline multi-source fit refusal and
  1,024-token output limit remain. No engine or default changes.

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
  mechanical gate was accepted at that checkpoint; PR #216 was then unmerged.
  No paid model, natural tool selection or semantic reliability follows from
  that gate.

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

For the latest fresh-30 development evidence, prioritize the seven execution
failures separately from ten completed-but-incorrect Cairn answers. First
review bounded ingestion, classification and cooperative timeout behavior in
the existing engine, preserving validation and committed partial-admission
semantics. Then diagnose the temporal evidence chain through retention,
candidate reachability, selection and answer use (observed 0/6 versus Mem0
3/6, not a population guarantee). Deterministic regressions and independent
review precede one newly frozen fresh comparison; no parity/100% target is
predeclared and no future paid experiment is granted or started here. Keep
ordinary installed MCP/Hermes, lightweight cost/growth and onboarding gates.
The dated cohorts below remain history, not permission to replay them or a
claim that the new development comparison has completed the product goal.

1. Resolve source-support and unjustified-update failures; evaluate under the
   reliability contract's frozen-case and independent holdout rules. Any paid
   rerun needs scoped authorization; earlier one-shot approvals do not roll over.
   A public LongMemEval benchmark remains a separate next gate: freeze the
   dataset, model/configuration, scorer and comparison arms, publish per-case
   failures and independently review the result. Offline scripted demos are not
   a measured score, and this baseline authorizes no paid run.
   The ingestion probe sequences a separate semantics-preserving repeated-field
   reference fix, then clarification of nondecision commitment, claimant and
   time preservation, and scalable bounded ingestion/output capacity. Preserve
   pool uniqueness, all bounds and foreign-citation rejection. After offline
   checks and independent review, freeze NEW held-out paid cases with a new
   reviewed operator manifest and current cumulative budget audit. Earlier
   US$200 checkpoints are historical; the fresh-30 checkpoint records US$400
   authority, US$308.817185 reserved and US$30 protected. The completed
   one-shot manifest supplies no additional
   dispatch or consumed official-case replay. Only after completion
   gating return to an official-style Cairn/Mem0 fixed-N score, then ordinary
   installed Hermes/MCP validation. Post-hoc commitment sensitivity and fewer
   requests do not replace the failed frozen coverage gate or finish reliability.
   The planning-only mixed resource projection adds an isolated OpenAI adapter
   dependency prerequisite to the LongMemEval CI job. PR243's first Node24
   LongMemEval run (`36263553569`) failed without it; the paired Node22 leg was
   cancelled. Installing the existing locked dependency set repairs that test
   gate, not semantic readiness, real resource fit or paid-run authorization.
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
   separately authorized fixed pilot; at that halted-run checkpoint no new
   paid run, automatic retry or new session was authorized. Do not treat an increased
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
   The [controlled mixed runner candidate](docs/plans/mixed-comparison-runner.md)
   adds source-only Cairn/Mem0 preparation, actual-core/native fake-HTTP local
   integration and fixed-N official-style scoring as a separate offline gate.
   It does not supply an operational credential broker, prove source selection
   or model answers, or authorize a paid cohort. Its synthetic pre-grant demo
   and explicit pinned-native local test must not be conflated with a score.
   A fresh [six-batch synthetic canary](docs/evidence/qualification-canary.md)
   has since completed one paired question; this is technical feasibility,
   not a benchmark result or repair of the earlier failed cases. The later
   [fresh six-type official pilot](docs/evidence/qualification-official-pilot.md)
   completed without a global halt but Cairn answered 0/6 and left all six
   judgments unresolved; Mem0 answered 6/6 with four correct and two
   incorrect, leaving common resolved denominator 0/6. That failed gate did
   not authorize a fixed-30 comparison. The context-fit capacity boundary has been
   reproduced offline, and the [bounded qualification partition](docs/plans/bounded-qualification-partitions.md)
   passed engineering gates; neither establishes semantic accuracy or a paid
   result. Qualification slot mapping and source fidelity still need separate
   falsifiers and a reviewed product correction. The later opt-in
   [indexed-evidence official-six packet](docs/evidence/indexed-evidence-official-six.md)
   also failed its 6/6 completion and common-resolution gate. Diagnose its
   timeout and evidence-sufficiency misses offline; do not replay consumed cases.
   The [direct candidate-ID wire experiment](docs/plans/direct-candidate-wire-experiment.md)
   is offline-only and recommends revision, not production adoption: its
   synthetic five-item intermediate case increases qualifier pairs from one
   to five despite a smaller compact output. Source semantics and the earlier
   slot failures remain unresolved.
   Installed Hermes, MOC candidate visibility, source fidelity and lightweight
   latency/request/cost gates remain separate.
2. Use the merged native provider and the consolidated deadline/recovery
   implementation as the baseline for further installed-host and interactive
   validation. The separately frozen
   [six-case development smoke](docs/fresh-reliability-smoke.md) reached a
   [terminal scored result](docs/evidence/fresh-reliability-smoke.md) on
   2026-09-25: all three arms generated and judged 6/6 answers (Cairn 2/4/0,
   full history 3/3/0, no memory 0/6/0 correct/wrong/unresolved). This earlier
   default-core development cohort is not the later official-six qualification
   pilot and does not establish semantic acceptance or installed-host readiness.
   Evaluate interactive Hermes chat and additional host/platform coverage
   separately from the development smoke.
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
