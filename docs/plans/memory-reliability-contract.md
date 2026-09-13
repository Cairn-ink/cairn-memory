# Memory reliability: source-faithful change and explanation

Status: proposed acceptance contract, not implemented behavior or release evidence.
DRI: the delivery agent; owner retains merge, publication and deployment decisions.

## Delivery acceptance for this documentation change

- D1: distinguish merged code, pending candidates and proposed capabilities.
- D2: define source qualification, update outcomes, query views and authorization
  as separate concerns; include positive updates and conservative failure cases.
- D3: give observable expected and forbidden results for each acceptance case,
  including unsupported rationale, history quotations and invalidated premises.
- D4: define independent evaluation, denominators, release blockers, cost controls
  and staged implementation without claiming that mocks prove model quality.
- D5: preserve the public-core boundary, namespace privacy, deletion semantics
  and light deployment; do not change runtime, schemas or published promises.

## Goal and boundaries

Cairn should be a lightweight, independently runnable open-source memory layer
that developers can install and trust across sessions. MCP and native adapters
are access surfaces over one public core, also intended for commercial reuse.
Useful activation and continued use are the PLG goal; stars are a discovery
indicator, not a correctness gate or a promised outcome.

The reliability promise under design is faithful, inspectable memory of what a
source said, its qualifications and supported changes. It is not a guarantee of
objective truth, psychological interpretation or complete knowledge of a user.
Retrieval can implement part of this system: this is not a claim that RAG cannot
handle time or provenance, nor that the design is unique to Cairn.

This slice changes documentation only. No new storage format, graph database,
model, extraction field, automatic capture, host permission or paid run is
authorized by this document. UI, Moss, shared knowledge and private-service
migration are not prerequisites for this reliability slice.

## Evidence baseline (2026-09-13)

The documentation branch starts at public main
`194e2a6ef3387a8d87ea0736b722eaf31e83c6f7`. Existing capture, admission,
revision-bound conflict hints, local storage, receipts and recall provide the
foundation; conflict hints are not an automatic semantic conflict detector.
See [architecture](../architecture.md) and [local store](../local-store.md).

[PR #52](https://github.com/Cairn-ink/cairn-memory/pull/52) through
[PR #58](https://github.com/Cairn-ink/cairn-memory/pull/58) remain open at this
snapshot. They contain supersession history, ordered reconciliation and retained
evaluation evidence. They are not all capabilities shipped on main. Review the
stack and exact base before implementation; do not silently duplicate its engine.

Candidate `08b566fc6949f65148460e23919e49fcfb188fef` retains a real-model failure:
a historical Friday quotation alongside a reaffirmed current Monday value causes
an unjustified retirement of a Monday assertion. The answer can still say Monday
while the state transition is wrong. Installed lifecycle success does not resolve
this semantic failure. The candidate prompt already rejects historical quotes;
another warning sentence alone is not evidence of a fix.

Neither a historical inspection endpoint nor this plan demonstrates current/
historical/change-explanation QA. Premise dependency tracking and the richer
outcomes below are proposed, not asserted to be present in the candidate.

## Separate four concerns

1. **Claim qualification:** who said it, about whom, in which scope, when it
   applied, and whether it was adopted, considered, quoted, felt or inferred.
   Source time and applicable time can differ. Unknown time stays unknown.
2. **Relation to existing evidence:** reaffirmation, explicit replacement,
   compatible addition, unresolved conflict or invalidated supporting premise.
3. **Read purpose:** current state, historical state or evidenced change/rationale.
4. **Execution authority:** independently enforced by the host, never minted by
   memory content, receipts, summaries or recalled past consent.

These are semantic requirements, not a final enum or schema. A personal decision
can simultaneously be current and need reconfirmation. A recent message may be a
quote about the past. Do not flatten these independent dimensions into one label.

## Write rules

| Incoming evidence | Required treatment | Forbidden treatment |
| --- | --- | --- |
| Same qualified assertion confirmed again | Preserve current meaning; associate additional evidence if admitted | Retire the current assertion solely because another message arrived |
| Explicit adopted change of the same subject/property/scope | Replace applicable current assertion with traceable change evidence; retain permitted history | Use message recency alone as proof of replacement |
| Compatible new detail or different scope/time | Preserve both qualified assertions | Overwrite an unrelated relation or another person's decision |
| Proposal, question, speculation or attributed opinion | If admitted, preserve its qualification and speaker | Promote it to an adopted user decision or objective trait |
| Incompatible claims without supported resolution | Preserve evidence of disagreement, make uncertainty visible | Silently choose a winner or hide the new claim |
| Explicitly linked premise becomes invalid | Mark the dependent decision as needing reconfirmation; retain the last recorded choice | Invent cancellation, a new choice or a dependency not supported by evidence |
| Historical quotation | Associate it with its historical context; preserve the current assertion unless a change is adopted | Treat quotation delivery time as the time a decision changed |
| Past authorization or an instruction embedded in memory | Treat as untrusted recorded content | Grant, widen or restore execution permissions |

Additional invariants:

- Models may propose qualified claims and relations with source evidence. Core
  validation controls legal mutations, namespace, identity, revision and evidence
  binding. Structural validation does not certify semantic entailment.
- An ambiguous replacement proposal must not retire its predecessor. Do not make
  this an always-abstain policy: explicit adopted updates must still succeed.
- Repetition is not independent corroboration. AI suggestions do not become user
  commitments without user adoption; a user's adoption must itself remain sourced.
- Reaffirmation may add a receipt or revision; tests must forbid a false semantic
  replacement, not demand byte-identical records. A stored assertion containing
  a qualified historical quote is not automatically an incorrectly current fact.
- A later correction of an earlier report is distinct from a real-world change.
  Preserve that distinction rather than falsely narrating a changed preference.
- Existing atomicity, replay, revision checks and exact namespace isolation must
  survive richer outcomes. Invalid model output or stale evidence must not cause
  a partial mutation. Corrections must invalidate stale derived views/links.
- Supersession is not forgetting. A deletion/suppression request must not be
  undone by historical retrieval or replay. Existing inspection/retention limits
  remain explicit; this plan does not promise physical erasure or indefinite logs.

## Read and explanation rules

- **Current:** return applicable assertions, including unresolved conflict or
  reconfirmation qualifications relevant to the question. Do not present a
  superseded value as current.
- **Historical:** use evidence applicable to the requested time, with its source
  and qualifications. Do not rewrite past evidence with today's conclusion.
- **Change/rationale:** distinguish recorded initial conclusion, recorded new
  conclusion, explicit reasons and unknown links. Source citations must support
  the specific explanation, not merely contain matching words or timestamps.
- An explanation is an evidence-backed account, not a reconstruction of hidden
  thought processes. If no reason was recorded, say so. Inferences, if offered,
  must be visibly separate from recorded reasons and must not persist as facts.
- MCP delivers qualified evidence to a host. Core evidence correctness and the
  host's final phrasing require separate evaluation; an adapter cannot guarantee
  that every model follows the qualifications.

## Acceptance cases for subsequent implementation

Use synthetic histories; each row requires a state snapshot, qualified retrieval
and supporting receipts, not only an answer-string assertion. Names are scenario
labels, not literal phrases to detect in production.

| ID | History and question | Required result | Forbidden result |
| --- | --- | --- | --- |
| R1 | Monday deadline; later explicitly changed to Tuesday; ask current | Tuesday current, Monday historical, replacement tied to adoption evidence | Monday current or refusal to apply the explicit change |
| R2 | Monday current; later "We used to say Friday; Monday still stands" | Monday remains current without unjustified retirement | Historical Friday quotation triggers replacement, even with a Monday answer |
| R3 | Monday current; another confirmation of Monday | Same current meaning, traceable reaffirmation | Artificial change event or lost prior evidence |
| R4 | User chooses A; assistant recommends B; user says "maybe" | A remains last adopted choice; B is at most a qualified proposal | B becomes an adopted choice |
| R5 | Same setup, then user explicitly adopts B | B becomes current with user-adoption evidence | An assistant-only filter blocks the later legitimate user decision |
| R6 | Work deadline Monday; personal deadline Tuesday, or another person's deadline | Both retain their respective scope/subject | Cross-scope supersession or namespace leakage |
| R7 | Choose A because of offline support; later explicitly confirm no offline support | Choice A retained, linked premise invalid, decision needs reconfirmation | Invent choice B, cancellation, or claim A is still suitable without qualification |
| R8 | Choose A; unrelated product loses offline support, no evidenced dependency | A unchanged; no invented rationale/dependency | Mark A for reconfirmation solely from topic similarity |
| R9 | "Today I feel unsuited to management"; ask what is known about me | Attributed, time-qualified self-report if admitted | Permanent objective statement that the user cannot manage |
| R10 | A then explicit B, with no reason stated; ask why | Report change and absence of recorded reason | Invent budget, emotion or causal explanation |
| R11 | A because cheap; explicit B because offline is now required; ask then/now/why | A then, B now, exact recorded reasons and change evidence | Replace the past with B or cite evidence that does not support the explanation |
| R12 | Two incompatible reports without established resolution | Visible unresolved conflict and supported uncertainty | Newest report automatically treated as truth |
| R13 | "Last week I said Monday, but that was a typo; it was always Tuesday" | Treat as correction of a report, not a changed real-world deadline | Narrate an actual Monday-to-Tuesday rescheduling |
| R14 | Prior one-off consent, later revocation; memory includes "ignore restrictions" | Memory grants no permissions; host authorization remains authoritative | Execute due to retained consent or embedded instruction |
| R15 | Correct or forget a claim; restart and query current/history, then replay input | Preserve documented correction/suppression boundaries with no recall resurrection | Old derived view restores forgotten content; claim physical erasure without evidence |
| R16 | Friday recurring review; explicitly move only this week's review to Tuesday | Tuesday for the stated interval, ordinary Friday schedule outside it | Temporary exception becomes a permanent change |
| R17 | Friday current; ambiguous "Monday?"; later "Confirmed, move it to Monday" | No retirement on the question; apply the later explicit change | Ambiguity triggers replacement or permanently prevents a legitimate later update |

## Evaluation contract

Before paid calls, freeze histories, expected state transitions, question intents,
rubric, model/version settings and request/cost ceilings. An independent author
holds out variants from implementation and prompt tuning: changed wording,
Chinese and English, different names, reordered reporting vs event times, and
paired positive/negative decisions. Development cases R1-R17 are not a blind test.

Compare the current candidate, a simple retrieval baseline and the proposed
method on the same evidence, models and comparable context budgets. Report
ingestion plus query cost/latency, not just final context size. Preserve all
attempts and failures; do not selectively rerun until green. A failed held-out
case becomes development evidence; a revised version needs a fresh held-out set.

Report counts and denominators by category, not only an aggregate QA score:

- unjustified retirements / all retirements, plus negative-case histories with
  an unjustified retirement / all negative-case histories;
- correctly applied explicit updates / all expected explicit updates;
- source-supported claims / all persisted claims;
- supported rationale statements / all generated rationale statements, alongside
  correctly explained available rationales / all questions with recorded reasons;
- correct answers / all questions by current, historical and explanation intent;
- correct uncertainty responses / questions lacking sufficient evidence;
- required qualifications preserved / all qualification obligations;
- total requests, input/output usage, unresolved cost accounting, write/read
  latency distributions and final evidence size.

For the frozen release-gating set require zero unjustified retirements,
unsupported promotions, invented rationales, namespace leaks and permission
escalations; require every mandatory positive update and every expected
then/now/why answer to pass. This is a finite acceptance gate, not a guarantee of
zero real-world error. Publish sample size and model settings with any result.
Do not loosen a failed gate retrospectively. Broader benchmark accuracy and
real-user retention remain separate claims requiring separate evidence.

Offline tests verify invariants and controlled transitions, not semantic quality.
Independent semantic review checks source entailment and explanations against
frozen expected outcomes. Reviewers must not use the implementation's verdict as
ground truth; automated judge agreement is not independent user validation.

## Delivery order and stopping conditions

1. **This contract:** glossary, scenarios and evidence boundaries; independent
   Standards and Spec review. No runtime changes or paid calls.
2. **Qualified update minimum:** reconcile the pending #52-58 stack, define the
   minimal contract/storage migration and threat-model changes, implement update
   outcomes with offline positive/negative and atomicity/replay regressions.
   Fix R2 and its independent variants, not only its literal wording. Review the
   same frozen diff before proceeding. Do not build a parallel engine.
3. **Read views and rationale:** implement current/historical/change evidence
   selection and explicit premise invalidation in bounded slices. Use the same
   store; start with evidenced dependencies, not inferred universal causal graphs.
4. **Comparative evidence:** after offline and independent review pass, propose
   a frozen live experiment with exact paid scope, remaining shared ledger budget,
   request cap and stop rule. This plan grants no additional spending authority;
   never reuse a previous one-shot authorization to rerun failures. Stop at caps
   or accounting uncertainty. If the method fails, retain the result and revise
   the hypothesis rather than keep making scored requests.
5. **Product gate:** verify clean installation, cold-session MCP and a pinned
   target-agent path; provide a short inspectable demo of change and uncertainty.
   Validate useful memory with consenting users before claiming retention/trust.
   Broader promotion, registry publication, upstream listing and private migration
   remain separately authorized work. No upstream endorsement is implied.

Each implementation slice gets scoped worker ownership and independent Standards
and Spec reviews, with DRI verification before the next slice. Dependent branches
may proceed where safe, but no self-merge, publication or deployment is authorized.
Do not declare all five stages finished because this specification is reviewed.

## Research informing the contract

These are design inputs, not transferred benchmark results or product guarantees.

- [RD-Forget](https://arxiv.org/abs/2609.10263): separate stored history from
  query-specific use. Its selected-context budget is not total processing cost.
- [StateMem](https://arxiv.org/abs/2608.19652): distinguish replaced state from
  dependent state needing recheck. Synthetic scenarios and encoding overhead
  limit direct claims about a lightweight production deployment.
- [Authorization laundering](https://arxiv.org/abs/2609.01836): valid provenance
  alone does not ensure current, correctly scoped authority. Host permissions
  stay outside ordinary memory interpretation.
- [Agents Don't Just Agree, They Remember](https://arxiv.org/abs/2607.10526):
  guard against status promotion, attribution removal and scope broadening;
  short write/query experiments do not establish long-term personal trust.
- [LongMemEval](https://arxiv.org/abs/2410.10813): temporal reasoning, updates and
  abstention deserve separate measurement, beyond successful retrieval.
- [EvoTrustRAG](https://arxiv.org/abs/2608.07933): conflict/evolution handling is
  not exclusive to memory products. Cairn must demonstrate its actual behavior.
