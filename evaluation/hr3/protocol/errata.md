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
