# Source-backed update boundary

Status: design and implementation acceptance, not shipped semantic behavior.
Fixed base: `033a6b2fc545908f352247a8db038e2ef544acb5`.
DRI: delivery agent. No owner decision is needed to investigate or implement the
approved memory-reliability goal; merge, release and deployment remain excluded.

## Why the next change is not another verdict label

`core/ordered-capture.mjs` validates output shape, source indices and the model's
supersedes/changed/explicit labels. It does not independently establish a shared
claim subject, property or scope. The retained qualified comparison demonstrates
that valid labels can accompany unjustified retirement. Query candidate fixes
do not repair that write-side problem.

The source author can describe a housemate; a message can quote an earlier value
while reaffirming the current one. An assertion may contain multiple independent
claims. Entire-memory retirement must not erase a still-valid claim merely
because another component changed. These are constraints on stored evidence and
legal transitions, not wording instructions alone.

## Delivery acceptance for this design slice

- D1: glossary separates source author, claim subject, slot, anchor and adoption.
- D2: document immutable qualification, legacy/unqualified treatment, ambiguity,
  partial updates and the boundary between structural and semantic verification.
- D3: specify a staged implementation with positive updates and protected
  non-updates; preserve existing source, revision, replay, privacy and cost gates.
- D4: do not claim the proposed representation, currentness repair or dependency
  tracking is already implemented. No schema/runtime/model/prompt change here.
- D5: generic/JSON/plugin checks on both supported Node versions and independent
  Standards/Spec review of the final commit before PR delivery.

## Proposed engineering boundary

1. Qualification is bound to the assertion and its source revision when that
   assertion is admitted, not invented anew by the later retirement verdict.
   Correcting an assertion invalidates its earlier qualification; forgetting it
   must prevent qualification/history views from resurrecting its content.
2. A qualification records the subject, property, applicable scope/time, value,
   attribution/commitment and supporting source anchors. Unknown is explicit;
   source delivery time is not silently substituted for applicability time.
   Exact data shapes and numeric bounds must be frozen in the implementing spec
   before code; no open-ended metadata bag or unbounded causal graph.
3. A source anchor is an exact, bounded slice of an existing receipt, checked
   against the authoritative source and revision. It cannot supply a new receipt,
   namespace, speaker role or permission. Equality and substring checks prove
   binding only, not entailment, adoption or identity resolution.
4. A claim slot excludes the value. A retirement proposal must reference stored
   slot identity and support a different adopted value. The same verdict cannot
   relabel the predecessor's subject or scope to manufacture a match. Alias or
   pronoun resolution is a separately evaluated semantic operation; neither equal
   model-generated labels nor shared words are proof of identical subjects.
5. Start with explicitly qualified single-claim assertions. Compound or ambiguous
   assertions cannot undergo whole-memory retirement unless all affected claims
   and retained qualifications are accounted for. Temporary exceptions and
   corrections of past reports are not silently broadened into permanent change.
6. Unqualified legacy records remain inspectable and usable as unqualified
   evidence. Do not silently fabricate qualifications or overwrite them in a
   migration. The new qualified path cannot retire them without separately
   supported qualification. Do not advertise this fallback as a completed update.
7. Incompatible or uncertain evidence remains visible as unresolved, with the
   previous recorded choice retained. Preserve new source evidence and replay
   semantics. Valid adopted updates must still work: an always-abstain result
   fails acceptance, even if it eliminates unjustified retirements.
8. Keep one public engine and one namespace boundary. Semantic providers remain
   outside core. An optional experimental rollout must state exactly which
   paths are qualified; an unsafe legacy fallback cannot be called protected.

This is a hypothesis to test. Source anchors make a decision inspectable; they
cannot guarantee that a model interprets quotation, adoption or scope correctly.

## Next independently verified packages

1. **Bounded qualification storage and inspection.** Freeze DTO/bounds and
   migration contracts; bind qualification to stored sources/revisions; implement
   atomic admission, replay, correction and suppression semantics. Initially use
   handcrafted synthetic qualifications, with no automatic quality claim.
2. **Qualified transition enforcement.** Reject re-labeling, mismatched slots,
   same-value retirement, stale evidence and unsupported whole-memory changes.
   Admit unresolved evidence without inventing a resolution; expose the outcome.
   Tests must apply an explicit valid change, not only reject unsafe changes.
3. **Automatic qualification and retrieval integration.** Add source-bound model
   production of the same bounded representation; preserve attribution in recall
   and current/history inspection. Test installed MCP and the existing host seam
   with the same core. Never equate a valid model schema with semantic accuracy.
4. **Frozen new semantic comparison.** Independently author fresh bilingual
   positive/negative histories; freeze runtime, fixtures, rubric, accounting and
   per-run caps before any calls. Use the existing USD50 phase ledger, not a new
   grant. Retain all failed attempts; do not rerun old failed held-out cases.

For each package: implementation worker, independent Standards and Spec reviewers,
root verification, then PR. Dependent branches can continue without owner merges.
The next package starts only after the current package's gate passes.

## Required paired regressions

| Protected non-update | Mandatory legitimate update |
| --- | --- |
| A housemate changes preference; user's own preference remains | User explicitly changes their own preference |
| Same value reaffirmed in different wording | Same subject/property/scope adopts a different value |
| Old value quoted, current value reaffirmed | Current source explicitly adopts a replacement |
| Assistant proposes, user only considers | User subsequently adopts the proposal |
| One-week exception leaves recurring rule intact | Explicit permanent change replaces the recurring rule |
| One component of compound evidence changes | A qualified single claim is safely replaced |
| Distinct subject or scope shares the same words | Established same slot has source-supported new adoption |

Also test correction vs real-world change, ambiguity followed by clarification,
Unicode anchor boundaries, forged/missing source slices, stale revisions,
cross-namespace references, duplicate/replayed events, interrupted writes, cold
reopen and correction/forget suppression. Snapshot both old and new assertions,
all qualifications and change receipts; a correct final answer cannot excuse
the wrong retirement. Preserve existing retained failure fixtures as development
regressions, not new held-out evidence.

Premise dependencies and then/now/why answers remain required by the broader
[reliability contract](memory-reliability-contract.md), but are not implemented
by this design. Do not infer a new decision from an invalidated premise or invent
an unrecorded reason.

## Research boundary

[StateMem](https://arxiv.org/abs/2608.19652) motivates evaluating evolving state
separately from recall. [RD-Forget](https://arxiv.org/abs/2609.10263) separates
retained evidence from query-conditioned use and describes semantic slots.
The proposed immutable qualification boundary is our engineering hypothesis,
not an implementation copied from those abstracts or a transfer of their scores.
