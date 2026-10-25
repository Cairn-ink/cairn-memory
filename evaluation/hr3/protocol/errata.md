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

### A-2 clarifications after non-author audit (2026-10-25)

- **Certification scope.** Pre-pilot certification uses pilot references and separate engineering stress fixtures that cover every maximal required structure. It must not invoke development or test generation before the existing freshness gate.
- **Already-rendered held-out references.** The first certification run (`aa3b0a14`) rendered and published development and test reference serializations, covering 33 development and 33 test lineages, including provisional R3 lineages. These are recorded as **inspected**: their identifiers and hashes are retained, and they are excluded from calibration and tuning. After calibration v2 and publication of fresh replacement banks and allocation, references are rendered and recertified before any paid development or test call.
- **Budget.** A-2 supersedes §14's previous numerical envelope and its feasibility assessment.
  - **Reporting.** Pilot budget fit, coverage by the theoretical envelope, and later-stage feasibility are reported separately.
  - **Before development.** Freeze a reproducible projection that covers total experiment spending, outstanding reservations, the remaining stages, embeddings, alternative extraction and contingency. Projected completion must be ≤ US$400, and every stage limit must be met.
  - **Unchanged.** The complete-test requirement still holds, and budget exhaustion still makes the result Inconclusive.
- **Pilot ceiling.** The pilot response ceiling is US$17.117184. Including the entire shared embedding allowance, the conservative total is US$19.677184, below US$24.
- **Regeneration.** Certificates and the applicable freeze manifests are regenerated against the final text of this amendment.

### A-2 cap revision after the engineering stress certificate (2026-10-25)

- **Why.** Independent engineering stress fixtures, built without held-out generation, raised the worst valid outputs to **1,867** tokens for the reader and **3,751** for extraction. At 2,048/4,096 the headroom is 8.84%/8.42%, which fails the required 10%. Fixtures are not shortened to fit.
- **Revised caps.** Reader `max_output_tokens` becomes **2,176** and extraction **4,352**, giving about 14.2%/13.8% headroom. Everything else in A-2 is unchanged.
- **Pilot check.** The conservative pilot total, including the entire shared embedding allowance, must stay below US$24. If it does not, paid work does not start, and a further amendment is required.

## A-3 (2026-10-25): extraction validation granularity and quote anchoring, after the first engineering pilot (primary amendment; needs non-author confirmation)

**Finding.** The first paid engineering pilot (run `pilot-cf24810f`, harness `cf24810f`, actual spend US$0.84) produced mechanically scorable outputs, but **239 of 240 extraction calls were rejected whole** by the harness validator. The rejection reasons were:

| Reason | Calls |
|---|---:|
| `invalid_extraction_quote` | 164 |
| `dangling_reason` | 32 |
| `invalid_field_mask` | 22 |
| `invalid_extraction_provenance` | 15 |
| `invalid_extraction_interval` | 6 |

Of 730 event source quotes, 725 had incorrect model-computed offsets, and 723 of those strings occurred verbatim in the cited turn. Including reason-edge quotes, the counts are 973, 968 and 965 (corrected after non-author audit; the first draft's 612/608/605 did not match the committed fixture). Because a single defect discards the whole batch, every arm received little or no evidence. Pilot scores therefore measure the validator, not the memory policies or the product. Two further defects: the frozen extraction and reader prompts still carry the withdrawn draft-E-1 wording ("deadlines are triggers, not an unstated rationale"; "a deadline alone is not rationale"), which contradicts revised E-1.

**Amendment.** This applies identically to the shared extraction stage, so every arm receives the same extraction.
- **Quote anchoring.** The model supplies `turn_id`, the verbatim `quote` and a one-based `occurrence`.
  - The harness computes the UTF-16 offsets deterministically by locating that occurrence of the exact quote in the cited turn.
  - Model-supplied offsets, if present, are ignored for validity.
  - A quote that does not occur verbatim, or whose occurrence does not exist, is invalid.
  - No fuzzy matching, normalization, or gold-assisted repair is applied.
- **Event-level validity.**
  - Each extracted event is validated independently against the existing rules: provenance, scope, interval, field mask, reasons and quotes.
  - An invalid event is excluded, together with any reason edge that depends on an invalid quote. Its rejection reason is recorded.
  - The remaining valid events are kept.
  - A batch with zero valid events is an empty extraction, not a transport failure.
  - Schema-invalid or unparseable output still fails the whole batch.
  - Rejected events are counted per batch, per reason and per arm-independent extraction, and reported as a pipeline-stage diagnostic.
- **Prompt alignment with revised E-1.** The extraction and reader system prompts replace the withdrawn wording with the revised E-1 rule: an explicitly stated deadline that caused a decision to stop applying is a supported cause of the change, while a bare deadline citation without stating it as the cause earns no reason credit. No other prompt text changes.
- **Pilot rerun.** The engineering pilot is re-run once, as a fresh run under A-3. The first run is retained and reported as an engineering finding, and it is not pooled. The pilot cap (US$24) covers both runs.
- **Unchanged.** Development and test materials are untouched. Pilot use stays restricted by A-1. Caps, models, schemas (except the quote-anchor fields), arms, scorer and decision rules are unchanged.

### A-3 clarifications after non-author audit (2026-10-25)

- **Event identity.** Provider event IDs are batch-local.
  - Before arm fan-out, assign each event a deterministic internal key `(family_id, batch_ordinal, raw_event_id)`, and keep the raw IDs in diagnostics.
  - Reject duplicates within a batch.
  - Preserve source-turn predecessor anchoring and all semantic fields.
  - P processes only newly received internal keys.
- **Request input bound.** Before the rerun, certify complete provider request bodies (schemas, prompts, questions, metadata and both delivered intents) for maximal required structures.
  - Establish a sufficient input reservation bound and recompute the combined pilot budget.
  - Preserve the required evidence and delivery budgets; never silently truncate them to fit framing limits.
- **Quote convention.**
  - **Extraction anchors** use `{turn_id, quote, occurrence}`. Count exact matches at successive UTF-16 start positions, including overlaps; the harness computes the offsets.
  - **Scope.** This convention applies only to extraction anchors. Reader-citation ambiguity handling is unchanged.
  - **Prompt changes.** These cover revised E-1 and this quote-format instruction. The stale "UTF-16 offsets" instruction is removed.
- **Cumulative accounting.** The rerun uses fresh stores, requests and artifacts but preserves cumulative accounting.
  - Carry forward verified settled charges, full outstanding reservations, applicable preparation charges and shared embedding-unit counters from the first run.
  - Enforce the remaining pilot allowance within US$24 across both runs, using exact ledger amounts rather than rounded spending.
  - Recompute feasibility after the input-bound change.
- **Replay evidence.** The counterfactual occurrence-1 replay retains 605 of 728 events. This is formal validity, not adjudicated accuracy.

## A-4 (2026-10-25): public slot contract and separable extraction, after the third engineering pilot (non-author audit: acceptable for implementation)

**Status:** proposed semantic amendment; requires non-author review and a new freeze before execution. It changes the shared extraction and answer representation, not the T/U update-policy comparison. No execution is authorized by this text.

### 1. Purpose, scope and unchanged commitments

HR-3 asks whether an update policy helps a reader recover **the current decision, the requested old decision, and why the change occurred**. It should not require either model to discover an unpublished representation convention.

The third pilot exposed that distinction. Its diagnosis attributes 818 component failures to absent or excluded extraction evidence; identifies missing reader-facing conventions; and finds that all 38 invalid answers had dangling causal endpoints. These findings justify changing the common measurement pipeline before development or test, rather than selecting an arm or changing its decision threshold. Diagnosis:235, contract assessment:255, invalid answers:200

A-4 supersedes conflicting extraction, serialization, answer-schema and scoring requirements in §§2, 6–8 and 10, A-3’s event-wide exclusion rule, and the cumulative pilot limit. Everything else remains binding, including:

- **Sole confirmatory contrast:** final-checkpoint **J(T) − J(U)**.
- T’s typed cell/field updates and inheritance; U’s uniform whole-version selection; O’s overwrite semantics.
- The product pin, P’s public-operation mapping, actual product retrieval and assembly, Card and safety controls.
- Four shared real-model extraction calls per family; one stateless, tool-free reader call per arm/checkpoint; arm identity withheld.
- Frozen splits, allocations, lineage weights, final checkpoint, five-point decision threshold and guards.
- The finite-sample-rescaled bootstrap, paired/shared draws, coverage validation and judgment-error safeguards, including integer key budgets.
- Synthetic data only; no quality retries; complete-test requirement.
- A-1’s restrictions on engineering-pilot reporting and the calibrated development baseline.

**Semantic declaration.** The slot representation, causal evidence-selection answer, partial extraction admission and compact serialization are semantic amendments. They change the operational measurement prospectively. In particular, R—and consequently J—will measure a complete **quoted causal explanation**, rather than successful construction of a generic Claim graph. The scientific comparison remains T − U; its amended scores must not be pooled with previous pilot scores.

### 2. One public representation contract — remedies 1 and 7

**Classification:** documenting existing field meanings and citation addresses is clarification; introducing the closed slot representation and delivering it in both model requests is semantic.

Freeze one versioned public contract, consumed by generator, extractor, serializers, reader, scorer and calibration. Include its exact bytes or a complete deterministic projection in every relevant request; a repository document or hash alone is insufficient.

The public contract specifies:

| Slot | Meaning and accepted public labels | Canonical representation |
|---|---|---|
| `route` | `route`, `路線`; legacy internal field `value` | Literal route identifier |
| `approval` | `approval`, `approval required`, `需經核准` | Boolean |
| `cap` | `cap`, `daily request cap`, `每日請求上限` | Exact quantity, canonical unit `requests/day` |

This makes explicit the projection currently implemented by the generator: its `value` field becomes the main Claim value, while other fields become qualifiers. The rendered labels are separately defined in the sentence bank. [common.mjs:51](../generator/common.mjs#L51), [bank.mjs:26](../generator/bank.mjs#L26)

The contract also supplies:

- **Language:** canonical English JSON keys; canonical fictional identifiers from an explicit bilingual alias table; verbatim delivered-language quotations for evidence. Chinese, English and mixed input have identical semantic rules.
- **Aliases:** publish fictional subject/predicate names and applicable lexical aliases to both models. Tables contain naming correspondences, not expected slot values, adopted versions, causal links, gold IDs or correct evidence choices. Route identifiers remain literal unless an independently declared naming alias applies.
- **Values:** exact rational unit conversion, Boolean aliases, NFKC/whitespace rules and duplicate handling. No fuzzy value correction or missing-value completion.
- **Scope and time:** the existing 12-cell domain, extensional scope equality, source-claimed intervals, Asia/Taipei conversion, half-open boundaries and no expiry fallback.
- **Update meanings:** correction makes the predecessor erroneous; reversal withdraws it; partial refinement inherits unspecified fields; scope amendment preserves unaffected cells. These are world semantics available equally to every reader, not arm-specific instructions.
- **Independent examples:** demonstrate adoption versus rejection of a predecessor, partial versus complete replacement, aliases, quantities, scope partitions, expiry and evidence citations. Examples must be independently authored engineering examples, not copied pilot cases.

Public names and aliases must not encode allocation, change type, causal class, version order or expected values. Sample subject and route identifiers independently and counterbalance identifiers across versions. Validate independently authored matched worlds with identical public questions/alias tables and different correct answers. Publish deterministic question/contract-only leakage checks. Historical labels announced in questions mean the complete shared label vocabulary, never the case’s correct historical status. Apply this semantic fixture amendment through the fresh-bank process, preserving allocations and ancestry disclosures; recertify leakage, public/private projections, caps, request bounds and budget.

The same public contract and question are used across arms. Only their actual delivered memory differs.

**Citation wire contract, unchanged in meaning:**

```text
Delivered item.body:
{intent, item, unit:"body", source:null, quote, occurrence}

Delivered item.sources[i].excerpt:
{intent, item, unit:"receipt", source:i, quote, occurrence}
```

`item` and `source` are zero-based; `occurrence` is one-based. Resolve only legitimate **delivered** `sameAs`/`sameAsBody` aliases. Explain normalization, truncation and overlapping-occurrence ambiguity with independent examples. Never substitute another unit or occurrence for the submitted address. The existing resolver already distinguishes delivered addresses and ambiguous overlapping occurrences. [citations.mjs:48](../scorer/citations.mjs#L48), [resolution:58](../scorer/citations.mjs#L58)

**Recertification:** public/private projections, schema consistency, both models’ complete request bodies, output references, input reservations, tokenizer fit and resulting costs.

### 3. Smaller shared extraction, with independent admission — remedies 1 and 2

**Classification:** semantic amendment to extraction and A-3 admission; no change to T/U reducer meanings.

Retain extracted identity, source turns, observed time, kind, commitment, change type, scope, effective interval, predecessor anchors and replacement extent. These distinguish the policies and remain necessary.

Replace generic factual assignments with three nullable supplied slots. Each non-null supplied slot contains its typed value and exact source anchor(s). **Null means “not supplied by this event,” never deletion, false, zero or inheritance.**

Define an anchored non-slot context branch. It carries model-extracted text, kind, commitment and source association without enacting slot updates. Apply each arm’s existing eligibility rules to it, including P’s existing filtering. Do not harvest raw source text or manufacture context from gold. Conformance tests must preserve eligible unresolved and non-slot records as well as decision updates.

The extraction wire schema distinguishes slot and non-slot context payloads. Context retains applicable event metadata, scope, interval and anchored model-extracted text; it is never encoded as a route or a supplied-field mask. Materialize it as a tagged non-slot record under each arm’s existing eligibility, retention and intent rules, and serialize its admitted text and source association within the same bounded items. Include both branches in round-trip, eligibility, output-cap, complete-request and embedding certificates.

Remove from the model output:

1. **`field_mask`.** Derive the internal supplied-field mask from independently admitted slot keys: `route → value`, `approval → approval`, `cap → cap`. Complete replacement still clears the selected predecessor fields before installing supplied assignments; partial T updates still inherit unspecified fields. No new field-deletion cases are introduced.
2. **`reason_nodes` and `reason_edges`.** Replace them with flat `reason_quotes`: exact source anchors for explicitly stated causal clauses, necessary causal qualifications and explicit statements that no reason was given. Extract all supplied serial, conjunctive and alternative clauses; do not construct a causal ontology or infer unstated links.

This removes a duplicated field list and a second graph-construction task. The current validator rejects events for field-mask inconsistency or dangling reason endpoints, and the typed reducer separately uses the mask and assignments. [schema.mjs:74](../harness/schema.mjs#L74), [research.mjs:58](../harness/research.mjs#L58)

**Admission is deterministic and arm-independent:**

1. Unparseable output or failure of the closed extraction wire schema fails the batch, taking precedence over assignment-level rejection. The wire schema validates containers, branch tags and well-shaped Value variants; slot-specific domain compatibility is checked only after that schema passes. A well-shaped Quantity supplied for a route is therefore an assignment-level type rejection; a malformed Value object is a batch-level schema failure.
2. Validate event identity, provenance, commitment/change enums, scope and interval independently of reason quotations. Invalid core metadata excludes that event.
3. After wire-schema validation, validate each supplied slot’s domain type, declared alias/unit conversion and exact anchors separately. Exclude an invalid assignment; retain independently valid assignments. Do not infer a replacement value or silently inherit one during extraction.
4. Admit a non-expiry slot event only if valid core metadata and at least one independently anchored assignment remain. Explicit expiry may have no slot assignments but requires valid event/deadline evidence. A non-slot context event instead requires valid applicable core metadata and independently anchored context text; no slot assignment is required.
5. Validate each reason quotation independently. An invalid reason quotation is excluded and logged; it does not invalidate a factual assignment or another valid quotation.
6. Preserve A-3’s exact quote/occurrence anchoring and batch-local identity convention. No fuzzy anchoring, source-text harvesting, gold-assisted repair or model-computed offsets.
7. Pass the identical admitted event/assignment/quotation set to every arm. Derive the legacy internal assignment shape only after this common admission step.

The model must distinguish **“the old assertion was never adopted”** from **“the replacement is not adopted.”** Include independent bilingual examples of that distinction and of proposals, quotations and rejected suggestions.

Report raw, admitted and excluded events, assignments and quotations separately, with overlapping rejection reasons; empty batches remain visible. Incorrect but formally valid extraction remains an experimental failure, not something the adapter repairs.

**Recertification:** extraction schemas and prompts for both frozen extractors; independent admission tests; T/U/O reducer equivalence on valid inputs; P operation mapping; cache identity; output caps, complete request bounds and cost projections.

### 4. Closed reader answer: slots plus quoted explanation — remedies 1 and 4

**Classification:** semantic amendment replacing §6’s generic answer representation and §7’s model-authored graph requirement.

Every question explicitly announces:

- subject, predicate, checkpoint and requested scope;
- the three requested slots: **route, approval and cap**;
- focal change turn and exact requested predecessor turn(s);
- historical labels and the required answer form;
- the requirement to select a complete causal explanation from delivered evidence.

Use this closed form; freeze executable schemas before dispatch:

```text
Slot<T> := {
  state: value | not_specified | unavailable | unresolved,
  value: T | null
}

Row := {
  scope: Scope,
  valid: Interval,
  route: Slot<string>,
  approval: Slot<boolean>,
  cap: Slot<{decimal:string,unit:string}>,
  citations: [Citation]
}

Answer := {
  current: {
    status: active | no_active_decision | unresolved,
    rows: [Row]
  },
  old: {
    status: available | unavailable | none,
    records: [{
      predecessor_turn: string,
      status: previously_adopted | erroneous | expired
              | unavailable | unresolved,
      rows: [Row]
    }]
  },
  reason: {
    status: stated | not_stated | unavailable,
    support: [Citation]
  }
}
```

All keys are required; no additional properties. A slot has non-null content only in state `value`. `not_specified` asserts that the decision does not specify that slot; it does not mean the evidence was missing. `unavailable` and `unresolved` cannot earn credit against a known gold value.

Rows may partition scope differently when their expanded assertions are identical. Equivalent duplicates collapse; contradictory assignments remain errors. `valid` retains the frozen source-claimed interval meaning. `no_active_decision` has no active rows; expiry’s last-known values belong in the requested expired historical record.

For O, identify each requested predecessor using the public turn named in the question. Preserve complete requested-record matching, scope and historical labels. This identifier is not a hidden event ID or a substitute for recovering its values.

**Causal explanation.** `reason.support` selects quoted causal clauses using delivered unit addresses. There are no model-authored node IDs, endpoint references, generic causal predicates or change-event values.

For example, if delivered evidence states that reduced capacity caused queues and queues caused the focal switch, the answer selects both causal clauses. Naming capacity and the switch alone is insufficient. Conjunction requires its conjunction language and complete mediated explanation; one complete independently sufficient alternative is enough. A bare deadline is insufficient unless the selected evidence states that its passage caused expiry, preserving E-1.

Existing item/body/source addresses are the evidence labels. Do not supply a gold-derived shortlist, cause IDs, correct-option flags or hidden graph labels.

The reader remains **stateless, tool-free and blind to arm identity**. It receives no raw-conversation fallback, extraction rejection archive, prior answer or scorer feedback.

**Recertification:** all maximal answer structures, including scope partitions, multiple predecessors and complete supported causal unions; closed provider schema; reader requests; citation mapping; scoring and calibration. Do not shorten required answers to fit a cap.

### 5. Scoring and referral behavior — remedies 3 and 4

**Classification:** restoring unknown-equivalence referral is a correction to the existing rule. Slot matching, quoted-explanation R and their component-validity consequences are semantic changes.

- **C:** exact current status and complete requested slot assignments, qualifications represented by those slots, scope and source-claimed intervals.
- **O:** exact requested predecessor set, historical status and complete slot assertions.
- **R:** correct reason status and, for stated reasons, a complete, factually correct, delivered-supported causal explanation; negative R follows the explicit factual-status rule below.
- **J:** C×O×R **per family before aggregation or resampling**.

C/O remain factual correctness measures; citation quality is reported separately. Do not newly make C/O depend on citation validity.

Retain private gold causal graphs and their OR-of-AND support alternatives. They remain authoring/scoring structures, not a model response requirement. For mechanical stated-reason R credit:

1. Submitted quotations resolve to actual delivered evidence with preserved provenance.
2. Their coverage satisfies every required edge-support conjunction of at least one complete accepted graph.
3. Every selected causal clause belongs to an accepted causal explanation; unrelated, speculative, negated or wrong-change causes cannot be added.
4. Serial intermediates and conjunctive requirements cannot be skipped. Supported additional accepted branches remain permissible.
5. Delivery/context licensing must be sufficient for a mechanical decision; otherwise refer.

Do not obtain R credit by citing an entire record containing the correct explanation plus unrelated or contradictory material. Broader or unfamiliar selections require semantic evaluation rather than automatic acceptance.

`not_stated` requires no selected causal support and agreement with gold. This retains factual negative-R status scoring: no delivered negative witness is required, and an empty delivery can receive R=1 when gold is `not_stated`. Report this stratum separately from stated-explanation support, including its denominator and the deterministic no-evidence baseline that always returns `not_stated` with empty support. The negative-R support result is “not applicable,” not evidence-supported credit. Freeze empty-delivery tests showing that factual `not_stated` can pass while a stated explanation cannot pass without delivered support. Support uncertainty remains separate from factual correspondence. Unavailable evidence is not automatically a genuinely unstated reason.

**Referral routing:** perform public canonicalization and slot projection before comparing content. Unknown representation correspondence must refer the affected component whenever resolving it could change that component’s score. A determined zero requires an independent, sufficient contradiction or omission witness; a representation-dependent count/type mismatch is not such a witness. An R referral does not cover an unresolved C or O comparison.

This repairs the diagnosed interaction between unknown textual correspondence and qualifier/type mismatches. The current comparison combines these checks, while the scorer’s conjunction gives a zero precedence over an unknown. [scorer.mjs:8](../scorer/scorer.mjs#L8), [claim comparison:49](../scorer/scorer.mjs#L49), diagnosis:249

A structurally malformed whole answer still scores zero. In a structurally valid answer, invalid reason selection or citation semantics affect R; they do not erase independently valid C/O. No answer is repaired, recited or retried.

**Gold boundary remains mandatory:**

- Correctness adjudication receives the question, original anonymized slot answer—including its selected quotations—and quotation-free `G_correct`. It receives no supporting-source registry, hidden span licenses or delivery verdict.
- Support adjudication receives the question, original anonymized answer and actual delivered evidence, without gold, expected graphs or correctness findings.
- Support must follow submitted citations. Other delivered context may disambiguate or negate them, but cannot substitute uncited support.
- Neither pass may add missing values, causal clauses or citations.

**Recertification:** mechanical scoring, referral routing, pass projections, independent challenge gold, calibration v2, judgment-key definitions and sensitivity optimization. Recheck analysis adapters against the amended C/O/R/J outputs without changing the statistical rules.

### 6. Unresolved ingestion, compact evidence and P — remedies 5 and 6

#### Ingestion decisions

**Classification:** additional logging is nonsemantic. Queryable eligibility is unchanged.

Log, by shared event and arm:

- missing, nonunique, incompatible and historical anchors;
- unresolved extent;
- commitment filtering;
- absent product target;
- operation refusal, successful operation and scheduled-expiry outcome.

Do **not** make rejected events, unresolved updates or non-adopted proposals newly queryable, or add their raw source text as a fallback. Preserve each arm’s existing unresolved-record behavior. P still does not execute unresolved mappings or admit proposals/quotations as decisions.

The current P agent skips non-adopted and unresolved events before its pending-write queue; the research materializer separately constructs unresolved records. These distinct behaviors must remain visible rather than be silently harmonized. [product.mjs:64](../harness/product.mjs#L64), [research.mjs:32](../harness/research.mjs#L32)

This addresses remedy 5 without changing which evidence the policies retain.

#### Compact serialization

**Classification:** semantic representation amendment; assembly algorithms and budgets remain unchanged.

For T/U/O, serialize admitted slot assignments or admitted non-slot context text, existing policy-produced state/status/scope/time, predecessor references and source associations. Remove nested extracted Claim graphs and duplicated quote copies from indexed bodies. Carry each distinct admitted evidence quotation once per serialized record, with its source association; share it across fact/reason uses within that record.

Do not deduplicate across versions in a way that gives O access to overwritten history. Do not summarize, infer causal edges or omit required evidence.

P’s formatter writes only the current extracted event’s supplied slots or admitted non-slot context text, public source/record association, qualifications and admitted verbatim quotations. It must not append predecessor prose, reconstruct overwritten text, merge residual scopes or retain a reader-accessible archive. This changes the agent’s submitted representation, not the product’s capabilities.

Keep public-operation mapping and actual P retrieval intact: public writes; explicit hosted embedding refresh; separate current/history intents; representation-v2; default whole-record policy; 2,000-token budget per intent. The current research serializer includes nested reason structures, while both research and P perform whole-item delivery. [research.mjs:96](../harness/research.mjs#L96), [research assembly:121](../harness/research.mjs#L121), [P retrieval:181](../harness/product.mjs#L181)

Count complete research wire items—including address metadata—inside their existing intent budget. Preserve actual product blocks; do not rewrite or enlarge P’s returned evidence. Public instructions and any external addressing metadata count toward complete reader-request reservations. Scoring-only provenance maps never constitute delivered evidence.

**Recertification:** semantic round trips, historical destruction, source association, exact rendered bytes, whole-record inclusion/drop behavior, actual tokenizer counts, embedding per-input/request/cumulative bounds, P receipts and all complete provider bodies. Certify maximal causal alternatives and scope/predecessor structures; retain and report budget drops rather than changing ranking or raising delivery budgets.

#### Meaning of P’s headline

**Classification:** reporting clarification.

Every P headline must say:

> **Pinned product + frozen public-operation agent + shared research extraction + slot reader.**

It is a descriptive baseline of product update/retrieval behavior under common real-model ingress, **not an evaluation of the product’s native capture/extraction workflow**. The current runner extracts once and fans those events into research state and the product agent. [runner.mjs:46](../harness/runner.mjs#L46)

Do not add a native-capture arm or extra extraction calls in A-4. Continue stage-availability attribution, distinguishing extraction omission/exclusion, write retention, eligibility, retrieval/assembly and answering. P’s actual preservation losses remain findings.

### 7. Held-out integrity, freeze and engineering rerun

**Classification:** prospective semantic amendment with unchanged held-out allocation.

Development and test remain blocked and their active replacement materials unrendered/unseen. Preserve the existing inspected-reference exclusions and required fresh-bank replacements; do not describe previously inspected reference serializations as untouched. A-2 already records that contamination and the replacement obligation. [errata.md:74](../protocol/errata.md#L74)

Before further paid work:

1. Publish A-4, its semantic-change inventory and non-author review.
2. Freeze the public contract, prompts, schemas, admission rules, serializers, scorer and engineering examples.
3. Pass independent offline conformance and maximal-structure certificates using engineering/pilot material only.
4. Reconcile cumulative accounting and certify the amended pilot’s request plan.
5. Publish fresh deterministic seeds for **one** 60-family A-4 engineering run, preserving 12/type, language, causal/control branches and lineage multiplicities. Use engineering/pilot lineages only; new seeds do not establish new independent roots.
6. Run fresh extraction requests and stores. Preserve all previous runs; do not reuse old extractions under the new contract or pool scores.

A-1’s calibration-order exception extends only to this amended engineering run. Its reports remain **“Uncalibrated engineering pilot — mechanical score bounds; no adjudication.”** No Advance/Keep decision or calibrated accuracy claim follows from it.

There is no semantic accuracy floor. Continue to count real extraction omissions and reader errors; do not exclude difficult families. A broken contract, misprojection or unexercised branch caused by an implementation defect blocks continuation rather than becoming evidence about a policy.

After the run, development still requires all continuation gates: valid completion, cap fit, provenance/citations, calibration v2, resource capacity, reconciled accounting and feasible total completion. The **200-family development report remains the first substantive calibrated P baseline**. Development cannot change T/U or the decision rule.

Publish replacement-bank ancestry/allocation before held-out rendering. After the freshness/calibration gates, recertify those references before paid calls. No pilot answers, gold, specific routes/numbers, adjudicated mappings or case-specific fixes enter calibration v2.

### 8. Caps, reservations and cumulative budget

**Classification:** operational budget amendment. No scientific threshold, model or sampling change.

Retain the current output caps initially:

- Extraction: **4,352 billable output tokens**.
- Reader: **2,176 billable output tokens**.

Retain current input reservation ceilings: extraction **16,384**; reader **30,000 for T/U/P** and **22,000 for O**. Reservation remains complete provider-body UTF-8 bytes plus 4,096 framing units. These are the implemented limits, not newly certified A-4 fits. [requests.mjs:3](../harness/requests.mjs#L3), [reservation:33](../harness/requests.mjs#L33)

A-4 requires new certificates covering aliases, instructions, provider schemas, questions, both delivered intents and maximal valid outputs:

- At least **10% output headroom**.
- At least **5% input-reservation headroom**, matching the current certificate requirement. [request-certification.mjs:18](../harness/request-certification.mjs#L18)
- Both extractors, all arms, languages, causal/control branches and maximal structures.
- No evidence truncation or requirement removal to obtain a fit.

If these ceilings fail, stop before dispatch and publish a further numerical cap/budget amendment. Do not silently raise or reduce caps.

**Raise the cumulative engineering-pilot exposure cap from US$24 to US$50**, covering all historical pilots/preparation plus this one A-4 run. This is not US$50 of additional spending and does not authorize repeated tuning runs.

At the frozen local planning rates—primary US$0.40/US$1.60 per million input/output tokens; embeddings US$0.02/M—the conservative incremental bound is: [budget-a2.json:175](../harness/reports/budget-a2.json#L175)

| Item | Arithmetic | Bound |
|---|---|---:|
| 240 extractions, every transport retry | `480 × (16,384×0.40 + 4,352×1.60)/1M` | $6.488064 |
| 480 answers, every transport retry | `240 × ((3×30,000+22,000)×0.40 + 4×2,176×1.60)/1M` | $14.094336 |
| Entire research + P embedding allowance | `128M × $0.02/M` | $2.560000 |
| **Incremental conservative bound** | | **$23.142400** |
| Carried exposure, illustrative conservative amount | $24.00 | $24.000000 |
| **Combined bound at that carry amount** | | **$47.142400** |

Use exact ledger amounts for the actual gate. The owner-reported approximately US$2.14 settled spend is **not** the carried exposure: all full unknown reservations, preparation charges and cumulative embedding counters remain carried. Never substitute rounded actual spending for exposure.

Before opening the new journal, hash-verify and merge the complete third-pilot accounting chain exactly once. Preserve historical journals and their original limits. Update the new ledger version, pilot-cap check, continuation projection and freeze manifests consistently; do not mutate historical configurations. The existing accounting distinguishes settled/outstanding exposure and verifies inherited sources. [accounting.mjs:19](../harness/accounting.mjs#L19), [source merging:81](../harness/accounting.mjs#L81)

**Global limits remain:**

- Operational stop: **US$450**.
- Authorization: **US$500**, including every research API/preparation charge.
- US$50 authorization headroom remains unavailable.
- Research/P embedding counters remain cumulative at 64M units each.
- One transport retry; no quality retry; no unlisted calls.

For scale, retaining the existing full-output planning assumptions gives future development/test/alternative response forecasts of **$17.54112/$140.32896/$25.17248**. Taking the entire $50 pilot cap, the entire $2.56 embedding allowance again conservatively, and 25% contingency on prospective work gives:

`$50 + 1.25 × ($17.54112 + $140.32896 + $25.17248 + $2.56) = $282.00320`.

This is a planning illustration, not measured A-4 usage or an all-retry guarantee. The underlying stage figures are recorded in the current budget artifact. [budget-a2.json:278](../harness/reports/budget-a2.json#L278)

Before development, regenerate the binding **≤US$400 total-completion projection** from A-4 pilot usage, full outstanding exposure, remaining embeddings, alternative extraction and contingency. Re-derive/disclose stage allocations within US$450 as required; do not automatically increase later-stage caps. The all-maximum/retry envelope remains uncovered, so dynamic stops—not the forecast—protect the authorization. Budget exhaustion leaves an incomplete confirmatory run **Inconclusive**.

Codex calibration/adjudication remains subscription work, separately logged and resource-gated. No additional paid judge or fixture generation is introduced.

### 9. Calibration v2 requirements

**Classification:** mandatory recertification of the amended measurement pipeline; no relaxation of existing acceptance thresholds.

Calibration v2 must independently validate the **actual A-4 mechanical/referral/two-pass/resolution pipeline**, not the superseded Claim-graph response schema.

Before calibration authoring, enumerate admissible production uncertainty classes for each component. Demonstrate actual positive/negative referral qualification under the frozen A-4 pipeline, without withholding public aliases or manufacturing invalid answers. If a component is fully mechanically decidable, explicitly amend its inapplicable referral requirement rather than counting automatic decisions as genuine referrals. Freeze pass/session counts and resource projections from that enumeration.

| Component/pass | Domain-specific referral plan |
|---|---|
| C correctness | Literal route IDs, Boolean states, registered unit conversion, scope and intervals are mechanical. Enumerate any contract-permitted residual value/unit equivalences actually referred by the frozen pipeline, or certify that none exist. |
| O correctness | Apply the same check to slot assertions, plus requested-record identity, historical labels and equivalent partitions. Only residual semantic correspondence that can change O qualifies. |
| R correctness | Qualify complete and incomplete quotation selections whose causal meaning is not settled by recognized provenance/support correspondence, including broad or unfamiliar selections. |
| R support | Qualify selected citations with context-dependent negation/disambiguation or unresolved delivered-alias/occurrence interpretations. Factual negative R has no support-pass quota. |

Freeze a component/domain applicability table before calibration authoring. A fully mechanical domain requires an explicit prospective inapplicability amendment, its decidability evidence and non-author confirmation; only its genuine-referral quota and adjudicator-agreement requirement become inapplicable, while mechanical and full-pipeline error gates remain. Otherwise the existing positive/negative language/style quotas must be met by actual qualifying referrals. Failure to demonstrate either a qualifying population or certified inapplicability blocks calibration; it does not license invented ambiguity or silent quota removal.

It must cover:

1. **Public-contract correctness:** bilingual/mixed aliases; literal route IDs; Boolean and rational-unit equivalents; all slot states; absent versus unavailable fields; scope partitions; intervals; erroneous versus adopted versus expired predecessors.
2. **Admission isolation:** independent valid facts survive invalid reason quotations; invalid scope/time/provenance cannot become admitted facts; bad assignments do not contaminate valid ones; derived masks preserve T/U differences.
3. **Referral routing:** unfamiliar equivalences, wrong values versus representation uncertainty, component-specific referrals and forced-J-zero accounting. Include independently authored witnesses of the general failure class; do not import diagnosed pilot submissions.
4. **Reason selection:** direct, unstated, serial two/three-edge, conjunctive and alternative explanations; complete versus partial paths; wrong direction/change; supported unions; endpoint-only selections; speculation, negation and broad citations.
5. **Citation semantics:** body/receipt addresses, aliases, normalization, truncation, repeats, overlapping ambiguity and source-turn association. Correct-looking text from the wrong change must not establish support.
6. **Gold isolation:** matched identical question/answer/`G_correct` cases with adequate, endpoint-only, negated, truncated and removed delivery. Only the gold-blind support result may use changed delivery context.
7. **Production referral population:** retain the frozen language/component/style quotas and actual-referral qualification rule for domains declared applicable by the reviewed pre-authoring plan. Automatically resolved cases do not satisfy genuine-referral quotas. Publish an executable enumeration of every required stratum before judgments.
8. **Correlated error:** faithful/distorted representations, shared equivalence keys and parent-rule failures across arms; retained integer error budgets, shared-key propagation and judgment-sensitive decision bounds.
9. **Blinding and resources:** unchanged independent non-author Codex adjudicators/resolver, fresh isolated sessions and recorded model identities. Measure referrals, resolution, latency, quota and optimization capacity before promising completion.

Retain all existing false-accept/reject, evidence-stress, agreement and completion gates for their declared applicable domains; do not relax them because the interface is simpler. Publish exact bundle/pass/session counts, provenance, independent-world/key denominators, exclusions and a measured resource plan. A gate failure blocks development and adjudicated research accuracy reporting.

Revalidate scorer-to-analysis adapters and rerun the required bootstrap/power/coverage harness with amended score vectors. Keep statistical allocations, effect grid, thresholds, correction and multiplicity interpretation unchanged. Pilot effect sizes must not determine sample size or decision thresholds.

### 10. Implementation checklist

These are starting points, not an exhaustive changed-file manifest. The five directories were cross-checked through `rg` file parents and independent filesystem enumeration; count **5**, exit **0**.

| Directory | Required work |
|---|---|
| **`generator/`** | Publish the public slot/alias contract; announce slots and predecessor identities in questions; project gold to slot rows while retaining private causal/support structures; preserve source timelines, causal allocations and controls; validate semantic equivalence and held-out exclusions. Starting points: [common.mjs:51](../generator/common.mjs#L51), [bank.mjs:16](../generator/bank.mjs#L16). |
| **`scorer/`** | Replace generic answer graphs with slot/evidence selection; implement complete-path support scoring; correct component referral routing; preserve C/O factual scoring and citation diagnostics; update gold-blind/correctness bundles, dependence keys and focused negative tests. Starting points: [scorer.mjs:49](../scorer/scorer.mjs#L49), [citations.mjs:116](../scorer/citations.mjs#L116). |
| **`harness/`** | Send the complete public contract to both models; remove extracted masks/graphs; implement independent assignment/quote admission and derived masks; compact research/P formatting without new archives or fallback; log ingestion losses; version caches, schemas and artifacts; recertify caps, requests, embeddings and privacy; implement $50 cumulative pilot accounting and regenerated continuation projection. Starting points: [schema.mjs:62](../harness/schema.mjs#L62), [requests.mjs:11](../harness/requests.mjs#L11), [ledger.mjs:6](../harness/ledger.mjs#L6). |
| **`integration/`** | Replace field mappings and reconciliation expectations; verify source→extraction→policy→delivery→answer→score accounting; demonstrate unchanged T/U updates and P public operations on independently authored cases; verify all failure/unknown paths and no private-field leakage. Starting point: [field-map.mjs:1](../integration/field-map.mjs#L1). |
| **`challenge/`** | Independently author calibration v2 for the amended contract; enumerate required genuine-referral strata and pass/session counts; preserve bilingual/mixed and evidence-contrast coverage; validate gold provenance and isolation; benchmark the complete blinded adjudication pipeline. Regenerate challenge schemas/manifests only after A-4 freezes. |

Append A-4 to `protocol/errata.md` and regenerate applicable freeze/certificate hashes. Run focused checks only, retain actual exit codes, and cross-check the eventual implementation manifest by two independent enumeration routes. This draft ran no model calls or repository tests and wrote no files.

### 11. Simplification rationale and limitations

| Simplification | Why it serves §1 and preserves the comparison |
|---|---|
| **Named route/approval/cap slots** | Tests recovery of decisions and qualifications directly; removes arbitrary main-value/qualifier placement. Partial updates and scope inheritance still distinguish T from U. |
| **Derived supplied-field mask** | Removes redundant model bookkeeping. T still receives exactly which fields were supplied, while U still selects whole versions. |
| **Flat extracted causal quotations** | Preserves explicit reasons without requiring extraction to invent a graph ontology. Typed update behavior does not require those graph objects. |
| **Quoted explanation instead of generated nodes/edges** | Requires the complete “why,” including multi-hop/conjunctive content, while removing hidden endpoint conventions and dangling IDs. |
| **Independent factual/causal admission** | A reason-format defect should not destroy independently supported current or historical facts. Shared admission keeps treatment inputs equal. |
| **Compact, provenance-preserving serialization** | Spends the fixed delivery budget on decisions and evidence rather than duplicated graph scaffolding. Whole-record assembly remains tested. |
| **No new unresolved-source fallback or native-capture arm** | Avoids adding capabilities, arms or paid calls unrelated to the immediate contrast. Exposes existing policy/product retention limits. |

A-4 deliberately narrows answering to structured decision recovery and quotation selection. Results will not establish free-form explanation quality, arbitrary-schema competence or native product capture accuracy. Public aliases make lexical correspondence explicit; synthetic grammar and calibrated model judgment remain limitations. Real extraction errors still affect every arm, and stage diagnostics must accompany the accuracy results.

### A-4.1 (2026-10-25): extraction input reservation ceiling (numerical amendment under A-4 §8)

- **Measurement.** The lossless public-contract projection fails the unchanged extraction input ceiling. All 1,920 certified extraction requests exceed 16,384 with the required 5% headroom. The worst complete reservation is 18,480, so the ceiling must be at least 19,453.
- **Change.** The extraction input reservation ceiling rises from **16,384** to **20,480**, giving about 9.8% headroom over the measured worst. No evidence, contract content or requirement is removed.
- **Unchanged.** Output caps, reader ceilings, models and every other rule.
- **Cost.** The incremental conservative pilot bound becomes approximately US$23.92 (previously US$23.14), within A-4's US$50 cumulative engineering-pilot exposure cap.
- **Review.** This amendment goes to non-author review together with the A-4 implementation before any paid run.

### A-4.2 (2026-10-25): reader input reservation ceilings (numerical amendment under A-4 §8)

- **Measurement.** Complete A-4 reader bodies fail the unchanged reader ceilings with the required 5% headroom. Worst complete reservations: U 33,526, T 29,331, O 28,022, P 34,965 (minimum ceilings at 5%: 35,291, 30,875, 29,497, 36,806).
- **Change.** The reader input reservation ceiling rises from **30,000 to 40,960 for T, U and P**, and from **22,000 to 32,768 for O**. This gives about 14.6% headroom over the measured worst for P and O. No evidence, contract content or requirement is removed. Arms still differ only in what they contain, never in truncation.
- **Unchanged.** Output caps, the extraction ceiling of 20,480 from A-4.1, models and every other rule.
- **Cost.** The reader bound becomes `240 × ((3×40,960+32,768)×0.40 + 4×2,176×1.60)/1M` = US$18.284544 (previously US$14.094336). The incremental conservative pilot bound becomes approximately US$28.12. With the verified carried exposure of US$2.136861040 through pilot3, the cumulative bound is approximately US$30.26, within A-4's US$50 cumulative engineering-pilot exposure cap.
- **Review.** This amendment goes to non-author review together with the A-4 implementation and A-4.1 before any paid run.

### A-1.1 (2026-10-25): analysis and adjudication-resource validation gate inference, not the engineering pilot (primary amendment; needs non-author confirmation)

- **Problem.** §13 step 4 lists resource benchmarks and corrected-analysis validation (§15) before the pilot. A-1 waived only the calibration ordering and kept "all non-adjudication preflight requirements". Read literally, the 60-family engineering pilot must first wait for the full §15 analysis workload: 60 power cells and 12 coverage cells, 2,000 datasets per cell, 10,000 corrected draws, projected at about 23 hours and allocated at least 36. That analysis implementation does not exist yet.
- **Recorded deviation.** The three paid engineering pilots so far (A-1 through A-3) ran without §15 validation or the §15 subscription benchmark. Neither had been performed. Their reports contain only mechanical score bounds and no intervals or inference, so no reported number depended on the missing validation. This is recorded as a deviation, not cured retroactively.
- **Change.** For engineering pilots under A-1 (and A-4 §7), these items move from "before the pilot" to "before development and before any interval or inferential claim":
  - the §15 corrected-analysis validation, including the A-4 §9 bootstrap/power/coverage rerun with amended score vectors;
  - the §15 subscription and adjudication resource benchmark and projections.

  Engineering pilot reports stay "Uncalibrated engineering pilot — mechanical score bounds; no adjudication". They publish **no confidence intervals, bootstrap estimates or contrasts with uncertainty**; A-1 already makes them descriptive only.
- **Rationale.** The pilot's purpose is execution validity. The analysis validation does not use pilot data, and §15 and A-4 §9 forbid pilot effect sizes from determining sample size or thresholds. Ordering it first delays the engineering check without protecting any reported quantity.
- **Unchanged and still binding before the paid pilot:**
  - the output, request, embedding and privacy certificates;
  - conformance;
  - allocation and fresh seed;
  - reconciled cumulative accounting under the US$50 cap;
  - one fresh run;
  - a primary freeze;
  - non-author review.
  - §15's run-supervision and stop rules: attended execution, progress checks at least every minute, and stops on accounting or model mismatch, unexplained usage, authorization exposure, three transport failures or five minutes without progress.
  - Development still requires every original continuation requirement (A-1), including §15 analysis validation, measured resources and calibration v2.

### A-5 (2026-10-25): prospective confirmatory-analysis conventions (§§12/15) (non-author audit: acceptable after revision r1)

- **Status and scope.** Proposed prospective amendment and clarifications for non-author review, referencing analysis commit `86ebb5aa962c19e2800041d12c72a46ab95cc66e`. No pilot observations, effect estimates or scores select these conventions. Keep the allocations, 60-cell effect/discordance/ICC/harm grid, 12 additional coverage cells, 2,000 datasets/cell, 10,000 draws, centered finite-sample correction, decision thresholds and scientific multiplicity interpretation unchanged. T−U under A-4 remains the sole confirmatory contrast. A-1.1 places this validation before development and any interval/inferential claim; numerical simulation can precede calibration, but cannot certify factual judgment robustness.

**1. Failure-component distribution — adopt the candidate.**

- **Decision.** In a paired outcome, probabilities of both-success, U-only, T-only and neither-success are respectively `.40−(q−δ)/2`, `(q−δ)/2`, `(q+δ)/2`, `.60−(q+δ)/2`. Each failed arm has exactly one failed component, selected independently with probabilities `(1/3,1/3,1/3)` for C/O/R. Other components equal one. In harm cells, independently for 30% of neither-success pairs, replace these selections by U failing R and T failing C. Apply the frozen ICC mixture to the **entire** paired outcome, including these selections and the harm realization. With `h=.30×P(neither-success)` in harm cells, otherwise zero, true differences are `(δ, δ/3−h, δ/3, δ/3+h, δ/3+h)` for J/C/O/R/multi-hop R. This adopts [simulation.mjs:7](../analysis/simulation.mjs:7).
- **Intent and consequence.** Uniform allocation is a symmetric completion of “selects a component,” without importing empirical failures. It leaves J margins/effects unchanged but determines guard covariance and advancement power. The override worsens C and improves R for T−U; it can increase C-guard failures. Relative to other failure distributions, overall power/coverage can move either way; no empirical realism claim is made.

**2. Coverage distributions — adopt the candidate parameters and panels.**

- **Decision.** Use type order `correction, reversal, refinement, scope_change, expiry`. Homogeneous Bernoulli components have `p=.40`; heterogeneous components have type-specific `p=(.20,.30,.40,.50,.60)`. Homoscedastic normals have mean `.40`, SD `.20`; heteroscedastic normals have mean `.40`, type-specific SD `(.10,.15,.20,.25,.30)`. Parameters are fixed within each type/lineage. Draw families, arms P/T/U and their three components independently conditional on those parameters; no ICC mixture enters these 12 cells. For Bernoulli, family J is the component product, with truth `p³`. For normals only, the J analogue is the component average, with truth `.40`: it is a linear mathematical benchmark, never a replacement for scientific binary J.
- **Panels and truth.** At each frozen split allocation, retain 13 columns: P C/O/R/J overall; P C/O/R/J within correction; paired J difference; C/O/R differences; multi-hop R difference. Absolute truths use the exact frozen weighted type means; all paired truths here are zero. Thus heterogeneous overall component/J truths are `.40/.088`, and correction truths are `.20/.008`. The correction panel is a prespecified representative within-type benchmark, not certification of every possible type/distribution. This adopts [design.mjs:18](../analysis/design.mjs:18) and [simulation.mjs:38](../analysis/simulation.mjs:38).
- **Intent and consequence.** These instantiate the four required classes, including rare joint successes and fixed heterogeneity, without changing workload. Sparsity, variance and dependence affect coverage in either direction. Normal results do not establish binary boundary coverage; passing these distributions is not universal coverage proof.

**Structural checks before allocation eligibility.** The synthetic checks cover all five within-type and overall binary-absolute C/O/R/J panels, not just the correction representative. Across three allocations and two Bernoulli designs, 144 scalar panels reduce to 42 distinct probability/allocation configurations. [Structural computation:1](../analysis/a5/a5-structural-r1.py:1) exactly reproduces the pilot bound `coverage ≤ .8824799232` by 4,096 ordered datasets and independent integer-state enumeration. Complete source-state support enumeration is exact integer arithmetic where n≤400; test overall cells use the same state enumeration with an explicit roundoff enclosure. These are upper bounds on attainable coverage, not estimates or passing certificates. The support bounds alone do not prove a development/test cap below .93.

Further exact source-profile/conditional-CDF enumeration with outward-rounded finite-B Chernoff bounds proves fresh-resampling percentile coverage ceilings of `.928037177` for development within-type p=.30, `.929814806` for development overall J p=.064, and `.929094740` for test within-type J p=.027. These bounds average over fresh bootstrap draws; they are not falsely presented as exact ceilings for the one frozen matrix. [Percentile bounds:1](../analysis/a5/a5-percentile-bound-r1.py:1) Targeted simulation covers every configuration with 100,000 synthetic datasets. Six additional 100,000-dataset probes use the actual frozen matrices; they independently show development/test undercoverage, with Monte Carlo uncertainty explicitly reported. [Fixed-matrix probes:1](../analysis/a5/a5-fixed-matrix-r1.py:1) The complete table, numerical qualifications and exit codes are retained in [structural report](../analysis/a5/a5-structural-r1-report.md:1). No pilot observations enter these calculations. The failures require the development/test amendment in point 5, not removal of those cells.

**3. Whole-lineage sensitivity — adopt the candidate, as sensitivity only.**

- **Decision.** For the supplied joint outcome vector, stratify lineages by `(type, complete frozen weight vector)`. In each stratum containing g lineages, sample g whole lineages with replacement; retain every selected lineage's complete family vector and original weights. Do not also resample families or apply the finite-family multiplier. Preserve fixed denominators, not ratio weights. For the primary/guards this preserves multi-hop/non-multi-hop counts per type: pilot `4/2`, development `6/4`, test `20/20`. Use 10,000 paired/shared replicates and the same percentile convention as point 7. This adopts [bootstrap.mjs:111](../analysis/bootstrap.mjs:111).
- **Intent and consequence.** It probes lineage generalization while preserving allocation and guard composition, separately from conditional-family inference. Its intervals may widen or narrow relative to primary intervals; they never replace the primary CI, change Advance/Keep, or acquire a finite-sample coverage guarantee. ICC>0 simulation results and lineage coverage remain separately reported stress/sensitivity results.

**4. Coverage acceptance — replace the candidate's flag-only rule with a blocking gate.**

- **Audit family.** Retain all 72 simulation cells, 2,000 datasets/cell and 10,000 draws. The four pilot-allocation coverage cells (52 scalar outputs) become mandatory disclosed method-diagnostic reports, not acceptance cells. The procedure is already prohibited for research inference at that allocation by A-1/A-1.1; this is a non-use restriction, not deleting a failing cell to license its use. Acceptance covers the eight development/test coverage cells and all 20 ICC=0 power cells: `8×13 + 20×5 = M=204` scalar cells. No development/test cell is removed. For binary absolute panels use the amended interval in point 5; for contrasts/guards and normal benchmarks use the raw corrected interval. Publish raw-only absolute coverage as an additional diagnostic, not another acceptance cell. Include both harm states and all effects/discordances; do not deduplicate correlated or identical columns. ICC>0 cells and whole-lineage sensitivity remain mandatory stress reports.
- **Numerical rule.** For each cell record coverage count k, `ĉ=k/2000`, `MCSE=sqrt(ĉ(1−ĉ)/2000)` and two-sided Wilson 95% Monte Carlo interval. Require **k≥1,860 (93%) in every cell**. Additionally compute the exact lower-tail binomial p-value `P[Binomial(2000,.95)≤k]` for undercoverage of nominal 95%; apply Holm step-down across the fixed 204 cells at familywise `.05` (sort ascending; compare rank j to `.05/(204−j+1)`, stop at the first non-rejection). **Any rejection fails validation.** Report unadjusted and Holm-adjusted p-values. The first Holm cutoff is `.05/204 = .00024509803921568627`; its largest rejecting count at N=2,000 is 1,863. The 93% floor and all other thresholds are unchanged. The two-point empirical deficit is the prespecified material floor, not a claim that non-rejection proves true coverage ≥95%.
- **Multiple-cell audit.** Independently review the complete cell/metric matrix, every empirical-floor failure, every Holm rejection and every unadjusted Wilson upper endpoint below `.95`; retain all flags and explain their multiplicity and clustering by split/distribution/metric. Pass requires the numerical gate, complete artifacts, mathematical/parity checks and non-author confirmation of implementation and audit completeness. An unadjusted flag alone is not an automatic failure or a reason to delete a cell. Monte Carlo trials are datasets, not bootstrap replicates. These tests concern simulation validation only; they add no multiplicity adjustment to the HR-3 estimand or guards. The current runner only flags Wilson upper endpoints below `.95`; implementing this acceptance gate is required. [runner.mjs:25](../analysis/runner.mjs:25)
- **Pilot non-use.** Record the analytic failure. No interval of any kind may be reported for a research outcome at the pilot allocation unless a prospectively amended procedure has independently passed validation at that allocation; no bootstrap estimate or contrast with uncertainty is allowed either. The development/test amendment below does not authorize pilot use. A later proposal for pilot inference must prospectively amend the procedure and acceptance family before use. Synthetic method-diagnostic coverage reports and Monte Carlo uncertainty quantify algorithm performance, not empirical pilot outcomes; A-1's logical mechanical score bounds remain non-inferential and cannot be relabeled as confidence intervals.
- **Failure and direction.** Missing mandatory reports, missing acceptance cells, either numerical acceptance failure or an implementation defect block development and all inferential claims. Preserve the failure. No seed shopping, extra datasets until passing, cell exclusion, threshold relaxation, post-result interval substitution or quiet retuning is allowed. Any remedy requires a disclosed prospective amendment, independent review and a newly frozen full validation, retaining prior results. This gate can only reduce readiness relative to flag-only reporting; it changes no scientific interval or decision threshold.

**5. Binary-absolute intervals — substantive prospective amendment, including interior cells.**

- **Decision.** Use `p={0,.001,.01,.99,.999,1}` and n equal to overall/per-type family counts: pilot `60/12`, development `200/40`, test `1600/320`. For all failures report `[0,1−.025^(1/n)]`; for all successes `[.025^(1/n),1]`. Compute extreme-observation probabilities `(1−p)^n` and `p^n` and their unconditional noncoverage contributions analytically: **zero Monte Carlo replications**. For zero hard violations, report `1−.05^(1/k)` using the audited number k of independent eligible family opportunities; repeated checkpoints do not increase k. Grid calculations assume independent identically distributed Bernoulli opportunities; do not transfer that assumption to actual controls without evidence. This adopts [boundary.mjs:6](../analysis/boundary.mjs:6) and [statistics.mjs:24](../analysis/statistics.mjs:24).
- **Audit classification.** This is a prospective amendment to §11’s reported binary-absolute intervals and §15’s validation target. Preserve the corrected-bootstrap interval and supplement separately, report their prescribed convex hull at boundaries, and validate that combined procedure. Contrast/guard intervals and scientific decision thresholds remain unchanged.
- **Interior amendment for development/test.** The boundary hull does not fix the demonstrated interior failures. For every development/test binary absolute C/O/R/J panel, overall and within every type, use the same rule, not a case-specific exemption: report the convex hull of the frozen corrected-bootstrap interval and the following independent-Bernoulli KL-Chernoff carrier. For n independent, equally weighted family outcomes, x=s/n, let `I_KL={u∈[0,1]: n D(x||u)≤log(40)}`, where `D(x||u)=x log(x/u)+(1−x) log((1−x)/(1−u))`, with continuous endpoint conventions. For x=0 the carrier is `[0,1−.025^(1/n)]`; for x=1 it is `[.025^(1/n),1]`. For interior x, find the two roots and round outwards (bracket width ≤1e−12); failure to certify an outward bracket blocks reporting. Retain raw bootstrap, carrier, boundary supplement and reported hull separately. Intersect absolute display endpoints with `[0,1]` only after forming the hull; never clip replicates. Apply no carrier to normal analogues, paired contrasts, component guards or multi-hop guards. Judgment-error assignments must recompute the carrier from perturbed per-family counts. Raw-only linear envelope code does not certify the augmented P interval: exact bounds or conservative propagation through the monotone carrier endpoints over allowed count bounds are required.
- **Guarantee and validation.** For independent Bernoulli outcomes with possibly unequal probabilities and mean u, the product MGF is at most `(1−u+u exp(t))^n` by AM–GM. Chernoff inversion bounds each tail by .025, so the carrier—and therefore the hull—has coverage at least .95. Frozen overall/per-type allocations have equal family weights. This guarantee conditions on independence; it does not cover shared judgment error or random-lineage dependence. Numeric Poisson-binomial checks cover all 28 distinct development/test designs; the minimum carrier coverage is about 98.9122%, but those floating checks do not replace the analytic guarantee or full validation. [Carrier check:1](../analysis/a5/a5-kl-check-r1.py:1) The full amended 204-cell gate and all retained reports must still pass on a newly frozen implementation.
- **Intent and consequence.** This is an explicit, conservative interval amendment responding to synthetic structural/percentile failures. It can widen binary absolute-score intervals and increase their coverage; its conservatism must be visible beside raw intervals. It changes no point estimate, allocation, update policy, paid cap or reader. **T−U contrast intervals and every confirmatory guard remain the frozen corrected bootstrap.** No contrast failure has been established by these absolute-score checks; their full-grid validation remains mandatory, and a demonstrated failure would require a separate prospective amendment rather than carving out a cell. Primary conditional power and scientific thresholds are unchanged; readiness can change only through the disclosed validation gate.

**6. Judgment identities, calibration inputs and optimization — adopt fail-closed analysis; complete its external-input contract.**

- **Calibration v2 must supply:** the frozen admissible/referral domains and any reviewed mechanical-domain exemptions; rubric/model/panel/contract/dictionary versions; independent challenge gold and final pass verdicts; separate FA/FR error counts and independent-world/key trial denominators for component/pass, language, style and distortion strata, with the dependence/aggregation rule stated. Supply unsupported-stratum markers, not invented zero errors. The one-sided 95% upper rate is exact Clopper–Pearson; unsupported strata have rate one. Empirical, upper and capped doubled-upper rates yield integer budgets `min(K_s,ceil(K_s p_s))` over **all eligible distinct keys**, accepted and rejected. This adopts the candidate rate/budget formulas. [statistics.mjs:45](../analysis/statistics.mjs:45)
- **Identity registry.** Before development, calibration v2 must freeze contextual-key creation, propagation licenses, stratum assignment, parent-rule grouping and parent-failure scenario-generation rules. It cannot supply unseen research answer identities. At scoring, that frozen pipeline must emit the complete actual key/verdict/application registry, including direct referrals, propagated mappings and forced-J-zero components, bound to family/arm/checkpoint/component/pass and provenance hashes. Preserve genuine shared-key dependence and every eligible error source in the claimed robustness scope; exclude mechanically fixed domains only with the reviewed certification. Freeze the resulting registry before confirmatory analysis, without outcome-based grouping or scenario selection. Scorer key strings or row numbers alone are insufficient. [adapter.mjs:39](../analysis/adapter.mjs:39)
- **Parent scenarios and strata.** For each registered parent-rule family, include separately: all member verdicts flipped; only member ones changed to zero; only member zeros changed to one. Membership follows the frozen generator, never influence rankings. Parent scenarios are additional stress assignments, not capped by calibration key budgets. Within each budget envelope, preserve applicable FA/FR budgets and all supplied stratum constraints. The candidate optimizer's one-stratum-per-key interface is usable only for a certified disjoint partition; overlapping constraints require an exact/certified extension or a conservative outer relaxation, never lossy reassignment.
- **Optimization.** Exhaustively enumerate allowed assignments with the candidate limit **65,536 assignments per envelope**; at the limit, stop exact enumeration rather than certify a prefix. Run empirical/upper/doubled-upper envelopes and parent scenarios, retaining shared family draws and recomputing scores, point estimates and lineage means for each assignment. Certified bounds may replace enumeration. The unrestricted all-dependent outer bound remains separately labeled, uses the corrected potentially negative coefficients, and cannot be called an exact budget envelope or exact tipping point. If bounds do not establish robustness, report judgment-sensitive/Inconclusive. The production registry must determine a measured runtime/memory projection before optimization; the synthetic benchmark is no feasibility certificate. [judgment.mjs:10](../analysis/judgment.mjs:10), [outer bound:53](../analysis/judgment.mjs:53)
- **Before calibration exists.** Analysis may run the frozen synthetic 72-cell workload, parity/variance/coverage checks, boundary calculations and explicitly synthetic optimizer benchmarks. It may validate input schemas and publish statistical power conditional on finalized error-free labels. It may not invent empirical rates, eligible populations, propagation licenses or final verdicts; mark factual robustness **unestablished** and issue no actual-data intervals/inference or calibrated advancement claim. Missing production inputs are not repaired by setting a caller's `calibrated` flag. Errors can move T−U either way; honest error envelopes weakly reduce certifiable advancement relative to ignoring judgment uncertainty.

**7. Draw generation and quantiles — adopt the candidate executable conventions.**

- **Decision.** Freeze `random.mjs` at the cited commit: UTF-8 SHA-256 seed; first 16 digest bytes as four little-endian uint32 words; xoshiro128**; rejection-sampled bounded integers; `uint32/2^32` uniforms and the implemented cosine Box–Muller normal draw. Generation seed is `hr3-validation-v1/<cell-id>/<index>`, indices `0..1999`. For every dataset, panel and judgment assignment, restart primary resampling at `hr3-bootstrap-v1`; process the published planned lineage/family order, never outcome-sorted order. Every lineage consumes m index draws even at zero weight. Share sampled families across outcomes/arms/checkpoints. Whole-lineage sensitivity uses the separate `hr3-bootstrap-v1/lineage` stream, strata in first-occurrence planned order. Use sorted Float64 replicates and linear interpolation at `(B−1)p`, `p=.025,.975`; do not clip or round before decisions. Freeze source/authority hashes and Node/platform metadata; worker count must not change results. [random.mjs:4](../analysis/random.mjs:4), [bootstrap.mjs:67](../analysis/bootstrap.mjs:67), [statistics.mjs:6](../analysis/statistics.mjs:6)
- **Intent and consequence.** This makes the existing seed/shared-draw/interpolated-percentile requirements reproducible. Common bootstrap draws leave the target resampling law unchanged but make validation conditional on that fixed draw matrix; Monte Carlo intervals quantify generated-dataset uncertainty, not additional randomness from choosing another matrix. Changing RNG/order/interpolation can move finite-draw endpoints and near-threshold decisions either way; no alternate seed is selected after results.

- **Related execution clarification.** Adopt the separately disclosed Keep-first overlap convention: after validity gates, hard-violation handling and the judgment-robustness gate, evaluate the frozen Keep conditions before Advance when both table rows match. This changes no threshold and can only turn an overlapping otherwise-Advance classification into Keep U, never the reverse. Retain no familywise-95% claim for Keep. [decision.mjs:8](../analysis/decision.mjs:8), [README.md:331](../analysis/README.md:331)
- **Freeze and reporting.** Candidate labels are not acceptance. Preserve r0 and all structural failures; freeze the reviewed A-5-r1 implementation/authority identity, then complete the full workload and independent review before development/inference. Report all failures and exclusions; reduced runs and old precursor results remain non-certifying. Keep supervision/resource gates and paid caps unchanged. This draft modifies no analysis code and records no validation or calibration pass.

## A-6 (2026-10-25): source-named predecessor identity and execution-contract repairs after engineering pilot four (non-author audit: acceptable for implementation after revision r1)

**Status:** prospective draft for primary freeze and non-author review; not execution authorization. Baseline reviewed: `22510a2cef486780ba7be805a4d33c68c3b42a6b`. No network, paid calls, keys or repository changes are part of this drafting task.

### 1. Purpose and amendment classification

The fourth pilot is an uncalibrated execution diagnostic, not evidence selecting a policy or model. The attribution finds that all 95 admitted focal changes are unresolved: source names exist, but extraction sees one batch while the resolver requires an earlier turn address. Its ranked remedies and ceilings are optimistic counterfactual bounds, not expected gains or amended scores. [diagnosis.md:51](evidence/pilot4-diagnosis.md:51), [ceilings interpretation:106](evidence/pilot4-diagnosis.md:106)

| Repair | Classification and validity rationale |
|---|---|
| Source-name registry | **Prospective extraction/link-contract amendment with semantic pipeline effects**, implementing A-4's intended source-stated predecessor identity. It changes which explicit references can resolve; it does not change what correction, reversal, refinement or scope change means. Do not describe it as prompt-only or retrospectively compatible. |
| Extraction and reader instructions/examples | Clarifications of existing A-4 meanings; validators, admission thresholds, reader capabilities and update policies stay unchanged. |
| R punctuation coverage | Narrow semantic-content clarification of §7, implemented as a **prospective scorer/canonicalization amendment** because mechanical verdicts can change. It does not license punctuation normalization during citation resolution. |
| Model selection | Recommend **no primary model change**. Other configurations below are prospective cost comparisons, not a four-way paid bakeoff or automatic permission to migrate. |

These repairs address unavailable identity information and documented contract adherence, rather than selecting parameters to increase T−U or J. They apply identically across arms, are frozen before the fresh pilot, and introduce no accuracy-based continuation floor. Earlier runs remain immutable and unpooled.

### 2. Deterministic, gold-free predecessor identity

The current extraction input is batch-only; the extraction schema has predecessor turn/name anchors but no own-record name, and `resolveLinks` matches earlier turn/subject/predicate without using the name. [extraction.mjs:8](../harness/extraction.mjs:8), [preflight-a4-schema.mjs:21](../harness/preflight-a4-schema.mjs:21), [research.mjs:7](../harness/research.mjs:7)

**New wire contract.** Replace the model's `predecessor_anchors` with:

```text
record_name: null | {name:string, anchor:{turn_id,quote,occurrence}}
predecessor_refs: [{record_name:string, anchor:{turn_id,quote,occurrence}}]
```

An own-name anchor quotes that event's complete source-stated identifier; a predecessor anchor quotes the identifier where the **current** batch refers to it. In both forms `quote` equals the submitted name before normalization, the turn belongs to the event's `source_turns`, and ordinary exact A-3 anchoring must succeed. Do not ask the extractor to invent the earlier turn. In the current ASCII-identifier fixture domain, require complete `[A-Za-z0-9_-]+` tokens, with adjacent characters outside that class; prefix matches such as `demo7` inside `demo70` do not qualify. Nonconforming names are not guessed. A name's role as own versus referenced is a model-extracted semantic assertion; an exact substring alone does not establish that role.

Own name means the newly introduced record's name, not the predecessor mentioned by “correct record …”. Use null if none is stated. Initial/unchanged events may have no predecessor references; updates requiring a predecessor remain unresolved if none is supplied. Emit each referenced record once. Keep the existing core fields, context branch, supplied-slot rules and derived field mask.

**Registry algorithm, before arm fan-out:**

1. Use only admitted, source-anchored name assertions. Partition by family/authorized namespace and canonical subject/predicate. The key is `(family, namespace, subject, predicate, record_name)`; scope and apparent currentness are not disambiguation keys. Subject/predicate use the unchanged public dictionaries. Names use the already declared NFKC/whitespace normalization, with case preserved; no case folding, phonetics, punctuation deletion or undeclared aliases. Source anchoring itself remains verbatim.
2. Process the unchanged frozen event order. For a reference, look up only already observed, strictly earlier admitted events whose naming evidence precedes the reference. Same-batch resolution requires both that order and source order to agree. Self/forward/cyclic references fail closed; do not retry them using later batches. Register the current event's valid own name after its references are processed; own-name collision checking is part of the same pre-enactment validation, before any write or predecessor retirement.
3. Zero matches → `missing_named_predecessor`; more than one distinct admitted event → `ambiguous_named_predecessor`. Keep colliding entries, including historical/non-adopted entries; never overwrite with the newest or pick an adopted/current candidate. A later collision affects later references, not past checkpoints. Replaying the same internal event key is idempotent, not a second name claim.
4. Distinct events with the same canonical key remain duplicates even if their text is identical. A current event introducing such a duplicate own-name binding is unresolved before enactment; keep both identities for later ambiguity checks rather than merging their facts. Repeated predecessor references resolving to one event are `duplicate_reference`, not silently deduplicated. An absent own name prevents registration without discarding otherwise admitted facts. A claimed own-name annotation with an invalid anchor, or any missing/invalid predecessor-reference annotation, makes the event unresolved before enactment; facts may survive only under the existing unresolved-record rules. No legacy core-admission rule is relaxed.
5. A unique identity must still pass every existing adoption, compatibility, overlapping-scope and historical-target check. Name resolution does not supply missing replacement extent or override those checks. Resolve a multi-predecessor set completely before enactment; any failure leaves the event unresolved. Preserve each arm's existing handling of unresolved records; P still skips unresolved/non-adopted writes.
6. Produce internal target event IDs and their source-turn associations from the registry, then feed that identical linked stream to all arms. Do not consult gold, ASTs, questions' requested predecessor lists, known batch patterns, source-renderer private names or a hand-authored pilot map.

Name anchors are identity annotations only: validate and audit them without automatically inserting name-only snippets into receipts, factual/reason evidence or reader bodies. Preserve the existing core/fact/reason quotation collection and receipt-selection policy. Emit one event for one source-asserted record/update and its supplied slots; repeated mentions do not create extra events, while distinct source events are never merged to avoid a name collision.

The registry stores identity, event key, naming-anchor location/hash and resolution diagnostics, **not slot values, old decision prose, reasons or a historical answer**. It is neither sent to the extractor/reader nor indexed/retrieved as memory. It cannot restore O's overwritten history, reconstruct P's pre-correction content or bypass forgetting. Retain collision/tombstone identities so deletion does not make a formerly ambiguous name look uniquely new; they never supply content or authorize a write. Logs and cache replay must distinguish registration, identity resolution and policy eligibility.

**Independent example, not a pilot case:** batch one says “Record demoLira: we adopt route demoRoute9.” Batch two says “Correct record demoLira; adopt record demoNeso with route demoRoute4.” The second extraction names its own record `demoNeso` and references `demoLira` at its current mention. The registry supplies the earlier event ID; the model supplies no earlier turn guess. If two earlier records claim `demoLira` under the same key, or its naming assertion was not admitted, the update stays unresolved. Publish a Traditional Chinese counterpart with the same semantics. These examples are excluded from research/calibration worlds.

No source text is changed to insert earlier-turn IDs. New schema/resolver/cache versions and fresh pilot requests are mandatory; do not retrofit old extraction replies into this contract.

### 3. Extraction instructions: retain strict admission

**Prompt/contract changes only for these admission remedies.** The current validator separately checks core enums, core anchors, assignments and reason quotations; invalid core excludes the event, including attached reasons. Preserve that behavior and the existing structural-schema versus event/domain-validation precedence. Do not coerce a wrong enum, salvage invalid-core reasons into a manufactured context event, supply defaults, or loosen exact anchors. [schema.mjs:72](../harness/schema.mjs:72)

Include this explicit crosswalk in the extraction contract, replacing vague/redundant instructions rather than adding case-specific hints:

| Field | Allowed meanings/values |
|---|---|
| `kind` | `fact`, `preference`, `decision`, `instruction`, `context` |
| `commitment` | `adopted`, `proposed`, `quoted`, `rejected`, `unresolved` |
| `change_type` | `initial`, `correction`, `reversal`, `refinement`, `scope_change`, `expiry`, `unchanged` |
| `replacement_extent` | `entire_predecessor`, `partial`, `unresolved` |

Required wording/examples:

- **Orthogonal fields:** “Correction is a change type, never a commitment. ‘The old assertion was never adopted; we adopt its replacement’ means `commitment:adopted, change_type:correction` for the replacement. A rejected proposal is `commitment:rejected`; it enacts no decision.” Include English/Traditional Chinese positives and negatives. Do not move these checks into a provider enum restriction that would change event-level rejection into whole-batch rejection.
- **Source coverage:** “List every current-batch turn used by event, slot, own-name/reference and reason anchors in `source_turns`. Never put an unavailable prior turn there. Copy exact quotations and their actual local occurrences; the harness computes offsets.”
- **Causal clauses:** “Copy every explicitly stated serial clause, conjunction and sufficiency qualification needed for the change, retaining its source association. Attach them as `reason_quotes` independently of which slots are supplied; do not invent a graph or implicit edge. A declared deadline's passage must be stated as causing expiry; a bare date is insufficient.” Invalid individual reason quotations still do not discard valid facts, but invalid core still excludes all attached evidence.
- **Non-slot context:** use A-4's existing anchored context branch only for an independently source-stated context assertion. Do not emit an empty slot payload for a standalone context assertion, invent adoption, or duplicate every decision/reason into a separate context archive. A context event needs valid core metadata and its own exact text anchor; it cannot repair a rejected decision event. Eligibility stays unchanged.
- **Slots/metadata:** “Extract only supplied route/Text, approval/Boolean and cap/Quantity assignments, each independently anchored. Null means unsupplied: do not fill inherited fields. Preserve all explicit replacement qualifications, audience cells and source-claimed intervals; observed time is not automatically effective time. Complete versus partial replacement must be stated, not guessed.” Show cap-only amendment and complete replacement examples with unsupplied slots left null, plus a future-effective example. Use the existing exact unit and timezone rules.

For an independent causal-anchor example, let current-batch turn `demo-decision` contain the adopted replacement and `demo-cause` say “Capacity loss caused queues to grow. Queue growth caused this replacement.” Include both turns in that event’s `source_turns` and quote both complete clauses from `demo-cause` with their own exact occurrences in `reason_quotes`; do not replace them with endpoint labels or attach them to an invalid core event. A cap-only source saying “Keep route and approval; change only cap to 5 requests/hour” supplies only a cap Quantity and its anchor, leaving extraction route/approval null; it does not supply inherited values. Provide independently authored Chinese counterparts, without using any pilot names or values.

No request adds prior conversation, gold, cached target values or a model self-correction turn. Real extraction omissions/semantic mistakes remain measured failures.

### 4. Reader instructions: addresses, recovery and causal selection

**Prompt/public-contract clarifications only.** Preserve the closed answer schema, stateless/tool-free reader, identical arm-blind prompt, actual delivered blocks and fixed retrieval/assembly. The current public contract already distinguishes bodies and receipts; new examples teach adherence without changing delivery. [public-contract.json:502](../generator/public-contract.json:502), [prompts-a4.mjs:2](../harness/prompts-a4.mjs:2)

**Worked addressing example** (illustrative decoded wire, independent of pilot material):

```json
{"intent":"history","items":[{"body":"{\"slots\":{\"route\":\"demoRoute4\"}}","sources":[{"index":0,"excerpt":"A shipping restriction caused the switch."}]}]}
```

To select the causal excerpt:

```json
{"intent":"history","item":0,"unit":"receipt","source":0,"quote":"A shipping restriction caused the switch.","occurrence":1}
```

To cite the complete decoded body for its route assertion:

```json
{"intent":"history","item":0,"unit":"body","source":null,"quote":"{\"slots\":{\"route\":\"demoRoute4\"}}","occurrence":1}
```

The causal sentence is not a substring of that body; labelling it body/null is invalid. `item` is the zero-based position in the actual selected intent's delivered items, not a record alias, turn number or ranking position before assembly. Receipt `source` uses its displayed source index. Count occurrences within that exact unit only: in `Queue rose. Queue rose.`, selecting the second `Queue rose.` means occurrence 2, not item/source 2. Copy the decoded delivered text after any product normalization; do not cite raw-source spelling or omitted suffixes. Legitimate delivered aliases retain their existing rules and ambiguous overlaps remain unresolved. No address relocation, occurrence substitution, punctuation stripping or retry occurs after submission.

Add these reader instructions and independent bilingual examples:

- Recover complete requested assignments from delivered, source-supported evidence using the frozen public update meanings. A partial refinement inherits unspecified fields from its identified predecessor without requiring a separate “keep” statement. Recover inherited values only when the delivered evidence establishes those values and the applicable predecessor relationship; never invent missing predecessor content. An explicit complete replacement clears the selected predecessor fields before installing supplied assignments. Apply these rules identically across arms, preserving scope and source-claimed intervals. Missing delivery is not `not_specified`, false or zero.
- Conformance: add independent bilingual pairs of the same partial refinement with and without an explicit preservation sentence; both must have identical intended semantics in every arm.
- An unresolved processing label does not by itself negate explicit delivered source facts. Use those facts only when they suffice under the shared update meanings; never reconstruct missing predecessor content or treat an unresolved reference as evidence that its values are known.
- `current.status:no_active_decision` requires `rows:[]`; put an available last-known decision only in requested history, labelled expired. Old records match exactly the requested predecessor turns and erroneous/previously-adopted/expired status. Questions announce the complete shared vocabulary, not the correct label.
- For stated R, select every serial mediator and necessary conjunction, or one complete independently sufficient alternative, including its association to the focal change. Endpoint mentions, unrelated background, speculation, negation and an earlier change with repeated wording do not suffice. Do not quote the entire context to evade selection. Use `unavailable` when the explanation was not delivered; do not default to `not_stated` from a gap. The factual negative-R rule and its support-not-applicable/no-evidence-baseline reporting remain unchanged; no delivered negative witness is newly required.

C/O remain factual correctness measures with separate citation diagnostics. Reader instruction changes do not give C/O a new citation requirement.

### 5. R punctuation: narrow semantic coverage, exact citation resolution

**Decision:** ignoring demonstrably nonsemantic punctuation is faithful to §7's requirement for complete causal content, but implement it as a **versioned prospective scorer/canonicalization amendment**. Do not retrospectively change pilot-four scores. The diagnosis's 76 cases are secondary failures after hypothetical address correction; punctuation treatment alone does not repair their original invalid citations. [diagnosis.md:45](evidence/pilot4-diagnosis.md:45)

The current resolver requires verbatim delivered quotations, while coverage requires continuous exact source-span coverage after trimming edge whitespace. Keep the former unchanged; amend only semantic support coverage. [citations.mjs:60](../scorer/citations.mjs:60), [covers:101](../scorer/citations.mjs:101)

1. First resolve every submitted address/quote/occurrence exactly against the same delivered unit and legitimate aliases, preserving normalization/truncation/source-position maps. An invalid address, altered quote or absent substring cannot enter punctuation-insensitive coverage.
2. At generation/challenge authoring, mark **optional-trivia source positions** in the private support registry from deterministic template provenance, before answers exist. Eligible characters are whitespace and the finite punctuation set `.,;:，。；：、` only where emitted as nonsemantic template separators. All interpolated words, values, identifiers, numbers and causal qualifiers are protected, including punctuation inside them. Question/exclamation marks, quotation marks, apostrophes, hyphens, signs, arrows/operators and parentheses are never ignored by this rule. Each optional position must be licensed by a predeclared production/language/literal-offset rule, independently reviewed before generation; membership in the character whitelist alone is insufficient. Never infer trivia by applying a punctuation-deletion regex to a gold or submitted string.
3. For each required support span, every non-trivia source position must be covered by the union of the actually resolved citation ranges from that same source origin, with exact content correspondence. Optional punctuation may be uncovered; no missing word, digit, connector, mediator, conjunction or focal-change association may be supplied. Preserve all graph/support OR-of-AND requirements and rejection/referral of additional unsupported content. Do not discard an extra citation or text outside licensed support merely because it consists of punctuation. Spans with no substantive required content cannot establish a cause.
4. For example, an independently authored template `A caused B.` may license its final full stop; selecting exact `A caused B` can cover the required content. Selecting only `A` and `B` cannot. The decimal point in an interpolated `1.5` or a dot in an identifier is protected: citing `1` and `5` separately does not cover `1.5`. Punctuation carrying an unfamiliar meaning receives no automatic equivalence.
5. Markings are scoring-side provenance, not reader-visible cause choices, new source evidence or additions to quotation-free `G_correct`. Unknown equivalence/context still follows calibrated referral. Complete source-word coverage alone does not bypass `unrecognized_evidence_context` or the gold-blind support pass. The same changed coverage predicate must be used consistently for completeness and extra-selection checks.

This is narrower than the diagnosis's exploratory punctuation-insensitive census. It promises neither recovery of all 76 cases nor automatic R=1. New licensing, provenance mappings, keys and negative tests must pass independent calibration v2; neither scorer nor judges may repair missing/incorrect citations or partial causal content.

### 6. Prospective models and fifth-pilot budget

**Recommendation: retain `gpt-4.1-mini-2025-04-14` for extraction and reading.** The workload remains bounded structured extraction plus explicit slot/evidence recovery. A representable name-address contract and worked citation rules are necessary regardless of model; a capacity change cannot provide absent earlier identity. Retention keeps the primary condition and planned alternative-extractor sensitivity intact, avoids another confound, and provides the cheapest execution check. This recommendation uses workload, design continuity and cost—not observed pilot scores or counterfactual ceilings. No accuracy advantage for either model is asserted without prospective evidence.

For comparison, use only the named alternative `gpt-5.4-mini-2026-03-17`, at the primary-verified **$0.75/M input, $4.50/M output**. Existing local profiles specify those rates and reasoning `none`; 4.1 uses $0.40/$1.60. No network price/availability check was performed here. [profiles.mjs:6](../../../adapters/openai/profiles.mjs:6)

Freeze 4.1 temperature 0 with no reasoning field; for any selected 5.4 role freeze `reasoning:{effort:"none"}` and omit temperature, as in the existing alternative request. Record requested/returned model identity, complete settings/body hash, usage and request ID; temperature 0 is not a claim of deterministic provider outputs. No adaptive effort or model fallback. Reader 5.4 is a hypothetical configuration requiring an explicit role/model allow-list, request, transport and rate-plan amendment: the current harness permits 5.4 only for extraction. [requests.mjs:17](../harness/requests.mjs:17)

**Fixed call plan:** one 60-family fifth engineering pilot; 240 shared extractions, 480 answers (120/arm), at most one transport retry per logical call, no quality retry. Do not run all four options. Retain output caps E=4,352/R=2,176 and input reservation ceilings E=20,480; R=40,960 for U/T/P and 32,768 for O. Reservations are complete-body UTF-8 bytes plus 4,096 framing units. These current ceilings are assumptions to re-certify for A-6, not an asserted fit. [requests.mjs:3](../harness/requests.mjs:3)

All amounts below are US dollars. For input/output prices `(i,o)` per million tokens:

- `E(i,o) = 480 × (20,480 i + 4,352 o) / 1,000,000`.
- `R(i,o) = 240 × ((3×40,960 + 32,768) i + 4×2,176 o) / 1,000,000`.
- Embeddings: conservative full shared allowance `128,000,000 × $0.02/M = $2.56`; actual remaining allowance is smaller after carry-forward. This does not reset either cumulative 64M-unit counter.

| Extractor / reader | Extraction maximum, retries included | Reader maximum, retries included | Incremental total incl. $2.56 embeddings | Illustrative cumulative at $4.15 carry |
|---|---:|---:|---:|---:|
| **4.1 / 4.1 — recommended** | $7.274496 | $18.284544 | **$28.119040** | **$32.269040** |
| 5.4 / 4.1 | $16.773120 | $18.284544 | $37.617664 | $41.767664 |
| 4.1 / 5.4 | $7.274496 | $37.416960 | $47.251456 | $51.401456 |
| 5.4 / 5.4 | $16.773120 | $37.416960 | $56.750080 | $60.900080 |

For the unchanged planning inputs of 8,000 extraction/6,000 reader tokens and full output caps, single-attempt response forecasts are respectively **$5.262336, $8.963328, $9.299328, $13.000320**, excluding embeddings. These are forecasts, not usage measurements or spending authority.

**Cap decision:** retain the cumulative **$50 pilot cap** for the recommended option; it requires no increase. Verify exact settled charges **plus full outstanding/preparation exposure**, embedding counters and the complete four-pilot chain before dispatch. The approximate $4.15 is only an illustration, not a replacement for that ledger. If the primary separately selects reader-only/both upgrades, illustrative rounded caps of **$55/$65** would cover the shown maxima, respectively, but would require a separate explicit cumulative-cap amendment and exact recomputation; they are not enacted here. An extractor-only upgrade fits the illustrative $50 cap but still needs a model amendment. No rounded cap can override larger verified carry or a failed certificate.

No input/output ceiling rises silently to fit new examples or fields. If the required 5% request/10% output margins fail, block dispatch and publish a numerical amendment with recomputed token arithmetic. Count any preparation probes, schema failures, retries and unknown charges; no extra unlisted API calls. Preserve global **$450 operational/$500 authorization** limits, unavailable $50 headroom, ≤$400 pre-development completion projection, full-test/Inconclusive rule and self-ledgering. Under the unchanged model/planning assumptions, retaining the entire $50 pilot cap plus 25% contingency on the remaining response/embedding plan still gives $282.00320; regenerate the binding projection from the new frozen plan and settled usage before development. Upgrading the primary extractor would also require prospectively swapping the identical planned 5.4 alternative to 4.1 and repricing it; any reader upgrade must apply equally to every arm and sensitivity run. None is selected in this draft.

### 7. Fresh material, unchanged comparison, implementation and recertification

**Process amendment:** extend the A-1/A-4 engineering-pilot exception to exactly one fifth 60-family run under A-6 and the cumulative $50 cap; it does not authorize execution before review/freeze or move the development gates.

**Fresh fifth pilot required:** publish a new deterministic world seed before evaluation, preserving the 60-family allocation, 12/type, language/causal/control counts and lineage multiplicities. Use only engineering/pilot banks; new seeds do not create new ancestry roots. Preserve naming counterbalance and question/contract-only leakage checks. The source conversation need not gain artificial turn IDs; support-trivia metadata changes no source words. Do not reuse paid pilot-four extraction/answer caches under A-6, relabel its scores, pool runs or transfer its names/values/answers/gold into calibration v2. Independent contract examples and calibration worlds must be separately authored.

T and U receive identical newly cached real extractions and the same gold-free resolution. Keep T's typed cell/field rules, inheritance, history labels and no-fallback expiry; keep U's exact-scope whole-version selection, generic links and original evidence. Keep O destruction, P's public-operation mapping/current product pin, correction loss, unresolved/non-adopted filters and adapter expiry. No history archive, raw-source fallback, new queryable registry or incidental admission expansion. Keep literal retrieval queries, hosted embeddings, 2,000 tokens/intent, representation-v2, default whole-record assembly, Card/safety controls and protected independent artifacts. The four diagnosed budget losses remain legitimate policy losses, not defects to erase. [diagnosis.md:104](evidence/pilot4-diagnosis.md:104)

The sole confirmatory estimand remains **final-checkpoint J(T)−J(U) under the prospectively frozen pipeline**. All thresholds, guards, allocations, weights, multiplicity interpretation, judgment-error requirements and A-5 inference/interval rules remain unchanged. Common execution/scoring amendments can change measured C/O/R/J; that is why they are versioned before held-out use, not claimed numerically identical to earlier pilots. P remains a descriptive **pinned product + public-operation agent + shared research extraction + slot-reader** baseline, not native product capture.

| Directory | Implementation and focused conformance requirements |
|---|---|
| `generator/` | Publish independent bilingual extraction/address/slot/causal examples and name-token rules; leave conversation meanings/allocations intact; generate private optional-trivia positions from literal-versus-interpolated provenance; validate protection of all values/identifiers/causal operators and fresh-world/leakage constraints. |
| `harness/` | Version wire schema, prompts, public projections, name registry/resolver and caches; preserve strict core/assignment/reason admission; log missing/colliding/incompatible names and actual P operations. Test cross-batch and eligible same-batch links, self/forward/duplicate/replayed names, prefix/canonical collisions, missing declarations, scopes, retired/forgotten targets, multi-target all-or-none and family isolation; independent bilingual partial-refinement inheritance pairs with and without an explicit preservation sentence, identical intended semantics across arms. No model-specific semantic override. |
| `scorer/` | Preserve exact address/quote/occurrence resolution; version support schema/keys and trivia-aware coverage consistently across completeness/extra-content checks; test missing causal words, conjunctions, intermediates, wrong change, extra clauses, decimals/dotted IDs/operators, Unicode/truncation and unknown-context referrals. Preserve C/O and factual-negative-R semantics. |
| `integration/` | Reconcile new extraction/name/support fields losslessly; verify old/new reducers agree on independently authored equivalent fully resolved input streams; demonstrate named links cannot retrieve O/P lost content; verify P receives the intended public operation, without judging product behavior for skipped writes. Cross-check complete manifests and field mappings by independent routes. |
| `challenge/` | Independently rebuild calibration v2 for the changed contract/scorer; cover exact positive/negative addresses, same text at wrong turn/occurrence, punctuation-only omission versus protected-content omission, non-slot context and referral qualification; preserve gold-blind support, quotation-free correctness gold and error/propagation registries. No pilot answers or case-specific fixes. |
| `analysis/` | Re-certify acceptance of new scorer/key/provenance versions and perturbed family-score recomputation only; do not change T−U math, A-5 intervals, M=204, effect grid, thresholds or decision rules. Full required validation remains a before-development/inference gate. |

**Before the fifth paid pilot:** non-author review/primary freeze; independently authored conformance cases spanning every operation/control branch; actual-token maximal extraction/answer certificates (10% headroom), complete provider-body certificates (5% headroom), new linked-state/serialization/receipt/embedding byte limits and cumulative-unit certificates; privacy/arm-blinding/gold-leakage scans including the private identity registry; exact cumulative ledger/call-plan reconciliation; supervised progress/stop mechanism. Invalid core must still exclude, and genuine ambiguity must stay unresolved. No semantic-accuracy floor or “recover N pilot components” gate is introduced.

**Before development:** independent calibration v2 and its domain-specific referral/resource gates; full A-5 validation on the newly frozen adapter/scorer identities; a ≤$400 total-completion projection within all stage/global limits; required fresh held-out banks, published ancestry and recertification before held-out calls. A-1/A-1.1 still allow only uncalibrated mechanical engineering bounds, with no pilot intervals/inference or Advance/Keep decision. The 200-family development P baseline remains the first substantive calibrated report. A fifth pilot that fails execution validity is retained; it does not authorize an automatic sixth run or score-driven prompt/model search.

### A-6.1 (2026-10-25): extraction and reader input reservation ceilings after the A-6 migration (numerical amendment under A-4 §8 and A-6 §6; non-author audit: acceptable)

- **Measurement.** A non-certifying measurement mode built every complete provider body of the migrated A-6 harness without enforcing ceilings: 5,416 complete requests and 2,096 output references, zero dispatches, zero privacy hits. It cannot authorize paid dispatch. Worst complete reservations (UTF-8 body bytes plus 4,096 framing units): extraction 34,504 (4.1) and 34,518 (5.4); reader T 43,572, U 44,396, O 42,251, P 49,551. A preliminary run, before final source binding, observed a P body of 49,553; the larger value is used. Worst outputs: extraction 2,276 tokens, reader 1,774 tokens. Evidence: [REPORT-A6-MIGRATION.md](../harness/REPORT-A6-MIGRATION.md). These are finite measurements, not universal maxima; the runtime ceiling check still fails closed per request.
- **Why the ceilings rise rather than the content shrinking.** A-6 adds required contract rules and worked examples to every extraction and reader body. The applied lossless projection savings (role filtering and relevant aliases; exact repeated-subtree factoring) already remove 30,895 extraction and 30,867 reader bytes. The only remaining candidate, duplicate system teaching (718/1,043 bytes), would change prompt placement and is not applied. No evidence, contract content or requirement is removed.
- **Change.** Extraction input ceiling **20,480 → 40,960**. Reader input ceiling for **T, U and P 40,960 → 57,344**. Reader input ceiling for **O 32,768 → 49,152**. Using the certificate convention `(ceiling − measured)/ceiling`, minimum input margins are 15.73% for extraction, 13.59% for T/U/P (against P's 49,553) and 14.04% for O. Arms still differ only in what they contain, never in truncation.
- **Unchanged.** Output caps E=4,352 and R=2,176 (certificate margins 47.70% and 18.47%, above the required 10%); the certificate margins of 5% input and 10% output; models (gpt-4.1-mini for both roles); the fixed call plan; one transport retry, no quality retry; every other rule.
- **Cost.** `E = 480 × (40,960×0.40 + 4,352×1.60)/1M = $11.206656`. `R = 240 × ((3×57,344 + 49,152)×0.40 + 4×2,176×1.60)/1M = $24.576000`. With the $2.56 conservative embedding allowance, the incremental bound is **$38.342656**. With the verified carried exposure of **$4.145077720** through pilot four, the cumulative bound is **$42.487733720**, within the **$50** cumulative engineering-pilot cap. The cap is not raised. The actual gate still uses exact ledger amounts.
- **Review.** This amendment goes to non-author review before recertification. The fifth pilot remains blocked until certificates pass at these ceilings, the A-6 implementation audit says yes and the primary freezes.
