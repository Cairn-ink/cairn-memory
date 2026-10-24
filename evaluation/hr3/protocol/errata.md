# HR-3 protocol v0.3.4: primary clarifications (errata)

These clarifications resolve ambiguities that the builders reported, where the frozen text cannot be executed literally or admits two readings. They are clarifications, not semantic amendments. Each is recorded here before any paid stage, and goes to non-author review together with the harness.

## E-1 (2026-10-25, revised after non-author audit): expiry explanations (§9, generator README item 5)

**Superseded draft.** The first draft of E-1 scored R for expiry against the rationale for setting the deadline. The auditor found that this changes the frozen question ("explain why that change occurred", §1; `generator/bank.mjs:15`), so that draft is withdrawn.

**Revised clarification.** The frozen question is kept: R asks why the change occurred.
- For an expiry, a **supported trigger explanation** is a valid complete reason graph. For example: the explicitly stated deadline passed, so the decision stopped applying.
- `not_stated` is the gold only when no supported cause of the change exists in the sources.
- Citing the deadline alone, without stating it as the cause of the change, still earns no reason credit (§7).
- Gold and scorer expectations for the affected expiry checkpoints, including the six engineering/pilot answers the generator reported, are corrected to accept the supported trigger graph.

**Scope.** This aligns gold with the frozen question rather than changing the question.

## E-2 (2026-10-25): Card confirmation versus separate declaration (§5, generator README item 6)

**The conflict.** Read literally, §5 has a control branch that confirms a Card with `currentDependencies` and then declares dependencies separately with a null `expectedDependencyRevision`. On the pinned product, confirmation with `currentDependencies` already writes dependency revision 1 (`core/private-card-storage.mjs:211` at `b2513501`). The later null-expectation declaration therefore fails the revision check (`core/card-current-storage.mjs:65`), so the literal sequence cannot be executed.

**The clarification.** The "declare separately" branch confirms the Card **without** `currentDependencies` and then calls the standalone declaration with a null expectation. The branch that confirms with dependencies stays a distinct branch and never re-declares with null. Any later revalidation or replacement uses the inspected positive dependency revision. This keeps §5's intent (two distinct authoring paths) on public product operations, and adds or removes no capability.

## A-1 (2026-10-25, revised after non-author audit): stage sequencing for the engineering pilot

**Scope.** A-1 explicitly supersedes two rules, and only for the fixed 60-family, US$24 engineering pilot:
- the §8 prohibition on paid work before calibration;
- the §13 ordering of calibration before the pilot.

All non-adjudication preflight requirements remain binding.

**Background.** Calibration v1 contains 3,140 distinct pass inputs, which means 6,280 initial fresh adjudicator sessions plus up to 3,140 independent resolver sessions: 6,280–9,420 in total, excluding benchmarks. Calibration v1 also cannot certify the required referral quotas (36/72 strata). Calibration v2 is independently enumerated and budgeted; pilot research-arm referral rates do not determine its required workload.

**After the pilot.**
- Engineering checks may be evaluated provisionally.
- Development remains blocked until every original continuation requirement passes, including an independent calibration v2, calibrated adjudication and measured resource capacity.
- Only aggregate referral counts and prespecified stratum composition may inform calibration workload and coverage.
- Do not transfer pilot answers, gold, adjudicated mappings or case-specific error fixes into calibration v2.
- The frozen models, prompts, policies, scorer and decision rules stay as they are; any necessary change follows the applicable amendment requirements.
- Pilot bounds are descriptive only. They cannot produce an Advance/Keep decision or enter development or test estimates. The development baseline remains the first substantive calibrated baseline.
- Calibration must pass before any adjudicated research-arm accuracy is reported. Calibration judgments, errors and failed-gate diagnostics remain reportable.

**Score bounds.**
- **Components.** For each attempted family, arm and checkpoint, a mechanically determined component is `[0,0]` or `[1,1]`, and an unresolved component score is `[0,1]`. An outstanding pass referral does not reopen a score that is already logically determined.
- **Joint score.** Joint bounds are computed per family as L_J = L_C·L_O·L_R and U_J = U_C·U_O·U_R. A determined zero forces J to `[0,0]`, all determined ones give `[1,1]`, and otherwise J is unresolved.
- **Aggregation.** Family bounds are aggregated with the frozen weights. Aggregate component rates are never multiplied.
- **Interpretation.** These are conservative score bounds conditional on the frozen mechanical decisions. They are not certified factual-accuracy bounds, not confidence intervals, and their endpoints are not necessarily jointly attainable.
- **Confidence intervals.** Pilot sampling CIs are deferred, which explicitly excepts these score bounds from §11's CI requirement. If sampling uncertainty is reported, it needs a separately specified conservative envelope.

**Every bound report includes:**
- C/O/R/J bounds per arm, overall and by change type, with intermediate and final checkpoints reported separately;
- counts of determined-correct, determined-incorrect and unresolved scores, and separately the outstanding correctness/support referrals, unique keys and propagated applications;
- the planned, attempted and valid-completion denominators, the families and lineages represented, and the weights applied. Failed attempts remain scored; unexecuted cases are identified separately and never dropped or treated as observed failures;
- the share of J that is unresolved, reported separately from the share having any referred component;
- frozen artifact hashes, scorer and errata versions, actual spend, and the label **"Uncalibrated engineering pilot — mechanical score bounds; no adjudication."**

## A-2 (2026-10-25): output caps (§10, §13 steps 2–3; primary amendment, needs non-author confirmation)

**Finding.** The §13 maximal-reference certification (`harness/reports/cap-certification.json`) shows that valid maximal answers exceed both frozen output caps. These figures were counted with the real `o200k_base` tokenizer, in provider schema property order, over all 1,860 allocated families:
- **Reader:** the worst supported union is about 1,790 tokens, against a cap of 768.
- **Extraction:** the worst case is about 3,425 tokens, against a cap of 1,024.

§13 forbids omitting requirements to fit, so the caps change.

**Amendment.**
- **Caps.** Reader `max_output_tokens` rises from 768 to **2,048**, and extraction from 1,024 to **4,096**. Input caps, models, prompts, schemas, arms, scorer and every other rule are unchanged. Both models support these output lengths.
- **Margin.** Certification must pass under the new caps with at least 10% margin for every allocated structure. Replacement development and test banks require recertification before their generation.
- **Budget (revised 2026-10-25 after recomputation, `harness/reports/budget-a2.json`).**
  - **Recomputed figures.** At the verified prices, the planned cost under the new caps is US$183.68, or US$229.61 with the 25% contingency. The theoretical all-maximum-plus-retry envelope is US$600.39. That envelope assumes every call returns a cap-length output and is retried, and it exceeds the US$450 operational stop.
  - **Pilot.** The pilot's worst case (US$17.12) must fit the US$24 pilot limit, and it does.
  - **Development and later stages.** Feasibility is decided by the §13 pilot-continuation projection: projected completion from the pilot's actual settled usage must fit within US$400. It is not decided by the theoretical envelope.
  - **Hard limits.** The ledger's dynamic hard stops remain the binding protection: spent plus outstanding reservations never exceed a stage limit or the US$450 stop, and the US$500 authorization is never exceeded. The stage limits stay unchanged until the continuation projection. Any re-derivation stays within US$450 and is disclosed before development.
- **Pilot evidence.** Pilot answers that end with `incomplete` status remain scored as failures and are reported. No quality retries.
