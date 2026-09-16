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
- Independent Sol/high Standards and Spec review passed pre-live candidate
  `28a403f1fbd91064cc168c6d20e1f66fe9ad69bc`. Standards noted only a
  non-blocking duplicated-helper heuristic; older frozen operators were not
  refactored. Spec found no actionable pre-live gap.

## One-shot outcome and delivery gate

- Primary ran exactly once against that unchanged source: 62 HTTP /31
  generations, USD0.186 reservations, USD0.010097 rounded known-usage estimate,
  31 additional unknown-cost count requests, zero unsettled. No retry, new
  grant, ledger reset, model/default change, merge, release or deployment.
- All sixteen arms and32 scheduled stages survive in the closed projection.
  Thirteen arms completed, three failed. Coverage replacement's global stage
  is unrun after invalid local output. No rejected output counts as abstention.
- Primary and independent Sol/high semantic review inspected all raw local
  and global proposals against the frozen rubric. Coverage has three accepted
  unsupported links and no demonstrated gain; baseline still has an invalid
  consideration proposal and bundles B's distinct reasons. See the detailed
  [results](../basis-coverage-results.md); no general reliability promotion.
- DRI decision: do not adopt this workflow. Local role suggestions can carry
  mistaken temporal/scope associations into the full-source pass. The next
  design target is source-bound decision/role/time/scope association and
  separately addressable reasons, not simply extra calls or larger caps.
  This pilot does not isolate the causal effect of hints from sampling or
  prove a MOC framework ceiling. Any next experiment needs a fresh pre-outcome
  spec, unchanged safety gates and its own bounded once-only intent.
- Publication adds only a closed synthetic exporter, outcome/regression files
  and this record. Final affected tests and fixed-diff independent reviews
  must pass before PR delivery; exact final SHA and CI belong in the PR.
- Primary final rerun on Node22.16/24.15: generic106 passed; JSON and strict
  plugin validation passed; complete live-evidence offline253 passed with30
  intentional installed-only skips each. Public projection independently
  re-exported byte-identically (97,938 UTF-8 bytes); its SHA and provenance
  are frozen in the result regression. The live source pins remain unchanged.
