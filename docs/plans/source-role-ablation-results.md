# Source-role ablation result delivery

Primary acceptance contract, written before result-document implementation.
Base `56d383cdfafa371c2bbe05ef695dc4c099507cc2`; dependent branch
`docs/source-role-ablation-results`, target `feat/source-role-ablation-guard`.
This is evidence delivery, not a production prompt change or benchmark rerun.

## Result: do not advance (2026-10-08)

The candidate gained zero eligible direct anchors; the frozen advancement rule
requires at least two. This one-pass extraction-only experiment therefore does
not justify promoting the candidate prompt, even if the borderline baseline
semantic finding is excluded. No threshold, prompt or product default changed.

The [aggregate record](../../evaluation/source-role-ablation/results-20261008.json)
retains all 24 slot outcomes and evidence hashes without raw model outputs,
private authority records or local paths. Method and limits were frozen in the
[ablation contract](source-role-ablation.md),
[manifest](../../evaluation/source-role-ablation/frozen-manifest.json) and
[one-shot transport contract](source-role-ablation-execution.md).

| Observation | Baseline | Candidate |
| --- | ---: | ---: |
| Structurally completed arm slots | 12/12 | 12/12 |
| Extracted memory items | 32 | 25 |
| Eligible direct anchors retained | 12/12 | 12/12 |
| Required assistant anchors retained | 2/2 | 2/2 |
| Over-capacity direct anchors retained (separate case) | 5/21 | 5/21 |
| Structural refusals | 0 | 0 |
| Unsupported promotions observed by both blind reviewers | 1 | 0 |
| Other citation-support findings observed by both reviewers | 0 | 1 |

Span coverage is not summary entailment or attribution accuracy. Extracted
memory items are not admitted cards. The over-capacity case requires 21
independent windows against a maximum of 20 (five items, four windows each);
it is excluded from the achievable direct-gain denominator. Both arms used the
same twelve synthetic inputs, `gpt-4.1-mini-2025-04-14`, and caps: 6,000 input
tokens, 1,024 output tokens, five items, four windows/item and 600 content units.
The manifest fixes alternating arm order by case. Runtime commit was
`56d383cdfafa371c2bbe05ef695dc4c099507cc2`, on Node 24.15.0.

### Independent blind semantic review

Two freshly contextualized GPT-6.1 Sol/high reviewers each inspected all 24
shuffled records and all 57 extracted items before arm identity was revealed.
They agreed on two findings, kept separate under the frozen rubric:

- Baseline case 7, item 1: reported speech was promoted toward an established
  event. Reviewer A explicitly called this borderline because the wording
  retained hearsay context. The observed baseline promotion count is one.
- Candidate case 5, item 1: the full input supports a 21-day claim, but this
  item's selected receipts cover only days 1–4. Another item's day-21 receipt
  does not supply this item's missing support. This is citation insufficiency,
  not fabrication relative to the full input, and is not counted as an
  unsupported promotion.

The gate label `reviewed-zero-observed-promotions` applies only to candidate
unsupported promotions, not to all semantic errors. Two reviewers from the
same model family are not human gold or statistical certainty; no-findings
counts are not accuracy scores. Direct gain remains zero regardless of review.

### Execution, integrity and budget

All 24 slots completed with 48 succeeded requests, no retries or replacements,
zero pending attempts and zero unknown transport outcomes. The primary
separately observed outer process exit 0; the retained artifact's `osExit` field
remains `unknown`. Identity, 24 slot records, final report and closure comprise
27 retained execution artifacts. Slot journals retain `persistence: pending`
at publication; final returned records report `persisted`. Neither state means
memory admission. Primary and an independent post-run auditor
verified their hashes and chain; hashes identify bytes, not authentication.
The post-run auditor did not inspect the actual ledger. Original history-prefix
preservation is the launcher's ordered public-snapshot observation, not an
independent raw-rowid audit.

New conservative reservation was US$0.24, making the retained cumulative
reservation US$309.057185 within US$400 with US$30 protected. Twenty-four
actual-cost entries remain unknown. US$0.008060 is only the known actual-cost
portion, not the full bill; there is no refund, budget reset or inferred cost
for the unknown entries.

This was extraction only: actual capture qualification, admission, MOC filing
and recall were not executed. The findings do not prove that an unsupported
summary was admitted or explain a historical failure. The bounded next step
is an offline check of the existing capture/qualification/admission boundary
for claims unsupported by their attached receipts, not prompt promotion or
another paid run. No unverified follow-up outcome is included here.

The earlier development thirty remains separate and unchanged: Cairn 13
correct, 10 incorrect, 7 unresolved versus native Mem0 21, 8, 1. This experiment
adds no LongMemEval score and establishes no parity, general reliability,
lightweight-resource, production-latency or MCP/Hermes end-to-end quality claim.

## Acceptance

- R1: Record one completed frozen twelve-case/twenty-four-arm synthetic
  extraction-only experiment. Every arm remains visible. Distinguish 24/24
  structural completion from accuracy or durable memory admission; no full
  capture/qualification/MOC/recall or host claim.
- R2: Preserve identical baseline/candidate model, caps, source inputs and
  predeclared rubric. Report both 12/12 eligible direct anchors, 2/2 required
  assistant anchors and separately 5/21 over-capacity anchors, zero structural
  refusals. Added direct retention is zero: threshold of at least two fails;
  no prompt promotion, no claim of recall or benchmark improvement.
- R3: Report two independent freshly contextualized GPT-6.1 Sol/high blind
  reviews of all 24 shuffled records/57 memory items. Preserve limitations:
  same model family, not human gold or statistical certainty. Both flagged
  baseline reported-speech promotion in case7 (one reviewer explicitly called
  it borderline) and candidate incomplete per-memory citation support in
  case5. The latter is supported by the full input but not its selected
  receipts: distinguish citation insufficiency from fabricated source facts.
  Preserve other findings separately from the frozen promotion metric.
- R4: Record actual outer process exit0 as separately observed, 27 verified
  retained execution artifacts, 48 succeeded requests/pending0, new conservative
  reservation US$0.24 and cumulative US$309.057185 under US$400/protectedUS$30.
  Twenty-four actual-cost entries remain unknown; US$0.008060 is only the known
  portion, not the full bill. No refund/reset/retry or old result modification.
  Bound hashes identify evidence, not authentication. Original-prefix checking
  is the launcher's observation, not an independent raw-rowid audit.
- R5: Keep the earlier development30 score separate and unchanged: Cairn13
  correct/10incorrect/7unresolved versus native Mem0 21/8/1. This ablation is
  neither new LongMemEval questions nor proof of parity, general reliability,
  lightweight resource use or production improvement. No raw user data,
  credentials, absolute private paths or authority records in delivered files.
- R6: Add a concise machine-readable aggregate evidence record and limitations
  entry, with references to existing frozen design and model/prompt/rubric pins.
  Do not publish operational controls or alter frozen assets, core, adapters,
  grants, dependency/CI files, README marketing or product defaults. Identify
  follow-up: inspect whether actual capture/qualification/admission rejects
  summary claims not supported by attached receipts, using bounded offline
  controls first. No claim that extraction-only output bypassed those later
  stages or caused historical benchmark errors.
- R7: Primary inspects exact three-file diff, cross-checks manifest two ways,
  runs contributor generic/JSON/maintainer gates on exact Node22.16.0/24.15.0,
  freezes a candidate, receives independent Standards/Spec reviews and verifies
  latest-head CI before ready PR. No merge/release/deployment.

## Ownership and scope

One delegated GPT-6.1 Sol/high worker implements only this plan/result report,
`docs/limitations.md`, and `evaluation/source-role-ablation/results-20261008.json`.
Primary owns integration, direct verification and evidence interpretation.
Two independent nonauthor reviewers inspect the same fixed candidate.
Read only supplied new experiment reports, aggregate/blind-review evidence and
accepted source contracts. Never read keys, original benchmark sources/gold,
live ledgers or run a provider/launcher. Existing dependency setup links are
read-only, not deliverables; do not install, rebuild or remove their targets.

## Delivery evidence status

The delegated author is GPT-6.1 Sol/high. Result arithmetic, artifact integrity
and the two blind result reviews were accepted by primary before this draft;
candidate Standards/Spec review, generic/JSON/maintainer gates on Node 22.16.0
and 24.15.0, latest-head CI and ready-PR delivery remained primary-owned and
pending at the author checkpoint below. No TypeScript gate applies to this JS repo.
The author only reads supplied new synthetic evidence and validates aggregate
JSON, hashes and the exact three-file scope; no launcher/provider is invoked.

An initial read-only inspection assumed an unwrapped `report.slots` field and
exited 1. Inspecting wrapper keys corrected the projection to `report.results`;
the corrected read exited 0. The aggregate checker also initially exited 1 for
an incorrect prompt subdirectory, then 1 for equating the pending slot journal
with the persisted final record. Corrected checks preserve and assert that
distinction. These were inspection-tooling failures, not experiment failures
or reruns. Existing dependency links remain read-only and unchanged.

The final read-only inline aggregate checker ran with
`env -i PATH=/usr/bin:/bin TMPDIR=/tmp NODE_DISABLE_COMPILE_CACHE=1` and exact
Node 22.16.0 and 24.15.0, each actual exit 0. It parsed the public JSON, matched
all 24 scalar rows to the actual report and frozen order, derived 57 items and
per-arm coverage, verified model/caps/frozen hashes and review/accounting
projections, and checked all 27 artifact hashes and journal-chain bindings.
No temporary fixture or artifact was created by these read-only checks.
Separate JSON parsing on each exact Node also exited 0:
`node -e 'JSON.parse(require("node:fs").readFileSync("evaluation/source-role-ablation/results-20261008.json","utf8"))'`.
`git diff --check` exited 0. Changed-path discovery using
`git diff --name-only -z` plus `git ls-files --others --exclude-standard -z`
matched `git status --porcelain=v1 -z`: exactly the three authorized delivery
files, excluding only the three known read-only dependency setup links.
The scope/HEAD/hash assertion exited 0; no source or frozen asset changed.

### Primary integrated acceptance

Primary read the full three-file candidate and independently compared all 24
published slot projections and 57 item counts with the hash-bound retained
report; the check exited 0 and confirmed the earlier thirty-case scores were
unchanged. Source coverage and blind-review findings remain separate measures.

All six contributor commands passed with actual exit 0, no signal or process
error, on exact Node 22.16.0 and 24.15.0. On each runtime:

- `node integrations/client/testing/run.mjs --test-concurrency=1 <generic test paths>`:
  581/581 tests passed, zero failures/cancellations/skips. The 21 test paths were
  enumerated from the two generic test directories and independently matched
  Git's tracked test paths, with flags placed before paths.
- `npm run validate`: JSON/version checks passed.
- `npm run validate --prefix tools/plugin-validation`: maintainer validation passed.

Commands ran serially in keyless environments with each exact runtime bin first,
`TMPDIR=/tmp` and disabled compile cache. The six-command harness itself exited
0 and verified all three delivery hashes unchanged across the gates. Changed
paths again matched through Git diff plus untracked enumeration versus porcelain
status; only three known read-only dependency setup links were excluded. No
dependency installation, provider access or operational ledger mutation occurred.

Primary's bounded integration edit only updates this delivery-status record;
aggregate results, limitations and all frozen assets remain unchanged. Candidate
Standards/Spec reviews and latest-head CI are still pending before ready delivery.
There is no merge, release, deployment, new benchmark score or prompt promotion.
