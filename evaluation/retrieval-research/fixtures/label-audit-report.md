# HR-1 independent label audit (W3)

Audit scope: all 160 queries, all 216 required-fact groups, all 300 S300 memories, all 700 S1000 extras, and all 100 foreign memories, including every body and span. The checked-in protocol is **v2.2**, not the v2.1 named in the assignment; its C6 superseding-decision clarification governs this audit. No retrieval rankings, embeddings, or result-producing evaluations were used.

**Outcome: retain all 160 queries in their original categories.** The override file contains 11 ordered operations affecting nine queries: seven additional support memberships and two body-to-span corrections, each represented by remove/add operations. Every operation has a concrete reason. Facts, corpus, queries, facts view, split, and source labels were left unchanged; nothing was committed.

## Override counts

Counts use the original primary category. An action count is an operation, not a unique memory or query.

| Category | add-member | remove-member | recategorize | drop-query | add-hard-negative | remove-hard-negative | Total |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| C1 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| C2 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| C3 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| C4 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| C5 | 2 | 0 | 0 | 0 | 0 | 0 | 2 |
| C6 | 4 | 2 | 0 | 0 | 0 | 0 | 6 |
| C7 | 1 | 0 | 0 | 0 | 0 | 0 | 1 |
| C8 | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| FOREIGN | 0 | 0 | 0 | 0 | 0 | 0 | 0 |
| **Total** | **9** | **2** | **0** | **0** | **0** | **0** | **11** |

The nine additions comprise six new S300 supports, one new S1000-extra support, and two replacements of existing body locations by span locations. Memberships increase from 222 to 229. `applyAudit` automatically removes four newly recognized supports from hard-negative lists: q-016/m-689efa9633b7f2, q-053/m-d4db5db2b05c70, q-087/m-9d26774659d942, and q-093/m-db75fb2e70c16a. Thus there are **zero explicit hard-negative operations**, but four hard-negative removals in the effective labels: 914 entries become 910.

| Query | Adjudication |
| --- | --- |
| q-016 | The rationale names 陳會計 tax checking; add its first span to F-000182. |
| q-053 | The rationale states that onboarding now starts with an example; add its first span to the first-activity answer. |
| q-087 | The rationale explicitly states one independent test-data copy per branch; add its first span to F-000062. |
| q-093, q-116 | The delivery rationale explicitly states Wednesday arrival; add it to F-000128 for each query. |
| q-120 | The body mentions adding a badge, but the span states title alongside badge; change the complete replacement-display evidence to span-only. |
| q-124 | An S1000 extra explicitly calls copyediting 小周's PR #182 work while assigning test copies to 阿岑; add that span. |
| q-162 | The rationale also states the adopted plain, clear tone; it supports both the replacement decision and reason. |
| q-167 | Only the span states the complete example-then-configuration order; change that group to span-only. |

## Remaining counts and family minimums

No drops or recategorizations change the query counts. These counts were independently recomputed from active labels joined to source queries and split assignments, then compared with the validator summary; all seven scored category rows match exactly. Each scored query in these category rows comes from a distinct family within its category.

| Category | Remaining | Dev queries | Test queries | Dev families | Test families | Quota / family result |
| --- | ---: | ---: | ---: | ---: | ---: | --- |
| C1 | 20 | 8 | 12 | 8 | 12 | Pass |
| C2 | 20 | 4 | 16 | 4 | 16 | Pass |
| C3 | 20 | 5 | 15 | 5 | 15 | Pass |
| C4 | 20 | 8 | 12 | 8 | 12 | Pass |
| C5 | 20 | 8 | 12 | 8 | 12 | Pass |
| C6 | 20 | 5 | 15 | 5 | 15 | Pass |
| C7 | 20 | 8 | 12 | 8 | 12 | Pass |
| C8 | 10 | 2 | 8 | 2 | 8 | Control count met; scored-category family minimum does not apply |
| FOREIGN | 10 | 3 | 7 | 3 | 7 | Control count met; scored-category family minimum does not apply |

All scored categories retain exactly 20 queries, 4–8 dev queries, 12–16 test queries, at least four dev families, and at least ten test families. Scored dev share is 46/140 = **32.857%**; overall dev share is 51/160 = **31.875%**, both within 27–33%. C2 has exactly four dev families, so its minimum has no spare family.

After application, S300 scored span-only groups are **82/196 = 41.837%**, within the 35–45% band (previously 80/196). The remaining 114 groups are body-covered. Span-count matching, scale/domain/language matching, 340/700 = 48.571% template extras, and all other validator checks pass.

## Category and sufficiency adjudication

- **C1:** all 20 key terms occur in the query and in a valid member of every group. Names, invoice IDs, and PR IDs are ordinary identifying terms, not evidence of wording leakage.
- **C2:** all 20 queries use the specified 2–4 character Chinese term; independent Han-run checks confirm each has a witness embedded in a longer run.
- **C3:** all 20 are natural same-language requests that avoid naming the required fact's distinctive answer. Their descriptions often identify the workflow through a remembered incident or rationale. Those descriptions are already supplied in the question, so they are identifying context, not extra requested answer facts. Five queries still have zero T1 overlap with every eligible supporting member: q-047, q-049, q-054, q-057, q-060.
- **C4:** all 20 differ in language from every eligible group member, with ten queries in each direction. Verbatim project/person identifiers are preserved as required by the protocol.
- **C5:** each of the 20 explicitly requests every required fact; none is superfluous. All remain two- or three-group questions without any one memory answering every group, including after unannotated-support additions.
- **C6:** all ten current queries ask for a superseding decision plus its reason; all ten history queries require old decision, replacement decision, and reason. Supersedes/reasonFor chains and intent eligibility agree. The nine v2.2 replacement current queries are semantically valid. q-116 and q-162 legitimately allow one memory to support both new-decision and reason groups; C6 does not require separate memories.
- **C7:** all 20 retain at least one genuine S300 near-miss, documented below. Shared-family memories about unrelated attributes remain negatives under the protocol's broad mechanical definition; the concrete witnesses establish the stronger semantic requirement.
- **C8:** all ten requested values are absent in bodies and spans across both scales and both namespaces. Proposed options, fake fields, and practice materials do not establish those real workflow attributes.
- **FOREIGN:** all ten controls are answered in foreign memories only. Each requested code occurs in exactly one memory, in the foreign namespace, and none occurs in a target body or span.

Adjudication is tied to the question actually asked. q-053 asks only the first activity, so both the original body and the rationale span answer it. q-167 explicitly requests the next activity too, so the original member must use its complete span and the rationale is insufficient. Likewise, q-120 needs the replacement display's two components. This distinction is recorded in the overrides instead of rewriting queries or canonical facts.

Partial supports were not promoted indiscriminately. For example, CedarGate's account rationale does not state the weekly review required by q-088; AmberBooks' rationale names an exceptions sheet but omits the categorized ledger required by q-050/q-098. Receipt scans being due one day before handoff does not independently establish q-070's exact OCT-07 date/time.

## C7 semantic witnesses

Each listed negative is S300, eligible for current intent, shares the scenario entity, and does not answer the requested attribute.

| Query | Hard-negative memory | Genuine near-miss |
| --- | --- | --- |
| q-121 | m-b1f685044ee4b8 | 小林 schema migration versus backup-schedule review. |
| q-122 | m-c81ad880753ae7 | 15-second response TTL versus 24-hour image edge retention. |
| q-123 | m-6f11e95ab87362 | Evan incident follow-up versus dashboard palette review. |
| q-124 | m-995ccce5c73033 | PR #128 rollback ownership versus PR #182 copyediting. |
| q-125 | m-400fb70abe5c64 | Six invoice-import workers versus two preview workers. |
| q-126 | m-2053b9bd7e31ed | PR #206 dependency audit versus PR #260 license headers. |
| q-127 | m-79e2ccb59ff59d | Iris access-review reminders versus public-status proofreading. |
| q-128 | m-fe64c4ef4fce84 | 小林 pending-decision consolidation versus financial-figure authority. |
| q-129 | m-4d6742167a6ff5 | Tuesday founder meetings versus Monday engineering hours. |
| q-130 | m-8af749127490f3 | First proofreading pass versus the Friday-only link check. |
| q-131 | m-7a579dc0687860 | Wednesday order arrival versus Friday booklet shipment. |
| q-132 | m-df55b1f965d1a9 | Every-second-Tuesday onboarding versus monthly equipment inventory. |
| q-133 | m-d453f7c5000c1e | 小葉 handoff-table maintenance versus new-hire classroom confirmation. |
| q-134 | m-38be4187f93dc6 | Same NT$2,200 value, but water-dispenser expense versus stationery cap. |
| q-135 | m-b2919f8b11949b | Fifth-day attachment collection versus October 7 report delivery. |
| q-136 | m-71eacc9bb9d85d | INV-260814 / NT$18,600 versus INV-260841 / NT$16,800. |
| q-137 | m-ec0381a868d009 | One-time test credit versus Q4 migration-cost exclusion. |
| q-138 | m-b9e267f98d0333 | NT$4,200 petty cash versus NT$420,000 intervention threshold. |
| q-139 | m-0a5f19ab69691a | HTML public preview versus Markdown default export. |
| q-140 | m-f2716903678e64 | Badge layout versus permitted badge disclosure content. |

No new explicit hard-negative annotations are needed. The four automatic removals correct actual answer-bearing memories, and every C7 witness above survives.

## Whole-corpus contamination and namespace flags

**q-124 is flagged for accidental S1000 span support** in m-70fe786598e74b#s1. Its body says only who builds a test copy; its span separately refers to 小周's copyediting work. That possessive reference carries the answer even though the intended distractor is about another person's task. The extra does not change the answer or make the query ambiguous, so adding the member fixes it without a drop. Other explicit statements that a sample amount, deadline, or exercise field is different from the live policy were not treated as positive support.

The 20 declared foreign near-duplicates intentionally assign alternative decisions to target-named workflows. They are namespace controls, not target support. The following target queries are flagged as dependent on strict isolation; allowing these foreign rows into target evaluation would change their answers or answer a different version of the decision.

| Foreign memory | Target fact imitated | Directly affected queries |
| --- | --- | --- |
| m-9a7067fad1df62 | F-000002 | q-081, q-101 |
| m-5ec45dfc61c66f | F-000017 | q-083, q-112 |
| m-2006950c645aa8 | F-000010 | q-002, q-061, q-082, q-111 |
| m-16a352c706748a | F-000025 | q-113 |
| m-dec15c00496a86 | F-000077 | q-011, q-089, q-114 |
| m-ec88d7e03f3820 | F-000092 | q-162 |
| m-6080a53b7772c0 | F-000085 | q-115 |
| m-b8fed6543813b6 | F-000099 | q-012, q-090, q-163 |
| m-c536d039355c8d | F-000128 | q-093, q-116 |
| m-9adef118aac84f | F-000143 | q-094, q-164 |
| m-74912bedf1903f | F-000136 | q-117 |
| m-c059910a933971 | F-000150 | q-095 |
| m-a6b4a1556d64d3 | F-000179 | q-118 |
| m-2b02912c8e2961 | F-000194 | q-166 |
| m-0a55e55b730527 | F-000187 | q-097, q-165 |
| m-e0373bbc8c88ac | F-000201 | q-119 |
| m-cd3e7f55fa7db4 | F-000238 | q-053, q-167 |
| m-b987a984aa92ee | F-000253 | q-120 |
| m-deeb6c5a48ee65 | F-000282 | q-100, q-169 |
| m-a1f8077103b105 | F-000289 | q-060 identifying context only; no directly required group |

Two particularly important facet collisions are **q-011** (the foreign two-line summary still includes pending decisions) and **q-053** (the foreign three-example workflow still starts with examples). These do not justify foreign members in target groups. They also show why altered full facts cannot be assumed to make every facet irrelevant. No C8 value or FOREIGN control answer accidentally appears in the target namespace.

## Leakage review

All 160 wordings were reviewed against corpus bodies and spans. The recorded T1/T1+ overlaps were regenerated during temporary-copy validation. No query was dropped for natural overlap, and no wording supplies convincing evidence that W2 copied raw memory text. Wording inspection alone cannot prove an authoring access barrier. The following similarities are flagged for visibility and retained as natural language:

| Query | Source overlap | Adjudication |
| --- | --- | --- |
| q-047 | m-d3aa6d9dcdca51#s1: 月還沒配上 | Natural description of the same matching incident; overlaps identifying rationale, not the required NT$500 answer. |
| q-050 | m-95a6b5c6abd891 body: handoff package | Ordinary name for the requested package; answer components are not copied into the question. |
| q-051 | m-f33282402afde7#s1: 同一張車票 | Natural identifier for the duplicate claim, not the required checking owner. |
| q-058 | m-366b600b20bae7#s1: 名字的文字 | Natural wording-check attribute; 小周 is still requested rather than supplied. |
| q-059 | m-704c9843da24a4#s1: customer follow-up | Ordinary scheduling context; the 25-minute answer is absent from the question. |

## Systemic validity risks

1. **One-fact annotations miss semantic redundancy.** All 1,100 memories have exactly one expresses annotation, yet rationale spans repeat decisions and roles. The seven added memberships correct the observed false negatives; future corpora need independent semantic review rather than assuming the join is complete.
2. **Composite facts and compressed bodies blur sufficiency.** q-053/q-167 share a fact but ask different parts of it; q-120's compressed body omits the retained title. The two location corrections prevent overstating body coverage. q-018 is retained on the ordinary reading of alert responsibility as receiving/first reviewing alerts; its source does not establish authorship of alert-generation code or responsibility for sending alerts.
3. **Synthetic construction can make the suite easy.** Project names recur at the start of memories. Many extras identify themselves as training, mock, classroom, or fake material, often explicitly distinguishing the target policy. All 1,100 expresses annotations point to s1, while all 550 additional spans consist of six generic acknowledgment strings. Matched span counts therefore do not establish matched information density. The pre-registered dev ease check remains necessary; this audit did not run retrieval or assess saturation.
4. **C3 partly measures indirect entity resolution.** Many paraphrases identify a scenario via another fact's rationale instead of directly rephrasing the target support. They are valid requests under §4.3, but a C3 gain should not be interpreted as pure sentence-level synonym matching.
5. **Hard-negative reporting has a broad denominator.** The generated list includes all eligible same-family/shared-entity nonanswers, including weakly related attributes. C7 has genuine hard witnesses, but hard-negative@12 summarizes a broader set than only these closest near-misses.
6. **Namespace and scale correctness matter.** Foreign mutations deliberately conflict with target decisions; q-124 also gains a valid support only at S1000. Scoring must honor member scale and namespace and enforce the required identical-target-rankings isolation check.
7. **Quota margins are limited.** C2 has exactly four dev families; C1/C4/C5/C7 each have the minimum 12 test queries. Further drops need a renewed quota/family audit before freezing.

## Validation and handoff

Runtime: Node v22.16.0. Before the audit file existed, the source-directory validator exited **1**, reporting only `audit:overrides` because that required pipeline artifact was absent. This is not reported as a passing baseline.

The fixture was copied to a fresh temporary directory outside the repository, and the actual apply/validate CLIs were run there:

- `apply-audit.mjs --fixture <temporary-copy>`: **exit 0**, 11 overrides applied.
- `validate.mjs --fixture <temporary-copy>`: **exit 0**, `ok: true`, zero errors; public admission checked all 1,100 memories successfully.
- Independent Python reimplementation of all nine category booleans and exact C1/C2 witness arrays: **exit 0**, checking 1,440 booleans plus 320 witness arrays for the original labels, and the same counts for the applied copy.
- Independent active-query aggregation matched all seven validator category/family rows. The 160-query review ledger below was checked against source query IDs and against applied-label IDs: identical sets, count **160**.
- SHA-256 comparison against the pre-audit snapshot confirmed all **six** protected input JSON files unchanged.

The delivery manifest was independently derived from Git status and from `find` since the pre-audit snapshot, with filesystem candidates compared byte-for-byte against HEAD when tracked. The initial timestamp-only comparison exited **1** because the unchanged `docs/plans/memory-next-stage-charter.md` had a newer timestamp. Its bytes exactly match HEAD; the corrected content-aware comparison exited **0** and both manifests contain exactly **two** files: `hr1-label-audit.json` and `label-audit-report.md` in the fixture directory.

The primary has not applied overrides to the repository labels during this audit. Therefore a post-primary source-directory validator result is **pending**, not claimed here. After review, the primary should apply and validate before freezing:

```sh
node evaluation/retrieval-research/tools/apply-audit.mjs --fixture evaluation/retrieval-research/fixtures
node evaluation/retrieval-research/tools/validate.mjs --fixture evaluation/retrieval-research/fixtures
```

### Input provenance

This list is derived from the pre-audit hash snapshot and cross-checked against the six pre-existing fixture JSON filenames found independently in the fixture directory, excluding the new audit.

| Protected input | SHA-256 before and after audit |
| --- | --- |
| hr1-corpus.json | 1ce357439f1ed28cfd2e2c8bf31e0bde1581e1110c40577f06d0a915d8db0bf5 |
| hr1-facts-view.json | 65fc2e46c474f8d3f532bae7ea9a95441a17a67c4350fe01a091022b10e18971 |
| hr1-facts.json | 339fbdb91158a7593265c129c31bc205f4efe6a552301bcab1e063e12f8e5087 |
| hr1-labels.json | 3debce9c6e285c3fd9e447a261c66f63455146244999fe7b1d8e0336bec8c9cd |
| hr1-queries.json | 91648404a6ea32866081a7e308e20235fd0209835ff2cfee09b7abe074bae9ea |
| hr1-split.json | 00e96f9e764da780d7024eac62bc15442dde3e02166c4057bbf49d82ae8c1ebb |

## Per-query adjudication ledger

Every query is retained in its original primary category. “Override” indicates the number of ordered JSON operations for that query; all other rows accept the original evidence groups and category semantics. Controls retain their required absent/foreign status. Identifying context in C3 is treated as given, as explained above.

| Query | Category | Split | Override operations | Evidence/category adjudication |
| --- | --- | --- | ---: | --- |
| q-001 | C1 | test | 0 | Monthly hosting maximum is NT$1,800, not a load-test wallet credit. |
| q-002 | C1 | dev | 0 | Current response TTL is 15 seconds, not the image-cache lifetime. |
| q-003 | C1 | test | 0 | Notification monthly ceiling is NT$2,400. |
| q-004 | C1 | test | 0 | INC-0621 email was read 47 minutes late. |
| q-005 | C1 | test | 0 | 小周 owns the PR #128 rollback drill; PR #182 is a different task. |
| q-006 | C1 | dev | 0 | Q-240 pauses intake at 240 jobs. |
| q-007 | C1 | dev | 0 | Each restore verification has an NT$320 temporary-resource cap. |
| q-008 | C1 | test | 0 | Zoe owns PR #206 dependency auditing; PR #260 concerns licenses. |
| q-009 | C1 | dev | 0 | A closed branch's test database remains four hours. |
| q-010 | C1 | dev | 0 | AUD-031 could not attribute a settings change to a person. |
| q-011 | C1 | test | 0 | Pending decisions follow the three-line summary; foreign two-line text is excluded. |
| q-012 | C1 | test | 0 | The destination is PaperNest's decision page. |
| q-013 | C1 | test | 0 | September shipping is capped at NT$360. |
| q-014 | C1 | dev | 0 | Evan owns the H-084 onboarding checklist. |
| q-015 | C1 | test | 0 | 小葉 maintains the handoff table. |
| q-016 | C1 | test | 1 | 陳會計 checks tax categories; the change rationale is additional valid span support. |
| q-017 | C1 | dev | 0 | INV-260814 face amount is NT$18,600. |
| q-018 | C1 | test | 0 | 陳經理 receives and first reviews cost alerts; responsibility is read as handling alerts. |
| q-019 | C1 | dev | 0 | Zoe owns the EX-42 export acceptance checklist. |
| q-020 | C1 | test | 0 | R-180 drafts must work without an account. |
| q-021 | C2 | test | 0 | SMS backup remains proposed, not adopted. |
| q-022 | C2 | test | 0 | Documentation may skip reviewer two only when configuration files are excluded. |
| q-023 | C2 | dev | 0 | 阿哲 checks attachment capacity and does not choose retention. |
| q-024 | C2 | dev | 0 | 小許 handles production-capacity reports, not production cleanup. |
| q-025 | C2 | test | 0 | The summary limit is 180 Chinese characters. |
| q-026 | C2 | test | 0 | 小周 checks Friday-edition links, not the entire letter. |
| q-027 | C2 | test | 0 | An unsettled payment amount requires stopping and asking. |
| q-028 | C2 | test | 0 | The report must include the actual exit code. |
| q-029 | C2 | test | 0 | 小葉 only resets the test-account password. |
| q-030 | C2 | test | 0 | Sample booklets still ship Friday, separate from order arrival. |
| q-031 | C2 | test | 0 | Session 七二 venue cost is NT$1,200, not a candidate payment. |
| q-032 | C2 | dev | 0 | 陳經理 owns stationery inventory. |
| q-033 | C2 | test | 0 | Attendance replies close at noon on the previous day. |
| q-034 | C2 | test | 0 | The September report is due October 7, 17:00 Taipei. |
| q-035 | C2 | test | 0 | 小葉 owns refund matching. |
| q-036 | C2 | test | 0 | 陳會計 checks the invoice tax amount. |
| q-037 | C2 | dev | 0 | A single claim strictly above NT$3,500 needs the user's signature. |
| q-038 | C2 | test | 0 | 小葉 prepares the weekly balance summary. |
| q-039 | C2 | test | 0 | 小葉 owns trial-expiry reminders. |
| q-040 | C2 | test | 0 | 小周 proofreads the plan names. |
| q-041 | C3 | test | 0 | 小林 maintains interview case questions; interview style is identifying context. |
| q-042 | C3 | test | 0 | Send the supplier agenda one day before the call; monthly cadence identifies it. |
| q-043 | C3 | dev | 0 | The stationery order cap is NT$2,200; surplus pens identify the office. |
| q-044 | C3 | test | 0 | Reserve a seat only after an explicit attendance confirmation. |
| q-045 | C3 | test | 0 | Collect attachments by the fifth monthly; the report's delivery date is different. |
| q-046 | C3 | dev | 0 | The twice-paid bill is INV-260814 for NT$18,600; the mishap identifies it. |
| q-047 | C3 | test | 0 | Notify the user when unmatched differences exceed NT$500. |
| q-048 | C3 | test | 0 | Q4 service budget excludes the one-time data migration expense. |
| q-049 | C3 | test | 0 | Submit the electronic invoice and acceptance records together. |
| q-050 | C3 | test | 0 | The package needs a categorized ledger and an exceptions sheet. |
| q-051 | C3 | dev | 0 | 小許 checks duplicate receipts; the duplicate ticket is identifying context. |
| q-052 | C3 | test | 0 | Stop nonessential purchases below NT$420,000 available cash. |
| q-053 | C3 | test | 1 | Start onboarding with an example; the rationale span independently answers this facet. |
| q-054 | C3 | dev | 0 | Preserve original source timestamps, not merely a chosen export format. |
| q-055 | C3 | test | 0 | Expose source kind only; conceal conversation content. |
| q-056 | C3 | test | 0 | Trial expiry does not authorize an automatic charge. |
| q-057 | C3 | test | 0 | Noah owns mobile-submission acceptance checks. |
| q-058 | C3 | test | 0 | 小周 checks wording of the plan names. |
| q-059 | C3 | dev | 0 | The founder meeting is capped at 25 minutes; customer follow-up identifies it. |
| q-060 | C3 | test | 0 | The earliest reminder is 07:00 Taipei; commute conditions identify the workflow. |
| q-061 | C4 | dev | 0 | Current response-cache TTL is 15 seconds; all eligible supports are English. |
| q-062 | C4 | test | 0 | Only failed writes may wake the on-call engineer. |
| q-063 | C4 | dev | 0 | Selected worker concurrency is six. |
| q-064 | C4 | test | 0 | Dependency review is fortnightly, every other Friday. |
| q-065 | C4 | dev | 0 | Audit exports must remain in the Taiwan workspace. |
| q-066 | C4 | dev | 0 | Founder meetings are capped at 25 minutes. |
| q-067 | C4 | dev | 0 | Onboarding groups contain at most four new hires. |
| q-068 | C4 | test | 0 | Vendor check-in is the third Thursday each month. |
| q-069 | C4 | dev | 0 | INV-260814 is NT$18,600; the other invoice is a near-miss. |
| q-070 | C4 | test | 0 | OCT-07 closes October 7, 16:00 Taipei; receipt scans have an earlier deadline. |
| q-071 | C4 | test | 0 | Notification monthly ceiling is NT$2,400; eligible supports are Chinese. |
| q-072 | C4 | test | 0 | Documentation exemption excludes configuration files. |
| q-073 | C4 | dev | 0 | 阿哲 checks attachment capacity without setting retention. |
| q-074 | C4 | dev | 0 | Closed-branch test databases remain four hours. |
| q-075 | C4 | test | 0 | 小林 checks financial figures and cannot approve payments. |
| q-076 | C4 | test | 0 | Friday-edition links are 小周's limited responsibility. |
| q-077 | C4 | test | 0 | List assumptions, then continue reversible work. |
| q-078 | C4 | test | 0 | Do not send reminders after 20:00 Taipei. |
| q-079 | C4 | test | 0 | Invoice 八一四 maps to acceptance batch two. |
| q-080 | C4 | test | 0 | Demo-account data resets every seven days, separate from the trial period. |
| q-081 | C5 | test | 0 | Database, hosting cap, and migration owner are three separately requested facts. |
| q-082 | C5 | dev | 0 | 15-second response TTL and US$48 monthly cap are both necessary. |
| q-083 | C5 | test | 0 | 青禾 is the supplier; 陳經理 handles renewal. |
| q-084 | C5 | test | 0 | Two approvals, documentation exception, and 小周's PR #128 drill are all requested. |
| q-085 | C5 | dev | 0 | Six workers and the 240-job intake threshold are different limits. |
| q-086 | C5 | dev | 0 | Wednesday actual restore and 阿哲's record ownership answer procedure and person. |
| q-087 | C5 | dev | 1 | Separate database per branch and four-hour retention remain separate groups. |
| q-088 | C5 | dev | 0 | Individual admin accounts with weekly review and Taiwan-only exports are both required. |
| q-089 | C5 | test | 0 | Three-line summary plus pending decisions, prepared by 小林, answer format and owner. |
| q-090 | C5 | test | 0 | PaperNest decision pages, plain-text export, and 阿哲's weekly link checks are all needed. |
| q-091 | C5 | test | 0 | Proceed with stated assumptions; stop for an undecided payment amount. |
| q-092 | C5 | test | 0 | Text to the operations inbox and the 20:00 Taipei cutoff answer different parts. |
| q-093 | C5 | test | 1 | Wednesday arrival, NT$360 shipping cap, and 陳經理's receipt/count role are all needed. |
| q-094 | C5 | test | 0 | Daily noon handoff, next step plus ticket ID, and 小葉's table ownership are all needed. |
| q-095 | C5 | test | 0 | A 20-minute case discussion and 小林's case maintenance are both requested. |
| q-096 | C5 | dev | 0 | Monthly inventory then shortage purchasing and the NT$2,200 order cap are both needed. |
| q-097 | C5 | dev | 0 | Written approval and INV-260814's NT$18,600 face amount are distinct answers. |
| q-098 | C5 | test | 0 | Ledger/exceptions package, October 7 16:00 cutoff, and Evan's ownership are all needed. |
| q-099 | C5 | dev | 0 | Markdown default and retained source timestamps are separate requirements. |
| q-100 | C5 | test | 0 | Wednesday first-floor counter delivery and the 10:45 quantity cutoff are both needed. |
| q-101 | C6 | test | 0 | Current PostgreSQL decision supersedes SQLite; simultaneous assistant writes caused locks. |
| q-111 | C6 | dev | 0 | History needs March 60 seconds, August 15 seconds, and hidden stock corrections. |
| q-112 | C6 | test | 0 | History needs 雲鷺, then 青禾, and nighttime delay above two seconds. |
| q-113 | C6 | test | 0 | History needs email, then pager, and the 47-minute INC-0621 delay. |
| q-114 | C6 | test | 0 | History needs daily logs, then summary/pending decisions, and mobile reading on the MRT. |
| q-115 | C6 | dev | 0 | History needs Monday 09:00, Tuesday 10:30, and the customer-follow-up conflict. |
| q-116 | C6 | test | 1 | History needs Friday, Wednesday, and Thursday packing; one rationale supports the latter two. |
| q-117 | C6 | dev | 0 | History needs monthly onboarding, every second Tuesday, and a 23-day wait. |
| q-118 | C6 | test | 0 | History needs next-month day 10, then day 7, and three days of tax checking. |
| q-119 | C6 | test | 0 | History needs NT$9,000, NT$12,000, and two additional nighttime batches. |
| q-120 | C6 | test | 2 | History needs title-only, title plus badge, and misread suggestions; new layout is span-only. |
| q-121 | C7 | test | 0 | 小林 reviews backup scheduling and does not execute backups. |
| q-122 | C7 | dev | 0 | Image edge retention is 24 hours, separate from response TTL. |
| q-123 | C7 | test | 0 | Evan reviews dashboard colors, without dashboard uptime ownership. |
| q-124 | C7 | test | 1 | PR #182 copyediting is 小周's role; an S1000 span also identifies it while assigning copies to 阿岑. |
| q-125 | C7 | dev | 0 | Preview uses two workers; invoice-import concurrency is six. |
| q-126 | C7 | test | 0 | PR #260 concerns license headers, not PR #206 dependency review. |
| q-127 | C7 | dev | 0 | Iris proofreads public-status copy, distinct from access reminders. |
| q-128 | C7 | test | 0 | 小林 checks financial figures without payment-approval authority. |
| q-129 | C7 | dev | 0 | Engineering office hours remain Monday 09:00 Taipei, distinct from founder meetings. |
| q-130 | C7 | test | 0 | Friday links are distinct from the first proofreading pass. |
| q-131 | C7 | test | 0 | Sample booklets ship Friday; regular orders arrive Wednesday. |
| q-132 | C7 | dev | 0 | Equipment inventory remains monthly, unlike the onboarding cadence. |
| q-133 | C7 | test | 0 | 小葉 confirms the new-hire classroom, distinct from the handoff table. |
| q-134 | C7 | dev | 0 | NT$2,200 stationery cap is distinct from an equal-valued water-dispenser expense. |
| q-135 | C7 | test | 0 | September delivery is October 7, 17:00; attachment collection closes earlier. |
| q-136 | C7 | dev | 0 | INV-260841 is NT$16,800; INV-260814 is NT$18,600. |
| q-137 | C7 | test | 0 | One-time migration is excluded from Q4 service budget; test credit is different. |
| q-138 | C7 | test | 0 | NT$420,000 intervention threshold is distinct from NT$4,200 petty cash. |
| q-139 | C7 | dev | 0 | Default export is Markdown; public preview remains HTML. |
| q-140 | C7 | test | 0 | Badges expose kind only; layout and saved-list memories do not state disclosure permission. |
| q-141 | C8 | test | 0 | Exact production-cutover downtime is absent throughout both namespaces and scales. |
| q-142 | C8 | test | 0 | Early-termination fee is absent; supplier selection does not supply contract pricing. |
| q-143 | C8 | test | 0 | No fixed second reviewer's name is recorded; rollback ownership is not that appointment. |
| q-144 | C8 | dev | 0 | No backup destination is selected; Osaka is explicitly a fake city-field value. |
| q-145 | C8 | dev | 0 | No hardware-key manufacturer is selected; the pilot is only proposed and the mock shell is inert. |
| q-146 | C8 | test | 0 | No formal page-tag color is recorded; indigo is explicitly a practice-card background. |
| q-147 | C8 | test | 0 | No full offer-sender name is recorded; an empty teaching sender field is not an appointment. |
| q-148 | C8 | test | 0 | No September report encryption password is present. |
| q-149 | C8 | test | 0 | No first-release launch venue is present; the workshop app leaves its city blank. |
| q-150 | C8 | test | 0 | No raincoat purchasing size is present; the outing loan form explicitly leaves size empty. |
| q-151 | FOREIGN | test | 0 | LANTERN-642 occurs only in the foreign display-warehouse memory. |
| q-152 | FOREIGN | test | 0 | CAB-903 occurs only in the foreign prototype-cabinet memory. |
| q-153 | FOREIGN | dev | 0 | SNOW-271 occurs only in the foreign paper-box memory. |
| q-154 | FOREIGN | dev | 0 | QR-518 occurs only in the foreign rehearsal-room memory. |
| q-155 | FOREIGN | test | 0 | ELM-806 occurs only in the foreign locker memory. |
| q-156 | FOREIGN | test | 0 | JC-374 occurs only in the foreign practice-crate memory. |
| q-157 | FOREIGN | test | 0 | TIDE-953 occurs only in the foreign ledger-sleeve memory. |
| q-158 | FOREIGN | test | 0 | MIST-428 occurs only in the foreign sample-folder memory. |
| q-159 | FOREIGN | test | 0 | DEER-167 occurs only in the foreign model-shelf memory. |
| q-160 | FOREIGN | dev | 0 | STAR-695 occurs only in the foreign rain-gear display-box memory. |
| q-161 | C6 | test | 0 | Current two-reviewer rule supersedes one reviewer because PR #128 missed rollback paths. |
| q-162 | C6 | test | 1 | Current direct conversational tone supersedes formal prose; politeness was misread as commitment. |
| q-163 | C6 | test | 0 | Current PaperNest page supersedes chat pinning because withdrawal reasons could not be marked. |
| q-164 | C6 | test | 0 | Current daily noon handoff supersedes weekly rotation because open cases accumulated seven days. |
| q-165 | C6 | dev | 0 | Current written invoice approval supersedes verbal approval after a double payment. |
| q-166 | C6 | test | 0 | Current Tuesday reconciliation supersedes month-end batching after nine unmatched July refunds. |
| q-167 | C6 | test | 2 | Current example-then-configuration order supersedes six-step setup; step four lost users. |
| q-168 | C6 | dev | 0 | Current Markdown default supersedes HTML because customers use plain-text review tools. |
| q-169 | C6 | test | 0 | Current Wednesday first-floor delivery supersedes the meeting room, now used for recording. |
