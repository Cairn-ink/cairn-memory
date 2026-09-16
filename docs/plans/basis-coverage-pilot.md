# Bounded source-by-source decision-basis comparison

Base: `3c7b9ee322a52b6af12ac169eddf1e75eea0a1f9` (origin/main).
Independent of unmerged PR137. No merge, release, deployment or runtime default.

## Acceptance

- BC1: Implement an evaluation-only two-stage workflow using existing
  `reviewSourceBasis` / `compileDecisionBasis`, original quote-based units and
  unchanged adapter/schema. Baseline reviews both source memories once.
  Coverage arm reviews each of the two memories separately, then reviews the
  original complete pair with the compiled local units as explicitly untrusted
  suggestions. Each local pass is recorded even when empty; it does not prove
  semantic completeness. Preserve source indices through explicit rebasing.
  Never union or persist suggestions as accepted graph edges, infer adoption,
  repair quotes, change core or introduce a second engine.
- BC2: Both arms use the already supported `gpt-5.6-luna`, reasoning none,
  existing 6000 local / 7024 provider input and 1024 output ceilings per call.
  Coverage can use three generations versus baseline one: this is a workflow
  cost/quality tradeoff, NOT an equal-compute causal ablation. Report actual
  calls, token-priced estimates and latency separately. This does not compare
  numerically against PR137's different model/cases/schema as a quality gain.
- BC3: Freeze eight new bilingual synthetic cases, exactly two source memories
  each, and a separate semantic rubric before calls. Cover explicit choice and
  reason, changed one-of-two reasons, different actors, consideration,
  unadopted advice, stale historical evidence, explicit replacement and scoped
  temporary choice. Required conceptual supports/challenges and forbidden
  inferences must be explicit. Avoid ambiguous expectations; allow legitimate
  quote/anchor variations. Rubric and case labels never enter model requests.
- BC4: Reuse existing immutable basis-model capability and shared USD50 ledger;
  explicit injected key/fetch, exact settled checkpoint, transitive source pins,
  exclusive once-only intent and private append-only sanitized evidence.
  Expected64 HTTP (32 generations/counts), hard80 HTTP / USD0.24 conservative
  reservations at3000 microUSD per request. Only Luna/reviewBasis is allowed in
  this operator. No grants, resets, retries, replacement cases or new API port.
  Transport/accounting/pin/persistence failures halt subsequent calls globally.
  Malformed local output fails that arm and leaves its remaining stages unrun;
  do not fall back to a global-only candidate or salvage partial units. Preserve
  all sixteen arm slots and every scheduled stage, including failed/unrun.
- BC5: Keep every intermediate proposal and compile result distinguishable from
  empty; bound inventory and augmented prompt before sending. Use only compiled
  local source quotes, roles and request-local positions in the global hints;
  no private identifiers or authoritative labels. All original sources remain
  visible at global review. Exact quote/role validation remains unchanged.
  Fake-HTTP tests exercise scheduling, rebasing, hint distrust, failed/empty
  distinction, no rubric/store writes, token caps, failure latch, one-shot
  denial, exact checkpoint/pins, key redaction and permanent cap enforcement.
- BC6: Primary runs generic/JSON/plugin and complete live-evidence offline
  gates on Node22.16/24, then independent Standards and Spec reviews on the
  exact frozen candidate before at most one paid run. Review all final raw
  proposals, including rejected proposals, against the pre-outcome source rubric.
  Report rejected arms separately, unsupported extra links, omitted required
  relationships, complete cases and source-role mistakes; do not turn rejection
  into correct abstention. Publish only a closed synthetic projection with
  frozen provenance and a regression test, then repeat affected checks/reviews
  and deliver one PR with all CI green. No general reliability promotion.

One bounded Sol/high worker owns implementation and fake-HTTP tests; primary
owns architecture decisions, fixture acceptance, integration, live execution
and outcome analysis. Independent reviewers do not implement. Reuse the existing
guard/session/attempt machinery rather than refactoring frozen older experiments.

Model setting follows the existing adapter and immutable capability. Official
[Luna documentation](https://developers.openai.com/api/docs/models/gpt-5.6-luna)
was checked on2026-09-16: reasoning none remains supported and published base
input/output rates are USD0.20/1.20 per million tokens. The existing campaign
uses a conservative USD0.25 input estimate and3000-microUSD reservations;
estimates/reservations are not invoices, and count costs without usage remain
unknown. An alias is not immutable model weights. No model migration is implied.

## Pre-live verification record

- Implementation: `basis_coverage_impl`, Sol/high; primary owns fixture acceptance,
  integration and live execution. Independent reviewers do not implement.
- Primary inspected every changed file and accepted sixteen distinct required
  relationships before results. Input prompts measured 606–649 local tokens.
- Pre-freeze corrections: capability object handling, transitive source pins,
  rebasing only after compilation, per-request failure evidence and a stricter
  serialized pre-reservation cap. No failed paid attempt or core/default change.
- Worker focused fake-HTTP suite: 9/9. Primary Node22.16 and24.15 full
  `npm run test:live-evidence-offline`: 246 passed, 30 intentionally skipped
  installed-only cases each. Generic `npm test`: 106 passed on both; JSON and
  strict marketplace/plugin validation passed on both. Installed gates remain CI.
- No typecheck gate exists in this JavaScript repository. Runtime changes are
  confined to evaluation; unchanged core, adapter, host and production behavior.
- Independent Standards/Spec review and the single paid run are still pending.
  Exact reviewed candidate and final CI evidence will be recorded in the PR.
