**Uncalibrated engineering pilot — deterministic attribution, not adjudicated scores.** All 480 saved answers are structurally valid. The census covers 60 families × four arms × two checkpoints × C/O/R = **1,440 components**. Exactly one primary stage is assigned to each component in `attribution.csv` and `attribution.jsonl`. J is recomputed per observation and is never summed from marginal component gains.

| Primary stage | C | O | R | Total |
| --- | --- | --- | --- | --- |
| generator/gold | 0 | 0 | 0 | 0 |
| extraction | 209 | 181 | 193 | 583 |
| link/state resolution | 0 | 0 | 0 | 0 |
| delivery/serialization | 2 | 2 | 0 | 4 |
| reader wrong | 203 | 90 | 137 | 430 |
| citation addressing only | 0 | 0 | 96 | 96 |
| scorer/representation mismatch | 0 | 0 | 0 | 0 |
| correct | 66 | 207 | 54 | 327 |
| Total | 480 | 480 | 480 | 1440 |


The 12 unresolved R values remain unresolved in this analysis. They are included in primary-stage accounting, not silently adjudicated. No C/O representation rejection was detected. Zero primary link/state entries does **not** mean links worked: every admitted focal change is unresolved, but all have an earlier missing/wrong extracted predecessor anchor. Secondary defects remain visible below.

The frozen scorer was replayed from **commit 8f1925f3** against all 480 submissions, with exact equality of the complete score/referral objects. All 480 individual score files match `scored.jsonl`; all 60 families pass the frozen generator AST/gold/source-span validator. No generator/gold defect was detected. This is bounded mechanical evidence, not independent semantic adjudication of the generator.

**Observed counts.** Each cell is C/O/R/J out of 60. These are counts, not percentages; ranges retain unresolved R. The supplied final percentages reconcile after rounding.

| Arm | Checkpoint 2 | Checkpoint 4 |
| --- | --- | --- |
| U | 9/39/7/0 | 11/24/6/0 |
| T | 8/38/7/0 | 14/15/5/0 |
| O | 7/39/8/0 | 10/12/6/0 |
| P | 7/38/8–15/0 | 0/2/7–12/0 |


**Code references.** The pinned implementation is in `frozen-code/evaluation/hr3/`: `harness/extraction.mjs` (batch-only input), `harness/schema.mjs:82` (core admission), `harness/research.mjs:6` (turn-based link resolution), `harness/research.mjs:151` (separate receipt serialization), `harness/product.mjs:99` (skip unresolved before apply), `scorer/citations.mjs:57` (exact address/quote resolution), `scorer/scorer.mjs:69` (required support coverage), and `protocol/errata.md` A-4 §§2–6 (public contract and retention/referral policy).

**Classification rule and limits.** Recorded score 1 → correct. Otherwise, a demonstrated generator defect would take precedence (none found). For C/O, trace the source events supplying the gold slots, including partial-update ancestors and unaffected scope cells; an already-declared clock deadline can establish expiry without a separate expiry event. History also needs the focal change establishing the requested historical label. Count a required fact as delivered when its correctly associated source quotation or exact structured slot/interval is present. Full source snippets are allowed to supply facts even when state metadata calls the update unresolved. If all requirements are delivered, classify reader wrong. If evidence is missing, trace admission → extracted anchors → linking → delivery and assign the earliest blocker; canonical event order breaks ties. A wrong or missing anchor is extraction, not a resolver defect merely because the resolver later reports missing_anchor. Required-event IDs and per-event field/time/meaning tests are saved in `observations.json`. This conservative prerequisite census can attribute a component to an omitted ancestor even when the answer has another independent error; the ceilings therefore are upper bounds.

For stated R, preserve quote text and search delivered addresses without consulting gold: first the same intent/item/unit-source alternatives, then the nearest delivered address with either the submitted occurrence or occurrence 1. Prefer the original intent, item and occurrence, then canonical address order; log every alternative count. Only afterward compare provenance to the focal gold support. Citation-only requires a complete accepted path, no additional non-punctuation content, and all selected citations resolvable. For this content test only, ignore whitespace and punctuation `[.,;:!?，。；：！？、]`; never ignore words, numbers, station IDs, direction, serial/conjunctive clauses or source-turn identity. Broad/unfamiliar selections without this witness receive no semantic credit: trace missing delivery first, otherwise reader wrong. This is an inspectable literal correspondence rule, not model adjudication. The original scorer and scores are unchanged.

**H1: citation addressing.** A-4 is explicit, in both the saved public contract and §2: `item.body → unit:"body", source:null`; `item.sources[i].excerpt → unit:"receipt", source:i`. The body is a serialized record, with quotations in separately addressed excerpts. This is a reader adherence failure encouraged by the nested presentation, not an absent contract rule or a scorer bug in rejecting an absent substring. C/O ignore citation validity, so citation repair recovers **zero C/O components**.

| Component | Citations | Invalid citations | Answers with invalid citations | Strict unit/source repairs | Wider address/occurrence repairs |
| --- | --- | --- | --- | --- | --- |
| C | 1170 | 1049 | 374 | 305 | 1049 |
| O | 1045 | 939 | 333 | 157 | 936 |
| R | 616 | 599 | 267 | 86 | 560 |


Of 426 R components lacking a recorded pass, **96/426 (22.5%)** have complete selected causal content and only addressing defects under the declared punctuation-insensitive content test. Sixteen (3.8% of the 426 R losses) need only same-item unit/source correction; 80 additionally need an occurrence/item/intent correction. The strict frozen-scorer replay changes 20 R zeros to unresolved referrals; the wider replay changes 121 zeros to referrals. Neither produces a new mechanical R=1. Not all newly referred answers are substantively correct: broad or irrelevant selected evidence still needs the actual two-pass process.

For the 96 content-complete address cases specifically, the wider replay leaves **76 at zero** (`incomplete_required_support`) and **20 unresolved** (`unrecognized_evidence_context`). The 76 select every causal word but omit punctuation required by exact gold span coverage. This is a secondary scorer/representation mismatch masked by the original invalid address. The context referrals are prescribed by A-4 §5, not evidence of an engine bug. There are no original correctly addressed, content-complete scorer-mismatch primary cases in this census.

Every recorded J is zero. Address repair alone leaves every J zero. The hypothetical ceiling that grants all 96 citation-only components credit recovers 11 J observations (11/480, 2.3% of J losses; the strict same-item subset accounts for 1/480). This explicitly assumes the secondary punctuation/referral hurdles also resolve favorably. It is not a new pilot result.

**H2: unlinked corrections and other changes.** All **132 predecessor-name references** in the AST can be found in the corresponding predecessor source text. Thus the suggested missing-name generator defect is falsified. For example, the initial source literally begins `紀錄 kavo：`; the next correction names kavo. Of 120 focal changes, **95 are admitted and all 95 are unresolved**; 25 have no admitted focal event. Among the admitted changes, 75 have one or more anchors, all pointing at the current source turn, and 20 have no predecessor anchors. Four scope changes have two anchors both pointing at `b4-focal`. All 95 have commitment adopted.

The extractor request contains only the current batch (`observed_at`, `public_header`, `turns`, public contract), not earlier turns or a source-supported name→turn registry. Initial events do not expose their own record_name as a structured output field, and their admitted quotations often omit the name prefix. The current source names the predecessor but does not spell out its earlier turn ID. The prompt asks for predecessor turn/name anchors, while the resolver requires a unique **earlier source_turn + canonical subject + predicate** and ignores record_name. It therefore cannot resolve a reference such as `{record_name:"kavo",source_turn:"b2-focal"}` to the b1 record. This is an extraction-interface/link-addressing design gap. The resolver is correctly refusing a bad address; guessing the turn from gold or batch patterns would violate the extraction contract.

Primary anchor-loss counts (exclusive accounting) and exposure counts (overlapping diagnostics) follow. Exposure means a failing component requires an admitted unresolved change; it does not assert that linking alone would recover the reader answer. A component may have an earlier admission/value defect too. The reader-sufficient column identifies exposed C/O failures already having the requisite source facts.

| Arm | Checkpoint | Primary anchor C/O | Unresolved exposure C/O | Exposed but source sufficient C/O | Exposed C returning unresolved |
| --- | --- | --- | --- | --- | --- |
| U | 2 | 0/0 | 33/9 | 29/8 | 15 |
| U | 4 | 0/0 | 35/27 | 29/17 | 9 |
| T | 2 | 0/0 | 35/10 | 32/8 | 16 |
| T | 4 | 0/0 | 32/36 | 25/24 | 8 |
| O | 2 | 0/0 | 36/9 | 32/8 | 15 |
| O | 4 | 1/1 | 36/38 | 28/24 | 14 |
| P | 2 | 37/9 | 41/12 | 0/0 | 0 |
| P | 4 | 42/42 | 46/49 | 0/0 | 0 |


Across checkpoints the primary anchor defect accounts for **197 components: C80/O52/R65**. P contributes C79/O51/R65; O contributes one C and one O. U/T source excerpts often retain enough factual content to answer despite the unresolved state, so these remain reader primary. Their link defect is recorded as secondary exposure rather than counted twice. The name-to-turn remedy also has wider possible reach than these 197 primary components, but that overlap must not be added to the ranked totals.

**H3: P final C=0 and O≈0.** P does not pass unresolved changes to its engine. `ProductAgent.ingest` logs unresolved_mapping and skips them before `apply`; consequently corrected/reversed/refined/scope-amended content and reason clauses never enter product memory. Initial decisions remain queryable, giving stale answers. At checkpoint 4, P has 58/60 C failures primarily upstream in extraction (42 anchor, 13 event admission, three slot/metadata); the remaining two are reader errors. Its 58 O failures comprise 42 anchor, 12 event admission and four slot/metadata failures; two O components pass. For the two reader C failures, scheduled expiry succeeded and the reader returned no_active_decision **with nonempty current rows**, which violates the explicit answer rule. Final P R has seven factual-negative passes and five unresolved referrals, explaining the reported 12–20% range.

**Engine versus adapter/policy.** The final P logs contain 96 unresolved_mapping entries (95 focal changes plus one other extracted event), 578 non-adopted skips, and four successful scheduled expiry operations. No focal correction reaches correct_memory and no focal reversal reaches supersede. The four actual engine supersedes are the scheduled expiries, all successful. The other operation refusals belong to controls; no evidence here supports changing correction/reversal engine behaviour. All 240 P intent reads report no budget, deadline or item stop and no omitted bodies/sources (asserted in product-audit.json generation). The 20 core admit refusals are memory_suppressed controls; the 15 MCP refusals are the prescribed unauthorized card controls, not focal writes. A-4 §6 deliberately retains P’s unresolved/non-adopted filter, public-operation mapping, formatter without predecessor reconstruction, default whole-record policy and bounded retrieval. Do not bypass these filters, add raw fallback/history archives or infer that P’s engine failed operations it never received.

**Extraction admission.** Counts cover 240 shared batches, not four separate extractor populations.

| Diagnostic | Count |
| --- | --- |
| totalEvents | 850 |
| validEvents | 776 |
| rejectedEvents | 74 |
| rawAssignments | 998 |
| admittedAssignments | 941 |
| excludedAssignments | 57 |
| rawQuotations | 400 |
| admittedQuotations | 307 |
| excludedQuotations | 93 |


| Event rejection reason (overlapping) | Count |
| --- | --- |
| no_admitted_assignment | 43 |
| invalid_commitment | 29 |
| invalid_extraction_provenance | 20 |
| invalid_event_anchor | 7 |
| invalid_extraction_scope | 6 |
| invalid_extraction_interval | 4 |
| invalid_replacement_extent | 3 |
| invalid_context_anchor | 2 |


All batches parse; no batch-level failure occurred. The event_not_admitted primary subtype accounts for 201 components; slot/metadata loss for 61; causal-clause admission loss for 124; anchors for 197. The validator accepts only explicit core enums. Outputs such as commitment:"correction" are not valid commitment values even though correction is a change type; invalid core metadata excludes the event and its assignments/quotes. Independent reason admission is implemented, but it cannot preserve a quotation attached to an invalid core event.

**Delivery.** The only four primary delivery losses are C and O for T and O on `pilot-refinement-L06-W2-*-4`. Their initial record r1 survives materialization, enters the ranked candidates, and is skipped by whole-record budget assembly. It supplies the inherited route/approval. This is an actual 2,000-token policy loss, not overwrite retention or missing extraction. The O arm also still has the record because unresolved changes never superseded it. The classifier’s generic delivery subtype is refined by this saved-state/ranking trace in budget-audit.json. There are only two observations/four components in this category; the four worked component cases below cover both arms and both C/O outcomes, without claiming four independent observations.

**Counterfactual ceilings and ranked remedies.** These are **optimistic counterfactual estimates, not scores, expected gains or permission to tune on pilot material**. For a target set, replace only its component verdicts with 1, retain every other original 0/null, then recompute J per observation. The recoverable range is 0…target count absent a reader rerun; known secondary failures can prevent recovery. Frozen-answer citation replays above give the narrower directly demonstrated result: zero additional mechanical passes. The disjoint primary sets are ranked below; their maximum components are not causal effect estimates. Full per-arm/per-checkpoint ceilings are in ceilings.json.

| Rank / remedy | Max recovered C/O/R | Max components | Classification |
| --- | --- | --- | --- |
| 1. Reader slots | 203/90/0 | 0–293 | Harness/prompt fix within A-4; definitions already public. |
| 2. Extraction core | 98/103/0 | 0–201 | Harness/prompt fix within A-4; relaxing event admission needs a contract amendment. |
| 3. Predecessor identity | 80/52/65 | 0–197 | A-4 contract clarification/schema-link design; explicit source turn rendering is a generator change requiring fresh pilot material. Prompt wording alone lacks the missing prior identity. |
| 4. Reader causal selection | 0/0/137 | 0–137 | Harness/prompt fix within A-4. Harness/prompt fix within A-4; factual negative-R support policy is intentional. |
| 5. Extraction causal clauses | 0/0/124 | 0–124 | Harness/prompt fix within A-4; retain invalid-core exclusion. |
| 6. Citation addresses | 0/0/96 | 0–96 | Harness/prompt fix within A-4; no post-submission repair/retry. Harness/prompt fix within A-4; existing contract is explicit. |
| 7. Extraction slots/metadata | 31/26/4 | 0–61 | Harness/prompt fix within A-4. |
| 8. Fixed-budget policy | 2/2/0 | 0–4 | Genuine research policy behaviour; do not enlarge budgets or change assembly as an incidental fix. Genuine research policy behaviour; do not add an archive/fallback. |


For the citation remedy, all 96 require favorable treatment of the secondary hurdles described above. Separately, review punctuation-insensitive **semantic coverage** after exact citation resolution: 76 secondary cases could move from hard zero to referral, but this changes **zero original components alone**, since their original addresses are invalid. This is an **A-4 contract clarification/scorer conformance remedy**, not permission to normalize submitted quotes or silently grant R. General context licensing/referral is intentional; preserve the two-pass process. A generator source-rendering remedy requires fresh independent material and recertification; no pilot-specific registry, values or gold mappings may enter calibration.

**Final-checkpoint stage ceilings.** C/O/R/J counts out of 60, after granting the named primary target components credit. Other stages still fail. The corresponding checkpoint-2 table and all component-specific target rows are supplied in ranked-remedies.json and ceilings.json.

| Counterfactual target | U | T | O | P |
| --- | --- | --- | --- | --- |
| Reader slots | 42/41/6/4 | 41/39/5/4 | 40/37/6/4 | 2/2/7–12/0–1 |
| Extraction core | 25/38/6/2 | 27/30/5/1 | 24/28/6/2 | 13/14/7–12/1–2 |
| Predecessor identity | 11/24/6/0 | 14/15/5/0 | 11/13/6/0 | 42/44/38–40/31 |
| Reader causal selection | 11/24/34/3 | 14/15/32/4 | 10/12/31/3 | 0/2/10–15/0 |
| Extraction causal clauses | 11/24/22/2 | 14/15/21/0 | 10/12/22/0 | 0/2/23–26/0 |
| Citation addresses | 11/24/16/3 | 14/15/17/2 | 10/12/19/1 | 0/2/7–12/0 |
| Extraction slots/metadata | 15/29/6/0 | 19/20/5/0 | 14/17/6/0 | 3/6/10–15/1–2 |
| Fixed-budget policy | 11/24/6/0 | 15/16/5/0 | 11/13/6/0 | 0/2/7–12/0 |


**Breakdown by arm, checkpoint and change type.** Each component cell uses `extraction / delivery / reader / citation / correct` and sums to 12. Generator/gold, primary link/state and primary scorer/representation are zero throughout. Unresolved R remains in its attributed stage.

Checkpoint 2.

| Arm | Change type | C | O | R |
| --- | --- | --- | --- | --- |
| U | correction | 5/0/4/0/3 | 5/0/3/0/4 | 5/0/3/3/1 |
| U | reversal | 0/0/9/0/3 | 1/0/2/0/9 | 0/0/5/6/1 |
| U | refinement | 1/0/10/0/1 | 0/0/1/0/11 | 1/0/4/5/2 |
| U | scope_change | 1/0/10/0/1 | 1/0/1/0/10 | 3/0/4/4/1 |
| U | expiry | 8/0/3/0/1 | 6/0/1/0/5 | 6/0/1/3/2 |
| T | correction | 4/0/5/0/3 | 5/0/3/0/4 | 5/0/6/0/1 |
| T | reversal | 0/0/8/0/4 | 1/0/2/0/9 | 0/0/3/8/1 |
| T | refinement | 1/0/11/0/0 | 0/0/0/0/12 | 1/0/6/3/2 |
| T | scope_change | 1/0/11/0/0 | 1/0/2/0/9 | 3/0/6/2/1 |
| T | expiry | 8/0/3/0/1 | 7/0/1/0/4 | 6/0/0/4/2 |
| O | correction | 5/0/6/0/1 | 5/0/4/0/3 | 5/0/2/4/1 |
| O | reversal | 0/0/8/0/4 | 1/0/2/0/9 | 0/0/4/7/1 |
| O | refinement | 1/0/10/0/1 | 0/0/0/0/12 | 1/0/4/5/2 |
| O | scope_change | 1/0/11/0/0 | 1/0/1/0/10 | 3/0/2/5/2 |
| O | expiry | 8/0/3/0/1 | 6/0/1/0/5 | 6/0/2/2/2 |
| P | correction | 12/0/0/0/0 | 12/0/0/0/0 | 10/0/0/0/2 |
| P | reversal | 6/0/0/0/6 | 0/0/0/0/12 | 10/0/1/0/1 |
| P | refinement | 12/0/0/0/0 | 0/0/0/0/12 | 10/0/0/0/2 |
| P | scope_change | 12/0/0/0/0 | 0/0/0/0/12 | 10/0/1/0/1 |
| P | expiry | 10/0/1/0/1 | 10/0/0/0/2 | 10/0/0/0/2 |


Checkpoint 4.

| Arm | Change type | C | O | R |
| --- | --- | --- | --- | --- |
| U | correction | 4/0/3/0/5 | 6/0/2/0/4 | 4/0/4/3/1 |
| U | reversal | 2/0/6/0/4 | 1/0/0/0/11 | 3/0/6/2/1 |
| U | refinement | 2/0/9/0/1 | 2/0/8/0/2 | 0/0/9/1/2 |
| U | scope_change | 2/0/9/0/1 | 2/0/5/0/5 | 3/0/7/1/1 |
| U | expiry | 8/0/4/0/0 | 8/0/2/0/2 | 6/0/2/3/1 |
| T | correction | 4/0/2/0/6 | 5/0/1/0/6 | 4/0/5/2/1 |
| T | reversal | 2/0/5/0/5 | 3/0/6/0/3 | 3/0/6/3/0 |
| T | refinement | 3/1/7/0/1 | 3/1/8/0/0 | 0/0/9/2/1 |
| T | scope_change | 1/0/10/0/1 | 1/0/7/0/4 | 3/0/4/3/2 |
| T | expiry | 8/0/3/0/1 | 8/0/2/0/2 | 6/0/3/2/1 |
| O | correction | 4/0/4/0/4 | 5/0/2/0/5 | 4/0/6/1/1 |
| O | reversal | 3/0/6/0/3 | 4/0/5/0/3 | 3/0/6/2/1 |
| O | refinement | 2/1/8/0/1 | 3/1/8/0/0 | 0/0/8/2/2 |
| O | scope_change | 2/0/9/0/1 | 2/0/8/0/2 | 3/0/4/4/1 |
| O | expiry | 8/0/3/0/1 | 8/0/2/0/2 | 6/0/1/4/1 |
| P | correction | 12/0/0/0/0 | 12/0/0/0/0 | 10/0/0/0/2 |
| P | reversal | 12/0/0/0/0 | 12/0/0/0/0 | 10/0/0/0/2 |
| P | refinement | 12/0/0/0/0 | 12/0/0/0/0 | 10/0/2/0/0 |
| P | scope_change | 12/0/0/0/0 | 12/0/0/0/0 | 10/0/0/0/2 |
| P | expiry | 10/0/2/0/0 | 10/0/0/0/2 | 10/0/1/0/1 |


**Worked examples.** Each quotation below is a literal JSON field/subtree from the saved artifact. Omitting unrelated fields is a projection, not a rewritten answer. Sources are decoded wire strings; exact source text remains verbatim. Missing-evidence examples include the actual delivered items and the omitted gold requirement, not a hypothetical repaired delivery. The extraction JSON cache filename identifies the exact saved provider request/reply/admission audit.

Example 1: `pilot-correction-L01-W1-P-2.json`, C; **extraction / predecessor_anchor_wrong_or_missing**.

Exact answer fragment:
```json
{
  "rows": [
    {
      "approval": {
        "state": "value",
        "value": true
      },
      "cap": {
        "state": "not_specified",
        "value": null
      },
      "citations": [
        {
          "intent": "current",
          "item": 0,
          "occurrence": 1,
          "quote": "我們採用lumiu服務的派送設定,路線 = r-mavo,需經核准 = 是。適用對象:全部國家(TW、JP、US)、free/pro 方案及 web/app 通路。生效區間 [2031-02-28T16:00:00.000Z, 無上限(不含終點))",
          "source": null,
          "unit": "body"
        }
      ],
      "route": {
        "state": "value",
        "value": "r-mavo"
      },
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "valid": {
        "from": "2031-02-28T16:00:00.000Z",
        "to": null
      }
    }
  ],
  "status": "active"
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 0,
    "body": "{\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r1\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"r-mavo\"},\"sources\":[\"b1-focal\"],\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-02-28T16:00:00.000Z\",\"to\":null}} b1-focal: 我們採用lumiu服務的派送設定,路線 = r-mavo,需經核准 = 是。適用對象:全部國家(TW、JP、US)、free/pro 方案及 web/app 通路。生效區間 [2031-02-28T16:00:00.000Z, 無上限(不含終點)) b1-focal: 路線 = r-mavo b1-focal: 需經核准 = 是",
    "sources": [
      {
        "index": 0,
        "role": "user",
        "excerpt": "我們採用lumiu服務的派送設定,路線 = r-mavo,需經核准 = 是。適用對象:全部國家(TW、JP、US)、free/pro 方案及 web/app 通路。生效區間 [2031-02-28T16:00:00.000Z, 無上限(不含終點))"
      },
      {
        "index": 1,
        "role": "user",
        "excerpt": "路線 = r-mavo"
      },
      {
        "index": 2,
        "role": "user",
        "excerpt": "需經核准 = 是"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "current": {
    "rows": [
      {
        "approval": {
          "state": "value",
          "value": true
        },
        "cap": {
          "state": "not_specified",
          "value": null
        },
        "citations": [],
        "route": {
          "state": "value",
          "value": "s-mavo"
        },
        "scope": {
          "any": [
            {
              "all": []
            }
          ]
        },
        "valid": {
          "from": "2031-03-01T16:00:00.000Z",
          "to": null
        }
      }
    ],
    "status": "active"
  }
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "extraction",
  "subtype": "predecessor_anchor_wrong_or_missing",
  "missing_trace": [
    {
      "errors": [
        "missing_anchor"
      ],
      "event": "pilot-correction-L01-W1/e2",
      "stage": "extraction",
      "subtype": "predecessor_anchor_wrong_or_missing",
      "turn": "b2-focal"
    }
  ],
  "extraction_cache": "dd62eb6e85e3fd6c2235873cb11cd6e56c87074fa71e4dc13a87358c5cfca578.json",
  "admitted_focal_events": [
    {
      "change_type": "correction",
      "claims": [
        {
          "field": "value",
          "value": {
            "text": "s-mavo",
            "type": "Text"
          }
        },
        {
          "field": "approval",
          "value": {
            "type": "Boolean",
            "value": true
          }
        }
      ],
      "commitment": "adopted",
      "context": null,
      "effective_interval": {
        "from": "2031-03-01T16:00:00.000Z",
        "to": null
      },
      "event_id": "e1",
      "field_mask": [
        "value",
        "approval"
      ],
      "kind": "decision",
      "observed_at": "2031-03-02T02:00:00.000Z",
      "payload": {
        "approval": {
          "anchors": [
            {
              "end": 82,
              "occurrence": 1,
              "quote": "需經核准 = 是",
              "start": 74,
              "turn_id": "b2-focal"
            }
          ],
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        "cap": null,
        "route": {
          "anchors": [
            {
              "end": 73,
              "occurrence": 1,
              "quote": "路線 = s-mavo",
              "start": 62,
              "turn_id": "b2-focal"
            }
          ],
          "value": {
            "text": "s-mavo",
            "type": "Text"
          }
        },
        "type": "slots"
      },
      "predecessor_anchors": [
        {
          "predicate": "dispatch configuration",
          "record_name": "kavo",
          "source_turn": "b2-focal",
          "subject": "lumiu service"
        }
      ],
      "predicate": "dispatch configuration",
      "reason_quotes": [
        {
          "end": 219,
          "occurrence": 1,
          "quote": "佇列壅塞，站點 477f922dcb",
          "start": 201,
          "turn_id": "b2-focal"
        },
        {
          "end": 252,
          "occurrence": 1,
          "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
          "start": 221,
          "turn_id": "b2-focal"
        }
      ],
      "replacement_extent": "entire_predecessor",
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "source_quotes": [
        {
          "end": 185,
          "occurrence": 1,
          "quote": "更正紀錄 kavo：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 zemi 更正這個單一斷言：lumiu服務的派送設定，路線 = s-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-01T16:00:00.000Z, 無上限（不含終點）)",
          "start": 0,
          "turn_id": "b2-focal"
        },
        {
          "end": 73,
          "occurrence": 1,
          "quote": "路線 = s-mavo",
          "start": 62,
          "turn_id": "b2-focal"
        },
        {
          "end": 82,
          "occurrence": 1,
          "quote": "需經核准 = 是",
          "start": 74,
          "turn_id": "b2-focal"
        },
        {
          "end": 219,
          "occurrence": 1,
          "quote": "佇列壅塞，站點 477f922dcb",
          "start": 201,
          "turn_id": "b2-focal"
        },
        {
          "end": 252,
          "occurrence": 1,
          "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
          "start": 221,
          "turn_id": "b2-focal"
        }
      ],
      "source_turns": [
        "b2-focal"
      ],
      "subject": "lumiu service"
    }
  ],
  "rejected": []
}
```

The required event/slot/clause is absent from usable delivered evidence. The saved admission/link trace locates the earlier loss. The displayed stale delivery cannot supply the missing focal update merely because it has the same subject.

Example 2: `pilot-correction-L04-W1-U-2.json`, C; **extraction / event_not_admitted**.

Exact answer fragment:
```json
{
  "rows": [
    {
      "approval": {
        "state": "value",
        "value": true
      },
      "cap": {
        "state": "not_specified",
        "value": null
      },
      "citations": [
        {
          "intent": "current",
          "item": 0,
          "occurrence": 1,
          "quote": "我們採用tevou服務的派送設定，路線 = s-mavo，需經核准 = 是。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-03T16:00:00.000Z, 無上限（不含終點）)",
          "source": null,
          "unit": "body"
        },
        {
          "intent": "current",
          "item": 0,
          "occurrence": 2,
          "quote": "路線 = s-mavo",
          "source": null,
          "unit": "body"
        },
        {
          "intent": "current",
          "item": 0,
          "occurrence": 3,
          "quote": "需經核准 = 是",
          "source": null,
          "unit": "body"
        }
      ],
      "route": {
        "state": "value",
        "value": "s-mavo"
      },
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "valid": {
        "from": "2031-03-03T16:00:00.000Z",
        "to": null
      }
    }
  ],
  "status": "active"
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 0,
    "body": "{\"change_type\":\"initial\",\"commitment\":\"unresolved\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r4\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"route\":\"r-mavo\"},\"sources\":[\"b1-distractor\"],\"status\":\"unresolved\",\"subject\":\"tevou service Annex\",\"valid\":{\"from\":null,\"to\":null}}",
    "sources": [
      {
        "excerpt": "另一個無關的服務tevou服務 Annex使用 r-mavo",
        "index": 0,
        "source_turn": "b1-distractor"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "current": {
    "rows": [
      {
        "approval": {
          "state": "value",
          "value": true
        },
        "cap": {
          "state": "not_specified",
          "value": null
        },
        "citations": [],
        "route": {
          "state": "value",
          "value": "r-mavo"
        },
        "scope": {
          "any": [
            {
              "all": []
            }
          ]
        },
        "valid": {
          "from": "2031-03-04T16:00:00.000Z",
          "to": null
        }
      }
    ],
    "status": "active"
  }
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "extraction",
  "subtype": "event_not_admitted",
  "missing_trace": [
    {
      "event": "pilot-correction-L04-W1/e2",
      "stage": "extraction",
      "subtype": "event_not_admitted",
      "turn": "b2-focal"
    }
  ],
  "extraction_cache": "fff4a5f87175f4b9e0688d2726618d48333083d508ecffd6419d6dd20f60351d.json",
  "admitted_focal_events": [],
  "rejected": [
    {
      "event_id": "e1",
      "index": 0,
      "raw_event_id": "e1",
      "reasons": [
        "invalid_commitment",
        "no_admitted_assignment"
      ]
    }
  ],
  "raw_focal_events": [
    {
      "event_id": "e1",
      "source_turns": [
        "b2-focal"
      ],
      "observed_at": "2031-03-05T02:00:00.000Z",
      "kind": "decision",
      "commitment": "correction",
      "change_type": "correction",
      "subject": "tevou service",
      "predicate": "dispatch configuration",
      "payload": {
        "type": "slots",
        "route": {
          "value": {
            "type": "Text",
            "text": "r-mavo"
          },
          "anchors": [
            {
              "turn_id": "b2-focal",
              "quote": "路線 = r-mavo",
              "occurrence": 1
            }
          ]
        },
        "approval": {
          "value": {
            "type": "Boolean",
            "value": true
          },
          "anchors": [
            {
              "turn_id": "b2-focal",
              "quote": "需經核准 = 是",
              "occurrence": 1
            }
          ]
        },
        "cap": null
      },
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "effective_interval": {
        "from": "2031-03-04T16:00:00.000Z",
        "to": null
      },
      "predecessor_anchors": [
        {
          "source_turn": "b2-focal",
          "record_name": "hura",
          "subject": "tevou service",
          "predicate": "dispatch configuration"
        }
      ],
      "replacement_extent": "entire_predecessor",
      "reason_quotes": [
        {
          "turn_id": "b2-focal",
          "quote": "原先記載的斷言有誤，從未是實際採用的決定。",
          "occurrence": 1
        },
        {
          "turn_id": "b2-focal",
          "quote": "因為佇列壅塞，站點 f1821f3e81，所以造成容量不足，站點 a10a59c8a8。",
          "occurrence": 1
        },
        {
          "turn_id": "b2-focal",
          "quote": "因為容量不足，站點 a10a59c8a8，所以造成延遲增加，站點 83014bf86c。",
          "occurrence": 1
        },
        {
          "turn_id": "b2-focal",
          "quote": "因為延遲增加，站點 83014bf86c，所以造成這次決定變更。",
          "occurrence": 1
        }
      ],
      "source_quotes": [
        {
          "turn_id": "b2-focal",
          "quote": "tevou服務的派送設定，路線 = r-mavo，需經核准 = 是。",
          "occurrence": 1
        }
      ]
    }
  ]
}
```

The required event/slot/clause is absent from usable delivered evidence. The saved admission/link trace locates the earlier loss. The displayed stale delivery cannot supply the missing focal update merely because it has the same subject.

Example 3: `pilot-correction-L01-W2-U-2.json`, C; **extraction / slot_or_metadata_wrong_or_missing**.

Exact answer fragment:
```json
{
  "rows": [
    {
      "approval": {
        "state": "value",
        "value": true
      },
      "cap": {
        "state": "not_specified",
        "value": null
      },
      "citations": [
        {
          "intent": "current",
          "item": 0,
          "occurrence": 1,
          "quote": "lumiu服務的派送設定，路線 = t-mavo，需經核准 = 是",
          "source": null,
          "unit": "body"
        },
        {
          "intent": "current",
          "item": 0,
          "occurrence": 2,
          "quote": "路線 = t-mavo",
          "source": null,
          "unit": "body"
        },
        {
          "intent": "current",
          "item": 0,
          "occurrence": 3,
          "quote": "需經核准 = 是",
          "source": null,
          "unit": "body"
        }
      ],
      "route": {
        "state": "value",
        "value": "t-mavo"
      },
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "valid": {
        "from": "2031-03-13T16:00:00.000Z",
        "to": null
      }
    }
  ],
  "status": "unresolved"
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 0,
    "body": "{\"change_type\":\"initial\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r1\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"r-mavo\"},\"sources\":[\"b1-focal\"],\"status\":\"active\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-13T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "我們採用lumiu服務的派送設定，路線 = r-mavo，需經核准 = 是。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-13T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b1-focal"
      },
      {
        "excerpt": "路線 = r-mavo",
        "index": 1,
        "source_turn": "b1-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b1-focal"
      }
    ]
  },
  {
    "intent": "current",
    "item": 1,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r2\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"t-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-13T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "lumiu服務的派送設定，路線 = t-mavo，需經核准 = 是",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = t-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "佇列壅塞，站點 477f922dcb",
        "index": 3,
        "source_turn": "b2-focal"
      }
    ]
  },
  {
    "intent": "history",
    "item": 0,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r2\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"t-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"historical\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-13T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "lumiu服務的派送設定，路線 = t-mavo，需經核准 = 是",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = t-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "佇列壅塞，站點 477f922dcb",
        "index": 3,
        "source_turn": "b2-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "current": {
    "rows": [
      {
        "approval": {
          "state": "value",
          "value": true
        },
        "cap": {
          "state": "not_specified",
          "value": null
        },
        "citations": [],
        "route": {
          "state": "value",
          "value": "t-mavo"
        },
        "scope": {
          "any": [
            {
              "all": []
            }
          ]
        },
        "valid": {
          "from": "2031-03-13T16:00:00.000Z",
          "to": null
        }
      }
    ],
    "status": "active"
  }
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "extraction",
  "subtype": "slot_or_metadata_wrong_or_missing",
  "missing_trace": [
    {
      "availability": {
        "available": false,
        "fields": [
          "value",
          "approval"
        ],
        "interval": true,
        "meaning": false,
        "supplied": true,
        "turn": "b2-focal"
      },
      "event": "pilot-correction-L01-W2/e2",
      "stage": "extraction",
      "subtype": "slot_or_metadata_wrong_or_missing",
      "turn": "b2-focal"
    }
  ],
  "extraction_cache": "ef29d6032a1c862b9593d10fe231be364272bd051dbbae3ee2b675fcd36a363c.json",
  "admitted_focal_events": [
    {
      "change_type": "correction",
      "claims": [
        {
          "field": "value",
          "value": {
            "text": "t-mavo",
            "type": "Text"
          }
        },
        {
          "field": "approval",
          "value": {
            "type": "Boolean",
            "value": true
          }
        }
      ],
      "commitment": "adopted",
      "context": null,
      "effective_interval": {
        "from": "2031-03-13T16:00:00.000Z",
        "to": null
      },
      "event_id": "e1",
      "field_mask": [
        "value",
        "approval"
      ],
      "kind": "decision",
      "observed_at": "2031-03-15T02:00:00.000Z",
      "payload": {
        "approval": {
          "anchors": [
            {
              "end": 82,
              "occurrence": 1,
              "quote": "需經核准 = 是",
              "start": 74,
              "turn_id": "b2-focal"
            }
          ],
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        "cap": null,
        "route": {
          "anchors": [
            {
              "end": 73,
              "occurrence": 1,
              "quote": "路線 = t-mavo",
              "start": 62,
              "turn_id": "b2-focal"
            }
          ],
          "value": {
            "text": "t-mavo",
            "type": "Text"
          }
        },
        "type": "slots"
      },
      "predecessor_anchors": [
        {
          "predicate": "dispatch configuration",
          "record_name": "zemi",
          "source_turn": "b2-focal",
          "subject": "lumiu service"
        }
      ],
      "predicate": "dispatch configuration",
      "reason_quotes": [
        {
          "end": 219,
          "occurrence": 1,
          "quote": "佇列壅塞，站點 477f922dcb",
          "start": 201,
          "turn_id": "b2-focal"
        }
      ],
      "replacement_extent": "entire_predecessor",
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "source_quotes": [
        {
          "end": 82,
          "occurrence": 1,
          "quote": "lumiu服務的派送設定，路線 = t-mavo，需經核准 = 是",
          "start": 49,
          "turn_id": "b2-focal"
        },
        {
          "end": 73,
          "occurrence": 1,
          "quote": "路線 = t-mavo",
          "start": 62,
          "turn_id": "b2-focal"
        },
        {
          "end": 82,
          "occurrence": 1,
          "quote": "需經核准 = 是",
          "start": 74,
          "turn_id": "b2-focal"
        },
        {
          "end": 219,
          "occurrence": 1,
          "quote": "佇列壅塞，站點 477f922dcb",
          "start": 201,
          "turn_id": "b2-focal"
        }
      ],
      "source_turns": [
        "b2-focal"
      ],
      "subject": "lumiu service"
    }
  ],
  "rejected": []
}
```

The required event/slot/clause is absent from usable delivered evidence. The saved admission/link trace locates the earlier loss. The displayed stale delivery cannot supply the missing focal update merely because it has the same subject.

Example 4: `pilot-correction-L01-W2-U-2.json`, R; **extraction / causal_clauses_not_admitted**.

Exact answer fragment:
```json
{
  "status": "not_stated",
  "support": []
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 1,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r2\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"t-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-13T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "lumiu服務的派送設定，路線 = t-mavo，需經核准 = 是",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = t-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "佇列壅塞，站點 477f922dcb",
        "index": 3,
        "source_turn": "b2-focal"
      }
    ]
  },
  {
    "intent": "history",
    "item": 0,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r2\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"t-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"historical\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-13T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "lumiu服務的派送設定，路線 = t-mavo，需經核准 = 是",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = t-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "佇列壅塞，站點 477f922dcb",
        "index": 3,
        "source_turn": "b2-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "reason": {
    "status": "stated",
    "support": []
  },
  "acceptedGraphs": [
    {
      "edges": [
        {
          "from": "a",
          "support": [
            [
              {
                "end": 253,
                "offset_unit": "utf16",
                "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更。",
                "start": 221,
                "turn_id": "b2-focal"
              }
            ]
          ],
          "to": "decision"
        }
      ]
    }
  ]
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "extraction",
  "subtype": "causal_clauses_not_admitted",
  "original_errors": [],
  "address_changes": [],
  "after_address_replay": {
    "correctness": 0,
    "support": "not_applicable",
    "verdict": 0,
    "valid": true,
    "error": "reason_status_mismatch",
    "stratum": "stated",
    "denominator": 1,
    "noEvidenceBaseline": {
      "status": "not_stated",
      "support": [],
      "R": 0
    }
  },
  "content_witness": {
    "complete": false,
    "only": true,
    "witness": false
  },
  "complete_evidence_delivered": false
}
```

The required event/slot/clause is absent from usable delivered evidence. The saved admission/link trace locates the earlier loss. The displayed stale delivery cannot supply the missing focal update merely because it has the same subject.

Example 5: `pilot-scope_change-L01-W1-P-2.json`, C; **extraction / predecessor_anchor_wrong_or_missing**.

Exact answer fragment:
```json
{
  "rows": [
    {
      "approval": {
        "state": "value",
        "value": true
      },
      "cap": {
        "state": "value",
        "value": {
          "decimal": "681",
          "unit": "requests/day"
        }
      },
      "citations": [
        {
          "intent": "current",
          "item": 0,
          "occurrence": 1,
          "quote": "我們採用lumiu服務的派送設定,路線 = r-mavo,需經核准 = 是,每日請求上限 = 681 requests/day。適用對象:全部國家(TW、JP、US)、free/pro 方案及 web/app 通路。生效區間 [2031-03-11T16:00:00.000Z, 無上限(不含終點))",
          "source": null,
          "unit": "body"
        }
      ],
      "route": {
        "state": "value",
        "value": "r-mavo"
      },
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "valid": {
        "from": "2031-03-11T16:00:00.000Z",
        "to": null
      }
    }
  ],
  "status": "active"
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 0,
    "body": "{\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r1\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"cap\":{\"decimal\":\"681\",\"unit\":\"requests/day\"},\"route\":\"r-mavo\"},\"sources\":[\"b1-focal\"],\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-11T16:00:00.000Z\",\"to\":null}} b1-focal: 我們採用lumiu服務的派送設定,路線 = r-mavo,需經核准 = 是,每日請求上限 = 681 requests/day。適用對象:全部國家(TW、JP、US)、free/pro 方案及 web/app 通路。生效區間 [2031-03-11T16:00:00.000Z, 無上限(不含終點)) b1-focal: r-mavo b1-focal: 是 b1-focal: 681 requests/day",
    "sources": [
      {
        "index": 0,
        "role": "user",
        "excerpt": "是"
      },
      {
        "index": 1,
        "role": "user",
        "excerpt": "r-mavo"
      },
      {
        "index": 2,
        "role": "user",
        "excerpt": "681 requests/day"
      },
      {
        "index": 3,
        "role": "user",
        "excerpt": "我們採用lumiu服務的派送設定,路線 = r-mavo,需經核准 = 是,每日請求上限 = 681 requests/day。適用對象:全部國家(TW、JP、US)、free/pro 方案及 web/app 通路。生效區間 [2031-03-11T16:00:00.000Z, 無上限(不含終點))"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "current": {
    "rows": [
      {
        "approval": {
          "state": "value",
          "value": true
        },
        "cap": {
          "state": "value",
          "value": {
            "decimal": "681",
            "unit": "requests/day"
          }
        },
        "citations": [],
        "route": {
          "state": "value",
          "value": "r-mavo"
        },
        "scope": {
          "any": [
            {
              "all": [
                {
                  "field": "country",
                  "values": [
                    "JP",
                    "US"
                  ]
                }
              ]
            }
          ]
        },
        "valid": {
          "from": "2031-03-11T16:00:00.000Z",
          "to": null
        }
      },
      {
        "approval": {
          "state": "value",
          "value": true
        },
        "cap": {
          "state": "value",
          "value": {
            "decimal": "701",
            "unit": "requests/day"
          }
        },
        "citations": [],
        "route": {
          "state": "value",
          "value": "s-mavo"
        },
        "scope": {
          "any": [
            {
              "all": [
                {
                  "field": "country",
                  "values": [
                    "TW"
                  ]
                }
              ]
            }
          ]
        },
        "valid": {
          "from": "2031-03-12T16:00:00.000Z",
          "to": null
        }
      }
    ],
    "status": "active"
  }
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "extraction",
  "subtype": "predecessor_anchor_wrong_or_missing",
  "missing_trace": [
    {
      "errors": [
        "missing_anchor"
      ],
      "event": "pilot-scope_change-L01-W1/e2",
      "stage": "extraction",
      "subtype": "predecessor_anchor_wrong_or_missing",
      "turn": "b2-focal"
    }
  ],
  "extraction_cache": "9f1a416202ae7e00093489d03f668db48accc572d995bf04050cec3cb067811a.json",
  "admitted_focal_events": [
    {
      "change_type": "scope_change",
      "claims": [
        {
          "field": "value",
          "value": {
            "text": "s-mavo",
            "type": "Text"
          }
        },
        {
          "field": "approval",
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        {
          "field": "cap",
          "value": {
            "decimal": "701",
            "type": "Quantity",
            "unit": "requests/day"
          }
        }
      ],
      "commitment": "adopted",
      "context": null,
      "effective_interval": {
        "from": "2031-03-12T16:00:00.000Z",
        "to": null
      },
      "event_id": "e1",
      "field_mask": [
        "value",
        "approval",
        "cap"
      ],
      "kind": "decision",
      "observed_at": "2031-03-13T02:00:00.000Z",
      "payload": {
        "approval": {
          "anchors": [
            {
              "end": 87,
              "occurrence": 1,
              "quote": "需經核准 = 是",
              "start": 79,
              "turn_id": "b2-focal"
            }
          ],
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        "cap": {
          "anchors": [
            {
              "end": 113,
              "occurrence": 1,
              "quote": "每日請求上限 = 701 requests/day",
              "start": 88,
              "turn_id": "b2-focal"
            }
          ],
          "value": {
            "decimal": "701",
            "type": "Quantity",
            "unit": "requests/day"
          }
        },
        "route": {
          "anchors": [
            {
              "end": 78,
              "occurrence": 1,
              "quote": "路線 = s-mavo",
              "start": 67,
              "turn_id": "b2-focal"
            }
          ],
          "value": {
            "text": "s-mavo",
            "type": "Text"
          }
        },
        "type": "slots"
      },
      "predecessor_anchors": [
        {
          "predicate": "dispatch configuration",
          "record_name": "kavo",
          "source_turn": "b2-focal",
          "subject": "lumiu service"
        }
      ],
      "predicate": "dispatch configuration",
      "reason_quotes": [
        {
          "end": 202,
          "occurrence": 1,
          "quote": "備援不足，站點 0d49da0d3c",
          "start": 184,
          "turn_id": "b2-focal"
        },
        {
          "end": 235,
          "occurrence": 1,
          "quote": "因為備援不足，站點 0d49da0d3c，所以造成這次決定變更",
          "start": 204,
          "turn_id": "b2-focal"
        }
      ],
      "replacement_extent": "partial",
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW"
                ]
              }
            ]
          }
        ]
      },
      "source_quotes": [
        {
          "end": 113,
          "occurrence": 1,
          "quote": "只把紀錄 kavo 中適用對象為country = TW; 其他維度皆適用的部分改成路線 = s-mavo，需經核准 = 是，每日請求上限 = 701 requests/day",
          "start": 25,
          "turn_id": "b2-focal"
        },
        {
          "end": 78,
          "occurrence": 1,
          "quote": "路線 = s-mavo",
          "start": 67,
          "turn_id": "b2-focal"
        },
        {
          "end": 87,
          "occurrence": 1,
          "quote": "需經核准 = 是",
          "start": 79,
          "turn_id": "b2-focal"
        },
        {
          "end": 113,
          "occurrence": 1,
          "quote": "每日請求上限 = 701 requests/day",
          "start": 88,
          "turn_id": "b2-focal"
        },
        {
          "end": 202,
          "occurrence": 1,
          "quote": "備援不足，站點 0d49da0d3c",
          "start": 184,
          "turn_id": "b2-focal"
        },
        {
          "end": 235,
          "occurrence": 1,
          "quote": "因為備援不足，站點 0d49da0d3c，所以造成這次決定變更",
          "start": 204,
          "turn_id": "b2-focal"
        }
      ],
      "source_turns": [
        "b2-focal"
      ],
      "subject": "lumiu service"
    }
  ],
  "rejected": []
}
```

The required event/slot/clause is absent from usable delivered evidence. The saved admission/link trace locates the earlier loss. The displayed stale delivery cannot supply the missing focal update merely because it has the same subject.

Example 6: `pilot-refinement-L01-W1-U-2.json`, C; **reader wrong / delivered_facts_sufficient**.

Exact answer fragment:
```json
{
  "rows": [
    {
      "approval": {
        "state": "not_specified",
        "value": null
      },
      "cap": {
        "state": "value",
        "value": {
          "decimal": "864",
          "unit": "requests/day"
        }
      },
      "citations": [
        {
          "intent": "current",
          "item": 0,
          "occurrence": 1,
          "quote": "採用紀錄 zemi，部分修訂tevou服務的派送設定：只改每日請求上限 = 864 requests/day",
          "source": null,
          "unit": "body"
        },
        {
          "intent": "current",
          "item": 0,
          "occurrence": 2,
          "quote": "kavo",
          "source": null,
          "unit": "body"
        },
        {
          "intent": "current",
          "item": 0,
          "occurrence": 3,
          "quote": "每日請求上限 = 864 requests/day",
          "source": null,
          "unit": "body"
        },
        {
          "intent": "current",
          "item": 0,
          "occurrence": 5,
          "quote": "因為延遲增加，站點 9507cfb043，所以造成這次決定變更",
          "source": null,
          "unit": "body"
        }
      ],
      "route": {
        "state": "value",
        "value": "kavo"
      },
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "valid": {
        "from": "2031-03-14T16:00:00.000Z",
        "to": null
      }
    },
    {
      "approval": {
        "state": "value",
        "value": true
      },
      "cap": {
        "state": "value",
        "value": {
          "decimal": "844",
          "unit": "requests/day"
        }
      },
      "citations": [
        {
          "intent": "current",
          "item": 1,
          "occurrence": 1,
          "quote": "我們採用tevou服務的派送設定，路線 = r-mavo，需經核准 = 是，每日請求上限 = 844 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-13T16:00:00.000Z, 無上限（不含終點）)",
          "source": null,
          "unit": "body"
        },
        {
          "intent": "current",
          "item": 1,
          "occurrence": 2,
          "quote": "路線 = r-mavo",
          "source": null,
          "unit": "body"
        },
        {
          "intent": "current",
          "item": 1,
          "occurrence": 3,
          "quote": "需經核准 = 是",
          "source": null,
          "unit": "body"
        },
        {
          "intent": "current",
          "item": 1,
          "occurrence": 4,
          "quote": "每日請求上限 = 844 requests/day",
          "source": null,
          "unit": "body"
        }
      ],
      "route": {
        "state": "value",
        "value": "r-mavo"
      },
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "valid": {
        "from": "2031-03-13T16:00:00.000Z",
        "to": null
      }
    }
  ],
  "status": "unresolved"
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 0,
    "body": "{\"change_type\":\"refinement\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r5\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"cap\":{\"decimal\":\"864\",\"unit\":\"requests/day\"},\"route\":\"kavo\"},\"sources\":[\"b2-focal\"],\"status\":\"unresolved\",\"subject\":\"tevou service\",\"valid\":{\"from\":\"2031-03-14T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "採用紀錄 zemi，部分修訂tevou服務的派送設定：只改每日請求上限 = 864 requests/day",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "kavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "每日請求上限 = 864 requests/day",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "延遲增加，站點 9507cfb043",
        "index": 3,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為延遲增加，站點 9507cfb043，所以造成這次決定變更",
        "index": 4,
        "source_turn": "b2-focal"
      }
    ]
  },
  {
    "intent": "current",
    "item": 1,
    "body": "{\"change_type\":\"initial\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r1\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"cap\":{\"decimal\":\"844\",\"unit\":\"requests/day\"},\"route\":\"r-mavo\"},\"sources\":[\"b1-focal\"],\"status\":\"active\",\"subject\":\"tevou service\",\"valid\":{\"from\":\"2031-03-13T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "我們採用tevou服務的派送設定，路線 = r-mavo，需經核准 = 是，每日請求上限 = 844 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-13T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b1-focal"
      },
      {
        "excerpt": "路線 = r-mavo",
        "index": 1,
        "source_turn": "b1-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b1-focal"
      },
      {
        "excerpt": "每日請求上限 = 844 requests/day",
        "index": 3,
        "source_turn": "b1-focal"
      }
    ]
  },
  {
    "intent": "history",
    "item": 0,
    "body": "{\"change_type\":\"refinement\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r5\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"cap\":{\"decimal\":\"864\",\"unit\":\"requests/day\"},\"route\":\"kavo\"},\"sources\":[\"b2-focal\"],\"status\":\"historical\",\"subject\":\"tevou service\",\"valid\":{\"from\":\"2031-03-14T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "採用紀錄 zemi，部分修訂tevou服務的派送設定：只改每日請求上限 = 864 requests/day",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "kavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "每日請求上限 = 864 requests/day",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "延遲增加，站點 9507cfb043",
        "index": 3,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為延遲增加，站點 9507cfb043，所以造成這次決定變更",
        "index": 4,
        "source_turn": "b2-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "current": {
    "rows": [
      {
        "approval": {
          "state": "value",
          "value": true
        },
        "cap": {
          "state": "value",
          "value": {
            "decimal": "864",
            "unit": "requests/day"
          }
        },
        "citations": [],
        "route": {
          "state": "value",
          "value": "r-mavo"
        },
        "scope": {
          "any": [
            {
              "all": []
            }
          ]
        },
        "valid": {
          "from": "2031-03-14T16:00:00.000Z",
          "to": null
        }
      }
    ],
    "status": "active"
  }
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "reader wrong",
  "subtype": "delivered_facts_sufficient",
  "required_evidence_checks": {
    "events": [
      "pilot-refinement-L01-W1/e1",
      "pilot-refinement-L01-W1/e2"
    ],
    "availability": [
      {
        "available": true,
        "supplied": true,
        "interval": true,
        "meaning": true,
        "turn": "b1-focal",
        "fields": [
          "value",
          "approval",
          "cap"
        ],
        "event": "pilot-refinement-L01-W1/e1"
      },
      {
        "available": true,
        "supplied": true,
        "interval": true,
        "meaning": true,
        "turn": "b2-focal",
        "fields": [
          "cap"
        ],
        "event": "pilot-refinement-L01-W1/e2"
      }
    ]
  }
}
```

Required source evidence is delivered (or, for negative R, the factual status rule is decisive), but the selected answer contradicts or omits the requested result. Citations do not change factual C/O scoring.

Example 7: `pilot-correction-L01-W1-O-2.json`, O; **reader wrong / delivered_facts_sufficient**.

Exact answer fragment:
```json
{
  "records": [],
  "status": "none"
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 0,
    "body": "{\"change_type\":\"initial\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r1\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"r-mavo\"},\"sources\":[\"b1-focal\"],\"status\":\"active\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-02-28T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "我們採用lumiu服務的派送設定，路線 = r-mavo，需經核准 = 是。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-02-28T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b1-focal"
      },
      {
        "excerpt": "路線 = r-mavo",
        "index": 1,
        "source_turn": "b1-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b1-focal"
      }
    ]
  },
  {
    "intent": "current",
    "item": 1,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r2\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"s-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-01T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "更正紀錄 kavo：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 zemi 更正這個單一斷言：lumiu服務的派送設定，路線 = s-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-01T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = s-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "佇列壅塞，站點 477f922dcb",
        "index": 3,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "index": 4,
        "source_turn": "b2-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "old": {
    "records": [
      {
        "predecessor_turn": "b1-focal",
        "rows": [
          {
            "approval": {
              "state": "value",
              "value": true
            },
            "cap": {
              "state": "not_specified",
              "value": null
            },
            "citations": [],
            "route": {
              "state": "value",
              "value": "r-mavo"
            },
            "scope": {
              "any": [
                {
                  "all": []
                }
              ]
            },
            "valid": {
              "from": "2031-02-28T16:00:00.000Z",
              "to": null
            }
          }
        ],
        "status": "erroneous"
      }
    ],
    "status": "available"
  }
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "reader wrong",
  "subtype": "delivered_facts_sufficient",
  "required_evidence_checks": {
    "events": [
      "pilot-correction-L01-W1/e1",
      "pilot-correction-L01-W1/e2"
    ],
    "availability": [
      {
        "available": true,
        "supplied": true,
        "interval": true,
        "meaning": true,
        "turn": "b1-focal",
        "fields": [
          "value",
          "approval"
        ],
        "event": "pilot-correction-L01-W1/e1"
      },
      {
        "available": true,
        "supplied": true,
        "interval": true,
        "meaning": true,
        "turn": "b2-focal",
        "fields": [
          "value",
          "approval"
        ],
        "event": "pilot-correction-L01-W1/e2"
      }
    ]
  }
}
```

Required source evidence is delivered (or, for negative R, the factual status rule is decisive), but the selected answer contradicts or omits the requested result. Citations do not change factual C/O scoring.

Example 8: `pilot-correction-L01-W1-T-2.json`, R; **reader wrong / incomplete_or_wrong_selected_explanation**.

Exact answer fragment:
```json
{
  "status": "stated",
  "support": [
    {
      "intent": "current",
      "item": 0,
      "occurrence": 1,
      "quote": "更正紀錄 kavo：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 zemi 更正這個單一斷言：lumiu服務的派送設定，路線 = s-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-01T16:00:00.000Z, 無上限（不含終點）)",
      "source": null,
      "unit": "body"
    },
    {
      "intent": "current",
      "item": 0,
      "occurrence": 1,
      "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
      "source": null,
      "unit": "body"
    }
  ]
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 0,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r2\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"s-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-01T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "更正紀錄 kavo：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 zemi 更正這個單一斷言：lumiu服務的派送設定，路線 = s-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-01T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = s-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "佇列壅塞，站點 477f922dcb",
        "index": 3,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "index": 4,
        "source_turn": "b2-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "reason": {
    "status": "stated",
    "support": []
  },
  "acceptedGraphs": [
    {
      "edges": [
        {
          "from": "a",
          "support": [
            [
              {
                "end": 253,
                "offset_unit": "utf16",
                "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更。",
                "start": 221,
                "turn_id": "b2-focal"
              }
            ]
          ],
          "to": "decision"
        }
      ]
    }
  ]
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "reader wrong",
  "subtype": "incomplete_or_wrong_selected_explanation",
  "original_errors": [
    "quote_or_occurrence_not_delivered",
    "quote_or_occurrence_not_delivered"
  ],
  "address_changes": [
    {
      "component": "R",
      "before": {
        "intent": "current",
        "item": 0,
        "occurrence": 1,
        "quote": "更正紀錄 kavo：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 zemi 更正這個單一斷言：lumiu服務的派送設定，路線 = s-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-01T16:00:00.000Z, 無上限（不含終點）)",
        "source": null,
        "unit": "body"
      },
      "after": {
        "intent": "current",
        "item": 0,
        "occurrence": 1,
        "quote": "更正紀錄 kavo：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 zemi 更正這個單一斷言：lumiu服務的派送設定，路線 = s-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-01T16:00:00.000Z, 無上限（不含終點）)",
        "source": 0,
        "unit": "receipt"
      },
      "candidates": 1
    },
    {
      "component": "R",
      "before": {
        "intent": "current",
        "item": 0,
        "occurrence": 1,
        "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "source": null,
        "unit": "body"
      },
      "after": {
        "intent": "current",
        "item": 0,
        "occurrence": 1,
        "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "source": 4,
        "unit": "receipt"
      },
      "candidates": 1
    }
  ],
  "after_address_replay": {
    "correctness": null,
    "support": null,
    "verdict": null,
    "valid": true,
    "graphs": [
      {
        "edges": [
          {
            "from": "a",
            "to": "decision",
            "covered": false
          }
        ]
      }
    ],
    "error": "unrecognized_or_broad_causal_selection",
    "stratum": "stated",
    "denominator": 1,
    "noEvidenceBaseline": {
      "status": "not_stated",
      "support": [],
      "R": 0
    }
  },
  "content_witness": {
    "complete": true,
    "only": false,
    "witness": false
  },
  "complete_evidence_delivered": true
}
```

Required source evidence is delivered (or, for negative R, the factual status rule is decisive), but the selected answer contradicts or omits the requested result. Citations do not change factual C/O scoring.

Example 9: `pilot-correction-L02-W2-U-2.json`, R; **reader wrong / negative_reason_status_wrong**.

Exact answer fragment:
```json
{
  "status": "stated",
  "support": [
    {
      "intent": "current",
      "item": 1,
      "occurrence": 1,
      "quote": "原先記載的斷言有誤，從未是實際採用的決定",
      "source": null,
      "unit": "body"
    }
  ]
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 1,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r4\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"r-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"unresolved\",\"subject\":\"pakuu service\",\"valid\":{\"from\":\"2031-03-11T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "原先記載的斷言有誤，從未是實際採用的決定",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = r-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      }
    ]
  },
  {
    "intent": "history",
    "item": 0,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r4\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"r-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"historical\",\"subject\":\"pakuu service\",\"valid\":{\"from\":\"2031-03-11T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "原先記載的斷言有誤，從未是實際採用的決定",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = r-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "reason": {
    "status": "not_stated",
    "support": []
  },
  "acceptedGraphs": []
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "reader wrong",
  "subtype": "negative_reason_status_wrong",
  "original_errors": [
    "quote_or_occurrence_not_delivered"
  ],
  "address_changes": [
    {
      "component": "R",
      "before": {
        "intent": "current",
        "item": 1,
        "occurrence": 1,
        "quote": "原先記載的斷言有誤，從未是實際採用的決定",
        "source": null,
        "unit": "body"
      },
      "after": {
        "intent": "current",
        "item": 1,
        "occurrence": 1,
        "quote": "原先記載的斷言有誤，從未是實際採用的決定",
        "source": 0,
        "unit": "receipt"
      },
      "candidates": 2
    }
  ],
  "after_address_replay": {
    "correctness": 0,
    "support": "not_applicable",
    "verdict": 0,
    "valid": true,
    "error": "reason_status_mismatch",
    "stratum": "not_stated",
    "denominator": 1,
    "noEvidenceBaseline": {
      "status": "not_stated",
      "support": [],
      "R": 1
    }
  },
  "content_witness": {
    "complete": false,
    "only": false,
    "witness": false
  },
  "complete_evidence_delivered": false
}
```

Required source evidence is delivered (or, for negative R, the factual status rule is decisive), but the selected answer contradicts or omits the requested result. Citations do not change factual C/O scoring.

Example 10: `pilot-expiry-L01-W1-P-4.json`, C; **reader wrong / delivered_facts_sufficient**.

Exact answer fragment:
```json
{
  "rows": [
    {
      "approval": {
        "state": "not_specified",
        "value": null
      },
      "cap": {
        "state": "not_specified",
        "value": null
      },
      "citations": [
        {
          "intent": "current",
          "item": 0,
          "occurrence": 1,
          "quote": "no_active_decision; vomau service dispatch configuration; scope={\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]}; expiry=2031-03-15T16:00:00.000Z",
          "source": null,
          "unit": "body"
        }
      ],
      "route": {
        "state": "not_specified",
        "value": null
      },
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "valid": {
        "from": null,
        "to": "2031-03-15T16:00:00.000Z"
      }
    }
  ],
  "status": "no_active_decision"
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 0,
    "body": "no_active_decision; vomau service dispatch configuration; scope={\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]}; expiry=2031-03-15T16:00:00.000Z",
    "sources": [
      {
        "index": 0,
        "role": "user",
        "excerpt": "we adopt vomau service 服務 dispatch configuration: route = s-mavo; approval required = true; daily request cap = 580 requests/day"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "current": {
    "rows": [],
    "status": "no_active_decision"
  }
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "reader wrong",
  "subtype": "delivered_facts_sufficient",
  "required_evidence_checks": {
    "events": [
      "pilot-expiry-L01-W1/e3"
    ],
    "availability": [
      {
        "available": true,
        "supplied": true,
        "interval": true,
        "meaning": true,
        "turn": "b3-focal",
        "fields": [
          "value",
          "approval",
          "cap"
        ],
        "event": "pilot-expiry-L01-W1/e3"
      }
    ]
  },
  "scheduled_expiry_outcomes": [
    {
      "method": "adapter-scheduled",
      "event": "[\"pilot-expiry-L01-W1\",1,\"e1\"]",
      "outcome": "scheduled_expiry_success"
    },
    {
      "method": "adapter-scheduled",
      "event": "[\"pilot-expiry-L01-W1\",3,\"e1\"]",
      "outcome": "scheduled_expiry_success"
    }
  ]
}
```

Required source evidence is delivered (or, for negative R, the factual status rule is decisive), but the selected answer contradicts or omits the requested result. Citations do not change factual C/O scoring.

Example 11: `pilot-correction-L01-W1-O-2.json`, R; **citation addressing only / same_item_unit_source_repair_complete_content**.

Exact answer fragment:
```json
{
  "status": "stated",
  "support": [
    {
      "intent": "current",
      "item": 1,
      "occurrence": 1,
      "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
      "source": null,
      "unit": "body"
    }
  ]
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 1,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r2\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"s-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-01T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "更正紀錄 kavo：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 zemi 更正這個單一斷言：lumiu服務的派送設定，路線 = s-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-01T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = s-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "佇列壅塞，站點 477f922dcb",
        "index": 3,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "index": 4,
        "source_turn": "b2-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "reason": {
    "status": "stated",
    "support": []
  },
  "acceptedGraphs": [
    {
      "edges": [
        {
          "from": "a",
          "support": [
            [
              {
                "end": 253,
                "offset_unit": "utf16",
                "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更。",
                "start": 221,
                "turn_id": "b2-focal"
              }
            ]
          ],
          "to": "decision"
        }
      ]
    }
  ]
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "citation addressing only",
  "subtype": "same_item_unit_source_repair_complete_content",
  "original_errors": [
    "quote_or_occurrence_not_delivered"
  ],
  "address_changes": [
    {
      "component": "R",
      "before": {
        "intent": "current",
        "item": 1,
        "occurrence": 1,
        "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "source": null,
        "unit": "body"
      },
      "after": {
        "intent": "current",
        "item": 1,
        "occurrence": 1,
        "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "source": 4,
        "unit": "receipt"
      },
      "candidates": 1
    }
  ],
  "after_address_replay": {
    "correctness": 0,
    "support": 0,
    "verdict": 0,
    "valid": true,
    "graphs": [
      {
        "edges": [
          {
            "from": "a",
            "to": "decision",
            "covered": false
          }
        ]
      }
    ],
    "error": "incomplete_required_support",
    "stratum": "stated",
    "denominator": 1,
    "noEvidenceBaseline": {
      "status": "not_stated",
      "support": [],
      "R": 0
    }
  },
  "content_witness": {
    "complete": true,
    "only": true,
    "witness": true
  },
  "complete_evidence_delivered": true
}
```

The submitted words cover one complete gold explanation after address-only relocation. The replay result above shows the remaining exact-span punctuation or context-referral hurdle; it is not counted as a second primary failure.

Example 12: `pilot-correction-L03-W1-T-4.json`, R; **citation addressing only / same_item_unit_source_repair_complete_content**.

Exact answer fragment:
```json
{
  "status": "stated",
  "support": [
    {
      "intent": "current",
      "item": 0,
      "occurrence": 1,
      "quote": "因為佇列壅塞，站點 578a581148，所以造成容量不足，站點 64f0f961b1。",
      "source": null,
      "unit": "body"
    },
    {
      "intent": "current",
      "item": 0,
      "occurrence": 1,
      "quote": "因為容量不足，站點 64f0f961b1，所以造成這次決定變更。",
      "source": null,
      "unit": "body"
    }
  ]
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 0,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r11\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"s-mavo\"},\"sources\":[\"b4-focal\"],\"status\":\"unresolved\",\"subject\":\"saruu service\",\"valid\":{\"from\":\"2031-03-05T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "更正紀錄 zemi：原先記載的斷言有誤，從未是實際採用的決定。",
        "index": 0,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "以紀錄 biso 更正這個單一斷言：saruu服務的派送設定，路線 = s-mavo，需經核准 = 是。",
        "index": 1,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。",
        "index": 2,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "生效區間 [2031-03-05T16:00:00.000Z, 無上限（不含終點）)",
        "index": 3,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "路線 = s-mavo",
        "index": 4,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 5,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 578a581148，所以造成容量不足，站點 64f0f961b1。",
        "index": 6,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為容量不足，站點 64f0f961b1，所以造成這次決定變更。",
        "index": 7,
        "source_turn": "b4-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "reason": {
    "status": "stated",
    "support": []
  },
  "acceptedGraphs": [
    {
      "edges": [
        {
          "from": "a",
          "support": [
            [
              {
                "end": 292,
                "offset_unit": "utf16",
                "quote": "因為佇列壅塞，站點 578a581148，所以造成容量不足，站點 64f0f961b1。",
                "start": 248,
                "turn_id": "b4-focal"
              }
            ]
          ],
          "to": "b"
        },
        {
          "from": "b",
          "support": [
            [
              {
                "end": 325,
                "offset_unit": "utf16",
                "quote": "因為容量不足，站點 64f0f961b1，所以造成這次決定變更。",
                "start": 293,
                "turn_id": "b4-focal"
              }
            ]
          ],
          "to": "decision"
        }
      ]
    }
  ]
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "citation addressing only",
  "subtype": "same_item_unit_source_repair_complete_content",
  "original_errors": [
    "quote_or_occurrence_not_delivered",
    "quote_or_occurrence_not_delivered"
  ],
  "address_changes": [
    {
      "component": "R",
      "before": {
        "intent": "current",
        "item": 0,
        "occurrence": 1,
        "quote": "因為佇列壅塞，站點 578a581148，所以造成容量不足，站點 64f0f961b1。",
        "source": null,
        "unit": "body"
      },
      "after": {
        "intent": "current",
        "item": 0,
        "occurrence": 1,
        "quote": "因為佇列壅塞，站點 578a581148，所以造成容量不足，站點 64f0f961b1。",
        "source": 6,
        "unit": "receipt"
      },
      "candidates": 1
    },
    {
      "component": "R",
      "before": {
        "intent": "current",
        "item": 0,
        "occurrence": 1,
        "quote": "因為容量不足，站點 64f0f961b1，所以造成這次決定變更。",
        "source": null,
        "unit": "body"
      },
      "after": {
        "intent": "current",
        "item": 0,
        "occurrence": 1,
        "quote": "因為容量不足，站點 64f0f961b1，所以造成這次決定變更。",
        "source": 7,
        "unit": "receipt"
      },
      "candidates": 1
    }
  ],
  "after_address_replay": {
    "correctness": 1,
    "support": null,
    "verdict": null,
    "valid": true,
    "graphs": [
      {
        "edges": [
          {
            "from": "a",
            "to": "b",
            "covered": true
          },
          {
            "from": "b",
            "to": "decision",
            "covered": true
          }
        ]
      }
    ],
    "error": "unrecognized_evidence_context",
    "stratum": "stated",
    "denominator": 1,
    "noEvidenceBaseline": {
      "status": "not_stated",
      "support": [],
      "R": 0
    }
  },
  "content_witness": {
    "complete": true,
    "only": true,
    "witness": true
  },
  "complete_evidence_delivered": true
}
```

The submitted words cover one complete gold explanation after address-only relocation. The replay result above shows the remaining exact-span punctuation or context-referral hurdle; it is not counted as a second primary failure.

Example 13: `pilot-reversal-L01-W2-O-2.json`, R; **citation addressing only / same_item_unit_source_repair_complete_content**.

Exact answer fragment:
```json
{
  "status": "stated",
  "support": [
    {
      "intent": "current",
      "item": 2,
      "occurrence": 1,
      "quote": "因為容量不足，站點 9b4d9fb27d，所以造成這次決定變更",
      "source": null,
      "unit": "body"
    }
  ]
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 2,
    "body": "{\"change_type\":\"reversal\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r6\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"cap\":{\"decimal\":\"667\",\"unit\":\"requests/day\"},\"route\":\"t-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"unresolved\",\"subject\":\"vomau service\",\"valid\":{\"from\":\"2031-03-15T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "我們完整撤回紀錄 zemi，包括每個欄位和條件。改採紀錄 hura：vomau服務的派送設定，路線 = t-mavo，需經核准 = 是，每日請求上限 = 667 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-15T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = t-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "每日請求上限 = 667 requests/day",
        "index": 3,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "容量不足，站點 9b4d9fb27d",
        "index": 4,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為容量不足，站點 9b4d9fb27d，所以造成這次決定變更",
        "index": 5,
        "source_turn": "b2-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "reason": {
    "status": "stated",
    "support": []
  },
  "acceptedGraphs": [
    {
      "edges": [
        {
          "from": "a",
          "support": [
            [
              {
                "end": 248,
                "offset_unit": "utf16",
                "quote": "因為容量不足，站點 9b4d9fb27d，所以造成這次決定變更。",
                "start": 216,
                "turn_id": "b2-focal"
              }
            ]
          ],
          "to": "decision"
        }
      ]
    }
  ]
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "citation addressing only",
  "subtype": "same_item_unit_source_repair_complete_content",
  "original_errors": [
    "quote_or_occurrence_not_delivered"
  ],
  "address_changes": [
    {
      "component": "R",
      "before": {
        "intent": "current",
        "item": 2,
        "occurrence": 1,
        "quote": "因為容量不足，站點 9b4d9fb27d，所以造成這次決定變更",
        "source": null,
        "unit": "body"
      },
      "after": {
        "intent": "current",
        "item": 2,
        "occurrence": 1,
        "quote": "因為容量不足，站點 9b4d9fb27d，所以造成這次決定變更",
        "source": 5,
        "unit": "receipt"
      },
      "candidates": 1
    }
  ],
  "after_address_replay": {
    "correctness": 0,
    "support": 0,
    "verdict": 0,
    "valid": true,
    "graphs": [
      {
        "edges": [
          {
            "from": "a",
            "to": "decision",
            "covered": false
          }
        ]
      }
    ],
    "error": "incomplete_required_support",
    "stratum": "stated",
    "denominator": 1,
    "noEvidenceBaseline": {
      "status": "not_stated",
      "support": [],
      "R": 0
    }
  },
  "content_witness": {
    "complete": true,
    "only": true,
    "witness": true
  },
  "complete_evidence_delivered": true
}
```

The submitted words cover one complete gold explanation after address-only relocation. The replay result above shows the remaining exact-span punctuation or context-referral hurdle; it is not counted as a second primary failure.

Example 14: `pilot-correction-L01-W1-U-2.json`, R; **citation addressing only / address_and_occurrence_repair_complete_content**.

Exact answer fragment:
```json
{
  "status": "stated",
  "support": [
    {
      "intent": "current",
      "item": 0,
      "occurrence": 1,
      "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
      "source": null,
      "unit": "body"
    }
  ]
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 0,
    "body": "{\"change_type\":\"initial\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r1\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"r-mavo\"},\"sources\":[\"b1-focal\"],\"status\":\"active\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-02-28T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "我們採用lumiu服務的派送設定，路線 = r-mavo，需經核准 = 是。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-02-28T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b1-focal"
      },
      {
        "excerpt": "路線 = r-mavo",
        "index": 1,
        "source_turn": "b1-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b1-focal"
      }
    ]
  },
  {
    "intent": "current",
    "item": 1,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r2\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"s-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-01T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "更正紀錄 kavo：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 zemi 更正這個單一斷言：lumiu服務的派送設定，路線 = s-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-01T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = s-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "佇列壅塞，站點 477f922dcb",
        "index": 3,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "index": 4,
        "source_turn": "b2-focal"
      }
    ]
  },
  {
    "intent": "history",
    "item": 0,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r2\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"s-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"historical\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-01T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "更正紀錄 kavo：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 zemi 更正這個單一斷言：lumiu服務的派送設定，路線 = s-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-01T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = s-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "佇列壅塞，站點 477f922dcb",
        "index": 3,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "index": 4,
        "source_turn": "b2-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "reason": {
    "status": "stated",
    "support": []
  },
  "acceptedGraphs": [
    {
      "edges": [
        {
          "from": "a",
          "support": [
            [
              {
                "end": 253,
                "offset_unit": "utf16",
                "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更。",
                "start": 221,
                "turn_id": "b2-focal"
              }
            ]
          ],
          "to": "decision"
        }
      ]
    }
  ]
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "citation addressing only",
  "subtype": "address_and_occurrence_repair_complete_content",
  "original_errors": [
    "quote_or_occurrence_not_delivered"
  ],
  "address_changes": [
    {
      "component": "R",
      "before": {
        "intent": "current",
        "item": 0,
        "occurrence": 1,
        "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "source": null,
        "unit": "body"
      },
      "after": {
        "intent": "current",
        "item": 1,
        "occurrence": 1,
        "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "source": 4,
        "unit": "receipt"
      },
      "candidates": 2
    }
  ],
  "after_address_replay": {
    "correctness": 0,
    "support": 0,
    "verdict": 0,
    "valid": true,
    "graphs": [
      {
        "edges": [
          {
            "from": "a",
            "to": "decision",
            "covered": false
          }
        ]
      }
    ],
    "error": "incomplete_required_support",
    "stratum": "stated",
    "denominator": 1,
    "noEvidenceBaseline": {
      "status": "not_stated",
      "support": [],
      "R": 0
    }
  },
  "content_witness": {
    "complete": true,
    "only": true,
    "witness": true
  },
  "complete_evidence_delivered": true
}
```

The submitted words cover one complete gold explanation after address-only relocation. The replay result above shows the remaining exact-span punctuation or context-referral hurdle; it is not counted as a second primary failure.

Example 15: `pilot-correction-L01-W2-U-4.json`, R; **citation addressing only / address_and_occurrence_repair_complete_content**.

Exact answer fragment:
```json
{
  "status": "stated",
  "support": [
    {
      "intent": "current",
      "item": 2,
      "occurrence": 5,
      "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
      "source": null,
      "unit": "body"
    }
  ]
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 2,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r7\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"s-mavo\"},\"sources\":[\"b4-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-13T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "更正紀錄 hura：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 kavo 更正這個單一斷言：lumiu服務的派送設定，路線 = s-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-13T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "路線 = s-mavo",
        "index": 1,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "佇列壅塞，站點 477f922dcb",
        "index": 3,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "index": 4,
        "source_turn": "b4-focal"
      }
    ]
  },
  {
    "intent": "history",
    "item": 1,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r7\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"s-mavo\"},\"sources\":[\"b4-focal\"],\"status\":\"historical\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-13T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "更正紀錄 hura：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 kavo 更正這個單一斷言：lumiu服務的派送設定，路線 = s-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-13T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "路線 = s-mavo",
        "index": 1,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "佇列壅塞，站點 477f922dcb",
        "index": 3,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "index": 4,
        "source_turn": "b4-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "reason": {
    "status": "stated",
    "support": []
  },
  "acceptedGraphs": [
    {
      "edges": [
        {
          "from": "a",
          "support": [
            [
              {
                "end": 253,
                "offset_unit": "utf16",
                "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更。",
                "start": 221,
                "turn_id": "b4-focal"
              }
            ]
          ],
          "to": "decision"
        }
      ]
    }
  ]
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "citation addressing only",
  "subtype": "address_and_occurrence_repair_complete_content",
  "original_errors": [
    "quote_or_occurrence_not_delivered"
  ],
  "address_changes": [
    {
      "component": "R",
      "before": {
        "intent": "current",
        "item": 2,
        "occurrence": 5,
        "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "source": null,
        "unit": "body"
      },
      "after": {
        "intent": "current",
        "item": 2,
        "occurrence": 1,
        "quote": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "source": 4,
        "unit": "receipt"
      },
      "candidates": 2
    }
  ],
  "after_address_replay": {
    "correctness": 0,
    "support": 0,
    "verdict": 0,
    "valid": true,
    "graphs": [
      {
        "edges": [
          {
            "from": "a",
            "to": "decision",
            "covered": false
          }
        ]
      }
    ],
    "error": "incomplete_required_support",
    "stratum": "stated",
    "denominator": 1,
    "noEvidenceBaseline": {
      "status": "not_stated",
      "support": [],
      "R": 0
    }
  },
  "content_witness": {
    "complete": true,
    "only": true,
    "witness": true
  },
  "complete_evidence_delivered": true
}
```

The submitted words cover one complete gold explanation after address-only relocation. The replay result above shows the remaining exact-span punctuation or context-referral hurdle; it is not counted as a second primary failure.

Example 16: `pilot-refinement-L06-W2-T-4.json`, C; **delivery/serialization / state_filter_or_assembly**.

Exact answer fragment:
```json
{
  "rows": [
    {
      "approval": {
        "state": "not_specified",
        "value": null
      },
      "cap": {
        "state": "value",
        "value": {
          "decimal": "188",
          "unit": "requests/day"
        }
      },
      "citations": [
        {
          "intent": "current",
          "item": 3,
          "occurrence": 1,
          "quote": "針對紀錄 kavo，保留派送路線及所有未點名的欄位。採用紀錄 hura，部分修訂lumiu服務的派送設定：只改每日請求上限 = 188 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-09T16:00:00.000Z, 無上限（不含終點）)，終點不含在內。",
          "source": null,
          "unit": "body"
        },
        {
          "intent": "current",
          "item": 5,
          "occurrence": 1,
          "quote": "採用紀錄 hura",
          "source": null,
          "unit": "body"
        },
        {
          "intent": "current",
          "item": 6,
          "occurrence": 1,
          "quote": "只改每日請求上限 = 188 requests/day",
          "source": null,
          "unit": "body"
        }
      ],
      "route": {
        "state": "value",
        "value": "biso"
      },
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "valid": {
        "from": "2031-03-09T16:00:00.000Z",
        "to": null
      }
    }
  ],
  "status": "active"
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 3,
    "body": "{\"change_type\":\"refinement\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r16\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"cap\":{\"decimal\":\"188\",\"unit\":\"requests/day\"},\"route\":\"hura\"},\"sources\":[\"b4-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-09T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "針對紀錄 kavo，保留派送路線及所有未點名的欄位。採用紀錄 hura，部分修訂lumiu服務的派送設定：只改每日請求上限 = 188 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-09T16:00:00.000Z, 無上限（不含終點）)，終點不含在內。",
        "index": 0,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "採用紀錄 hura",
        "index": 1,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "只改每日請求上限 = 188 requests/day",
        "index": 2,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為延遲增加，站點 f327a03e79，所以造成備援不足，站點 d885eb17d6。",
        "index": 3,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為備援不足，站點 d885eb17d6，所以造成這次決定變更。",
        "index": 4,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為處理超時，站點 ce3bc7dc60，所以造成佇列壅塞，站點 48b468e058。",
        "index": 5,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 48b468e058，所以造成這次決定變更。",
        "index": 6,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "上述兩條經過中介的路徑，任一條都足以促成這次變更。",
        "index": 7,
        "source_turn": "b4-focal"
      }
    ]
  },
  {
    "intent": "current",
    "item": 5,
    "body": "{\"change_type\":\"refinement\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r6\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"cap\":{\"decimal\":\"168\",\"unit\":\"requests/day\"},\"route\":\"biso\"},\"sources\":[\"b2-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-07T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "針對紀錄 biso，保留派送路線及所有未點名的欄位。採用紀錄 kavo，部分修訂lumiu服務的派送設定：只改每日請求上限 = 168 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-07T16:00:00.000Z, 無上限（不含終點）)，終點不含在內。",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "biso",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "每日請求上限 = 168 requests/day",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為延遲增加，站點 f327a03e79，所以造成備援不足，站點 d885eb17d6。",
        "index": 3,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為備援不足，站點 d885eb17d6，所以造成這次決定變更。",
        "index": 4,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為處理超時，站點 ce3bc7dc60，所以造成佇列壅塞，站點 48b468e058。",
        "index": 5,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 48b468e058，所以造成這次決定變更。",
        "index": 6,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "上述兩條經過中介的路徑，任一條都足以促成這次變更。",
        "index": 7,
        "source_turn": "b2-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "current": {
    "rows": [
      {
        "approval": {
          "state": "value",
          "value": true
        },
        "cap": {
          "state": "value",
          "value": {
            "decimal": "188",
            "unit": "requests/day"
          }
        },
        "citations": [],
        "route": {
          "state": "value",
          "value": "r-mavo"
        },
        "scope": {
          "any": [
            {
              "all": []
            }
          ]
        },
        "valid": {
          "from": "2031-03-09T16:00:00.000Z",
          "to": null
        }
      }
    ],
    "status": "active"
  }
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "delivery/serialization",
  "subtype": "state_filter_or_assembly",
  "missing_trace": [
    {
      "event": "pilot-refinement-L06-W2/e1",
      "stage": "delivery/serialization",
      "subtype": "state_filter_or_assembly",
      "turn": "b1-focal"
    }
  ],
  "extraction_cache": "ad88b8ae5759c8d1af6517c031d9a891562a890fe90b45eb1f92444aeb4eb36f.json",
  "admitted_focal_events": [
    {
      "change_type": "initial",
      "claims": [
        {
          "field": "value",
          "value": {
            "text": "r-mavo",
            "type": "Text"
          }
        },
        {
          "field": "approval",
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        {
          "field": "cap",
          "value": {
            "decimal": "148",
            "type": "Quantity",
            "unit": "requests/day"
          }
        }
      ],
      "commitment": "adopted",
      "context": null,
      "effective_interval": {
        "from": "2031-03-06T16:00:00.000Z",
        "to": null
      },
      "event_id": "e1",
      "field_mask": [
        "value",
        "approval",
        "cap"
      ],
      "kind": "decision",
      "observed_at": "2031-03-07T02:00:00.000Z",
      "payload": {
        "approval": {
          "anchors": [
            {
              "end": 45,
              "occurrence": 1,
              "quote": "需經核准 = 是",
              "start": 37,
              "turn_id": "b1-focal"
            }
          ],
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        "cap": {
          "anchors": [
            {
              "end": 71,
              "occurrence": 1,
              "quote": "每日請求上限 = 148 requests/day",
              "start": 46,
              "turn_id": "b1-focal"
            }
          ],
          "value": {
            "decimal": "148",
            "type": "Quantity",
            "unit": "requests/day"
          }
        },
        "route": {
          "anchors": [
            {
              "end": 36,
              "occurrence": 1,
              "quote": "路線 = r-mavo",
              "start": 25,
              "turn_id": "b1-focal"
            }
          ],
          "value": {
            "text": "r-mavo",
            "type": "Text"
          }
        },
        "type": "slots"
      },
      "predecessor_anchors": [],
      "predicate": "dispatch configuration",
      "reason_quotes": [],
      "replacement_extent": "entire_predecessor",
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "source_quotes": [
        {
          "end": 158,
          "occurrence": 1,
          "quote": "我們採用lumiu服務的派送設定，路線 = r-mavo，需經核准 = 是，每日請求上限 = 148 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-06T16:00:00.000Z, 無上限（不含終點）)",
          "start": 8,
          "turn_id": "b1-focal"
        },
        {
          "end": 36,
          "occurrence": 1,
          "quote": "路線 = r-mavo",
          "start": 25,
          "turn_id": "b1-focal"
        },
        {
          "end": 45,
          "occurrence": 1,
          "quote": "需經核准 = 是",
          "start": 37,
          "turn_id": "b1-focal"
        },
        {
          "end": 71,
          "occurrence": 1,
          "quote": "每日請求上限 = 148 requests/day",
          "start": 46,
          "turn_id": "b1-focal"
        }
      ],
      "source_turns": [
        "b1-focal"
      ],
      "subject": "lumiu service"
    }
  ],
  "rejected": [],
  "budget_trace": {
    "stem": "pilot-refinement-L06-W2-T-4",
    "initial_state_record": {
      "change_type": "initial",
      "commitment": "adopted",
      "context": null,
      "fields": [
        {
          "field": "approval",
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        {
          "field": "cap",
          "value": {
            "decimal": "148",
            "type": "Quantity",
            "unit": "requests/day"
          }
        },
        {
          "field": "value",
          "value": {
            "text": "r-mavo",
            "type": "Text"
          }
        }
      ],
      "id": "[\"pilot-refinement-L06-W2\",1,\"e1\"]",
      "kind": "decision",
      "link_errors": [],
      "predecessors": [],
      "predicate": "dispatch configuration",
      "receipts": [
        {
          "end": 158,
          "occurrence": 1,
          "quote": "我們採用lumiu服務的派送設定，路線 = r-mavo，需經核准 = 是，每日請求上限 = 148 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-06T16:00:00.000Z, 無上限（不含終點）)",
          "start": 8,
          "turn_id": "b1-focal"
        },
        {
          "end": 36,
          "occurrence": 1,
          "quote": "路線 = r-mavo",
          "start": 25,
          "turn_id": "b1-focal"
        },
        {
          "end": 45,
          "occurrence": 1,
          "quote": "需經核准 = 是",
          "start": 37,
          "turn_id": "b1-focal"
        },
        {
          "end": 71,
          "occurrence": 1,
          "quote": "每日請求上限 = 148 requests/day",
          "start": 46,
          "turn_id": "b1-focal"
        }
      ],
      "scope": {
        "any": [
          {
            "all": []
          }
        ]
      },
      "status": "active",
      "subject": "lumiu service",
      "supporting_events": [
        "[\"pilot-refinement-L06-W2\",1,\"e1\"]"
      ],
      "unresolved": false,
      "valid": {
        "from": "2031-03-06T16:00:00.000Z",
        "to": null
      }
    },
    "dropped": {
      "current": [
        {
          "id": "r10:{\"any\":[{\"all\":[]}]}",
          "reason": "whole_record_budget",
          "tokens": 159
        },
        {
          "id": "r1:{\"any\":[{\"all\":[]}]}",
          "reason": "whole_record_budget",
          "tokens": 301
        }
      ],
      "history": []
    }
  }
}
```

The saved initial r1 is admitted and still in queryable state, but the ranking/assembly diagnostics explicitly drop r1 for whole_record_budget. Both current inherited slots and the requested predecessor require its route/approval. This is the same single-budget mechanism affecting two components, not four independent retrieval failures.

Example 17: `pilot-refinement-L06-W2-T-4.json`, O; **delivery/serialization / state_filter_or_assembly**.

Exact answer fragment:
```json
{
  "records": [
    {
      "predecessor_turn": "b2-focal",
      "rows": [
        {
          "approval": {
            "state": "not_specified",
            "value": null
          },
          "cap": {
            "state": "value",
            "value": {
              "decimal": "168",
              "unit": "requests/day"
            }
          },
          "citations": [
            {
              "intent": "history",
              "item": 0,
              "occurrence": 1,
              "quote": "針對紀錄 biso，保留派送路線及所有未點名的欄位。採用紀錄 kavo，部分修訂lumiu服務的派送設定：只改每日請求上限 = 168 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-07T16:00:00.000Z, 無上限（不含終點）)，終點不含在內。",
              "source": null,
              "unit": "body"
            },
            {
              "intent": "history",
              "item": 0,
              "occurrence": 2,
              "quote": "biso",
              "source": null,
              "unit": "body"
            },
            {
              "intent": "history",
              "item": 0,
              "occurrence": 3,
              "quote": "每日請求上限 = 168 requests/day",
              "source": null,
              "unit": "body"
            }
          ],
          "route": {
            "state": "value",
            "value": "biso"
          },
          "scope": {
            "any": [
              {
                "all": [
                  {
                    "field": "country",
                    "values": [
                      "TW",
                      "JP",
                      "US"
                    ]
                  },
                  {
                    "field": "plan",
                    "values": [
                      "free",
                      "pro"
                    ]
                  },
                  {
                    "field": "channel",
                    "values": [
                      "web",
                      "app"
                    ]
                  }
                ]
              }
            ]
          },
          "valid": {
            "from": "2031-03-07T16:00:00.000Z",
            "to": null
          }
        }
      ],
      "status": "previously_adopted"
    }
  ],
  "status": "available"
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 3,
    "body": "{\"change_type\":\"refinement\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r16\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"cap\":{\"decimal\":\"188\",\"unit\":\"requests/day\"},\"route\":\"hura\"},\"sources\":[\"b4-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-09T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "針對紀錄 kavo，保留派送路線及所有未點名的欄位。採用紀錄 hura，部分修訂lumiu服務的派送設定：只改每日請求上限 = 188 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-09T16:00:00.000Z, 無上限（不含終點）)，終點不含在內。",
        "index": 0,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "採用紀錄 hura",
        "index": 1,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "只改每日請求上限 = 188 requests/day",
        "index": 2,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為延遲增加，站點 f327a03e79，所以造成備援不足，站點 d885eb17d6。",
        "index": 3,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為備援不足，站點 d885eb17d6，所以造成這次決定變更。",
        "index": 4,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為處理超時，站點 ce3bc7dc60，所以造成佇列壅塞，站點 48b468e058。",
        "index": 5,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 48b468e058，所以造成這次決定變更。",
        "index": 6,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "上述兩條經過中介的路徑，任一條都足以促成這次變更。",
        "index": 7,
        "source_turn": "b4-focal"
      }
    ]
  },
  {
    "intent": "current",
    "item": 5,
    "body": "{\"change_type\":\"refinement\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r6\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"cap\":{\"decimal\":\"168\",\"unit\":\"requests/day\"},\"route\":\"biso\"},\"sources\":[\"b2-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-07T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "針對紀錄 biso，保留派送路線及所有未點名的欄位。採用紀錄 kavo，部分修訂lumiu服務的派送設定：只改每日請求上限 = 168 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-07T16:00:00.000Z, 無上限（不含終點）)，終點不含在內。",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "biso",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "每日請求上限 = 168 requests/day",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為延遲增加，站點 f327a03e79，所以造成備援不足，站點 d885eb17d6。",
        "index": 3,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為備援不足，站點 d885eb17d6，所以造成這次決定變更。",
        "index": 4,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為處理超時，站點 ce3bc7dc60，所以造成佇列壅塞，站點 48b468e058。",
        "index": 5,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 48b468e058，所以造成這次決定變更。",
        "index": 6,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "上述兩條經過中介的路徑，任一條都足以促成這次變更。",
        "index": 7,
        "source_turn": "b2-focal"
      }
    ]
  },
  {
    "intent": "history",
    "item": 0,
    "body": "Independent invoice procedure\nIndependent invoice control: invoice seal Q is required. This assertion concerns invoices only.",
    "sources": []
  }
]
```

Exact gold fragment:
```json
{
  "old": {
    "records": [
      {
        "predecessor_turn": "b2-focal",
        "rows": [
          {
            "approval": {
              "state": "value",
              "value": true
            },
            "cap": {
              "state": "value",
              "value": {
                "decimal": "168",
                "unit": "requests/day"
              }
            },
            "citations": [],
            "route": {
              "state": "value",
              "value": "r-mavo"
            },
            "scope": {
              "any": [
                {
                  "all": []
                }
              ]
            },
            "valid": {
              "from": "2031-03-07T16:00:00.000Z",
              "to": null
            }
          }
        ],
        "status": "previously_adopted"
      }
    ],
    "status": "available"
  }
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "delivery/serialization",
  "subtype": "state_filter_or_assembly",
  "missing_trace": [
    {
      "event": "pilot-refinement-L06-W2/e1",
      "stage": "delivery/serialization",
      "subtype": "state_filter_or_assembly",
      "turn": "b1-focal"
    }
  ],
  "extraction_cache": "ad88b8ae5759c8d1af6517c031d9a891562a890fe90b45eb1f92444aeb4eb36f.json",
  "admitted_focal_events": [
    {
      "change_type": "initial",
      "claims": [
        {
          "field": "value",
          "value": {
            "text": "r-mavo",
            "type": "Text"
          }
        },
        {
          "field": "approval",
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        {
          "field": "cap",
          "value": {
            "decimal": "148",
            "type": "Quantity",
            "unit": "requests/day"
          }
        }
      ],
      "commitment": "adopted",
      "context": null,
      "effective_interval": {
        "from": "2031-03-06T16:00:00.000Z",
        "to": null
      },
      "event_id": "e1",
      "field_mask": [
        "value",
        "approval",
        "cap"
      ],
      "kind": "decision",
      "observed_at": "2031-03-07T02:00:00.000Z",
      "payload": {
        "approval": {
          "anchors": [
            {
              "end": 45,
              "occurrence": 1,
              "quote": "需經核准 = 是",
              "start": 37,
              "turn_id": "b1-focal"
            }
          ],
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        "cap": {
          "anchors": [
            {
              "end": 71,
              "occurrence": 1,
              "quote": "每日請求上限 = 148 requests/day",
              "start": 46,
              "turn_id": "b1-focal"
            }
          ],
          "value": {
            "decimal": "148",
            "type": "Quantity",
            "unit": "requests/day"
          }
        },
        "route": {
          "anchors": [
            {
              "end": 36,
              "occurrence": 1,
              "quote": "路線 = r-mavo",
              "start": 25,
              "turn_id": "b1-focal"
            }
          ],
          "value": {
            "text": "r-mavo",
            "type": "Text"
          }
        },
        "type": "slots"
      },
      "predecessor_anchors": [],
      "predicate": "dispatch configuration",
      "reason_quotes": [],
      "replacement_extent": "entire_predecessor",
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "source_quotes": [
        {
          "end": 158,
          "occurrence": 1,
          "quote": "我們採用lumiu服務的派送設定，路線 = r-mavo，需經核准 = 是，每日請求上限 = 148 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-06T16:00:00.000Z, 無上限（不含終點）)",
          "start": 8,
          "turn_id": "b1-focal"
        },
        {
          "end": 36,
          "occurrence": 1,
          "quote": "路線 = r-mavo",
          "start": 25,
          "turn_id": "b1-focal"
        },
        {
          "end": 45,
          "occurrence": 1,
          "quote": "需經核准 = 是",
          "start": 37,
          "turn_id": "b1-focal"
        },
        {
          "end": 71,
          "occurrence": 1,
          "quote": "每日請求上限 = 148 requests/day",
          "start": 46,
          "turn_id": "b1-focal"
        }
      ],
      "source_turns": [
        "b1-focal"
      ],
      "subject": "lumiu service"
    }
  ],
  "rejected": [],
  "budget_trace": {
    "stem": "pilot-refinement-L06-W2-T-4",
    "initial_state_record": {
      "change_type": "initial",
      "commitment": "adopted",
      "context": null,
      "fields": [
        {
          "field": "approval",
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        {
          "field": "cap",
          "value": {
            "decimal": "148",
            "type": "Quantity",
            "unit": "requests/day"
          }
        },
        {
          "field": "value",
          "value": {
            "text": "r-mavo",
            "type": "Text"
          }
        }
      ],
      "id": "[\"pilot-refinement-L06-W2\",1,\"e1\"]",
      "kind": "decision",
      "link_errors": [],
      "predecessors": [],
      "predicate": "dispatch configuration",
      "receipts": [
        {
          "end": 158,
          "occurrence": 1,
          "quote": "我們採用lumiu服務的派送設定，路線 = r-mavo，需經核准 = 是，每日請求上限 = 148 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-06T16:00:00.000Z, 無上限（不含終點）)",
          "start": 8,
          "turn_id": "b1-focal"
        },
        {
          "end": 36,
          "occurrence": 1,
          "quote": "路線 = r-mavo",
          "start": 25,
          "turn_id": "b1-focal"
        },
        {
          "end": 45,
          "occurrence": 1,
          "quote": "需經核准 = 是",
          "start": 37,
          "turn_id": "b1-focal"
        },
        {
          "end": 71,
          "occurrence": 1,
          "quote": "每日請求上限 = 148 requests/day",
          "start": 46,
          "turn_id": "b1-focal"
        }
      ],
      "scope": {
        "any": [
          {
            "all": []
          }
        ]
      },
      "status": "active",
      "subject": "lumiu service",
      "supporting_events": [
        "[\"pilot-refinement-L06-W2\",1,\"e1\"]"
      ],
      "unresolved": false,
      "valid": {
        "from": "2031-03-06T16:00:00.000Z",
        "to": null
      }
    },
    "dropped": {
      "current": [
        {
          "id": "r10:{\"any\":[{\"all\":[]}]}",
          "reason": "whole_record_budget",
          "tokens": 159
        },
        {
          "id": "r1:{\"any\":[{\"all\":[]}]}",
          "reason": "whole_record_budget",
          "tokens": 301
        }
      ],
      "history": []
    }
  }
}
```

The saved initial r1 is admitted and still in queryable state, but the ranking/assembly diagnostics explicitly drop r1 for whole_record_budget. Both current inherited slots and the requested predecessor require its route/approval. This is the same single-budget mechanism affecting two components, not four independent retrieval failures.

Example 18: `pilot-refinement-L06-W2-O-4.json`, C; **delivery/serialization / policy_retention_or_assembly**.

Exact answer fragment:
```json
{
  "rows": [
    {
      "approval": {
        "state": "not_specified",
        "value": null
      },
      "cap": {
        "state": "value",
        "value": {
          "decimal": "188",
          "unit": "requests/day"
        }
      },
      "citations": [
        {
          "intent": "current",
          "item": 4,
          "occurrence": 1,
          "quote": "針對紀錄 kavo，保留派送路線及所有未點名的欄位。採用紀錄 hura，部分修訂lumiu服務的派送設定：只改每日請求上限 = 188 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-09T16:00:00.000Z, 無上限（不含終點）)，終點不含在內。",
          "source": null,
          "unit": "body"
        }
      ],
      "route": {
        "state": "not_specified",
        "value": null
      },
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "valid": {
        "from": "2031-03-09T16:00:00.000Z",
        "to": null
      }
    }
  ],
  "status": "unresolved"
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 3,
    "body": "{\"change_type\":\"refinement\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r16\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"cap\":{\"decimal\":\"188\",\"unit\":\"requests/day\"},\"route\":\"hura\"},\"sources\":[\"b4-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-09T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "針對紀錄 kavo，保留派送路線及所有未點名的欄位。採用紀錄 hura，部分修訂lumiu服務的派送設定：只改每日請求上限 = 188 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-09T16:00:00.000Z, 無上限（不含終點）)，終點不含在內。",
        "index": 0,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "採用紀錄 hura",
        "index": 1,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "只改每日請求上限 = 188 requests/day",
        "index": 2,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為延遲增加，站點 f327a03e79，所以造成備援不足，站點 d885eb17d6。",
        "index": 3,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為備援不足，站點 d885eb17d6，所以造成這次決定變更。",
        "index": 4,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為處理超時，站點 ce3bc7dc60，所以造成佇列壅塞，站點 48b468e058。",
        "index": 5,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 48b468e058，所以造成這次決定變更。",
        "index": 6,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "上述兩條經過中介的路徑，任一條都足以促成這次變更。",
        "index": 7,
        "source_turn": "b4-focal"
      }
    ]
  },
  {
    "intent": "current",
    "item": 4,
    "body": "{\"change_type\":\"initial\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r10\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"route\":\"s-mavo\"},\"sources\":[\"b2-distractor\"],\"status\":\"active\",\"subject\":\"lumiu service Annex\",\"valid\":{\"from\":null,\"to\":null}}",
    "sources": [
      {
        "excerpt": "另一個無關的服務lumiu服務 Annex使用 s-mavo。",
        "index": 0,
        "source_turn": "b2-distractor"
      },
      {
        "excerpt": "另一個無關的服務lumiu服務 Annex使用 s-mavo",
        "index": 1,
        "source_turn": "b2-distractor"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "current": {
    "rows": [
      {
        "approval": {
          "state": "value",
          "value": true
        },
        "cap": {
          "state": "value",
          "value": {
            "decimal": "188",
            "unit": "requests/day"
          }
        },
        "citations": [],
        "route": {
          "state": "value",
          "value": "r-mavo"
        },
        "scope": {
          "any": [
            {
              "all": []
            }
          ]
        },
        "valid": {
          "from": "2031-03-09T16:00:00.000Z",
          "to": null
        }
      }
    ],
    "status": "active"
  }
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "delivery/serialization",
  "subtype": "policy_retention_or_assembly",
  "missing_trace": [
    {
      "event": "pilot-refinement-L06-W2/e1",
      "stage": "delivery/serialization",
      "subtype": "policy_retention_or_assembly",
      "turn": "b1-focal"
    }
  ],
  "extraction_cache": "ad88b8ae5759c8d1af6517c031d9a891562a890fe90b45eb1f92444aeb4eb36f.json",
  "admitted_focal_events": [
    {
      "change_type": "initial",
      "claims": [
        {
          "field": "value",
          "value": {
            "text": "r-mavo",
            "type": "Text"
          }
        },
        {
          "field": "approval",
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        {
          "field": "cap",
          "value": {
            "decimal": "148",
            "type": "Quantity",
            "unit": "requests/day"
          }
        }
      ],
      "commitment": "adopted",
      "context": null,
      "effective_interval": {
        "from": "2031-03-06T16:00:00.000Z",
        "to": null
      },
      "event_id": "e1",
      "field_mask": [
        "value",
        "approval",
        "cap"
      ],
      "kind": "decision",
      "observed_at": "2031-03-07T02:00:00.000Z",
      "payload": {
        "approval": {
          "anchors": [
            {
              "end": 45,
              "occurrence": 1,
              "quote": "需經核准 = 是",
              "start": 37,
              "turn_id": "b1-focal"
            }
          ],
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        "cap": {
          "anchors": [
            {
              "end": 71,
              "occurrence": 1,
              "quote": "每日請求上限 = 148 requests/day",
              "start": 46,
              "turn_id": "b1-focal"
            }
          ],
          "value": {
            "decimal": "148",
            "type": "Quantity",
            "unit": "requests/day"
          }
        },
        "route": {
          "anchors": [
            {
              "end": 36,
              "occurrence": 1,
              "quote": "路線 = r-mavo",
              "start": 25,
              "turn_id": "b1-focal"
            }
          ],
          "value": {
            "text": "r-mavo",
            "type": "Text"
          }
        },
        "type": "slots"
      },
      "predecessor_anchors": [],
      "predicate": "dispatch configuration",
      "reason_quotes": [],
      "replacement_extent": "entire_predecessor",
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "source_quotes": [
        {
          "end": 158,
          "occurrence": 1,
          "quote": "我們採用lumiu服務的派送設定，路線 = r-mavo，需經核准 = 是，每日請求上限 = 148 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-06T16:00:00.000Z, 無上限（不含終點）)",
          "start": 8,
          "turn_id": "b1-focal"
        },
        {
          "end": 36,
          "occurrence": 1,
          "quote": "路線 = r-mavo",
          "start": 25,
          "turn_id": "b1-focal"
        },
        {
          "end": 45,
          "occurrence": 1,
          "quote": "需經核准 = 是",
          "start": 37,
          "turn_id": "b1-focal"
        },
        {
          "end": 71,
          "occurrence": 1,
          "quote": "每日請求上限 = 148 requests/day",
          "start": 46,
          "turn_id": "b1-focal"
        }
      ],
      "source_turns": [
        "b1-focal"
      ],
      "subject": "lumiu service"
    }
  ],
  "rejected": [],
  "budget_trace": {
    "stem": "pilot-refinement-L06-W2-O-4",
    "initial_state_record": {
      "change_type": "initial",
      "commitment": "adopted",
      "context": null,
      "fields": [
        {
          "field": "value",
          "value": {
            "text": "r-mavo",
            "type": "Text"
          }
        },
        {
          "field": "approval",
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        {
          "field": "cap",
          "value": {
            "decimal": "148",
            "type": "Quantity",
            "unit": "requests/day"
          }
        }
      ],
      "id": "[\"pilot-refinement-L06-W2\",1,\"e1\"]",
      "kind": "decision",
      "link_errors": [],
      "predecessors": [],
      "predicate": "dispatch configuration",
      "receipts": [
        {
          "end": 158,
          "occurrence": 1,
          "quote": "我們採用lumiu服務的派送設定，路線 = r-mavo，需經核准 = 是，每日請求上限 = 148 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-06T16:00:00.000Z, 無上限（不含終點）)",
          "start": 8,
          "turn_id": "b1-focal"
        },
        {
          "end": 36,
          "occurrence": 1,
          "quote": "路線 = r-mavo",
          "start": 25,
          "turn_id": "b1-focal"
        },
        {
          "end": 45,
          "occurrence": 1,
          "quote": "需經核准 = 是",
          "start": 37,
          "turn_id": "b1-focal"
        },
        {
          "end": 71,
          "occurrence": 1,
          "quote": "每日請求上限 = 148 requests/day",
          "start": 46,
          "turn_id": "b1-focal"
        }
      ],
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "status": "active",
      "subject": "lumiu service",
      "supporting_events": [
        "[\"pilot-refinement-L06-W2\",1,\"e1\"]"
      ],
      "unresolved": false,
      "valid": {
        "from": "2031-03-06T16:00:00.000Z",
        "to": null
      }
    },
    "dropped": {
      "current": [
        {
          "id": "r4:{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]}",
          "reason": "whole_record_budget",
          "tokens": 197
        },
        {
          "id": "r1:{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]}",
          "reason": "whole_record_budget",
          "tokens": 345
        }
      ],
      "history": []
    }
  }
}
```

The saved initial r1 is admitted and still in queryable state, but the ranking/assembly diagnostics explicitly drop r1 for whole_record_budget. Both current inherited slots and the requested predecessor require its route/approval. This is the same single-budget mechanism affecting two components, not four independent retrieval failures.

Example 19: `pilot-refinement-L06-W2-O-4.json`, O; **delivery/serialization / policy_retention_or_assembly**.

Exact answer fragment:
```json
{
  "records": [
    {
      "predecessor_turn": "b2-focal",
      "rows": [
        {
          "approval": {
            "state": "not_specified",
            "value": null
          },
          "cap": {
            "state": "value",
            "value": {
              "decimal": "168",
              "unit": "requests/day"
            }
          },
          "citations": [
            {
              "intent": "current",
              "item": 5,
              "occurrence": 1,
              "quote": "針對紀錄 biso，保留派送路線及所有未點名的欄位。採用紀錄 kavo，部分修訂lumiu服務的派送設定：只改每日請求上限 = 168 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-07T16:00:00.000Z, 無上限（不含終點）)，終點不含在內。",
              "source": null,
              "unit": "body"
            }
          ],
          "route": {
            "state": "not_specified",
            "value": null
          },
          "scope": {
            "any": [
              {
                "all": [
                  {
                    "field": "country",
                    "values": [
                      "TW",
                      "JP",
                      "US"
                    ]
                  },
                  {
                    "field": "plan",
                    "values": [
                      "free",
                      "pro"
                    ]
                  },
                  {
                    "field": "channel",
                    "values": [
                      "web",
                      "app"
                    ]
                  }
                ]
              }
            ]
          },
          "valid": {
            "from": "2031-03-07T16:00:00.000Z",
            "to": null
          }
        }
      ],
      "status": "unresolved"
    }
  ],
  "status": "available"
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 3,
    "body": "{\"change_type\":\"refinement\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r16\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"cap\":{\"decimal\":\"188\",\"unit\":\"requests/day\"},\"route\":\"hura\"},\"sources\":[\"b4-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-09T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "針對紀錄 kavo，保留派送路線及所有未點名的欄位。採用紀錄 hura，部分修訂lumiu服務的派送設定：只改每日請求上限 = 188 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-09T16:00:00.000Z, 無上限（不含終點）)，終點不含在內。",
        "index": 0,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "採用紀錄 hura",
        "index": 1,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "只改每日請求上限 = 188 requests/day",
        "index": 2,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為延遲增加，站點 f327a03e79，所以造成備援不足，站點 d885eb17d6。",
        "index": 3,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為備援不足，站點 d885eb17d6，所以造成這次決定變更。",
        "index": 4,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為處理超時，站點 ce3bc7dc60，所以造成佇列壅塞，站點 48b468e058。",
        "index": 5,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 48b468e058，所以造成這次決定變更。",
        "index": 6,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "上述兩條經過中介的路徑，任一條都足以促成這次變更。",
        "index": 7,
        "source_turn": "b4-focal"
      }
    ]
  },
  {
    "intent": "current",
    "item": 5,
    "body": "{\"change_type\":\"refinement\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r6\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"cap\":{\"decimal\":\"168\",\"unit\":\"requests/day\"},\"route\":\"biso\"},\"sources\":[\"b2-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-07T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "針對紀錄 biso，保留派送路線及所有未點名的欄位。採用紀錄 kavo，部分修訂lumiu服務的派送設定：只改每日請求上限 = 168 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-07T16:00:00.000Z, 無上限（不含終點）)，終點不含在內。",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "biso",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "每日請求上限 = 168 requests/day",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為延遲增加，站點 f327a03e79，所以造成備援不足，站點 d885eb17d6。",
        "index": 3,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為備援不足，站點 d885eb17d6，所以造成這次決定變更。",
        "index": 4,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為處理超時，站點 ce3bc7dc60，所以造成佇列壅塞，站點 48b468e058。",
        "index": 5,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 48b468e058，所以造成這次決定變更。",
        "index": 6,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "上述兩條經過中介的路徑，任一條都足以促成這次變更。",
        "index": 7,
        "source_turn": "b2-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "old": {
    "records": [
      {
        "predecessor_turn": "b2-focal",
        "rows": [
          {
            "approval": {
              "state": "value",
              "value": true
            },
            "cap": {
              "state": "value",
              "value": {
                "decimal": "168",
                "unit": "requests/day"
              }
            },
            "citations": [],
            "route": {
              "state": "value",
              "value": "r-mavo"
            },
            "scope": {
              "any": [
                {
                  "all": []
                }
              ]
            },
            "valid": {
              "from": "2031-03-07T16:00:00.000Z",
              "to": null
            }
          }
        ],
        "status": "previously_adopted"
      }
    ],
    "status": "available"
  }
}
```

Deterministic trace:
```json
{
  "saved_score": 0,
  "primary": "delivery/serialization",
  "subtype": "policy_retention_or_assembly",
  "missing_trace": [
    {
      "event": "pilot-refinement-L06-W2/e1",
      "stage": "delivery/serialization",
      "subtype": "policy_retention_or_assembly",
      "turn": "b1-focal"
    }
  ],
  "extraction_cache": "ad88b8ae5759c8d1af6517c031d9a891562a890fe90b45eb1f92444aeb4eb36f.json",
  "admitted_focal_events": [
    {
      "change_type": "initial",
      "claims": [
        {
          "field": "value",
          "value": {
            "text": "r-mavo",
            "type": "Text"
          }
        },
        {
          "field": "approval",
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        {
          "field": "cap",
          "value": {
            "decimal": "148",
            "type": "Quantity",
            "unit": "requests/day"
          }
        }
      ],
      "commitment": "adopted",
      "context": null,
      "effective_interval": {
        "from": "2031-03-06T16:00:00.000Z",
        "to": null
      },
      "event_id": "e1",
      "field_mask": [
        "value",
        "approval",
        "cap"
      ],
      "kind": "decision",
      "observed_at": "2031-03-07T02:00:00.000Z",
      "payload": {
        "approval": {
          "anchors": [
            {
              "end": 45,
              "occurrence": 1,
              "quote": "需經核准 = 是",
              "start": 37,
              "turn_id": "b1-focal"
            }
          ],
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        "cap": {
          "anchors": [
            {
              "end": 71,
              "occurrence": 1,
              "quote": "每日請求上限 = 148 requests/day",
              "start": 46,
              "turn_id": "b1-focal"
            }
          ],
          "value": {
            "decimal": "148",
            "type": "Quantity",
            "unit": "requests/day"
          }
        },
        "route": {
          "anchors": [
            {
              "end": 36,
              "occurrence": 1,
              "quote": "路線 = r-mavo",
              "start": 25,
              "turn_id": "b1-focal"
            }
          ],
          "value": {
            "text": "r-mavo",
            "type": "Text"
          }
        },
        "type": "slots"
      },
      "predecessor_anchors": [],
      "predicate": "dispatch configuration",
      "reason_quotes": [],
      "replacement_extent": "entire_predecessor",
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "source_quotes": [
        {
          "end": 158,
          "occurrence": 1,
          "quote": "我們採用lumiu服務的派送設定，路線 = r-mavo，需經核准 = 是，每日請求上限 = 148 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-06T16:00:00.000Z, 無上限（不含終點）)",
          "start": 8,
          "turn_id": "b1-focal"
        },
        {
          "end": 36,
          "occurrence": 1,
          "quote": "路線 = r-mavo",
          "start": 25,
          "turn_id": "b1-focal"
        },
        {
          "end": 45,
          "occurrence": 1,
          "quote": "需經核准 = 是",
          "start": 37,
          "turn_id": "b1-focal"
        },
        {
          "end": 71,
          "occurrence": 1,
          "quote": "每日請求上限 = 148 requests/day",
          "start": 46,
          "turn_id": "b1-focal"
        }
      ],
      "source_turns": [
        "b1-focal"
      ],
      "subject": "lumiu service"
    }
  ],
  "rejected": [],
  "budget_trace": {
    "stem": "pilot-refinement-L06-W2-O-4",
    "initial_state_record": {
      "change_type": "initial",
      "commitment": "adopted",
      "context": null,
      "fields": [
        {
          "field": "value",
          "value": {
            "text": "r-mavo",
            "type": "Text"
          }
        },
        {
          "field": "approval",
          "value": {
            "type": "Boolean",
            "value": true
          }
        },
        {
          "field": "cap",
          "value": {
            "decimal": "148",
            "type": "Quantity",
            "unit": "requests/day"
          }
        }
      ],
      "id": "[\"pilot-refinement-L06-W2\",1,\"e1\"]",
      "kind": "decision",
      "link_errors": [],
      "predecessors": [],
      "predicate": "dispatch configuration",
      "receipts": [
        {
          "end": 158,
          "occurrence": 1,
          "quote": "我們採用lumiu服務的派送設定，路線 = r-mavo，需經核准 = 是，每日請求上限 = 148 requests/day。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-06T16:00:00.000Z, 無上限（不含終點）)",
          "start": 8,
          "turn_id": "b1-focal"
        },
        {
          "end": 36,
          "occurrence": 1,
          "quote": "路線 = r-mavo",
          "start": 25,
          "turn_id": "b1-focal"
        },
        {
          "end": 45,
          "occurrence": 1,
          "quote": "需經核准 = 是",
          "start": 37,
          "turn_id": "b1-focal"
        },
        {
          "end": 71,
          "occurrence": 1,
          "quote": "每日請求上限 = 148 requests/day",
          "start": 46,
          "turn_id": "b1-focal"
        }
      ],
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "status": "active",
      "subject": "lumiu service",
      "supporting_events": [
        "[\"pilot-refinement-L06-W2\",1,\"e1\"]"
      ],
      "unresolved": false,
      "valid": {
        "from": "2031-03-06T16:00:00.000Z",
        "to": null
      }
    },
    "dropped": {
      "current": [
        {
          "id": "r4:{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]}",
          "reason": "whole_record_budget",
          "tokens": 197
        },
        {
          "id": "r1:{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]}",
          "reason": "whole_record_budget",
          "tokens": 345
        }
      ],
      "history": []
    }
  }
}
```

The saved initial r1 is admitted and still in queryable state, but the ranking/assembly diagnostics explicitly drop r1 for whole_record_budget. Both current inherited slots and the requested predecessor require its route/approval. This is the same single-budget mechanism affecting two components, not four independent retrieval failures.

Example 20: `pilot-correction-L01-W1-T-4.json`, C; **correct / recorded_pass**.

Exact answer fragment:
```json
{
  "rows": [
    {
      "approval": {
        "state": "value",
        "value": true
      },
      "cap": {
        "state": "not_specified",
        "value": null
      },
      "citations": [
        {
          "intent": "current",
          "item": 1,
          "occurrence": 1,
          "quote": "更正紀錄 zemi：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 biso 更正這個單一斷言：lumiu服務的派送設定，路線 = t-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-03T16:00:00.000Z, 無上限（不含終點）)",
          "source": null,
          "unit": "body"
        }
      ],
      "route": {
        "state": "value",
        "value": "t-mavo"
      },
      "scope": {
        "any": [
          {
            "all": [
              {
                "field": "country",
                "values": [
                  "TW",
                  "JP",
                  "US"
                ]
              },
              {
                "field": "plan",
                "values": [
                  "free",
                  "pro"
                ]
              },
              {
                "field": "channel",
                "values": [
                  "web",
                  "app"
                ]
              }
            ]
          }
        ]
      },
      "valid": {
        "from": "2031-03-03T16:00:00.000Z",
        "to": null
      }
    }
  ],
  "status": "active"
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 1,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r7\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"t-mavo\"},\"sources\":[\"b4-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-03T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "更正紀錄 zemi：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 biso 更正這個單一斷言：lumiu服務的派送設定，路線 = t-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-03T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "路線 = t-mavo",
        "index": 1,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "佇列壅塞，站點 477f922dcb",
        "index": 3,
        "source_turn": "b4-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "index": 4,
        "source_turn": "b4-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "current": {
    "rows": [
      {
        "approval": {
          "state": "value",
          "value": true
        },
        "cap": {
          "state": "not_specified",
          "value": null
        },
        "citations": [],
        "route": {
          "state": "value",
          "value": "t-mavo"
        },
        "scope": {
          "any": [
            {
              "all": []
            }
          ]
        },
        "valid": {
          "from": "2031-03-03T16:00:00.000Z",
          "to": null
        }
      }
    ],
    "status": "active"
  }
}
```

Deterministic trace:
```json
{
  "saved_score": 1,
  "primary": "correct",
  "subtype": "recorded_pass"
}
```

This is an actual recorded pass; no failure stage is assigned. It supplies a positive control for the census.

Example 21: `pilot-correction-L01-W1-U-2.json`, O; **correct / recorded_pass**.

Exact answer fragment:
```json
{
  "records": [
    {
      "predecessor_turn": "b1-focal",
      "rows": [
        {
          "approval": {
            "state": "value",
            "value": true
          },
          "cap": {
            "state": "not_specified",
            "value": null
          },
          "citations": [
            {
              "intent": "history",
              "item": 0,
              "occurrence": 1,
              "quote": "我們採用lumiu服務的派送設定，路線 = r-mavo，需經核准 = 是。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-02-28T16:00:00.000Z, 無上限（不含終點）)",
              "source": null,
              "unit": "body"
            }
          ],
          "route": {
            "state": "value",
            "value": "r-mavo"
          },
          "scope": {
            "any": [
              {
                "all": [
                  {
                    "field": "country",
                    "values": [
                      "TW",
                      "JP",
                      "US"
                    ]
                  },
                  {
                    "field": "plan",
                    "values": [
                      "free",
                      "pro"
                    ]
                  },
                  {
                    "field": "channel",
                    "values": [
                      "web",
                      "app"
                    ]
                  }
                ]
              }
            ]
          },
          "valid": {
            "from": "2031-02-28T16:00:00.000Z",
            "to": null
          }
        }
      ],
      "status": "erroneous"
    }
  ],
  "status": "available"
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 0,
    "body": "{\"change_type\":\"initial\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r1\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"r-mavo\"},\"sources\":[\"b1-focal\"],\"status\":\"active\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-02-28T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "我們採用lumiu服務的派送設定，路線 = r-mavo，需經核准 = 是。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-02-28T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b1-focal"
      },
      {
        "excerpt": "路線 = r-mavo",
        "index": 1,
        "source_turn": "b1-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b1-focal"
      }
    ]
  },
  {
    "intent": "current",
    "item": 1,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r2\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"s-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"unresolved\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-01T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "更正紀錄 kavo：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 zemi 更正這個單一斷言：lumiu服務的派送設定，路線 = s-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-01T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = s-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "佇列壅塞，站點 477f922dcb",
        "index": 3,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "index": 4,
        "source_turn": "b2-focal"
      }
    ]
  },
  {
    "intent": "history",
    "item": 0,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r2\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"s-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"historical\",\"subject\":\"lumiu service\",\"valid\":{\"from\":\"2031-03-01T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "更正紀錄 kavo：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 zemi 更正這個單一斷言：lumiu服務的派送設定，路線 = s-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-01T16:00:00.000Z, 無上限（不含終點）)",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = s-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "佇列壅塞，站點 477f922dcb",
        "index": 3,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "因為佇列壅塞，站點 477f922dcb，所以造成這次決定變更",
        "index": 4,
        "source_turn": "b2-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "old": {
    "records": [
      {
        "predecessor_turn": "b1-focal",
        "rows": [
          {
            "approval": {
              "state": "value",
              "value": true
            },
            "cap": {
              "state": "not_specified",
              "value": null
            },
            "citations": [],
            "route": {
              "state": "value",
              "value": "r-mavo"
            },
            "scope": {
              "any": [
                {
                  "all": []
                }
              ]
            },
            "valid": {
              "from": "2031-02-28T16:00:00.000Z",
              "to": null
            }
          }
        ],
        "status": "erroneous"
      }
    ],
    "status": "available"
  }
}
```

Deterministic trace:
```json
{
  "saved_score": 1,
  "primary": "correct",
  "subtype": "recorded_pass"
}
```

This is an actual recorded pass; no failure stage is assigned. It supplies a positive control for the census.

Example 22: `pilot-correction-L02-W1-U-2.json`, R; **correct / recorded_pass**.

Exact answer fragment:
```json
{
  "status": "not_stated",
  "support": []
}
```

Exact delivered body/source fragments:
```json
[
  {
    "intent": "current",
    "item": 1,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r6\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"t-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"unresolved\",\"subject\":\"pakuu service\",\"valid\":{\"from\":\"2031-03-03T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "更正紀錄 hura：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 biso 更正這個單一斷言：pakuu服務的派送設定，路線 = t-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-03T16:00:00.000Z, 無上限（不含終點）)，終點不含在內。 這次變更沒有說明原因。",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = t-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      }
    ]
  },
  {
    "intent": "history",
    "item": 0,
    "body": "{\"change_type\":\"correction\",\"commitment\":\"adopted\",\"kind\":\"slots\",\"predicate\":\"dispatch configuration\",\"record\":\"r6\",\"scope\":{\"any\":[{\"all\":[{\"field\":\"country\",\"values\":[\"TW\",\"JP\",\"US\"]},{\"field\":\"plan\",\"values\":[\"free\",\"pro\"]},{\"field\":\"channel\",\"values\":[\"web\",\"app\"]}]}]},\"slots\":{\"approval\":true,\"route\":\"t-mavo\"},\"sources\":[\"b2-focal\"],\"status\":\"historical\",\"subject\":\"pakuu service\",\"valid\":{\"from\":\"2031-03-03T16:00:00.000Z\",\"to\":null}}",
    "sources": [
      {
        "excerpt": "更正紀錄 hura：原先記載的斷言有誤，從未是實際採用的決定。以紀錄 biso 更正這個單一斷言：pakuu服務的派送設定，路線 = t-mavo，需經核准 = 是。以上完整重述替代斷言的所有條件。適用對象：全部國家（TW、JP、US）、free/pro 方案及 web/app 通路。生效區間 [2031-03-03T16:00:00.000Z, 無上限（不含終點）)，終點不含在內。 這次變更沒有說明原因。",
        "index": 0,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "路線 = t-mavo",
        "index": 1,
        "source_turn": "b2-focal"
      },
      {
        "excerpt": "需經核准 = 是",
        "index": 2,
        "source_turn": "b2-focal"
      }
    ]
  }
]
```

Exact gold fragment:
```json
{
  "reason": {
    "status": "not_stated",
    "support": []
  },
  "acceptedGraphs": []
}
```

Deterministic trace:
```json
{
  "saved_score": 1,
  "primary": "correct",
  "subtype": "recorded_pass",
  "original_errors": [],
  "address_changes": [],
  "after_address_replay": {
    "correctness": 1,
    "support": "not_applicable",
    "verdict": 1,
    "valid": true,
    "error": null,
    "stratum": "not_stated",
    "denominator": 1,
    "noEvidenceBaseline": {
      "status": "not_stated",
      "support": [],
      "R": 1
    }
  },
  "content_witness": {
    "complete": false,
    "only": true,
    "witness": false
  },
  "complete_evidence_delivered": false
}
```

This is an actual recorded pass; no failure stage is assigned. It supplies a positive control for the census.

No worked examples are possible for undetected generator/gold defects, correct-anchor resolver failures or original scorer-mismatch primary cases, since their counts are zero. The secondary punctuation mismatch is fully worked in the citation examples. Delivery has only two independent observations; four worked component cases show their C/O effects.

**Reproduction and verification.** Run `node analyze.mjs`, then `python report.py`, from any directory. Both scripts have fixed read-only input paths and write only in this dispatch. The analysis imports the local frozen-code export, never the live workspace revision. No paid/model/API/network calls, keys, repo/run writes or broad tests were used. The workspace advanced externally to 22510a2c while analysis was running; its harness/scorer/generator files were unchanged, and the replay uses an explicit 8f1925f3 git export regardless.

| Check | Result |
| --- | --- |
| Frozen analysis script exit code | 0 |
| Exact scorer replay | 480/480 |
| Individual scores vs aggregate | 480/480 |
| Family validator | 60/60 |
| Run rglob/readdir vs independent find inventory | 2228 files, zero differences |
| Input inventory by the same two routes | 8 files, zero differences |
| Run manifest hash/byte validation | 2,227 entries; manifest itself makes 2,228 actual run files |
| Input manifest hash/byte validation | 7 entries; manifest itself makes 8 files |
| Component rows | 1440 |
| Deterministic classification SHA-256 | cb5c3660ada5640e3213b289fe91214b3e6fce085db51a72dbf6b5a1b5f021d5 |


The classification digest is computed from sorted observation/component/score/category/subtype records; a second script run is compared against it and the exact CSV/JSON outputs. `checks.txt` records actual process exit codes, determinism checks, report generation and the independently derived dispatch delivery manifest. No statistical inference, arm selection or policy tuning is claimed.
