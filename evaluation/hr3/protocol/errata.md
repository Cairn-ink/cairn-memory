# HR-3 protocol v0.3.4: primary clarifications (errata)

These clarifications resolve ambiguities that the builders reported, where the frozen text cannot be executed literally or admits two readings. They are clarifications, not semantic amendments. Each is recorded here before any paid stage, and goes to non-author review together with the harness.

## E-1 (2026-10-25): expiry families with an unstated reason (§9, generator README item 5)

- **The trigger.** In an expiry family, the explicit boundary (the deadline or end date) is the *trigger*: it explains why the decision stopped applying at that time. The current/old status and the C/O scoring use the trigger.
- **The reason.** The *reason* component (R) asks for the rationale behind the time-limited decision, that is, why the boundary was set or why the decision was not renewed.
- **Unstated families.** In unstated-reason expiry families, that rationale is absent from every source, so the gold reason is `not_stated`. Citing the deadline alone does not earn reason credit, consistent with §7's rule that citation alone is not explanation.
- **Effect.** This adopts the generator's candidate interpretation. The six affected engineering/pilot checkpoint answers are accepted under E-1.

## E-2 (2026-10-25): Card confirmation versus separate declaration (§5, generator README item 6)

**The conflict.** Read literally, §5 has a control branch that confirms a Card with `currentDependencies` and then declares dependencies separately with a null `expectedDependencyRevision`. On the pinned product, confirmation with `currentDependencies` already writes dependency revision 1 (`core/private-card-storage.mjs:211` at `b2513501`). The later null-expectation declaration therefore fails the revision check (`core/card-current-storage.mjs:65`), so the literal sequence cannot be executed.

**The clarification.** The "declare separately" branch confirms the Card **without** `currentDependencies` and then calls the standalone declaration with a null expectation. The branch that confirms with dependencies stays a distinct branch and never re-declares with null. Any later revalidation or replacement uses the inspected positive dependency revision. This keeps §5's intent (two distinct authoring paths) on public product operations, and adds or removes no capability.

## A-1 (2026-10-25): stage sequencing. The engineering pilot runs before adjudication calibration (primary amendment; needs non-author confirmation)

**Problem.**
- The integration stage found that the frozen calibration challenge set cannot certify genuine referrals: only 36/72 strata meet quota, with C/O shortages. Filling them needs a fresh calibration version.
- The integration report also notes that genuine-referral certification depends on referrals actually observed from the frozen pipeline.
- Adjudicating the full blinded set means 3,140 fresh model sessions, an unpaid workload whose size is only knowable once the real referral rate is observed.

**Amendment.**
- **Pilot first.** The 60-family **engineering pilot** (§13; cap US$24) may run **before** the §8 calibration gate passes, with **mechanical scoring only**:
  - Referred components are neither credited nor penalised. They are reported as `unresolved`.
  - Every pilot score is published as a **[lower, upper] bound pair**: unresolved counted as wrong, and counted as right.
  - The number and share of unresolved items are reported per arm and component.
  - No adjudication is applied to pilot answers.
- **What the pilot is used for.** Pilot outputs may be used only for:
  - the engineering continuation checks of §13;
  - measuring the real referral rate and its strata composition, to design calibration v2 and size the adjudication workload;
  - a clearly labelled preliminary description of arm P, with bounds.

  They may not select a policy or a model, change T/U/O or the decision rules, or enter any confirmatory analysis. This is unchanged from §13.
- **Gate before development.** The §8 calibration gate, including a fresh calibration v2 authored independently and fill-in referral strata, must pass **before** the development stage and before any adjudicated score is reported.
- **No other changes.** Caps, models, prompts, arms, scorer, gold and all other gates are unchanged.
