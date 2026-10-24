# HR-3 pre-registration protocol — v0.3.4 (frozen 2026-10-25)

Frozen after six rounds of non-author audit (final verdict: ready to freeze). Executable validation, calibration and resource gates in this protocol remain required before any paid stage.

**Status.** The primary accepts the remaining P1. This version adopts the auditor’s finite-sample-rescaled bootstrap **exactly**, including its use for P intervals, paired contrasts, guards, judgment-error envelopes and power simulation. Recheck finding 1:41 (non-author audit record, private)

Resolution concerns the specification. Executable validation, calibration, resource gates and freeze approval remain pending.

This revision made no network, paid API or adjudication calls, read no credentials and changed no repository files. Independent `git status` and `git diff` checks returned **0 changed paths**. Local mathematical checks exited **0**; their scope is reported in §15.

**1. Question, scope and baseline**

Does a type-specific update policy improve accuracy on **the current decision, the previously recorded decision, and why it changed**, following real model extraction from synthetic conversations?

- **Descriptive headline:** absolute C/O/R/J accuracy of **P: the pinned product under the frozen public-operation agent and shared research extraction**. Repeat this qualification beside every P headline.
- **Sole confirmatory estimand:** final-checkpoint **J(T) − J(U)**.

The charter’s goals, synthetic-data boundary, historical baselines and separation of completion, retrieval, correctness and cost remain binding. P is pinned to main **`b2513501a6747a163ab1cefb7d37a16744c9621a`**. [Charter:8](memory-next-stage-charter.md#L8), [boundaries:37](memory-next-stage-charter.md#L37), [baselines:53](memory-next-stage-charter.md#L53)

Retain HR-2b’s frozen artifacts, explicit clusters, paired comparisons, guards, retained failures and non-author audit. Whole-item assembly stays fixed. [HR-2b protocol:261](https://github.com/Cairn-ink/cairn-memory/blob/8d9a51f592b46f83f5c95e30983f9f5a2bc1d86e/docs/plans/budgeted-assembly-hr2b.md#L261), [report:59](https://github.com/Cairn-ink/cairn-memory/blob/8d9a51f592b46f83f5c95e30983f9f5a2bc1d86e/docs/plans/budgeted-assembly-hr2b-results.md#L59)

Fixed owner decisions:

- Corrected erroneous records remain historical answers, explicitly **erroneous**, never formerly adopted decisions.
- Expiry without a successor means **`no_active_decision`**. The expired decision belongs only in history.
- Future product retention of pre-correction text is deferred until results exist.
- Adjudication is calibrated **model judgment**, not human judgment. The owner is not asked to adjudicate.

**2. Event, time and scope definitions**

Freeze executable extraction/link schemas and reducers before paid work.

Each extracted event contains:

`event_id, source_turns, observed_at, kind, commitment, change_type, subject, predicate, claims, scope, effective_interval, predecessor_anchors, replacement_extent, field_mask, reason_nodes, reason_edges, source_quotes`.

Definitions:

- Kind: fact, preference, decision, instruction or context.
- Commitment: adopted, proposed, quoted, rejected or unresolved.
- Change: initial, correction, reversal, refinement, scope_change, expiry or unchanged.
- Replacement extent: entire_predecessor, partial or unresolved, with source support.
- Resolve predecessor anchors against earlier extracted records, never gold IDs. Missing, nonunique, incompatible or historical targets produce an unresolved update.
- Sort multiple predecessors by source order; validate the complete set before a research update.
- Ingestion order: `(observed_at, batch ordinal, claim ordinal)`.
- Effective selection order: `(effective start, ingestion order)`.
- Time zone: **Asia/Taipei**, serialized as UTC. Intervals are `[from,to)`; null endpoints are unbounded. Bare dates start at local midnight; “through D” ends at midnight after D.
- Future-effective updates remain pending. Checkpoints use only already observed information.
- Expiry never reactivates an older decision; reactivation requires explicit adoption.

Scope is a disjunction of conjunctions over:

`country ∈ {TW,JP,US}`, `plan ∈ {free,pro}`, `channel ∈ {web,app}`.

Scope equality means equality over these 12 audience cells. Empty scope is invalid. Scope conclusions are limited to this domain.

Each family declares its focal change, query scope and requested predecessor set before extraction. O requests records amended by that change—not an unspecified previous record. At checkpoint two, use the first update; at checkpoint four, the declared final change.

**3. Research policies**

All arms receive identical cached extraction and permitted source quotes. Gold never selects an operation. Proposed, quoted and rejected content cannot enact decisions.

| Arm | Frozen reducer |
|---|---|
| **T: typed** | Version cells by subject, predicate, audience and field. Correction labels the assertion erroneous and applies its replacement mask. Reversal closes replaced cells. Refinement changes named fields and inherits unspecified fields. Scope change affects selected cells only. Entire replacement clears selected predecessor fields before installing supplied fields. Expiry closes cells without fallback. Retain original events, provenance and typed history. |
| **U: uniform versioning** | Append committed events and generic predecessor links. For each exact normalized subject–predicate–scope key, select the eligible maximum effective-start/ingestion-order version. An expired head yields no active value. Do not merge partial fields or overlapping scopes. Retain original evidence and uninterpreted extracted type labels. |
| **O: overwrite** | One queryable record per exact key. At activation, the latest ingestion-order update replaces its complete field map/evidence. Keep pending future records until activation; remove replaced versions from queryable history. No expiry fallback. |
| **P: product** | Public-operation agent in §4; actual product retrieval/assembly in §10. |

T groups current audience cells only when values, qualifications, intervals and supporting-event sets are identical; order cells lexicographically. U/O expose separate exact-scope heads without merged answers.

T/U retain equal original evidence. Unresolved updates are visibly unresolved. Authorization and named-record forgetting apply to every arm.

Independently authored hand-worked cases must verify correction, reversal, partial refinement, overlapping scopes, retroactive correction, future activation, expiry, multiple predecessors and unresolved links. Freeze outputs and serializer bytes.

**4. P’s public-operation agent**

P uses public core/MCP interfaces only. No SQL, internal storage helpers, hidden archive, reconstructed historical answer or research-generated merged/residual scope is permitted.

| Event | P action |
|---|---|
| Initial adopted assertion | Public core `admit`. |
| Correction | MCP `correct_memory` at the inspected revision. |
| Explicit complete withdrawal | Public core `supersede`. |
| Partial refinement/scope amendment | Admit the patch and retain its predecessor. |
| Ambiguous extent/link | Preserve records; log unresolved mapping. |
| Proposal/quotation | Never admit as a decision; context-only admission needs explicit context classification. |
| Named forget | Public forget at the inspected revision. |

Freeze examples distinguishing “replace A including X,” “keep A and X, add Y,” and “change only Taiwan customers.” Only explicit whole-predecessor withdrawal authorizes whole-record supersession.

Admission/supersession accept 1–4 receipts per call; supersession retires the entire predecessor. [contract.mjs:330](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/contract.mjs#L330), [contract.mjs:477](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/contract.mjs#L477), [supersession-storage.mjs:43](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/supersession-storage.mjs#L43)

For multiple complete withdrawals, call supersession in source order, preserving partial success/refusals without a new rollback mechanism. Select receipts chronologically and log omissions.

The formatter uses supplied assertions, qualifications and verbatim extracted reason quotes. Do not append old prose before correction. Correction overwrites content and deletes previous receipts; MCP creates its receipt from submitted content. Score actual preservation or loss. [runtime.mjs:253](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/runtime.mjs#L253), [server.mjs:519](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/adapters/mcp/server.mjs#L519)

Correction fixtures target atomic assertions and explicitly restate replacement qualifications. Extraction omissions are not repaired.

**Scheduled expiry:**

1. Register only explicit extracted deadlines applying to the target assertion.
2. Store target ID, deadline, source anchor and revision—not an answer archive.
3. Process checkpoint writes before due schedules.
4. Cancel forgotten, superseded or explicitly deadline-withdrawn targets.
5. Correction replaces the schedule from its new deadline; absent/ambiguous deadlines do not inherit hidden schedules.
6. Re-inspect identity, currentness, revision and deadline-bearing content before execution. Changed/conflicting evidence requires revalidation; otherwise leave unresolved.
7. For complete-target expiry, publicly supersede with a context record containing `no_active_decision`, subject/scope and expiry boundary, supported by the deadline source.
8. Do not retire an entire record for partial expiry. A successor cancels its predecessor’s schedule and receives only its own deadline.

Report eligibility before/after and label results **adapter-scheduled**, not native automatic expiry. No extra pre-adapter reader run is included.

Forgetting targets named records, not all independent artifacts containing similar information. Audit independent copies. Memory forgetting nulls content, removes receipts and suppresses its fingerprint. [runtime.mjs:291](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/runtime.mjs#L291), [suppression:104](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/runtime.mjs#L104)

**5. Card controls**

Control Cards concern a separate assertion, avoiding an accidental focal-answer source. Their canonical lifecycle is shared across arms; T receives no special Card archive.

Let `N` be the authorized namespace; `K={readSet:[N],roleId:"finance"}`; `M,V1,V2` returned package/version refs; `c,d,b` observed Card, dependency and binding revisions. Every mutation has a unique action ID and reviewed complete payload.

| Step | Public call |
|---|---|
| Import V1 | `importMethodVersion({namespace:N,actionId,title,files:[{path,text,mediaType:"text/plain"}]})` |
| Adopt | `adoptMethodVersion({bindingNamespace:N,package:M,version:V1,readSet:[N],roleId:"finance",expectedRevision:b-or-null,actionId})` |
| Resolve | `resolveMethod({...K,package:M})`; retain snapshot `s`. |
| Draft | `createCardDraft({namespace:N,actionId,drafting:"authored",input:{title,body,authoredInput:{text,occurredAt:null}}})` |
| Confirm | `confirmCardDraft({namespace:N,cardId,expectedRevision:c,actionId,applicability:"current",currentDependencies:{context:K,packages:[{package:M,snapshot:s}]}})` |
| Declare separately | `declareCardCurrentDependencies` with IDs, exact `c`, null dependency expectation and reviewed dependencies. |
| Edit | `editKnowledgeCard` with IDs, exact `c`, title/body/bindings and applicability. |
| Review | Fresh resolution; `revalidateCardCurrentDependencies` with exact `c,d`, declared context/package set and fresh snapshot. |

Mutations use fixture-authorized explicit-user authority; reads use read authority. Import V2 with returned package/current package revision and `basedOn:V1`. Import and adoption remain separate. [private-card-input.mjs:145](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/private-card-input.mjs#L145), [method-package-input.mjs:174](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/method-package-input.mjs#L174), [method-package-facade.mjs:15](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/method-package-facade.mjs#L15), [card-current-storage.mjs:64](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/card-current-storage.mjs#L64)

| Branch | Expected behavior |
|---|---|
| Unadopted V2 import | Current/history remain eligible. |
| Adopt V2 | Needs review; exclude current, retain eligible history. |
| Re-adopt V1 | Needs review after binding revision change. |
| V1→V2→V1 | Still needs review. |
| Edit without review | Needs review; overwritten body is not archived. |
| Review unchanged body | Restore dependency eligibility if other support passes. |
| Edit then review | New body can become current; no recovery of overwritten text. |
| Unauthorized MCP confirmation/declaration/revalidation | `approval_required`; no mutation. |

These distinctions are covered by focused product tests. [card-current.test.mjs:11](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/test/card-current.test.mjs#L11), [re-adoption:63](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/test/card-current.test.mjs#L63), [review:119](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/test/card-current.test.mjs#L119)

MCP approval refusals are expected controls. [server.mjs:333](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/adapters/mcp/server.mjs#L333), [card-current-tools.mjs:10](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/adapters/mcp/card-current-tools.mjs#L10)

Score eligibility, delivery and reader use separately. Qualified history is not current use.

**6. Answer schema, canonicalization and gold visibility**

Freeze a closed executable JSON Schema:

```text
Value :=
  Text{text} | Boolean{value} | Quantity{decimal,unit}
  | Instant{iso} | Range{lower,upper,lowerClosed,upperClosed,unit}
Scope := {any:[{all:[{field,values:[string]}]}]}
Interval := {from:instant|null,to:instant|null}
Citation := {intent:current|history,item:integer,
             unit:body|receipt,source:integer|null,
             quote:string,occurrence:positive_integer}
Claim := {subject,predicate,value:Value,scope:Scope,valid:Interval,
          qualifiers:[{key,value:Value}],citations:[Citation]}
Answer := {
  current:{status:active|no_active_decision|unresolved,claims:[Claim]},
  old:{status:available|unavailable|none,
       records:[{status:previously_adopted|erroneous|expired,claims:[Claim]}]},
  reason:{status:stated|not_stated|unavailable,
          nodes:[{id,claim:Claim}],
          edges:[{from,to,citations:[Citation]}]}
}
```

All fields are required. `Claim.valid` is source-claimed; history status separately identifies actual adoption versus erroneous recording.

Canonicalization uses frozen dictionaries, NFKC/whitespace normalization, exact rational units, UTC/open-endpoint intervals, unordered-set normalization and extensional scopes. Unknown equivalences are referred. Equivalent duplicates collapse; contradictions/extras remain errors.

Resolve citations only against delivered units and legitimate delivered aliases. Maintain maps through normalization/truncation; never reuse raw offsets as delivered offsets. Product normalization and 800-code-unit receipt truncation require this. [validation.mjs:37](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/validation.mjs#L37), [contract.mjs:93](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/contract.mjs#L93)

**Gold boundary:**

- `G_correct` contains canonical expected claims, statuses, intervals, scope and accepted graph structure.
- Exclude supporting quotations/text, undelivered text and hidden delivery labels.
- Correctness pass: question, anonymized answer and `G_correct`; semantic correspondence only.
- Support pass: question, original anonymized answer and delivered evidence; **no gold**, expected graph or correctness verdict.
- Separate fresh sessions; neither sees the other’s findings.
- Support judgments must follow the submitted citations. Other delivered context may disambiguate or negate a citation, but cannot substitute an uncited supporting passage. Neither pass may repair an answer or add an edge or citation.

C/O remain factual correctness measures under schema/status rules; report delivered support separately. R requires both correct causal content and delivered support. Unsupported correct guesses are not evidence-supported answers.

**7. Executable causal scoring**

Gold stores:

```text
acceptedGraphs = OR(G1,G2,...)
Gi = AND(required directed edges)
edge.support = OR(AND(required supporting spans),...)
```

R=1 requires a complete accepted graph, delivered support for every required edge and no unsupported submitted edge. Supported unions are allowed. Endpoint mentions do not establish causality. A transitive shortcut cannot replace intermediate edges unless explicitly accepted. `not_stated` requires no causal edges.

Audit directions, conjunctions, alternatives and distractor entailment before outcomes.

Metrics:

- C: exact current claims, qualifications and temporal applicability.
- O: exact requested predecessor set and historical labels.
- R: complete correct, delivered-supported explanation.
- J: **C×O×R computed for each family before aggregation or resampling**.

Malformed outputs/exhausted reader failures score zero. Partial scores are exploratory.

**8. Model adjudication and calibration**

This is **model adjudication, not human judgment**.

Two non-author Codex adjudicators evaluate each referred pass independently in fresh isolated sessions:

```text
codex exec -m gpt-6.1-sol -c model_reasoning_effort="xhigh" \
  --ignore-user-config --disable hooks
```

Record requested/observed model, effort, command and session. A third fresh adjudicator resolves disagreement independently on the same pass bundle without prior judgments. Unresolved cases remain unresolved.

Only the pass-specific bundle and rubric are visible: no arm names, other answers, scores, thresholds, consequences, repository or credentials. Preserve evidence while anonymizing identities. Independent sessions do not imply independent errors.

Return structured findings, citations and concise rationales. Contextual equivalence keys include scope, qualifications and evidence conditions. Apply consistently across arms and publish complete provenance and propagated applications.

Freeze authorship, labels, candidate order, referral definition and acceptance rules before judgments. Calibration lineages are disjoint from research splits; label provenance comes from ASTs, verified transformations or explicit mutations.

| Set | Bundles | Construction |
|---|---:|---|
| Pooled challenge | 400 | 200 correct/200 incorrect; incorrect: 60 C-only, 60 O-only, 60 R-only, 20 all-component. Balanced Chinese/English. |
| Genuine referrals | 960 | 80 worlds per Chinese/English/mixed class, each with one matched correct answer and three single-component negatives. |
| Evidence contrasts | 240 | 48 groups across languages/styles; five evidence variants/group. |
| Representation/distortion pairs | 384 | Languages × four error classes × four worlds × faithful/distorted × four styles. |
| **Total** | **1,984** | Variants are not independent worlds. |

Each component/language referral stratum has 80 known negatives and 80 matched positives, balanced across four styles. Disclose reuse of matched positives. Cases count only when the frozen mechanical pipeline actually refers the designated component; use the first qualifying candidates without judgment feedback.

Evidence contrasts keep question, answer and `G_correct` identical while delivery changes to adequate, endpoint-only, negated, truncated or removed support. R must fail without required support.

Distortions include wrong reasons, commitment changes, broadened scopes and dropped qualifications. Include locally supported but factually false extracted bodies. Hide representation labels.

All gates precede paid work:

| Gate | Observed threshold |
|---|---|
| Pooled mechanics | Zero false accepts; ≤2 false rejects/200 correct; report referrals/coverage. |
| Pooled pipeline, whole answer | False accepts ≤4/200; false rejects ≤10/200. |
| Pooled components | Each: false accepts ≤1/80; false rejects ≤16/320. |
| Genuine referrals | Each component/language: false accepts ≤1/80; false rejects ≤4/80 positives. |
| Referral style concentration | Per component/language/style: ≤1 false accept/20; ≤2 false rejects/20. |
| Evidence contrasts | Zero false support acceptance/192 insufficient bundles; ≤2 false rejections/48 adequate bundles; check support panel and final R. |
| Matched styles | Overall error spread ≤5 points; report class/language differences. |
| First-two agreement | ≥95% exact component-vector agreement, separately pooled/referral sets, before resolution. |
| Completion | No unresolved calibration verdicts. |

Calibrate the complete mechanical/referral/two-pass/resolution/scoring pipeline. Report pass-specific errors, agreement, κ, intervals and strata using independent-world/key denominators. Passing observed thresholds is not a population guarantee.

Failure blocks paid work. Changes require new calibration versions and fresh cases; never relabel gold or relax thresholds to pass.

Report overall/per arm: direct referrals, propagated mappings, model-dependent C/O/R/J, any-dependent-component share, third reviews and unresolved cases. A mechanically forced J=0 is distinguished from its adjudicated components.

Codex judgments use the subscription, not the paid research API ledger. Record sessions, identities, tokens when available and wall time separately. No owner adjudication is required.

**9. Generator, splits and lineage**

Rendering costs $0 in research API calls. Use deterministic code, grammar and sentence banks; no paid generation/paraphrasing.

Audit 30 offline engineering worlds before scaling, excluding them from accuracy estimates. ASTs encode commitment, scope, time and causality. Validators check timelines, referents, anchors, scope, support, byte limits and leakage; semantic audit covers remaining interpretation risks.

| Split | Families | Per change type | Chinese/English/mixed |
|---|---:|---:|---:|
| Pilot | 60 | 12 | 33/18/9 |
| Development | 200 | 40 | 110/60/30 |
| Test | 1,600 | 320 | 880/480/240 |

Four batches/family; probes after batches two/four; final probe is primary.

Causal classes: direct, unstated, two-edge serial, three-edge serial, conjunctive mediated, alternative mediated. Per type: pilot 2 each; development 8/8/8/8/4/4; test 80/80/40/40/40/40. Test contains 800 multi-hop and 400 unstated-reason families.

Include subject/scope/date collisions, proposals, rejections, quotations and unsupported causal distractors. Card controls total 40/40/160; named-forget/replay/foreign controls total 20/20/160. Controls may overlap.

| Set | Lineages | Families/lineage |
|---|---:|---:|
| Engineering | 30 | 1 |
| Pilot | 30 | 2 |
| Development | 50 | 4 |
| Test | 200 | 8 |

Lineages nest within type: 6/10/40 per type for pilot/development/test. Publish ancestry, causal class, language/control allocation and multiplicities before generation. No lineage, derivative paraphrase or alias crosses splits.

Primary inference conditions on fixed banks/lineage allocation and independently sampled world ASTs within lineages. It does not generalize to new authoring lineages.

Audit all 310 lineage specifications, all engineering/pilot/dev worlds and two selected test worlds/lineage: **690 rendered-world audits**, plus mechanical checks of all worlds. Publish rejected candidates. Semantic amendments require fresh held-out lineages.

**10. Models, queries and retrieval**

Primary extractor/reader: `gpt-4.1-mini-2025-04-14`. Alternative extractor: `gpt-5.4-mini-2026-03-17`, reasoning none, reader unchanged. [profiles.mjs:1](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/adapters/openai/profiles.mjs#L1)

Freeze strict-schema Responses bodies, no tools/prior state, `store:false`; primary temperature 0; alternative temperature omitted. Total billable output caps: 1,024 extraction/768 reader tokens. Four cached extraction calls/family feed all arms.

Literal queries:

- English: `"{subject} {predicate} {scope_text} decision correction change reason"`
- Chinese: `"{subject} {predicate} {scope_text} 決定 修正 變更 原因"`
- Mixed: both, newline-separated.

Use frozen public headers, never gold values. Reader questions identify checkpoint, focal turn and predecessor relation.

T/U/O index serialized bodies; receipts remain assembly units. Use BM25-T1 (`k1=1.2,b=.75`), hosted `text-embedding-3-small`, equal-weight RRF `k=10`, depth 24, deterministic ties and twelve selected candidates/intent. Rank-first whole-record assembly uses 2,000 serialized tokens/intent. Freeze serializers. [context-read-tokenize.mjs:1](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/context-read-tokenize.mjs#L1), [context-read-bm25.mjs:3](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/context-read-bm25.mjs#L3)

P uses a private file-backed store/family, public initialization, personal read set `[N]` and separate unauthorized namespace. Enable Cards, methods, dependencies and context-read; disable optional MOC/relation sources. Use actual `tiktoken-o200k_base`, hosted small embeddings, 1,536 dimensions. [context-read-local.md:64](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/docs/context-read-local.md#L64), [hosted configuration:169](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/docs/context-read-local.md#L169)

At each probe:

1. Public refresh separately by intent, `types:["memory","card"]`, `budget:{maxItems:128,maxMs:5000}`, maximum four invocations/projection. Preserve errors/partial status. [context-read-input.mjs:153](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/context-read-input.mjs#L153)
2. `find_memory_candidates`: same query/types, separate intents, `semantic:true,limit:24,deadlineMs:5000`; diagnostics only.
3. `read_memory_context`: `semantic:true,maxTokens:2000,maxItems:12,deadlineMs:5000`; omit policy.
4. Reader receives only actual representation-v2 blocks, labeled by intent.

These interfaces/default policy are pinned product behavior. [context-read-tools.mjs:42](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/adapters/mcp/context-read-tools.mjs#L42), [assembly:75](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/adapters/mcp/context-read-tools.mjs#L75), [capabilities:693](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/context-read-facade.mjs#L693)

One stateless reader call/arm/checkpoint. No fallback repairs P.

**11. P headlines, intervals and attribution**

Report P’s absolute C/O/R/J overall/by type, with denominators, completion, adjudication dependence and judgment-error bounds.

**Every P interval uses §12’s finite-sample-rescaled construction**, including pilot and development. P−U/P−T use scored paired family differences and the same corrected construction.

For absolute-score presentation, take quantiles of untruncated corrected replicates first; intersect displayed endpoints with `[0,1]` and retain untruncated values in artifacts. Never clip replicates themselves.

Supplement all-failure/all-success cells:

- All failure: `[0,1−0.025^(1/n)]`.
- All success: `[0.025^(1/n),1]`.

Zero hard violations among k independent family opportunities receive upper bound `1−0.05^(1/k)`; repeated checkpoints do not increase k.

Failed attempted answers remain scored observations. Unexecuted cases are not zero-filled. Partial P reports identify attempted denominators and do not present a completed-design CI when planned strata are missing or a required lineage has fewer than two observations.

Evaluate accepted paths at E: extraction/receipts; W: public retention; A/H: eligibility/horizon; D: actual delivery. Do not assume nesting. Historical receipt prose can remain inspectable but unavailable to context assembly. [private-evidence-storage.mjs:73](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/private-evidence-storage.mjs#L73)

Classify substantiated extraction, write, eligibility, retrieval, assembly or answering loss; otherwise mixed/unresolved. Preserve downstream flags and recovered paths. Gold-blind support determines delivery sufficiency. These are diagnostics, not causal-mediation estimates.

**12. Confirmatory inference, finite-sample correction and judgment error**

The estimand remains final J(T)−J(U), equally weighted across types.

For any linear estimand, let:

- \(x_{li}\): already-scored family outcome or paired difference.
- \(m_l\): observations in lineage \(l\).
- \(w_l\): frozen lineage weight for that estimand.
- \(\bar x_l\): observed lineage mean.
- \(\hat\theta=\sum_l w_l\bar x_l\).

Draw \(m_l\) families with replacement **within each fixed lineage**, preserving paired arms/checkpoints. Use shared draws across outcomes. Construct:

\[
\boxed{
\hat\theta_b^*=\hat\theta+
\sum_l w_l\sqrt{\frac{m_l}{m_l-1}}
\left(\bar x_{lb}^*-\bar x_l\right)
}
\]

This is the auditor’s specified correction. Replacement:42 (non-author audit record, private)

| Split | \(m_l\) | Deviation multiplier |
|---|---:|---:|
| Pilot | 2 | \(\sqrt2\) |
| Development | 4 | \(\sqrt{4/3}\) |
| Test | 8 | \(\sqrt{8/7}\) |

Weights:

- Overall equal-type statistics: lineage weight `1/30`, `1/50`, `1/200` for pilot/dev/test.
- Within-type P statistics: `1/6`, `1/10`, `1/40`.
- C/O/R guards: overall weights.
- Multi-hop R: only declared multi-hop lineages, retaining their multiplicities and equal family weights. Pilot/dev/test contain 20/30/100 such lineages, so weights are `1/20`, `1/30`, `1/100`.

Compute J per family first. Never multiply resampled aggregate C/O/R means. Keep paired differences intact; do not independently bootstrap arms.

Use 10,000 draws, seed `hr3-bootstrap-v1`, interpolated 2.5/97.5 percentiles. Store untruncated replicates; use untruncated contrast/guard intervals for decisions.

Verify replicate variance against:

\[
\boxed{
\widehat V(\hat\theta)=
\sum_l w_l^2\,s_l^2/m_l
}
\]

where \(s_l^2\) uses denominator \(m_l-1\). Validate shared-draw covariance as applicable. Count-based/direct checks must test the corrected estimator, including unequal lineage sizes and guard weights.

The correction removes the ordinary bootstrap’s finite-sample variance factor; it does **not** establish exact finite-sample 95% coverage by itself. Coverage validation in §15 is mandatory.

Whole-lineage sensitivity remains a distinct, separately labeled analysis for lineage generalization; it does not replace primary inference.

| Statistical decision | Rule |
|---|---|
| Advance | Estimate ≥+5 points; corrected primary lower CI >0; all corrected guard lower CIs ≥−5; no T hard violation. |
| Keep U | Corrected primary upper CI <+5, any corrected guard upper CI <−5, or T hard violation. |
| Inconclusive | Otherwise, or validity/completion/budget gates fail. |

Guards: C/O/R and multi-hop R. Hard violations: unauthorized/named-forgotten exposure, replay resurrection and stale Card current use. Advancement is conjunctive; Keep has no familywise 95% claim.

Require complete test execution, ≥98% valid final answers in T/U/O and resolved adjudications. P completion does not create a new confirmatory gate.

**Judgment-error safeguard**

Freeze keys, parent rule families and propagated applications. Report calibration errors by component, language, style and distortion class using independent-world/key denominators.

For each stratum containing \(K_s\) eligible distinct keys, derive empirical false-accept/reject rates and their one-sided 95% upper bounds. For each envelope rate \(p_s\)—empirical, upper, or doubled-upper capped at 1—use integer budget \(B_s=\min(K_s,\lceil K_sp_s\rceil)\). Cap rates at 1 and counts at \(K_s\). Unsupported strata use upper rate 1. Preserve shared-key propagation and the separate parent-rule failure scenarios. Budgets use all eligible keys, not just accepted ones.

Perturb each key consistently across arms/families; include influential-key concentration and parent-rule failures. Recompute family scores and guards, not isolated applications.

**For every allowed error assignment, recompute its own point estimate and lineage means, then apply the corrected formula above using the same fixed family draws.** Do not center perturbed replicates on unperturbed means. Bootstrap-envelope bounds must accommodate the corrected, potentially negative replicate coefficients.

Report P score ranges, T−U ranges and tipping points. Exact/certified optimization is preferred; otherwise use conservative outer bounds, never heuristic certification. Report unrestricted all-dependent bounds separately.

If advancement changes within prespecified calibration-informed scenarios, or robustness cannot be established, factual accuracy is **judgment-sensitive and Inconclusive**.

**Power and simulation**

Independent-pair rejection-power approximations remain about 80.94% at discordance .50 and 95.61% at .30 for n=1,600 and a five-point effect. They are not advancement power; the +5-point estimate threshold limits advancement to roughly 50% at exactly that true effect.

Retain 60 cells: effects `{0,.03,.05,.08,.10}`, discordance `{.30,.50}`, ICC `{0,.10,.30}`, benign/guard-harm; 2,000 datasets/cell.

Baseline J(U)=.40; `P(U-only)=(q−δ)/2`, `P(T-only)=(q+δ)/2`. J failures select a component; guard harm assigns U failure to R and T failure to C in 30% of both-failure pairs.

For ICC ρ, one Bernoulli(ρ) per lineage chooses either one shared complete paired outcome for all eight families or eight independent outcomes. Validate marginals/ICC.

**Every simulated primary CI, guard and decision uses the corrected construction**, including shared draws and frozen weights. Preserve the separate lineage sensitivity. Report decision probabilities and coverage conditional on finalized, error-free labels—not power for judgment-robust factual advancement.

**13. Stages and pilot continuation**

1. Audit generator, reducers, schema, maps and scorer.
2. Serialize/tokenize valid references for every maximal required structure.
3. Confirm the 768-token cap fits them. Otherwise amend cap/budget/design before paid work; never omit requirements to fit.
4. Complete resource benchmarks, corrected-analysis validation and adjudication calibration.
5. Freeze artifacts, allocation, prices and reservations.
6. Run the 60-family pilot under $24.
7. Start development only if its continuation gate passes.
8. Publish the 200-family development P baseline before test calls.
9. Run test/alternative extraction and independent recomputation.

Pilot continuation requires:

- ≥98% valid structured completion per arm, with final/maximal-structure breakdowns.
- No unresolved truncation/schema-cap failure.
- Functioning provenance, citation mapping and calibrated adjudication.
- Reconciled durable accounting.
- Completion projection within API allowances.
- Measured subscription/runtime capacity.
- No unresolved authorization/execution-validity defect.

No semantic accuracy floor applies. Correctly scored P losses do not fail the gate. Repairs require applicable amendments/fresh held-out material; no quality retries.

Pilot precision is approximately ±13 points overall; actual intervals use the corrected method. Twelve/type support no strong type conclusions. Development is the first substantive baseline; its intervals also use the correction.

Publish dated inspection declarations/hashes. Development cannot change T/U or decision rules; never pool with test. Semantic amendments require fresh lineages.

Exploration includes P−U/P−T, T/U versus O, intermediate probes, strata, partial scores, storage, latency and costs. Any exploratory use of the primary bootstrap uses the same correction and explicit weights. Alternative extraction uses 200 selected test families, T/U, both probes.

**14. Paid API budget**

Planning rates remain local assumptions: primary `$0.40/$1.60`, alternative `$0.75/$4.50` per million input/output tokens; embeddings `$0.02/M`. [profiles.mjs:6](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/adapters/openai/profiles.mjs#L6), [embedding.mjs:11](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/adapters/openai/embedding.mjs#L11)

Forecast assumptions: 8,000/1,024 extraction and 6,000/768 reader tokens.

| Stage | Extraction/reader calls | Forecast |
|---|---:|---:|
| Generator/scorer/Codex work | No research API calls | $0.00 |
| Pilot | 240/480 | $2.90 |
| Development | 800/1,600 | $9.68 |
| Test | 6,400/12,800 | $77.41 |
| Alternative | 800/800 | $11.39 |
| Research embeddings, 64M units | Metered | $1.28 |
| P embeddings, 64M units | Metered | $1.28 |
| Subtotal | | $103.94 |
| 25% contingency | | $25.99 |
| **Forecast** | | **$129.93** |

Reserve `UTF8_bytes(complete provider body)+4096`; ceilings 16,384/extraction and 20,000/reader, plus billed output caps. Validate framing in pilot. One transport retry, no quality retries.

| Stage | Ceiling with every retry |
|---|---:|
| Pilot | $12.791808 |
| Development | $42.639360 |
| Test | $341.114880 |
| Alternative | $41.799680 |
| Embeddings | $2.560000 |
| **Request-plan ceiling** | **$440.905728** |

Stage caps: $24/$46/$345/$45 respectively, subordinate to global limits.

Embedding dispatches reserve `Σ(bytes+16)` and enforce actual bounds: per-input ≤8192, batch ≤64, aggregate ≤300,000 and request-byte limit. [embedding.mjs:19](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/adapters/openai/embedding.mjs#L19), [limits:49](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/adapters/openai/embedding.mjs#L49)

Do not repair P refusal by splitting/truncation. Its allowance remains:

`1,860×(32,000+8×256)=63,329,280<64M`.

Durable accounting covers nested dispatches/restarts; product accounting alone is process-local. [context-read-budget.mjs:3](https://github.com/Cairn-ink/cairn-memory/blob/b2513501a6747a163ab1cefb7d37a16744c9621a/core/context-read-budget.mjs#L3)

Reserve atomically; retain unsettled/unknown charges. Deny unlisted calls. Parameter/price changes require recalculation.

Hard caps: **pilot $24, operational $450, authorization $500**, with $50 unavailable headroom. Incomplete test due to exhaustion is Inconclusive. Partial P reports identify unexecuted cases.

Keys remain outside repositories/workers/adjudicators; never log credentials.

**15. Corrected-analysis validation and unpaid resources**

The previous ordinary-bootstrap benchmark is superseded for primary analysis.

**Read-only prototype checks in this revision:**

| Check | Result |
|---|---|
| Corrected direct/count routes, mixed m=2/4/8 | 128/128 matches, tolerance \(10^{-12}\); exit 0. |
| Variance checks, 100,000 draws/split | Corrected/analytic ratios 0.98855–1.00543; exit 0. |
| Corrected primary, 10,000 draws/test cell | 0.490661 seconds. |
| Separate lineage sensitivity | 0.083422 seconds. |
| Peak memory | 82,352 KiB. |
| Main-grid projection at observed throughput | **19.14 hours**, excluding other work. |

These are precursor checks, not frozen-harness acceptance or coverage results.

Before freeze:

- Reproduce corrected variance/covariance targets and direct/count parity in the actual analysis implementation.
- Validate coverage in independent conditional-family scenarios for P absolute outcomes, paired contrasts and guards.
- Add 12 benchmark cells: actual pilot/dev/test allocations crossed with homogeneous Bernoulli, heterogeneous Bernoulli, homoscedastic normal and heteroscedastic normal outcomes. Use 2,000 datasets/cell and 10,000 corrected draws. Publish coverage and Monte Carlo uncertainty; investigate/audit material undercoverage before freezing.
- Obtain coverage for test contrasts/guards from the existing independent-outcome power cells.
- Check boundary supplements separately. Do not claim exact coverage from variance agreement alone.

Main workload remains 120,000 datasets, 1.2 billion corrected-primary and 1.2 billion lineage replicates. Coverage benchmarks add 24,000 datasets/240 million corrected replicates. At the measured test-cell throughput, combined resampling projects to roughly **23 hours**; allocate at least **36 hours** at comparable throughput, plus separately measured generation, I/O and judgment-error optimization. Shared-machine wall time may be longer. This is an explicit validation addition, not a reduction of prior simulation coverage.

Retain the validated ICC construction; recheck its marginals/ICC with the frozen simulator.

**Subscription benchmark remains unperformed:** 24 engineering bundles crossing languages/styles/short and maximal structures, both passes. Measure model identity, latency, tokens, failures, throttling, disagreement/resolution and concurrency. Benchmark judgment-error optimization separately.

| Work | Sessions |
|---|---:|
| Calibration | 7,936–11,904 |
| Benchmark | 96–144 |
| Production if all 15,680 answers require both passes | Up to 94,080 |
| **Combined worst case** | **106,128** |

Production uses model passes only where frozen mechanics/licensed contextual mappings cannot decide. Forecast from measured referrals/disagreements; preserve worst-case counts.

Before calibration, publish measured runtime/subscription projections and explicit quota, concurrency and supervision allocation. Refresh after pilot. Insufficient resources block paid stages. Exhaustion pauses execution; it never permits omitted adjudications, uncalibrated substitutions or reduced simulations. Changes require pre-outcome amendments.

Use the supported machine queue. Verify monitoring/notification before unattended work; otherwise run attended stages. Check actual progress, unsettled requests, errors and throughput at least every minute.

Stop on accounting/model mismatch, unexplained usage, authorization exposure, three transport failures or five minutes without progress. Preserve completed work before investigation.

**16. Audit, reporting and limitations**

Non-author review covers public operations, schemas, gold projection, referral calibration, support isolation, generator semantics, corrected resampling/coverage, sensitivity bounds, resource plans and transcription.

Use focused checks; retain commands and exit codes. Cross-check artifact manifests by two enumeration routes and publish counts.

Conclusions remain conditional on synthetic grammar, models, extraction and budgets. P includes an explicit agent/scheduled expiry. T/U are research capabilities. Shared extraction omits feedback.

Model adjudication can share errors; gold can contain authoring mistakes. Calibration/agreement do not establish universal truth. Statistical intervals condition on finalized labels. The variance correction addresses the identified bootstrap bias, not model judgment, gold error or guaranteed exact coverage. Report judgment-error ranges and robustness alongside accuracy.

**Change log: v0.3.2 → v0.3.3**

- Adopted the auditor’s exact centered, finite-sample-rescaled within-lineage bootstrap in **§12**, retaining fixed allocations and paired/shared draws.
- Applied it to **confirmatory contrasts, guards, P pilot/development/test intervals, exploratory paired contrasts and fixed-draw judgment-error envelopes** in **§§11–13**.
- Updated power simulation to use corrected primary estimates and added explicit coverage validation in **§§12, 15**.
- Verified corrected direct/count agreement and analytic variance locally; replaced primary timing/resource projections in **§15**.
- Paid API forecast, attempt ceiling and **$24/$450/$500 caps remain unchanged**. No disagreement with the finding.

**Change log: v0.3.3 → v0.3.4**

- **§6, final “Gold boundary” bullet:** replaced the paragraph beginning “Neither may repair…” with the accepted submitted-citation requirement and prohibition on substituting uncited support.
- **§12, “Judgment-error safeguard,” paragraph beginning “Construct empirical…”:** replaced it with explicit one-sided 95% upper bounds and integer budgets \(B_s=\min(K_s,\lceil K_sp_s\rceil)\), distinguishing rate and count caps.
- Updated the title’s version label. All other text, including the previous change log, is unchanged.